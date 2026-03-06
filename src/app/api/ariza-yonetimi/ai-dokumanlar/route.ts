import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

type ParsedDocument = {
  text: string;
  type: 'txt' | 'pdf';
};

function sanitizeText(text: string): string {
  return text
    .replace(/\u0000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function candidateGeminiModels(): string[] {
  const fromEnv = [
    process.env.GEMINI_MODEL,
    process.env.GOOGLE_GENAI_MODEL,
    process.env.NEXT_PUBLIC_GEMINI_MODEL,
  ].filter(Boolean) as string[];

  const defaults = ['gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-1.5-flash-latest', 'gemini-1.5-flash'];
  return Array.from(new Set([...fromEnv, ...defaults]));
}

async function extractPdfTextWithGemini(buffer: Buffer): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('PDF okumak için Gemini API anahtarı gerekli.');
  }

  const base64 = buffer.toString('base64');
  let lastError = 'gemini_pdf_extract_failed';

  for (const model of candidateGeminiModels()) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Bu PDF içeriğindeki metni Türkçe karakterleri koruyarak düz metin olarak çıkar. Özetleme yapma, sadece içerik metnini döndür.' },
            { inline_data: { mime_type: 'application/pdf', data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 8192 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      lastError = `gemini_pdf_http_${res.status}:${model}:${errText.slice(0, 150)}`;
      if (res.status === 400 || res.status === 404) continue;
      continue;
    }

    const payload = await res.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text && typeof text === 'string' && text.trim()) return text;
  }

  throw new Error(`PDF metni çıkarılamadı (${lastError}).`);
}

async function parseFile(file: File): Promise<ParsedDocument> {
  const lowerName = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();

  if (mime.includes('text/plain') || lowerName.endsWith('.txt')) {
    const text = sanitizeText(await file.text());
    return { text, type: 'txt' };
  }

  if (mime.includes('pdf') || lowerName.endsWith('.pdf')) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = sanitizeText(await extractPdfTextWithGemini(buffer));
    return { text, type: 'pdf' };
  }

  throw new Error('Sadece .txt veya .pdf yükleyebilirsiniz.');
}

export async function GET() {
  try {
    const snap = await adminDb.collection('aiSuggestionDocs').orderBy('updatedAt', 'desc').limit(50).get();
    const data = snap.docs.map((d) => {
      const x = d.data() as any;
      return {
        id: d.id,
        name: x.name || 'Doküman',
        type: x.type || 'txt',
        active: !!x.active,
        charCount: x.charCount || 0,
        updatedAt: x.updatedAt?.toDate ? x.updatedAt.toDate().toISOString() : null,
      };
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Dokümanlar alınamadı.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file alanı gerekli.' }, { status: 400 });
    }

    const { text, type } = await parseFile(file);
    if (!text) {
      return NextResponse.json({ success: false, error: 'Dokümandan okunabilir metin çıkarılamadı.' }, { status: 400 });
    }

    const maxChars = 120_000;
    const clipped = text.slice(0, maxChars);

    const ref = await adminDb.collection('aiSuggestionDocs').add({
      name: file.name || 'Doküman',
      type,
      text: clipped,
      active: true,
      charCount: clipped.length,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({ success: true, data: { id: ref.id, name: file.name, type, charCount: clipped.length } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Doküman yüklenemedi.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'id gerekli.' }, { status: 400 });
    }

    await adminDb.collection('aiSuggestionDocs').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Doküman silinemedi.' }, { status: 500 });
  }
}
