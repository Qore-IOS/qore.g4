import { NextRequest, NextResponse } from 'next/server';
import { generateWithGemini } from '@/lib/ai/geminiClient';
import { isApiKeyValid } from '@/lib/ai/config';

export const runtime = 'nodejs';
export const maxDuration = 15;

interface VoiceProduct {
  stokKodu: string;
  stokAdi: string;
}

interface VoiceAction {
  type: 'complete_count' | 'complete_brand' | 'next_brand' | 'go_to_brand';
  brand?: string;
}

interface ParsedCommand {
  stokKodu: string;
  stokAdedi?: number;
  cihazUstuAdedi?: number;
}

const SYSTEM_PROMPT = `Sen bir tıbbi laboratuvar envanter sayım asistanısın. Kullanıcı sesli olarak ürün sayımı yapıyor.

GÖREV:
1) Kullanıcının söylediği cümleden hangi ürünü kastettiğini ve sayım değerlerini çıkar.
2) Kullanıcı bir yönetim komutu verirse bunu "actions" alanında döndür.

KURALLAR:
- Kullanıcı ürünleri günlük kısa adlarıyla söyleyebilir (örn: "tsh" → "TSH Elecsys 300G")
- "stok" veya rakam = stok adedi (kutu/ambalaj sayısı)
- "cihaz üstü" veya "cihaz" veya "açık" = cihaz üstü test adedi
- Birden fazla ürün tek cümlede söylenebilir
- Sadece eşleşen ürünleri döndür, emin olmadığın ürünleri dahil etme
- Yönetim komutlarını da algıla:
  - "sayımı tamamla", "sayımı bitir" => complete_count
  - "marka sayımını tamamla", "markayı tamamla" => complete_brand
  - "diğer markaya geç", "sonraki markaya geç" => next_brand
  - "x markaya geç", "x marka" => go_to_brand (brand alanına marka adını yaz)

YANIT FORMATI: Sadece JSON object döndür, başka bir şey yazma.
{
  "commands": [{"stokKodu": "...", "stokAdedi": 3, "cihazUstuAdedi": 750}],
  "actions": [{"type":"go_to_brand","brand":"Roche"}]
}

- stokAdedi belirtilmediyse alanı dahil etme
- cihazUstuAdedi belirtilmediyse alanı dahil etme
- Hiçbir ürün eşleşemediyse commands boş array olmalı
- Hiçbir komut yoksa actions boş array olmalı`;

export async function POST(request: NextRequest) {
  try {
    if (!isApiKeyValid) {
      return NextResponse.json({ error: 'API anahtarı ayarlanmamış' }, { status: 500 });
    }

    const body = await request.json();
    const { transcript, products, brands } = body as {
      transcript: string;
      products: VoiceProduct[];
      brands?: string[];
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

    const brandListStr = (brands ?? []).join(', ');

    const userMessage = `ÜRÜN LİSTESİ:
${productListStr}

MARKA LİSTESİ:
${brandListStr || '(boş)'}

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
    let parsedCommands: ParsedCommand[] = [];
    let parsedActions: VoiceAction[] = [];
    try {
      // Extract JSON object from response (handle markdown code blocks)
      let jsonStr = result.text;
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      const parsedObj = JSON.parse(jsonStr) as {
        commands?: ParsedCommand[];
        actions?: VoiceAction[];
      };
      parsedCommands = Array.isArray(parsedObj.commands) ? parsedObj.commands : [];
      parsedActions = Array.isArray(parsedObj.actions) ? parsedObj.actions : [];
    } catch {
      // If parsing fails, return empty
      parsedCommands = [];
      parsedActions = [];
    }

    // Validate: only return products that exist in the provided list
    const validKodlar = new Set(products.map(p => p.stokKodu));
    parsedCommands = parsedCommands.filter(cmd => validKodlar.has(cmd.stokKodu));

    const validActions = new Set(['complete_count', 'complete_brand', 'next_brand', 'go_to_brand']);
    parsedActions = parsedActions.filter(action => validActions.has(action.type));

    return NextResponse.json({ commands: parsedCommands, actions: parsedActions, model: result.model });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
