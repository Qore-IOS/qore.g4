import { ai, GEMINI_MODEL } from './config';

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

Kullanılabilir sorgu türleri:
- stock_by_product: Belirli bir ürünün stok durumu (params: stokKodu veya stokAdi)
- stock_by_hospital: Belirli bir hastanenin tüm stokları (params: hospitalName veya hospitalId)
- stock_by_depot: Belirli bir deponun tüm stokları (params: depotName veya depotId)
- all_hospitals_stock: Tüm hastanelerdeki belirli ürünün stoğu - transfer önerileri için (params: stokKodu)
- consumption_history: Tüketim geçmişi (params: stokKodu?, hospitalId?, days?)
- device_faults: Cihaz arızaları (params: hospitalId?, brand?, status?)
- efficiency_data: Verimlilik verileri (params: hospitalId?, year?, month?)
- expiring_stock: Miyadı yaklaşan stoklar (params: days?, hospitalId?)
- low_stock: Düşük stoklar (params: hospitalId?)
- product_info: Ürün bilgisi (params: stokKodu veya stokAdi)

Önemli:
- Sadece soruyu cevaplamak için gerekli minimum veriyi iste
- Transfer önerisi için all_hospitals_stock kullan
- Arıza analizi için device_faults kullan
- Verimlilik için efficiency_data kullan

JSON formatında cevap ver:
{
  "queries": [
    { "type": "query_type", "params": { "key": "value" } }
  ],
  "reasoning": "Neden bu sorguları seçtiğinin kısa açıklaması"
}`;

export async function planQueries(userQuestion: string): Promise<QueryPlan> {
  const { text } = await ai.generate({
    model: GEMINI_MODEL,
    prompt: `${QUERY_PLANNER_PROMPT}

Kullanıcı sorusu: "${userQuestion}"

JSON yanıtı:`,
    config: {
      temperature: 0.1, // Deterministik sonuç için düşük sıcaklık
    },
  });

  try {
    // JSON'u parse et
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('JSON bulunamadı');
    }

    const plan = JSON.parse(jsonMatch[0]) as QueryPlan;
    return plan;
  } catch (error) {
    console.error('Query plan parse error:', error);
    // Fallback: genel bir sorgu planı döndür
    return {
      queries: [{ type: 'product_info', params: {} }],
      reasoning: 'Soru anlaşılamadı, genel bilgi sorgusu yapılıyor',
    };
  }
}
