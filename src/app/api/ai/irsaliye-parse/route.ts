import { NextRequest, NextResponse } from 'next/server';
import { generateWithGemini } from '@/lib/ai/geminiClient';

type ParsedItem = {
  stokKodu: string;
  quantity: number;
  lot?: string;
  miad?: string;
  rawLine?: string;
};

function normalizeDate(value?: string): string | undefined {
  if (!value) return undefined;
  const m = value.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) return value;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${dd}.${mm}.${yyyy}`;
}

function extractJsonArray(raw: string): ParsedItem[] {
  const match = raw.match(/\[[\s\S]*\]/);
  const candidate = (match?.[0] ?? raw).replace(/```json|```/gi, '').trim();
  const parsed = JSON.parse(candidate);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((row: any) => ({
      stokKodu: String(row?.stokKodu || '').trim(),
      quantity: Math.max(0, Number(row?.quantity || 0)),
      lot: row?.lot ? String(row.lot).trim() : undefined,
      miad: normalizeDate(row?.miad ? String(row.miad) : undefined),
      rawLine: row?.rawLine ? String(row.rawLine) : undefined,
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
        'IMPORTANT: never confuse UTS Kodu with LOT.',
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            'Aşağıdaki irsaliye metninden ürün satırlarını çıkar.',
            'Sadece verilen ürün kodlarıyla eşleşen satırları döndür.',
            'Kolon başlıklarını dikkate al. UTS Kodu sütunu varsa LOT olarak alma.',
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

    const parsed = extractJsonArray(result.text);
    return NextResponse.json({ parsed, model: result.model });
  } catch (error: any) {
    console.error('AI irsaliye parse error:', error);
    return NextResponse.json({ error: error?.message || 'AI parse başarısız.' }, { status: 500 });
  }
}

