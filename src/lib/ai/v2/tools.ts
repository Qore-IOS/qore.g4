/**
 * Tool schemas exposed to Gemini's function-calling API.
 *
 * Each tool description is written for the model. It must explain WHEN to use
 * the tool and HOW to combine it with other tools. We keep them short but
 * concrete — the model reads these as the only documentation of the system.
 */
import type { GeminiFunctionDeclaration } from '@/lib/ai/geminiClient';

export const TOOL_SCHEMAS: GeminiFunctionDeclaration[] = [
  {
    name: 'resolve_entities',
    description:
      'Sorgudaki belirsiz isimleri sistem verilerine çözümler. Hastane/laboratuvar, ürün/test/kit veya cihaz arıyorsan ÖNCE bunu çağır. Kısaltma, eksik yazım ve takma adlar desteklenir (örn. "zkm" → Zeynep Kamil, "tsh" → TSH ELECSYS, "501" → Cobas 501). Geri dönen liste güven puanına göre sıralıdır — en yüksek skorlu adayı kullan, gerekirse kullanıcıya doğrula.',
    parameters: {
      type: 'object',
      properties: {
        hospitals_query: { type: 'string', description: 'Hastane/lab adı veya kısaltması (ör. "zkm", "feriha öz").' },
        products_query: { type: 'string', description: 'Ürün/test/kit adı veya kodu (ör. "crp", "tsh", "07298881190").' },
        devices_query: { type: 'string', description: 'Cihaz modeli/markası/seri (ör. "cobas 501", "e801", "sysmex").' },
        limit: { type: 'number', description: 'Her kategori için maksimum sonuç (varsayılan 5).' },
      },
      required: [],
    },
  },
  {
    name: 'list_hospitals',
    description:
      'Kullanıcının erişebildiği tüm hastane/laboratuvarları listeler. Kullanıcı genel envanter sorduğunda veya kapsam öğrenmek istediğinde kullan.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_product_definition',
    description:
      'Bir ürünün tanım kartını döner: stokKodu, stokAdı, marka, testAdı, cihazGrubu, ambalajDegeri (kutu başına test sayısı), urunGrubu (kit/sarf). "CRP testi ne?" gibi sorularda ürünün hangi kite bağlandığını anlamak için kullan.',
    parameters: {
      type: 'object',
      properties: {
        stokKodu: { type: 'string', description: 'Tam ürün kodu.' },
        searchText: { type: 'string', description: 'Bilinmiyorsa serbest metin (test adı/alias).' },
      },
      required: [],
    },
  },
  {
    name: 'get_lab_stock',
    description:
      'Belirli bir laboratuvarın güncel stokunu döner. Lot, miad ve birim sayısı içerir. ÜRÜN ile filtrelemek HER ZAMAN tercih edilir — boş bırakırsan tüm stok döner ve büyük olur. Soruda "X labında Y ürünü" geçiyorsa hospitalId VE stokKodu birlikte ver.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string', description: 'Hastane/lab ID. resolve_entities ile çözülmüş olmalı.' },
        stokKodu: { type: 'string', description: 'Belirli bir ürün kodu (opsiyonel).' },
        urunGrubu: { type: 'string', description: 'Sadece "kit" veya "sarf" filtrelemek için.' },
        limit: { type: 'number', description: 'Maks. lot kaydı (varsayılan 200).' },
      },
      required: ['hospitalId'],
    },
  },
  {
    name: 'get_depot_stock',
    description:
      'Depo stoğunu döner (henüz lab\'a sevk edilmemiş). Sipariş/sevk önerisi yaparken kullan.',
    parameters: {
      type: 'object',
      properties: {
        depotId: { type: 'string', description: 'Depo ID (opsiyonel).' },
        stokKodu: { type: 'string', description: 'Ürün kodu (opsiyonel — yoksa tüm ürünler).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_min_max_rules',
    description:
      'Bir laboratuvarın min/max stok kurallarını döner. "Düşük stok" veya "ihtiyacı olan lablar" sorgularında kritik.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        stokKodu: { type: 'string', description: 'Sadece bu ürün için.' },
      },
      required: ['hospitalId'],
    },
  },
  {
    name: 'get_consumption',
    description:
      'Tüketim kayıtlarını döner. Bir hastane veya ürün için son N gündeki tüketim sıklığını ve toplamını verir. "Tüketim sıklığı", "kaç adet kullanılıyor" sorularında kullan.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        stokKodu: { type: 'string' },
        days: { type: 'number', description: 'Geriye dönük gün (varsayılan 30).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_expiring_stock',
    description:
      'Önümüzdeki N gün içinde miadı dolacak stoğu döner (en yakın miad önce). Bir lab veya tüm sistem için.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string', description: 'Boş bırakılırsa erişimi olan tüm lablar.' },
        days: { type: 'number', description: 'Eşik gün (varsayılan 90).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_efficiency',
    description:
      'Total verimlilik kümülatif verisi. hospitalId zorunlu. year/month verilmezse son ayı döner. "En son kaç testlik girilmiş" sorularında kullan. verimlilikSonuclari (ürün bazlı verimlilik analizi) ve hesaplananTestBazliTuketim (test başı tüketim) içerir.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        year: { type: 'number' },
        month: { type: 'number', description: '1-12' },
        months: { type: 'number', description: 'Son N ayı al (year/month yerine).' },
      },
      required: ['hospitalId'],
    },
  },
  {
    name: 'get_devices',
    description:
      'Bir laboratuvardaki tanımlı cihazları, varsa test dağılımını döner. Bir testin hangi cihazda çalıştığını bulmak için kullan.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        model: { type: 'string', description: 'Model filtresi (kısmi).' },
        brand: { type: 'string', description: 'Marka filtresi.' },
      },
      required: [],
    },
  },
  {
    name: 'get_device_faults',
    description:
      'Cihaz arıza kayıtları. status: open|closed|all. Belirli lab/cihaz veya tipte (teknik_servis/aplikasyon) filtreleyebilirsin.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        status: { type: 'string', description: 'open | closed | all (varsayılan open)' },
        faultType: { type: 'string', description: 'teknik_servis | aplikasyon' },
        days: { type: 'number', description: 'Son N gün (opsiyonel).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_recent_stock_entries',
    description:
      'Bir lab veya tüm sistem için son depo stok girişlerini (depoya yeni gelen ürünler) döner. "En son kaç adet stok girişi olmuş" sorularında kullan.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        stokKodu: { type: 'string' },
        days: { type: 'number', description: 'Son N gün (varsayılan 30).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_orders',
    description:
      'Sipariş kayıtları. status: pending|toplaniyor|completed|all. Açık siparişleri ve son tamamlanan siparişleri görmek için.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        status: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'find_labs_low_on_product',
    description:
      'Belirli bir ürünün stoğu min sınır altında olan veya hiç bulunmayan tüm lab\'ları listeler. Sipariş/transfer önerisi yaparken kullan.',
    parameters: {
      type: 'object',
      properties: {
        stokKodu: { type: 'string' },
        belowPercent: { type: 'number', description: 'Min\'ın yüzde kaçının altı? (varsayılan 100 = min altı)' },
      },
      required: ['stokKodu'],
    },
  },
];
