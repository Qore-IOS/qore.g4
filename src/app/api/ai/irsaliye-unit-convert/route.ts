import { NextRequest, NextResponse } from 'next/server';
import { generateWithGemini } from '@/lib/ai/geminiClient';

type ConvertItem = {
  stokKodu: string;
  stokAdi?: string;
  parsedQuantity: number;
  rawLine?: string;
  anaBirim?: string;
  ambalajDegeri?: number;
  sourceUnit?: string;
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
  try {
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
  } catch {
    return [];
  }
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
      sourceUnit: item.sourceUnit || '',
    }));

    const result = await generateWithGemini({
      systemPrompt: [
        'Sen Türkçe e-irsaliye birim dönüşüm motorusun.',
        'Görevin: faturadaki miktar+birimi, sistemin ana birimine mantıklı şekilde dönüştürmek.',
        'Sadece geçerli JSON dizisi döndür. Markdown yok.',
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            'Aşağıdaki satırlar için parsedQuantity (faturadaki sayı) ve sourceUnit (faturadaki birim) verildi.',
            'Sistem tarafında her ürün için anaBirim (örn. "Kutu", "Paket", "Adet") ve ambalajDegeri (örn. 25, 500) tanımlı.',
            '',
            'MANTIK KURALLARI:',
            '1) Eğer sourceUnit boşsa veya "ADET"/"AD" ise ve anaBirim KUTU/PAKET/KOLI ise:',
            '   - convertedQuantity = parsedQuantity / ambalajDegeri (mantıksal yuvarlama)',
            '   - Sayı bölünebilir ve büyükse (>= ambalajDegeri) bu doğru yorum.',
            '   - Örnek: ambalajDegeri=25, parsedQuantity=750 → 30 kutu.',
            '   - Örnek: ambalajDegeri=500, parsedQuantity=5000 → 10 kutu (çünkü 5000 adet 10 kutuya denk gelir).',
            '2) Eğer sourceUnit "KUTU"/"PAKET"/"KOLI" ise ve anaBirim aynıysa:',
            '   - convertedQuantity = parsedQuantity (dönüşüm uygulanmaz).',
            '   - Örnek: parsedQuantity=10, sourceUnit="KUTU", anaBirim="Kutu" → 10 kutu (bölme!).',
            '3) Eğer sayı ambalajDegeri\'den çok küçükse ve birim ADET değilse:',
            '   - Muhtemelen sayı zaten kutu/paket cinsindendir, bölme.',
            '   - Örnek: ambalajDegeri=500, parsedQuantity=5 → 5 kutu (çünkü 5 adet hiç mantıklı değil).',
            '4) convertedQuantity en az 1 olmalı.',
            '5) convertedUnit = anaBirim (sistem ana birimi).',
            '6) reasoning alanında kararını kısaca açıkla (Türkçe).',
            '',
            'JSON şema her öğe için:',
            '{ "stokKodu":"", "convertedQuantity":0, "convertedUnit":"", "sourceQuantity":0, "sourceUnitGuess":"", "reasoning":"" }',
            '',
            `Veri: ${JSON.stringify(compactItems)}`,
          ].join('\n'),
        },
      ],
      temperature: 0.1,
      maxOutputTokens: 1800,
    });

    const converted = extractJsonArray(result.text);
    return NextResponse.json({ converted, model: result.model });
  } catch (error: any) {
    console.error('AI unit conversion error:', error);
    return NextResponse.json({ error: error?.message || 'Dönüşüm yapılamadı.' }, { status: 500 });
  }
}
