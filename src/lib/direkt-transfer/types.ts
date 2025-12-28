/**
 * @fileoverview TypeScript type definitions for Direct Transfer (Direkt Transfer) module
 * @description Comprehensive type system for direct inventory transfers between depots and laboratories
 * @module lib/direkt-transfer/types
 * @version 1.0.0
 */

import type { DepoStokItem, Hospital, Depot, ProductCode, TimestampLike, TrackingMode } from '@/lib/types';

// ============================================================================
// CORE TRANSFER TYPES
// ============================================================================

/**
 * Extended transfer row with additional metadata for transfer operations
 * Extends DepoStokItem with transfer-specific properties
 */
export interface TransferRow extends DepoStokItem {
  /** Unique key for the row (composite of stokKodu and lotNumarasi for groups) */
  key: string;
  /** Quantity to transfer */
  adet: number;
  /** Whether this row represents a grouped batch (lot-based) or individual item */
  isGroup?: boolean;
}

/**
 * FEFO (First Expired First Out) violation record
 * Used when a scanned item has older alternatives in stock
 */
export interface FefoViolation {
  /** The item that was scanned/selected for transfer */
  scannedItem: DepoStokItem;
  /** The recommended item with earlier expiry date */
  recommendedItem: DepoStokItem;
}

/**
 * Transfer document root stored in Firestore
 */
export interface TransferDocument {
  /** Firestore document ID */
  id: string;
  /** Server-generated timestamp */
  timestamp: TimestampLike;
  /** Source depot ID */
  sourceDepotId: string;
  /** Source depot display name */
  sourceDepotName: string;
  /** Target institution display name */
  targetName: string;
  /** Target hospital/laboratory ID (null for borç mode) */
  targetHospitalId: string | null;
  /** Transfer mode: 'borc' for inter-company, 'lab' for laboratory */
  mode: TransferMode;
  /** Company name for borç transfers */
  company: string | null;
  /** Total number of items in transfer */
  itemCount: number;
  /** UID of user who created the transfer */
  createdByUid: string;
  /** Display name of user who created the transfer */
  createdByName: string;
}

/**
 * Individual transfer item stored in subcollection
 */
export interface TransferItem {
  /** Product stock code */
  stokKodu: string;
  /** Product display name */
  stokAdi: string;
  /** Lot/batch number */
  lotNumarasi: string;
  /** Expiry date in DD.MM.YYYY format */
  miad: string;
  /** Serial number (empty string if lot-tracked) */
  seriNumarasi: string;
}

/**
 * Transfer mode enumeration
 */
export type TransferMode = 'borc' | 'lab';

// ============================================================================
// FORM STATE TYPES
// ============================================================================

/**
 * Complete transfer form state
 */
export interface TransferFormState {
  /** Selected source depot ID */
  selectedDepotId: string;
  /** Selected target laboratory ID */
  selectedLabId: string;
  /** Whether borç (inter-company debt) mode is active */
  isBorcMode: boolean;
  /** Selected borç depot ID */
  selectedBorcDepotId: string;
  /** Selected company for borç transfer */
  selectedCompany: string;
  /** Items queued for transfer */
  directTransferItems: TransferRow[];
  /** Currently selected barcode format ID */
  selectedFormatId: string;
}

/**
 * Transfer prerequisites loaded from Firestore
 */
export interface TransferPrerequisites {
  /** Available source depots */
  depots: Depot[];
  /** Available products */
  products: ProductCode[];
  /** Available target hospitals/laboratories */
  hospitals: Hospital[];
  /** Available borç depots */
  borcDepots: Depot[];
  /** Loading state */
  isLoading: boolean;
}

// ============================================================================
// BARCODE SCANNING TYPES
// ============================================================================

/**
 * Barcode scan source identifier
 */
export type ScanSource = 'hid' | 'camera' | 'manual';

/**
 * Result of barcode parsing and product resolution
 */
export interface ScanResult {
  /** Whether the scan was successful */
  success: boolean;
  /** Error message if scan failed */
  error?: ScanError;
  /** Resolved product information */
  product?: ProductCode;
  /** Extracted stock code */
  stokKodu?: string;
  /** Extracted stock name */
  stokAdi?: string;
  /** Extracted lot number */
  lotNumarasi?: string;
  /** Formatted expiry date */
  miadFormatted?: string;
  /** Extracted serial number */
  seriNumarasi?: string;
  /** Resolved tracking mode */
  trackingMode?: TrackingMode;
}

/**
 * Scan error types for user feedback
 */
export type ScanError =
  | 'PARSE_ERROR'
  | 'PRODUCT_NOT_FOUND'
  | 'SERIAL_MISSING'
  | 'LOT_MISSING'
  | 'NOT_IN_DEPOT'
  | 'INSUFFICIENT_STOCK'
  | 'ALREADY_SCANNED';

/**
 * Scan error messages mapping
 */
export const SCAN_ERROR_MESSAGES: Record<ScanError, { title: string; description: string }> = {
  PARSE_ERROR: {
    title: 'Ayrıştırma Hatası',
    description: 'Barkod tanımlı formatlarla eşleşmiyor.'
  },
  PRODUCT_NOT_FOUND: {
    title: 'Ürün Bulunamadı',
    description: 'Barkoddan bir ürün çözümlenemedi.'
  },
  SERIAL_MISSING: {
    title: 'Seri Eksik',
    description: 'Seri no takipli üründe barkod seri içermiyor.'
  },
  LOT_MISSING: {
    title: 'Lot Eksik',
    description: 'Lot barkodu gerekli fakat bulunamadı.'
  },
  NOT_IN_DEPOT: {
    title: 'Depoda Bulunamadı',
    description: 'Ürün bu depoda mevcut değil.'
  },
  INSUFFICIENT_STOCK: {
    title: 'Yetersiz Stok',
    description: 'Bu ürün için yeterli stok bulunmuyor.'
  },
  ALREADY_SCANNED: {
    title: 'Uyarı',
    description: 'Bu ürün zaten listeye eklendi.'
  }
} as const;

// ============================================================================
// MANUAL ENTRY TYPES
// ============================================================================

/**
 * Manual inline adder tab type
 */
export type ManualAdderTab = 'from_stock' | 'manual';

/**
 * Payload for adding lot-based items manually
 */
export interface ManualLotPayload {
  /** Product stock code */
  code: string;
  /** Product display name */
  name: string;
  /** Lot number */
  lot: string;
  /** Expiry date in normalized format */
  miad: string;
  /** Quantity to add */
  qty: number;
}

/**
 * Payload for adding quantity-based items manually
 */
export interface ManualQtyPayload {
  /** Product stock code */
  code: string;
  /** Product display name */
  name: string;
  /** Quantity to add */
  qty: number;
}

/**
 * Manual product option for selection
 */
export interface ManualProductOption {
  /** Product stock code */
  code: string;
  /** Product display name */
  name: string;
  /** Tracking mode */
  tracking: TrackingMode;
}

/**
 * Available lot for a product in the current depot
 */
export interface AvailableLot {
  /** Composite key: lotNumarasi|miad */
  key: string;
  /** Display label for selection */
  label: string;
  /** Remaining quantity available */
  remaining: number;
}

// ============================================================================
// TRANSFER HISTORY TYPES
// ============================================================================

/**
 * Transfer history filter options
 */
export interface TransferHistoryFilters {
  /** Selected depot ID */
  depotId: string;
  /** Date range start */
  dateFrom?: Date;
  /** Date range end */
  dateTo?: Date;
  /** Target name filter */
  targetName?: string;
}

/**
 * Paginated transfer list state
 */
export interface TransferPaginationState {
  /** Current page number (1-indexed) */
  page: number;
  /** Rows per page */
  rowsPerPage: number;
  /** Total number of pages */
  totalPages: number;
}

/**
 * Transfer summary row for grouped display
 */
export interface TransferSummaryRow {
  /** Product stock code */
  stokKodu: string;
  /** Product display name */
  stokAdi: string;
  /** Lot number */
  lotNumarasi: string;
  /** Expiry date */
  miad: string;
  /** Aggregated quantity */
  adet: number;
}

// ============================================================================
// GROUPED DISPLAY TYPES
// ============================================================================

/**
 * Grouped transfer item for accordion display
 */
export interface GroupedTransferItem {
  /** Unique group key */
  key: string;
  /** Product stock code */
  stokKodu: string;
  /** Product display name */
  stokAdi: string;
  /** Lot number (empty string if not applicable) */
  lotNumarasi: string;
  /** Expiry date (empty string if not applicable) */
  miad: string;
  /** Total quantity in group */
  adet: number;
  /** Whether this is a grouped row */
  isGroup: boolean;
  /** Serial numbers within the group */
  serials: GroupedSerial[];
}

/**
 * Serial number entry within a group
 */
export interface GroupedSerial {
  /** Firestore document ID */
  id: string;
  /** Serial number value */
  seriNumarasi: string;
}

// ============================================================================
// BORÇ (DEBT) TRANSFER TYPES
// ============================================================================

/**
 * Borç transfer record stored in Firestore
 */
export interface BorcTransferRecord {
  /** Source depot ID */
  fromDepotId: string;
  /** Target borç depot ID */
  toBorcDepotId: string;
  /** Company receiving the goods */
  company: string;
  /** Product stock code */
  stokKodu: string;
  /** Product display name */
  stokAdi: string;
  /** Lot number */
  lot: string;
  /** Expiry date */
  miad: string;
  /** Serial number */
  seriNumarasi: string;
  /** Whether the goods have been returned */
  isReturned: boolean;
  /** Timestamp of transfer */
  timestamp: TimestampLike;
}

// ============================================================================
// SERIAL HISTORY TYPES
// ============================================================================

/**
 * Serial history event for transfer tracking
 */
export interface SerialHistoryEvent {
  /** Event type */
  type: 'transfer';
  /** Associated transfer ID */
  transferId: string;
  /** Event details */
  details: SerialHistoryDetails;
  /** Event timestamp */
  timestamp: TimestampLike;
}

/**
 * Details included in serial history event
 */
export interface SerialHistoryDetails {
  /** Source depot ID */
  sourceDepotId: string;
  /** Source depot name */
  sourceDepotName: string;
  /** Target institution name */
  targetName: string;
  /** Target hospital ID (null if borç) */
  targetHospitalId: string | null;
  /** Product stock code */
  stokKodu: string;
  /** Product display name */
  stokAdi: string;
  /** Lot number */
  lotNumarasi: string;
  /** Expiry date */
  miad: string;
}

// ============================================================================
// LAB TRANSFER DATES TYPES
// ============================================================================

/**
 * Lab transfer date update payload
 */
export interface LabTransferDateUpdate {
  /** Transfer timestamp */
  lastTransferDate: TimestampLike;
  /** Name of user who performed transfer */
  lastTransferBy: string;
}

// ============================================================================
// ALLOCATION TYPES
// ============================================================================

/**
 * Allocation result for grouped items
 */
export interface AllocationResult {
  /** Whether allocation was successful */
  success: boolean;
  /** Allocated items (null if failed) */
  items: DepoStokItem[] | null;
  /** Error message if allocation failed */
  error?: string;
}

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
  action: 'direct_transfer';
  /** Product details */
  product: {
    stokKodu: string;
    stokAdi: string;
    lot: string | undefined;
    miad: string;
  };
  /** Associated shipment/transfer ID */
  shipmentId: string;
  /** Source depot ID */
  depotId: string;
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
  /** Whether batch scanning mode is active */
  isBatchScanning: boolean;
}

/**
 * Transfer panel loading states
 */
export interface TransferLoadingState {
  /** Prerequisites are loading */
  prerequisites: boolean;
  /** Shipment is processing */
  shipment: boolean;
  /** FEFO check is running */
  fefoCheck: boolean;
}

/**
 * Toast notification type for transfer operations
 */
export type TransferToastType = 'success' | 'error' | 'warning' | 'info';

/**
 * Transfer operation result
 */
export interface TransferOperationResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Transfer document ID (if successful) */
  transferId?: string;
  /** Number of items transferred */
  itemCount?: number;
  /** Error message (if failed) */
  error?: string;
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Transfer validation result
 */
export interface TransferValidationResult {
  /** Whether validation passed */
  isValid: boolean;
  /** Validation errors */
  errors: TransferValidationError[];
}

/**
 * Transfer validation error
 */
export interface TransferValidationError {
  /** Error field */
  field: string;
  /** Error message */
  message: string;
  /** Error code for programmatic handling */
  code: TransferValidationErrorCode;
}

/**
 * Transfer validation error codes
 */
export type TransferValidationErrorCode =
  | 'DEPOT_NOT_SELECTED'
  | 'TARGET_NOT_SELECTED'
  | 'NO_ITEMS'
  | 'INSUFFICIENT_STOCK'
  | 'INVALID_QUANTITY'
  | 'EXPIRED_ITEM'
  | 'COMPANY_NOT_SELECTED';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Maximum items that can be transferred in a single operation
 */
export const MAX_TRANSFER_ITEMS = 1000;

/**
 * Default rows per page for transfer history
 */
export const DEFAULT_ROWS_PER_PAGE = 20;

/**
 * Available rows per page options
 */
export const ROWS_PER_PAGE_OPTIONS = [20, 50, 100] as const;

/**
 * Barcode format auto-detect value
 */
export const AUTO_DETECT_FORMAT = '__auto__' as const;
