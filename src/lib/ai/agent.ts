import { anthropic, CLAUDE_MODEL, MAX_TOKENS } from './config';
import { AGENT_TOOLS, AgentToolName, pendingPlans } from './tools';
import { executeTool } from './actions';
import Anthropic from '@anthropic-ai/sdk';

// Agent system prompt
const AGENT_SYSTEM_PROMPT = `Sen Qore sisteminin AI ajanısın. Türkçe konuşuyorsun ve sağlık sektörü ERP sisteminde uzmanlaşmış bir asistansın.

## Yeteneklerin

### Okuma İşlemleri
- **get_lab_stock_status**: Laboratuvar stok durumlarını sorgula
- **get_min_max_rules**: Min/max stok kurallarını getir
- **get_depot_stock**: Depo stok durumunu sorgula
- **get_labs_needing_product**: Belirli ürüne ihtiyacı olan labları bul

### Aksiyon İşlemleri
- **create_order_plan**: Sipariş planı oluştur (onay gerektirir)
- **execute_order_plan**: Onaylanan planı uygula

## Çalışma Prensibin

1. **Önce Analiz Et**: Kullanıcının ne istediğini anla
2. **Veri Topla**: Gerekli tool'ları kullanarak veri çek
3. **Plan Oluştur**: Aksiyon gerekiyorsa plan hazırla
4. **Onay İste**: Kritik aksiyonlar için MUTLAKA kullanıcı onayı al
5. **Uygula**: Onay alındıktan sonra execute et

## Onay Mekanizması

Sipariş oluşturma gibi kritik işlemlerde:
1. create_order_plan ile plan oluştur
2. Planı kullanıcıya göster
3. Kullanıcı "evet", "onayla", "tamam" derse execute_order_plan çağır
4. Kullanıcı "hayır", "iptal" derse işlemi durdur

## Kurallar

- Veri olmadan yorum yapma, önce tool kullan
- Sayıları yuvarla (örn: %47.3 → %47)
- Kritik aksiyonları ASLA otomatik yapma
- Hataları açıkça belirt
- Türkçe ve profesyonel ol
`;

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

// Check if user is confirming a pending plan
function checkForConfirmation(message: string): string | null {
  const confirmKeywords = ['evet', 'onayla', 'onaylıyorum', 'tamam', 'olur', 'yap', 'oluştur', 'kabul'];
  const cancelKeywords = ['hayır', 'iptal', 'vazgeç', 'cancel', 'durdur'];

  const lowerMessage = message.toLowerCase();

  // Check for cancel first
  if (cancelKeywords.some(k => lowerMessage.includes(k))) {
    return 'cancel';
  }

  // Check for confirm
  if (confirmKeywords.some(k => lowerMessage.includes(k))) {
    // Find the most recent pending plan
    const plans = Array.from(pendingPlans.values());
    const pendingPlan = plans.find(p => p.status === 'pending_confirmation');
    if (pendingPlan) {
      return pendingPlan.id;
    }
  }

  return null;
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
    // Check if user is confirming a pending plan
    const confirmationResult = checkForConfirmation(userMessage);

    if (confirmationResult === 'cancel') {
      // Cancel all pending plans
      const plans = Array.from(pendingPlans.values());
      for (const plan of plans) {
        if (plan.status === 'pending_confirmation') {
          plan.status = 'cancelled';
          pendingPlans.delete(plan.id);
        }
      }
      return {
        message: 'Sipariş planı iptal edildi.',
        toolsUsed: [],
        actionTaken: 'plan_cancelled',
      };
    }

    if (confirmationResult && confirmationResult !== 'cancel') {
      // Execute the confirmed plan
      toolsUsed.push('execute_order_plan');
      const result = await executeTool('execute_order_plan', { planId: confirmationResult });

      if (result.success) {
        return {
          message: `✅ ${(result.data as { message: string }).message}`,
          toolsUsed,
          actionTaken: 'orders_created',
        };
      } else {
        return {
          message: `❌ Hata: ${result.error}`,
          toolsUsed,
          error: result.error,
        };
      }
    }

    // Build messages for Claude
    const messages: Anthropic.Messages.MessageParam[] = [
      ...conversationHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user' as const, content: userMessage },
    ];

    // First API call
    let response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: AGENT_SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      messages,
    });

    // Agentic loop - process tool calls
    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use'
      );

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const toolName = toolUse.name as AgentToolName;
        toolsUsed.push(toolName);

        console.log(`[Agent] Tool call: ${toolName}`, toolUse.input);

        const result = await executeTool(toolName, toolUse.input as Record<string, unknown>);

        console.log(`[Agent] Tool result:`, result.success ? 'success' : result.error);

        // Check if this is an action that requires confirmation
        if (result.requiresConfirmation) {
          requiresConfirmation = true;
          planId = result.planId;
          actionTaken = 'plan_created';
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      // Continue conversation with tool results
      messages.push({
        role: 'assistant',
        content: response.content,
      });
      messages.push({
        role: 'user',
        content: toolResults,
      });

      // Next API call
      response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system: AGENT_SYSTEM_PROMPT,
        tools: AGENT_TOOLS,
        messages,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === 'text'
    );
    const finalMessage = textBlocks.map(b => b.text).join('\n');

    return {
      message: finalMessage,
      toolsUsed,
      actionTaken,
      requiresConfirmation,
      planId,
    };
  } catch (error) {
    console.error('[Agent] Error:', error);
    return {
      message: 'Bir hata oluştu. Lütfen tekrar deneyin.',
      toolsUsed,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

// Streaming version of agent (for future use)
export async function runAgentStream(
  userMessage: string,
  conversationHistory: AgentMessage[] = [],
  onChunk: (chunk: string) => void
): Promise<AgentResponse> {
  // For now, use non-streaming version and emit result at once
  const result = await runAgent(userMessage, conversationHistory);
  onChunk(result.message);
  return result;
}
