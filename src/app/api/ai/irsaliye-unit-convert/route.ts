import { NextRequest, NextResponse } from 'next/server';
import { generateWithGemini } from '@/lib/ai/geminiClient';

type ConvertItem = {
  stokKodu: string;
  stokAdi?: string;
  parsedQuantity: number;
  rawLine?: string;
  anaBirim?: string;
  ambalajDegeri?: number;
};

type ConvertResult = {
  stokKodu: string;
  convertedQuantity: number;
  convertedUnit: string;
  sourceQuantity: number;
  sourceUnitGuess: string;
  reasoning: string;
};

function extractJsonArray(raw: string): ConvertResult[] {
  const trimmed = raw.trim();
  const match = trimmed.match(/\[[\s\S]*\]/);
  const candidate = (match?.[0] ?? trimmed).replace(/```json|```/gi, '').trim();
  const parsed = JSON.parse(candidate);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item: any) => ({
      stokKodu: String(item?.stokKodu || ''),
      convertedQuantity: Math.max(0, Number(item?.convertedQuantity || 0)),
      convertedUnit: String(item?.convertedUnit || ''),
      sourceQuantity: Math.max(0, Number(item?.sourceQuantity || 0)),
      sourceUnitGuess: String(item?.sourceUnitGuess || ''),
      reasoning: String(item?.reasoning || ''),
    }))
    .filter((item: ConvertResult) => !!item.stokKodu && item.convertedQuantity > 0);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? (body.items as ConvertItem[]) : [];
    if (items.length === 0) {
      return NextResponse.json({ error: 'items zorunludur.' }, { status: 400 });
    }

    const compactItems = items.map((item) => ({
      stokKodu: item.stokKodu,
      stokAdi: item.stokAdi || '',
      parsedQuantity: Number(item.parsedQuantity || 0),
      rawLine: item.rawLine || '',
      anaBirim: item.anaBirim || '',
      ambalajDegeri: Number(item.ambalajDegeri || 0),
    }));

    const result = await generateWithGemini({
      systemPrompt: [
        'You are an inventory unit-conversion engine for Turkish e-irsaliye parsing.',
        'Return ONLY a valid JSON array.',
        'Goal: convert invoice quantity to system main unit quantity.',
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            'Elindeki her satır için parsedQuantity değerini sistem ana birimine dönüştür.',
            'Kurallar:',
            '1) Eğer anaBirim paket/kutu gibi ambalaj birimi ise ve satırda ADET geçiyorsa, convertedQuantity = parsedQuantity / ambalajDegeri (tam sayıya en yakın mantıklı değer).',
            '2) Eğer dönüşüm net değilse parsedQuantity değerini koru.',
            '3) convertedQuantity 1’den küçükse 1 yap.',
            '4) Sonuç JSON array olmalı ve her öğe şu alanlara sahip olmalı:',
            'stokKodu, convertedQuantity, convertedUnit, sourceQuantity, sourceUnitGuess, reasoning.',
            `Veri: ${JSON.stringify(compactItems)}`,
          ].join('\n'),
        },
      ],
      temperature: 0.1,
      maxOutputTokens: 1200,
    });

    const converted = extractJsonArray(result.text);
    return NextResponse.json({ converted, model: result.model });
  } catch (error: any) {
    console.error('AI unit conversion error:', error);
    return NextResponse.json({ error: error?.message || 'Dönüşüm yapılamadı.' }, { status: 500 });
  }
}

