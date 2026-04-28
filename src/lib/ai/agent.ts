import { MAX_TOKENS } from './config';
import { AGENT_TOOLS, AgentToolName, pendingPlans } from './tools';
import { executeTool } from './actions';
import { generateWithGemini, GeminiMessage } from './geminiClient';
import { TOTAL_VERIMLILIK_ANALIZ_RAPORU } from './efficiencyReportContext';

const AGENT_SYSTEM_PROMPT = `Sen Qore sisteminin AI ajanısın. Türkçe konuşuyorsun ve sağlık sektörü ERP sisteminde uzmanlaşmış bir asistansın.

## Çalışma Prensibin
1. Önce analiz et.
2. Gerekli olduğunda araçları çağır.
3. Veri olmadan iddia üretme.
4. Kritik aksiyonlarda kullanıcı onayı iste.
5. Kısa, net ve doğru cevap ver.

## VERIMLILIK ANALIZ REFERANSI
Yapay zeka ajanı olarak sana sunulan verimlilik analiz paneli algoritmasını ve analiz yönergelerini kullanarak tespitler yapmalısın. Eğer sana tablo, satır veya hücre bilgisi gelirse bu rapor kurallarına göre analiz et:

${TOTAL_VERIMLILIK_ANALIZ_RAPORU}`;

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentResponse {
  message: string;
  toolsUsed: string[];
  actionTaken?: string;
  requiresConfirmation?: boolean;
  planId?: string;
  error?: string;
}

function checkForConfirmation(message: string): string | null {
  const confirmKeywords = ['evet', 'onayla', 'onaylıyorum', 'tamam', 'olur', 'yap', 'oluştur', 'kabul'];
  const cancelKeywords = ['hayır', 'iptal', 'vazgeç', 'cancel', 'durdur'];
  const lowerMessage = message.toLowerCase();

  if (cancelKeywords.some((k) => lowerMessage.includes(k))) return 'cancel';

  if (confirmKeywords.some((k) => lowerMessage.includes(k))) {
    const pendingPlan = Array.from(pendingPlans.values()).find((p) => p.status === 'pending_confirmation');
    if (pendingPlan) return pendingPlan.id;
  }

  return null;
}

function toGeminiHistory(history: AgentMessage[], userMessage: string): GeminiMessage[] {
  return [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];
}

export async function runAgent(
  userMessage: string,
  conversationHistory: AgentMessage[] = []
): Promise<AgentResponse> {
  const toolsUsed: string[] = [];
  let actionTaken: string | undefined;
  let requiresConfirmation = false;
  let planId: string | undefined;

  try {
    const confirmationResult = checkForConfirmation(userMessage);

    if (confirmationResult === 'cancel') {
      for (const plan of Array.from(pendingPlans.values())) {
        if (plan.status === 'pending_confirmation') {
          plan.status = 'cancelled';
          pendingPlans.delete(plan.id);
        }
      }
      return { message: 'Sipariş planı iptal edildi.', toolsUsed: [], actionTaken: 'plan_cancelled' };
    }

    if (confirmationResult && confirmationResult !== 'cancel') {
      toolsUsed.push('execute_order_plan');
      const result = await executeTool('execute_order_plan', { planId: confirmationResult });
      if (result.success) {
        return { message: `✅ ${(result.data as { message: string }).message}`, toolsUsed, actionTaken: 'orders_created' };
      }
      return { message: `❌ Hata: ${result.error}`, toolsUsed, error: result.error };
    }

    const messages = toGeminiHistory(conversationHistory, userMessage);
    const modelResponse = await generateWithGemini({
      systemPrompt: AGENT_SYSTEM_PROMPT,
      messages,
      temperature: 0.1,
      maxOutputTokens: MAX_TOKENS,
      tools: AGENT_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    });

    if (modelResponse.functionCalls.length === 0) {
      return {
        message: modelResponse.text || 'İşlem tamamlandı.',
        toolsUsed,
      };
    }

    const toolOutputs: string[] = [];

    for (const call of modelResponse.functionCalls.slice(0, 6)) {
      const toolName = call.name as AgentToolName;
      toolsUsed.push(toolName);

      const result = await executeTool(toolName, call.args as Record<string, unknown>);
      toolOutputs.push(`${toolName}: ${JSON.stringify(result)}`);

      if (result.requiresConfirmation) {
        requiresConfirmation = true;
        planId = result.planId;
        actionTaken = 'plan_created';
      }
    }

    const final = await generateWithGemini({
      systemPrompt: AGENT_SYSTEM_PROMPT,
      messages: [
        ...messages,
        {
          role: 'assistant',
          content: `Araç sonuçları:\n${toolOutputs.join('\n')}`,
        },
      ],
      temperature: 0.1,
      maxOutputTokens: MAX_TOKENS,
    });

    return {
      message: final.text || 'İşlem tamamlandı.',
      toolsUsed,
      actionTaken,
      requiresConfirmation,
      planId,
    };
  } catch (error) {
    console.error('[Agent] Error:', error);

    let errorMessage = 'Bir hata oluştu. Lütfen tekrar deneyin.';
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('401') || msg.includes('api') || msg.includes('authentication')) {
        errorMessage = 'API anahtarı geçersiz veya süresi dolmuş. Lütfen Gemini API anahtarınızı kontrol edin.';
      } else if (msg.includes('429') || msg.includes('rate')) {
        errorMessage = 'API rate limit aşıldı. Lütfen birkaç saniye bekleyip tekrar deneyin.';
      } else if (msg.includes('500') || msg.includes('503')) {
        errorMessage = 'Gemini API geçici olarak kullanılamıyor. Lütfen tekrar deneyin.';
      } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('enotfound')) {
        errorMessage = 'Ağ bağlantısı hatası. İnternet bağlantınızı kontrol edin.';
      }
    }

    return {
      message: errorMessage,
      toolsUsed,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

export async function runAgentStream(
  userMessage: string,
  conversationHistory: AgentMessage[] = [],
  onChunk: (chunk: string) => void
): Promise<AgentResponse> {
  const result = await runAgent(userMessage, conversationHistory);
  const chunks = result.message.match(/.{1,120}(\s|$)/g) || [result.message];
  for (const chunk of chunks) onChunk(chunk);
  return result;
}
