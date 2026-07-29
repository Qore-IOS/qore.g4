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
  // Gemini 2.5+ "düşünme" (thinking) bütçesi. 0 → düşünmeyi kapatır, böylece
  // tüm çıktı token'ları ve süresi gerçek yanıta gider (kesik/yüzeysel çıktı önlenir).
  thinkingBudget?: number;
}

export interface GeminiVisionImage {
  mimeType: string;
  base64: string;
}

interface GenerateVisionOptions {
  systemPrompt?: string;
  prompt: string;
  images: GeminiVisionImage[];
  temperature?: number;
  maxOutputTokens?: number;
  responseJson?: boolean;
}

const DEFAULT_GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-pro',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-2.5-pro',
  'gemini-3-pro-preview',
];

const DEFAULT_VISION_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.5-pro',
];

// Module-level cache to memorize working models across calls (speeds up execution/avoids timeouts)
let lastSuccessfulModel: string | null = null;
let lastSuccessfulVisionModel: string | null = null;

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

function friendlyGeminiError(lastDebug: string): string | null {
  if (lastDebug.includes('http_429')) {
    return 'Gemini API kotası doldu (rate limit). Lütfen 30-60 saniye bekleyip tekrar deneyin veya farklı bir API anahtarı kullanın.';
  }
  if (lastDebug.includes('http_503')) {
    return 'Gemini API geçici olarak meşgul. Lütfen birkaç saniye sonra tekrar deneyin.';
  }
  if (lastDebug.includes('http_403')) {
    const lower = lastDebug.toLowerCase();
    if (lower.includes('dunning') || lower.includes('billing') || lower.includes('permission_denied')) {
      return 'Gemini API erişimi faturalandırma sorunu nedeniyle reddedildi. Google Cloud hesabınızda ödeme/borç durumu olabilir — Google Cloud Console › Faturalandırma bölümünden kontrol edin veya sağlıklı bir projeden yeni API anahtarı oluşturun.';
    }
    return 'Gemini API erişimi reddedildi (403). API anahtarının geçerli olduğunu ve bağlı Google Cloud projesinin faturalandırmasının aktif olduğunu kontrol edin.';
  }
  return null;
}

export async function generateWithGemini(options: GenerateOptions): Promise<{ text: string; functionCalls: GeminiFunctionCall[]; model: string; debug?: string; }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable ayarlanmamis');

  const baseModels = getCandidateModels();
  const models = lastSuccessfulModel
    ? [lastSuccessfulModel, ...baseModels.filter((m) => m !== lastSuccessfulModel)]
    : baseModels;

  let lastDebug = 'gemini_no_attempt';

  // İstek başına ve toplam zaman bütçesi: model üretimi yavaşlarsa fetch
  // süresiz beklemesin (aksi halde platform ağ geçidi 504 döndürür). Bütçe
  // ağ geçidi süresinin (maxDuration 60s) altında tutulur ki temiz 5xx dönsün.
  const overallBudgetMs = Number(process.env.GEMINI_TOTAL_TIMEOUT_MS) || 50_000;
  const perAttemptMs = Number(process.env.GEMINI_ATTEMPT_TIMEOUT_MS) || 28_000;
  const startedAt = Date.now();

  for (const model of models) {
    const remainingMs = overallBudgetMs - (Date.now() - startedAt);
    if (remainingMs <= 1500) { if (lastDebug === 'gemini_no_attempt') lastDebug = 'gemini_timeout_budget_exhausted'; break; }
    const generationConfig: Record<string, unknown> = {
      temperature: options.temperature ?? 0.1,
      maxOutputTokens: options.maxOutputTokens ?? 2048,
    };
    // Düşünme bütçesi verildiyse uygula (0 = kapalı). Destekleyen modellerde
    // (gemini-2.5-flash vb.) çıktı token'larının düşünmeye gitmesini engeller.
    if (options.thinkingBudget !== undefined) {
      generationConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };
    }
    const body: Record<string, unknown> = {
      contents: toGeminiContents(options.messages),
      generationConfig,
    };

    if (options.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = [{ functionDeclarations: options.tools }];
    }

    const controller = new AbortController();
    const attemptMs = Math.min(perAttemptMs, remainingMs);
    const timer = setTimeout(() => controller.abort(), attemptMs);
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as Error)?.name === 'AbortError';
      lastDebug = aborted ? `gemini_timeout:${model}:${attemptMs}ms` : `gemini_fetch_error:${model}:${(err as Error)?.message?.slice(0, 120)}`;
      continue; // sıradaki modeli dene (veya bütçe dolunca döngü kırılır)
    }
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      lastDebug = `gemini_http_${res.status}:${model}:${errText.slice(0, 180)}`;
      if (res.status === 400 || res.status === 403 || res.status === 404 || res.status === 422 || res.status === 429 || res.status === 503) continue;
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

    lastSuccessfulModel = model;
    return { text, functionCalls, model };
  }

  aiLogger.error('Gemini tum modellerde basarisiz oldu', { debug: lastDebug });
  throw new Error(friendlyGeminiError(lastDebug) || lastDebug);
}

/**
 * Call Gemini with one or more images attached. Used for image-based OCR.
 * Falls through a small list of vision-capable models so the same payload
 * keeps working when Google rotates preview model names.
 */
export async function generateVisionWithGemini(
  options: GenerateVisionOptions
): Promise<{ text: string; model: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable ayarlanmamis');

  const envModel = process.env.GEMINI_VISION_MODEL?.trim() || process.env.GEMINI_MODEL?.trim();
  const baseModels = envModel
    ? [envModel, ...DEFAULT_VISION_MODELS.filter((m) => m !== envModel)]
    : DEFAULT_VISION_MODELS;

  const models = lastSuccessfulVisionModel
    ? [lastSuccessfulVisionModel, ...baseModels.filter((m) => m !== lastSuccessfulVisionModel)]
    : baseModels;

  let lastDebug = 'gemini_vision_no_attempt';

  for (const model of models) {
    const parts: Array<Record<string, unknown>> = options.images.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.base64 },
    }));
    parts.push({ text: options.prompt });

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: options.temperature ?? 0.1,
        maxOutputTokens: options.maxOutputTokens ?? 4096,
        ...(options.responseJson ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (options.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      lastDebug = `gemini_vision_http_${res.status}:${model}:${errText.slice(0, 180)}`;
      if (res.status === 400 || res.status === 403 || res.status === 404 || res.status === 422 || res.status === 429 || res.status === 503) continue;
      throw new Error(lastDebug);
    }

    const data = await res.json();
    const responseParts = data?.candidates?.[0]?.content?.parts ?? [];
    const text = responseParts
      .filter((p: { text?: string }) => typeof p?.text === 'string')
      .map((p: { text: string }) => p.text)
      .join('\n')
      .trim();

    if (!text) {
      lastDebug = `gemini_vision_empty_response:${model}`;
      continue;
    }
    lastSuccessfulVisionModel = model;
    return { text, model };
  }

  aiLogger.error('Gemini Vision tum modellerde basarisiz oldu', { debug: lastDebug });
  throw new Error(friendlyGeminiError(lastDebug) || lastDebug);
}
