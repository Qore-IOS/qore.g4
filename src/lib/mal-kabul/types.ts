/**
 * @fileoverview Mal Kabul Panel Type Definitions
 * @description Enterprise-grade type definitions for the Goods Receiving (Mal Kabul) panel.
 * These types ensure type safety across all mal-kabul operations.
 * @module lib/mal-kabul/types
 * @version 1.0.0
 */

import { Timestamp } from '../data/client';
import type { ProductCode, DepoStokItem, Depot, AddressDefinition, BarcodeFormat } from '@/lib/types';
import type { TrackingMode } from '@/lib/tracking';

// =============================================================================
// CORE TYPES
// =============================================================================

/**
 * Status of a scan operation
 */
export type ScanStatus = 'idle' | 'success' | 'error' | 'processing';

/**
 * Source of a scan input
 */
export type ScanSource = 'barcode' | 'camera' | 'manual' | 'ocr' | 'qr_transfer';

/**
 * Verification mode for goods receipt
 */
export type VerificationMode = 'verified' | 'unverified';

/**
 * Tab type for manual product entry
 */
export type ManualEntryTab = 'manual' | 'barcode';

/**
 * OCR source tab type
 */
export type OcrSourceTab = 'camera' | 'pdf';

// =============================================================================
// SCANNED ITEM TYPES
// =============================================================================

/**
 * Base scanned item interface
 * Represents a single item that has been scanned or manually entered
 */
export interface BaseScannedItem {
  /** Unique identifier for this scanned item */
  readonly id: string;
  /** Raw barcode data */
  barkod: string;
  /** Product stock code */
  stokKodu: string;
  /** Product name */
  stokAdi: string;
  /** Lot number */
  lotNumarasi: string;
  /** Expiry date in normalized format (YYYY-MM-DD) */
  miad: string;
  /** Serial number (for serial-tracked products) */
  seriNumarasi: string;
  /** Warehouse rack/shelf address */
  rafAdresi: string;
  /** Invoice/waybill number */
  irsaliyeNumarasi: string;
  /** Whether this item is selected for batch operations */
  isSelected: boolean;
  /** Timestamp when the item was scanned */
  timestamp: Date;
  /** Whether this item has been processed (added to stock) */
  isProcessed: boolean;
}

/**
 * Extended scan row with grouping support
 * Used for displaying grouped items in the UI
 */
export interface ScanRow extends BaseScannedItem {
  /** Quantity of items (for grouped/lot items) */
  adet?: number;
  /** Whether this row represents a grouped item */
  isGroup?: boolean;
  /** Expected quantity (for verification) */
  expectedAdet?: number;
  /** List of scanned serial numbers in this group */
  scannedSerials?: string[];
  /** Unique key for grouping (stokKodu-lot-miad) */
  key?: string;
  /** Child items for grouped rows */
  items?: BaseScannedItem[];
}

/**
 * Type guard to check if a ScanRow is a group
 */
export function isScanRowGroup(row: ScanRow): row is ScanRow & { isGroup: true } {
  return row.isGroup === true;
}

// =============================================================================
// TRANSACTION TYPES
// =============================================================================

/**
 * Mal Kabul transaction line item
 * Stored in Firestore as subcollection documents
 */
export interface MalKabulLine {
  /** Product stock code */
  stokKodu: string;
  /** Product name */
  stokAdi: string;
  /** Lot number */
  lotNumarasi: string;
  /** Expiry date */
  miad: string;
  /** Total quantity */
  adet: number;
  /** List of serial numbers (for serial-tracked products) */
  serials: string[];
}

/**
 * Mal Kabul transaction header
 * Main document stored in malKabulTransactions collection
 */
export interface MalKabulHeader {
  /** Unique transaction ID (format: MK-XXXXXXXX) */
  transactionId: string;
  /** Depot ID where goods were received */
  depotId: string;
  /** Depot name for display purposes */
  depotName: string;
  /** User ID who performed the transaction */
  userId: string;
  /** User name for display purposes */
  userName: string;
  /** Timestamp of the transaction */
  timestamp: Timestamp;
  /** Total item count */
  itemCount: number;
  /** List of brands involved in this transaction */
  brands: string[];
  /** Verification mode used */
  mode: VerificationMode;
}

/**
 * Complete transaction with header and lines
 */
export interface MalKabulTransaction extends MalKabulHeader {
  /** Document ID from Firestore */
  id: string;
  /** Transaction lines (loaded separately) */
  lines?: MalKabulLine[];
}

// =============================================================================
// QR TRANSFER TYPES
// =============================================================================

/**
 * Item in a QR transfer payload
 */
export interface QrTransferItem {
  /** Product stock code */
  k: string;
  /** Product name */
  a: string;
  /** Lot number (optional) */
  l?: string;
  /** Expiry date (optional) */
  m?: string;
  /** Serial number (optional) */
  s?: string;
  /** Quantity */
  q: number;
}

/**
 * QR transfer payload structure
 * Used for mobile-to-desktop transfer scanning
 */
export interface QrTransferPayload {
  /** Type identifier */
  t: 'transfer';
  /** Version number */
  v: number;
  /** Transfer ID */
  id: string;
  /** Date */
  d: string;
  /** Source depot ID */
  src: string;
  /** Destination depot ID */
  dst: string;
  /** Company identifier */
  cmp: string;
  /** Items to transfer */
  items: QrTransferItem[];
}

// =============================================================================
// PRE-CHECK WARNING TYPES
// =============================================================================

/**
 * Max overload warning item
 */
export interface MaxOverloadWarning {
  /** Product name */
  name: string;
  /** Current stock quantity */
  current: number;
  /** Maximum allowed quantity */
  max: number;
  /** Incoming quantity */
  incoming: number;
}

/**
 * Usage risk item with consumption data
 */
export interface UsageRiskItem extends ScanRow {
  /** Monthly consumption rate */
  monthlyUsage: number;
  /** Months of stock remaining */
  monthsLeft: number;
}

/**
 * Pre-check warnings before goods receipt
 */
export interface PreCheckWarnings {
  /** Items with short shelf life */
  shortShelfLife: BaseScannedItem[];
  /** Products exceeding max stock level */
  maxOverload: MaxOverloadWarning[];
  /** Products with consumption risk */
  usageRisk: UsageRiskItem[];
}

// =============================================================================
// OCR/IRSALIYE TYPES
// =============================================================================

/**
 * Result from irsaliye (waybill) OCR parsing
 */
export interface IrsaliyeParseResult {
  /** Product stock code */
  stokKodu: string;
  /** Lot number (optional) */
  lot?: string;
  /** Expiry date (optional) */
  miad?: string;
  /** Quantity */
  quantity: number;
}

/**
 * Processed OCR item with additional metadata
 */
export interface ProcessedOcrItem extends IrsaliyeParseResult {
  /** Product name */
  productName: string;
  /** Note about unit conversion */
  note: string;
  /** Unit (e.g., "Kutu", "Adet") */
  unit: string;
  /** Raw line from OCR */
  rawLine?: string;
}

// =============================================================================
// BATCH PROCESSING TYPES
// =============================================================================

/**
 * Progress information for batch operations
 */
export interface BatchProgress {
  /** Number of completed commits */
  commits: number;
  /** Number of pending operations */
  pending: number;
  /** Total operations to process */
  total?: number;
  /** Current operation index */
  current?: number;
}

/**
 * Batch queue configuration
 */
export interface BatchQueueConfig {
  /** Maximum operations per batch (default: 450 for Firestore limit of 500) */
  chunkSize?: number;
  /** Progress callback */
  onProgress?: (info: BatchProgress) => void;
}

// =============================================================================
// SESSION TYPES
// =============================================================================

/**
 * Depot stock counting session
 */
export interface DepotStockCountSession {
  /** Session ID */
  id: string;
  /** Depot ID */
  depotId: string;
  /** Depot name */
  depotName: string;
  /** Session status */
  status: 'active' | 'completed' | 'cancelled';
  /** Session start timestamp */
  startedAt: Timestamp;
  /** User who started the session */
  startedByUid: string;
  /** User name who started the session */
  startedByName: string;
  /** List of participant user IDs */
  participants: string[];
  /** Session end timestamp (if completed) */
  completedAt?: Timestamp;
}

// =============================================================================
// COMPONENT PROP TYPES
// =============================================================================

/**
 * Props for the main AnaPanel component
 */
export interface AnaPanelProps {
  /** Initial depot ID to select (optional) */
  initialDepotId?: string;
  /** Callback when goods receipt is completed */
  onGoodsReceiptComplete?: (transactionId: string) => void;
}

/**
 * Props for ManualInlineAdder component
 */
export interface ManualInlineAdderProps {
  /** Whether the adder is visible */
  visible: boolean;
  /** Products available for manual tracking */
  manualProducts: ManualProductOption[];
  /** Products available for barcode-free entry */
  barcodeProducts: ManualProductOption[];
  /** Callback when a lot-tracked product is added */
  onAddLot: (payload: LotAddPayload) => void;
  /** Callback when a quantity-tracked product is added */
  onAddQty: (payload: QtyAddPayload) => void;
  /** Callback to close the adder */
  onClose?: () => void;
  /** Callback when add operation is complete */
  onDone?: () => void;
}

/**
 * Manual product option for selection
 */
export interface ManualProductOption {
  /** Product stock code */
  code: string;
  /** Product name */
  name: string;
  /** Tracking mode */
  tracking: TrackingMode;
}

/**
 * Payload for adding lot-tracked product
 */
export interface LotAddPayload {
  /** Product stock code */
  code: string;
  /** Product name */
  name: string;
  /** Lot number */
  lot: string;
  /** Expiry date */
  miad: string;
  /** Quantity */
  qty: number;
}

/**
 * Payload for adding quantity-tracked product
 */
export interface QtyAddPayload {
  /** Product stock code */
  code: string;
  /** Product name */
  name: string;
  /** Quantity */
  qty: number;
}

/**
 * Props for IrsaliyeOcrModal component
 */
export interface IrsaliyeOcrModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Available product codes for matching */
  productCodes: ProductCode[];
  /** Callback when OCR results are confirmed */
  onResults: (results: IrsaliyeParseResult[]) => void;
}

// =============================================================================
// VALIDATION TYPES
// =============================================================================

/**
 * Validation result for a field
 */
export interface FieldValidationResult {
  /** Whether the field is valid */
  isValid: boolean;
  /** Error message if invalid */
  error?: string;
}

/**
 * Validation result for a complete form
 */
export interface FormValidationResult {
  /** Whether the entire form is valid */
  isValid: boolean;
  /** Map of field names to their validation results */
  fields: Record<string, FieldValidationResult>;
  /** Summary of all errors */
  errors: string[];
}

// =============================================================================
// STOCK OPERATION TYPES
// =============================================================================

/**
 * Data for creating a stock document
 */
export interface StockDocumentData {
  /** Depot ID */
  depotId: string;
  /** Depot name */
  depotName: string;
  /** Product stock code */
  stokKodu: string;
  /** Product name */
  stokAdi: string;
  /** Lot number */
  lotNumarasi: string;
  /** Expiry date */
  miad: string;
  /** Serial number (for serial-tracked items) */
  seriNumarasi: string;
  /** Rack address */
  rafAdresi: string;
  /** Invoice number */
  irsaliyeNumarasi: string;
  /** Timestamp when added */
  eklenmeTarihi: Timestamp;
  /** Whether item is shipped */
  isShipped: boolean;
  /** User name who created the record */
  createdByName: string;
  /** User UID who created the record */
  createdByUid: string | null;
}

/**
 * Serial history event data
 */
export interface SerialHistoryEvent {
  /** Event type */
  type: 'intake' | 'shipment' | 'consumption' | 'disposal' | 'transfer';
  /** Event details */
  details: SerialHistoryEventDetails;
  /** Event timestamp */
  timestamp: Timestamp;
}

/**
 * Details for serial history events
 */
export interface SerialHistoryEventDetails {
  /** Product stock code */
  stokKodu: string;
  /** Product name */
  stokAdi: string;
  /** Depot ID (for intake/shipment) */
  depotId?: string;
  /** Depot name */
  depotName?: string;
  /** Rack address */
  rafAdresi?: string;
  /** Invoice number */
  irsaliyeNumarasi?: string;
  /** Target institution (for shipment) */
  hedefKurum?: string;
  /** User name who performed the action */
  userName?: string;
  /** Additional notes */
  note?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default batch chunk size (Firestore allows max 500, we use 450 for safety)
 */
export const DEFAULT_BATCH_CHUNK_SIZE = 450;

/**
 * Maximum items allowed in a single Firestore 'in' query
 */
export const FIRESTORE_IN_QUERY_LIMIT = 30;

/**
 * Transaction ID prefix
 */
export const TRANSACTION_ID_PREFIX = 'MK-';

/**
 * Collection names used by mal-kabul
 */
export const COLLECTIONS = {
  MAL_KABUL_TRANSACTIONS: 'malKabulTransactions',
  DEPO_STOK: 'depoStok',
  SERIAL_HISTORY: 'serialHistory',
  DEPOT_COUNT_SESSIONS: 'depotCountSessions',
  VERIFICATION_REPORTS: 'verificationReports',
} as const;

// =============================================================================
// TYPE UTILITIES
// =============================================================================

/**
 * Extract keys from an object type
 */
export type Keys<T> = keyof T;

/**
 * Make specific properties optional
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Make specific properties required
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

/**
 * Non-nullable version of a type
 */
export type NonNullableFields<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};
