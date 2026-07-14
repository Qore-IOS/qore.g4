import { adminDb } from '@/lib/firebase-admin';

export interface OpenAIExtensionMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface OpenAIExtensionGenerateOptions {
  systemPrompt: string;
  messages: OpenAIExtensionMessage[];
  temperature?: number;
  timeoutMs?: number;
}

const DEFAULT_COLLECTION_PATH = 'qoreAiMessages';
const DEFAULT_PROMPT_FIELD = 'prompt';
const DEFAULT_RESPONSE_FIELD = 'response';
const DEFAULT_TIMEOUT_MS = 55_000;
const POLL_INTERVAL_MS = 1_000;

function getCollectionPath(): string {
  return (process.env.OPENAI_EXTENSION_COLLECTION_PATH || process.env.QORE_AI_CHATGPT_COLLECTION_PATH || DEFAULT_COLLECTION_PATH).trim();
}

function getPromptField(): string {
  return (process.env.OPENAI_EXTENSION_PROMPT_FIELD || DEFAULT_PROMPT_FIELD).trim();
}

function getResponseField(): string {
  return (process.env.OPENAI_EXTENSION_RESPONSE_FIELD || DEFAULT_RESPONSE_FIELD).trim();
}

function collectionRefFromPath(path: string) {
  const segments = path.split('/').map((part) => part.trim()).filter(Boolean);
  if (segments.length === 0 || segments.length % 2 === 0) {
    throw new Error('OpenAI extension collection path must point to a Firestore collection.');
  }
  return adminDb.collection(segments.join('/'));
}

function normaliseResponse(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const candidates = [obj.text, obj.content, obj.message, obj.answer];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return null;
}

function buildPrompt(options: OpenAIExtensionGenerateOptions): string {
  const history = options.messages
    .map((message) => `${message.role === 'assistant' ? 'Asistan' : 'Kullanıcı'}: ${message.content}`)
    .join('\n\n');

  return `${options.systemPrompt}\n\n---\n\n${history}`;
}

export async function generateWithOpenAIExtension(options: OpenAIExtensionGenerateOptions): Promise<{ text: string; documentId: string }> {
  const collectionPath = getCollectionPath();
  const promptField = getPromptField();
  const responseField = getResponseField();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ref = await collectionRefFromPath(collectionPath).add({
    [promptField]: buildPrompt(options),
    status: 'pending',
    source: 'qore-ai',
    createdAt: new Date(),
    temperature: options.temperature ?? 0.1,
  });

  const startedAt = Date.now();
  let lastError: string | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const snap = await ref.get();
    const data = snap.data() ?? {};
    const response = normaliseResponse(data[responseField]);
    if (response) return { text: response, documentId: ref.id };
    if (typeof data.error === 'string') lastError = data.error;
  }

  throw new Error(lastError || `OpenAI extension response timed out for ${collectionPath}/${ref.id}.`);
}

export function isOpenAIExtensionConfigured(): boolean {
  return Boolean(process.env.OPENAI_EXTENSION_COLLECTION_PATH || process.env.QORE_AI_CHATGPT_COLLECTION_PATH || process.env.QORE_AI_PROVIDER === 'openai-extension');
}
