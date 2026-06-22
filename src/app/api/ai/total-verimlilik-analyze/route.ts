import { NextRequest, NextResponse } from 'next/server';
import { generateWithGemini } from '@/lib/ai/geminiClient';
import { aiLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      systemPrompt,
      prompt,
      temperature = 0.2,
      maxOutputTokens = 2048,
      thinkingBudget,
    } = body as {
      systemPrompt?: string;
      prompt?: string;
      temperature?: number;
      maxOutputTokens?: number;
      thinkingBudget?: number;
    };

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: 'prompt alanı zorunlu', message: 'prompt string olmalı ve boş olmamalı' },
        { status: 400 }
      );
    }

    const result = await generateWithGemini({
      systemPrompt,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      maxOutputTokens,
      thinkingBudget,
    });

    return NextResponse.json({ text: result.text, model: result.model });
  } catch (error) {
    aiLogger.error('total-verimlilik-analyze error', error);
    const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
    return NextResponse.json({ error: 'AI analiz hatası', message }, { status: 500 });
  }
}
