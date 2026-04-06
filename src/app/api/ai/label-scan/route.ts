import { NextRequest, NextResponse } from 'next/server';
import { getGeminiApiKey } from '@/lib/ai/geminiClient';

export const runtime = 'nodejs';

interface ProductCandidate {
  stokKodu: string;
  stokAdi: string;
}

interface ParsedLabel {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  confidence: 'high' | 'medium' | 'low';
}

const SYSTEM_PROMPT = `Sen medikal ürün etiket okuma uzmanısın.

GÖREV:
- Kamera görüntüsündeki barkodsuz etiketten ürünü tespit et.
- Ürünü SADECE verilen ürün listesi içinden seç.
- LOT alanını bul (LOT, LOT NO, LOT NUMARASI vb.)
- Miad alanını bul (MIAD, SKT, STT, SON TUKETIM)
- Çıktıyı sadece JSON ver.

KURALLAR:
1) stokKodu mutlaka verilen listeden birebir bir kod olmalı.
2) stokAdi, seçilen ürünün listedeki adıyla aynı olmalı.
3) Lot okunamıyorsa boş string döndür.
4) Miadı DD.MM.YYYY formatına çevir. Emin değilsen boş string.
5) Eğer hiçbir ürünü güvenli tespit edemezsen stokKodu/stokAdi boş dön.

JSON ŞEMASI:
{
  "stokKodu": "",
  "stokAdi": "",
  "lotNumarasi": "",
  "miad": "",
  "confidence": "high|medium|low"
}`;

export async function POST(request: NextRequest) {
  try {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API anahtarı ayarlanmamış' }, { status: 500 });
    }

    const formData = await request.formData();
    const image = formData.get('image') as File | null;
    const productsRaw = String(formData.get('products') || '[]');
    const ocrText = String(formData.get('ocrText') || '');

    if (!image) {
      return NextResponse.json({ error: 'Görsel bulunamadı' }, { status: 400 });
    }

    let products: ProductCandidate[] = [];
    try {
      const parsed = JSON.parse(productsRaw);
      if (Array.isArray(parsed)) {
        products = parsed
          .map((p: any) => ({
            stokKodu: String(p?.stokKodu || '').trim(),
            stokAdi: String(p?.stokAdi || '').trim(),
          }))
          .filter((p) => p.stokKodu && p.stokAdi)
          .slice(0, 600);
      }
    } catch {
      return NextResponse.json({ error: 'Ürün listesi parse edilemedi' }, { status: 400 });
    }

    if (products.length === 0) {
      return NextResponse.json({ error: 'Ürün listesi boş' }, { status: 400 });
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const base64 = buffer.toString('base64');

    const productListForPrompt = products
      .map((p) => `- ${p.stokKodu} | ${p.stokAdi}`)
      .join('\n');

    const userPrompt = `Ürün listesi (yalnızca buradan seç):\n${productListForPrompt}\n\nEk OCR metni (varsa):\n${ocrText || '(yok)'}`;

    const contents = [{
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: image.type || 'image/jpeg',
            data: base64,
          },
        },
        { text: userPrompt },
      ],
    }];

    const models = ['gemini-2.5-flash-preview-05-20', 'gemini-2.0-flash', 'gemini-2.0-flash-001'];
    let lastError = 'unknown';

    for (const model of models) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: {
            temperature: 0.05,
            responseMimeType: 'application/json',
            maxOutputTokens: 2048,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        lastError = `${model}: HTTP ${res.status} ${errText.slice(0, 120)}`;
        continue;
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts
        ?.filter((p: any) => typeof p?.text === 'string')
        .map((p: any) => p.text)
        .join('')
        .trim();

      if (!rawText) {
        lastError = `${model}: empty response`;
        continue;
      }

      const parsed = safeJsonParse(rawText);
      if (!parsed) {
        lastError = `${model}: invalid json`;
        continue;
      }

      const stokKodu = String(parsed.stokKodu || '').trim();
      const matched = products.find((p) => p.stokKodu === stokKodu);

      const result: ParsedLabel = {
        stokKodu: matched?.stokKodu || '',
        stokAdi: matched?.stokAdi || '',
        lotNumarasi: sanitizeLot(String(parsed.lotNumarasi || parsed.lot || '')),
        miad: normalizeDateToTurkish(String(parsed.miad || parsed.skt || '')),
        confidence: normalizeConfidence(parsed.confidence),
      };

      return NextResponse.json({ success: true, parsed: result, model });
    }

    return NextResponse.json({ error: `Etiket AI parse başarısız: ${lastError}` }, { status: 500 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Bilinmeyen hata' }, { status: 500 });
  }
}

function safeJsonParse(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (block) {
      try {
        return JSON.parse(block.trim());
      } catch {
        return null;
      }
    }
    const obj = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!obj) return null;
    try {
      return JSON.parse(obj);
    } catch {
      return null;
    }
  }
}

function sanitizeLot(raw: string): string {
  return (raw || '').toUpperCase().replace(/[^A-Z0-9\-./]/g, '').slice(0, 50);
}

function normalizeConfidence(raw: unknown): 'high' | 'medium' | 'low' {
  const value = String(raw || '').toLowerCase();
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function normalizeDateToTurkish(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';

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
    const yy = m2[1];
    return `${dd}.${mm}.${yy}`;
  }

  const compact = s.replace(/[^\d]/g, '');
  if (/^\d{8}$/.test(compact)) {
    const dd = compact.slice(0, 2);
    const mm = compact.slice(2, 4);
    const yy = compact.slice(4, 8);
    return `${dd}.${mm}.${yy}`;
  }

  return '';
}
