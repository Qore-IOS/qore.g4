/**
 * Qore AI Engine v2 — multi-turn agent loop with native Gemini function calling.
 *
 * Unlike the v1 agent (single round of tool calls, then a synthesis prompt),
 * this engine keeps the model in the loop: each turn the model either calls
 * tools (we execute and feed back functionResponse parts) or returns the final
 * answer. We cap at maxRounds to prevent runaway loops.
 */

import { aiLogger } from '@/lib/logger';
import { getGeminiApiKey } from '../geminiClient';
import { runTool } from './handlers';
import { buildSystemPrompt, FINAL_SYNTHESIS_PROMPT } from './prompt';
import { TOOL_SCHEMAS } from './tools';
import type {
  EngineMessage,
  EngineResult,
  EngineRunOptions,
  EngineTrace,
  PermissionContext,
  ToolCallRequest,
  ToolCallResult,
} from './types';

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model' | 'function';
  parts: GeminiPart[];
}

const MODEL_CANDIDATES = (envModel?: string): string[] => {
  const base = [
    'gemini-2.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.5-flash-lite',
  ];
  return envModel ? [envModel, ...base.filter((m) => m !== envModel)] : base;
};

const MAX_OUTPUT_TOKENS = 8192; // maximum context output for flash models

function historyToContents(history: EngineMessage[], userMessage: string): GeminiContent[] {
  return [
    ...history.map<GeminiContent>((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];
}

async function callGemini(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  contents: GeminiContent[];
  toolMode: 'AUTO' | 'NONE';
}): Promise<{ text: string; functionCalls: ToolCallRequest[]; raw: unknown }> {
  const body: Record<string, unknown> = {
    contents: opts.contents,
    systemInstruction: { parts: [{ text: opts.systemPrompt }] },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      candidateCount: 1,
    },
  };

  if (opts.toolMode === 'AUTO') {
    body.tools = [{ functionDeclarations: TOOL_SCHEMAS }];
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`gemini_http_${res.status}:${opts.model}:${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text!)
    .join('\n')
    .trim();
  const functionCalls = parts
    .filter((p) => p.functionCall?.name)
    .map((p) => ({
      name: p.functionCall!.name,
      args: p.functionCall!.args ?? {},
    }));

  return { text, functionCalls, raw: data };
}

async function callGeminiWithFallback(
  apiKey: string,
  modelOverride: string | undefined,
  systemPrompt: string,
  contents: GeminiContent[],
  toolMode: 'AUTO' | 'NONE',
): Promise<{ text: string; functionCalls: ToolCallRequest[]; model: string }> {
  const models = MODEL_CANDIDATES(modelOverride);
  let lastError: Error | null = null;
  for (const model of models) {
    try {
      const result = await callGemini({ apiKey, model, systemPrompt, contents, toolMode });
      return { ...result, model };
    } catch (e) {
      const err = e as Error;
      lastError = err;
      // Only fall through on 4xx/5xx-style errors that we'd retry on another model.
      const msg = err.message ?? '';
      if (msg.startsWith('gemini_http_400') || msg.startsWith('gemini_http_404') ||
          msg.startsWith('gemini_http_429') || msg.startsWith('gemini_http_503')) {
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error('gemini_no_model_available');
}

function emit(trace: EngineTrace, cb?: (t: EngineTrace) => void) {
  if (cb) {
    try { cb(trace); } catch (e) { aiLogger.debug('trace cb failed', e); }
  }
}

/**
 * Run a single conversation turn with the agent. Returns the final answer text.
 */
export async function runEngine(opts: EngineRunOptions): Promise<EngineResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY ayarlanmamış.');

  const ctx: PermissionContext = opts.permission;
  const maxRounds = opts.maxRounds ?? 6;
  const systemPrompt = buildSystemPrompt(ctx);

  const contents: GeminiContent[] = historyToContents(opts.history, opts.message);
  const toolsUsed: string[] = [];
  let scannedDocs = 0;

  emit({ type: 'plan', text: `Soru alındı, en fazla ${maxRounds} tur düşünme.` }, opts.onTrace);

  for (let round = 1; round <= maxRounds; round++) {
    const { text, functionCalls, model } = await callGeminiWithFallback(
      apiKey,
      process.env.GEMINI_MODEL?.trim(),
      systemPrompt,
      contents,
      'AUTO',
    );

    if (functionCalls.length === 0) {
      // Model returned final answer.
      emit({ type: 'final', text }, opts.onTrace);
      return {
        message: text || 'Cevap üretilemedi.',
        toolsUsed,
        rounds: round,
        scannedDocs,
      };
    }

    aiLogger.info(`engine round ${round}`, { model, toolCalls: functionCalls.map((c) => c.name) });

    // Add the model's function call message to history
    contents.push({
      role: 'model',
      parts: functionCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
    });

    // Execute every tool call sequentially (Firestore handles them quickly)
    const functionResponses: GeminiPart[] = [];
    for (const call of functionCalls) {
      emit({ type: 'tool_call', tool: call.name, args: call.args }, opts.onTrace);
      const result = await runToolWithErrorGuard(call, ctx);
      toolsUsed.push(call.name);
      scannedDocs += result.scanned ?? 0;
      emit(
        { type: 'tool_result', tool: call.name, result: summariseResult(result) },
        opts.onTrace,
      );

      functionResponses.push({
        functionResponse: {
          name: call.name,
          response: {
            ok: result.ok,
            data: result.data,
            notice: result.notice,
            scanned: result.scanned ?? 0,
          },
        },
      });
    }

    // Feed back the tool results
    contents.push({ role: 'function', parts: functionResponses });
  }

  // Hit the round cap → ask Gemini for a final synthesis without tools.
  aiLogger.warn('engine round cap reached, asking for final synthesis');
  const finalCall = await callGeminiWithFallback(
    apiKey,
    process.env.GEMINI_MODEL?.trim(),
    systemPrompt + '\n\n' + FINAL_SYNTHESIS_PROMPT,
    contents,
    'NONE',
  );
  emit({ type: 'final', text: finalCall.text }, opts.onTrace);
  return {
    message: finalCall.text || 'Cevap üretilemedi.',
    toolsUsed,
    rounds: maxRounds,
    scannedDocs,
  };
}

async function runToolWithErrorGuard(call: ToolCallRequest, ctx: PermissionContext): Promise<ToolCallResult> {
  try {
    return await runTool(call.name, call.args, ctx);
  } catch (e) {
    aiLogger.error('runTool crashed', e);
    return {
      ok: false,
      label: call.name,
      data: null,
      notice: e instanceof Error ? e.message : 'tool çağrısı başarısız',
    };
  }
}

/** Truncate large tool results before tracing them to the client. */
function summariseResult(result: ToolCallResult): unknown {
  const json = JSON.stringify(result.data);
  if (!json || json.length < 1200) return result.data;
  return { ok: result.ok, summary: json.slice(0, 1100) + '…', scanned: result.scanned };
}

/* ----------------------------------------------------------------------- */
/* Streaming variant (chunked output)                                      */
/* ----------------------------------------------------------------------- */

export async function runEngineStream(
  opts: EngineRunOptions,
  onChunk: (chunk: string) => void,
): Promise<EngineResult> {
  const result = await runEngine(opts);
  // Simple chunking — Gemini already produced the full answer, but the chat UI
  // expects incremental streaming so the orb stays in "processing" until done.
  const chunks = result.message.match(/[\s\S]{1,180}(\s|$)/g) ?? [result.message];
  for (const c of chunks) onChunk(c);
  return result;
}
