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

  // Note: Most core interfaces like User, ProductCode, etc. are now in "@/lib/types".
  // Only add here if they are missing in the build but used in components.

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

  export interface RouteRequest {
    id: string;
    type: 'add' | 'reorder';
    labId: string;
    labName: string;
    labLat?: number;
    labLng?: number;
    routeId: string;
    routeDate: string;
    routeDriverName: string;
    insertAfterStopId?: string | null;
    insertAfterStopName?: string | null;
    currentOrder?: number;
    requestedOrder?: number;
    requestedAfterStopId?: string | null;
    requestedAfterStopName?: string | null;
    requestedBy: string;
    requestedByName: string;
    requestedAt: TimestampLike;
    note?: string;
    status: 'pending' | 'approved' | 'rejected';
    reviewedBy?: string;
    reviewedByName?: string;
    reviewedAt?: TimestampLike;
    rejectionReason?: string;
  }

  // ---------- Nöbet Vardiyası Sistemi ----------
  export type ShiftPersonnelType = 'teknik_servis' | 'aplikasyon';
  export interface ShiftDateRange {
    startDate: string;
    endDate: string;
  }
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
  export interface ShiftScheduleRow {
    id: string;
    personnelUid: string;
    personnelName: string;
    laboratoryIds: string[];
    laboratoryNames: string[];
    dateRanges: ShiftDateRange[];
  }
}
