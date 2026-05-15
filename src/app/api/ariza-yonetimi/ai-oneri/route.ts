import { NextRequest, NextResponse } from 'next/server';
import { access, readFile } from 'fs/promises';
import path from 'path';
import { adminDb } from '@/lib/firebase-admin';

type SimilarFaultSummary = {
  id: string;
  model?: string;
  serial?: string;
  faultName?: string;
  faultType?: string;
  status?: string;
  description?: string;
  closeDescription?: string;
  openedAt?: string | null;
  closedAt?: string | null;
};

const AI_SUGGESTION_CACHE_VERSION = 5;

const FAULT_ANALYSIS_GUIDE = `
Aşağıdaki kurumsal servis rehberi, model ve arıza başlığına göre öncelikli kontrol adımlarını içerir. Bunu mevcut prompta EK bilgi olarak kullan.

TEKNİK SERVİS BAŞLIKLARI:
- Photometer Lamp: C 501/C 702 için absorbans >1.4 ise lamba değişimi + Exchange Incubation Water + Cell Blank Measurement öner. Risk: >Abs, ADC.E, test durması/hatalı sonuç.
- Vacuum Tank: C 501/C 702/E 801; sadece drain ile bırakma, filtre/kaçak valf/vakum basıncı kontrolü öner. Risk: rinse köpürme, taşma, MSB/Carriage Lifter kısa devre.
- Rinse Station & Water Bath: tıkanıklık için 0.2mm tel, vakum kontrolü, C serisinde Clean Incubation Bath Manually öner. Risk: su taşması, Rack Transport arızası, >Cuvet.
- Sample/Reagent Probe Up/Down: unclog sonrası probe seal ve Z-ekseni/sensör kontrolü öner. Risk: probe crash/kırılma ve test basımının durması.
- Carriage Lifter/Rack Transport/Carry-In/Axis: sadece resetle geçiştirme; sıvı teması, sensör oksit, kayış aşınması ve Mechanism Check öner. Risk: motor yanması.
- Reagent Bottle Shift & Cap Opener: disk encoder/sensör ayarı + Cap Opener Check öner. Risk: reagent probe kırılması.
- Tip Cup Gripper: E411/E601/E801; pad aşınması/atık yolu tıkanıklığını değerlendir. Risk: sarf düşmesi ve E-Stop.
- Voltage Error: UPS bakımını ve güç dalgalanmasını mutlaka sorgula. Risk: database corrupt, ADC.E yanması.
- Reservoir: Air Purge ve Degasser su tuzağı kontrolünü öner. Risk: air bubble/hatalı pipetleme.

APLİKASYON BAŞLIKLARI:
- Data Alarm & QC Violation: Data Alarms menüsü, taze QC/kalibratör ve bubble kontrolü öner. Risk: QCErr/Cal.E ve masking.
- Calibration Failed: Reagent Pack Changeover ve geçmiş Cal.I/Cal.E durumunu dikkate al; yeni reaktif + yeni kalibratörle baştan kalibrasyon öner.
- Reagent Loading Error & Barcode Read Error: Barcode/RFID Reader Check ve optik cam temizliği öner; E801 için masked port kontrolü.
- System Reagent Shortage (ProCell/CleanCell): warning seviyeleri ve köpük riskini değerlendir; Prime System Reagents Flow Paths öner.
- Probe Clogging: preanalitik santrifüj/pıhtı süreci denetimi ve Sample Probe Wash öner.

Cevap tonuna mutlaka iki vurgu ekle:
1) "Kök neden" adımında geçmişte atlanmış olabilecek kritik kontrolü söyle.
2) "Risk uyarısı" kısmında yüzeysel çözümün yol açabileceği olası klinik/teknik etkileri net belirt.
`;

function toIso(value: any): string | null {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?._seconds === 'number') return new Date(value._seconds * 1000).toISOString();
  return null;
}

function parseJsonFromModelText(raw: string): any | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function classifyResolution(description?: string | null): 'kalici' | 'gecici' | 'belirsiz' {
  if (!description) return 'belirsiz';
  const d = description.toLocaleLowerCase('tr-TR');
  const permanentHints = ['kalıcı', 'değiştirildi', 'revizyon', 'modül değişimi', 'kart değişimi', 'kök neden', 'tamir edildi'];
  const temporaryHints = ['geçici', 'reset', 'yeniden başlat', 'temizlik', 'idareten', 'beklemeye alındı', 'tekrar edebilir'];

  if (permanentHints.some((x) => d.includes(x))) return 'kalici';
  if (temporaryHints.some((x) => d.includes(x))) return 'gecici';
  return 'belirsiz';
}

function candidateGeminiModels(): string[] {
  const fromEnv = [
    process.env.GEMINI_MODEL,
    process.env.GOOGLE_GENAI_MODEL,
    process.env.NEXT_PUBLIC_GEMINI_MODEL,
  ].filter(Boolean) as string[];

  const defaults = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite'];
  return Array.from(new Set([...fromEnv, ...defaults]));
}


const MASTER_DOC_FILES = ['teknik-doc-2.txt', 'teknik_doc.txt'];

function candidateMasterDocPaths(): string[] {
  const fromEnv = process.env.AI_MASTER_DOC_PATH?.trim();
  const cwd = process.cwd();

  const baseDirs = [
    path.join(cwd, 'public'),
    '/home/user/studio/public',
    '/home/user/qore.g4/public',
    '/workspace/qore.g4/public',
  ];

  const candidates: string[] = [];
  if (fromEnv) candidates.push(fromEnv);
  for (const file of MASTER_DOC_FILES) {
    for (const dir of baseDirs) {
      candidates.push(path.join(dir, file));
    }
  }
  return candidates;
}

async function resolveMasterDocPath(): Promise<string> {
  const candidates = candidateMasterDocPaths();
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch {
      // continue
    }
  }

  throw new Error(`Master teknik dokümanı bulunamadı. Denenen yollar: ${candidates.join(' | ')}`);
}

async function loadMasterKnowledgeDoc() {
  const sourcePath = await resolveMasterDocPath();
  const text = await readFile(sourcePath, 'utf-8');
  const normalized = text.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    throw new Error(`Master teknik dokümanı boş: ${sourcePath}`);
  }
  // Dokümanın tamamını sakla; ilgili kesitleri extractRelevantDocSections seçecek.
  return { text: normalized, sourcePath };
}

const TURKISH_STOPWORDS = new Set([
  've', 'ile', 'için', 'bir', 'bu', 'şu', 'da', 'de', 'ki', 'mi', 'mu', 'mı', 'gibi',
  'ya', 'veya', 'olarak', 'üzerine', 'ama', 'fakat', 'çünkü', 'olduğu', 'olan',
  'cihaz', 'cihazı', 'cihazın', 'arıza', 'arızası', 'arızanın', 'arızada', 'hata',
  'hatası', 'sorun', 'sorunu', 'var', 'yok', 'oldu', 'olmuyor', 'çalışmıyor',
  'the', 'a', 'an', 'is', 'are', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with',
]);

function tokenizeFaultKeywords(...sources: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const s of sources) {
    if (!s) continue;
    for (const raw of s.toLocaleLowerCase('tr-TR').split(/[^a-zçğıöşü0-9®\-]+/i)) {
      const w = raw.trim();
      if (w.length < 3) continue;
      if (TURKISH_STOPWORDS.has(w)) continue;
      out.add(w);
    }
  }
  return Array.from(out);
}

function extractRelevantDocSections(
  docText: string,
  keywords: string[],
  budgetChars: number = 90_000,
): { excerpt: string; matchedSections: number; topHeadings: string[] } {
  if (!keywords.length || docText.length <= budgetChars) {
    return { excerpt: docText.slice(0, budgetChars), matchedSections: 0, topHeadings: [] };
  }

  const paragraphs = docText.split(/\n\s*\n/);
  const chunks: string[] = [];
  let buf = '';
  for (const p of paragraphs) {
    if ((buf + '\n\n' + p).length > 2200 && buf) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push(buf);

  const scored = chunks.map((chunk, idx) => {
    const lc = chunk.toLocaleLowerCase('tr-TR');
    let score = 0;
    const hits = new Set<string>();
    for (const kw of keywords) {
      const occ = lc.split(kw).length - 1;
      if (occ > 0) {
        score += Math.log2(1 + occ) + (hits.has(kw) ? 0 : 2);
        hits.add(kw);
      }
    }
    return { idx, chunk, score, distinctHits: hits.size };
  });

  scored.sort((a, b) => (b.score - a.score) || (b.distinctHits - a.distinctHits));

  const taken: typeof scored = [];
  let used = 0;
  for (const item of scored) {
    if (item.score <= 0) break;
    if (used + item.chunk.length > budgetChars) break;
    taken.push(item);
    used += item.chunk.length;
  }

  if (taken.length === 0) {
    return { excerpt: docText.slice(0, budgetChars), matchedSections: 0, topHeadings: [] };
  }

  taken.sort((a, b) => a.idx - b.idx);

  const topHeadings: string[] = [];
  for (const t of taken.slice(0, 6)) {
    const firstLine = t.chunk.split('\n').map((l) => l.trim()).find((l) => l.length > 0 && l.length <= 90);
    if (firstLine) topHeadings.push(firstLine);
  }

  const excerpt = taken
    .map((t) => `--- SECTION (idx=${t.idx}, score=${t.score.toFixed(2)}) ---\n${t.chunk}`)
    .join('\n\n');

  return { excerpt, matchedSections: taken.length, topHeadings };
}

function buildKnowledgeSignature(docText: string, sourcePath: string, keywordSignature: string): string {
  return `master_doc_v3:${path.basename(sourcePath)}:${docText.length}:${keywordSignature}`;
}


function hasUsableAiSuggestion(ai: any): boolean {
  if (!ai || typeof ai !== 'object') return false;
  const hasBrief = typeof ai.briefExplanation === 'string' && ai.briefExplanation.trim().length > 0;
  const hasSummary = typeof ai.summary === 'string' && ai.summary.trim().length > 0;
  const hasCauses = Array.isArray(ai.probableCauses) && ai.probableCauses.length > 0;
  const hasActions = Array.isArray(ai.suggestedActions) && ai.suggestedActions.length > 0;
  const hasEvidence = typeof ai.evidenceBasedRecommendation === 'string' && ai.evidenceBasedRecommendation.trim().length > 0;
  return hasBrief || hasSummary || hasCauses || hasActions || hasEvidence;
}

function buildDeterministicFallbackSuggestion(params: {
  report: any;
  sameFaultGroup: SimilarFaultSummary[];
  closeNotes: Array<{ openedAt?: string | null; description?: string; closeDescription?: string; resolutionClass: 'kalici' | 'gecici' | 'belirsiz' }>;
  resolutionStats: { kalici: number; gecici: number; belirsiz: number };
  sameCategoryActionForms: ActionFormSummary[];
  actionFormStats: ReturnType<typeof summarizeActionForms>;
  docSelection: { matchedSections: number; topHeadings: string[] };
  debug?: string;
}) {
  const { report, sameFaultGroup, closeNotes, resolutionStats, sameCategoryActionForms, actionFormStats, docSelection, debug } = params;

  const recent = sameFaultGroup.slice(0, 3).map((f) => f.openedAt).filter(Boolean) as string[];
  const recentText = recent.length > 0
    ? `Bu arıza aynı cihazda daha önce de görüldü (son kayıtlar: ${recent.join(', ')}).`
    : 'Bu arıza için aynı cihazda birebir geçmiş eşleşme sınırlı.';

  const topResolution = resolutionStats.gecici > resolutionStats.kalici
    ? 'geçici çözümler ağırlıkta'
    : resolutionStats.kalici > 0
      ? 'kalıcı çözümler mevcut'
      : 'çözüm tipi belirsiz';

  const closeHints = closeNotes
    .map((n) => (n.closeDescription || '').trim())
    .filter(Boolean)
    .slice(0, 2);

  const actions = [
    'Aynı seri numaradaki geçmiş kapanış notlarında tekrar eden adımı doğrulayın ve sadece reset/temizlik ile kapatmayın.',
    'Master teknik dokümandaki ilgili başlık için önerilen kontrol/check menüsünü eksiksiz uygulayın.',
    'Geçmişte geçici kapanmış vakalarda ilgili parça değişimi veya mekanik sensör kontrolünü değerlendirin.',
  ];

  // Tekrarlama olasılığı kestirimi
  const sameCategoryEventCount = sameFaultGroup.length + sameCategoryActionForms.length;
  const permanentRatio = resolutionStats.kalici / Math.max(1, resolutionStats.kalici + resolutionStats.gecici + resolutionStats.belirsiz);
  let recurrenceLikelihood: 'dusuk' | 'orta' | 'yuksek';
  if (sameCategoryEventCount >= 3 && permanentRatio < 0.34) recurrenceLikelihood = 'yuksek';
  else if (sameCategoryEventCount >= 2 || (sameCategoryEventCount >= 1 && permanentRatio < 0.5)) recurrenceLikelihood = 'orta';
  else recurrenceLikelihood = 'dusuk';
  const recurrenceRationale = `Aynı kategoride ${sameCategoryEventCount} kayıt (${sameFaultGroup.length} arıza + ${sameCategoryActionForms.length} işlem formu); kapanışlarda kalıcı çözüm oranı ${(permanentRatio * 100).toFixed(0)}%.`;

  // İşlem formu kanıtı
  const formActionHints: string[] = [];
  for (const f of sameCategoryActionForms.slice(0, 3)) {
    const partsUsed = (f.actions || [])
      .filter((a) => a.type === 'part_change' || a.type === 'hucre_degisimi')
      .map((a) => a.stokAdi || a.removedPartStokAdi)
      .filter(Boolean) as string[];
    if (partsUsed.length) formActionHints.push(`${partsUsed.join(', ')} değişimi`);
    else if (f.aciklama) formActionHints.push(f.aciklama.slice(0, 80));
  }
  const formEvidence = formActionHints.length
    ? `Geçmiş işlem formlarında uygulanmış işlemler: ${formActionHints.join(' | ')}.`
    : actionFormStats.partChanges > 0
      ? `Bu cihaz için toplam ${actionFormStats.partChanges} parça/hücre değişimi kaydı mevcut.`
      : '';

  const freqText = sameCategoryEventCount > 0
    ? `Bu seri numaralı cihazda aynı kategoride ${sameFaultGroup.length} arıza kaydı ve ${sameCategoryActionForms.length} ilgili işlem formu bulunuyor.`
    : 'Bu seri numarada aynı kategoride geçmiş kayıt bulunmuyor.';
  const resolutionText = resolutionStats.gecici > resolutionStats.kalici
    ? 'Geçmiş kapanışlarda kalıcı parça değişimi yerine ağırlıkla reset/temizlik tercih edilmiş.'
    : resolutionStats.kalici > 0
      ? 'Geçmiş kapanışlarda kalıcı parça değişimi/revizyon uygulanmış.'
      : '';
  const headings = (docSelection.topHeadings || []).filter(Boolean).slice(0, 3);
  const docHint = headings.length
    ? `AI motoru şu anda yanıt vermediği için doküman özeti üretilemedi; teknisyenin master dokümanın şu bölümlerini açıp birinci aksiyon olarak incelemesi gerekir: ${headings.join(' · ')}.`
    : 'AI motoru şu anda yanıt vermediği için doküman tabanlı çözüm önerisi üretilemedi; sayfayı yenileyerek tekrar deneyin veya GEMINI_API_KEY ayarını doğrulayın.';

  const briefExplanation = [freqText, resolutionText, formEvidence, docHint].filter(Boolean).join(' ');

  return {
    briefExplanation,
    recurrenceLikelihood,
    recurrenceRationale,
    summary: `${report.model || 'Cihaz'} (${report.serial || '-'}) için ${report.faultName || report.description || 'arıza'} analiz edildi. ${recentText}`,
    probableCauses: [
      'Geçmişte benzer semptomlarda kök neden adımı atlanmış olabilir.',
      'Aynı seri geçmişinde tekrarlayan hata örüntüsü olabilir.',
    ],
    suggestedActions: actions,
    chronicInsight: `Aynı seri geçmişine göre bu arıza için ${topResolution}.`,
    resolutionAssessment: `Geçmiş kapanış dağılımı — Kalıcı: ${resolutionStats.kalici}, Geçici: ${resolutionStats.gecici}, Belirsiz: ${resolutionStats.belirsiz}.`,
    evidenceBasedRecommendation: closeHints.length
      ? `Geçmiş kapanış notu örnekleri: ${closeHints.join(' | ')}. Bu nedenle sadece yüzeysel müdahale yerine kök neden adımını tamamlayın.`
      : 'Kapanış notu kanıtı sınırlı; bir sonraki müdahalede yapılan adımları detaylı kaydederek kalıcı/geçici etkiyi netleştirin.',
    confidence: 62,
    debug: debug ? `fallback_used:${debug}` : 'fallback_used:no_structured_ai',
  };
}

async function requestGeminiSuggestion(context: any) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Sen IVD/laboratuvar analizörleri (Roche cobas serisi) için saha mühendisi seviyesinde, ölçülü ve profesyonel bir arıza asistanısın.
Yalnızca JSON döndür:
{
  "briefExplanation": "5-6 cümle, teknik, profesyonel, doldurma yok",
  "recurrenceLikelihood": "dusuk" | "orta" | "yuksek",
  "recurrenceRationale": "tek cümle gerekçe",
  "summary": "kısa özet",
  "probableCauses": ["..."],
  "suggestedActions": ["..."],
  "chronicInsight": "kronik sorun yorumu",
  "resolutionAssessment": "geçmiş kapatma notlarına göre kalıcı/geçici çözüm analizi",
  "evidenceBasedRecommendation": "ör: X cihazı bu arızayı şu tarihlerde yaşamış, temizlik geçici kalmış; Y parça kontrol/değişim öner",
  "confidence": 0-100
}

briefExplanation kuralları (müdahaleyi yapacak teknisyen arızayı incelemeden önce bunu okuyacak; bu alan en kritik çıktıdır):
- Türkçe, tek paragraf, 6-8 cümle. Saha mühendisi tonunda; teknik, ölçülü ve profesyonel ol.
- Şablon/genel-geçer cümleler ("yüzeysel reset ile kapatmayın", "kontrol/check menüsünü, sensör hizalamasını ve parça aşınmasını sırayla doğrulayın", "dikkatli olun", "kontrol edin") KESİNLİKLE YASAK. Bu cümlelerden biri çıktıda görünürse cevap reddedilir. Her cümle somut, dokümana veya forma dayalı bilgi taşımalı.
- Yapı:
  1) Geçmiş (sadece 1 cümle): sameFaultCount, sameCategoryActionFormCount ve resolutionStats kullanarak frekansı belirt. Hiç kayıt yoksa "bu seri için geçmiş aynı kategoride kayıt bulunmuyor" deyip GEÇ — bu cümleyi 1 ile sınırla, uzatma.
  2) İşlem formu kanıtı (1-2 cümle): recentActionForms ve sameCategoryActionForms içindeki "aciklama" ve "actions" alanlarından somut bulgular çıkar — gerçek parça/menü/prosedür ismi ile (ör: "ECL Cell yenileme", "Sample Probe unclog", "Cell Blank Measurement"). Form yoksa veya bilgi kıt ise bu cümleleri atla, uydurma.
  3) Master teknik doküman çözümü (3 cümle, EN KRİTİK BÖLÜM): knowledgeDocs[0].text içeriği bu arızayla ilgili dokümanın gerçek bölümlerinden derlenmiştir. Bu metni ciddiyetle oku ve buradaki gerçek başlıklara, menü adlarına, parça isimlerine, ölçüm değerlerine ve prosedür adımlarına dayanarak 3 cümle yaz. Çözüm önerin şu yapıda olsun:
     a) İlk cümle: dokümandaki ilgili başlığı/bölümü ad olarak referans göster ve olası kök neden senaryosunu (örn: optik kirlilik, mekanik mil aşınması, valf basınç düşüşü, kalibrasyon sapması) belirt.
     b) İkinci cümle: dokümandan birinci aksiyon olarak izlenecek somut prosedürü/menüyü/check'i adım sırasıyla anlat (ör: "Utilities > Maintenance > Sample Probe Wash sekansını çalıştırıp ardından Photometer Cell Blank ölçümünü tekrarla").
     c) Üçüncü cümle: ikinci aksiyon olarak parça değişimi veya servis kontrolü gerekiyorsa hangisinin, hangi koşul altında devreye alınacağını ve hangi alternatif kontrolün uygulanacağını söyle (ör: "Lamba absorbans değeri 1.4 üstüne çıkıyorsa Photometer Lamp değişimi + Cell Blank Re-measurement; aksi halde Incubation Water exchange sonrası tekrar değerlendir").
     Bu 3 cümlede en az 4 farklı somut terim (menü adı / parça adı / prosedür adı / sayısal eşik / sensör adı) doküman metninden alıntılanmalı. Doküman metninde bulamadığın bir prosedürü ASLA üretme — onun yerine cümleyi kısalt.
  4) Komşu cihaz / laboratuvar etkisi (opsiyonel 1 cümle): siblingDevicesInSameLab listesinde arızalı/bağlı sistemde risk yaratabilecek bir cihaz varsa kısaca belirt; yoksa bu cümleyi atla.
- Selamlama, "bu arıza için", "öneri olarak", "dikkat edilmesi gereken" gibi gevşek başlangıç YASAK. İlk kelimeden itibaren bilgiye gir.
- Bağlamda olmayan tarih, parça kodu, menü adı, sayı veya tanı uydurma. Emin değilsen o cümleyi yazma.

recurrenceLikelihood / recurrenceRationale kuralları (tekrarlama olasılığı tahmini):
- recurrenceLikelihood değerini şu sinyallere göre belirle: sameFaultCount, sameCategoryActionFormCount, resolutionStats (gecici vs kalici oranı), son kapanışlarda parça değişimi yapılıp yapılmadığı, kronik örüntü (yakın tarihlerde tekrar eden kayıt), komşu cihaz etkisi.
  - "yuksek": geçmişte aynı kategori birden fazla görülmüş, son kapanışlar ağırlıkla geçici (reset/temizlik), kalıcı parça değişimi yok.
  - "orta": birkaç kayıt var ama son müdahalede kalıcı bir aksiyon var; ya da kayıt az ama örüntü belirsiz.
  - "dusuk": geçmiş kayıt yok veya çok az, son müdahale kalıcı parça/revizyon ile kapatılmış.
- recurrenceRationale tek cümlede, sayısal kanıta dayanarak gerekçeyi açıkla (örn: "Son 6 ayda 3 kez aynı kategoride kayıt ve hepsi reset ile kapatılmış, kalıcı parça değişimi yok.").

Genel kurallar:
- Türkçe yaz. Resmi-teknik üslup; cümleler kısa, net ve enformatif.
- Sadece verilen bağlamı kullan. Bağlamda olmayan sayı/tarih/olgu uydurma.
- "benzer arıza sayısı" söylerken sadece bağlamdaki sameFaultCount ve sameCategoryActionFormCount değerlerini esas al.
- Öneriler cihazın TEKİL SERİ NUMARALI geçmişine ve form kayıtlarına dayanmalı.
- Cobas® terminolojisini ve doğru menü/parça isimlerini kullan; Türkçeleştirme.
- Emin olmadığında bunu açıkça belirt, varsayım üretme.

Ek kurumsal rapor/yönergeler:
${FAULT_ANALYSIS_GUIDE}

Bağlam:
${JSON.stringify(context)}`;

  let lastDebug = 'gemini_no_attempt';
  for (const model of candidateGeminiModels()) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 3000,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      lastDebug = `gemini_http_${res.status}:${model}:${err.slice(0, 120)}`;
      if (res.status === 400 || res.status === 404) continue;
      return { debug: lastDebug };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      lastDebug = `gemini_empty_response:${model}`;
      continue;
    }

    const parsed = parseJsonFromModelText(text);
    if (!parsed) {
      lastDebug = `gemini_parse_failed:${model}`;
      continue;
    }

    return parsed;
  }

  return { debug: lastDebug };
}

async function loadDeviceHistoryBySerial(serial: string, reportId: string) {
  const snap = await adminDb.collection('deviceFaultReports').where('serial', '==', serial).orderBy('openedAt', 'desc').limit(120).get();

  const allForDevice: SimilarFaultSummary[] = snap.docs.map((d) => {
    const x = d.data() as any;
    return {
      id: d.id,
      model: x.model,
      serial: x.serial,
      faultName: x.faultName,
      faultType: x.faultType,
      status: x.status,
      description: x.description,
      closeDescription: x.closeDescription,
      openedAt: toIso(x.openedAt),
      closedAt: toIso(x.closedAt),
    };
  });

  return {
    currentDeviceFaults: allForDevice,
    otherFaultsOfSameDevice: allForDevice.filter((f) => f.id !== reportId),
  };
}

type SiblingDevice = {
  id: string;
  brand?: string;
  model?: string;
  cihazAdi?: string;
  seriNumarasi?: string;
  order?: number;
  arizaDurumu?: string;
};

async function loadSiblingDevicesInLab(hospitalId: string, currentDeviceId: string): Promise<SiblingDevice[]> {
  if (!hospitalId) return [];
  try {
    const snap = await adminDb.collection('devices').where('hospitalId', '==', hospitalId).get();
    const list: SiblingDevice[] = snap.docs
      .filter((d) => d.id !== currentDeviceId)
      .map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          brand: x.brand,
          model: x.model,
          cihazAdi: x.cihazAdi,
          seriNumarasi: x.seriNumarasi,
          order: typeof x.order === 'number' ? x.order : Number(x.order) || undefined,
          arizaDurumu: x.arizaDurumu,
        };
      });
    list.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
    return list;
  } catch (err) {
    console.error('Sibling devices alınamadı:', err);
    return [];
  }
}

type ActionFormSummary = {
  id: string;
  formType?: string;
  islemTuru?: string;
  faultName?: string;
  cihazDurumu?: string;
  cihazDurumuAciklama?: string;
  aciklama?: string;
  actions?: Array<{ type?: string; action?: string; stokAdi?: string; stokKodu?: string; description?: string; serialNumber?: string; removedPartStokAdi?: string; removedPartSerialNumber?: string }>;
  createdAt?: string | null;
};

async function loadActionFormsForDevice(deviceId: string): Promise<ActionFormSummary[]> {
  if (!deviceId) return [];
  try {
    const snap = await adminDb.collection('deviceActionForms').where('deviceId', '==', deviceId).get();
    const list: ActionFormSummary[] = snap.docs.map((d) => {
      const x = d.data() as any;
      return {
        id: d.id,
        formType: x.formType,
        islemTuru: x.islemTuru,
        faultName: x.faultName,
        cihazDurumu: x.cihazDurumu,
        cihazDurumuAciklama: x.cihazDurumuAciklama,
        aciklama: x.aciklama,
        actions: Array.isArray(x.actions) ? x.actions.slice(0, 8).map((a: any) => ({
          type: a.type,
          action: a.action,
          stokAdi: a.stokAdi,
          stokKodu: a.stokKodu,
          description: a.description,
          serialNumber: a.serialNumber,
          removedPartStokAdi: a.removedPartStokAdi,
          removedPartSerialNumber: a.removedPartSerialNumber,
        })) : undefined,
        createdAt: toIso(x.createdAt),
      };
    });
    list.sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });
    return list;
  } catch (err) {
    console.error('Action forms alınamadı:', err);
    return [];
  }
}

function summarizeActionForms(forms: ActionFormSummary[]): {
  teknikServisCount: number;
  aplikasyonCount: number;
  ariza: number;
  periyodik: number;
  kontrol: number;
  partChanges: number;
  recentTopics: string[];
} {
  let teknikServisCount = 0;
  let aplikasyonCount = 0;
  let ariza = 0;
  let periyodik = 0;
  let kontrol = 0;
  let partChanges = 0;
  const topicSet = new Set<string>();

  for (const f of forms) {
    if (f.formType === 'teknik_servis') teknikServisCount += 1;
    else if (f.formType === 'aplikasyon') aplikasyonCount += 1;
    if (f.islemTuru === 'ariza') ariza += 1;
    else if (f.islemTuru === 'periyodik_bakim') periyodik += 1;
    else if (f.islemTuru && f.islemTuru.includes('kontrol')) kontrol += 1;
    if (Array.isArray(f.actions)) {
      partChanges += f.actions.filter((a) => a.type === 'part_change' || a.type === 'hucre_degisimi').length;
    }
    if (f.faultName) topicSet.add(f.faultName);
  }
  return {
    teknikServisCount,
    aplikasyonCount,
    ariza,
    periyodik,
    kontrol,
    partChanges,
    recentTopics: Array.from(topicSet).slice(0, 8),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get('reportId');
    const forceRefresh = searchParams.get('force') === '1';

    if (!reportId) {
      return NextResponse.json({ success: false, error: 'reportId gerekli' }, { status: 400 });
    }

    const reportRef = adminDb.collection('deviceFaultReports').doc(reportId);
    const reportSnap = await reportRef.get();
    if (!reportSnap.exists) {
      return NextResponse.json({ success: false, error: 'Arıza kaydı bulunamadı' }, { status: 404 });
    }

    const report = reportSnap.data() as any;
    const serial = (report?.serial || '').trim();
    if (!serial) {
      return NextResponse.json({ success: false, error: 'Arıza kaydında seri numarası bulunamadı' }, { status: 400 });
    }

    const { text: masterDocText, sourcePath: masterDocPath } = await loadMasterKnowledgeDoc();

    const faultKeywords = tokenizeFaultKeywords(
      report?.faultName,
      report?.title,
      report?.description,
      report?.model,
    );
    const keywordSignature = faultKeywords.slice().sort().join(',');
    const knowledgeSignature = buildKnowledgeSignature(masterDocText, masterDocPath, keywordSignature);

    const cachedSuggestion = report?.aiSuggestion;
    const cacheVersionMatches = Number(cachedSuggestion?.cacheVersion || 0) === AI_SUGGESTION_CACHE_VERSION;
    const knowledgeMatches = (cachedSuggestion?.knowledgeSignature || '') === knowledgeSignature;
    if (!forceRefresh && cachedSuggestion && typeof cachedSuggestion === 'object' && cacheVersionMatches && knowledgeMatches) {
      return NextResponse.json({ success: true, cached: true, data: cachedSuggestion });
    }

    const docSelection = extractRelevantDocSections(masterDocText, faultKeywords, 90_000);

    const [{ otherFaultsOfSameDevice }, siblingDevices, deviceActionForms] = await Promise.all([
      loadDeviceHistoryBySerial(serial, reportId),
      loadSiblingDevicesInLab(report?.hospitalId || '', report?.deviceId || ''),
      loadActionFormsForDevice(report?.deviceId || ''),
    ]);

    const sameFaultGroup = otherFaultsOfSameDevice.filter((f) => (f.faultName || null) === (report.faultName || null) && (f.faultType || null) === (report.faultType || null));
    const sameCategoryForms = deviceActionForms.filter((f) => (f.faultName || null) === (report.faultName || null));
    const actionFormStats = summarizeActionForms(deviceActionForms);

    const closeNotes = await Promise.all(otherFaultsOfSameDevice.slice(0, 40).map(async (f) => {
      const historySnap = await adminDb.collection('deviceFaultReports').doc(f.id).collection('history').get();
      const closedEntry = historySnap.docs
        .map((d) => d.data() as any)
        .filter((x) => x.type === 'closed' && x.description)
        .sort((a, b) => (b.timestamp?._seconds || 0) - (a.timestamp?._seconds || 0))[0];

      return {
        id: f.id,
        openedAt: f.openedAt,
        faultName: f.faultName,
        faultType: f.faultType,
        description: f.description || '',
        closeDescription: f.closeDescription || closedEntry?.description || '',
        resolutionClass: classifyResolution(f.closeDescription || closedEntry?.description || ''),
      };
    }));

    const resolutionStats = closeNotes.reduce(
      (acc, note) => {
        acc[note.resolutionClass] += 1;
        return acc;
      },
      { kalici: 0, gecici: 0, belirsiz: 0 }
    );

    const context = {
      constraints: {
        deviceScopedBy: 'serial',
        serial,
        sameFaultCount: sameFaultGroup.length,
        totalPastFaultsForThisDevice: otherFaultsOfSameDevice.length,
        siblingDeviceCount: siblingDevices.length,
        actionFormCount: deviceActionForms.length,
        sameCategoryActionFormCount: sameCategoryForms.length,
      },
      currentFault: {
        id: reportId,
        model: report.model || null,
        serial,
        faultType: report.faultType || null,
        faultName: report.faultName || null,
        title: report.title || null,
        description: report.description || null,
        openedAt: toIso(report.openedAt),
        labName: report.labName || null,
        hospitalId: report.hospitalId || null,
      },
      siblingDevicesInSameLab: siblingDevices.slice(0, 30).map((s) => ({
        brand: s.brand || null,
        model: s.model || null,
        cihazAdi: s.cihazAdi || null,
        seriNumarasi: s.seriNumarasi || null,
        order: s.order ?? null,
        arizaDurumu: s.arizaDurumu || 'yok',
      })),
      sameFaultHistory: sameFaultGroup.slice(0, 20).map((f) => ({
        id: f.id,
        openedAt: f.openedAt,
        closedAt: f.closedAt,
        description: f.description,
        closeDescription: f.closeDescription,
      })),
      otherFaultHistorySameDevice: otherFaultsOfSameDevice.slice(0, 25).map((f) => ({
        id: f.id,
        faultName: f.faultName,
        faultType: f.faultType,
        openedAt: f.openedAt,
        description: f.description,
        closeDescription: f.closeDescription,
      })),
      actionFormStats,
      sameCategoryActionForms: sameCategoryForms.slice(0, 15).map((f) => ({
        id: f.id,
        formType: f.formType,
        islemTuru: f.islemTuru,
        faultName: f.faultName,
        cihazDurumu: f.cihazDurumu,
        cihazDurumuAciklama: f.cihazDurumuAciklama,
        aciklama: f.aciklama,
        actions: f.actions,
        createdAt: f.createdAt,
      })),
      recentActionForms: deviceActionForms.slice(0, 15).map((f) => ({
        id: f.id,
        formType: f.formType,
        islemTuru: f.islemTuru,
        faultName: f.faultName,
        cihazDurumu: f.cihazDurumu,
        aciklama: f.aciklama,
        actions: f.actions,
        createdAt: f.createdAt,
      })),
      closeNotes,
      resolutionStats,
      knowledgeDocs: [{
        name: 'Master Teknik Doküman',
        type: 'txt',
        source: masterDocPath,
        totalChars: masterDocText.length,
        keywordsUsed: faultKeywords,
        matchedSections: docSelection.matchedSections,
        topHeadings: docSelection.topHeadings,
        text: docSelection.excerpt,
      }],
    };

    const ai = await requestGeminiSuggestion(context);
    const aiIsUsable = hasUsableAiSuggestion(ai);
    const normalizedAi = aiIsUsable
      ? ai
      : buildDeterministicFallbackSuggestion({
          report,
          sameFaultGroup,
          closeNotes,
          resolutionStats,
          sameCategoryActionForms: sameCategoryForms,
          actionFormStats,
          docSelection,
          debug: ai?.debug,
        });

    const suggestionPayload = {
      ...normalizedAi,
      similarFaultStats: {
        total: otherFaultsOfSameDevice.length,
        sameModelCount: otherFaultsOfSameDevice.filter((f) => (f.model || null) === (report.model || null)).length,
        sameTitleCategoryCount: sameFaultGroup.length,
        resolvedCount: otherFaultsOfSameDevice.filter((f) => ['cozuldu', 'closed'].includes(f.status || '')).length,
        actionFormCount: deviceActionForms.length,
        sameCategoryActionFormCount: sameCategoryForms.length,
      },
      actionFormStats,
      resolutionStats,
      docMeta: {
        sourcePath: masterDocPath,
        totalChars: masterDocText.length,
        keywordsUsed: faultKeywords,
        matchedSections: docSelection.matchedSections,
        topHeadings: docSelection.topHeadings,
        excerptChars: docSelection.excerpt.length,
      },
      aiSource: aiIsUsable ? 'gemini' : 'fallback',
      aiDebug: aiIsUsable ? undefined : (ai?.debug || 'unknown'),
      generatedAt: new Date().toISOString(),
      cacheVersion: AI_SUGGESTION_CACHE_VERSION,
      scopeSerial: serial,
      knowledgeSignature,
    };

    await reportRef.update({
      aiSuggestion: suggestionPayload,
      aiSuggestionUpdatedAt: new Date(),
    });

    return NextResponse.json({ success: true, cached: false, data: suggestionPayload });
  } catch (error: any) {
    console.error('AI öneri oluşturma hatası:', error);
    return NextResponse.json({ success: false, error: error.message || 'AI öneri alınamadı' }, { status: 500 });
  }
}
