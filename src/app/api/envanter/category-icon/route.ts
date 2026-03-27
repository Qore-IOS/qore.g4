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
    const categoryName = String(body?.categoryName || '').trim();

    if (!categoryName) {
      return NextResponse.json({ error: 'categoryName zorunludur.' }, { status: 400 });
    }

    const result = await generateWithGemini({
      systemPrompt:
        'Sen minimal ikon tasarımcısısın. Sadece SVG döndür. İkonlar 2-6 çizgilik, sade, tek renk #f59e0b stroke ile olmalı. Dolgu kullanma.',
      messages: [
        {
          role: 'user',
          content: `"${categoryName}" kategorisi için 96x96 viewBox'ta bir çizgi ikon üret. Kurallar: sadece bir adet <svg> döndür, arka plan olmasın, stroke-width 2.5, fill="none", round linecap ve linejoin kullan.`,
        },
      ],
      temperature: 0.2,
      maxOutputTokens: 600,
    });

    const iconSvg = normalizeSvg(result.text);
    return NextResponse.json({ iconSvg, model: result.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'İkon üretilemedi.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
