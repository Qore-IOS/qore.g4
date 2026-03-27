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

interface ProductMatchContext {
  stokKodu: string;
  stokAdi: string;
  aliases: string[];
}

function normalizeForMatch(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string): string {
  return normalizeForMatch(value).replace(/\s+/g, '');
}

function consonantSkeleton(value: string): string {
  return compact(value).replace(/[aeiou]/g, '');
}

function buildProductAliasContext(products: VoiceProduct[]): ProductMatchContext[] {
  return products.map(product => {
    const aliasSet = new Set<string>();
    const stokAdiNorm = normalizeForMatch(product.stokAdi);
    const stokKoduNorm = normalizeForMatch(product.stokKodu);
    const stokAdiCompact = compact(product.stokAdi);
    const stokKoduCompact = compact(product.stokKodu);

    if (stokAdiNorm) aliasSet.add(stokAdiNorm);
    if (stokKoduNorm) aliasSet.add(stokKoduNorm);
    if (stokAdiCompact) aliasSet.add(stokAdiCompact);
    if (stokKoduCompact) aliasSet.add(stokKoduCompact);

    const words = stokAdiNorm.split(' ').filter(Boolean);
    words.forEach(w => {
      if (w.length >= 3) aliasSet.add(w);
      aliasSet.add(consonantSkeleton(w));
    });

    const initials = words.map(w => w[0]).join('');
    if (initials.length >= 2) aliasSet.add(initials);

    if (words.length >= 2) {
      const wordPrefixes = words.map(w => w.slice(0, 3)).join('');
      if (wordPrefixes.length >= 4) aliasSet.add(wordPrefixes);
      const noSpace = words.join('');
      if (noSpace.length >= 4) aliasSet.add(noSpace);
      aliasSet.add(consonantSkeleton(noSpace));
    }

    // Numeric/alpha variations for codes like "MG2", "CMV IgG", etc.
    const alphaOnlyCode = stokKoduCompact.replace(/[0-9]/g, '');
    const digitOnlyCode = stokKoduCompact.replace(/[a-z]/g, '');
    if (alphaOnlyCode.length >= 2) aliasSet.add(alphaOnlyCode);
    if (digitOnlyCode.length > 0 && alphaOnlyCode.length >= 2) {
      aliasSet.add(`${alphaOnlyCode} ${digitOnlyCode}`);
    }

    const sanitizedAliases = Array.from(aliasSet)
      .filter(a => a && a.length >= 2)
      .slice(0, 16);

    return {
      stokKodu: product.stokKodu,
      stokAdi: product.stokAdi,
      aliases: sanitizedAliases,
    };
  });
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
- Kullanıcı test adını farklı telaffuz/abreviasyonla söyleyebilir; ürün için verilen "alias" anahtarlarını aktif kullan
- Telaffuz farklı olsa bile en yakın kit/test eşleşmesini bulmaya çalış (örn. harf düşmesi, birleşik söyleyiş, kısaltma)
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

    const productContexts = buildProductAliasContext(products);

    // Build product list context with alias map for stronger spoken matching
    const productListStr = productContexts
      .map(p => `${p.stokKodu} | ${p.stokAdi} | alias: ${p.aliases.join(', ')}`)
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
