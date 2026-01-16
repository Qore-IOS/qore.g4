import { anthropic, CLAUDE_MODEL, SYSTEM_PROMPT, MAX_TOKENS, ERROR_MESSAGES } from './config';
import { planQueries, QueryPlan } from './queryPlanner';
import { fetchDataForQueries, FetchedData } from './dataFetcher';
import Anthropic from '@anthropic-ai/sdk';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  message: string;
  queryPlan?: QueryPlan;
  fetchedData?: FetchedData;
  error?: string;
}

// Format fetched data as context for AI
function formatDataAsContext(data: FetchedData): string {
  const parts: string[] = [];

  if (data.stocks && data.stocks.length > 0) {
    parts.push('## Stok Verileri');
    parts.push('| Ürün Kodu | Ürün Adı | Lot | Miad | Miktar | Lokasyon |');
    parts.push('|-----------|----------|-----|------|--------|----------|');
    for (const item of data.stocks.slice(0, 50)) {
      parts.push(`| ${item.stokKodu} | ${item.stokAdi} | ${item.lotNumarasi || '-'} | ${item.miad || '-'} | ${item.miktar} | ${item.lokasyon} |`);
    }
    if (data.stocks.length > 50) {
      parts.push(`\n*... ve ${data.stocks.length - 50} kayıt daha*`);
    }
  }

  if (data.hospitalStocks && data.hospitalStocks.length > 0) {
    parts.push('\n## Hastane Bazlı Stok Durumu');
    for (const hospital of data.hospitalStocks.slice(0, 20)) {
      parts.push(`\n### ${hospital.hospitalName} (Toplam: ${hospital.totalItems} adet)`);
      if (hospital.items.length > 0) {
        parts.push('| Ürün Kodu | Ürün Adı | Lot | Miad | Miktar |');
        parts.push('|-----------|----------|-----|------|--------|');
        for (const item of hospital.items.slice(0, 10)) {
          parts.push(`| ${item.stokKodu} | ${item.stokAdi} | ${item.lotNumarasi || '-'} | ${item.miad || '-'} | ${item.miktar} |`);
        }
      }
    }
  }

  if (data.consumptions && data.consumptions.length > 0) {
    parts.push('\n## Tüketim Verileri');
    parts.push('| Ürün Kodu | Ürün Adı | Miktar | Dönem | Hastane |');
    parts.push('|-----------|----------|--------|-------|---------|');
    for (const item of data.consumptions.slice(0, 30)) {
      parts.push(`| ${item.stokKodu} | ${item.stokAdi} | ${item.miktar} | ${item.tarih} | ${item.hospital} |`);
    }
  }

  if (data.deviceFaults && data.deviceFaults.length > 0) {
    parts.push('\n## Cihaz Arıza Kayıtları');
    parts.push('| Hastane | Model | Seri No | Arıza Tipi | Açıklama | Durum | Tarih |');
    parts.push('|---------|-------|---------|------------|----------|-------|-------|');
    for (const fault of data.deviceFaults.slice(0, 20)) {
      const desc = fault.description?.length > 50 ? fault.description.slice(0, 50) + '...' : fault.description || '-';
      parts.push(`| ${fault.hospital} | ${fault.model} | ${fault.seriNumarasi} | ${fault.faultType} | ${desc} | ${fault.status} | ${fault.openedAt} |`);
    }
  }

  if (data.efficiencyData && data.efficiencyData.length > 0) {
    parts.push('\n## Verimlilik Verileri');
    for (const eff of data.efficiencyData.slice(0, 10)) {
      parts.push(`\n### ${eff.hospitalName} - ${eff.year}/${eff.month}`);
      if (Object.keys(eff.verimlilikSonuclari).length > 0) {
        parts.push('**Verimlilik Sonuçları:**');
        parts.push('```json');
        parts.push(JSON.stringify(eff.verimlilikSonuclari, null, 2));
        parts.push('```');
      }
      if (Object.keys(eff.hesaplananTestBazliTuketim).length > 0) {
        parts.push('**Test Bazlı Tüketim:**');
        parts.push('```json');
        parts.push(JSON.stringify(eff.hesaplananTestBazliTuketim, null, 2));
        parts.push('```');
      }
    }
  }

  if (data.products && data.products.length > 0) {
    parts.push('\n## Ürün Bilgileri');
    parts.push('| Stok Kodu | Ürün Adı | Grup | Marka | Ambalaj |');
    parts.push('|-----------|----------|------|-------|---------|');
    for (const product of data.products) {
      parts.push(`| ${product.stokKodu} | ${product.stokAdi} | ${product.urunGrubu || '-'} | ${product.marka || '-'} | ${product.ambalajDegeri || '-'} |`);
    }
  }

  if (parts.length === 0) {
    return 'Sorgunuzla ilgili veri bulunamadı.';
  }

  return parts.join('\n');
}

// Convert our ChatMessage to Anthropic format
function toAnthropicMessages(
  history: ChatMessage[]
): Anthropic.Messages.MessageParam[] {
  return history.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

// Classify error type for better user feedback
function classifyError(error: unknown): string {
  console.error('[Claude] Error details:', {
    name: error instanceof Error ? error.name : 'unknown',
    message: error instanceof Error ? error.message : String(error),
    type: error?.constructor?.name,
  });

  if (error instanceof Anthropic.APIError) {
    console.error('[Claude] Anthropic API Error:', {
      status: error.status,
      message: error.message,
    });

    if (error.status === 401) {
      return 'API anahtarı geçersiz veya süresi dolmuş. Lütfen console.anthropic.com adresinden yeni bir anahtar alın.';
    }
    if (error.status === 403) {
      return 'API anahtarının bu işlem için yetkisi yok. Lütfen API anahtar izinlerini kontrol edin.';
    }
    if (error.status === 429) {
      return ERROR_MESSAGES.RATE_LIMIT;
    }
    if (error.status === 400) {
      return ERROR_MESSAGES.INVALID_REQUEST;
    }
    if (error.status >= 500) {
      return 'Claude API geçici olarak kullanılamıyor. Lütfen tekrar deneyin.';
    }
  }

  if (error instanceof Anthropic.AuthenticationError) {
    return 'API anahtarı geçersiz. Lütfen doğru Anthropic API anahtarını girdiğinizden emin olun.';
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // Network errors
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('enotfound') || msg.includes('econnrefused')) {
      return ERROR_MESSAGES.NETWORK_ERROR;
    }

    // API key related errors
    if (msg.includes('api_key') || msg.includes('apikey') || msg.includes('authentication') || msg.includes('unauthorized')) {
      return 'API anahtarı ile ilgili bir sorun var. Lütfen API anahtarınızı kontrol edin.';
    }

    // Timeout errors
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'İstek zaman aşımına uğradı. Lütfen tekrar deneyin.';
    }
  }

  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

// Main chat function (non-streaming)
export async function chat(
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<ChatResponse> {
  try {
    // Step 1: Plan queries based on user message
    console.log('[Claude] Planning queries for:', userMessage);
    const queryPlan = await planQueries(userMessage);
    console.log('[Claude] Query plan:', JSON.stringify(queryPlan, null, 2));

    // Step 2: Fetch data based on query plan
    console.log('[Claude] Fetching data...');
    const fetchedData = await fetchDataForQueries(queryPlan.queries);
    console.log('[Claude] Fetched data summary:', fetchedData.summary);

    // Step 3: Format data as context
    const dataContext = formatDataAsContext(fetchedData);

    // Step 4: Build the prompt with context
    const contextualPrompt = `# Sistemden Çekilen Güncel Veriler

${dataContext}

---

**Kullanıcı Sorusu:** ${userMessage}

Yukarıdaki verileri kullanarak soruyu cevapla. Verilerde olmayan bilgileri uydurma.`;

    // Step 5: Build message history
    const messages: Anthropic.Messages.MessageParam[] = [
      ...toAnthropicMessages(conversationHistory),
      { role: 'user', content: contextualPrompt },
    ];

    // Step 6: Generate response
    console.log('[Claude] Generating response...');
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
    });

    // Extract text from response
    const textContent = response.content.find((block) => block.type === 'text');
    const responseText = textContent?.type === 'text' ? textContent.text : '';

    console.log('[Claude] Response generated successfully');

    return {
      message: responseText,
      queryPlan,
      fetchedData,
    };
  } catch (error) {
    console.error('[Claude] Chat error:', error);
    const errorMessage = classifyError(error);

    return {
      message: errorMessage,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

// Streaming chat (for real-time response)
export async function chatStream(
  userMessage: string,
  conversationHistory: ChatMessage[] = [],
  onChunk: (chunk: string) => void
): Promise<ChatResponse> {
  try {
    // Step 1: Plan queries
    console.log('[Claude Stream] Planning queries for:', userMessage);
    const queryPlan = await planQueries(userMessage);
    console.log('[Claude Stream] Query plan:', JSON.stringify(queryPlan, null, 2));

    // Step 2: Fetch data
    console.log('[Claude Stream] Fetching data...');
    const fetchedData = await fetchDataForQueries(queryPlan.queries);
    console.log('[Claude Stream] Fetched data summary:', fetchedData.summary);

    // Step 3: Format context
    const dataContext = formatDataAsContext(fetchedData);

    // Step 4: Build the prompt
    const contextualPrompt = `# Sistemden Çekilen Güncel Veriler

${dataContext}

---

**Kullanıcı Sorusu:** ${userMessage}

Yukarıdaki verileri kullanarak soruyu cevapla. Verilerde olmayan bilgileri uydurma.`;

    // Step 5: Build messages
    const messages: Anthropic.Messages.MessageParam[] = [
      ...toAnthropicMessages(conversationHistory),
      { role: 'user', content: contextualPrompt },
    ];

    // Step 6: Stream response
    console.log('[Claude Stream] Starting stream...');
    const stream = await anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
    });

    let fullMessage = '';

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const text = event.delta.text;
        fullMessage += text;
        onChunk(text);
      }
    }

    console.log('[Claude Stream] Stream completed');

    return {
      message: fullMessage,
      queryPlan,
      fetchedData,
    };
  } catch (error) {
    console.error('[Claude Stream] Error:', error);
    const errorMessage = classifyError(error);
    onChunk(errorMessage);

    return {
      message: errorMessage,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}
