import { generateWithGemini } from './geminiClient';

// Data query types that can be requested
export type QueryType =
  | 'stock_by_product'      // Belirli ürünün stok durumu
  | 'stock_by_hospital'     // Belirli hastanenin stokları
  | 'stock_by_depot'        // Belirli deponun stokları
  | 'all_hospitals_stock'   // Tüm hastanelerin belirli ürün stoğu (transfer önerisi için)
  | 'consumption_history'   // Tüketim geçmişi
  | 'device_faults'         // Cihaz arızaları
  | 'efficiency_data'       // Verimlilik verileri
  | 'expiring_stock'        // Miyadı yaklaşan stoklar
  | 'low_stock'             // Düşük stoklar
  | 'product_info';         // Ürün bilgisi

export interface QueryPlan {
  queries: Array<{
    type: QueryType;
    params: Record<string, string | number | boolean>;
  }>;
  reasoning: string;
}

const QUERY_PLANNER_PROMPT = `Sen bir sorgu planlayıcısısın. Kullanıcının sorusunu analiz edip hangi verilerin çekilmesi gerektiğini belirle.

## Kullanılabilir Sorgu Türleri

| Sorgu Türü | Açıklama | Parametreler |
|------------|----------|--------------|
| stock_by_product | Belirli bir ürünün stok durumu | stokKodu, stokAdi |
| stock_by_hospital | Belirli bir hastanenin tüm stokları | hospitalName, hospitalId |
| stock_by_depot | Belirli bir deponun tüm stokları | depotName, depotId |
| all_hospitals_stock | Tüm hastanelerdeki belirli ürünün stoğu | stokKodu (transfer önerileri için) |
| consumption_history | Tüketim geçmişi | stokKodu?, hospitalId?, days? |
| device_faults | Cihaz arızaları | hospitalId?, brand?, status? |
| efficiency_data | Verimlilik verileri | hospitalId?, year?, month? |
| expiring_stock | Miyadı yaklaşan stoklar | days?, hospitalId? |
| low_stock | Düşük stoklar | hospitalId? |
| product_info | Ürün bilgisi | stokKodu, stokAdi |

## Kurallar

1. Sadece soruyu cevaplamak için gerekli minimum veriyi iste
2. Transfer önerisi için mutlaka all_hospitals_stock kullan
3. Arıza analizi için device_faults kullan
4. Verimlilik için efficiency_data kullan
5. Miad sorguları için expiring_stock kullan
6. Birden fazla sorgu gerekebilir - hepsini listele

## Çıktı Formatı

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir açıklama ekleme:

{
  "queries": [
    { "type": "sorgu_tipi", "params": { "parametre": "deger" } }
  ],
  "reasoning": "Neden bu sorguları seçtiğinin kısa açıklaması"
}`;

export async function planQueries(userQuestion: string): Promise<QueryPlan> {
  try {
    const response = await generateWithGemini({
      temperature: 0,
      maxOutputTokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${QUERY_PLANNER_PROMPT}\n\nKullanıcı sorusu: "${userQuestion}"`,
        },
      ],
    });

    const text = response.text;

    // Parse JSON - Claude genellikle temiz JSON döner
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Query planner: JSON not found in response:', text);
      throw new Error('JSON bulunamadı');
    }

    const plan = JSON.parse(jsonMatch[0]) as QueryPlan;

    // Validate the plan
    if (!plan.queries || !Array.isArray(plan.queries) || plan.queries.length === 0) {
      throw new Error('Invalid query plan: no queries');
    }

    // Validate each query type
    const validTypes: QueryType[] = [
      'stock_by_product',
      'stock_by_hospital',
      'stock_by_depot',
      'all_hospitals_stock',
      'consumption_history',
      'device_faults',
      'efficiency_data',
      'expiring_stock',
      'low_stock',
      'product_info',
    ];

    for (const query of plan.queries) {
      if (!validTypes.includes(query.type)) {
        console.warn(`Invalid query type: ${query.type}, defaulting to product_info`);
        query.type = 'product_info';
      }
    }

    console.log('Query plan created:', plan);
    return plan;
  } catch (error) {
    console.error('Query plan error:', error);

    // Intelligent fallback based on keywords in the question
    const question = userQuestion.toLowerCase();
    const fallbackQueries: QueryPlan['queries'] = [];

    if (question.includes('arıza') || question.includes('cihaz') || question.includes('servis')) {
      fallbackQueries.push({ type: 'device_faults', params: { status: 'open' } });
    } else if (question.includes('transfer') || question.includes('dağıt')) {
      fallbackQueries.push({ type: 'all_hospitals_stock', params: {} });
    } else if (question.includes('verimlilik') || question.includes('performans')) {
      fallbackQueries.push({ type: 'efficiency_data', params: {} });
    } else if (question.includes('miad') || question.includes('son kullanma') || question.includes('expire')) {
      fallbackQueries.push({ type: 'expiring_stock', params: { days: 90 } });
    } else if (question.includes('tüketim') || question.includes('kullanım')) {
      fallbackQueries.push({ type: 'consumption_history', params: { days: 30 } });
    } else if (question.includes('hastane') || question.includes('hospital')) {
      fallbackQueries.push({ type: 'stock_by_hospital', params: {} });
    } else if (question.includes('stok') || question.includes('ürün') || question.includes('kit')) {
      fallbackQueries.push({ type: 'stock_by_product', params: {} });
    } else {
      fallbackQueries.push({ type: 'product_info', params: {} });
    }

    return {
      queries: fallbackQueries,
      reasoning: 'Sorgu planlaması başarısız oldu, anahtar kelime bazlı fallback kullanıldı',
    };
  }
}
