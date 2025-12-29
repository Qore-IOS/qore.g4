/**
 * @fileoverview Type definitions for the Orders (Siparisler) module
 * @description Comprehensive TypeScript types for order management, order picking,
 * shipment tracking, and bulk order operations
 * @module lib/siparisler/types
 * @version 1.0.0
 */

import type {
  Order,
  OrderItem,
  Shipment,
  ShipmentItem,
  PickingListItem,
  Depot,
  Hospital,
  ProductCode,
  DepoStokItem,
  MinMaxRule,
  DeviceGroup,
  TimestampLike,
} from '@/lib/types';

// =============================================================================
// RE-EXPORTS
// =============================================================================

export type {
  Order,
  OrderItem,
  Shipment,
  ShipmentItem,
  PickingListItem,
  Depot,
  Hospital,
  ProductCode,
  DepoStokItem,
  MinMaxRule,
  DeviceGroup,
};

// =============================================================================
// ORDER STATUS TYPES
// =============================================================================

/**
 * Valid order status values
 */
export type OrderStatus = 'pending' | 'toplaniyor' | 'completed';

/**
 * Order status display information
 */
export interface OrderStatusInfo {
  /** Machine-readable status key */
  status: OrderStatus;
  /** Human-readable label in Turkish */
  label: string;
  /** Badge/chip color variant */
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  /** Associated icon name */
  icon?: string;
}

/**
 * Order status map for UI display
 */
export const ORDER_STATUS_MAP: Record<OrderStatus, OrderStatusInfo> = {
  pending: {
    status: 'pending',
    label: 'Bekliyor',
    variant: 'secondary',
    icon: 'Clock',
  },
  toplaniyor: {
    status: 'toplaniyor',
    label: 'Toplanıyor',
    variant: 'default',
    icon: 'Package',
  },
  completed: {
    status: 'completed',
    label: 'Tamamlandı',
    variant: 'outline',
    icon: 'CheckCircle',
  },
};

// =============================================================================
// ORDER CREATION TYPES
// =============================================================================

/**
 * Payload for creating a new order
 */
export interface CreateOrderPayload {
  /** Target depot ID */
  depotId: string;
  /** Target laboratory/hospital ID */
  labId: string;
  /** Hospital/institution name */
  kurumAdi: string;
  /** Order items to include */
  items: OrderItem[];
  /** User ID who created the order */
  createdById: string;
  /** User name who created the order */
  createdBy: string;
}

/**
 * Result of order creation
 */
export interface CreateOrderResult {
  /** Whether creation was successful */
  success: boolean;
  /** Created order ID */
  orderId?: string;
  /** Error message if failed */
  error?: string;
  /** Validation errors if any */
  validationErrors?: OrderValidationError[];
}

/**
 * Order validation error
 */
export interface OrderValidationError {
  /** Field that has the error */
  field: string;
  /** Error message */
  message: string;
  /** Error code for programmatic handling */
  code: OrderValidationErrorCode;
}

/**
 * Order validation error codes
 */
export type OrderValidationErrorCode =
  | 'DEPOT_REQUIRED'
  | 'LAB_REQUIRED'
  | 'ITEMS_REQUIRED'
  | 'INVALID_QUANTITY'
  | 'INVALID_STOCK_CODE'
  | 'DUPLICATE_ITEM'
  | 'SECURITY_VIOLATION'
  | 'VALIDATION_FAILED';

// =============================================================================
// BULK ORDER TYPES
// =============================================================================

/**
 * Bulk order row for Excel export
 */
export interface BulkOrderRow {
  /** Stock code */
  'Stok Kodu': string;
  /** Stock name */
  'Stok Adı': string;
  /** Current stock count */
  'Mevcut Stok': number;
  /** Maximum allowed quantity */
  'Max Adedi': number;
  /** Quantity to order */
  'Sipariş Adeti': number;
}

/**
 * Bulk order generation result
 */
export interface BulkOrderResult {
  /** Whether generation was successful */
  success: boolean;
  /** Generated sheets keyed by entity name */
  sheets?: Record<string, BulkOrderRow[]>;
  /** Error message if failed */
  error?: string;
}

/**
 * Bulk order selection state
 */
export interface BulkOrderSelection {
  /** Selected depot IDs */
  depotIds: string[];
  /** Selected laboratory IDs */
  labIds: string[];
}

// =============================================================================
// MIN/MAX ORDER TYPES
// =============================================================================

/**
 * Min/Max calculation result for a single product
 */
export interface MinMaxCalculationItem {
  /** Stock code */
  stokKodu: string;
  /** Stock name */
  stokAdi: string;
  /** Current stock count at lab */
  currentStock: number;
  /** Maximum allowed quantity */
  maxQuantity: number;
  /** Needed quantity (max - current) */
  neededQuantity: number;
  /** Available quantity in depot */
  depotStock: number;
}

/**
 * Min/Max order calculation result
 */
export interface MinMaxOrderResult {
  /** Whether calculation was successful */
  success: boolean;
  /** Items that need to be ordered */
  items: MinMaxCalculationItem[];
  /** Total items needing orders */
  totalItems: number;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// ORDER PICKING TYPES
// =============================================================================

/**
 * Extended picking list item with additional display info
 */
export interface ExtendedPickingListItem extends PickingListItem {
  /** Device group name */
  cihazGrubu?: string;
  /** Device group image URL */
  cihazGrubuImageUrl?: string;
  /** Whether this item is out of stock */
  isOutOfStock?: boolean;
  /** Available quantity in the suggested lot */
  availableInLot?: number;
  /** Total available in depot for this product */
  totalInDepot?: number;
}

/**
 * Scanned serial numbers map
 * Key: stokKodu, Value: array of scanned serial numbers or lot identifiers
 */
export type ScannedSerialsMap = Record<string, string[]>;

/**
 * FEFO (First Expired First Out) warning state
 */
export interface FefoWarningState {
  /** The scanned stock item */
  scannedItem: DepoStokItem;
  /** The suggested lot number (earlier expiry) */
  suggestedLot: string;
  /** Callback to confirm override */
  onConfirm: () => void;
}

/**
 * Picking session state
 */
export interface PickingSessionState {
  /** Current order being picked */
  order: Order | null;
  /** Generated picking list */
  pickingList: ExtendedPickingListItem[];
  /** Scanned serials map */
  scannedSerials: ScannedSerialsMap;
  /** FEFO warning if active */
  fefoWarning: FefoWarningState | null;
  /** Whether picking is in progress */
  isProcessing: boolean;
}

/**
 * Picking progress for a single product
 */
export interface PickingProgress {
  /** Stock code */
  stokKodu: string;
  /** Requested quantity */
  requested: number;
  /** Scanned quantity */
  scanned: number;
  /** Whether picking is complete for this item */
  isComplete: boolean;
  /** Percentage complete */
  percentage: number;
}

/**
 * Overall picking session progress
 */
export interface OverallPickingProgress {
  /** Total items to pick */
  totalItems: number;
  /** Items fully picked */
  completedItems: number;
  /** Total quantity requested */
  totalQuantity: number;
  /** Total quantity scanned */
  scannedQuantity: number;
  /** Overall percentage */
  percentage: number;
  /** Individual item progress */
  itemProgress: PickingProgress[];
}

// =============================================================================
// SHIPMENT TYPES
// =============================================================================

/**
 * Payload for creating a shipment
 */
export interface CreateShipmentPayload {
  /** Original order ID */
  orderId: string;
  /** Source depot ID */
  depotId: string;
  /** Source depot name */
  depotName: string;
  /** Recipient hospital/institution name */
  recipientHospital: string;
  /** User ID performing the shipment */
  userId: string;
  /** User name performing the shipment */
  userName: string;
  /** Items being shipped */
  items: ShipmentItem[];
}

/**
 * Shipment creation result
 */
export interface CreateShipmentResult {
  /** Whether creation was successful */
  success: boolean;
  /** Created shipment ID */
  shipmentId?: string;
  /** Number of items shipped */
  itemCount?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Lab transfer date tracking
 */
export interface LabTransferDate {
  /** Last transfer date */
  lastTransferDate: TimestampLike;
  /** User who performed the transfer */
  lastTransferBy: string;
}

/**
 * Lab transfer dates document
 */
export interface LabTransferDatesDocument {
  /** Lab ID */
  labId: string;
  /** Depot ID */
  depotId: string;
  /** Lab name */
  labName: string;
  /** Depot name */
  depotName: string;
  /** Transfers map keyed by stock code */
  transfers: Record<string, LabTransferDate>;
  /** Last update timestamp */
  updatedAt: TimestampLike;
}

// =============================================================================
// ORDER HISTORY TYPES
// =============================================================================

/**
 * Order history filter options
 */
export interface OrderHistoryFilter {
  /** Filter by depot ID */
  depotId?: string;
  /** Filter by date range start */
  startDate?: Date;
  /** Filter by date range end */
  endDate?: Date;
  /** Filter by recipient hospital */
  recipientHospital?: string;
  /** Filter by order status */
  status?: OrderStatus;
}

/**
 * Pagination state for order history
 */
export interface OrderHistoryPagination {
  /** Current page (1-indexed) */
  page: number;
  /** Rows per page */
  rowsPerPage: number;
  /** Total items */
  totalItems: number;
  /** Total pages */
  totalPages: number;
}

/**
 * Order history entry with enriched data
 */
export interface OrderHistoryEntry {
  /** Shipment data */
  shipment: Shipment;
  /** Associated order data (if available) */
  order?: Order;
  /** Whether this was a direct transfer (no order) */
  isDirectTransfer: boolean;
}

// =============================================================================
// VALIDATION TYPES
// =============================================================================

/**
 * Order item validation result
 */
export interface OrderItemValidationResult {
  /** Whether the item is valid */
  isValid: boolean;
  /** Validation errors */
  errors: OrderValidationError[];
  /** Sanitized item (if valid) */
  sanitizedItem?: OrderItem;
}

/**
 * Order validation result
 */
export interface OrderValidationResult {
  /** Whether the order is valid */
  isValid: boolean;
  /** Validation errors */
  errors: OrderValidationError[];
  /** Sanitized order data (if valid) */
  sanitizedData?: CreateOrderPayload;
}

// =============================================================================
// UI STATE TYPES
// =============================================================================

/**
 * Orders panel state
 */
export interface OrdersPanelState {
  /** Selected depot ID */
  selectedDepotId: string;
  /** Selected lab ID for new order */
  selectedLabId: string;
  /** Current order items being added */
  orderItems: OrderItem[];
  /** Whether bulk order mode is active */
  showBulk: boolean;
  /** Bulk order depot selection */
  selectedBulkDepots: string[];
  /** Bulk order lab selection */
  selectedBulkLabs: string[];
  /** Loading state */
  isLoading: boolean;
  /** Processing state (creating/deleting order) */
  isProcessing: boolean;
  /** Lab popover open state */
  isLabPopoverOpen: boolean;
}

/**
 * Manual item add state
 */
export interface ManualItemAddState {
  /** Selected stock code */
  stockCode: string;
  /** Quantity to add */
  quantity: number;
}

// =============================================================================
// NOTIFICATION TYPES
// =============================================================================

/**
 * Order notification payload
 */
export interface OrderNotificationPayload {
  /** Actor who triggered the notification */
  actor: {
    uid: string;
    name: string;
  };
  /** Order ID */
  orderId: string;
  /** Lab ID */
  labId: string;
  /** Depot ID */
  depotId: string;
  /** Audience hint for notification targeting */
  audienceHint: {
    userId?: string;
    role?: string;
    views?: string[];
    labIds?: string[];
    depotIds?: string[];
  };
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Stock availability check result
 */
export interface StockAvailabilityResult {
  /** Stock code */
  stokKodu: string;
  /** Product name */
  stokAdi: string;
  /** Available quantity */
  available: number;
  /** Requested quantity */
  requested: number;
  /** Whether enough stock is available */
  isSufficient: boolean;
  /** Shortage amount (if any) */
  shortage: number;
}

/**
 * Lot group for picking organization
 */
export interface LotGroup {
  /** Lot number */
  lotNumarasi: string;
  /** Expiry date */
  miad: string;
  /** Items in this lot */
  items: DepoStokItem[];
  /** Quantity in lot */
  quantity: number;
}

/**
 * Product grouping by lot for FEFO sorting
 */
export interface ProductLotGroups {
  /** Stock code */
  stokKodu: string;
  /** Stock name */
  stokAdi: string;
  /** Lot groups sorted by expiry (FEFO) */
  lotGroups: LotGroup[];
  /** Total available quantity */
  totalAvailable: number;
}
