import { aiLogger } from '@/lib/logger';

export interface GeminiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface GenerateOptions {
  systemPrompt?: string;
  messages: GeminiMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  tools?: GeminiFunctionDeclaration[];
}

const DEFAULT_GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
];

function toGeminiContents(messages: GeminiMessage[]) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
}

export function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!key) return null;
  const trimmed = key.trim();
  return trimmed.length > 10 ? trimmed : null;
}

function getCandidateModels(): string[] {
  const envModel = process.env.GEMINI_MODEL?.trim();
  if (envModel) return [envModel, ...DEFAULT_GEMINI_MODELS.filter((m) => m !== envModel)];
  return DEFAULT_GEMINI_MODELS;
}

export async function generateWithGemini(options: GenerateOptions): Promise<{ text: string; functionCalls: GeminiFunctionCall[]; model: string; debug?: string; }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable ayarlanmamis');

  const models = getCandidateModels();
  let lastDebug = 'gemini_no_attempt';

  for (const model of models) {
    const body: Record<string, unknown> = {
      contents: toGeminiContents(options.messages),
      generationConfig: {
        temperature: options.temperature ?? 0.1,
        maxOutputTokens: options.maxOutputTokens ?? 2048,
      },
    };

    if (options.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = [{ functionDeclarations: options.tools }];
    }

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      lastDebug = `gemini_http_${res.status}:${model}:${errText.slice(0, 180)}`;
      if (res.status === 400 || res.status === 404 || res.status === 429 || res.status === 503) continue;
      throw new Error(lastDebug);
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p: { text?: string }) => typeof p?.text === 'string').map((p: { text: string }) => p.text).join('\n').trim();
    const functionCalls = parts
      .filter((p: { functionCall?: { name?: string; args?: Record<string, unknown> } }) => p?.functionCall?.name)
      .map((p: { functionCall: { name: string; args?: Record<string, unknown> } }) => ({
        name: p.functionCall.name,
        args: p.functionCall.args || {},
      }));

    if (!text && functionCalls.length === 0) {
      lastDebug = `gemini_empty_response:${model}`;
      continue;
    }

    return { text, functionCalls, model };
  }

  aiLogger.error('Gemini tum modellerde basarisiz oldu', { debug: lastDebug });
  if (lastDebug.startsWith('gemini_http_429')) {
    throw new Error('Gemini API kotası doldu (rate limit). Lütfen 30-60 saniye bekleyip tekrar deneyin veya farklı bir API anahtarı kullanın.');
  }
  if (lastDebug.startsWith('gemini_http_503')) {
    throw new Error('Gemini API geçici olarak meşgul. Lütfen birkaç saniye sonra tekrar deneyin.');
  }
  throw new Error(lastDebug);
}
