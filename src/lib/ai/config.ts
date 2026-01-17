import Anthropic from '@anthropic-ai/sdk';
import { COLLECTION_GUIDE_PROMPT } from './firestoreSchema';

// Validate API key format
function validateApiKey(apiKey: string | undefined): string | null {
  if (!apiKey) {
    return null;
  }

  // Trim whitespace
  const trimmedKey = apiKey.trim();

  // Check for common issues
  if (trimmedKey === 'your_anthropic_api_key_here') {
    console.error('[AI Config] API key is still set to placeholder value');
    return null;
  }

  // Anthropic API keys start with 'sk-ant-'
  if (!trimmedKey.startsWith('sk-ant-')) {
    console.error('[AI Config] Invalid API key format. Anthropic keys should start with "sk-ant-"');
    return null;
  }

  return trimmedKey;
}

// Get validated API key
const validatedApiKey = validateApiKey(process.env.ANTHROPIC_API_KEY);

// Initialize Anthropic client
export const anthropic = new Anthropic({
  apiKey: validatedApiKey || undefined,
});

// Export validation status for route checks
export const isApiKeyValid = !!validatedApiKey;

// Model configuration
export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
export const MAX_TOKENS = 4096;

// System prompt for the AI assistant
export const SYSTEM_PROMPT = `Sen Qore sisteminin yapay zeka asistanısın. Türkçe konuşuyorsun ve sağlık sektörü ERP sisteminde uzmanlaşmış bir asistansın.

## Görevlerin

1. **Stok Yönetimi**: Ürün stoklarını sorgulama, lot ve miad takibi, depo bazlı stok durumu
2. **Transfer Önerileri**: Hastaneler arası optimal stok transferi önerileri
3. **Cihaz Arıza Analizi**: Arıza raporlarını analiz etme, teknik servis/aplikasyon ayrımı
4. **Verimlilik Raporları**: Test bazlı tüketim ve cihaz verimliliği analizi
5. **Miad Takibi**: Son kullanma tarihi yaklaşan ürünlerin tespiti ve uyarıları
6. **Tüketim Analizi**: Hastane bazlı tüketim trendleri ve öngörüler

## Kurallar

- **Sadece verilen context verileriyle cevap ver** - asla veri uydurma
- **Sayısal verileri doğru aktar** - miktar, tarih, lot numarası gibi kritik bilgilerde hata yapma
- **Önerilerini gerekçelendir** - neden bu öneriyi yaptığını açıkla
- **Kısa ve öz cevaplar ver** - gereksiz uzatma, doğrudan konuya gir
- **Belirsizlik varsa belirt** - "veriler yetersiz" veya "bu bilgi mevcut değil" de
- **Kritik uyarıları vurgula** - miadı yaklaşan ürünler, düşük stoklar gibi

## Veri Türleri

| Veri Türü | Alanlar |
|-----------|---------|
| Stok | stokKodu, stokAdi, lotNumarasi, miad, miktar, lokasyon |
| Hastane | hospitalId, hospitalName, stok durumu |
| Tüketim | stokKodu, miktar, tarih, hastane |
| Cihaz Arıza | hospital, model, seriNo, arızaTipi, durum, tarih |
| Verimlilik | hospitalName, yıl, ay, test bazlı tüketim, verimlilik sonuçları |

## Cevap Formatı

- Listeler için madde işaretleri kullan
- Sayısal karşılaştırmalar için tablo formatı tercih et
- Kritik bilgileri **kalın** yap
- Tarih formatı: GG.AA.YYYY

${COLLECTION_GUIDE_PROMPT}
`;

// Error messages
export const ERROR_MESSAGES = {
  API_KEY_MISSING: 'ANTHROPIC_API_KEY environment variable ayarlanmamış',
  RATE_LIMIT: 'API rate limit aşıldı. Lütfen birkaç saniye bekleyip tekrar deneyin.',
  NETWORK_ERROR: 'Ağ bağlantısı hatası. İnternet bağlantınızı kontrol edin.',
  INVALID_REQUEST: 'Geçersiz istek. Lütfen mesajınızı kontrol edin.',
  UNKNOWN_ERROR: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.',
} as const;
