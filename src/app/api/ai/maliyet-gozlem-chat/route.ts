import { NextRequest, NextResponse } from 'next/server';
import { generateWithGemini, type GeminiMessage } from '@/lib/ai/geminiClient';
import { aiLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_CONTEXT_CHARS = 24000;
const MAX_HISTORY_ITEMS = 8;

function compactJson(value: unknown): string {
  const text = JSON.stringify(value ?? {}, null, 2);
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  return `${text.slice(0, MAX_CONTEXT_CHARS)}\n... [context kısaltıldı; panel özetleri ve en yüksek etki kalemleri korunarak gönderildi]`;
}

function sanitizeHistory(history: unknown): GeminiMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const role = record.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof record.content === 'string' ? record.content : '';
      return content.trim() ? ({ role, content: content.slice(0, 3000) } as GeminiMessage) : null;
    })
    .filter(Boolean) as GeminiMessage[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, context, history = [] } = body as {
      message?: string;
      context?: unknown;
      history?: unknown;
    };

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Mesaj gerekli' }, { status: 400 });
    }

    const contextText = compactJson(context);
    const safeHistory = sanitizeHistory(history);

    const systemPrompt = `Sen Qore Maliyet Gözlem Paneli içinde çalışan uzman maliyet analitiği asistanısın.

Model/akıl yürütme beklentisi:
- Gemini 3 sınıfı geniş bağlam ve analitik düşünme için optimize edilmiş şekilde davran.
- Yanıtlarını yalnızca gönderilen panel bağlamına, özetlere, trend/historical verilere ve aktif filtrelere dayandır.
- Veri uydurma; eksik alan varsa açıkça "bu veri panel bağlamında yok" de.
- Geçmiş trendleri, aylar arası değişimi, yoğunlaşma riskini, stok/cihaz/personel/test kırılımını birlikte değerlendir.

Yanıt formatı:
- Türkçe, kısa ama aksiyon odaklı yaz.
- Önce net yorumu ver, sonra 3-5 maddelik geliştirme önerisi sun.
- Kritik riskleri **kalın** vurgula.
- Sayısal değerleri panelde verilen para birimiyle ve anlaşılır yuvarlamayla belirt.
- Kullanıcı basit soru sorarsa gereksiz uzun rapor yazma; ama "analiz", "tavsiye", "ne yapalım" derse derinleştir.`;

    const userPayload = `Kullanıcı sorusu:\n${message.trim()}\n\nMaliyet gözlem paneli bağlamı (aktif filtreler + özetler + geçmiş veriler):\n${contextText}`;

    const result = await generateWithGemini({
      systemPrompt,
      messages: [...safeHistory, { role: 'user', content: userPayload }],
      temperature: 0.2,
      maxOutputTokens: 4096,
    });

    return NextResponse.json({ message: result.text, model: result.model });
  } catch (error) {
    aiLogger.error('Maliyet gozlem AI chat error', error);
    const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: 'AI yanıtı üretilemedi', message }, { status: 500 });
  }
}
