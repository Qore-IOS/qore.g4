/**
 * @fileoverview Validation schemas and utilities for Orders (Siparisler) module
 * @description Zod-based validation with security measures, input sanitization,
 * and comprehensive validation rules for order operations
 * @module lib/siparisler/validation
 * @version 1.0.0
 */

import { z } from 'zod';
import type {
  CreateOrderPayload,
  OrderValidationError,
  OrderValidationErrorCode,
  OrderValidationResult,
  OrderItemValidationResult,
  PickingProgress,
  OverallPickingProgress,
  StockAvailabilityResult,
  MinMaxCalculationItem,
  BulkOrderRow,
} from './types';
import type { OrderItem, DepoStokItem, MinMaxRule, ProductCode } from '@/lib/types';

// ============================================================================
// SECURITY PATTERNS
// ============================================================================

/**
 * XSS attack pattern detection
 */
const XSS_PATTERN = /<script[\s\S]*?>[\s\S]*?<\/script>|javascript:|on\w+\s*=|<iframe|<object|<embed|<link|<meta|<style[\s\S]*?>[\s\S]*?<\/style>|eval\s*\(|expression\s*\(/gi;

/**
 * SQL injection pattern detection
 */
const SQL_INJECTION_PATTERN = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE)\b[\s\S]*?(FROM|INTO|TABLE|DATABASE|SET|WHERE|VALUES))|(-{2})|(\b(OR|AND)\b\s+\d+\s*=\s*\d+)|(';\s*(DROP|DELETE|UPDATE|INSERT))/gi;

/**
 * Path traversal attack pattern
 */
const PATH_TRAVERSAL_PATTERN = /\.{2}[\/\\]|[\/\\]\.{2}|%2e%2e|%252e%252e/gi;

/**
 * Null byte injection pattern
 */
const NULL_BYTE_PATTERN = /\x00|%00|\\0/g;

// ============================================================================
// BASE VALIDATION PATTERNS
// ============================================================================

/**
 * Stock code validation pattern
 */
export const STOCK_CODE_PATTERN = /^[A-Za-z0-9\-_.]+$/;

/**
 * Firestore document ID pattern
 */
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Institution/hospital name pattern (allows Turkish characters)
 */
export const INSTITUTION_NAME_PATTERN = /^[A-Za-zğüşıöçĞÜŞİÖÇ0-9\s\-_.,'()]+$/;

/**
 * User name pattern (allows Turkish characters)
 */
export const USER_NAME_PATTERN = /^[A-Za-zğüşıöçĞÜŞİÖÇ\s\-_.@]+$/;

// ============================================================================
// SECURITY CHECK FUNCTIONS
// ============================================================================

/**
 * Security threat types
 */
export type SecurityThreat =
  | 'XSS'
  | 'SQL_INJECTION'
  | 'PATH_TRAVERSAL'
  | 'NULL_BYTE'
  | 'EXCESSIVE_LENGTH';

/**
 * Security check result
 */
export interface SecurityCheckResult {
  /** Whether the input is safe */
  isSafe: boolean;
  /** Detected threats */
  threats: SecurityThreat[];
  /** Sanitized value */
  sanitizedValue?: string;
}

/**
 * Performs comprehensive security check on input string
 * @param value - Input string to check
 * @param maxLength - Maximum allowed length (default: 500)
 * @returns Security check result
 */
export function securityCheck(value: string, maxLength = 500): SecurityCheckResult {
  const threats: SecurityThreat[] = [];

  if (!value || typeof value !== 'string') {
    return { isSafe: true, threats: [], sanitizedValue: '' };
  }

  if (value.length > maxLength) {
    threats.push('EXCESSIVE_LENGTH');
  }

  // Reset lastIndex for global regex patterns to ensure consistent results
  XSS_PATTERN.lastIndex = 0;
  SQL_INJECTION_PATTERN.lastIndex = 0;
  PATH_TRAVERSAL_PATTERN.lastIndex = 0;
  NULL_BYTE_PATTERN.lastIndex = 0;

  if (XSS_PATTERN.test(value)) {
    threats.push('XSS');
  }

  if (SQL_INJECTION_PATTERN.test(value)) {
    threats.push('SQL_INJECTION');
  }

  if (PATH_TRAVERSAL_PATTERN.test(value)) {
    threats.push('PATH_TRAVERSAL');
  }

  if (NULL_BYTE_PATTERN.test(value)) {
    threats.push('NULL_BYTE');
  }

  return {
    isSafe: threats.length === 0,
    threats,
    sanitizedValue: threats.length === 0 ? value : undefined,
  };
}

// ============================================================================
// SANITIZATION FUNCTIONS
// ============================================================================

/**
 * Sanitize a generic string input
 * @param value - Input string to sanitize
 * @returns Sanitized string
 */
export function sanitizeString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .trim()
    .replace(NULL_BYTE_PATTERN, '')
    .substring(0, 500);
}

/**
 * Sanitize a document ID
 * @param value - Input document ID to sanitize
 * @returns Sanitized document ID
 */
export function sanitizeDocumentId(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const sanitized = String(value)
    .trim()
    .replace(NULL_BYTE_PATTERN, '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .substring(0, 100);
  return sanitized;
}

/**
 * Sanitize a stock code
 * @param value - Input stock code to sanitize
 * @returns Sanitized stock code
 */
export function sanitizeStockCode(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const sanitized = String(value)
    .trim()
    .replace(NULL_BYTE_PATTERN, '')
    .replace(/[^A-Za-z0-9\-_.]/g, '')
    .substring(0, 50);
  return sanitized;
}

/**
 * Sanitize an institution/hospital name
 * @param value - Input name to sanitize
 * @returns Sanitized name
 */
export function sanitizeInstitutionName(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const sanitized = String(value)
    .trim()
    .replace(NULL_BYTE_PATTERN, '')
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .substring(0, 200);
  return sanitized;
}

/**
 * Sanitize a user name
 * @param value - Input name to sanitize
 * @returns Sanitized name
 */
export function sanitizeUserName(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const sanitized = String(value)
    .trim()
    .replace(NULL_BYTE_PATTERN, '')
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .substring(0, 100);
  return sanitized;
}

/**
 * Sanitize a quantity value
 * @param value - Input quantity to sanitize
 * @returns Sanitized quantity (non-negative integer)
 */
export function sanitizeQuantity(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const num = Number(value);
  if (isNaN(num) || num < 0) {
    return 0;
  }
  return Math.floor(num);
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Order item schema
 */
export const OrderItemSchema = z.object({
  id: z.string().min(1, 'ID gereklidir'),
  stokKodu: z.string()
    .min(1, 'Stok kodu gereklidir')
    .max(50, 'Stok kodu çok uzun')
    .regex(STOCK_CODE_PATTERN, 'Geçersiz stok kodu formatı'),
  stokAdi: z.string()
    .min(1, 'Stok adı gereklidir')
    .max(200, 'Stok adı çok uzun'),
  adet: z.number()
    .int('Adet tam sayı olmalıdır')
    .min(1, 'Adet en az 1 olmalıdır')
    .max(10000, 'Adet en fazla 10000 olabilir'),
});

/**
 * Create order payload schema
 */
export const CreateOrderPayloadSchema = z.object({
  depotId: z.string()
    .min(1, 'Depo seçimi gereklidir')
    .max(100, 'Geçersiz depo ID')
    .regex(DOCUMENT_ID_PATTERN, 'Geçersiz depo ID formatı'),
  labId: z.string()
    .min(1, 'Laboratuvar seçimi gereklidir')
    .max(100, 'Geçersiz laboratuvar ID')
    .regex(DOCUMENT_ID_PATTERN, 'Geçersiz laboratuvar ID formatı'),
  kurumAdi: z.string()
    .min(1, 'Kurum adı gereklidir')
    .max(200, 'Kurum adı çok uzun'),
  items: z.array(OrderItemSchema)
    .min(1, 'En az bir sipariş kalemi gereklidir')
    .max(100, 'En fazla 100 kalem eklenebilir'),
  createdById: z.string().min(1, 'Kullanıcı ID gereklidir'),
  createdBy: z.string().min(1, 'Kullanıcı adı gereklidir'),
});

/**
 * Bulk order selection schema
 */
export const BulkOrderSelectionSchema = z.object({
  depotIds: z.array(z.string().regex(DOCUMENT_ID_PATTERN)).max(50),
  labIds: z.array(z.string().regex(DOCUMENT_ID_PATTERN)).max(50),
}).refine(
  (data) => data.depotIds.length > 0 || data.labIds.length > 0,
  { message: 'En az bir depo veya laboratuvar seçilmelidir' }
);

/**
 * Manual item add schema
 */
export const ManualItemAddSchema = z.object({
  stockCode: z.string()
    .min(1, 'Stok kodu gereklidir')
    .max(50, 'Stok kodu çok uzun'),
  quantity: z.number()
    .int('Adet tam sayı olmalıdır')
    .min(1, 'Adet en az 1 olmalıdır')
    .max(10000, 'Adet en fazla 10000 olabilir'),
});

/**
 * Order history filter schema
 */
export const OrderHistoryFilterSchema = z.object({
  depotId: z.string().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  recipientHospital: z.string().max(200).optional(),
  status: z.enum(['pending', 'toplaniyor', 'completed']).optional(),
});

/**
 * Pagination schema
 */
export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  rowsPerPage: z.number().int().min(1).max(100).default(20),
});

/**
 * Shipment item schema
 */
export const ShipmentItemSchema = z.object({
  stokKodu: z.string().min(1).max(50),
  stokAdi: z.string().min(1).max(200),
  lotNumarasi: z.string().max(50),
  miad: z.string().max(20),
  quantity: z.number().int().min(1),
  serialNumbers: z.array(z.string().max(100)),
});

/**
 * Create shipment payload schema
 */
export const CreateShipmentPayloadSchema = z.object({
  orderId: z.string().min(1).max(100),
  depotId: z.string().min(1).max(100).regex(DOCUMENT_ID_PATTERN),
  depotName: z.string().min(1).max(200),
  recipientHospital: z.string().min(1).max(200),
  userId: z.string().min(1).max(100),
  userName: z.string().min(1).max(100),
  items: z.array(ShipmentItemSchema).min(1),
});

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Format Zod errors into a user-friendly message
 * @param error - Zod error object
 * @returns Formatted error message
 */
export function formatZodErrors(error: z.ZodError): string {
  return error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
}

/**
 * Validate an order item
 * @param item - Order item to validate
 * @returns Validation result
 */
export function validateOrderItem(item: unknown): OrderItemValidationResult {
  const errors: OrderValidationError[] = [];

  // Security check on string fields
  if (item && typeof item === 'object') {
    const itemObj = item as Record<string, unknown>;

    if (itemObj.stokKodu) {
      const secCheck = securityCheck(String(itemObj.stokKodu), 50);
      if (!secCheck.isSafe) {
        errors.push({
          field: 'stokKodu',
          message: 'Güvenlik ihlali tespit edildi',
          code: 'SECURITY_VIOLATION',
        });
      }
    }

    if (itemObj.stokAdi) {
      const secCheck = securityCheck(String(itemObj.stokAdi), 200);
      if (!secCheck.isSafe) {
        errors.push({
          field: 'stokAdi',
          message: 'Güvenlik ihlali tespit edildi',
          code: 'SECURITY_VIOLATION',
        });
      }
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  // Zod validation
  const result = OrderItemSchema.safeParse(item);
  if (!result.success) {
    result.error.errors.forEach(e => {
      errors.push({
        field: e.path.join('.'),
        message: e.message,
        code: 'VALIDATION_FAILED',
      });
    });
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: [],
    sanitizedItem: {
      id: result.data.id,
      stokKodu: sanitizeStockCode(result.data.stokKodu),
      stokAdi: sanitizeString(result.data.stokAdi),
      adet: result.data.adet,
    },
  };
}

/**
 * Validate a create order payload
 * @param payload - Order payload to validate
 * @returns Validation result
 */
export function validateCreateOrderPayload(payload: unknown): OrderValidationResult {
  const errors: OrderValidationError[] = [];

  // Security check on string fields
  if (payload && typeof payload === 'object') {
    const payloadObj = payload as Record<string, unknown>;

    const fieldsToCheck = ['kurumAdi', 'createdBy'];
    for (const field of fieldsToCheck) {
      if (payloadObj[field]) {
        const secCheck = securityCheck(String(payloadObj[field]), 200);
        if (!secCheck.isSafe) {
          errors.push({
            field,
            message: 'Güvenlik ihlali tespit edildi',
            code: 'SECURITY_VIOLATION',
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  // Zod validation
  const result = CreateOrderPayloadSchema.safeParse(payload);
  if (!result.success) {
    result.error.errors.forEach(e => {
      let code: OrderValidationErrorCode = 'VALIDATION_FAILED';
      if (e.path[0] === 'depotId') code = 'DEPOT_REQUIRED';
      else if (e.path[0] === 'labId') code = 'LAB_REQUIRED';
      else if (e.path[0] === 'items') code = 'ITEMS_REQUIRED';

      errors.push({
        field: e.path.join('.'),
        message: e.message,
        code,
      });
    });
    return { isValid: false, errors };
  }

  // Validate each item
  const sanitizedItems: OrderItem[] = [];
  for (let i = 0; i < result.data.items.length; i++) {
    const itemResult = validateOrderItem(result.data.items[i]);
    if (!itemResult.isValid) {
      errors.push(...itemResult.errors.map(e => ({
        ...e,
        field: `items[${i}].${e.field}`,
      })));
    } else if (itemResult.sanitizedItem) {
      sanitizedItems.push(itemResult.sanitizedItem);
    }
  }

  // Check for duplicate items
  const stockCodes = sanitizedItems.map(i => i.stokKodu);
  const duplicates = stockCodes.filter((code, index) => stockCodes.indexOf(code) !== index);
  if (duplicates.length > 0) {
    errors.push({
      field: 'items',
      message: `Aynı ürün birden fazla eklenmiş: ${[...new Set(duplicates)].join(', ')}`,
      code: 'DUPLICATE_ITEM',
    });
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: [],
    sanitizedData: {
      depotId: sanitizeDocumentId(result.data.depotId),
      labId: sanitizeDocumentId(result.data.labId),
      kurumAdi: sanitizeInstitutionName(result.data.kurumAdi),
      items: sanitizedItems,
      createdById: sanitizeDocumentId(result.data.createdById),
      createdBy: sanitizeUserName(result.data.createdBy),
    },
  };
}

/**
 * Validate bulk order selection
 * @param selection - Bulk order selection to validate
 * @returns Validation result with errors
 */
export function validateBulkOrderSelection(selection: unknown): {
  isValid: boolean;
  errors: string[];
  sanitized?: { depotIds: string[]; labIds: string[] };
} {
  const result = BulkOrderSelectionSchema.safeParse(selection);
  if (!result.success) {
    return {
      isValid: false,
      errors: result.error.errors.map(e => e.message),
    };
  }

  return {
    isValid: true,
    errors: [],
    sanitized: {
      depotIds: result.data.depotIds.map(id => sanitizeDocumentId(id)),
      labIds: result.data.labIds.map(id => sanitizeDocumentId(id)),
    },
  };
}

// ============================================================================
// BUSINESS LOGIC VALIDATION
// ============================================================================

/**
 * Check stock availability for order items
 * @param items - Order items to check
 * @param depoStok - Available depot stock
 * @param depotId - Depot to check stock in
 * @returns Array of availability results
 */
export function checkStockAvailability(
  items: OrderItem[],
  depoStok: DepoStokItem[],
  depotId: string
): StockAvailabilityResult[] {
  return items.map(item => {
    const available = depoStok.filter(
      s => s.depotId === depotId && !s.isShipped && s.stokKodu === item.stokKodu
    ).length;

    const shortage = Math.max(0, item.adet - available);

    return {
      stokKodu: item.stokKodu,
      stokAdi: item.stokAdi,
      available,
      requested: item.adet,
      isSufficient: available >= item.adet,
      shortage,
    };
  });
}

/**
 * Calculate Min/Max order items for a laboratory
 * @param rules - Min/Max rules for the laboratory
 * @param depoStok - Current depot stock
 * @param productCodes - Product code definitions
 * @param labName - Laboratory name to filter stock (fallback for legacy records)
 * @param depotId - Depot ID to check stock
 * @param labId - Laboratory ID to filter stock (preferred over labName)
 * @returns Calculation results
 */
export function calculateMinMaxOrder(
  rules: MinMaxRule[],
  depoStok: DepoStokItem[],
  productCodes: ProductCode[],
  labName: string,
  depotId: string,
  labId?: string
): MinMaxCalculationItem[] {
  const results: MinMaxCalculationItem[] = [];

  for (const rule of rules) {
    const stokKodu = rule.stokKodu;
    if (!stokKodu) continue;

    // Count current stock at lab (prefer ID match, fallback to name for legacy records)
    const labStockCount = depoStok.filter(
      st => st.isShipped && (labId ? (st.hedefKurumId === labId || (!st.hedefKurumId && st.hedefKurum === labName)) : st.hedefKurum === labName) && st.stokKodu === stokKodu
    ).length;

    // Get max value
    const maxValue = rule.max ?? 0;
    const need = maxValue - labStockCount;

    if (need > 0) {
      const product = productCodes.find(p => p.stokKodu === stokKodu);
      if (product) {
        // Count depot stock
        const depotStockCount = depoStok.filter(
          st => st.depotId === depotId && !st.isShipped && st.stokKodu === stokKodu
        ).length;

        results.push({
          stokKodu,
          stokAdi: product.stokAdi || stokKodu,
          currentStock: labStockCount,
          maxQuantity: maxValue,
          neededQuantity: need,
          depotStock: depotStockCount,
        });
      }
    }
  }

  return results;
}

/**
 * Generate bulk order rows for Excel export
 * @param rules - Min/Max rules
 * @param depoStok - Current depot stock
 * @param productCodes - Product code definitions
 * @param entityId - Depot or lab ID
 * @param entityName - Entity name (depot or lab name)
 * @param isLab - Whether this is for a lab (vs depot)
 * @returns Array of bulk order rows
 */
export function generateBulkOrderRows(
  rules: MinMaxRule[],
  depoStok: DepoStokItem[],
  productCodes: ProductCode[],
  entityId: string,
  entityName: string,
  isLab: boolean
): BulkOrderRow[] {
  return rules
    .map(rule => {
      const have = isLab
        ? depoStok.filter(
            st => st.isShipped && (st.hedefKurumId === entityId || (!st.hedefKurumId && st.hedefKurum === entityName)) && st.stokKodu === rule.stokKodu
          ).length
        : depoStok.filter(
            st => st.depotId === entityId && !st.isShipped && st.stokKodu === rule.stokKodu
          ).length;

      const maxValue = rule.max ?? 0;
      const need = maxValue - have;

      return {
        'Stok Kodu': rule.stokKodu || '',
        'Stok Adı': productCodes.find(p => p.stokKodu === rule.stokKodu)?.stokAdi || rule.stokKodu || '',
        'Mevcut Stok': have,
        'Max Adedi': maxValue,
        'Sipariş Adeti': need > 0 ? need : 0,
      };
    })
    .filter(r => r['Sipariş Adeti'] > 0);
}

// ============================================================================
// PICKING VALIDATION
// ============================================================================

/**
 * Calculate picking progress for a single product
 * @param stokKodu - Stock code
 * @param pickingList - Full picking list
 * @param scannedSerials - Map of scanned serials
 * @returns Picking progress for the product
 */
export function calculatePickingProgress(
  stokKodu: string,
  pickingList: Array<{ stokKodu: string; adetIstenen: number }>,
  scannedSerials: Record<string, string[]>
): PickingProgress {
  const itemsForProduct = pickingList.filter(item => item.stokKodu === stokKodu);
  const requested = itemsForProduct.reduce((sum, item) => sum + item.adetIstenen, 0);
  const scanned = (scannedSerials[stokKodu] || []).length;
  const isComplete = scanned >= requested;
  const percentage = requested > 0 ? Math.min(100, (scanned / requested) * 100) : 0;

  return {
    stokKodu,
    requested,
    scanned,
    isComplete,
    percentage,
  };
}

/**
 * Calculate overall picking progress
 * @param pickingList - Full picking list
 * @param scannedSerials - Map of scanned serials
 * @returns Overall picking progress
 */
export function calculateOverallPickingProgress(
  pickingList: Array<{ stokKodu: string; adetIstenen: number }>,
  scannedSerials: Record<string, string[]>
): OverallPickingProgress {
  const uniqueStockCodes = [...new Set(pickingList.map(item => item.stokKodu))];
  const itemProgress = uniqueStockCodes.map(stokKodu =>
    calculatePickingProgress(stokKodu, pickingList, scannedSerials)
  );

  const totalItems = uniqueStockCodes.length;
  const completedItems = itemProgress.filter(p => p.isComplete).length;
  const totalQuantity = itemProgress.reduce((sum, p) => sum + p.requested, 0);
  const scannedQuantity = itemProgress.reduce((sum, p) => sum + p.scanned, 0);
  const percentage = totalQuantity > 0 ? Math.min(100, (scannedQuantity / totalQuantity) * 100) : 0;

  return {
    totalItems,
    completedItems,
    totalQuantity,
    scannedQuantity,
    percentage,
    itemProgress,
  };
}

/**
 * Check if a serial has already been scanned
 * @param serial - Serial number to check
 * @param scannedSerials - Map of already scanned serials
 * @returns True if already scanned
 */
export function isSerialAlreadyScanned(
  serial: string,
  scannedSerials: Record<string, string[]>
): boolean {
  return Object.values(scannedSerials).flat().includes(serial);
}

/**
 * Check if picking is complete for a product
 * @param stokKodu - Stock code
 * @param pickingList - Full picking list
 * @param scannedSerials - Map of scanned serials
 * @returns True if picking is complete
 */
export function isPickingCompleteForProduct(
  stokKodu: string,
  pickingList: Array<{ stokKodu: string; adetIstenen: number }>,
  scannedSerials: Record<string, string[]>
): boolean {
  const progress = calculatePickingProgress(stokKodu, pickingList, scannedSerials);
  return progress.isComplete;
}

/**
 * Check if entire order picking is complete
 * @param pickingList - Full picking list
 * @param scannedSerials - Map of scanned serials
 * @returns True if all items are picked
 */
export function isOrderPickingComplete(
  pickingList: Array<{ stokKodu: string; adetIstenen: number }>,
  scannedSerials: Record<string, string[]>
): boolean {
  const progress = calculateOverallPickingProgress(pickingList, scannedSerials);
  return progress.completedItems === progress.totalItems;
}

// ============================================================================
// DATE VALIDATION
// ============================================================================

/**
 * Parse a date string in DD.MM.YYYY format
 * @param dateStr - Date string to parse
 * @returns Parsed Date object or null if invalid
 */
export function parseDateDDMMYYYY(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  const parts = dateStr.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // 0-indexed
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    return null;
  }

  if (day < 1 || day > 31 || month < 0 || month > 11 || year < 1900 || year > 2100) {
    return null;
  }

  const date = new Date(year, month, day);

  // Verify the date is valid
  if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) {
    return null;
  }

  return date;
}

/**
 * Compare two dates for FEFO sorting
 * @param dateA - First date string (DD.MM.YYYY)
 * @param dateB - Second date string (DD.MM.YYYY)
 * @returns -1 if dateA is earlier, 1 if dateB is earlier, 0 if equal
 */
export function compareDatesFEFO(dateA: string, dateB: string): number {
  const parsedA = parseDateDDMMYYYY(dateA);
  const parsedB = parseDateDDMMYYYY(dateB);

  if (!parsedA && !parsedB) return 0;
  if (!parsedA) return 1; // Invalid dates go to end
  if (!parsedB) return -1;

  return parsedA.getTime() - parsedB.getTime();
}
