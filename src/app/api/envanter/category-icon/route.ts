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
        [
          'Sen premium UI ikon tasarımcısısın ve sadece SVG döndürürsün.',
          'İkon dili: turkuvaz + turuncu aksanlı, yarı-gerçekçi 3D, yumuşak gölge ve gradient efektli.',
          'Kategori adının anlamına uygun nesne üret; asla rastgele kare/çerçeve/soyut ikon üretme.',
          'Kalın çizgi ikon üretme; dolgu, gradient, highlight ve depth kullan.',
          'Tasarım temiz olmalı: tek obje, beyaz/transparent arka plan, kart içinde taşma yok.',
          'Perspektif: hafif izometrik/3-çeyrek açı (front flat görünüm verme).',
          'Sadece tek bir <svg> döndür, açıklama/metin/markdown döndürme.',
        ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            `"${categoryName}" kategorisi için 128x128 viewBox'ta premium bir SVG ikon üret.`,
            'Kurallar:',
            '- Renk paleti: turkuvaz/cyan tonları + turuncu vurgu (ör: #06b6d4, #0ea5e9, #2563eb, #f59e0b).',
            '- 3D hissi ver: linear/radial gradient, yumuşak iç-dış gölge (filter), hafif parlama.',
            '- İkon kategoriyle semantik olarak eşleşsin (örn. buzdolabı→dolap/soğutucu, kamera→kamera gövdesi, terazi→terazi objesi).',
            '- Mevcut ikonu dönüştürmeye çalışma; kategori için sıfırdan yeni obje tasarla.',
            '- Düz/çizgisel frame ikonlarından kaçın; merkezi nesne belirgin olsun.',
            '- Perspektif: hafif açılı (isometric 3/4), daha gerçekçi görünüm.',
            '- İkon gerçekçi ama sade olsun; görseldeki modern paket/servis ikonları diline benzesin.',
            '- Arka plan shape kullanma, sadece ikon objesi olsun.',
            '- SVG güvenli ve render edilebilir olsun (defs/linearGradient/filter kullanılabilir).',
            '- Sadece tek bir <svg> döndür.',
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
