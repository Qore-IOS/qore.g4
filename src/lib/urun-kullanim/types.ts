/**
 * @fileoverview TypeScript type definitions for Product Usage (Urun Kullanim) module
 * @description Comprehensive type system for product consumption tracking, barcode scanning,
 * verification, and trash bin operations in laboratory environments.
 * @module lib/urun-kullanim/types
 * @version 1.0.0
 */

import type {
  DepoStokItem,
  ConsumptionRecord,
  Laboratory,
  ProductCode,
  Device,
  DeviceGroup,
  TimestampLike,
} from '@/lib/types';
import type { TrackingMode } from '@/lib/tracking';

// ============================================================================
// CORE CONSUMPTION TYPES
// ============================================================================

/**
 * Scan status for visual feedback
 */
export type ScanStatus = 'idle' | 'success' | 'error';

/**
 * Consumption type classification
 */
export type ConsumptionType = 'normal_kullanim' | 'sayimdan_dusum' | 'manuel_dusum';

/**
 * Extended consumption record with additional metadata for usage tracking
 */
export interface ExtendedConsumptionRecord extends ConsumptionRecord {
  /** Laboratory ID where usage occurred */
  usageLabId: string;
  /** Laboratory name where usage occurred */
  usageLabName: string;
  /** Laboratory ID from which stock was deducted */
  deductedFromLabId: string;
  /** Laboratory name from which stock was deducted */
  deductedFromLabName: string;
  /** Sub-point ID (if applicable) */
  subPointId?: string;
  /** Sub-point name (if applicable) */
  subPointName?: string;
}

/**
 * FEFO (First Expired First Out) lot replacement target
 * Used when a scanned item has older alternatives in stock
 */
export interface LotReplaceTarget {
  /** The item that was originally scanned */
  scanned: DepoStokItem;
  /** The recommended item with earlier expiry date */
  recommended: DepoStokItem;
}

// ============================================================================
// BARCODE SCANNING TYPES
// ============================================================================

/**
 * Barcode scan source identifier
 */
export type ScanSource = 'hid' | 'camera' | 'manual';

/**
 * Barcode scan result
 */
export interface BarcodeScanResult {
  /** Whether the scan was successful */
  success: boolean;
  /** Error type if scan failed */
  errorType?: ScanErrorType;
  /** Error message for display */
  errorMessage?: string;
  /** Resolved product (if successful) */
  product?: ProductCode;
  /** Resolved stock item (if found in depot) */
  stockItem?: DepoStokItem;
  /** Extracted data from barcode */
  extractedData?: {
    stokKodu?: string;
    lotNumarasi?: string;
    seriNumarasi?: string;
    miad?: string;
  };
}

/**
 * Scan error types for categorization
 */
export type ScanErrorType =
  | 'PARSE_ERROR'
  | 'PRODUCT_NOT_FOUND'
  | 'SERIAL_MISSING'
  | 'LOT_MISSING'
  | 'NOT_IN_DEPOT'
  | 'ALREADY_CONSUMED'
  | 'INSUFFICIENT_STOCK';

/**
 * Scan error messages mapping (Turkish)
 */
export const SCAN_ERROR_MESSAGES: Record<ScanErrorType, { title: string; description: string }> = {
  PARSE_ERROR: {
    title: 'Barkod Ayrıştırma Hatası',
    description: 'Barkod tanımlı formatlarla eşleşmiyor.',
  },
  PRODUCT_NOT_FOUND: {
    title: 'Ürün Bulunamadı',
    description: 'Barkoddan bir ürün çözümlenemedi.',
  },
  SERIAL_MISSING: {
    title: 'Seri Eksik',
    description: 'Seri no takipli üründe barkod seri içermiyor.',
  },
  LOT_MISSING: {
    title: 'Lot Eksik',
    description: 'Lot barkodu gerekli fakat bulunamadı.',
  },
  NOT_IN_DEPOT: {
    title: 'Depoda Bulunamadı',
    description: 'Ürün bu laboratuvar stoğunda mevcut değil.',
  },
  ALREADY_CONSUMED: {
    title: 'Zaten Tüketilmiş',
    description: 'Bu ürün daha önce stoktan düşülmüş.',
  },
  INSUFFICIENT_STOCK: {
    title: 'Yetersiz Stok',
    description: 'Bu ürün için yeterli stok bulunmuyor.',
  },
} as const;

// ============================================================================
// MANUAL DEDUCTION TYPES
// ============================================================================

/**
 * Manual deduction form state
 */
export interface ManualDeductionState {
  /** Selected product code */
  productCode: string;
  /** Selected lot key (format: "lotNumarasi|miad") */
  lotKey: string;
  /** Quantity to deduct */
  quantity: number;
  /** Whether the deduction is in progress */
  isProcessing: boolean;
}

/**
 * Available lot option for manual deduction
 */
export interface AvailableLotOption {
  /** Composite key: lotNumarasi|miad */
  key: string;
  /** Display label for selection */
  label: string;
  /** Available count for this lot */
  count: number;
  /** Expiry date */
  miad: string;
}

/**
 * Manual deduction payload
 */
export interface ManualDeductionPayload {
  /** Product code */
  productCode: string;
  /** Lot number */
  lotNumarasi: string;
  /** Expiry date */
  miad: string;
  /** Quantity to deduct */
  quantity: number;
  /** Laboratory ID */
  laboratoryId: string;
}

// ============================================================================
// TRASH BIN TYPES
// ============================================================================

/**
 * Trash bin item to be added
 */
export interface TrashBinItem {
  /** Unique ID for the item */
  id: string;
  /** Product code */
  productCode: string;
  /** Product name */
  productName: string;
  /** Remaining tests in the kit */
  remainingTests: number;
}

/**
 * Trash bin submission payload
 */
export interface TrashBinSubmitPayload {
  /** Target laboratory */
  laboratory: Laboratory;
  /** Selected device */
  device: Device;
  /** Items to add to trash */
  items: TrashBinItem[];
  /** User who submitted */
  submittedBy: {
    uid: string;
    name: string;
  };
}

/**
 * Trash bin modal state
 */
export interface TrashBinModalState {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Selected device */
  selectedDevice: Device | null;
  /** Items queued for trash */
  items: TrashBinItem[];
  /** Selected product for adding */
  selectedProduct: string;
  /** Remaining tests input */
  remainingTests: number;
  /** Product search term */
  productSearch: string;
  /** Whether product popover is open */
  isProductPopoverOpen: boolean;
}

// ============================================================================
// VERIFICATION TYPES
// ============================================================================

/**
 * Verification item group for disposal confirmation
 */
export interface VerificationItemGroup {
  /** Stock code */
  stokKodu: string;
  /** Stock name */
  stokAdi: string;
  /** Lot number */
  lotNumarasi: string;
  /** Expiry date */
  miad: string;
  /** Total consumed quantity */
  tuketilenAdet: number;
  /** Verified/confirmed quantity */
  dogrulananAdet: number;
  /** Original consumption record IDs */
  originalRecordIds: string[];
}

/**
 * Verification scan result
 */
export interface VerificationScanResult {
  /** Whether verification was successful */
  success: boolean;
  /** Updated item if successful */
  updatedItem?: VerificationItemGroup;
  /** Error message if failed */
  errorMessage?: string;
  /** Whether item was already fully verified */
  alreadyFullyVerified?: boolean;
}

// ============================================================================
// DEVICE FAULT TYPES
// ============================================================================

/**
 * Fault type classification
 */
export type FaultType = 'teknik_servis' | 'aplikasyon';

/**
 * Device fault report payload
 */
export interface FaultReportPayload {
  /** Hospital/laboratory ID */
  hospitalId: string;
  /** Laboratory name */
  labName: string;
  /** Device ID */
  deviceId: string;
  /** Device model */
  model: string;
  /** Device serial number */
  serial: string;
  /** Type of fault */
  faultType: FaultType;
  /** UID of user who opened the fault */
  openedByUid: string;
  /** Name of user who opened the fault */
  openedByName: string;
  /** Fault description */
  openDescription: string;
}

/**
 * Device fault modal state
 */
export interface FaultModalState {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Selected device */
  selectedDevice: Device | null;
  /** Fault description */
  description: string;
  /** Whether save is in progress */
  isSaving: boolean;
}

// ============================================================================
// STATISTICS TYPES
// ============================================================================

/**
 * Monthly average consumption data
 */
export interface MonthlyAverage {
  /** Stock code */
  stokKodu: string;
  /** Stock name */
  stokAdi: string;
  /** Average monthly consumption */
  ortalamaAylikTuketim: number;
  /** Total consumption in period */
  toplamTuketim: number;
  /** Number of months with consumption */
  aySayisi: number;
}

/**
 * Consumption statistics filter state
 */
export interface ConsumptionStatsFilter {
  /** Selected hospital/laboratory ID */
  hospitalId: string;
  /** Stock code/name search term */
  searchTerm: string;
  /** Date range start */
  dateFrom?: Date;
  /** Date range end */
  dateTo?: Date;
}

/**
 * Sort key for consumption table
 */
export type ConsumptionSortKey =
  | 'consumptionTimestamp'
  | 'stokKodu'
  | 'stokAdi'
  | 'lotNumarasi'
  | 'seriNumarasi'
  | 'userName';

/**
 * Pagination state
 */
export interface PaginationState {
  /** Current page (1-indexed) */
  currentPage: number;
  /** Rows per page */
  rowsPerPage: number;
  /** Total pages */
  totalPages: number;
}

// ============================================================================
// UI STATE TYPES
// ============================================================================

/**
 * Camera scanner dialog state
 */
export interface CameraScannerState {
  /** Whether the camera dialog is open */
  isOpen: boolean;
}

/**
 * Session history item
 */
export interface SessionHistoryItem extends ConsumptionRecord {
  /** Device group image URL (if available) */
  deviceGroupImageUrl?: string | null;
}

/**
 * Panel loading states
 */
export interface UsagePanelLoadingState {
  /** Prerequisites are loading */
  prerequisites: boolean;
  /** Consumption is processing */
  consumption: boolean;
  /** Manual deduction is processing */
  manualDeduction: boolean;
  /** Fault report is saving */
  faultReport: boolean;
  /** Trash bin is submitting */
  trashBin: boolean;
}

// ============================================================================
// SERIAL HISTORY TYPES
// ============================================================================

/**
 * Serial history event for consumption tracking
 */
export interface SerialHistoryEvent {
  /** Event type */
  type: 'consumption' | 'transfer' | 'receiving';
  /** Event details */
  details: SerialHistoryDetails;
  /** Event timestamp */
  timestamp: TimestampLike;
}

/**
 * Details included in serial history event
 */
export interface SerialHistoryDetails {
  /** Product stock code */
  stokKodu: string;
  /** Usage laboratory ID */
  usageLabId?: string;
  /** Laboratory from which stock was deducted */
  deductedFromLabId?: string;
  /** Sub-point ID */
  subPointId?: string;
  /** Sub-point name */
  subPointName?: string;
}

// ============================================================================
// LAB POOL TYPES
// ============================================================================

/**
 * Lab pool configuration
 */
export interface LabPoolConfig {
  /** Pool ID */
  id: string;
  /** Pool name */
  name: string;
  /** Member laboratory IDs */
  memberIds: string[];
  /** Whether pool is active */
  isActive: boolean;
}

/**
 * Pool member info
 */
export interface PoolMemberInfo {
  /** Member laboratory IDs */
  poolMemberIds: string[];
  /** Member laboratory names */
  poolMemberNames: string[];
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Consumption validation result
 */
export interface ConsumptionValidationResult {
  /** Whether validation passed */
  isValid: boolean;
  /** Validation errors */
  errors: ConsumptionValidationError[];
}

/**
 * Consumption validation error
 */
export interface ConsumptionValidationError {
  /** Error field */
  field: string;
  /** Error message */
  message: string;
  /** Error code */
  code: ConsumptionValidationErrorCode;
}

/**
 * Consumption validation error codes
 */
export type ConsumptionValidationErrorCode =
  | 'LABORATORY_NOT_SELECTED'
  | 'PRODUCT_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'ALREADY_CONSUMED'
  | 'INVALID_BARCODE'
  | 'TRACKING_MODE_MISMATCH';

// ============================================================================
// NOTIFICATION TYPES
// ============================================================================

/**
 * FEFO override notification payload
 */
export interface FefoOverrideNotification {
  /** Actor who performed the override */
  actor: {
    uid: string;
    name: string;
  };
  /** Action type */
  action: 'consumption';
  /** Product details */
  product: {
    stokKodu: string;
    stokAdi: string;
    lot: string | undefined;
    miad: string;
  };
  /** Laboratory ID */
  laboratoryId: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Maximum session history items to display
 */
export const MAX_SESSION_HISTORY_ITEMS = 10;

/**
 * Default rows per page for statistics
 */
export const DEFAULT_STATS_ROWS_PER_PAGE = 50;

/**
 * Available rows per page options for statistics
 */
export const STATS_ROWS_PER_PAGE_OPTIONS = [50, 100, 200] as const;

/**
 * Disposal barcode expected length
 */
export const DISPOSAL_BARCODE_LENGTH = 16;

/**
 * Disposal lot number length within barcode
 */
export const DISPOSAL_LOT_LENGTH = 8;
