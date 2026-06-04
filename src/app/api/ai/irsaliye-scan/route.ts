import { NextRequest, NextResponse } from 'next/server';
import { generateVisionWithGemini, generateWithGemini, getGeminiApiKey, type GeminiVisionImage } from '@/lib/ai/geminiClient';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ProductCandidate {
  stokKodu: string;
  stokAdi: string;
  marka?: string;
  anaBirim?: string;
  ambalajDegeri?: number;
}

interface RawAiItem {
  stokKodu?: string;
  stokAdi?: string;
  productKey?: string;
  marka?: string;
  brand?: string;
  lot?: string;
  miad?: string;
  skt?: string;
  expiry?: string;
  rawLine?: string;
  quantity?: number;
  miktar?: number;
  unit?: string;
  birim?: string;
}

interface RawAiPayload {
  irsaliyeNumber?: string;
  irsaliyeDate?: string;
  invoiceDate?: string;
  supplierName?: string;
  notes?: string;
  items?: RawAiItem[];
}

interface ScanResultItem {
  stokKodu: string;
  stokAdi: string;
  marka?: string;
  lot?: string;
  miad?: string;
  rawLine?: string;
  sourceQuantity: number;
  sourceUnit?: string;
  convertedQuantity: number;
  convertedUnit?: string;
  anaBirim?: string;
  ambalajDegeri?: number;
  conversionApplied: boolean;
  conversionReasoning?: string;
  matchConfidence: 'high' | 'medium' | 'low';
  matchedBy: 'stok_kodu' | 'stok_adi' | 'none';
}

const SYSTEM_PROMPT = `Sen Türkçe e-İrsaliye/sevk irsaliyesi okuma uzmanısın.

GÖREV:
- Verilen PDF sayfa görüntülerinden TÜM ürün satırlarını çıkar.
- Her satır için: stok kodu (varsa), stok adı, marka, LOT, MIAD/SKT, miktar ve birim alanlarını oku.
- Sayfadaki tabloyu kolon hizalarına göre çöz; UTS kodu, sıra numarası ve LOT birbirine karıştırılamaz.
- Üst başlıktan irsaliye numarasını, irsaliye tarihini ve satıcı/firma adını çıkar.

KURALLAR:
1) Sadece JSON döndür. JSON dışı metin verme.
2) LOT/Parti/Batch sütunundaki değeri lot olarak ver. UTS kodu (genelde 11-16 haneli sayı) LOT değildir.
3) miad/skt yi dd.MM.yyyy formatında ver. iki haneli yıl varsa 2000+yy yap.
4) quantity sayısal değer olsun (örn. 750 ya da 30). Virgül yerine nokta kullan.
5) unit alanına faturada yazan birimi yaz (ADET, KUTU, PAKET, KOLI, vb.). Yazmıyorsa boş bırak.
6) marka alanına ürün satırındaki marka/firma adını yaz. Yoksa boş bırak.
7) stokKodu önce dene; emin değilsen veya bulunamadıysa stokAdi alanını doldur.
8) Ürün listesi verildi; mümkünse listedeki stokKodu/stokAdı ile eşle, eşlemediysen yine de satırı bildir.
9) rawLine alanına satırın kabaca tüm metnini koy (debug için).
10) Eğer hiçbir ürün bulamazsan items: [] döndür.

JSON ŞEMASI:
{
  "irsaliyeNumber": "",
  "irsaliyeDate": "dd.MM.yyyy",
  "supplierName": "",
  "notes": "",
  "items": [
    {
      "stokKodu": "",
      "stokAdi": "",
      "marka": "",
      "lot": "",
      "miad": "dd.MM.yyyy",
      "quantity": 0,
      "unit": "",
      "rawLine": ""
    }
  ]
}`;

function safeJsonParse(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (block) {
      try { return JSON.parse(block.trim()); } catch { /* ignore */ }
    }
    const obj = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!obj) return null;
    try { return JSON.parse(obj); } catch { return null; }
  }
}

function normalizeMiad(value?: string): string | undefined {
  if (!value) return undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
  const m1 = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (m1) {
    const dd = m1[1].padStart(2, '0');
    const mm = m1[2].padStart(2, '0');
    const yy = m1[3].length === 2 ? `20${m1[3]}` : m1[3];
    return `${dd}.${mm}.${yy}`;
  }
  const m2 = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (m2) {
    const dd = m2[3].padStart(2, '0');
    const mm = m2[2].padStart(2, '0');
    return `${dd}.${mm}.${m2[1]}`;
  }
  return undefined;
}

function looksLikeUtsCode(value?: string): boolean {
  if (!value) return false;
  return /^\d{11,16}$/.test(value.replace(/\s+/g, ''));
}

function sanitizeLot(value?: string): string | undefined {
  if (!value) return undefined;
  const token = value.trim().replace(/[|;,]+/g, ' ').match(/\b([A-Za-z0-9-]{3,})\b/)?.[1];
  if (!token) return undefined;
  if (looksLikeUtsCode(token)) return undefined;
  return token.toUpperCase();
}

function normalizeText(value?: string): string {
  return (value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function cleanCode(code: string): string {
  return (code || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
}

function getTopCandidates(rawName: string, rawCode: string, products: ProductCandidate[], limitCount = 15): ProductCandidate[] {
  const normRawName = normalizeText(rawName);
  const normRawCode = cleanCode(rawCode);
  if (!normRawName && !normRawCode) return [];

  const scored = products.map(p => {
    let score = 0;

    // 1. Code similarity
    if (normRawCode && p.stokKodu) {
      const normPCode = cleanCode(p.stokKodu);
      if (normPCode && (normRawCode.includes(normPCode) || normPCode.includes(normRawCode))) {
        score += 12;
      }
    }

    // 2. Name token overlap
    const normPName = normalizeText(p.stokAdi);
    if (normRawName && normPName) {
      const rawTokens = normRawName.split(' ').filter(t => t.length >= 2);
      const pTokens = new Set(normPName.split(' ').filter(t => t.length >= 2));
      let overlap = 0;
      rawTokens.forEach(t => { if (pTokens.has(t)) overlap += 1; });
      score += overlap * 2;

      // Substring bonus
      if (normPName.includes(normRawName) || normRawName.includes(normPName)) {
        score += 5;
      }
    }

    return { product: p, score };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limitCount)
    .map(x => x.product);
}

interface AiMatchDecision {
  index: number;
  matchedStokKodu: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  reasoning?: string;
}

async function askAiForProductMatching(
  itemsToMatch: Array<{ index: number; raw: RawAiItem; candidates: ProductCandidate[] }>
): Promise<Map<number, AiMatchDecision>> {
  const apiKey = getGeminiApiKey();
  if (!apiKey || itemsToMatch.length === 0) return new Map();

  const payload = itemsToMatch.map(it => ({
    index: it.index,
    invoiceItem: {
      stokKodu: it.raw.stokKodu || '',
      stokAdi: it.raw.stokAdi || '',
      marka: it.raw.marka || it.raw.brand || '',
    },
    systemCandidates: it.candidates.map(c => ({
      stokKodu: c.stokKodu,
      stokAdi: c.stokAdi,
      marka: c.marka || '',
    })),
  }));

  const prompt = [
    'Aşağıda faturadan okunan ve sistemle tam eşleşemeyen ürün kalemleri ile bu kalemler için sistemdeki en olası aday ürünler listelenmiştir.',
    'Görev: Her fatura kalemi için sistem adaylarından en doğru olanını seçmek.',
    'Kurallar:',
    '- Ürün adlarındaki yazım farklılıklarını, marka kısaltmalarını, tıbbi terimleri ve kod benzerliklerini dikkate al.',
    '- Stok kodu kısmi olarak eşleşiyorsa (örn: faturadaki "bd.442020", sistemdeki "442020" ile) ve ad benzerse eşleştir.',
    '- Eğer adayların hiçbiri faturadaki ürünle kesinlikle uyuşmuyorsa, matchedStokKodu alanını null yap ve confidence değerini none yap.',
    '- confidence değeri yüksek/orta/düşük/none olmalıdır.',
    '- Sadece JSON dizisi döndür: [{"index":0,"matchedStokKodu":"KOD","confidence":"high","reasoning":"gerekçe"}].',
    `Veri: ${JSON.stringify(payload)}`,
  ].join('\n');

  try {
    const { text } = await generateWithGemini({
      systemPrompt: 'Sen envanter ürün eşleştirme asistanısın. Sadece geçerli JSON dizisi döndür, markdown yok.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxOutputTokens: 2048,
    });

    const parsed = safeJsonParse(text);
    const arr: AiMatchDecision[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
        ? parsed.items
        : [];

    const map = new Map<number, AiMatchDecision>();
    arr.forEach(d => {
      if (typeof d?.index === 'number') {
        map.set(d.index, {
          index: d.index,
          matchedStokKodu: d.matchedStokKodu ? String(d.matchedStokKodu) : null,
          confidence: d.confidence || 'none',
          reasoning: d.reasoning || '',
        });
      }
    });
    return map;
  } catch (err) {
    console.warn('[irsaliye-scan] AI matching error:', err);
    return new Map();
  }
}

/**
 * Match an AI-extracted item back to a system product.
 * Prefer exact stokKodu match → otherwise score by stokAdı token overlap.
 */
function matchProduct(
  raw: RawAiItem,
  products: ProductCandidate[]
): { product?: ProductCandidate; matchedBy: 'stok_kodu' | 'stok_adi' | 'none'; confidence: 'high' | 'medium' | 'low' } {
  const aiStokKodu = String(raw.stokKodu || raw.productKey || '').trim();
  if (aiStokKodu) {
    const byCode = products.find(p => p.stokKodu === aiStokKodu);
    if (byCode) return { product: byCode, matchedBy: 'stok_kodu', confidence: 'high' };
    const aiUpper = aiStokKodu.toUpperCase();
    const byCodeCI = products.find(p => p.stokKodu.toUpperCase() === aiUpper);
    if (byCodeCI) return { product: byCodeCI, matchedBy: 'stok_kodu', confidence: 'high' };

    // Gelişmiş kod eşleştirme (fatura kodu "bd.442020", sistem kodu "442020" gibi önek/sonek durumları)
    const cleanAi = cleanCode(aiStokKodu);
    if (cleanAi.length >= 4) {
      const byCleaned = products.find(p => {
        const cleanSys = cleanCode(p.stokKodu);
        if (cleanSys.length < 4) return false;
        return cleanAi.endsWith(cleanSys) || cleanSys.endsWith(cleanAi);
      });
      if (byCleaned) return { product: byCleaned, matchedBy: 'stok_kodu', confidence: 'high' };
    }
  }

  const aiName = normalizeText(raw.stokAdi);
  if (!aiName) return { matchedBy: 'none', confidence: 'low' };

  const aiTokens = new Set(aiName.split(' ').filter(t => t.length >= 3));
  if (aiTokens.size === 0) return { matchedBy: 'none', confidence: 'low' };

  let bestProduct: ProductCandidate | undefined;
  let bestScore = 0;
  let bestRatio = 0;

  for (const p of products) {
    const productName = normalizeText(p.stokAdi);
    if (!productName) continue;
    const productTokens = new Set(productName.split(' ').filter(t => t.length >= 3));
    if (productTokens.size === 0) continue;
    let overlap = 0;
    aiTokens.forEach(t => { if (productTokens.has(t)) overlap += 1; });
    if (overlap === 0) continue;
    const denom = Math.max(aiTokens.size, productTokens.size);
    const ratio = overlap / denom;
    const score = overlap + ratio;
    if (score > bestScore) {
      bestScore = score;
      bestRatio = ratio;
      bestProduct = p;
    }
  }

  if (bestProduct && bestRatio >= 0.6) {
    return { product: bestProduct, matchedBy: 'stok_adi', confidence: 'high' };
  }
  if (bestProduct && bestRatio >= 0.4) {
    return { product: bestProduct, matchedBy: 'stok_adi', confidence: 'medium' };
  }
  if (bestProduct && bestRatio >= 0.25) {
    return { product: bestProduct, matchedBy: 'stok_adi', confidence: 'low' };
  }
  return { matchedBy: 'none', confidence: 'low' };
}

/**
 * Decide how to convert the invoice's quantity into the system's main unit.
 * Three cases:
 *   1. Invoice unit matches main unit (kutu↔kutu) → keep as-is.
 *   2. Invoice unit is a piece-level unit (adet/test) and main unit is a pack
 *      (kutu/paket/koli) → divide by ambalajDegeri if it divides cleanly.
 *   3. Ambiguous: fall through and ask Gemini for a logical decision.
 */
type ConversionPlan = {
  convertedQuantity: number;
  convertedUnit: string;
  conversionApplied: boolean;
  reasoning?: string;
  needsAi: boolean;
};

function planLocalConversion(
  sourceQuantity: number,
  sourceUnit: string | undefined,
  product: ProductCandidate | undefined
): ConversionPlan {
  const qty = Math.max(0, Math.round(sourceQuantity || 0));
  if (!product) {
    return {
      convertedQuantity: qty,
      convertedUnit: sourceUnit || '',
      conversionApplied: false,
      needsAi: false,
    };
  }

  const anaBirim = (product.anaBirim || '').toString();
  const ambalaj = Number(product.ambalajDegeri || 0);
  const srcLower = (sourceUnit || '').toLocaleLowerCase('tr-TR').trim();
  const mainLower = anaBirim.toLocaleLowerCase('tr-TR').trim();
  const packUnits = new Set(['kutu', 'paket', 'koli', 'çuval', 'cuval', 'box', 'pack']);
  const pieceUnits = new Set(['adet', 'ad', 'test', 'ad.', 'pcs', 'ea']);

  if (!mainLower || !ambalaj || ambalaj <= 1) {
    return {
      convertedQuantity: qty,
      convertedUnit: anaBirim || sourceUnit || '',
      conversionApplied: false,
      needsAi: false,
    };
  }

  if (srcLower === mainLower) {
    return {
      convertedQuantity: qty,
      convertedUnit: anaBirim,
      conversionApplied: false,
      reasoning: `Faturadaki birim sistem ana birimi (${anaBirim}) ile aynı, dönüşüm gerekmedi.`,
      needsAi: false,
    };
  }

  const mainIsPack = packUnits.has(mainLower);
  const srcIsPiece = pieceUnits.has(srcLower);
  const srcIsPack = packUnits.has(srcLower);
  const srcIsAmbiguous = !srcLower;

  if (mainIsPack && (srcIsPiece || srcIsAmbiguous)) {
    if (qty >= ambalaj) {
      const candidatePacks = qty / ambalaj;
      const roundedPacks = Math.max(1, Math.round(candidatePacks));
      const isClean = qty % ambalaj === 0;
      return {
        convertedQuantity: roundedPacks,
        convertedUnit: anaBirim,
        conversionApplied: true,
        reasoning: isClean
          ? `Faturada ${qty} ${sourceUnit || 'birim'} yazıyor, ambalaj ${ambalaj} → ${roundedPacks} ${anaBirim}.`
          : `Faturada ${qty} ${sourceUnit || 'birim'} yazıyor (tam bölünmüyor), ambalaj ${ambalaj} → yaklaşık ${roundedPacks} ${anaBirim} olarak yuvarlandı.`,
        needsAi: false,
      };
    } else if (qty > ambalaj * 0.8) {
      return {
        convertedQuantity: 1,
        convertedUnit: anaBirim,
        conversionApplied: true,
        reasoning: `Faturada ${qty} ${sourceUnit || 'birim'} yazıyor, ambalaj ${ambalaj} → 1 ${anaBirim} olarak kabul edildi.`,
        needsAi: false,
      };
    }
    
    // Miktar ambalaj değerinden çok küçükse, kutu bazında yazılmış olması ihtimaline karşın
    // birim dönüşümünü AI'a soralım ama default olarak qty değerini koruyalım.
    return {
      convertedQuantity: qty,
      convertedUnit: sourceUnit || 'Adet',
      conversionApplied: false,
      reasoning: `Faturadaki miktar (${qty}) ambalaj değerinden (${ambalaj}) küçük, birim dönüşümü AI ile netleştirilecek.`,
      needsAi: true,
    };
  }

  if (mainIsPack && srcIsPack) {
    return {
      convertedQuantity: qty,
      convertedUnit: anaBirim,
      conversionApplied: false,
      reasoning: 'Faturadaki birim de ambalaj birimi olduğundan dönüşüm uygulanmadı.',
      needsAi: false,
    };
  }

  return {
    convertedQuantity: qty,
    convertedUnit: sourceUnit || anaBirim,
    conversionApplied: false,
    reasoning: 'Lokal dönüşüm uygulanmadı; AI değerlendirecek.',
    needsAi: true,
  };
}

interface AiConversionDecision {
  stokKodu: string;
  convertedQuantity: number;
  convertedUnit: string;
  reasoning: string;
}

async function askAiForConversions(
  items: ScanResultItem[]
): Promise<Map<string, AiConversionDecision>> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return new Map();
  const candidates = items.filter(it => !it.conversionApplied && it.ambalajDegeri && it.anaBirim);
  if (candidates.length === 0) return new Map();

  const payload = candidates.map(it => ({
    stokKodu: it.stokKodu,
    stokAdi: it.stokAdi,
    marka: it.marka || '',
    anaBirim: it.anaBirim || '',
    ambalajDegeri: it.ambalajDegeri || 0,
    sourceQuantity: it.sourceQuantity,
    sourceUnit: it.sourceUnit || '',
    rawLine: it.rawLine || '',
  }));

  const prompt = [
    'Aşağıdaki irsaliye satırlarını incele.',
    'Her ürün için sistemdeki ana birim ve ambalaj değeri verildi (anaBirim, ambalajDegeri).',
    'Faturadan gelen sourceQuantity ve sourceUnit ile mantıksal bir dönüşüm yap.',
    'Mantık kuralları:',
    '- Ana birim KUTU/PAKET/KOLI ise ve fatura ADET cinsindense: convertedQuantity = sourceQuantity / ambalajDegeri ile başla.',
    '- Eğer bölünme tam değilse, en yakın anlamlı tamsayıya yuvarla ve durumu reasoning içinde açıkla.',
    '- Eğer sayı çok büyükse (örn. ambalaj=500 ve sourceQuantity=5000) ve birim ADET ise muhtemelen 10 KUTU gelmiştir (5000/500=10). Bunu reasoning ile belirt.',
    '- Eğer sayı küçük ve birim KUTU ise (örn. ambalaj=500, sourceQuantity=10, unit=KUTU) bölme; 10 kutu olarak bırak.',
    '- sourceUnit yoksa sayının büyüklüğüne ve ambalaj değerine bakıp mantıklı tahmin yap.',
    '- convertedUnit her zaman sistem ana birimi olmalı (anaBirim).',
    '- convertedQuantity en az 1 olmalı.',
    'Sadece JSON dizisi döndür: [{"stokKodu":"","convertedQuantity":0,"convertedUnit":"","reasoning":""}].',
    `Veri: ${JSON.stringify(payload)}`,
  ].join('\n');

  try {
    const { text } = await generateWithGemini({
      systemPrompt: 'Sen envanter birim dönüşüm motorusun. Sadece geçerli JSON dizisi döndür, markdown yok.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxOutputTokens: 1600,
    });
    const parsed = safeJsonParse(text);
    const arr: AiConversionDecision[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
        ? parsed.items
        : [];
    const map = new Map<string, AiConversionDecision>();
    arr.forEach(d => {
      if (!d?.stokKodu) return;
      map.set(String(d.stokKodu), {
        stokKodu: String(d.stokKodu),
        convertedQuantity: Math.max(1, Math.round(Number(d.convertedQuantity || 0))),
        convertedUnit: String(d.convertedUnit || ''),
        reasoning: String(d.reasoning || ''),
      });
    });
    return map;
  } catch (err) {
    console.warn('[irsaliye-scan] AI conversion error:', err);
    return new Map();
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!getGeminiApiKey()) {
      return NextResponse.json({ error: 'GEMINI_API_KEY ayarlanmamış.' }, { status: 500 });
    }
    const form = await req.formData();
    const imageFiles = form.getAll('images').filter((f): f is File => f instanceof File);
    if (imageFiles.length === 0) {
      return NextResponse.json({ error: 'En az bir sayfa görüntüsü gerekli.' }, { status: 400 });
    }

    let products: ProductCandidate[] = [];
    try {
      const productsRaw = String(form.get('products') || '[]');
      const arr = JSON.parse(productsRaw);
      if (Array.isArray(arr)) {
        products = arr
          .map((p: any) => ({
            stokKodu: String(p?.stokKodu || '').trim(),
            stokAdi: String(p?.stokAdi || '').trim(),
            marka: p?.marka ? String(p.marka).trim() : undefined,
            anaBirim: p?.anaBirim ? String(p.anaBirim).trim() : undefined,
            ambalajDegeri: p?.ambalajDegeri ? Number(p.ambalajDegeri) : undefined,
          }))
          .filter(p => p.stokKodu);
      }
    } catch {
      return NextResponse.json({ error: 'Ürün listesi geçersiz.' }, { status: 400 });
    }

    if (products.length === 0) {
      return NextResponse.json({ error: 'Ürün listesi boş.' }, { status: 400 });
    }

    const ocrText = String(form.get('ocrText') || '').slice(0, 12000);

    // Build vision images from form file blobs.
    const images: GeminiVisionImage[] = [];
    for (const f of imageFiles) {
      const buffer = Buffer.from(await f.arrayBuffer());
      images.push({
        mimeType: f.type || 'image/jpeg',
        base64: buffer.toString('base64'),
      });
    }

    // Show the model only a slim product list (kodu, adi, marka) to fit context.
    const productListSnippet = products
      .slice(0, 1500)
      .map(p => `- ${p.stokKodu} | ${p.stokAdi}${p.marka ? ` | ${p.marka}` : ''}`)
      .join('\n');

    const userPrompt = [
      'Aşağıdaki irsaliye sayfa görüntülerinden ürün satırlarını çıkar.',
      'Önce stokKodu eşleştir; eşleşme yoksa stokAdı eşleştir.',
      'Bilinen ürünler (yalnızca eşleme için kullan, bunların dışında satır da bildirebilirsin):',
      productListSnippet,
      ocrText
        ? `\nEk olarak PDF metni şu şekilde okundu (kontrol için):\n${ocrText}`
        : '',
    ].join('\n');

    let aiPayload: RawAiPayload = {};
    let usedModel = '';
    try {
      const { text, model } = await generateVisionWithGemini({
        systemPrompt: SYSTEM_PROMPT,
        prompt: userPrompt,
        images,
        temperature: 0.1,
        maxOutputTokens: 6144,
        responseJson: true,
      });
      usedModel = model;
      const parsed = safeJsonParse(text);
      if (parsed && typeof parsed === 'object') {
        aiPayload = parsed as RawAiPayload;
      }
    } catch (err: any) {
      console.error('[irsaliye-scan] Vision call failed:', err);
      return NextResponse.json({
        error: err?.message || 'Gemini Vision çağrısı başarısız.',
      }, { status: 502 });
    }

    const rawItems: RawAiItem[] = Array.isArray(aiPayload?.items) ? aiPayload.items : [];

    const resultItems: ScanResultItem[] = [];
    const brandSet = new Set<string>();

    const itemsForAiMatch: Array<{ index: number; raw: RawAiItem; candidates: ProductCandidate[] }> = [];

    for (let i = 0; i < rawItems.length; i++) {
      const raw = rawItems[i];
      const matchInfo = matchProduct(raw, products);
      const product = matchInfo.product;

      const qty = Math.max(0, Math.round(Number(raw.quantity || raw.miktar || 0)));
      if (qty <= 0) continue;

      const lot = sanitizeLot(raw.lot);
      const miad = normalizeMiad(raw.miad || raw.skt || raw.expiry);
      const unitCandidate = String(raw.unit || raw.birim || '').trim();

      const stokKodu = product?.stokKodu || String(raw.stokKodu || '').trim();
      const stokAdi = product?.stokAdi || String(raw.stokAdi || '').trim();
      const marka = product?.marka || String(raw.marka || raw.brand || '').trim();

      if (marka) brandSet.add(marka);

      const conv = planLocalConversion(qty, unitCandidate, product);

      resultItems.push({
        stokKodu,
        stokAdi,
        marka: marka || undefined,
        lot,
        miad,
        rawLine: String(raw.rawLine || '').slice(0, 400) || undefined,
        sourceQuantity: qty,
        sourceUnit: unitCandidate || undefined,
        convertedQuantity: conv.convertedQuantity,
        convertedUnit: conv.convertedUnit,
        anaBirim: product?.anaBirim,
        ambalajDegeri: product?.ambalajDegeri,
        conversionApplied: conv.conversionApplied,
        conversionReasoning: conv.reasoning,
        matchConfidence: matchInfo.confidence,
        matchedBy: matchInfo.matchedBy,
      });

      // Eğer eşleşme zayıfsa veya eşleşemediyse, Gemini hibrit eşleştirme kuyruğuna alalım
      if (matchInfo.confidence === 'low' || matchInfo.confidence === 'medium' || matchInfo.matchedBy === 'none') {
        const candidates = getTopCandidates(raw.stokAdi || '', raw.stokKodu || '', products, 15);
        if (candidates.length > 0) {
          itemsForAiMatch.push({
            index: resultItems.length - 1,
            raw,
            candidates,
          });
        }
      }
    }

    // Gemini ile düşük/orta/eşleşmemiş kayıtları çözmeyi dene
    if (itemsForAiMatch.length > 0) {
      const aiMatches = await askAiForProductMatching(itemsForAiMatch);
      for (const [idx, decision] of aiMatches) {
        const item = resultItems[idx];
        if (!item || !decision.matchedStokKodu || decision.confidence === 'none') continue;

        const matchedProduct = products.find(p => p.stokKodu === decision.matchedStokKodu);
        if (matchedProduct) {
          const conv = planLocalConversion(item.sourceQuantity, item.sourceUnit, matchedProduct);
          
          item.stokKodu = matchedProduct.stokKodu;
          item.stokAdi = matchedProduct.stokAdi;
          if (matchedProduct.marka) item.marka = matchedProduct.marka;
          item.anaBirim = matchedProduct.anaBirim;
          item.ambalajDegeri = matchedProduct.ambalajDegeri;
          item.convertedQuantity = conv.convertedQuantity;
          item.convertedUnit = conv.convertedUnit;
          item.conversionApplied = conv.conversionApplied;
          item.conversionReasoning = conv.reasoning || item.conversionReasoning;
          item.matchConfidence = decision.confidence as 'high' | 'medium' | 'low';
          item.matchedBy = 'stok_adi';
        }
      }
    }

    // For items where local conversion is ambiguous, ask Gemini for a decision.
    const aiDecisions = await askAiForConversions(resultItems);
    if (aiDecisions.size > 0) {
      for (const item of resultItems) {
        if (item.conversionApplied) continue;
        const decision = aiDecisions.get(item.stokKodu);
        if (!decision) continue;
        const aiQty = Math.max(1, decision.convertedQuantity);
        // Only override if AI reduces or keeps the count (we don't want to multiply).
        if (aiQty > item.sourceQuantity * 2) continue;
        item.convertedQuantity = aiQty;
        item.convertedUnit = decision.convertedUnit || item.anaBirim || item.convertedUnit;
        item.conversionApplied = aiQty !== item.sourceQuantity;
        item.conversionReasoning = decision.reasoning || item.conversionReasoning;
      }
    }

    const totalConverted = resultItems.reduce((sum, it) => sum + it.convertedQuantity, 0);

    return NextResponse.json({
      irsaliyeNumber: aiPayload.irsaliyeNumber || undefined,
      irsaliyeDate: normalizeMiad(aiPayload.irsaliyeDate || aiPayload.invoiceDate) || undefined,
      supplierName: aiPayload.supplierName || undefined,
      notes: aiPayload.notes || undefined,
      brands: Array.from(brandSet).filter(Boolean),
      itemCount: resultItems.length,
      totalConvertedQuantity: totalConverted,
      items: resultItems,
      scanModel: usedModel,
    });
  } catch (error: any) {
    console.error('[irsaliye-scan] fatal:', error);
    return NextResponse.json({ error: error?.message || 'Tarama başarısız.' }, { status: 500 });
  }
}
