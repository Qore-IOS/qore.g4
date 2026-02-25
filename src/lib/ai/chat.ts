import { MAX_TOKENS, ERROR_MESSAGES } from './config';
import { executeSmartQuery, SmartQueryResult } from './smartQueryEngine';
import { generateWithGemini } from './geminiClient';
import { aiLogger } from '@/lib/logger';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  message: string;
  queryPlan?: unknown;
  fetchedData?: { summary?: string };
  smartQueryResult?: SmartQueryResult;
  error?: string;
}

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

## CEVAP FORMATI
- Listeler icin madde isaretleri kullan
- Sayisal karsilastirmalar icin tablo formati tercih et
- Kritik bilgileri **kalin** yap
- Tarih formati: GG.AA.YYYY`;

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

function classifyError(error: unknown): string {
  aiLogger.error('AI error occurred', error);

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (msg.includes('401') || msg.includes('api key') || msg.includes('authentication') || msg.includes('unauthorized')) {
      return 'API anahtari gecersiz veya suresi dolmus. Lutfen Gemini API anahtarinizi kontrol edin.';
    }
    if (msg.includes('429') || msg.includes('rate')) {
      return ERROR_MESSAGES.RATE_LIMIT;
    }
    if (msg.includes('500') || msg.includes('503')) {
      return 'Gemini API gecici olarak kullanilamiyor. Lutfen tekrar deneyin.';
    }
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('enotfound') || msg.includes('econnrefused')) {
      return ERROR_MESSAGES.NETWORK_ERROR;
    }

    return `Hata: ${error.message}`;
  }

  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

function buildContextualPrompt(userMessage: string, smartResult: SmartQueryResult): string {
  const guardedContext = addHallucinationGuard(smartResult.context, smartResult.dataQuality.hasData);

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

  return `# Sistemden Cekilen Guncel Veriler

${guardedContext}

${entityInfo}

---

**Kullanici Sorusu:** ${userMessage}

**Sorgu Bilgisi:**
- Cekilen veri kaynaklari: ${smartResult.queryPlan.executedQueries.join(', ')}
- Veri durumu: ${smartResult.dataQuality.hasData ? 'Veri bulundu' : 'Veri bulunamadi'}
${smartResult.dataQuality.warnings.length > 0 ? `- Uyarilar: ${smartResult.dataQuality.warnings.join(', ')}` : ''}

Yukaridaki verileri kullanarak soruyu cevapla. Verilerde olmayan bilgileri KESINLIKLE uydurma.`;
}

function looksLikeFollowUp(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return [
    'tüm laboratuvarlar',
    'tum laboratuvarlar',
    'hepsi',
    'tamami',
    'devam et',
    'detay',
    'hepsi için',
    'hepsi icin',
  ].includes(normalized) || normalized.length <= 20;
}

function withFollowUpContext(userMessage: string, conversationHistory: ChatMessage[]): string {
  if (!looksLikeFollowUp(userMessage)) return userMessage;

  const previousUser = [...conversationHistory]
    .reverse()
    .find((m) => m.role === 'user' && m.content.trim().length > 0);

  if (!previousUser) return userMessage;
  return `${previousUser.content}
Takip cevabi: ${userMessage}`;
}

function extractRequestedLabLabel(query: string): string | null {
  const match = query.match(/(?:line|lab|laboratuvar)\s*(\d{1,2})/i);
  if (!match) return null;
  return `LINE ${match[1]}`;
}

function buildDeterministicAnswer(userMessage: string, smartResult: SmartQueryResult): string | null {
  const query = userMessage.toLowerCase();
  const data = smartResult.data as Record<string, unknown>;

  if ((query.includes('kac') || query.includes('kaç')) && query.includes('urun') && data.stock_by_hospital) {
    const stockData = data.stock_by_hospital as { totalItems?: number; hospitalName?: string };
    if (typeof stockData.totalItems === 'number') {
      const requestedLab = extractRequestedLabLabel(userMessage);
      const label = requestedLab || stockData.hospitalName || 'İlgili laboratuvar';
      return `${label} için sistemde toplam **${stockData.totalItems} adet** ürün kaydı bulunuyor.`;
    }
  }

  if ((query.includes('en cok ariza') || query.includes('en çok arıza') || query.includes('ariza veren cihaz')) && data.device_faults) {
    const faultData = data.device_faults as { byModel?: Record<string, number>; faults?: Array<{ hospital?: string; brand?: string; model?: string; serial?: string; description?: string; closeDescription?: string }> };
    const byModel = faultData.byModel || {};
    const sorted = Object.entries(byModel).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      const [model, count] = sorted[0];
      const related = (faultData.faults || []).filter((f) => (f.model || '-') === model).slice(0, 3);
      const lines = [`En çok arıza kaydı bulunan cihaz modeli: **${model}** (**${count} kayıt**).`];
      if (related.length > 0) {
        lines.push('Örnek arıza detayları:');
        for (const f of related) {
          lines.push(`- ${f.hospital || '-'} | ${f.brand ? `${f.brand} / ` : ''}${f.model || '-'} (${f.serial || '-'})`);
          lines.push(`  - Açılış: ${f.description || '-'}`);
          if (f.closeDescription) lines.push(`  - Kapanış: ${f.closeDescription}`);
        }
      }
      return lines.join('\n');
    }
  }

  if ((query.includes('tsh') || query.includes('kit')) && (query.includes('hangi laboratuvar') || query.includes('hangi lab') || query.includes('en cok') || query.includes('en çok')) && data.all_hospitals_stock) {
    const all = data.all_hospitals_stock as { hospitals?: Array<{ name: string; count: number; products: Record<string, number> }> };
    const product = smartResult.queryPlan.intent.entities.products[0];
    if (!product || !all.hospitals?.length) return null;

    const ranking = all.hospitals
      .map((h) => ({ name: h.name, amount: h.products?.[product.id] || 0 }))
      .filter((h) => h.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    if (ranking.length === 0) {
      return `Sistemde **${product.name}** için laboratuvar bazında stok kaydı bulunamadı.`;
    }

    const top = ranking[0];
    return [
      `En yüksek **${product.name}** stoğu: **${top.name}** (**${top.amount} adet**).`,
      'İlk laboratuvarlar:',
      ...ranking.slice(0, 5).map((r, i) => `${i + 1}. ${r.name}: ${r.amount} adet`),
    ].join('\n');
  }

  return null;
}


export async function smartChat(
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<ChatResponse> {
  try {
    const effectiveMessage = withFollowUpContext(userMessage, conversationHistory);
    aiLogger.info('Processing smart chat', { message: effectiveMessage.substring(0, 100) });
    const smartResult = await executeSmartQuery(effectiveMessage);

    const deterministic = buildDeterministicAnswer(effectiveMessage, smartResult);
    if (deterministic) {
      return {
        message: deterministic,
        queryPlan: smartResult.queryPlan,
        fetchedData: { summary: smartResult.summary },
        smartQueryResult: smartResult,
      };
    }

    const contextualPrompt = buildContextualPrompt(effectiveMessage, smartResult);
    const messages: ChatMessage[] = [
      ...conversationHistory,
      { role: 'user', content: contextualPrompt },
    ];

    const response = await generateWithGemini({
      systemPrompt: ENHANCED_SYSTEM_PROMPT,
      messages,
      temperature: 0.1,
      maxOutputTokens: MAX_TOKENS,
    });

    return {
      message: response.text,
      queryPlan: smartResult.queryPlan,
      fetchedData: { summary: smartResult.summary },
      smartQueryResult: smartResult,
    };
  } catch (error) {
    const errorMessage = classifyError(error);
    return {
      message: errorMessage,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

export async function chat(
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<ChatResponse> {
  return smartChat(userMessage, conversationHistory);
}

export async function smartChatStream(
  userMessage: string,
  conversationHistory: ChatMessage[] = [],
  onChunk: (chunk: string) => void
): Promise<ChatResponse> {
  const result = await smartChat(userMessage, conversationHistory);

  const chunks = result.message.match(/.{1,120}(\s|$)/g) || [result.message];
  for (const chunk of chunks) {
    onChunk(chunk);
  }

  return result;
}

export async function chatStream(
  userMessage: string,
  conversationHistory: ChatMessage[] = [],
  onChunk: (chunk: string) => void
): Promise<ChatResponse> {
  return smartChatStream(userMessage, conversationHistory, onChunk);
}
