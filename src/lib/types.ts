

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
  fefoEnabled?: boolean;
  customProductOrder?: string[]; // Özel ürün sıralama - sipariş toplama ekranında kullanılır
  [k: string]: any;
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
  companies?: string[]; // Added for Borç Depo
  // Konum bilgileri - rota planlama için
  lat?: number;
  lng?: number;
  address?: string;
  [k: string]: any;
}

export interface MinMaxRule {
  stokKodu: string; // Add stokKodu to be able to identify the rule
  min: number;
  max: number;
  aylikTuketimLimiti?: number; // Monthly consumption limit
}

export interface User {
  uid: string;
  email: string | null;
  role: 'admin' | 'user' | 'teknik_servis' | 'aplikasyon' | 'teknisyen' | 'teknik_lojistik' | 'satin_alma' | string;
  name?: string;
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
  [k: string]: any;
}

export interface OrderItem {
  id: string;
  stokKodu: string;
  stokAdi: string;
  adet: number;
}

export interface Order {
  id: string; // Firestore document ID
  depotId?: string; // The depot that should fulfill this.
  labId?: string;
  kurumAdi: string;
  items: OrderItem[];
  createdAt: TimestampLike;
  status: 'pending' | 'toplaniyor' | 'completed' | string;
  transferredAt?: TimestampLike | null;
  olusturmaTarihi?: TimestampLike;
  depotName?: string;
  createdById?: string;
  createdBy?: string;
  transferredById?: string;
  transferredBy?: string;
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


export interface Device {
  id: string;
  brand: string;
  model: string;
  imageUrl: string;
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
  openedAt: Date | null;
  openedBy: string;
  openedByName: string;
  closedAt: Date | null;
  closedBy?: string;
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
  ;

export type CihazYonetimiSubView = 'ana' | 'ayarlar' | 'cihazListesi' | 'teknikServis';

// ============================================
// PERİYODİK BAKIM SİSTEMİ TİPLERİ
// ============================================

// Bakım periyot birimi
export type MaintenancePeriodUnit = 'hafta' | 'ay' | 'yil';

// Bakım planı tipi
export type MaintenanceType = 'teknik_servis' | 'aplikasyon';

// Cihaza tanımlı periyodik bakım planı
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
  | 'use_on_device'          // Cihazda kullanıldı
  | 'return_to_depot'        // Depoya iade edildi (yeni parça)
  | 'submit_to_depot'        // Depoya teslim edildi (cihazdan çıkan)
  | 'return_confirmed'       // Depo tarafından iade teslim alındı
  | 'submit_confirmed';      // Depo tarafından teslim alındı

// Personel şahsi stok item
export interface PersonalStockItem {
  id: string;
  ownerUid: string;
  ownerName: string;
  productCodeId: string;       // ProductCode referansı
  stokKodu: string;
  stokAdi: string;
  serialNumber: string;        // Seri numarası
  source: PersonalStockSource; // depot = yeni, device = cihazdan çıkan
  sourceDeviceId?: string;     // Cihazdan çıktıysa device ID
  sourceDeviceName?: string;   // Cihazdan çıktıysa device adı
  status: PersonalStockStatus;
  createdAt: Date;
  transferredByUid?: string;   // Transfer eden kişi (lojistik)
  transferredByName?: string;
  usedAt?: Date;               // Kullanıldığı tarih
  usedOnDeviceId?: string;     // Kullanıldığı cihaz
  usedOnDeviceName?: string;
  usedOnFormId?: string;       // Kullanıldığı form
  usedOnFormType?: 'teknik_servis' | 'aplikasyon';
  replacedPartId?: string;     // Değişilen parça (cihazdan çıkan) ID
  imageUrl?: string;           // Cihazdan çıkan parça fotoğrafı URL
}

// Transfer/kullanım/iade log kaydı
export interface SparePartTransferLog {
  id: string;
  action: SparePartTransferAction;
  personalStockId?: string;    // İlişkili PersonalStockItem
  productCodeId?: string;
  stokKodu: string;
  stokAdi: string;
  serialNumber: string;
  fromUid?: string;            // Kimden
  fromName?: string;
  toUid?: string;              // Kime
  toName?: string;
  deviceId?: string;           // İlgili cihaz
  deviceName?: string;
  formId?: string;             // İlgili form
  formType?: 'teknik_servis' | 'aplikasyon';
  createdAt: Date;
  createdByUid: string;
  createdByName: string;
  notes?: string;
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
  serialNumber: string;
  source: PersonalStockSource; // Orijinal kaynak
  sourceDeviceId?: string;
  sourceDeviceName?: string;
  returnType: 'return_to_depot' | 'submit_to_depot'; // return_to_depot = iade (yeni parça), submit_to_depot = teslim (cihazdan çıkan)
  status: 'pending' | 'confirmed';
  requestedAt: Date;
  requestedByUid?: string;
  requestedByName?: string;
  confirmedAt?: Date;
  confirmedByUid?: string;
  confirmedByName?: string;
  imageUrl?: string;           // Cihazdan çıkan parça fotoğrafı URL
}

// Transfer row for spare part transfer panel
export interface SparePartTransferRow {
  id: string;                  // Geçici ID
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  serialNumber: string;
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
  serialNumber?: string;         // Opsiyonel seri numarası
  quantity: number;              // Seri numarasız ürünler için adet
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
// Satın Alma Birimi Görev Sistemi
// ==========================================

export interface PurchasingTask {
  id: string;
  title: string;
  description: string;
  taskType: 'custom' | 'kurum_ziyareti';
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
  type: 'image' | 'pdf';
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
