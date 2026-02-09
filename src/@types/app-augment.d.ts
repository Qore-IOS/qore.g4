// src/@types/app-augment.d.ts
// Unified augmentation so builds never fail if some exports are missing in "@/lib/types".
declare module "@/lib/types" {
  // ---------- Common / Core ----------
  export type ID = string;
  export type TimestampLike = string | number | Date | { toDate: () => Date; seconds: number; nanoseconds: number; };

  export type AppView =
    | "dashboard"
    | "mal-kabul"
    | "stok-yonetimi"
    | "siparisler"
    | "laboratuvar-yonetimi"
    | "raporlama"
    | "yonetim"
    | "urun-kullanim"
    | "sarf-dagitim"
    | "tuketim-istatistikleri"
    | "cihaz-yonetimi-ana"
    | "cihaz-ustu-ekle"
    | "cihaz-ustu-gecmisi"
    | "direkt-transfer"
    | "urun-talep"
    | "verimlilik-hesaplama"
    | "cost-dashboard"
    | "teknik-servis"
    | "transfer-gecmis"
    | "siparis-gecmis"
    | "kumulatif-gecmis"
    | "kumulatif-hesaplama"
    | "arama"
    | "cihaz-ariza-gecmis"
    | "personel-islemleri"
    | "is-analizi"
    | "total-verimlilik"
    | "cihazdan-cikan-kit"
    | "sevkiyat"
    | "depo-sayim"
    | "cihaz-yonetimi"
    | "miad-uyarilari"
    | "verimlilik"
    | "numune-arsivi";

  export interface User {
    id: ID;
    uid?: string;
    displayName?: string;
    email?: string | null;
    role?: "admin" | "editor" | "viewer" | "user" | "teknik_servis" | "aplikasyon" | string;
    hospitalId?: ID;
    depotId?: ID;
    active?: boolean;
    accessibleViews?: AppView[];
    name?: string;
    nfcId?: string;
    assignedLaboratories?: string[];
    assignedDepots?: string[];
    assignedBrands?: string[];
    phoneNumber?: string;
    createdAt?: TimestampLike;
    notificationsEnabled?: boolean;
    notificationPreferences?: string[];
    themePreference?: 'light' | 'dark' | 'system';
  }

  // ---------- Master Data ----------
  export interface ProductCode {
    id: ID;
    stokKodu: string;
    stokAdi: string;
    barkod?: string;
    anaBirim?: "Kutu" | "Adet" | "Test" | "Flakon" | "Paket" | "Şişe" | string;
    uretici?: string;
    kategori?: string;
    marka?: string;
    laboratuvarGrubu?: string;
    testGrubu?: string;
    cihazGrubu?: string;
    aktif?: boolean;
    ambalajDegeri?: number;
    urunGrubu?: 'kit' | 'sarf' | 'yedek_parca';
    trackingMode?: any; // Keep it flexible
    barcodeNumber?: string;
    barcodeFormatId?: string | null;
    cost?: number;
    currency?: 'EUR' | 'USD' | 'TRY';
    [k: string]: unknown;
  }
  
  export interface Asset {
    id: string;
    category: string;
    demirbasNo: string;
    urunKodu: string;
    urunAdi: string;
    marka: string;
    model: string;
    seriNumarasi?: string; // NEW
    durum?: 'iyi' | 'orta' | 'kötü' | 'çok kötü'; // NEW
    konum: string;
    manuelKonum?: string; // NEW
    teslimEdilenPersonel: string;
    aciklama: string;
  }

  export interface Depot {
    id: ID;
    ad?: string;
    name?: string;
    kod?: string;
    hospitalId?: ID;
    adres?: string;
    aktif?: boolean;
    companies?: string[];
    mapDefinition?: any;
    [k: string]: unknown;
  }

  export interface Hospital {
    id: ID;
    ad?: string;
    name: string;
    kod?: string;
    sehir?: string;
    ilce?: string;
    aktif?: boolean;
    consumptionTrackingEnabled?: boolean;
    fefoEnabled?: boolean;
    address?: string;
    lat?: number;
    lng?: number;
    updatedAt?: TimestampLike;
    createdAt?: TimestampLike;
    [k: string]: unknown;
  }
  export type Laboratory = Hospital;

  export interface AddressDefinition {
    id: ID;
    code?: string;
    description?: string;
    group?: string;
    rack?: string;
    shelf?: string;
    hospitalId?: ID;
    depotId?: ID;
    active?: boolean;
    addressBarcode: string;
    addressName: string;
    [k: string]: unknown;
  }

  // ---------- Inventory & Counting ----------
  export interface DepoStokItem {
    id: ID;
    productCodeId?: ID;
    stokKodu: string;
    stokAdi: string;
    lot?: string;
    lotNumarasi?: string;
    seriNo?: string;
    seriNumarasi?: string;
    adet?: number;
    birim?: string;
    miad: TimestampLike;
    depotId?: ID;
    hospitalId?: ID;
    shelf?: string;
    rafAdresi?: string;
    createdAt?: TimestampLike;
    updatedAt?: TimestampLike;
    hedefKurum?: string;
    isShipped?: boolean;
    sevkTarihi?: TimestampLike;
    depotName?: string;
    eklenmeTarihi?: TimestampLike;
    irsaliyeNumarasi?: string;
    urunGrubu?: 'kit' | 'sarf';
    ambalajDegeri?: number;
    transferId?: string;
    hedefKurumId?: string | null;
    gtin?: string;
    [k: string]: unknown;
  }

  export interface DepotStockCountSession {
    id: ID;
    depotId?: ID;
    depotName?: string;
    brand?: string;
    startedAt?: TimestampLike;
    closedAt?: TimestampLike | null;
    createdBy?: ID;
    createdByName?: string;
    note?: string;
    status?: 'active' | 'completed';
    itemCount?: number;
    scannedCount?: number;
    missingCount?: number;
    [k: string]: unknown;
  }

  export interface HospitalStockCountSession {
    id?: ID;
    hospitalId?: ID;
    startedAt?: TimestampLike;
    closedAt?: TimestampLike | null;
    createdBy?: ID;
    note?: string;
    [k: string]: unknown;
  }

  export interface CellDef {
    row?: number;
    col?: number;
    x?: number;
    y?: number;
    code?: string;
    label?: string;
    group?: string;
    merged?: boolean;
    stokKodu?: string;
    products?: string[];
    [k: string]: unknown;
  }

  export interface SessionCell {
    id?: ID;
    sessionId?: ID;
    address?: string;
    quantity?: number;
    productCodeId?: ID;
    updatedAt?: TimestampLike;
    [k: string]: unknown;
  }

  // ---------- Shipments / Orders ----------
  export interface ShipmentItem {
    id?: ID;
    productCodeId?: ID;
    lot?: string;
    seriNo?: string;
    miktar?: number;
    birim?: string;
    miad?: TimestampLike;
    stokKodu?: string;
    stokAdi?: string;
    lotNumarasi?: string;
    quantity?: number;
    serialNumbers?: string[];
    [k: string]: unknown;
  }

  export interface Shipment {
    id: ID;
    no?: string;
    tarih?: TimestampLike;
    sourceDepotId?: ID;
    targetHospitalId?: ID;
    items?: ShipmentItem[];
    durum?: "hazir" | "yolda" | "teslim" | string;
    orderId?: string;
    depotId?: string;
    depotName?: string;
    recipientHospital?: string;
    userId?: string;
    userName?: string;
    timestamp?: TimestampLike;
    [k: string]: unknown;
  }

  export interface OrderItem {
    id: ID;
    productCodeId?: ID;
    miktar?: number;
    birim?: string;
    stokKodu: string;
    stokAdi: string;
    adet: number;
    [k: string]: unknown;
  }

  export interface Order {
    id: ID;
    hospitalId?: ID;
    tarih?: TimestampLike;
    items?: OrderItem[];
    durum?: "taslak" | "onayli" | "gonderildi" | "kapatildi" | "pending" | "toplaniyor" | "completed" | string;
    kurumAdi?: string;
    depotId?: string;
    labId?: string;
    createdAt?: TimestampLike;
    status?: "pending" | "completed" | "toplaniyor";
    createdBy?: string;
    transferredAt?: TimestampLike;
    depotName?: string;
    createdById?: string;
    transferredById?: string;
    transferredBy?: string;
    [k: string]: unknown;
  }

  export interface PickingListItem {
    id: ID;
    shipmentId?: ID;
    productCodeId?: ID;
    lot?: string;
    seriNo?: string;
    miktar?: number;
    orderId?: string;
    stokKodu?: string;
    stokAdi?: string;
    lotNumarasi?: string;
    miad?: string;
    rafAdresiOnerilen?: string;
    adetIstenen?: number;
    toplananSeriNumaralari?: string[];
    [k: string]: unknown;
  }

  // ---------- Consumption / Usage ----------
  export interface ParsedBarcode {
    type?: "product" | "lot" | "serial" | string;
    productCodeId?: ID;
    lot?: string;
    serials?: string[];
    quantity?: number;
    error?: string | null;
    [k: string]: unknown;
  }

  export interface ConsumptionRecord {
    id: ID;
    productCodeId?: ID;
    hospitalId?: ID;
    deviceId?: ID;
    miktar?: number;
    birim?: string;
    lot?: string;
    seriNo?: string;
    seriNumarasi: string;
    stokKodu: string;
    stokAdi: string;
    lotNumarasi: string;
    miad: string;
    tarih?: TimestampLike;
    consumptionTimestamp: TimestampLike;
    createdBy?: ID;
    laboratoryId: string;
    laboratoryName: string;
    userName: string;
    userId: string;
    consumptionType: 'normal_kullanim' | 'sayimdan_dusum' | 'imha_dogrulama_sonrasi_dusum' | string;
    rafAdresi?: string;
    irsaliyeNumarasi?: string;
    urunGrubu?: 'kit' | 'sarf';
    ambalajDegeri?: number;
    isImhaDogrulandi?: boolean;
    subPointId?: string;
    subPointName?: string;
    [k: string]: unknown;
  }
  
  export interface VerificationItemGroup {
    stokKodu: string;
    stokAdi: string;
    lotNumarasi: string;
    miad: string;
    tuketilenAdet: number;
    dogrulananAdet: number;
    originalRecordIds: string[];
  }

  export interface VerificationReportItem {
    id?: ID;
    productCodeId?: ID;
    lot?: string;
    seriNo?: string;
    status?: "ok" | "mismatch" | "missing" | string;
    note?: string;
    [k: string]: unknown;
  }

  export interface ScannedItem {
    id: ID;
    barkod?: string;
    parsed?: ParsedBarcode;
    at?: TimestampLike;
    stokKodu?: string;
    stokAdi?: string;
    lotNumarasi?: string;
    miad?: string;
    seriNumarasi?: string;
    rafAdresi?: string;
    irsaliyeNumarasi?: string;
    isSelected?: boolean;
    timestamp?: TimestampLike;
    isProcessed?: boolean;
    [k: string]: unknown;
  }

  // ---------- Devices ----------
  export interface Device {
    id: ID;
    ad?: string;
    name?: string;
    brand?: string;
    model?: string;
    imageUrl?: string;
    cihazAdi?: string;
    seriNumarasi?: string;
    kod?: string;
    hospitalId?: ID;
    aktif?: boolean;
    arizaDurumu?: 'yok' | 'teknik_servis' | 'aplikasyon';
    sonArizaTarihi?: any;
    arizaAciklamasi?: string;
    [k: string]: unknown;
  }
  
  export interface DeviceFaultReportPayload {
    reportId: string;
    [key: string]: any;
  }

  export interface AssignedDevice {
    id: ID;
    hastaneId?: string;
    cihazId?: string;
    assignedAt?: TimestampLike;
    deviceId?: string;
    name?: string;
    arizaDurumu?: string;
    serial?: string;
    subPointId?: string | null;
    subPointName?: string | null;
    arizaTip?: 'teknik_servis' | 'aplikasyon';
    arizaTarihi?: TimestampLike;
    [k: string]: unknown;
  }
  export type LabDeviceAssignment = AssignedDevice;

  export interface DeviceGroupSlot {
    deviceId: string | null;
    name: string;
  }

  export interface DeviceGroup {
    id: string;
    name: string;
    order: number;
    subPointId?: string | null;
    subPointName?: string | null;
    deviceIds?: string[];
    slots?: DeviceGroupSlot[];
    imageUrl?: string;
  }

  export interface DeviceFaultReport {
    id: string;
    labId: string;
    labName: string;
    groupId: string;
    groupName: string;
    deviceId: string;
    model: string;
    serial: string;
    orderInGroup: number;
    description: string;
    status: 'open' | 'closed';
    faultType: 'teknik_servis' | 'aplikasyon';
    openedAt: Date | null;
    openedBy: string;
    openedByName: string;
    closedAt: Date | null;
    closedBy?: string;
    closedByName?: string;
    source: string;
    isEjectedKitFault?: boolean;
    productStokKodu?: string;
    productStokAdi?: string;
    productCihazGrubu?: string;
    kitResolution?: 'imha' | 'tekrar_kullanim' | null;
    ejectedKitRecordId?: string;
    testCount?: number;
    title?: string;
    closeDescription?: string;
  }

  export interface CihazUstuStokInput {
    deviceId?: ID;
    productCodeId?: ID;
    miktar?: number;
    [k: string]: unknown;
  }

  // ---------- Analytics / Efficiency ----------
  export interface EfficiencyData {
    id?: ID;
    hospitalId?: ID;
    deviceId?: ID;
    tarih?: TimestampLike;
    calismaSuresiDakika?: number;
    testSayisi?: number;
    hospitalName?: string;
    month?: number;
    year?: number;
    cihazUstuDevir?: Record<string, number>;
    sistemTuketimleriDateRange?: { from?: Date; to?: Date };
    hesaplananTestBazliTuketim?: Record<string, number>;
    cihazUstuAySonu?: Record<string, number>;
    kumulatifVeriler?: Record<string, KumulatifDataInput>;
    verimlilikSonuclari?: Record<string, VerimlilikAnalizi>;
    consumptionInputMethod?: 'system' | 'manual';
    lastUpdated?: TimestampLike;
    [k: string]: unknown;
  }

  export interface VerimlilikAnalizi {
    id?: ID;
    hospitalId?: ID;
    ay?: number;
    yil?: number;
    skor?: number;
    stokKodu?: string;
    stokAdi?: string;
    anaTuketimTestAdeti?: number;
    kumulatifTotalTest?: number;
    bilinenFire?: number;
    bilinmeyenFire?: number;
    toplamFire?: number;
    rutinHastaSayisi?: number;
    [k: string]: unknown;
  }

  export interface KumulatifDataInput {
    hospitalId?: ID;
    deviceId?: ID;
    from?: TimestampLike;
    to?: TimestampLike;
    stokKodu?: string;
    kumulatifTotal?: number;
    rutin?: number;
    kontrol?: number;
    kalibrasyon?: number;
    tekrar?: number;
    [k: string]: unknown;
  }

  // ---------- Min/Max & Settings ----------
  export interface MinMaxRule {
    id: ID;
    hospitalId?: ID;
    productCodeId?: ID;
    min: number;
    max: number;
    stokKodu: string;
    aylikTuketimLimiti?: number;
    [k: string]: unknown;
  }

  export interface UploadedReport {
    id?: ID;
    name?: string;
    url?: string;
    uploadedAt?: TimestampLike;
    uploaderId?: string;
    uploaderName?: string;
    path?: string;
    type?: string;
    [k: string]: unknown;
  }

  // ---------- Ledger (ProductLedger) ----------
  export type LedgerOpType = "IN" | "OUT" | "TRANSFER" | string;

  export interface LedgerItemRow {
    id?: ID;
    date?: TimestampLike;
    type: LedgerOpType;
    source?: string;
    target?: string;
    details?: string;
    [k: string]: unknown;
  }

  export interface GroupedLedgerRow {
    date?: TimestampLike;
    stokKodu?: string;
    stokAdi?: string;
    lot?: string;
    type: LedgerOpType;
    seriNolar?: string[];
    source?: string;
    target?: string;
    [k: string]: unknown;
  }

  export interface LedgerHeaderStockInfo {
    depoAdi: string;
    adet: number;
    birim: string;
  }

  export interface LedgerHeader {
    sorgu: string;
    stokKodu?: string;
    stokAdi?: string;
    stokBilgisi?: LedgerHeaderStockInfo[];
  }

  export interface LedgerData {
    header: LedgerHeader;
    items: Array<LedgerItemRow | GroupedLedgerRow>;
    rows?: Array<LedgerItemRow | GroupedLedgerRow>;
    product?: ProductCode;
  }
  
  export type Currency = 'EUR' | 'USD' | 'TRY';
  export type TrackingType = 'serial' | 'lot_barcode' | 'lot_manual' | 'quantity_only';
  
  export interface SummaryRow {
    test: string;
    routine: number;
    rerun: number;
    calib: number;
    control: number;
    total: number;
  };
  export type CihazYonetimiSubView = 'ana' | 'ayarlar' | 'cihazListesi' | 'teknikServis';

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
      regex?: string;
      fields?: { reference?: number; lot?: number; expiry?: number };
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
    mainLabId?: string;
  }

  export interface EventRow {
    id: string;
    stokKodu: string;
    stokAdi: string;
    lotNumarasi?: string;
    miad: string;
    islemTipi: 'Mal Kabul' | 'Karşılanan Sipariş' | 'Direkt Transfer' | 'Kullanım';
    actor?: string;
    tarih: Date;
    adet: number;
    seriNolar: string[];
    konum: string;
  }

  // ManualProductOption
  export type ManualProductOption = {
    code: string;
    name: string;
    tracking: 'serial' | 'lot_barcode' | 'lot_manual' | 'qty_barcode' | 'qty_manual';
  };

  // GridDefinition
  export interface CellDef {
    row: number;
    col: number;
    merged?: boolean;
    stokKodu?: string;
    products?: string[];
  }

  export interface GridDefinition {
    rows: number;
    cols: number;
    cells: CellDef[];
  }

  // DailyConsumptionStats
  export interface DailyConsumptionStats {
    id: string;
    date: string;
    totalCount: number;
    byLab: Record<string, number>;
    createdAt?: TimestampLike;
    updatedAt?: TimestampLike;
  }

  // EfficiencyPool
  export interface EfficiencyPool {
    id: string;
    name: string;
    memberIds: string[];
    centerLabId?: string;
    active: boolean;
    createdAt: any;
    createdByUid: string;
    createdByName: string;
  }

  // EjectedKitRecord
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
    testCount: number;
    aciklama: string;
    createdAt: TimestampLike;
    createdByUid: string;
    createdByName: string;
    faultReportId: string;
  }

  // DestroyedKitRecord
  export interface DestroyedKitRecord {
    id: string;
    ejectedKitRecordId: string | null;
    faultReportId: string | null;
    laboratoryId: string | null;
    laboratoryName: string;
    depotId?: string | null;
    depotName?: string;
    deviceId: string | null;
    deviceModel: string;
    stokKodu: string;
    stokAdi: string;
    lotNumarasi?: string;
    miad?: string;
    seriNumarasi?: string;
    testCount: number;
    remainingTests?: number;
    aciklama: string;
    resolvedAt: TimestampLike;
    resolvedByUid: string;
    resolvedByName: string;
    sourceType?: 'barcode' | 'excel' | 'fault';
  }

  // TrashBinRecord
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
    sourceType: 'manual';
  }

  // Rack
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

  // ---------- Spare Parts / Yedek Parça ----------
  export type PersonalStockStatus = 'in_stock' | 'used' | 'pending_return';
  export type PersonalStockSource = 'depot' | 'device';

  export interface PersonalStockItem {
    id: string;
    ownerUid: string;
    ownerName: string;
    productCodeId: string;
    stokKodu: string;
    stokAdi: string;
    serialNumber?: string;
    source: PersonalStockSource;
    sourceDeviceId?: string;
    sourceDeviceName?: string;
    status: PersonalStockStatus;
    createdAt: Date;
    transferredByUid?: string;
    transferredByName?: string;
    usedAt?: Date;
    usedOnDeviceId?: string;
    usedOnDeviceName?: string;
    usedOnFormId?: string;
    usedOnFormType?: string;
    replacedPartId?: string;
    imageUrl?: string;
  }

  export type SparePartTransferAction =
    | 'transfer_to_personnel'
    | 'use_on_device'
    | 'return_to_depot'
    | 'submit_to_depot'
    | 'return_confirmed'
    | 'submit_confirmed';

  export interface SparePartTransferLog {
    id: string;
    action: SparePartTransferAction;
    personalStockId?: string;
    productCodeId?: string;
    stokKodu?: string;
    stokAdi?: string;
    serialNumber?: string;
    fromUid?: string;
    fromName?: string;
    toUid?: string;
    toName?: string;
    deviceId?: string;
    formId?: string;
    formType?: string;
    quantity?: number;
    createdAt: Date;
    createdByUid: string;
    createdByName: string;
    notes?: string;
  }

  export interface PendingReturn {
    id: string;
    personalStockId: string;
    ownerUid: string;
    ownerName: string;
    productCodeId: string;
    stokKodu: string;
    stokAdi: string;
    serialNumber?: string;
    source?: PersonalStockSource;
    sourceDeviceId?: string;
    returnType: 'return_to_depot' | 'submit_to_depot';
    status: 'pending' | 'confirmed';
    requestedAt: Date;
    confirmedAt?: Date;
    confirmedByUid?: string;
    confirmedByName?: string;
    imageUrl?: string;
  }

  export interface SparePartTransferRow {
    id: string;
    productCodeId: string;
    stokKodu: string;
    stokAdi: string;
    serialNumber: string;
    quantity: number;
    cihazGrubu?: string;
    targetUid: string;
    targetName: string;
  }

  export interface YedekParcaDepoStokItem {
    id: string;
    productCodeId: string;
    stokKodu: string;
    stokAdi: string;
    serialNumber?: string;
    quantity: number;
    cihazGrubu?: string;
    createdAt: Date;
    createdByUid: string;
    createdByName: string;
  }

  export type YedekParcaLogAction =
    | 'stok_giris'
    | 'stok_giris_excel'
    | 'transfer_cikis'
    | 'iade_giris'
    | 'stok_duzeltme';

  export interface YedekParcaDepoLog {
    id: string;
    action: YedekParcaLogAction;
    productCodeId: string;
    stokKodu: string;
    stokAdi: string;
    cihazGrubu?: string;
    serialNumber?: string;
    quantity: number;
    relatedTransferId?: string;
    relatedPersonnelUid?: string;
    relatedPersonnelName?: string;
    notes?: string;
    createdAt: Date;
    createdByUid: string;
    createdByName: string;
  }

  // ---------- Nöbet Vardiyası Sistemi ----------
  // Nöbet personel tipi
  export type ShiftPersonnelType = 'teknik_servis' | 'aplikasyon';

  // Nöbet tarih aralığı
  export interface ShiftDateRange {
    startDate: string;    // ISO date string (YYYY-MM-DD)
    endDate: string;      // ISO date string (YYYY-MM-DD)
  }

  // Nöbet kaydı
  export interface ShiftSchedule {
    id: string;
    personnelUid: string;
    personnelName: string;
    personnelType: ShiftPersonnelType;
    laboratoryIds: string[];
    laboratoryNames: string[];
    dateRanges: ShiftDateRange[];
    createdAt: TimestampLike;
    createdByUid: string;
    createdByName: string;
    updatedAt?: TimestampLike;
    updatedByUid?: string;
    updatedByName?: string;
    isActive: boolean;
  }

  // Nöbet oluşturma satırı (UI için)
  export interface ShiftScheduleRow {
    id: string;
    personnelUid: string;
    personnelName: string;
    laboratoryIds: string[];
    laboratoryNames: string[];
    dateRanges: ShiftDateRange[];
  }
}
