import { NextRequest, NextResponse } from 'next/server';
import { generateWithGemini } from '@/lib/ai/geminiClient';

type ParsedItem = {
  stokKodu: string;
  quantity: number;
  lot?: string;
  miad?: string;
  rawLine?: string;
};

function looksLikeUtsCode(value?: string): boolean {
  if (!value) return false;
  return /^\d{11,16}$/.test(value.replace(/\s+/g, ''));
}

function normalizeToken(value?: string): string | undefined {
  if (!value) return undefined;
  const token = value
    .trim()
    .replace(/[|;,]+/g, ' ')
    .match(/\b([A-Za-z0-9-]{3,})\b/)?.[1];
  return token ? token.toUpperCase() : undefined;
}

function isLikelyLotToken(value?: string): boolean {
  if (!value) return false;
  return value.length >= 3 && !looksLikeUtsCode(value);
}

function extractLotFromRawLine(rawLine?: string, stokKodu?: string): string | undefined {
  if (!rawLine) return undefined;
  const dateMatch = rawLine.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/);
  if (!dateMatch || dateMatch.index == null) return undefined;

  const beforeDate = rawLine.slice(0, dateMatch.index).trim();
  const tokens = beforeDate.split(/\s+/).map((t) => normalizeToken(t)).filter((t): t is string => !!t);
  if (tokens.length === 0) return undefined;

  for (let i = tokens.length - 1; i >= 0; i--) {
    const candidate = tokens[i];
    if (!candidate) continue;
    if (stokKodu && candidate === stokKodu.toUpperCase()) continue;
    if (/^(ADET|KUTU|PAKET|KOLI|PCS|EA|BOX|BIRIM)$/i.test(candidate)) continue;
    if (!isLikelyLotToken(candidate)) continue;
    return candidate;
  }
  return undefined;
}

function normalizeDate(value?: string): string | undefined {
  if (!value) return undefined;
  const m = value.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) return value;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${dd}.${mm}.${yyyy}`;
}

function extractJsonArray(raw: string, hasLotHeader: boolean): ParsedItem[] {
  const match = raw.match(/\[[\s\S]*\]/);
  const candidate = (match?.[0] ?? raw).replace(/```json|```/gi, '').trim();
  const parsed = JSON.parse(candidate);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((row: any) => ({
      stokKodu: String(row?.stokKodu || '').trim(),
      quantity: Math.max(0, Number(row?.quantity || 0)),
      lot: normalizeToken(row?.lot ? String(row.lot) : undefined),
      miad: normalizeDate(row?.miad ? String(row.miad) : undefined),
      rawLine: row?.rawLine ? String(row.rawLine) : undefined,
    }))
    .map((row: ParsedItem) => ({
      ...row,
      lot: (() => {
        if (!hasLotHeader) return undefined;
        const rawLineLot = extractLotFromRawLine(row.rawLine, row.stokKodu);
        // Strong rule: prefer LOT inferred from the row segment before MIAD (table order),
        // otherwise use AI lot if it is not UTS-like.
        if (rawLineLot) return rawLineLot;
        if (!isLikelyLotToken(row.lot)) return undefined;
        return row.lot;
      })(),
    }))
    .filter((row: ParsedItem) => row.stokKodu && row.quantity > 0);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = String(body?.text || '');
    const productCodes = Array.isArray(body?.productCodes) ? body.productCodes : [];

    if (!text.trim()) {
      return NextResponse.json({ error: 'text zorunludur.' }, { status: 400 });
    }
    if (productCodes.length === 0) {
      return NextResponse.json({ error: 'productCodes zorunludur.' }, { status: 400 });
    }

    const hasLotHeader = /\b(lot|parti|batch)\b/i.test(text);

    const compactProducts = productCodes
      .slice(0, 2500)
      .map((p: any) => ({
        stokKodu: String(p?.stokKodu || '').trim(),
        stokAdi: String(p?.stokAdi || '').trim(),
      }))
      .filter((p: any) => p.stokKodu);

    const result = await generateWithGemini({
      systemPrompt: [
        'You are a Turkish e-irsaliye parser.',
        'Return ONLY JSON array, no markdown.',
        'Use table headers to map correct columns.',
        'IMPORTANT: LOT must be read only from the LOT/Parti/Batch column header.',
        'IMPORTANT: never confuse UTS Kodu with LOT.',
        'IMPORTANT: Use table row/column boundaries (cell alignment) even when column widths vary.',
        'IMPORTANT: Never extract LOT from Stok Adı text fragments.',
        'If LOT column is missing or unreadable, return lot as empty/undefined.',
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            'Aşağıdaki irsaliye metninden ürün satırlarını çıkar.',
            'Sadece verilen ürün kodlarıyla eşleşen satırları döndür.',
            'Kolon başlıklarını dikkate al. LOT değeri sadece LOT sütunundan alınmalı.',
            'UTS Kodu sütunu varsa asla LOT olarak alma.',
            'Sütun genişlikleri markaya göre değişebilir; satır/sütun hizasına göre LOT hücresini bul.',
            'Stok adı içindeki parça metinleri LOT olarak alma.',
            'Miad/SKT tarihini dd.MM.yyyy formatında döndür.',
            'quantity satırdaki miktar olsun.',
            'JSON şema: [{ "stokKodu": "...", "quantity": 0, "lot": "...", "miad": "...", "rawLine": "..." }]',
            `Ürünler: ${JSON.stringify(compactProducts)}`,
            `İrsaliye metni:\n${text}`,
          ].join('\n'),
        },
      ],
      temperature: 0.1,
      maxOutputTokens: 2400,
    });

    const parsed = extractJsonArray(result.text, hasLotHeader);
    return NextResponse.json({ parsed, model: result.model });
  } catch (error: any) {
    console.error('AI irsaliye parse error:', error);
    return NextResponse.json({ error: error?.message || 'AI parse başarısız.' }, { status: 500 });
  }
}
