import { NextRequest, NextResponse } from 'next/server';
import { getGeminiApiKey } from '@/lib/ai/geminiClient';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Extracted product item from AI vision analysis
 */
interface ExtractedProduct {
  urunAdi: string;
  katalogNo: string;
  lotNo: string;
  skt: string;
  seriNo: string;
  gtin: string;
  barkodVerisi: string;
  adet: number;
  confidence: 'high' | 'medium' | 'low';
}

const SYSTEM_PROMPT = `Sen bir medikal/laboratuvar ürün etiket ve barkod analiz uzmanısın. Roche Diagnostics, Elecsys, cobas gibi medikal kit etiketlerini mükemmel şekilde okursun.

## KRİTİK GÖREV
Fotoğraftaki TÜM ürünleri say ve her birinin etiket bilgilerini çıkar. HİÇBİR ÜRÜNÜ ATLAMA.

## SAYIM KURALLARI - ÇOK ÖNEMLİ
1. Önce fotoğraftaki TOPLAM fiziksel ürün sayısını belirle (kutu, şişe, kaset vb.)
2. Her ürünün etiketini oku. Etiket okunamıyorsa bile ürünü say.
3. Aynı üründen (aynı katalog no + aynı lot no) birden fazla varsa VE seri numaraları farklıysa -> her birini AYRI satır olarak listele
4. Aynı üründen birden fazla varsa AMA seri numaraları okunamıyorsa -> TEK satır olarak listele, "adet" alanına toplam sayıyı yaz
5. Uzaktan çekilmiş fotoğraflarda etiketler net okunamayabilir ama ürün SAYISI belirlenebilir. Sayıyı doğru ver, okunamayan bilgileri boş bırak.

## ETİKET BİLGİLERİ
Her üründen çıkarılacak alanlar:
- **urunAdi**: Ürün ismi (örn: "MG2, 200T, cobas c701/702", "ALB2 750T cobas c", "Elecsys TSH")
- **katalogNo**: Katalog/referans numarası (örn: "06407358190")
- **lotNo**: Lot/parti numarası (örn: "91695001")
- **skt**: Son kullanma tarihi -> MUTLAKA DD.MM.YYYY formatına çevir
- **seriNo**: LSN / seri numarası (örn: "000130796088"). HER ÜRÜNDEKİ FARKLI SERİ NUMARASINI OKU.
- **gtin**: GTIN numarası (14 haneli)
- **barkodVerisi**: 2D Data Matrix'ten okunan ham veri
- **adet**: Bu satırdaki ürün adedi. Seri numarası biliniyorsa 1, bilinmiyorsa sayılan toplam adet.

## TÜRKÇE ETİKET OKUMA
- "Son Kullanma Tarihi" veya "SKT" = skt
- "Lot no" veya "Lot No" = lotNo
- "Katalog No" = katalogNo
- "LSN" = seriNo (Lisans Seri Numarası)
- "Ürün adı" = urunAdi
- "GTIN" = gtin

## ÖZEL DURUMLAR
- Roche cobas kasetleri: Üstte uzun etiket, altta Data Matrix barkod bulunur
- Elecsys kutuları: Yan tarafta QR ve etiket bilgileri bulunur
- Kutu içinde sıralı dizilmiş ürünler: HER BİRİNİ ayrı say
- Etiket kısmen görünüyorsa: Görünen kısmı oku, confidence="low" yap
- Ürün sayılabilir ama etiket okunamıyorsa: Ürünü yine de listele, bilgileri boş bırak, adet'i doğru gir

## ÇIKTI FORMATI
SADECE JSON döndür:

{
  "totalPhysicalCount": 48,
  "products": [
    {
      "urunAdi": "MG2, 200T, cobas c701/702",
      "katalogNo": "06407358190",
      "lotNo": "91695001",
      "skt": "31.07.2027",
      "seriNo": "000130796088",
      "gtin": "04015630930821",
      "barkodVerisi": "",
      "adet": 1,
      "confidence": "high"
    },
    {
      "urunAdi": "MG2, 200T, cobas c701/702",
      "katalogNo": "06407358190",
      "lotNo": "91695001",
      "skt": "31.07.2027",
      "seriNo": "",
      "gtin": "",
      "barkodVerisi": "",
      "adet": 15,
      "confidence": "low"
    }
  ],
  "notes": "48 ürün sayıldı. 5 tanesinin etiketi net okundu, 15 tanesinin etiketi kısmen okundu, 28 tanesinin sadece ürün tipi belirlenebildi."
}`;

export async function POST(request: NextRequest) {
  try {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Gemini API anahtarı ayarlanmamış' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const images = formData.getAll('images') as File[];
    const enhanceResolution = formData.get('enhanceResolution') === 'true';

    if (!images || images.length === 0) {
      return NextResponse.json(
        { error: 'En az bir fotoğraf gönderilmelidir' },
        { status: 400 }
      );
    }

    // Convert images to base64 for Gemini Vision API
    const imageParts = await Promise.all(
      images.map(async (image) => {
        const buffer = Buffer.from(await image.arrayBuffer());
        const base64 = buffer.toString('base64');
        const mimeType = image.type || 'image/jpeg';
        return {
          inlineData: {
            data: base64,
            mimeType,
          },
        };
      })
    );

    // Build the user prompt - direct and action-oriented for speed
    const userPrompt = enhanceResolution
      ? `GÖREV: Bu fotoğraf(lar)daki TÜM medikal ürünleri say ve etiket bilgilerini çıkar.

ADIMLAR:
1. Fotoğraftaki toplam fiziksel ürün sayısını belirle
2. Okunabilen her etiketin bilgilerini çıkar (özellikle seri numaralarını)
3. Okunamayan ürünleri de sayıya dahil et, ürün tipini belirleyebildiğin kadarıyla grupla
4. Bulanık/uzak etiketleri zoom yaparak okumaya çalış, süper çözünürlük uygula

HER SERİ NUMARASINI TEK TEK OKU - aynı üründen 50 tane varsa 50 farklı seri numarasını oku.`
      : `GÖREV: Bu fotoğraf(lar)daki TÜM medikal ürünleri say ve etiket bilgilerini çıkar.

ADIMLAR:
1. Fotoğraftaki toplam fiziksel ürün sayısını belirle
2. Okunabilen her etiketin bilgilerini çıkar (özellikle seri numaralarını)
3. Okunamayan ürünleri de sayıya dahil et, ürün tipini belirleyebildiğin kadarıyla grupla

HER SERİ NUMARASINI TEK TEK OKU - aynı üründen 50 tane varsa 50 farklı seri numarasını oku.`;

    const contents = [
      {
        role: 'user',
        parts: [
          ...imageParts,
          { text: userPrompt },
        ],
      },
    ];

    const models = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-preview-05-20',
      'gemini-2.0-flash',
      'gemini-2.0-flash-001',
    ];
    let lastError = '';

    for (const model of models) {
      try {
        const generationConfig: Record<string, unknown> = {
          temperature: 0.05,
          maxOutputTokens: 65536,
          responseMimeType: 'application/json',
        };

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents,
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              generationConfig,
            }),
          }
        );

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          lastError = `${model}: HTTP ${res.status} - ${errText.slice(0, 200)}`;
          console.warn(`[bulk-barcode-scan] Model ${model} failed:`, lastError);
          if (res.status === 400 || res.status === 404 || res.status === 429) continue;
          throw new Error(lastError);
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts
          ?.filter((p: any) => typeof p?.text === 'string')
          .map((p: any) => p.text)
          .join('')
          .trim();

        if (!text) {
          lastError = `${model}: empty response`;
          continue;
        }

        // Parse the JSON response
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[1].trim());
          } else {
            const braceMatch = text.match(/\{[\s\S]*\}/);
            if (braceMatch) {
              parsed = JSON.parse(braceMatch[0]);
            } else {
              throw new Error('JSON parse edilemedi');
            }
          }
        }

        const products: ExtractedProduct[] = (parsed.products || []).map((p: any) => ({
          urunAdi: (p.urunAdi || p.urun_adi || '').trim(),
          katalogNo: (p.katalogNo || p.katalog_no || p.referansNo || '').trim(),
          lotNo: (p.lotNo || p.lot_no || p.lot || '').trim(),
          skt: normalizeDateToTurkish(p.skt || p.miad || p.sonKullanmaTarihi || ''),
          seriNo: (p.seriNo || p.seri_no || p.lsn || p.LSN || '').trim(),
          gtin: (p.gtin || p.GTIN || '').trim(),
          barkodVerisi: (p.barkodVerisi || p.barkod_verisi || '').trim(),
          adet: Math.max(1, parseInt(p.adet || p.quantity || '1') || 1),
          confidence: (['high', 'medium', 'low'].includes(p.confidence) ? p.confidence : 'medium') as 'high' | 'medium' | 'low',
        }));

        // Calculate reported total
        const reportedTotal = products.reduce((sum, p) => sum + p.adet, 0);

        return NextResponse.json({
          success: true,
          products,
          totalPhysicalCount: parsed.totalPhysicalCount || reportedTotal,
          totalDetected: reportedTotal,
          notes: parsed.notes || '',
          model,
        });
      } catch (modelErr: any) {
        lastError = modelErr.message || String(modelErr);
        continue;
      }
    }

    return NextResponse.json(
      { error: `Tüm modellerde başarısız oldu: ${lastError}` },
      { status: 500 }
    );
  } catch (err: any) {
    console.error('Bulk barcode scan error:', err);
    return NextResponse.json(
      { error: err.message || 'Beklenmeyen bir hata oluştu' },
      { status: 500 }
    );
  }
}

/**
 * Normalize various date formats to DD.MM.YYYY
 */
function normalizeDateToTurkish(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;

  const slashMatch = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (slashMatch) return `${slashMatch[1]}.${slashMatch[2]}.${slashMatch[3]}`;

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;

  if (/^\d{8}$/.test(s)) return `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}`;

  if (/^\d{6}$/.test(s)) {
    const yy = parseInt(s.slice(0, 2));
    const century = yy >= 70 ? '19' : '20';
    return `${s.slice(4, 6)}.${s.slice(2, 4)}.${century}${s.slice(0, 2)}`;
  }

  if (/^\d{4}$/.test(s)) return `01.${s.slice(0, 2)}.20${s.slice(2, 4)}`;

  return s;
}
