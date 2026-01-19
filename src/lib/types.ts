

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
  role: 'admin' | 'user' | 'teknik_servis' | 'aplikasyon' | 'teknisyen' | string;
  name?: string;
  nfcId?: string; // Optional field for NFC card ID
  phoneNumber?: string;
  createdAt?: Date;
  accessibleViews?: AppView[];
  assignedLaboratories?: string[]; // Array of laboratory IDs
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
  ;

export type CihazYonetimiSubView = 'ana' | 'ayarlar' | 'cihazListesi' | 'teknikServis';

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
