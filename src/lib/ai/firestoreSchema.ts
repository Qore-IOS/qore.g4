/**
 * Firestore Collection Schema Guide
 *
 * Bu dosya, qore uygulamasındaki tüm Firestore koleksiyonlarını,
 * alanlarını ve kullanım amaçlarını tanımlar.
 *
 * AI chatbot bu kılavuzu kullanarak doğru koleksiyonlara erişir.
 */

// ============================================
// COLLECTION DEFINITIONS
// ============================================

export const FIRESTORE_COLLECTIONS = {
  // ==========================================
  // 1. ANA KOLEKSİYONLAR (Master Data)
  // ==========================================

  hospitals: {
    description: 'Hastane ve laboratuvar tanımlamaları',
    fields: {
      id: 'Benzersiz kimlik',
      name: 'Kurum adı',
      ad: 'Alternatif ad',
      kod: 'Kurum kodu',
      lat: 'Enlem',
      lng: 'Boylam',
      address: 'Adres',
      consumptionTrackingEnabled: 'Tüketim takibi aktif mi',
      isConsumablesHospital: 'Sarf malzeme hastanesi mi',
      manualDeductionEnabled: 'Manuel düşüm aktif mi',
      fefoEnabled: 'FEFO aktif mi',
      customProductOrder: 'Özel ürün sıralaması',
    },
    subCollections: ['minMaxRules', 'subPoints', 'stockCounts', 'hakEdisDefinitions'],
    useCases: [
      'Laboratuvar listesi',
      'Hastane bilgileri sorgulama',
      'Min/max stok kuralları',
      'Konum bazlı sorgular',
    ],
  },

  productCodes: {
    description: 'Ürün kataloğu ve tanımlamaları',
    fields: {
      id: 'Benzersiz kimlik',
      stokKodu: 'Firma içi stok kodu',
      stokAdi: 'Ürün adı',
      urunGrubu: "Ürün grubu ('kit' | 'sarf' | 'yedek_parca')",
      ambalajDegeri: 'Kutu başına test sayısı',
      anaBirim: 'Ana birim',
      cost: 'Maliyet',
      currency: "Para birimi ('EUR' | 'USD' | 'TRY')",
      marka: 'Marka',
      laboratuvarGrubu: 'Laboratuvar grubu',
      testGrubu: 'Test grubu',
      cihazGrubu: 'Cihaz grubu',
      testAdi: 'Ürünün çalıştığı test adı',
      barcodeFormatId: 'Barkod format kimliği',
      trackingMode: "Takip modu ('serial' | 'lot' | 'quantity')",
    },
    useCases: [
      'Ürün bilgisi sorgulama',
      'Stok kodu ile ürün arama',
      'Ürün grubu bazlı filtreleme',
      'Marka bazlı sorgular',
    ],
  },

  depots: {
    description: 'Depo tanımlamaları',
    fields: {
      id: 'Benzersiz kimlik',
      name: 'Depo adı',
      mapDefinition: 'Depo haritası tanımı',
      companies: 'Bağlı şirketler',
      lat: 'Enlem',
      lng: 'Boylam',
      address: 'Adres',
    },
    subCollections: ['minMaxRules'],
    useCases: [
      'Depo listesi',
      'Depo stok durumu',
      'Depo bazlı sorgular',
    ],
  },

  users: {
    description: 'Kullanıcı profilleri ve yetkileri',
    fields: {
      uid: 'Personel kayıt kimliği',
      email: 'E-posta adresi',
      role: "Rol ('admin' | 'user' | 'teknik_servis' | 'aplikasyon' | 'teknisyen')",
      name: 'Kullanıcı adı',
      nfcId: 'NFC kart kimliği',
      phoneNumber: 'Telefon numarası',
      createdAt: 'Oluşturulma tarihi',
      accessibleViews: 'Erişilebilir paneller',
      assignedLaboratories: 'Atanmış laboratuvarlar',
      assignedDepots: 'Atanmış depolar',
    },
    useCases: [
      'Kullanıcı bilgileri',
      'Yetki kontrolü',
      'Atanmış lokasyonlar',
    ],
  },

  devices: {
    description: 'Medikal cihaz tanımlamaları',
    fields: {
      id: 'Benzersiz kimlik',
      brand: 'Marka',
      model: 'Model',
      imageUrl: 'Cihaz görseli',
      arizaDurumu: "Arıza durumu ('yok' | 'teknik_servis' | 'aplikasyon')",
      sonArizaTarihi: 'Son arıza tarihi',
      arizaAciklamasi: 'Arıza açıklaması',
      cihazAdi: 'Cihaz adı',
      seriNumarasi: 'Seri numarası',
    },
    useCases: [
      'Cihaz listesi',
      'Arızalı cihazlar',
      'Cihaz durumu sorgulama',
    ],
  },

  // ==========================================
  // 2. STOK VE ENVANTER KOLEKSİYONLARI
  // ==========================================

  depoStok: {
    description: 'Merkez depo ve laboratuvar stoku (her seri numarası için bir kayıt)',
    fields: {
      id: 'Firestore doküman kimliği',
      depotId: 'Depo kimliği',
      depotName: 'Depo adı',
      stokKodu: 'Ürün stok kodu',
      stokAdi: 'Ürün adı',
      lotNumarasi: 'Lot numarası',
      miad: 'Son kullanma tarihi (Timestamp)',
      seriNumarasi: 'Seri numarası (61 karakter)',
      rafAdresi: 'Raf adresi',
      irsaliyeNumarasi: 'İrsaliye numarası',
      eklenmeTarihi: 'Eklenme tarihi',
      gtin: 'GTIN kodu',
      isShipped: 'Sevk edildi mi (true = laboratuvarda, false = depoda)',
      sevkTarihi: 'Sevk tarihi',
      hedefKurum: 'Hedef kurum adı',
      hedefKurumId: 'Hedef kurum kimliği',
      urunGrubu: "Ürün grubu ('kit' | 'sarf')",
      ambalajDegeri: 'Ambalaj değeri (test sayısı)',
      transferId: 'Transfer kimliği',
    },
    useCases: [
      'Stok sorgulama (depo veya laboratuvar)',
      'Ürün bazlı stok sayısı',
      'Laboratuvar bazlı stok',
      'Miadı yaklaşan ürünler (miad alanına göre)',
      'Lot bazlı takip',
    ],
    importantNotes: [
      'isShipped=false → Depoda',
      'isShipped=true → Laboratuvarda (hedefKurumId ile)',
      'Stok sayısı için count() kullanılabilir',
    ],
  },

  tuketimKayitlari: {
    description: 'Laboratuvarlarda kullanılan ürünlerin tüketim kayıtları',
    fields: {
      id: 'Kayıt kimliği',
      stokKodu: 'Ürün stok kodu',
      stokAdi: 'Ürün adı',
      lotNumarasi: 'Lot numarası',
      miad: 'Son kullanma tarihi',
      seriNumarasi: 'Seri numarası',
      laboratoryId: 'Laboratuvar kimliği',
      laboratoryName: 'Laboratuvar adı',
      subPointId: 'Alt nokta kimliği',
      subPointName: 'Alt nokta adı',
      consumptionTimestamp: 'Tüketim zamanı',
      consumptionType: "Tüketim türü ('normal_kullanim' | 'sayimdan_dusum' | 'imha_dogrulama_sonrasi_dusum')",
      urunGrubu: "Ürün grubu ('kit' | 'sarf')",
      ambalajDegeri: 'Ambalaj değeri',
      userId: 'Kullanıcı kimliği',
      userName: 'Kullanıcı adı',
    },
    useCases: [
      'Tüketim raporları',
      'Laboratuvar bazlı tüketim',
      'Ürün bazlı tüketim analizi',
      'Tarih aralığında tüketim',
      'Kullanıcı bazlı tüketim takibi',
    ],
  },

  // ==========================================
  // 3. SİPARİŞ VE SEVKİYAT KOLEKSİYONLARI
  // ==========================================

  orders: {
    description: 'Laboratuvar sipariş talepleri',
    fields: {
      id: 'Sipariş kimliği',
      depotId: 'Sorumlu depo kimliği',
      labId: 'Laboratuvar kimliği',
      kurumAdi: 'Kurum adı',
      items: 'Sipariş kalemleri [{stokKodu, stokAdi, adet}]',
      createdAt: 'Oluşturulma tarihi',
      status: "Durum ('pending' | 'toplaniyor' | 'completed')",
      transferredAt: 'Transfer tarihi',
      createdBy: 'Oluşturan kullanıcı adı',
      transferredBy: 'Transfer eden kullanıcı adı',
    },
    useCases: [
      'Bekleyen siparişler',
      'Sipariş geçmişi',
      'Laboratuvar siparişleri',
      'Sipariş durumu takibi',
    ],
  },

  shipments: {
    description: 'Tamamlanmış sevkiyat kayıtları',
    fields: {
      id: 'Sevkiyat kimliği',
      orderId: "Kaynak sipariş kimliği veya 'DIREKT_TRANSFER'",
      depotId: 'Kaynak depo kimliği',
      depotName: 'Kaynak depo adı',
      recipientHospital: 'Alıcı hastane adı',
      userId: 'Sevk eden kullanıcı kimliği',
      userName: 'Sevk eden kullanıcı adı',
      timestamp: 'Sevkiyat zamanı',
      items: 'Sevk edilen ürünler [{stokKodu, stokAdi, lotNumarasi, miad, quantity, serialNumbers}]',
    },
    useCases: [
      'Sevkiyat geçmişi',
      'Laboratuvara yapılan sevkiyatlar',
      'Tarih bazlı sevkiyat raporu',
    ],
  },

  transfers: {
    description: 'Depo/laboratuvar arası transfer işlemleri',
    fields: {
      id: 'Transfer kimliği',
      sourceDepotId: 'Kaynak depo kimliği',
      sourceDepotName: 'Kaynak depo adı',
      targetName: 'Hedef adı',
      userId: 'Transfer eden kullanıcı kimliği',
      userName: 'Transfer eden kullanıcı adı',
      timestamp: 'Transfer zamanı',
      itemCount: 'Toplam ürün sayısı',
    },
    subCollections: ['items'],
    useCases: [
      'Transfer geçmişi',
      'Depo çıkışları',
      'Laboratuvar girişleri',
    ],
  },

  // ==========================================
  // 4. MAL KABUL KOLEKSİYONLARI
  // ==========================================

  malKabulTransactions: {
    description: 'Mal kabul işlem kayıtları',
    fields: {
      transactionId: 'İşlem kimliği (MK-XXXXXXXX)',
      depotId: 'Depo kimliği',
      depotName: 'Depo adı',
      userId: 'Kullanıcı kimliği',
      userName: 'Kullanıcı adı',
      timestamp: 'İşlem zamanı',
      itemCount: 'Toplam ürün sayısı',
      brands: 'İşlemdeki markalar',
      mode: "Doğrulama modu ('verified' | 'unverified')",
    },
    subCollections: ['lines'],
    useCases: [
      'Mal kabul geçmişi',
      'Depoya giren ürünler',
      'Marka bazlı mal kabul',
    ],
  },

  // ==========================================
  // 5. ARIZA VE TEKNİK SERVİS
  // ==========================================

  deviceFaultReports: {
    description: 'Cihaz arıza bildirimleri',
    fields: {
      id: 'Rapor kimliği',
      labId: 'Laboratuvar kimliği',
      labName: 'Laboratuvar adı',
      deviceId: 'Cihaz kimliği',
      model: 'Cihaz modeli',
      serial: 'Cihaz seri numarası',
      description: 'Arıza açıklaması',
      status: "Durum ('open' | 'closed')",
      faultType: "Arıza türü ('teknik_servis' | 'aplikasyon')",
      openedAt: 'Açılma tarihi',
      closedAt: 'Kapanma tarihi',
    },
    useCases: [
      'Açık arızalar',
      'Arıza geçmişi',
      'Laboratuvar bazlı arızalar',
      'Cihaz bazlı arıza takibi',
    ],
  },

  ejectedKits: {
    description: 'Cihazdan hatayla çıkarılan kit kayıtları',
    fields: {
      id: 'Kayıt kimliği',
      laboratoryId: 'Laboratuvar kimliği',
      laboratoryName: 'Laboratuvar adı',
      deviceId: 'Cihaz kimliği',
      deviceModel: 'Cihaz modeli',
      stokKodu: 'Ürün stok kodu',
      stokAdi: 'Ürün adı',
      testCount: 'Test sayısı',
      createdAt: 'Oluşturulma tarihi',
      faultReportId: 'İlişkili arıza raporu',
    },
    useCases: [
      'Çıkarılan kit listesi',
      'Cihaz bazlı kit sorunları',
    ],
  },

  destroyedKits: {
    description: 'İmha edilen kit kayıtları',
    fields: {
      id: 'Kayıt kimliği',
      laboratoryId: 'Laboratuvar kimliği',
      laboratoryName: 'Laboratuvar adı',
      stokKodu: 'Ürün stok kodu',
      stokAdi: 'Ürün adı',
      lotNumarasi: 'Lot numarası',
      seriNumarasi: 'Seri numarası',
      testCount: 'Test sayısı',
      resolvedAt: 'İmha tarihi',
    },
    useCases: [
      'İmha edilen ürünler',
      'Fire/zayi raporu',
    ],
  },

  // ==========================================
  // 6. VERİMLİLİK VE ANALİZ
  // ==========================================

  efficiencyData: {
    description: 'Aylık verimlilik hesaplama verileri',
    fields: {
      id: 'Kayıt kimliği (hospitalId-year-month)',
      hospitalId: 'Hastane kimliği',
      hospitalName: 'Hastane adı',
      month: 'Ay',
      year: 'Yıl',
      cihazUstuDevir: 'Cihaz üstü devir stok',
      hesaplananTestBazliTuketim: 'Hesaplanan test bazlı tüketim',
      verimlilikSonuclari: 'Verimlilik sonuçları (ürün bazlı)',
      lastUpdated: 'Son güncelleme tarihi',
    },
    useCases: [
      'Aylık verimlilik raporu',
      'Laboratuvar verimlilik karşılaştırması',
      'Ürün bazlı verimlilik',
    ],
  },

  efficiencyHistory: {
    description: 'Verimlilik geçmişi kayıtları',
    fields: {
      hospitalId: 'Hastane kimliği',
      hospitalName: 'Hastane adı',
      year: 'Yıl',
      month: 'Ay',
      verimlilikSonuclari: 'Verimlilik sonuçları',
      hesaplananTestBazliTuketim: 'Test bazlı tüketim',
    },
    useCases: [
      'Verimlilik trend analizi',
      'Geçmiş verimlilik karşılaştırması',
    ],
  },

  // ==========================================
  // 7. İŞ ANALİZİ (LBYS)
  // ==========================================

  analysis_daily_summary: {
    description: 'LBYS verilerinin günlük özetleri',
    fields: {
      id: 'Tarih (YYYY-MM-DD)',
      date: 'Tarih',
      totals: 'Toplam istatistikler',
      byHospital: 'Hastane bazlı kırılım',
      byAsm: 'ASM bazlı kırılım',
      byService: 'Servis bazlı kırılım',
      byTest: 'Test bazlı kırılım',
    },
    useCases: [
      'Günlük test istatistikleri',
      'Hastane performansı',
      'Servis bazlı analiz',
    ],
  },

  analysis_monthly_summary: {
    description: 'LBYS verilerinin aylık özetleri',
    fields: {
      id: 'Ay kimliği (YYYY-MM)',
      year: 'Yıl',
      month: 'Ay',
      totals: 'Toplam istatistikler',
      byHospital: 'Hastane bazlı kırılım',
      dailyTotals: 'Günlük toplamlar',
    },
    useCases: [
      'Aylık test istatistikleri',
      'Trend analizi',
    ],
  },

  // ==========================================
  // 8. DİĞER KOLEKSİYONLAR
  // ==========================================

  notifications: {
    description: 'Kullanıcı bildirimleri',
    fields: {
      id: 'Bildirim kimliği',
      title: 'Başlık',
      body: 'İçerik',
      type: 'Bildirim türü',
      targetUserIds: 'Hedef kullanıcılar',
      createdAt: 'Oluşturulma tarihi',
      readBy: 'Okuyan kullanıcılar',
    },
    useCases: ['Bildirim listesi', 'Okunmamış bildirimler'],
  },

  dailyConsumptionStats: {
    description: 'Dashboard için günlük tüketim istatistikleri',
    fields: {
      id: 'Tarih (YYYY-MM-DD)',
      date: 'Tarih',
      totalCount: 'Günlük toplam tüketim',
      byLab: 'Laboratuvar bazlı tüketim',
    },
    useCases: [
      'Dashboard KPI',
      'Günlük tüketim trendi',
    ],
  },

  barcodeFormats: {
    description: 'Barkod ayrıştırma formatları',
    fields: {
      id: 'Format kimliği',
      name: 'Format adı',
      strategy: "Ayrıştırma stratejisi ('positional' | 'regex' | 'legacy_roche')",
      active: 'Aktif mi',
      priority: 'Öncelik sırası',
    },
    useCases: ['Barkod format listesi'],
  },
} as const;

// ============================================
// QUERY HELPERS - Hangi sorgu için hangi koleksiyon
// ============================================

export const QUERY_COLLECTION_MAP = {
  // Stok sorguları
  'stok durumu': ['depoStok'],
  'depodaki stok': ['depoStok'], // isShipped=false
  'laboratuvar stoku': ['depoStok'], // isShipped=true, hedefKurumId ile
  'miadı yaklaşan': ['depoStok'], // miad alanına göre
  'son kullanma tarihi': ['depoStok'],
  'lot takibi': ['depoStok'],

  // Tüketim sorguları
  'tüketim': ['tuketimKayitlari'],
  'kullanım': ['tuketimKayitlari'],
  'harcanan': ['tuketimKayitlari'],
  'tüketilen': ['tuketimKayitlari'],

  // Sipariş sorguları
  'sipariş': ['orders'],
  'bekleyen sipariş': ['orders'], // status='pending'
  'sipariş durumu': ['orders'],

  // Sevkiyat sorguları
  'sevkiyat': ['shipments', 'transfers'],
  'transfer': ['transfers'],
  'gönderilen': ['shipments'],

  // Verimlilik sorguları
  'verimlilik': ['efficiencyData', 'efficiencyHistory'],
  'efficiency': ['efficiencyData', 'efficiencyHistory'],
  'performans': ['efficiencyData'],

  // Arıza sorguları
  'arıza': ['deviceFaultReports'],
  'teknik servis': ['deviceFaultReports'],
  'cihaz sorunu': ['deviceFaultReports'],

  // Ürün sorguları
  'ürün bilgisi': ['productCodes'],
  'stok kodu': ['productCodes'],
  'ürün listesi': ['productCodes'],

  // Hastane/Lab sorguları
  'hastane': ['hospitals'],
  'laboratuvar': ['hospitals'],
  'lab listesi': ['hospitals'],

  // Analiz sorguları
  'test sayısı': ['analysis_daily_summary', 'analysis_monthly_summary'],
  'LBYS': ['analysis_daily_summary', 'analysis_monthly_summary'],
  'günlük rapor': ['analysis_daily_summary', 'dailyConsumptionStats'],

  // İmha sorguları
  'imha': ['destroyedKits'],
  'fire': ['destroyedKits'],
  'zayi': ['destroyedKits'],

  // Mal kabul sorguları
  'mal kabul': ['malKabulTransactions'],
  'giriş': ['malKabulTransactions'],
} as const;

// ============================================
// ÖRNEK SORGULAR
// ============================================

export const EXAMPLE_QUERIES = {
  // Stok sorguları
  'Depodaki TSH stok sayısı': {
    collection: 'depoStok',
    filters: { isShipped: false },
    search: { field: 'stokAdi', contains: 'TSH' },
    aggregate: 'count',
  },

  'Line 7 laboratuvarındaki stok': {
    collection: 'depoStok',
    filters: { isShipped: true },
    search: { field: 'hedefKurum', contains: 'Line 7' },
  },

  'Miadı 30 gün içinde dolacak ürünler': {
    collection: 'depoStok',
    filters: { miad: '<=30 gün sonra' },
  },

  // Tüketim sorguları
  'Bu ay toplam tüketim': {
    collection: 'tuketimKayitlari',
    filters: { consumptionTimestamp: 'bu ay içinde' },
    aggregate: 'count',
  },

  'Hangi laboratuvar en çok tüketiyor': {
    collection: 'tuketimKayitlari',
    groupBy: 'laboratoryName',
    aggregate: 'count',
    orderBy: 'desc',
  },

  // Sipariş sorguları
  'Bekleyen siparişler': {
    collection: 'orders',
    filters: { status: 'pending' },
  },

  // Arıza sorguları
  'Açık arızalar': {
    collection: 'deviceFaultReports',
    filters: { status: 'open' },
  },

  // Verimlilik sorguları
  'Son 3 ayın verimlilik raporu': {
    collection: 'efficiencyHistory',
    orderBy: { year: 'desc', month: 'desc' },
    limit: 3,
  },
} as const;

// ============================================
// SYSTEM PROMPT ADDITION
// ============================================

export const COLLECTION_GUIDE_PROMPT = `
## Firestore Koleksiyon Kılavuzu

Aşağıdaki koleksiyonlar sistemde mevcut ve sorgulanabilir:

### STOK VERİLERİ
- **depoStok**: Tüm stok kayıtları (depo + laboratuvar)
  - isShipped=false → Depodaki stok
  - isShipped=true → Laboratuvardaki stok (hedefKurumId ile filtrele)
  - Alanlar: stokKodu, stokAdi, lotNumarasi, miad, seriNumarasi, hedefKurum, hedefKurumId

### TÜKETİM VERİLERİ
- **tuketimKayitlari**: Laboratuvarlarda kullanılan ürünler
  - Alanlar: stokKodu, stokAdi, laboratoryId, laboratoryName, consumptionTimestamp, consumptionType

### SİPARİŞ VE SEVKİYAT
- **orders**: Sipariş talepleri (status: 'pending' | 'toplaniyor' | 'completed')
- **shipments**: Tamamlanmış sevkiyatlar
- **transfers**: Depo-laboratuvar transferleri

### ARIZA TAKİBİ
- **deviceFaultReports**: Cihaz arızaları (status: 'open' | 'closed')
- **ejectedKits**: Cihazdan çıkan kitler
- **destroyedKits**: İmha edilen ürünler

### VERİMLİLİK
- **efficiencyData**: Aylık verimlilik verileri
- **efficiencyHistory**: Verimlilik geçmişi (year, month ile sorgula)

### MASTER DATA
- **hospitals**: Hastane/laboratuvar tanımları
- **productCodes**: Ürün kataloğu
- **depots**: Depo tanımları
- **devices**: Cihaz tanımları

### ANALİZ
- **analysis_daily_summary**: Günlük LBYS özeti
- **analysis_monthly_summary**: Aylık LBYS özeti
- **dailyConsumptionStats**: Günlük tüketim istatistikleri

### ÖNEMLİ NOTLAR
1. Stok sayısı için depoStok koleksiyonunu kullan
2. Tüketim için tuketimKayitlari koleksiyonunu kullan
3. Laboratuvar bazlı stok için: depoStok WHERE isShipped=true AND hedefKurumId=labId
4. Depo bazlı stok için: depoStok WHERE isShipped=false AND depotId=depoId
5. Miad kontrolü için depoStok.miad alanını kullan (Timestamp formatında)
`;

export default FIRESTORE_COLLECTIONS;
