import { NextRequest, NextResponse } from 'next/server';
import { chat, chatStream, ChatMessage } from '@/lib/ai/chat';
import { runAgent, runAgentStream, AgentMessage } from '@/lib/ai/agent';
import { isApiKeyValid } from '@/lib/ai/config';
import { aiLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds timeout

export async function POST(request: NextRequest) {
  try {
    // Check API key first - use validated check from config
    if (!process.env.ANTHROPIC_API_KEY) {
      aiLogger.error('ANTHROPIC_API_KEY is not set');
      return NextResponse.json(
        {
          error: 'API anahtarı ayarlanmamış',
          message: 'ANTHROPIC_API_KEY environment variable eksik. Lütfen .env.local dosyasına ekleyin.'
        },
        { status: 500 }
      );
    }

    // Check if API key format is valid
    if (!isApiKeyValid) {
      aiLogger.error('ANTHROPIC_API_KEY format is invalid');
      return NextResponse.json(
        {
          error: 'Geçersiz API anahtarı formatı',
          message: 'API anahtarı geçersiz formatta. Anthropic API anahtarları "sk-ant-" ile başlamalıdır. Lütfen console.anthropic.com adresinden doğru anahtarı alın.'
        },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { message, history = [], stream = false, mode = 'chat' } = body as {
      message: string;
      history?: ChatMessage[] | AgentMessage[];
      stream?: boolean;
      mode?: 'chat' | 'agent';
    };

    aiLogger.info('Request received', {
      message: message?.substring(0, 50) + '...',
      stream,
      mode,
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

    // ============ AGENT MODE ============
    if (mode === 'agent') {
      aiLogger.info('Using AGENT mode');

      if (!stream) {
        const response = await runAgent(message, history as AgentMessage[]);

        aiLogger.info('Agent response ready', {
          hasMessage: !!response.message,
          toolsUsed: response.toolsUsed,
          actionTaken: response.actionTaken,
          requiresConfirmation: response.requiresConfirmation,
        });

        return NextResponse.json(response);
      }

      // Streaming agent response
      const encoder = new TextEncoder();
      const customStream = new ReadableStream({
        async start(controller) {
          try {
            const response = await runAgentStream(
              message,
              history as AgentMessage[],
              (chunk) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
              }
            );

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  done: true,
                  toolsUsed: response.toolsUsed,
                  actionTaken: response.actionTaken,
                  requiresConfirmation: response.requiresConfirmation,
                  planId: response.planId,
                })}\n\n`
              )
            );
            controller.close();
          } catch (error) {
            aiLogger.error('Agent stream error', error);
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
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
    }

    // ============ CHAT MODE (Default) ============
    if (!stream) {
      aiLogger.info('Using CHAT mode (non-streaming)');
      const response = await chat(message, history as ChatMessage[]);

      aiLogger.info('Response ready', {
        hasMessage: !!response.message,
        messageLength: response.message?.length,
        error: response.error
      });

      return NextResponse.json(response);
    }

    // Streaming chat response
    aiLogger.info('Using CHAT mode (streaming)');
    const encoder = new TextEncoder();

    const customStream = new ReadableStream({
      async start(controller) {
        try {
          const response = await chatStream(message, history as ChatMessage[], (chunk) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
          });

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
          aiLogger.error('Stream error', error);
          const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
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
    aiLogger.error('API error', error, {
      stack: error instanceof Error ? error.stack : undefined
    });

    const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';

    return NextResponse.json(
      { error: 'Sunucu hatası', message: errorMessage },
      { status: 500 }
    );
  }
}
