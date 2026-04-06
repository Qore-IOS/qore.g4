import { NextRequest, NextResponse } from 'next/server';
import { generateWithGemini } from '@/lib/ai/geminiClient';

function normalizeSvg(raw: string): string {
  const trimmed = raw.trim();
  const svgMatch = trimmed.match(/<svg[\s\S]*<\/svg>/i);
  const svg = (svgMatch?.[0] ?? trimmed)
    .replace(/```svg/gi, '')
    .replace(/```/g, '')
    .trim();

  if (!svg.toLowerCase().startsWith('<svg') || !svg.toLowerCase().includes('</svg>')) {
    throw new Error('Model geçerli SVG döndürmedi.');
  }

  return svg
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const mainUnitName = String(body?.mainUnitName || '').trim();

    if (!mainUnitName) {
      return NextResponse.json({ error: 'mainUnitName zorunludur.' }, { status: 400 });
    }

    const result = await generateWithGemini({
      systemPrompt: [
        'You are a 3D soft-brush product unit illustrator.',
        'Return only one valid SVG with transparent background.',
        'Style: smooth rounded 3D, soft brush gradients, premium lab/inventory UI consistency.',
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            `Generate a single centered 3D soft-brush illustration that represents the Turkish inventory main unit: "${mainUnitName}".`,
            'If unit is box, render a 3D box. If bottle, render a 3D bottle. If petri, render a 3D petri dish.',
            'Keep object large, clean, and highly readable with soft shadow and glossy highlights.',
            'No text, no watermark, no background image, no frame. Output SVG only.',
          ].join(' '),
        },
      ],
      temperature: 0.35,
      maxOutputTokens: 1400,
    });

    const modelSvg = normalizeSvg(result.text);
    return NextResponse.json({ modelSvg, model: result.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Model üretilemedi.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
