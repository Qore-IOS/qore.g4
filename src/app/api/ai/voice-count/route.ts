import { NextRequest, NextResponse } from 'next/server';
import { generateWithGemini } from '@/lib/ai/geminiClient';
import { isApiKeyValid } from '@/lib/ai/config';

export const runtime = 'nodejs';
export const maxDuration = 15;

interface VoiceProduct {
  stokKodu: string;
  stokAdi: string;
}

interface ParsedCommand {
  stokKodu: string;
  stokAdedi?: number;
  cihazUstuAdedi?: number;
}

const SYSTEM_PROMPT = `Sen bir tıbbi laboratuvar envanter sayım asistanısın. Kullanıcı sesli olarak ürün sayımı yapıyor.

GÖREV: Kullanıcının söylediği cümleden hangi ürünü kastettiğini ve sayım değerlerini çıkar.

KURALLAR:
- Kullanıcı ürünleri günlük kısa adlarıyla söyleyebilir (örn: "tsh" → "TSH Elecsys 300G")
- "stok" veya rakam = stok adedi (kutu/ambalaj sayısı)
- "cihaz üstü" veya "cihaz" veya "açık" = cihaz üstü test adedi
- Birden fazla ürün tek cümlede söylenebilir
- Sadece eşleşen ürünleri döndür, emin olmadığın ürünleri dahil etme

YANIT FORMATI: Sadece JSON array döndür, başka bir şey yazma.
[{"stokKodu": "...", "stokAdedi": 3, "cihazUstuAdedi": 750}]

- stokAdedi belirtilmediyse alanı dahil etme
- cihazUstuAdedi belirtilmediyse alanı dahil etme
- Hiçbir ürün eşleşemediyse boş array döndür: []`;

export async function POST(request: NextRequest) {
  try {
    if (!isApiKeyValid) {
      return NextResponse.json({ error: 'API anahtarı ayarlanmamış' }, { status: 500 });
    }

    const body = await request.json();
    const { transcript, products } = body as {
      transcript: string;
      products: VoiceProduct[];
    };

    if (!transcript?.trim()) {
      return NextResponse.json({ error: 'Transkript boş' }, { status: 400 });
    }

    if (!products?.length) {
      return NextResponse.json({ error: 'Ürün listesi boş' }, { status: 400 });
    }

    // Build product list context - keep it compact for speed
    const productListStr = products
      .map(p => `${p.stokKodu} | ${p.stokAdi}`)
      .join('\n');

    const userMessage = `ÜRÜN LİSTESİ:
${productListStr}

KULLANICININ SÖYLEDİĞİ:
"${transcript.trim()}"

JSON sonuç:`;

    const result = await generateWithGemini({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      temperature: 0.05,
      maxOutputTokens: 512,
    });

    // Parse JSON from response
    let parsed: ParsedCommand[] = [];
    try {
      // Extract JSON array from response (handle markdown code blocks)
      let jsonStr = result.text;
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) parsed = [];
    } catch {
      // If parsing fails, return empty
      parsed = [];
    }

    // Validate: only return products that exist in the provided list
    const validKodlar = new Set(products.map(p => p.stokKodu));
    parsed = parsed.filter(cmd => validKodlar.has(cmd.stokKodu));

    return NextResponse.json({ commands: parsed, model: result.model });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
