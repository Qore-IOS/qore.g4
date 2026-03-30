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

    const masterStylePrompt = [
      'Create a premium mobile app icon in a soft 3D glossy illustration style.',
      'Use rounded geometry, simplified forms, smooth volumetric gradients, polished plastic-like materials, cool blue and cyan color palette, subtle white highlights, and soft ambient contact shadows.',
      'The object should be shown in a front three-quarter view with a slight top-down angle.',
      'Use soft studio lighting from the top-left, gentle fill light, faint cool rim light, and a clean transparent background.',
      'The icon must feel modern, friendly, high-tech, minimal, and consistent with premium automotive or digital service app icons.',
      'No hard outlines, no photorealism, no clutter, no excessive detail, no dark dramatic shadows.',
    ].join(' ');

    const negativePrompt = [
      'no flat icon',
      'no line art',
      'no cartoon',
      'no hand-drawn style',
      'no low-poly',
      'no realistic photo',
      'no metallic industrial grime',
      'no dark background',
      'no hard shadows',
      'no black outlines',
      'no busy composition',
      'no text',
      'no watermark',
      'no excessive tiny details',
    ].join(', ');

    const result = await generateWithGemini({
      systemPrompt: [
        'You are an expert icon designer for inventory systems. Return only one valid SVG.',
        'Always design the icon semantically from category meaning, never by transforming a previous icon.',
        'Use this fixed style guide for consistency across the icon set:',
        masterStylePrompt,
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            `Create a "${categoryName}" icon in a premium soft 3D glossy app illustration style.`,
            'Semantic rule: main object must directly represent the category name (inventory context).',
            'Composition rules: 1 main object + optional 0-2 small supporting elements; keep it clean.',
            'Form rules: rounded corners, no sharp edges, low-to-medium detail, highly readable silhouette.',
            'Perspective rules: front three-quarter view, slight top-down angle, lightly right-facing by default.',
            'Material rules: smooth glossy plastic/acrylic feel with subtle specular highlights.',
            'Lighting rules: soft studio key light from top-left, gentle fill, faint cool rim light.',
            'Shadow rules: soft ambient contact shadow + short diffused drop shadow (blue-gray tint).',
            'Palette rules: cool blue/cyan dominant with optional subtle orange accent.',
            'Canvas rules: 1:1 icon, transparent background, object fills around 55-70% of canvas.',
            'Do not create abstract square/frame-only shapes.',
            `Negative prompt: ${negativePrompt}.`,
            'Output strictly one SVG only. No explanation, no markdown, no text in icon.',
          ].join(' '),
        },
      ],
      temperature: 0.45,
      maxOutputTokens: 1400,
    });

    const iconSvg = normalizeSvg(result.text);
    return NextResponse.json({ iconSvg, model: result.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'İkon üretilemedi.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
