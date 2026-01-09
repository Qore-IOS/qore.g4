import { NextRequest, NextResponse } from 'next/server';
import { chat, chatStream, ChatMessage } from '@/lib/ai/chat';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds timeout

export async function POST(request: NextRequest) {
  try {
    // Check API key first
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('[AI API] ANTHROPIC_API_KEY is not set');
      return NextResponse.json(
        {
          error: 'API anahtarı ayarlanmamış',
          message: 'ANTHROPIC_API_KEY environment variable eksik. Lütfen .env.local dosyasına ekleyin.'
        },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { message, history = [], stream = false } = body as {
      message: string;
      history?: ChatMessage[];
      stream?: boolean;
    };

    console.log('[AI API] Request received:', {
      message: message?.substring(0, 50) + '...',
      stream,
      historyLength: history.length
    });

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Mesaj gerekli', message: 'message alanı string olmalı' },
        { status: 400 }
      );
    }

    if (message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Boş mesaj gönderilemez' },
        { status: 400 }
      );
    }

    // Non-streaming response
    if (!stream) {
      console.log('[AI API] Using non-streaming mode');
      const response = await chat(message, history);

      console.log('[AI API] Response ready:', {
        hasMessage: !!response.message,
        messageLength: response.message?.length,
        error: response.error
      });

      return NextResponse.json(response);
    }

    // Streaming response
    console.log('[AI API] Using streaming mode');
    const encoder = new TextEncoder();

    const customStream = new ReadableStream({
      async start(controller) {
        try {
          const response = await chatStream(message, history, (chunk) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
          });

          // Send final response with metadata
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                done: true,
                queryPlan: response.queryPlan,
                summary: response.fetchedData?.summary,
              })}\n\n`
            )
          );
          controller.close();
        } catch (error) {
          console.error('[AI API] Stream error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: errorMessage })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(customStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[AI API] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('[AI API] Error stack:', errorStack);

    return NextResponse.json(
      { error: 'Sunucu hatası', message: errorMessage },
      { status: 500 }
    );
  }
}
