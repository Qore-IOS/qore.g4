/**
 * Application-wide type definitions for Qore.g4
 * Updated for Laboratory Bulk Processing
 */

import { type TrackingMode } from './tracking';

export type TimestampLike =
  | string
  | number
  | Date
  | { toDate?: () => Date; seconds?: number; nanoseconds?: number }
  | null
  | undefined;

export interface ProductCode {
  id: string;
  stokKodu: string; // The company's internal stock code
  stokAdi: string;
  urunGrubu?: 'kit' | 'sarf' | 'yedek_parca';
  ambalajDegeri?: number;
  anaBirim?: string;
  cost?: number;
  currency?: 'EUR' | 'USD' | 'TRY';
  marka?: string;
  laboratuvarGrubu?: string;
  laboratuvarGruplari?: string[]; // Çoklu lab grubu ataması - lojistik sorumlusu eşleştirmesi için
  testGrubu?: string;
  cihazGrubu?: string;
  testAdi?: string; // Ürünün çalıştığı testin adı (Total Verimlilik paneli için)
  barcodeFormatId?: string | null; // Links to a BarcodeFormat (legacy - tek format)
  barcodeFormatIds?: string[]; // Çoklu barkod formatları (yeni sistem)
  barcodeNumber?: string; // The unique identifier part of the barcode for this product (UDI)
  trackingMode?: TrackingMode;
  // Ürün boyutları (cm cinsinden) - araç doluluk oranı hesaplaması için
  genislik?: number; // Genişlik (cm)
  yukseklik?: number; // Yükseklik (cm)
  derinlik?: number; // Derinlik/Uzunluk (cm)
  [k: string]: any;
}

export type ManualProductOption = {
  code: string;
  name: string;
  tracking: TrackingMode;
};

export interface AddressDefinition {
  id: string;
  addressBarcode: string;
  addressName: string;
}
export interface LaboratoryProductTrackingRule {
  stokKodu: string;
  takipSekli: TrackingType;
}

export interface Hospital {
  id: string;
  name: string;
  ad?: string;
  kod?: string;
  lat?: number;
  lng?: number;
  minMaxRules?: Record<string, MinMaxRule>;
  urunTakipKurallari?: LaboratoryProductTrackingRule[];
  address?: string;
  consumptionTrackingEnabled?: boolean; // NEW
  isConsumablesHospital?: boolean; // NEW: For "Hastane Sarf"
  manualDeductionEnabled?: boolean; // NEW: For "Manuel Düşüm"
  visualDeductionEnabled?: boolean; // NEW: For 3D görsel düşüm
  fefoEnabled?: boolean;
  customProductOrder?: string[]; // Özel ürün sıralama - sipariş toplama ekranında kullanılır
  perifer?: boolean; // Perifer laboratuvar statüsü - ofis tarafından yönetilen, lojistik paneli açan siparişler
  defaultDepotId?: string; // Varsayılan depo ID'si (otomatik yönlendirme için)
  defaultDepotName?: string; // Varsayılan depo adı
  ceomedCariKodu?: string; // Ceomed ERP'deki cari kodu (örn. M51001) - irsaliye eşlemesi için
  mahalKodu?: string; // Hastane Sarf kategorisindeki lablar için mahal kodu (örn. 152.06.A.001) — QR teslimat doğrulamasında kullanılır
  ekHizmetLabIds?: string[]; // Bu ana laboratuvara bağlı ek hizmet laboratuvarlarının id'leri
  /** Acil statüsü — true ise 7/24 (Pazartesi-Pazar 00:00-24:00) çalışır kabul edilir, calismaSaatleri yok sayılır. */
  acilStatusu?: boolean;
  /** Lab çalışma saatleri — kapasite ve atıl maliyet hesabında kullanılır. */
  calismaSaatleri?: LabCalismaSaatleri;
  [k: string]: any;
}

/**
 * Laboratuvar çalışma saatleri.
 * - haftaIciGunleri / haftaSonuGunleri: hangi günler çalışıyor (her ikisi için varsayılan dolu kabul edilir)
 * - Boş bir aralık (start = end) o periyodun kapalı olduğu anlamına gelir
 */
export interface LabCalismaSaatleri {
  haftaIciStart?: string;  // "08:00"
  haftaIciEnd?: string;    // "17:00"
  haftaSonuStart?: string; // "00:00"
  haftaSonuEnd?: string;   // "00:00" (kapalı)
  haftaIciGunleri?: ('pzt' | 'sal' | 'cars' | 'pers' | 'cum')[];
  haftaSonuGunleri?: ('cmt' | 'pzr')[];
}

export interface RackHeader {
  id: string;          // Firestore doc ID
  prefix: string;      // "A", "B", etc.
  count: number;       // how many sub‑racks, e.g. 4
}

export interface CellMapping {
  row: number;         // 0–5
  col: number;         // 0–5
  header: string;      // e.g. "A"
  count: number;       // e.g. 4
}

export interface MapRecord {
  grid: CellMapping[];
  selectedAddresses: string[];    // ["A1","A2","B1",…]
  assignments: { [addr: string]: string }; // e.g. { "A1":"prod123", … }
}

export interface CellDef {
  x: number;
  y: number;
  group?: string;
  products?: string[];
}
export interface GridDefinition {
  rows: number;
  cols: number;
  cells: CellDef[];
}


export interface Depot {
  id: string;
  name: string;
  mapDefinition?: GridDefinition;
  linkedLaboratoryIds?: string[];
  companies?: string[]; // Added for Borç Depo
  // Konum bilgileri - rota planlama için
  lat?: number;
  lng?: number;
  address?: string;
  // Havuz Depo alanları
  isPoolWarehouse?: boolean; // true ise bu bir havuz depo
  linkedDeviceLabPoolIds?: string[]; // Bağlı Cihaz Laboratuvar Grubu ID'leri
  // Ceomed entegrasyonu
  ceomedEnabled?: boolean; // true ise bu depo Ceomed ERP'den senkronize edilir
  ceomedDepoKodu?: string; // Ceomed'deki depo kodu (örn. "77") — selectMerkezDepoListesi'ndeki DEPO{kod} alanını okur
  ceomedCariKodu?: string; // Ceomed cari kodu (örn. M51001) — Ceomed irsaliye eşleştirmesi için
  [k: string]: any;
}

export interface MinMaxRule {
  stokKodu: string; // Add stokKodu to be able to identify the rule
  min: number;
  max: number;
  maxGun?: number;
  aylikTuketimLimiti?: number; // Monthly consumption limit
  /** Ortalama tüketim süresi (gün cinsinden). Örn: 1 kutu X ürün 5 günde tüketilir → 5 */
  ortalamaTuketimSuresi?: number;
  /** Tüketim süresi birimi: 'gun' (gün) veya 'saat' */
  tuketimSuresiBirimi?: 'gun' | 'saat';
  /** Hastane Sarf labları için: transfer ekranında otomatik gelen transfer adedi */
  otomatikTransferAdedi?: number;
}

/* ——— Sarf Dağıtım (Hastane Sarf) transfer akışı ——— */

export interface SarfTransferItem {
  stokKodu: string;
  stokAdi: string;
  adet: number;
}

/**
 * Hastane Sarf transferi. Oluşturulduğunda 'pending' (kabul bekliyor);
 * paket QR'ı (transferId + mahal kodu) ve ardından mahal QR'ı okutulup
 * doğrulandığında 'delivered' olur — depo stoğu düşülür, mahal stoğuna eklenir.
 */
export interface SarfTransfer {
  id: string;
  /** Kısa transfer kodu, örn. TRF-9K2P7 — paket etiketinde basılır */
  code: string;
  hospitalId: string;
  kurumAdi: string;
  /** Hedef labın mahal kodu (hospitals.mahalKodu) */
  mahalKodu: string;
  items: SarfTransferItem[];
  total: number;
  status: 'pending' | 'delivered';
  depotId?: string | null;
  depotName?: string | null;
  createdAt: TimestampLike;
  createdBy?: string;
  createdById?: string;
  /** Sarf dağıtım personeli paketi üzerine aldığında dolar */
  receivedAt?: TimestampLike;
  receivedBy?: string;
  receivedById?: string;
  deliveredAt?: TimestampLike;
  deliveredBy?: string;
  deliveredById?: string;
  companyId?: string;
}

// Şirket bazlı veri yönetimi
export const LEGACY_COMPANY_ID = '__legacy__';

export interface Company {
  id: string;
  name: string;
  description?: string;
  createdAt?: Date;
  createdByUid?: string;
  createdByName?: string;
  // Firma sorumlusu - adminler arasından seçilir. Haftalık plan onay akışında
  // planı oluşturulan kullanıcının firmasına ait sorumluya bildirim gider.
  responsibleUid?: string;
  responsibleName?: string;
}

export interface User {
  uid: string;
  email: string | null;
  role: 'super_admin' | 'admin' | 'admin_developer' | 'user' | 'teknik_servis' | 'aplikasyon' | 'teknisyen' | 'teknik_lojistik' | 'satin_alma' | 'sarf_dagitim_personeli' | string;
  name?: string;
  companyId?: string; // Şirket ID - boş veya undefined ise legacy şirkete ait
  nfcId?: string; // Optional field for NFC card ID
  phoneNumber?: string;
  createdAt?: Date;
  accessibleViews?: AppView[];
  assignedLaboratories?: string[]; // Array of laboratory IDs - tüm yetkili laboratuvarlar
  primaryLaboratories?: string[]; // Array of laboratory IDs - ana sorumluluk laboratuvarları (performans puanı için)
  assignedDepots?: string[]; // Array of depot IDs
  assignedBrands?: string[]; // Array of brand names
  notificationsEnabled?: boolean; // User notification preferences
  notificationPreferences?: string[]; // Array of notification types
  themePreference?: 'light' | 'dark' | 'system'; // User's theme preference stored in Firestore
  lastSelectedLabId?: string; // Last selected laboratory ID for teknisyen users (persisted in Firestore)
  assignedLabGroups?: string[]; // NEW: Assigned laboratory groups for logistics responsible
}

export interface ScannedItem {
  id: string;
  barkod: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  seriNumarasi: string;
  rafAdresi: string;
  irsaliyeNumarasi: string;
  isSelected: boolean;
  timestamp: Date;
  isProcessed?: boolean;
}

export interface DepoStokItem {
  id: string; // Firestore document ID
  depotId?: string; // ID of the depot this item belongs to
  depotName?: string; // Name of the depot
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  miad: TimestampLike;
  seriNumarasi?: string;
  rafAdresi?: string;
  irsaliyeNumarasi?: string;
  eklenmeTarihi?: TimestampLike;
  gtin?: string;
  isShipped?: boolean;
  sevkTarihi?: TimestampLike;
  hedefKurum?: string;
  urunGrubu?: 'kit' | 'sarf';
  ambalajDegeri?: number;
  transferId?: string;
  hedefKurumId?: string | null; // NEW
  companyId?: string; // Şirket ID - multi-tenancy
  [k: string]: any;
}

export interface OrderItem {
  id: string;
  stokKodu: string;
  stokAdi: string;
  adet: number;
}

export interface PeripheralFulfillmentItem {
  itemId: string;
  stokKodu: string;
  requestedAdet: number;
  sentAdet: number;
  fulfilled: boolean;
}

export interface PeripheralFulfillment {
  items: PeripheralFulfillmentItem[];
  updatedAt?: TimestampLike;
  updatedById?: string;
  updatedBy?: string;
}

export type OrderUrgency = 'normal' | 'acil' | 'cok_acil';

export interface Order {
  id: string; // Firestore document ID
  depotId?: string; // The depot that should fulfill this.
  labId?: string;
  kurumAdi: string;
  items: OrderItem[];
  createdAt: TimestampLike;
  status: 'pending' | 'toplaniyor' | 'completed' | 'eksik' | string;
  transferredAt?: TimestampLike | null;
  olusturmaTarihi?: TimestampLike;
  depotName?: string;
  createdById?: string;
  createdBy?: string;
  transferredById?: string;
  transferredBy?: string;
  isPeripheral?: boolean; // True when the target lab is perifer; orders routed to office logistics flow
  peripheralFulfillment?: PeripheralFulfillment; // Office-managed fulfillment state for perifer orders
  urgency?: OrderUrgency; // Peripheral talep aciliyeti — normal | acil | cok_acil
  note?: string;          // Talep açıklaması (opsiyonel, perifer akışta girilir)
}


export interface PickingListItem {
  id: string;
  orderId: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  rafAdresiOnerilen: string;
  adetIstenen: number;
  toplananSeriNumaralari: string[];
}

export interface ShipmentItem {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  quantity: number;
  serialNumbers: string[];
}

export interface Shipment {
  id: string; // Firestore document ID
  orderId: string; // Original order ID or 'DIREKT_TRANSFER'
  depotId: string;
  depotName: string;
  recipientHospital: string; // Changed
  userId: string;
  userName?: string;
  timestamp: TimestampLike; // Replaces sevkTarihi for more precision
  items: ShipmentItem[]; // Detailed item list
}


export interface VerificationReportItem {
  id: string; // Firestore document ID
  seriNumarasi: string;
  durum: "KABUL EDİLDİ" | "KABUL EDİLMEDİ" | "SİSTEMDE YOK" | "REFERANSTA YOK" | "SEVK EDİLDİ" | "SAYIMDA FAZLA" | "SAYIMDA EKSİK" | "KULLANIM DOĞRULANDI" | "KULLANIM BEKLENİYOR" | "imha_dogrulandi";
  stokKodu?: string;
  stokAdi?: string;
  lotNumarasi?: string;
  miad?: string;
  rafAdresi?: string;
  islemTarihi: Date;
  ilgiliBelgeId?: string; 
  hedefKurum?: string;
  raporTipi: 'mal_kabul' | 'sevkiyat' | 'sayim' | 'imha';
}


export interface LaboratoryStockCountSession { // New session type for labs
  id: string; // laboratoryId-year-month-day
  laboratoryId: string;
  laboratoryName: string;
  sayimTarihi: Date;
  durum: 'basladi' | 'tamamlandi';
  sayimdakiUrunler: Array<{
    stokKodu: string;
    stokAdi: string;
    lotNumarasi: string;
    miad: string;
    seriNumarasi: string;
    beklenenAdet: number;
    sayilanAdet: number;
  }>;
}


export type DeviceMulkiyetTipi = 'kira' | 'satin_alma' | 'demobaz';
export type KiraDonemi = 'aylik' | 'yillik';

export interface Device {
  id: string;
  brand: string;
  model: string;
  imageUrl: string;
  mulkiyet?: DeviceMulkiyetTipi | string;
  /** Sahiplik 'kira' ise tutar (kiraDonemi'ne göre aylık/yıllık) */
  aylikKira?: number;
  /** Kira dönemi (varsayılan 'aylik'). 'yillik' ise hesapta ÷12 yapılır. */
  kiraDonemi?: KiraDonemi;
  /** Sahiplik 'satin_alma' ise toplam satın alma tutarı */
  satinAlmaTutari?: number;
  /** Sahiplik 'satin_alma' ise satın alma tarihi (dd.MM.yyyy) */
  satinAlmaTarihi?: string;
  /** Sahiplik 'satin_alma' ise amortisman süresi (ay cinsinden) — aylık karşılık = satinAlmaTutari / amortismanAyi */
  amortismanAyi?: number;
  /** Maliyet alanlarının para birimi (varsayılan TRY) */
  maliyetCurrency?: 'EUR' | 'USD' | 'TRY';
  /** Saat başına teorik test çalışma kapasitesi (örn 100 test/saat) — kapasite bazlı maliyet hesabında kullanılır */
  testKapasiteSaatBasi?: number;
  kurulumTarihi?: string;
  kurulumPersonelleri?: string;
  aciklama?: string;
  arizaDurumu?: 'yok' | 'teknik_servis' | 'aplikasyon';
  sonArizaTarihi?: TimestampLike;
  arizaAciklamasi?: string;
  cihazAdi?: string;
  seriNumarasi?: string;
  order?: number;
  [k: string]: any;
}

export interface AssignedDevice {
  cihazId: string;
  id: string;
  deviceId: string;
  name: string;
  serial: string;
  hastaneId: string; // Changed
  arizaDurumu?: 'yok' | 'teknik_servis' | 'aplikasyon';
  arizaTip?: 'teknik_servis' | 'aplikasyon';
  arizaTarihi?: Date;
  arizaAciklamasi?: string;
  openedBy?: string;
  subPointId?: string;
  subPointName?: string;
  /** Bu cihaza atanmış ürün stok kodları — bir kit birden fazla cihaza atanabilir.
   *  Test bazlı maliyette CAWC algoritmasının girdisi olur. */
  assignedStokKodlari?: string[];
}

export interface DeviceGroup {
  id: string;
  name: string;
  deviceIds: string[];
  order: number;
  subPointId?: string;
  subPointName?: string;
}


export interface ConsumptionRecord {
  id: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  seriNumarasi: string;
  laboratoryId: string; // Changed
  laboratoryName: string; // Changed
  subPointId?: string;
  subPointName?: string;
  consumptionTimestamp: TimestampLike;
  consumptionType: 'normal_kullanim' | 'sayimdan_dusum' | 'imha_dogrulama_sonrasi_dusum';
  rafAdresi?: string;
  irsaliyeNumarasi?: string;
  urunGrubu?: 'kit' | 'sarf';
  ambalajDegeri?: number;
  isImhaDogrulandi?: boolean;
  userId: string;
  userName: string;
}

/**
 * Daily consumption statistics for dashboard KPI
 * Stores aggregated daily consumption counts to avoid querying all consumption records
 */
export interface DailyConsumptionStats {
  id: string;              // Format: "YYYY-MM-DD"
  date: string;            // "YYYY-MM-DD" for easy querying
  totalCount: number;      // Total consumption count for the day
  byLab: Record<string, number>;  // Consumption count by laboratory ID
  createdAt?: TimestampLike;
  updatedAt?: TimestampLike;
}

export interface CihazUstuStokInput {
  stokKodu: string;
  adet: number;
}

export interface KumulatifDataInput {
  stokKodu: string;
  kumulatifTotal: number;
  rutin: number;
  kontrol: number;
  kalibrasyon: number;
  tekrar: number;
}

export interface VerimlilikAnalizi {
  stokKodu: string;
  stokAdi: string;
  anaTuketimTestAdeti: number;
  kumulatifTotalTest: number;
  bilinenFire: number;
  bilinmeyenFire: number;
  toplamFire: number;
  rutinHastaSayisi: number;
}

export interface EfficiencyData {
  id: string; // hospitalId-year-month
  hospitalId: string;
  hospitalName: string;
  month: number;
  year: number;
  cihazUstuDevir: Record<string, number>;
  sistemTuketimleriDateRange?: { from?: Date; to?: Date };
  hesaplananTestBazliTuketim: Record<string, number>;
  cihazUstuAySonu: Record<string, number>;
  kumulatifVeriler: Record<string, KumulatifDataInput>;
  verimlilikSonuclari?: Record<string, VerimlilikAnalizi>;
  consumptionInputMethod?: 'system' | 'manual';
  lastUpdated: Date;
}

export interface UploadedReport {
  id: string; // Firestore doc ID
  name: string;
  url: string; // Firebase Storage download URL
  path: string; // Full path in Firebase Storage for deletion
  uploadedAt: TimestampLike;
  uploaderName: string;
  uploaderId: string;
}

// Arıza durumu tipleri
export type DeviceFaultStatus =
  | 'atama_bekliyor'      // Yeni açılan arıza, henüz kimse üzerine almadı
  | 'mudahale_bekliyor'   // Personel üzerine aldı, müdahale başlamadı
  | 'mudahale_ediliyor'   // Aktif müdahale (telefon veya yerinde)
  | 'cozuldu'             // Arıza çözüldü
  | 'open'                // Legacy - eski sistem uyumluluğu
  | 'closed';             // Legacy - eski sistem uyumluluğu

// Müdahale tipi
export type InterventionType = 'telefon' | 'kurum_ziyaret';

export interface DeviceFaultReport {
  id: string;
  labId: string;
  labName: string;
  hospitalId?: string; // Laboratuvar ID (koordinat erişimi için)
  groupId: string;
  groupName: string;
  deviceId: string;
  model: string;
  serial: string;
  orderInGroup: number;
  description: string;
  status: DeviceFaultStatus;
  faultType: 'teknik_servis' | 'aplikasyon';
  affectsAllDevices?: boolean;
  affectedDeviceIds?: string[];
  openedAt: Date | null;
  openedBy: string;
  openedByName: string;
  closedAt: Date | null;
  closedBy?: string;
  closedByUid?: string;
  closedByName?: string;
  source: string;

  // Yeni atama sistemi alanları
  assignedAt?: Date | null;           // Atama zamanı
  assignedToUid?: string;             // Atanan personel UID
  assignedToName?: string;            // Atanan personel adı

  // Müdahale bilgileri
  interventionType?: InterventionType | null;  // telefon veya kurum_ziyaret
  interventionStartedAt?: Date | null;         // Müdahale başlangıç zamanı

  // Konum doğrulama
  locationVerifiedAt?: Date | null;   // Konum doğrulama zamanı
  locationVerifiedLat?: number;       // Doğrulanan konum - enlem
  locationVerifiedLng?: number;       // Doğrulanan konum - boylam

  // İlişkili testler (opsiyonel)
  relatedTests?: string[];            // İlişkili test adları listesi

  // Süre hesaplama alanları (milisaniye cinsinden)
  atamaBekmeSuresi?: number;          // Açılıştan atamaya kadar geçen süre
  mudahaleBekmeSuresi?: number;       // Atamadan müdahaleye kadar geçen süre
  cozumSuresi?: number;               // Müdahaleden çözüme kadar geçen süre
  toplamCozumSuresi?: number;         // Açılıştan çözüme kadar toplam süre

  // Ejected kit fault fields
  isEjectedKitFault?: boolean;
  productStokKodu?: string;
  productStokAdi?: string;
  productCihazGrubu?: string;
  kitResolution?: 'imha' | 'tekrar_kullanim' | null;
  ejectedKitRecordId?: string;
  testCount?: number;
  // Additional fields
  title?: string;
  closeDescription?: string;

  // Destek personeli (arıza kapatılırken seçilen eşlik eden personel)
  supportPersonnelUid?: string;
  supportPersonnelName?: string;
  isCustomFault?: boolean;
}


export type AppView =
  | 'dashboard'
  | 'planner'
  | 'mal-kabul'
  | 'stok-yonetimi'
  | 'siparisler'
  | 'laboratuvar-yonetimi'
  | 'raporlama'
  | 'yonetim'
  | 'urun-kullanim'
  | 'sarf-dagitim'
  | 'tuketim-istatistikleri'
  | 'cihaz-yonetimi-ana'
  | 'cihaz-ustu-ekle'
  | 'cihaz-ustu-gecmisi'
  | 'direkt-transfer'
  | 'urun-talep'
  | 'verimlilik-hesaplama'
  | 'cost-dashboard'
  | 'teknik-servis'
  | 'aplikasyon-paneli'
  | 'transfer-gecmis'
  | 'siparis-gecmis'
  | 'kumulatif-gecmis'
  | 'kumulatif-hesaplama'
  | 'arama'
  | 'cihaz-ariza-gecmis'
  | 'personel-islemleri'
  | 'is-analizi'
  | 'total-verimlilik'
  | 'cihazdan-cikan-kit'
  | 'sevkiyat'
  | 'depo-sayim'
  | 'cihaz-yonetimi'
  | 'miad-uyarilari'
  | 'verimlilik'
  | 'numune-arsivi'
  | 'nobet-yonetimi'
  | 'satin-alma'
  | 'kullanici-talepleri'
  | 'maliyet-sayim'
  | 'cari-odeme'
  | 'cari-odeme-onay'
  // Qore Finance Module — Faz 1+
  | 'finans-faturalar'
  | 'finans-tahsilat'
  | 'finans-cari-ekstre'
  | 'finans-banka'
  | 'finans-nakit-akis'
  | 'finans-karlilik'
  ;

export type CihazYonetimiSubView = 'ana' | 'ayarlar' | 'cihazListesi' | 'teknikServis';

// ============================================
// PERİYODİK BAKIM SİSTEMİ TİPLERİ
// ============================================

// Bakım periyot birimi
export type MaintenancePeriodUnit = 'hafta' | 'ay' | 'yil';

// Bakım planı tipi
export type MaintenanceType = 'teknik_servis' | 'aplikasyon';

// Cihaza tanımlı periyodik bakım planı (Maintenance tasks defined for a device)
export interface MaintenancePlan {
  id: string;
  deviceId: string;
  taskName: string;              // İş adı (örn: "Yıllık kalibrasyon")
  periodValue: number;           // Periyot değeri (örn: 3)
  periodUnit: MaintenancePeriodUnit; // Periyot birimi (örn: "ay")
  type: MaintenanceType;         // Teknik servis veya aplikasyon
  createdAt?: Date;
  createdByUid?: string;
  createdByName?: string;
}

// Bakım log kaydı - bir bakım yapıldığında oluşturulur
export interface MaintenanceLog {
  id: string;
  deviceId: string;
  planId: string;                // İlişkili MaintenancePlan ID
  taskName: string;              // İş adı (denormalize)
  completedAt: Date;             // Bakımın yapıldığı tarih
  completedByUid: string;
  completedByName: string;
  nextDueDate: Date;             // Bir sonraki bakım tarihi
  formId?: string;               // İlişkili form ID (deviceActionForms veya aplikasyonActionForms)
  formType?: 'teknik_servis' | 'aplikasyon';
}

// Bakım durumu hesaplaması için yardımcı tip
export interface MaintenanceStatus {
  plan: MaintenancePlan;
  lastLog?: MaintenanceLog;
  daysRemaining: number | null;  // null = hiç yapılmamış
  isOverdue: boolean;            // Süresi geçmiş mi
  nextDueDate: Date | null;
}

// ============================================
// PERİYODİK PARÇA DEĞİŞİMİ SİSTEMİ
// ============================================

// Periyodik değişmesi gereken parça sorumluluğu
export type PeriodicPartResponsibility = 'teknik_servis' | 'aplikasyon' | 'both';

// Cihaza tanımlı periyodik parça değişimi planı
export interface PeriodicPartChange {
  id: string;
  deviceId: string;
  productCodeId: string;         // ProductCode referansı
  stokKodu: string;              // Ürün stok kodu
  stokAdi: string;               // Ürün adı
  periodValue: number;           // Periyot değeri (legacy, varsayılan 1)
  periodUnit: MaintenancePeriodUnit; // Periyot birimi (legacy, varsayılan 'ay')
  nextDueDate?: any;             // İlk beklenen değişim tarihi (açık tarih - Firestore Timestamp)
  periodDays?: number;           // Gün bazlı periyot (örn: 35)
  responsibilityType: PeriodicPartResponsibility; // Sorumluluk tipi
  requiresOutgoingPartInfo: boolean; // Cihazdan çıkan parça bilgisi gerekli mi
  requiresSerialTracking: boolean;   // Seri no takibi yapılacak mı
  createdAt?: Date;
  createdByUid?: string;
  createdByName?: string;
}

// Periyodik parça değişimi log kaydı - bir değişim yapıldığında oluşturulur
export interface PeriodicPartChangeLog {
  id: string;
  deviceId: string;
  periodicPartChangeId: string;  // İlişkili PeriodicPartChange ID
  stokKodu: string;              // Değişen parça stok kodu
  stokAdi: string;               // Değişen parça adı
  completedAt: Date;             // Değişimin yapıldığı tarih
  completedByUid: string;
  completedByName: string;
  nextDueDate: Date;             // Bir sonraki değişim tarihi
  formId?: string;               // İlişkili form ID
  formType?: 'teknik_servis' | 'aplikasyon';
  // Takilen parça bilgileri
  installedPartSerialNumber?: string;
  installedPartFromStock?: boolean; // Şahsi stoktan mı?
  // Cihazdan çıkan parça bilgileri (eğer requiresOutgoingPartInfo true ise)
  removedPartSerialNumber?: string;
  removedPartImageUrl?: string;
}

// Periyodik parça değişimi durumu hesaplaması için yardımcı tip
export interface PeriodicPartChangeStatus {
  partChange: PeriodicPartChange;
  lastLog?: PeriodicPartChangeLog;
  daysRemaining: number | null;  // null = hiç değişilmemiş
  isOverdue: boolean;            // Süresi geçmiş mi
  nextDueDate: Date | null;
}

// ==========================================
// Yedek Parça Transfer ve Şahsi Stok Sistemi
// ==========================================

// Yedek parçanın kaynağı
export type PersonalStockSource = 'depot' | 'device';

// Şahsi stoktaki yedek parça durumu
export type PersonalStockStatus = 'in_stock' | 'used' | 'pending_return';

// Transfer log aksiyonları
export type SparePartTransferAction =
  | 'transfer_to_personnel'  // Depodan personele transfer
  | 'transfer_to_pool'       // Depodan havuz deposuna transfer
  | 'use_from_pool'          // Havuz deposundan cihazda kullanıldı
  | 'use_on_device'          // Cihazda kullanıldı
  | 'return_to_depot'        // Depoya iade edildi (yeni parça)
  | 'submit_to_depot'        // Depoya teslim edildi (cihazdan çıkan)
  | 'return_confirmed'       // Depo tarafından iade teslim alındı
  | 'submit_confirmed'       // Depo tarafından teslim alındı
  | 'cancel_usage';          // Kullanım iptal edildi, parça şahsi stoğa geri döndü

// Personel şahsi stok item
export interface PersonalStockItem {
  id: string;
  ownerUid: string;
  ownerName: string;
  productCodeId: string;       // ProductCode referansı
  stokKodu: string;
  stokAdi: string;
  anaBirim?: string;
  serialNumber: string;        // Seri numarası
  hucreNumarasi?: string;      // Hücre numarası (1 harf + 4 rakam) - tekil takip
  source: PersonalStockSource; // depot = yeni, device = cihazdan çıkan
  sourceDeviceId?: string;     // Cihazdan çıktıysa device ID
  sourceDeviceName?: string;   // Cihazdan çıktıysa device adı
  status: PersonalStockStatus;
  createdAt: Date;
  transferredByUid?: string;   // Transfer eden kişi (lojistik)
  transferredByName?: string;
  previousOwnerUid?: string;   // Personelden personele transferde önceki sahip
  previousOwnerName?: string;
  usedAt?: Date;               // Kullanıldığı tarih
  usedOnDeviceId?: string;     // Kullanıldığı cihaz
  usedOnDeviceName?: string;
  usedOnFormId?: string;       // Kullanıldığı form
  usedOnFormType?: 'teknik_servis' | 'aplikasyon';
  replacedPartId?: string;     // Değişilen parça (cihazdan çıkan) ID
  imageUrl?: string;           // Cihazdan çıkan parça fotoğrafı URL
  usedPartImageUrl?: string;   // Cihaza takılan parça kullanım fotoğrafı URL
}

// ==========================================
// Havuz Depo Stok Sistemi
// ==========================================

// Havuz deposundaki yedek parça durumu
export type PoolStockStatus = 'in_stock' | 'used';

// Havuz depo stok item
export interface PoolWarehouseStockItem {
  id: string;
  poolWarehouseId: string;     // Hangi havuz deposuna ait
  poolWarehouseName: string;
  productCodeId: string;       // ProductCode referansı
  stokKodu: string;
  stokAdi: string;
  anaBirim?: string;
  serialNumber: string;        // Seri numarası
  hucreNumarasi?: string;      // Hücre numarası (1 harf + 4 rakam)
  status: PoolStockStatus;
  createdAt: Date;
  transferredByUid?: string;   // Transfer eden kişi (lojistik)
  transferredByName?: string;
  usedAt?: Date;               // Kullanıldığı tarih
  usedByUid?: string;          // Kullanan personel UID
  usedByName?: string;         // Kullanan personel adı
  usedOnDeviceId?: string;     // Kullanıldığı cihaz
  usedOnDeviceName?: string;
  usedOnFormId?: string;       // Kullanıldığı form
  usedOnFormType?: 'teknik_servis' | 'aplikasyon';
  usedOnLabId?: string;        // Kullanıldığı laboratuvar
  usedOnLabName?: string;
  source: PersonalStockSource; // depot = yeni, device = cihazdan çıkan
  cihazGrubu?: string;
}

// Transfer/kullanım/iade log kaydı
export interface SparePartTransferLog {
  id: string;
  action: SparePartTransferAction;
  personalStockId?: string;    // İlişkili PersonalStockItem
  productCodeId?: string;
  stokKodu: string;
  stokAdi: string;
  anaBirim?: string;
  serialNumber: string;
  hucreNumarasi?: string;      // Hücre numarası (1 harf + 4 rakam)
  removedHucreNumarasi?: string; // Hücre değişiminde cihazdan çıkan hücre
  fromUid?: string;            // Kimden
  fromName?: string;
  toUid?: string;              // Kime
  toName?: string;
  deviceId?: string;           // İlgili cihaz
  deviceName?: string;
  labName?: string;
  formId?: string;             // İlgili form
  formType?: 'teknik_servis' | 'aplikasyon';
  createdAt: Date;
  createdByUid: string;
  createdByName: string;
  notes?: string;
  usageImageUrl?: string;      // Cihaza takılan/kullanılan parçanın fotoğrafı URL
}

// Depoya iade/teslim bekleyen parça
export interface PendingReturn {
  id: string;
  personalStockId: string;
  ownerUid: string;
  ownerName: string;
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  anaBirim?: string;
  serialNumber: string;
  hucreNumarasi?: string;      // Hücre numarası (1 harf + 4 rakam)
  source: PersonalStockSource; // Orijinal kaynak
  sourceDeviceId?: string;
  sourceDeviceName?: string;
  returnType: 'return_to_depot' | 'submit_to_depot'; // return_to_depot = iade (yeni parça), submit_to_depot = teslim (cihazdan çıkan)
  returnCondition?: 'iyi' | 'miad_gecmis' | 'arizali'; // Parçanın iade durumu
  returnNote?: string;           // Açıklama (arızalı/miadı geçmiş için zorunlu, iyi için opsiyonel)
  status: 'pending' | 'confirmed';
  requestedAt: Date;
  requestedByUid?: string;
  requestedByName?: string;
  confirmedAt?: Date;
  confirmedByUid?: string;
  confirmedByName?: string;
  imageUrl?: string;           // Cihazdan çıkan parça fotoğrafı URL
  returnConditionNote?: string;
}

// Transfer row for spare part transfer panel
export interface SparePartTransferRow {
  id: string;                  // Geçici ID
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  anaBirim?: string;
  serialNumber: string;
  hucreNumarasi?: string;      // Hücre numarası (1 harf + 4 rakam)
  quantity: number;            // Seri numarasız transferlerde adet (seri numaralıysa 1)
  cihazGrubu?: string;        // Cihaz ana grubu (kutu, adet, şişe vs.)
  targetUid: string;
  targetName: string;
}

// Yedek Parça Depo Stok (bağımsız koleksiyon - stok yönetiminden ayrı)
export interface YedekParcaDepoStokItem {
  id: string;
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  anaBirim?: string;
  address?: string;              // Depo adresleme bilgisi (raf, göz vb.)
  serialNumber?: string;         // Opsiyonel seri numarası
  hucreNumarasi?: string;        // Hücre numarası (1 harf + 4 rakam) - tekil takip
  quantity: number;              // Seri numarasız ürünler için adet
  partCondition?: 'iyi' | 'arizali' | 'miadi_gecmis' | 'diger';
  partConditionNote?: string;
  cihazGrubu?: string;          // Cihaz ana grubu (kutu, adet, şişe vs.)
  createdAt: Date;
  createdByUid: string;
  createdByName: string;
}

// Yedek Parça Depo Stok Log (tüm stok giriş/çıkış/transfer işlemleri)
export type YedekParcaLogAction =
  | 'stok_giris'              // Depoya stok girişi (manuel)
  | 'stok_giris_excel'        // Depoya stok girişi (Excel ile)
  | 'transfer_cikis'          // Depodan personele transfer (stok düşümü)
  | 'iade_giris'              // Personelden depoya iade (stok artışı)
  | 'stok_duzeltme';          // Manuel stok düzeltmesi

export interface YedekParcaDepoLog {
  id: string;
  action: YedekParcaLogAction;
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  anaBirim?: string;
  address?: string;
  cihazGrubu?: string;
  serialNumber?: string;
  quantity: number;              // İşlemdeki adet
  relatedTransferId?: string;   // İlişkili transfer ID (varsa)
  relatedPersonnelUid?: string; // İlişkili personel (transfer için)
  relatedPersonnelName?: string;
  notes?: string;
  createdAt: Date;
  createdByUid: string;
  createdByName: string;
}

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export type ParsedResult = {
  refNo: string;
  lotNumarasi: string;
  miadFormatted: string;
  seriNumarasi: string;
  stokKodu?: string; // Can be added later after matching refNo
  product?: ProductCode; // Can be added later after matching refNo
}


export type Currency = 'EUR' | 'USD' | 'TRY';
export type TrackingType = 'serial' | 'lot_barcode' | 'lot_manual' | 'quantity_only';
export type Laboratory = Hospital;
export type LabDeviceAssignment = AssignedDevice;

export interface SummaryRow {
  test: string;
  routine: number;
  rerun: number;
  calib: number;
  control: number;
  total: number;
};


// ============================================
// ARA KAYIT (DRAFT FORM) SİSTEMİ
// ============================================

export interface DraftActionForm {
  id: string;
  deviceId: string;
  hospitalId: string;
  formType: 'teknik_servis' | 'aplikasyon';
  // Form state data
  actions: any[];
  islemTipi?: string;
  islemTuru?: string;
  aciklama?: string;
  baslangicSaati?: string;
  bitisSaati?: string;
  baslangicTarihi?: string;
  bitisTarihi?: string;
  selectedMaintenanceTasks?: string[];
  selectedPeriodicParts?: string[];
  selectedOperations?: string[];
  selectedFaultId?: string;
  customFaultName?: string;
  selectedTests?: string[];
  // Log entries from previous personnel
  actionLogs?: DraftActionLog[];
  // Draft metadata
  createdAt: Date;
  createdByUid: string;
  createdByName: string;
  updatedAt?: Date;
  updatedByUid?: string;
  updatedByName?: string;
}

export interface DraftActionLog {
  personnelUid: string;
  personnelName: string;
  timestamp: Date;
  logType: 'action_added' | 'action_removed' | 'field_changed' | 'draft_created' | 'draft_continued';
  description: string;
  details?: any;
}

export type ParseTarget = 'reference' | 'barcodeNumber';
export type ExpiryPattern = 'YYMMDD' | 'YYYYMMDD' | 'DDMMYYYY' | 'MMYY' | 'MMYYYY' | 'text';
export type PositionDef = { start: number; length: number };


export type BarcodeFormat = {
  id: string;
  name: string;
  strategy: 'positional' | 'regex' | 'legacy_roche';
  active: boolean;
  priority: number;
  totalLength?: number;
  reference?: { start: number; length: number };
  lot?: { start: number; length: number };
  expiry?: { start: number; length: number; pattern: ExpiryPattern };
  serial?: { start: number; length: number };
  trackSerial?: boolean;
  trackLot?: boolean;
  regex?: string;
  fields?: { reference?: number; lot?: number; expiry?: number; serial?: number };
  parseTarget?: ParseTarget;
};


export interface Transfer {
  id: string;
  sourceDepotId: string;
  sourceDepotName: string;
  targetName: string;
  userId?: string;
  userName?: string;
  timestamp: TimestampLike;
  itemCount: number;
  [k: string]: any;
}


export interface TestDefinition {
  id: string;
  name: string;
  linkedProductCode: string; // stokKodu
}

/**
 * Envanter (zimmet edilebilen demirbaş) — bilgisayar, barkod okuyucu,
 * dolap, klima vb. Maliyet hesabında lab'ın "envanter maliyeti" kalemine girer.
 */
export interface Asset {
  id: string;
  category: string;
  demirbasNo: string;
  urunKodu?: string;
  urunAdi: string;
  marka?: string;
  model?: string;
  seriNumarasi?: string;
  durum?: 'iyi' | 'orta' | 'kötü' | 'çok kötü';
  konum: string;
  manuelKonum?: string;
  alimFiyatiTl?: number;
  satinAlmaTarihi?: string;
  garantiBitisTarihi?: string;
  planliKullanimOmruYil?: number;
  amortismanYontemi?: 'dogrusal' | 'azalan_bakiye';
  amortismanBaslangicTarihi?: string;
  /** Mülkiyet tipi: satın alma (varsayılan, alimFiyatiTl + planliKullanimOmruYil) veya kira */
  mulkiyet?: 'satin_alma' | 'kira';
  /** Kira tutarı (mulkiyet='kira' ise) */
  kiraTutari?: number;
  /** Kira dönemi (mulkiyet='kira' ise; varsayılan 'aylik') */
  kiraDonemi?: 'aylik' | 'yillik';
  /** Kira bitiş tarihi (mulkiyet='kira' ise) */
  kiraBitisTarihi?: string;
  /** Maliyet para birimi (varsayılan TRY) */
  maliyetCurrency?: 'EUR' | 'USD' | 'TRY';
  hurdaTarihi?: string;
  imhaTarihi?: string;
  satisTarihi?: string;
  sonBakimTarihi?: string;
  sonrakiBakimTarihi?: string;
  sonKalibrasyonTarihi?: string;
  sonrakiKalibrasyonTarihi?: string;
  bakimMaliyetiTl?: number;
  zimmetliKisi?: string;
  checkOutTarihi?: string;
  checkInTarihi?: string;
  dijitalImza?: string;
  zimmetFisNo?: string;
  teslimEdilenPersonel?: string;
  aciklama?: string;
  companyId?: string;
}

/**
 * Global test/hak ediş tanımı.
 *
 * Eski model: her laboratuvarın subcollection'ı `hospitals/{labId}/hakEdisDefinitions`
 * altında ayrı SUT tanımları vardı. Yeni model bu tanımları sistem geneline taşır
 * (tek bir koleksiyon: `testDefinitions`) ve aynı testi birden fazla ürüne
 * (kit + sarf gibi) bağlayabilmek için `linkedStokKodlari` array'ini kullanır.
 */
export interface TestDefinitionGlobal {
  id: string;
  /** SUT kodu (örn: "900.010") */
  sutKodu: string;
  /** SUT test adı (örn: "Glikoz Tayini") */
  sutTestAdi: string;
  /** Bu teste bağlı bir veya birden çok ürün stok kodu */
  linkedStokKodlari: string[];
  /** SUT karşılığı hak ediş tutarı (TL) */
  hakEdisMiktari: number;
  /** Hak ediş tutarının para birimi (varsayılan TRY) */
  currency?: 'EUR' | 'USD' | 'TRY';
  aktif: boolean;
  createdAt: TimestampLike;
  createdByUid?: string;
  createdByName?: string;
  updatedAt?: TimestampLike;
  companyId?: string;
}

/**
 * Personel (laboratuvarda çalışan) modeli.
 *
 * Sisteme login olan kullanıcı `User` ile karıştırılmamalıdır; bir personel
 * istenirse bir `User` ile eşleştirilebilir (`userId`).
 */
export interface Personnel {
  id: string;
  adSoyad: string;
  pozisyon?: string;
  /** Personelin görev yaptığı laboratuvarların id listesi */
  assignedLabIds: string[];
  /** Ana sorumluluk laboratuvarı (raporlamada ağırlıklandırma için) */
  primaryLabId?: string;
  /** Aylık brüt maaş */
  aylikBrutMaas: number;
  /** Aylık yan haklar (yemek, yol, sigorta vb.) */
  aylikYanHaklar?: number;
  currency: 'EUR' | 'USD' | 'TRY';
  aktif: boolean;
  baslamaTarihi?: string;
  /** Varsa bağlı kullanıcı UID'si */
  userId?: string;
  companyId?: string;
  createdAt?: TimestampLike;
  updatedAt?: TimestampLike;
}

export interface LabPool {
  id: string;
  name: string;
  memberIds: string[];
  active: boolean;
  createdAt: any;
  createdByUid: string;
  createdByName: string;
  mainLabId?: string; // NEW
}

// Verimlilik Havuzu - Total Verimlilik paneli için laboratuvar grupları
export interface EfficiencyPool {
  id: string;
  name: string;
  memberIds: string[]; // Havuza dahil laboratuvar ID'leri
  centerLabId?: string; // Merkez laboratuvar ID'si - hak ediş hesaplamalarında kullanılır
  active: boolean;
  createdAt: any;
  createdByUid: string;
  createdByName: string;
}

// Cihaz Laboratuvar Havuzu - Cihaz tanımlamaları panelinde laboratuvar gruplandırması
export interface DeviceLabPool {
  id: string;
  name: string;
  memberIds: string[]; // Havuza dahil laboratuvar ID'leri
  active: boolean;
  createdAt: any;
  createdByUid: string;
  createdByName: string;
}

// Total Verimlilik kayıt satırı
export interface TotalEfficiencyRow {
  labId: string;
  labName: string;
  stokKodu: string;
  stokAdi: string;
  testAdi: string;
  ambalajDegeri: number;
  cihazGrubu: string;
  baslangicStokuKutu: number; // Manuel giriş - kutu cinsinden
  ayBasiCihazUstuTest: number; // Manuel giriş - test adedi
  totalAyBasiStok: number; // Hesaplanan: (baslangicStokuKutu * ambalajDegeri) + ayBasiCihazUstuTest
  sevkiyatKutu: number; // Manuel giriş
  sevkiyatTest: number; // Hesaplanan
  donemSonuStokKutu: number; // Manuel giriş
  donemSonuCihazUstuTest: number; // Manuel giriş
  totalDonemSonuStok: number; // Hesaplanan
  kumulatifDeger: number; // Manuel giriş
  hesaplananTuketim: number; // Hesaplanan
  stokDogrulukOrani: number; // Hesaplanan yüzde
  hakEdis: number; // Manuel giriş
  hakEdisVerimliligi: number; // Hesaplanan yüzde
}

// Total Verimlilik kayıt dökümanı
export interface TotalEfficiencyRecord {
  id: string;
  poolId: string;
  poolName: string;
  month: number;
  year: number;
  rows: TotalEfficiencyRow[];
  createdAt: any;
  createdByUid: string;
  createdByName: string;
  updatedAt?: any;
}

export interface LabResultExcelRow {
  sourceFileId: string;
  importDate: Date;
  hastaId?: string;
  ornekNo?: string;
  hastaneId?: string;
  hastaneAdi?: string;
  acil?: string;
  yatan?: string;
  testId?: string;
  testAdi?: string;
  endikeKodu?: string;
  barkodNo?: string;
  servisKodu?: string;
  servisAdi?: string;
  doktorBrans?: string;
  doktorAdi?: string;
  tekrarSayisi?: number;
  cihazNo?: string;
  retNedeni?: string;
  onaylayanAd?: string;
  onaylayanUnvan?: string;
  sonucDurum?: string;
  istemTarihi?: Date | string;
  kayitTarihi?: Date | string;
  kanAlmaTarihi?: Date | string;
  labKabulTarihi?: Date | string;
  calismaTarihi?: Date | string;
  altOnayTarih?: Date | string;
  onayTarih?: Date | string;
  otoOnayliMi?: string;
  hedefSureDakika?: number | string;
  materyal?: string;
  bolgeKodu?: string;
  dislabKabul?: string;
  tupAdi?: string;
}

// Cihazdan çıkan kit (ejected kit) records
export interface EjectedKitRecord {
  id: string;
  laboratoryId: string;
  laboratoryName: string;
  deviceId: string;
  deviceModel: string;
  deviceSerial: string;
  deviceImageUrl: string;
  stokKodu: string;
  stokAdi: string;
  cihazGrubu?: string;
  quantityType: 'kutu' | 'test';
  testCount: number; // ambalajDegeri if kutu, manual entry if test
  aciklama: string;
  createdAt: TimestampLike;
  createdByUid: string;
  createdByName: string;
  faultReportId: string; // Link to created fault reports
}

// Destroyed kits report for "imha" resolution
export interface DestroyedKitRecord {
  id: string;
  ejectedKitRecordId: string | null;
  faultReportId: string | null;
  laboratoryId: string | null;
  laboratoryName: string;
  depotId?: string | null; // NEW: For depot-sourced destructions
  depotName?: string; // NEW: For depot-sourced destructions
  deviceId: string | null;
  deviceModel: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string; // NEW: Lot number
  miad?: string; // NEW: Expiry date
  seriNumarasi?: string; // NEW: Serial number
  testCount: number;
  remainingTests?: number; // NEW: Remaining tests in the kit before destruction
  aciklama: string;
  resolvedAt: TimestampLike;
  resolvedByUid: string;
  resolvedByName: string;
  sourceType?: 'barcode' | 'excel' | 'fault'; // NEW: Source of destruction
}

export interface TrashBinRecord {
  id: string;
  laboratoryId: string;
  laboratoryName: string;
  deviceId: string;
  deviceModel: string;
  deviceSerialNumber: string;
  stokKodu: string;
  stokAdi: string;
  remainingTests: number;
  createdAt: TimestampLike;
  createdByUid: string;
  createdByName: string;
  sourceType: 'manual'; // For now, only manual entry
}

export interface Rack {
  id: string;
  labId: string;
  labCode: string;
  fridgeCode: string;
  date: string;
  sequence: number;
  status: 'open' | 'sealed';
  specimens?: string[];
  specimenCount?: number;
  sealedAt?: any;
  createdAt?: any;
  [k: string]: any;
}

// Lab Transfer Dates - Tracks last transfer dates per product from depot to lab
export interface LabTransferDates {
  id: string; // Format: {labId}_{depotId}
  labId: string;
  depotId: string;
  labName: string;
  depotName: string;
  // Map of stokKodu -> transfer info
  transfers: Record<string, {
    lastTransferDate: TimestampLike;
    lastTransferBy?: string;
  }>;
  updatedAt: TimestampLike;
}

// Route Request - Laboratuvar ekleme veya yer değişikliği talepleri
export interface RouteRequest {
  id: string;
  type: 'add' | 'reorder'; // 'add': Route'a ekleme, 'reorder': Yer değişikliği
  labId: string;
  labName: string;
  labLat?: number;
  labLng?: number;
  routeId: string;
  routeDate: string; // ISO date string
  routeDriverName: string;
  // Ekleme talebi için: hangi duraktan sonra eklenmeli
  insertAfterStopId?: string | null;
  insertAfterStopName?: string | null;
  // Yer değişikliği için: mevcut ve istenen sıra
  currentOrder?: number;
  requestedOrder?: number;
  requestedAfterStopId?: string | null;
  requestedAfterStopName?: string | null;
  // Talep bilgileri
  requestedBy: string; // User ID
  requestedByName: string;
  requestedAt: TimestampLike;
  note?: string;
  // Durum
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: TimestampLike;
  rejectionReason?: string;
}

// ==========================================
// Arıza Tanımlamaları Sistemi
// ==========================================

// Arıza tanımı tipi (teknik servis veya aplikasyon)
export type FaultDefinitionType = 'teknik_servis' | 'aplikasyon';

// Arıza tanımı
export interface FaultDefinition {
  id: string;
  name: string;                    // Arıza adı
  type: FaultDefinitionType;       // Teknik servis veya aplikasyon
  createdAt?: Date;
  createdByUid?: string;
  createdByName?: string;
}

// ==========================================
// Nöbet Vardiyası Sistemi
// ==========================================

// Vardiya rolü (teknik servis veya aplikasyon)
export type DutyShiftRole = 'teknik_servis' | 'aplikasyon';

// Vardiya durumu
export type DutyShiftStatus = 'active' | 'completed' | 'cancelled';

// Nöbet vardiyası
export interface DutyShift {
  id: string;
  // Personel bilgileri
  userId: string;                  // Atanan kullanıcının ID'si
  userName: string;                // Atanan kullanıcının adı
  role: DutyShiftRole;             // Teknik servis veya aplikasyon
  // Laboratuvar atamaları
  laboratoryIds: string[];         // Atanan laboratuvar ID'leri
  laboratoryNames: string[];       // Atanan laboratuvar adları
  // Tarih aralığı
  startDate: TimestampLike;        // Vardiya başlangıç tarihi
  endDate: TimestampLike;          // Vardiya bitiş tarihi
  startTime?: string;              // Başlangıç saati (HH:mm)
  endTime?: string;                // Bitiş saati (HH:mm)
  // Durum
  status: DutyShiftStatus;
  // Meta bilgiler
  createdAt: TimestampLike;
  createdByUid: string;
  createdByName: string;
  updatedAt?: TimestampLike;
  updatedByUid?: string;
  updatedByName?: string;
  // Notlar
  notes?: string;
}

// ==========================================
// Transfer Şablonu Sistemi
// ==========================================

// Şablon satırı - bir ürünü temsil eder
export interface TransferTemplateItem {
  stokKodu: string;
  stokAdi: string;
  tracking: TrackingMode;
  defaultQty?: number; // Varsayılan adet (opsiyonel)
}

// Transfer şablonu
export interface TransferTemplate {
  id: string;
  name: string;
  items: TransferTemplateItem[];
  createdAt: TimestampLike;
  createdByUid: string;
  createdByName: string;
  updatedAt?: TimestampLike;
  updatedByUid?: string;
  updatedByName?: string;
}

// ==========================================
// Planlama Birimi Görev Sistemi
// ==========================================

export interface PurchasingTask {
  id: string;
  title: string;
  description: string;
  taskType: string;
  date: string;               // ISO date string (YYYY-MM-DD)
  startTime: string;           // HH:mm format
  endTime: string;             // HH:mm format
  completed: boolean;
  createdAt: TimestampLike;
  createdByUid: string;
  createdByName: string;
  updatedAt?: TimestampLike;
  // Priority system
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  // Sort order within a day
  sortOrder?: number;
  // Recurring tasks
  recurring?: PurchasingTaskRecurrence;
  recurringGroupId?: string;   // groups recurring task instances
  // Subtasks / checklist
  subtasks?: PurchasingSubtask[];
  taskTypeLabel?: string;
  // Kurum Ziyareti specific fields
  laboratoryId?: string;
  laboratoryName?: string;
  accompanyingPersonnel?: { uid: string; name: string }[];
  // File attachments
  attachments?: PurchasingTaskAttachment[];
  // Task followers / assignees
  assignedPersonnel?: { uid: string; name: string }[];
  // Notes & comments for collaboration
  comments?: PurchasingTaskComment[];
  // Immutable task activity history
  activityLogs?: PurchasingTaskActivityLog[];
  // Workflow metadata
  workflowProjectId?: string;
  workflowColor?: string;
  // Completion flow metadata
  completionChecklist?: PurchasingCompletionChecklistItem[];
  expectedCompletionFileName?: string;
  // Haftalık plan onay akışı
  weeklyPlanGroupId?: string;          // aynı haftalık plandan üretilen tüm görevler için ortak id
  weeklyPlanWeekStart?: string;        // haftanın başlangıç tarihi (YYYY-MM-DD)
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  approvalRequiredFromUid?: string;    // onay bekleyen firma sorumlusunun uid'i
  approvalRequiredFromName?: string;
  approvedByUid?: string;
  approvedByName?: string;
  approvedAt?: TimestampLike;
  rejectedReason?: string;
}

export interface PurchasingCompletionChecklistItem {
  id: string;
  title: string;
  completed: boolean;
}

export interface PurchasingSubtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface PurchasingTaskRecurrence {
  type: 'daily' | 'weekly' | 'monthly';
  interval: number;           // every N days/weeks/months
  endDate?: string;           // optional end date (YYYY-MM-DD)
  daysOfWeek?: number[];      // 0=Sun..6=Sat (for weekly)
  dayOfMonth?: number;        // 1-31 (for monthly)
}

export interface PurchasingTaskAttachment {
  name: string;
  url: string;
  type: 'image' | 'pdf' | 'file';
  size: number; // bytes
  storagePath: string;
}

export interface PurchasingTaskComment {
  id: string;
  message: string;
  createdAt: TimestampLike;
  createdByUid: string;
  createdByName: string;
}

export interface PurchasingTaskActivityLog {
  id: string;
  action: string;
  message: string;
  createdAt: TimestampLike;
  createdByUid: string;
  createdByName: string;
}


export interface PurchasingWorkflowEdge {
  id: string;
  fromTaskId: string;
  toTaskId: string;
}

export interface PurchasingWorkflowNodePosition {
  taskId: string;
  x: number;
  y: number;
}

export interface PurchasingWorkflowProject {
  id: string;
  name: string;
  color: string;
  taskIds: string[];
  nodes: PurchasingWorkflowNodePosition[];
  edges: PurchasingWorkflowEdge[];
  createdAt?: TimestampLike;
  updatedAt?: TimestampLike;
  createdByUid?: string;
  createdByName?: string;
}

export interface PurchasingTaskDefinition {
  id: string;
  name: string;
  requiresLaboratory?: boolean;
  active?: boolean;
  createdAt?: TimestampLike;
}

// ============================================
// KULLANICI TALEP SİSTEMİ
// ============================================

export type UserRequestCategory = 'bug' | 'improvement' | 'feature' | 'design';
export type UserRequestPriority = 'low' | 'normal' | 'urgent';
export type UserRequestStatus = 'open' | 'reviewing' | 'done';

export interface UserRequestComment {
  id: string;
  text: string;
  authorUid: string;
  authorName: string;
  authorRole: 'user' | 'admin' | 'admin_developer' | 'super_admin';
  images?: string[];
  createdAt: TimestampLike;
}

export interface UserRequest {
  id: string;
  title: string;
  description: string;
  images: string[]; // Storage URLs
  category: UserRequestCategory;
  priority: UserRequestPriority;
  status: UserRequestStatus;
  createdBy: string; // uid
  createdByName: string;
  assignedTo: string; // uid of assigned admin
  assignedToName: string;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  resolvedAt?: TimestampLike;
  resolvedBy?: string; // uid
  resolvedByName?: string;
  adminNote?: string;
  reopenReason?: string;
  comments?: UserRequestComment[];
  unreadByUser: boolean;
}

/**
 * Bekleyen İrsaliye — Dosya yönetiminde OCR ile taranıp onaylanmış,
 * lab stoğuna aktarılmayı bekleyen irsaliye kaydı.
 */
export type BekleyenIrsaliyeStatus = 'pending' | 'transferred' | 'cancelled';

export interface BekleyenIrsaliyeItem {
  stokKodu: string;
  stokAdi: string;
  marka?: string;
  lot?: string;
  miad?: string; // dd.MM.yyyy
  rawLine?: string;
  /** Faturada yazan ham miktar (örn. 750). */
  sourceQuantity: number;
  /** Faturada yazan birim (ADET, KUTU, PAKET, ...). */
  sourceUnit?: string;
  /** Sistem ana birimine dönüştürülmüş miktar (örn. 30 kutu). */
  convertedQuantity: number;
  /** Sistem ana birimi (örn. "Kutu"). */
  convertedUnit?: string;
  /** Sistem tarafında tanımlı ana birim. */
  anaBirim?: string;
  /** Sistem tarafında tanımlı ambalaj değeri. */
  ambalajDegeri?: number;
  /** Birim dönüşümü gerçekten uygulandı mı? */
  conversionApplied?: boolean;
  conversionReasoning?: string;
  /** Eşleşmenin gücü. */
  matchConfidence: 'high' | 'medium' | 'low';
  /** stokKodu üzerinden mi yoksa stokAdı üzerinden mi eşleşti? */
  matchedBy?: 'stok_kodu' | 'stok_adi' | 'none';
}

export interface BekleyenIrsaliye {
  id: string;
  companyId?: string;
  /** irsaliyeDosyalari koleksiyonundaki kaynağa referans. */
  dosyaId: string;
  dosyaName: string;
  storagePath?: string;
  downloadURL?: string;
  locationType: 'hospital' | 'depot';
  locationId: string;
  locationName: string;
  /** Faturadan tespit edilen irsaliye numarası (varsa). */
  irsaliyeNumber?: string;
  /** Faturadan tespit edilen irsaliye tarihi (dd.MM.yyyy). */
  irsaliyeDate?: string;
  /** Faturadaki satıcı/firma adı. */
  supplierName?: string;
  /** Faturada tespit edilen markaların listesi. */
  brands: string[];
  /** Faturadaki toplam satır sayısı (ürün çeşit sayısı). */
  itemCount: number;
  /** Sistem ana birimine dönüştürülmüş toplam adet (genel özet için). */
  totalConvertedQuantity: number;
  items: BekleyenIrsaliyeItem[];
  status: BekleyenIrsaliyeStatus;
  scannedAt: TimestampLike;
  scannedByUid?: string;
  scannedByName?: string;
  transferredAt?: TimestampLike;
  transferredByUid?: string;
  transferredByName?: string;
  /** Genel AI yorumu (örn. okuyamadığı yerler). */
  aiNotes?: string;
  scanModel?: string;
}
