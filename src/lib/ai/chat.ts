import { anthropic, CLAUDE_MODEL, MAX_TOKENS, ERROR_MESSAGES } from './config';
import { planQueries, QueryPlan } from './queryPlanner';
import { fetchDataForQueries, FetchedData } from './dataFetcher';
import { executeSmartQuery, SmartQueryResult } from './smartQueryEngine';
import Anthropic from '@anthropic-ai/sdk';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  message: string;
  queryPlan?: QueryPlan;
  fetchedData?: FetchedData;
  smartQueryResult?: SmartQueryResult;
  error?: string;
}

// ============================================
// ENHANCED SYSTEM PROMPT
// ============================================

const ENHANCED_SYSTEM_PROMPT = `Sen Qore sisteminin yapay zeka asistanisin. Turkce konusuyorsun ve saglik sektoru ERP sisteminde uzmanlasmis bir asistansin.

## KRITIK KURALLAR (MUTLAKA UY)

### 1. HALUSINASYON YASAK
- SADECE sana verilen "Sistemden Cekilen Veriler" bolumundeki verileri kullan
- Verilerde OLMAYAN bilgileri KESINLIKLE uydurma
- Emin olmadigin bir sey varsa "Bu bilgi mevcut verilerde bulunmuyor" de
- Tahmini rakamlar verme, sadece gercek verileri aktar

### 2. VERI YOKSA SOYLE
- Eger sorguyla ilgili veri bulunamadiysa bunu acikca belirt
- "Veri bulunamadi" yerine "X ile ilgili kayit sistemde mevcut degil" gibi spesifik ol
- Kullaniciya hangi bilgiyi vermesi gerektigini oner

### 3. DOGAL DIL ANLAMA
- Kullanici "Line 7", "L7", "7. Line", "Lab 7" diyebilir - hepsi ayni laboratuvar
- "TSH" dediginde "TSH ELECSYS" veya benzer urunleri anla
- Eksik bilgiyle bile en iyi eslestirmeyi yapmaya calis

## GOREVLERIN

1. **Stok Yonetimi**: Urun stoklarini sorgulama, lot ve miad takibi, depo bazli stok durumu
2. **Transfer Onerileri**: Hastaneler arasi optimal stok transferi onerileri
3. **Cihaz Ariza Analizi**: Ariza raporlarini analiz etme, teknik servis/aplikasyon ayrimi
4. **Verimlilik Raporlari**: Test bazli tuketim ve cihaz verimliligi analizi
5. **Miad Takibi**: Son kullanma tarihi yaklasan urunlerin tespiti ve uyarilari
6. **Tuketim Analizi**: Hastane bazli tuketim trendleri ve ongorular

## AKILLI CEVAPLAMA

Karmasik sorularda birden fazla veri kaynagini birlestir:
- "Lab X verimlilik trendleri" = stok + ariza + tuketim + verimlilik verileri
- "Y urunune ihtiyac duyan lablar" = tum hastane stoklari + min/max kurallari
- "Son arizalar ve sebepleri" = ariza kayitlari + cihaz bilgileri + gecmis kayitlar

## CEVAP FORMATI

- Listeler icin madde isaretleri kullan
- Sayisal karsilastirmalar icin tablo formati tercih et
- Kritik bilgileri **kalin** yap
- Tarih formati: GG.AA.YYYY
- Sayilari yuvarla (47.3 -> 47)

## ONEMLI UYARILAR

Asagidaki durumlarda MUTLAKA uyari ver:
- Miadi 30 gun icinde dolacak urunler (KRITIK)
- Minimum stok seviyesinin altindaki urunler (DUSUK STOK)
- 7 gunden fazla acik kalan cihaz arizalari (GECIKEN ARIZA)
- Verimlilik %70 altindaki laboratuvarlar (DUSUK VERIMLILIK)
`;

// Format fetched data as context for AI
function formatDataAsContext(data: FetchedData): string {
  const parts: string[] = [];

  if (data.stocks && data.stocks.length > 0) {
    parts.push('## Stok Verileri');
    parts.push('| Urun Kodu | Urun Adi | Lot | Miad | Miktar | Lokasyon |');
    parts.push('|-----------|----------|-----|------|--------|----------|');
    for (const item of data.stocks.slice(0, 50)) {
      parts.push(`| ${item.stokKodu} | ${item.stokAdi} | ${item.lotNumarasi || '-'} | ${item.miad || '-'} | ${item.miktar} | ${item.lokasyon} |`);
    }
    if (data.stocks.length > 50) {
      parts.push(`\n*... ve ${data.stocks.length - 50} kayit daha*`);
    }
  }

  if (data.hospitalStocks && data.hospitalStocks.length > 0) {
    parts.push('\n## Hastane Bazli Stok Durumu');
    for (const hospital of data.hospitalStocks.slice(0, 20)) {
      parts.push(`\n### ${hospital.hospitalName} (Toplam: ${hospital.totalItems} adet)`);
      if (hospital.items.length > 0) {
        parts.push('| Urun Kodu | Urun Adi | Lot | Miad | Miktar |');
        parts.push('|-----------|----------|-----|------|--------|');
        for (const item of hospital.items.slice(0, 10)) {
          parts.push(`| ${item.stokKodu} | ${item.stokAdi} | ${item.lotNumarasi || '-'} | ${item.miad || '-'} | ${item.miktar} |`);
        }
      }
    }
  }

  if (data.consumptions && data.consumptions.length > 0) {
    parts.push('\n## Tuketim Verileri');
    parts.push('| Urun Kodu | Urun Adi | Miktar | Donem | Hastane |');
    parts.push('|-----------|----------|--------|-------|---------|');
    for (const item of data.consumptions.slice(0, 30)) {
      parts.push(`| ${item.stokKodu} | ${item.stokAdi} | ${item.miktar} | ${item.tarih} | ${item.hospital} |`);
    }
  }

  if (data.deviceFaults && data.deviceFaults.length > 0) {
    parts.push('\n## Cihaz Ariza Kayitlari');
    parts.push('| Hastane | Model | Seri No | Ariza Tipi | Aciklama | Durum | Tarih |');
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
        parts.push('**Verimlilik Sonuclari:**');
        parts.push('```json');
        parts.push(JSON.stringify(eff.verimlilikSonuclari, null, 2));
        parts.push('```');
      }
      if (Object.keys(eff.hesaplananTestBazliTuketim).length > 0) {
        parts.push('**Test Bazli Tuketim:**');
        parts.push('```json');
        parts.push(JSON.stringify(eff.hesaplananTestBazliTuketim, null, 2));
        parts.push('```');
      }
    }
  }

  if (data.products && data.products.length > 0) {
    parts.push('\n## Urun Bilgileri');
    parts.push('| Stok Kodu | Urun Adi | Grup | Marka | Ambalaj |');
    parts.push('|-----------|----------|------|-------|---------|');
    for (const product of data.products) {
      parts.push(`| ${product.stokKodu} | ${product.stokAdi} | ${product.urunGrubu || '-'} | ${product.marka || '-'} | ${product.ambalajDegeri || '-'} |`);
    }
  }

  if (parts.length === 0) {
    return 'Sorgunuzla ilgili veri bulunamadi.';
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
      return 'API anahtari gecersiz veya suresi dolmus. Lutfen console.anthropic.com adresinden yeni bir anahtar alin.';
    }
    if (error.status === 403) {
      return 'API anahtarinin bu islem icin yetkisi yok. Lutfen API anahtar izinlerini kontrol edin.';
    }
    if (error.status === 429) {
      return ERROR_MESSAGES.RATE_LIMIT;
    }
    if (error.status === 400) {
      return ERROR_MESSAGES.INVALID_REQUEST;
    }
    if (error.status >= 500) {
      return 'Claude API gecici olarak kullanilamiyor. Lutfen tekrar deneyin.';
    }
  }

  if (error instanceof Anthropic.AuthenticationError) {
    return 'API anahtari gecersiz. Lutfen dogru Anthropic API anahtarini girdiginizden emin olun.';
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // Network errors
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('enotfound') || msg.includes('econnrefused')) {
      return ERROR_MESSAGES.NETWORK_ERROR;
    }

    // API key related errors
    if (msg.includes('api_key') || msg.includes('apikey') || msg.includes('authentication') || msg.includes('unauthorized')) {
      return 'API anahtari ile ilgili bir sorun var. Lutfen API anahtarinizi kontrol edin.';
    }

    // Timeout errors
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'Istek zaman asimina ugradi. Lutfen tekrar deneyin.';
    }
  }

  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

// ============================================
// HALLUCINATION GUARD
// ============================================

function addHallucinationGuard(context: string, hasData: boolean): string {
  if (!hasData) {
    return `# UYARI: VERI BULUNAMADI

Sorguyla ilgili sistemde veri bulunamadi.

KESINLIKLE veri uydurma. Kullaniciya su sekilde cevap ver:
- Hangi veriyi aradiginizi belirtin
- Veri bulunamadigi icin soruyu cevaplayamiyorum
- Farkli bir ifade veya daha spesifik bilgi (hastane adi, urun kodu vb.) ile tekrar deneyin

---

${context}`;
  }

  return `# ONEMLI: Asagidaki veriler sistemden cekilmis GERCEK verilerdir.
# SADECE bu verileri kullan, ASLA veri uydurma.
# Verilerde olmayan bir bilgi sorulursa "Bu bilgi mevcut verilerde bulunmuyor" de.

${context}`;
}

// ============================================
// SMART CHAT FUNCTION
// ============================================

export async function smartChat(
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<ChatResponse> {
  try {
    // Step 1: Use Smart Query Engine
    console.log('[SmartChat] Processing:', userMessage);
    const smartResult = await executeSmartQuery(userMessage);
    console.log('[SmartChat] Smart query result:', smartResult.summary);

    // Step 2: Build contextual prompt with hallucination guard
    const guardedContext = addHallucinationGuard(
      smartResult.context,
      smartResult.dataQuality.hasData
    );

    // Add entity resolution info
    let entityInfo = '';
    if (smartResult.queryPlan.intent.entities.hospitals.length > 0) {
      entityInfo += `\n## Tespit Edilen Hastane/Lab\n`;
      for (const h of smartResult.queryPlan.intent.entities.hospitals) {
        entityInfo += `- ${h.name} (ID: ${h.id}, Guven: ${Math.round(h.confidence * 100)}%)\n`;
      }
    }
    if (smartResult.queryPlan.intent.entities.products.length > 0) {
      entityInfo += `\n## Tespit Edilen Urunler\n`;
      for (const p of smartResult.queryPlan.intent.entities.products) {
        entityInfo += `- ${p.name} (Kod: ${p.id}, Guven: ${Math.round(p.confidence * 100)}%)\n`;
      }
    }

    const contextualPrompt = `# Sistemden Cekilen Guncel Veriler

${guardedContext}

${entityInfo}

---

**Kullanici Sorusu:** ${userMessage}

**Sorgu Bilgisi:**
- Cekilen veri kaynaklari: ${smartResult.queryPlan.executedQueries.join(', ')}
- Veri durumu: ${smartResult.dataQuality.hasData ? 'Veri bulundu' : 'Veri bulunamadi'}
${smartResult.dataQuality.warnings.length > 0 ? `- Uyarilar: ${smartResult.dataQuality.warnings.join(', ')}` : ''}

Yukaridaki verileri kullanarak soruyu cevapla. Verilerde olmayan bilgileri KESINLIKLE uydurma.`;

    // Step 3: Build messages
    const messages: Anthropic.Messages.MessageParam[] = [
      ...toAnthropicMessages(conversationHistory),
      { role: 'user', content: contextualPrompt },
    ];

    // Step 4: Generate response
    console.log('[SmartChat] Generating response...');
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: ENHANCED_SYSTEM_PROMPT,
      messages,
    });

    // Extract text
    const textContent = response.content.find((block) => block.type === 'text');
    const responseText = textContent?.type === 'text' ? textContent.text : '';

    console.log('[SmartChat] Response generated successfully');

    return {
      message: responseText,
      smartQueryResult: smartResult,
    };
  } catch (error) {
    console.error('[SmartChat] Error:', error);
    const errorMessage = classifyError(error);

    return {
      message: errorMessage,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

// ============================================
// LEGACY CHAT FUNCTION (for backward compatibility)
// ============================================

export async function chat(
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<ChatResponse> {
  // Use smart chat by default
  return smartChat(userMessage, conversationHistory);
}

// Streaming smart chat
export async function smartChatStream(
  userMessage: string,
  conversationHistory: ChatMessage[] = [],
  onChunk: (chunk: string) => void
): Promise<ChatResponse> {
  try {
    // Step 1: Use Smart Query Engine
    console.log('[SmartChatStream] Processing:', userMessage);
    const smartResult = await executeSmartQuery(userMessage);
    console.log('[SmartChatStream] Smart query result:', smartResult.summary);

    // Step 2: Build contextual prompt
    const guardedContext = addHallucinationGuard(
      smartResult.context,
      smartResult.dataQuality.hasData
    );

    let entityInfo = '';
    if (smartResult.queryPlan.intent.entities.hospitals.length > 0) {
      entityInfo += `\n## Tespit Edilen Hastane/Lab\n`;
      for (const h of smartResult.queryPlan.intent.entities.hospitals) {
        entityInfo += `- ${h.name} (ID: ${h.id})\n`;
      }
    }
    if (smartResult.queryPlan.intent.entities.products.length > 0) {
      entityInfo += `\n## Tespit Edilen Urunler\n`;
      for (const p of smartResult.queryPlan.intent.entities.products) {
        entityInfo += `- ${p.name} (Kod: ${p.id})\n`;
      }
    }

    const contextualPrompt = `# Sistemden Cekilen Guncel Veriler

${guardedContext}

${entityInfo}

---

**Kullanici Sorusu:** ${userMessage}

Yukaridaki verileri kullanarak soruyu cevapla. Verilerde olmayan bilgileri KESINLIKLE uydurma.`;

    // Step 3: Build messages
    const messages: Anthropic.Messages.MessageParam[] = [
      ...toAnthropicMessages(conversationHistory),
      { role: 'user', content: contextualPrompt },
    ];

    // Step 4: Stream response
    console.log('[SmartChatStream] Starting stream...');
    const stream = await anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: ENHANCED_SYSTEM_PROMPT,
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

    console.log('[SmartChatStream] Stream completed');

    return {
      message: fullMessage,
      smartQueryResult: smartResult,
    };
  } catch (error) {
    console.error('[SmartChatStream] Error:', error);
    const errorMessage = classifyError(error);
    onChunk(errorMessage);

    return {
      message: errorMessage,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

// Legacy streaming function (for backward compatibility)
export async function chatStream(
  userMessage: string,
  conversationHistory: ChatMessage[] = [],
  onChunk: (chunk: string) => void
): Promise<ChatResponse> {
  // Use smart chat stream by default
  return smartChatStream(userMessage, conversationHistory, onChunk);
}
