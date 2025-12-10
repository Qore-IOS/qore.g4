import { ai, GEMINI_MODEL, SYSTEM_PROMPT } from './config';
import { planQueries, QueryPlan } from './queryPlanner';
import { fetchDataForQueries, FetchedData } from './dataFetcher';

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
      parts.push(`... ve ${data.stocks.length - 50} kayıt daha`);
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
      parts.push(`| ${fault.hospital} | ${fault.model} | ${fault.seriNumarasi} | ${fault.faultType} | ${fault.description.slice(0, 50)}... | ${fault.status} | ${fault.openedAt} |`);
    }
  }

  if (data.efficiencyData && data.efficiencyData.length > 0) {
    parts.push('\n## Verimlilik Verileri');
    for (const eff of data.efficiencyData.slice(0, 10)) {
      parts.push(`\n### ${eff.hospitalName} - ${eff.year}/${eff.month}`);
      if (Object.keys(eff.verimlilikSonuclari).length > 0) {
        parts.push('Verimlilik Sonuçları: ' + JSON.stringify(eff.verimlilikSonuclari, null, 2));
      }
      if (Object.keys(eff.hesaplananTestBazliTuketim).length > 0) {
        parts.push('Test Bazlı Tüketim: ' + JSON.stringify(eff.hesaplananTestBazliTuketim, null, 2));
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

// Main chat function
export async function chat(
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<ChatResponse> {
  try {
    // Step 1: Plan queries based on user message
    console.log('Planning queries for:', userMessage);
    const queryPlan = await planQueries(userMessage);
    console.log('Query plan:', queryPlan);

    // Step 2: Fetch data based on query plan
    console.log('Fetching data...');
    const fetchedData = await fetchDataForQueries(queryPlan.queries);
    console.log('Fetched data summary:', fetchedData.summary);

    // Step 3: Format data as context
    const dataContext = formatDataAsContext(fetchedData);

    // Step 4: Build conversation for AI
    const messages = [
      ...conversationHistory.map(msg => ({
        role: msg.role as 'user' | 'model',
        content: [{ text: msg.content }],
      })),
    ];

    // Step 5: Generate response with context
    const prompt = `${SYSTEM_PROMPT}

---
# Sistemden Çekilen Güncel Veriler

${dataContext}

---

Kullanıcı Sorusu: ${userMessage}

Yukarıdaki verileri kullanarak soruyu cevapla. Verilerde olmayan bilgileri uydurma.`;

    const { text } = await ai.generate({
      model: GEMINI_MODEL,
      prompt,
      config: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    });

    return {
      message: text,
      queryPlan,
      fetchedData,
    };
  } catch (error) {
    console.error('Chat error:', error);
    return {
      message: 'Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.',
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
    const queryPlan = await planQueries(userMessage);

    // Step 2: Fetch data
    const fetchedData = await fetchDataForQueries(queryPlan.queries);

    // Step 3: Format context
    const dataContext = formatDataAsContext(fetchedData);

    // Step 4: Generate response with streaming
    const prompt = `${SYSTEM_PROMPT}

---
# Sistemden Çekilen Güncel Veriler

${dataContext}

---

Kullanıcı Sorusu: ${userMessage}

Yukarıdaki verileri kullanarak soruyu cevapla. Verilerde olmayan bilgileri uydurma.`;

    const { stream } = await ai.generateStream({
      model: GEMINI_MODEL,
      prompt,
      config: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    });

    let fullMessage = '';
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        fullMessage += text;
        onChunk(text);
      }
    }

    return {
      message: fullMessage,
      queryPlan,
      fetchedData,
    };
  } catch (error) {
    console.error('Chat stream error:', error);
    const errorMessage = 'Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.';
    onChunk(errorMessage);
    return {
      message: errorMessage,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}
