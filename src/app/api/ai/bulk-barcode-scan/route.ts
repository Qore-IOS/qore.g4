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
  confidence: 'high' | 'medium' | 'low';
}

const SYSTEM_PROMPT = `Sen bir medikal ürün etiket ve barkod analiz uzmanısın. Görevin, fotoğraflardaki medikal/laboratuvar ürünlerinin etiketlerini ve 2D Data Matrix / QR barkodlarını analiz edip yapısal veri çıkarmak.

## Görev
Gönderilen fotoğraf(lar)daki TÜM ürün etiketlerini tespit et ve her birinden aşağıdaki bilgileri çıkar:

1. **Ürün Adı** (urunAdi): Etiket üzerindeki ürün ismi (örn: "MG2, 200T, cobas c701/702", "ALB2 750T cobas c")
2. **Katalog No** (katalogNo): Ürün katalog/referans numarası (örn: "06407358190", "05168861190")
3. **Lot No** (lotNo): Lot/parti numarası (örn: "91695001", "90854301")
4. **SKT / Miad** (skt): Son kullanma tarihi, DD.MM.YYYY formatında normalize et (örn: "31.07.2027", "30.11.2026")
5. **Seri No / LSN** (seriNo): LSN (Lisans Seri Numarası) veya seri numarası (örn: "000130796088", "0200480001184")
6. **GTIN** (gtin): GTIN numarası varsa (örn: "04015630930821")
7. **Barkod Verisi** (barkodVerisi): 2D Data Matrix veya QR koddan okunan ham veri (decode edilebilirse)

## Kurallar
- Fotoğrafta birden fazla ürün varsa HER BİRİ için ayrı bir obje döndür.
- Türkçe etiketlerde: "Son Kullanma Tarihi" veya "SKT" = skt, "Lot no" = lotNo, "Katalog No" = katalogNo, "LSN" = seriNo
- Tarih formatlarını her zaman DD.MM.YYYY'ye dönüştür (YYMMDD, MMYY vb. formatları normalize et)
- GTIN genellikle "01" AI (Application Identifier) ile başlar, 14 haneli sayıdır
- Eğer bir alan etiket üzerinde okunamıyor veya yoksa boş string ("") döndür
- confidence alanı: "high" = net okunabiliyor, "medium" = kısmen okunabiliyor, "low" = tahmin
- Uzaktan çekilmiş fotoğraflarda birçok ürün olabilir, her birini ayrı ayrı tespit et
- Yakından çekilmiş fotoğraflarda etiket detaylarını tam oku
- Bulanık veya kısmen görünen etiketlerde en iyi tahmini yap ve confidence'ı "low" olarak işaretle
- Aynı üründen birden fazla varsa (aynı lot, aynı skt) bile her birini ayrı listele VEYA toplu olarak belirt

## Çıktı Formatı
Yanıtını SADECE aşağıdaki JSON formatında ver, başka hiçbir açıklama ekleme:

\`\`\`json
{
  "products": [
    {
      "urunAdi": "...",
      "katalogNo": "...",
      "lotNo": "...",
      "skt": "...",
      "seriNo": "...",
      "gtin": "...",
      "barkodVerisi": "...",
      "confidence": "high|medium|low"
    }
  ],
  "totalDetected": 5,
  "notes": "Ek notlar (opsiyonel)"
}
\`\`\``;

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

    // Build the request with vision capabilities
    const userPrompt = enhanceResolution
      ? 'Bu fotoğraf(lar)daki tüm medikal ürün etiketlerini ve barkodlarını analiz et. Bulanık veya uzak etiketler için süper çözünürlük tekniği uygulayarak en iyi sonucu elde etmeye çalış. Her ürün için yapısal veri çıkar.'
      : 'Bu fotoğraf(lar)daki tüm medikal ürün etiketlerini ve barkodlarını analiz et. Her ürün için yapısal veri çıkar.';

    const contents = [
      {
        role: 'user',
        parts: [
          ...imageParts,
          { text: userPrompt },
        ],
      },
    ];

    // Use gemini-2.0-flash for vision - it has excellent multimodal capabilities
    const models = ['gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-1.5-flash-latest'];
    let lastError = '';

    for (const model of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents,
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8192,
                responseMimeType: 'application/json',
              },
            }),
          }
        );

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          lastError = `${model}: HTTP ${res.status} - ${errText.slice(0, 200)}`;
          if (res.status === 400 || res.status === 404) continue;
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
          // Try direct JSON parse first
          parsed = JSON.parse(text);
        } catch {
          // Try extracting JSON from markdown code block
          const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[1].trim());
          } else {
            // Try finding JSON object in the text
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
          confidence: (['high', 'medium', 'low'].includes(p.confidence) ? p.confidence : 'medium') as 'high' | 'medium' | 'low',
        }));

        return NextResponse.json({
          success: true,
          products,
          totalDetected: parsed.totalDetected || products.length,
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

  // Already in DD.MM.YYYY format
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;

  // DD/MM/YYYY or DD-MM-YYYY
  const slashMatch = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (slashMatch) return `${slashMatch[1]}.${slashMatch[2]}.${slashMatch[3]}`;

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;

  // YYYYMMDD
  if (/^\d{8}$/.test(s)) return `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}`;

  // YYMMDD
  if (/^\d{6}$/.test(s)) {
    const yy = parseInt(s.slice(0, 2));
    const century = yy >= 70 ? '19' : '20';
    return `${s.slice(4, 6)}.${s.slice(2, 4)}.${century}${s.slice(0, 2)}`;
  }

  // MMYY
  if (/^\d{4}$/.test(s)) return `01.${s.slice(0, 2)}.20${s.slice(2, 4)}`;

  return s;
}
