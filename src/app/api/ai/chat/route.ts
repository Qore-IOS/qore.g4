import { NextRequest, NextResponse } from 'next/server';
import { aiLogger } from '@/lib/logger';
import { isApiKeyValid } from '@/lib/ai/config';
import { smartChat, smartChatStream, type ChatMessage } from '@/lib/ai/chat';
import { isOpenAIConfigured } from '@/lib/ai/openaiClient';
import {
  permissionContextFromRequest,
  runEngine,
  runEngineStream,
  type EngineMessage,
  type EngineTrace,
} from '@/lib/ai/v2';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChatRequestBody {
  message: string;
  history?: EngineMessage[];
  stream?: boolean;
  /** Reserved — kept for client backward compat (mode is auto in v2). */
  mode?: string;
}

function classifyErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Beklenmeyen bir hata oluştu.';
  const msg = error.message.toLowerCase();
  if (msg.includes('401') || msg.includes('api key') || msg.includes('authentication')) {
    return 'API anahtarı geçersiz veya süresi dolmuş. Lütfen Gemini API anahtarınızı kontrol edin.';
  }
  if (msg.includes('429') || msg.includes('rate')) {
    return 'API rate limit aşıldı. Lütfen birkaç saniye bekleyip tekrar deneyin.';
  }
  if (msg.includes('500') || msg.includes('503')) {
    return 'Gemini API geçici olarak kullanılamıyor. Lütfen tekrar deneyin.';
  }
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('enotfound')) {
    return 'Ağ bağlantısı hatası. İnternet bağlantınızı kontrol edin.';
  }
  return error.message;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const { message, history = [], stream = false } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Mesaj gerekli' }, { status: 400 });
    }

    if (isOpenAIConfigured()) {
      const chatHistory = history
        .filter((m): m is ChatMessage => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content }));

      if (!stream) {
        const result = await smartChat(message, chatHistory);
        return NextResponse.json({
          message: result.message,
          queryPlan: result.queryPlan,
          fetchedData: result.fetchedData,
          provider: 'openai-extension',
        });
      }

      const encoder = new TextEncoder();
      const customStream = new ReadableStream({
        async start(controller) {
          const send = (payload: Record<string, unknown>) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          try {
            const result = await smartChatStream(message, chatHistory, (chunk) => send({ chunk }));
            send({ done: true, provider: 'openai-extension', queryPlan: result.queryPlan });
            controller.close();
          } catch (error) {
            aiLogger.error('openai extension stream error', error);
            send({ error: classifyErrorMessage(error) });
            controller.close();
          }
        },
      });

      return new Response(customStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    if (!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY)) {
      aiLogger.error('Gemini API key is not set');
      return NextResponse.json(
        { error: 'API anahtarı ayarlanmamış', message: 'GEMINI_API_KEY veya OPENAI_API_KEY ortam değişkenini ayarlayın.' },
        { status: 500 },
      );
    }
    if (!isApiKeyValid) {
      return NextResponse.json(
        { error: 'Geçersiz API anahtarı formatı', message: 'Gemini API anahtarı formatı geçersiz.' },
        { status: 500 },
      );
    }

    const permission = await permissionContextFromRequest(request);
    aiLogger.info('chat v2 request', {
      uid: permission.uid,
      role: permission.role,
      scope: permission.unrestrictedScope ? 'unrestricted' : 'restricted',
      messageLen: message.length,
      historyLen: history.length,
      stream,
    });

    if (!stream) {
      const result = await runEngine({ message, history, permission });
      return NextResponse.json({
        message: result.message,
        toolsUsed: result.toolsUsed,
        rounds: result.rounds,
        scannedDocs: result.scannedDocs,
      });
    }

    // Streaming variant: emits chunk + trace events as SSE
    const encoder = new TextEncoder();
    const customStream = new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

        const onTrace = (trace: EngineTrace) => {
          try { send({ trace }); } catch { /* ignore */ }
        };

        try {
          const result = await runEngineStream(
            { message, history, permission, onTrace },
            (chunk) => send({ chunk }),
          );
          send({
            done: true,
            toolsUsed: result.toolsUsed,
            rounds: result.rounds,
            scannedDocs: result.scannedDocs,
          });
          controller.close();
        } catch (error) {
          aiLogger.error('engine stream error', error);
          send({ error: classifyErrorMessage(error) });
          controller.close();
        }
      },
    });

    return new Response(customStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    aiLogger.error('chat route fatal', error);
    return NextResponse.json(
      { error: 'Sunucu hatası', message: classifyErrorMessage(error) },
      { status: 500 },
    );
  }
}
