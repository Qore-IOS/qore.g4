/**
 * @fileoverview Validation schemas and utilities for Direct Transfer module
 * @description Zod-based validation with security measures, input sanitization,
 * and comprehensive validation rules for transfer operations
 * @module lib/direkt-transfer/validation
 * @version 1.0.0
 */

import { z } from 'zod';
import type {
  TransferRow,
  TransferFormState,
  ManualLotPayload,
  ManualQtyPayload,
  TransferValidationResult,
  TransferValidationError,
  TransferValidationErrorCode,
} from './types';

// ============================================================================
// SECURITY PATTERNS
// ============================================================================

/**
 * XSS attack pattern detection
 * Detects common XSS vectors in input strings
 */
const XSS_PATTERN = /<script[\s\S]*?>[\s\S]*?<\/script>|javascript:|on\w+\s*=|<iframe|<object|<embed|<link|<meta|<style[\s\S]*?>[\s\S]*?<\/style>|eval\s*\(|expression\s*\(/gi;

/**
 * SQL injection pattern detection
 * Detects common SQL injection attempts
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
 * Allows alphanumeric, hyphen, underscore, and period
 */
export const STOCK_CODE_PATTERN = /^[A-Za-z0-9\-_.]+$/;

/**
 * Lot number validation pattern
 * Allows alphanumeric, hyphen, underscore, period, and forward slash
 */
export const LOT_NUMBER_PATTERN = /^[A-Za-z0-9\-_.\/]*$/;

/**
 * Serial number validation pattern
 * Allows alphanumeric, hyphen, and underscore
 */
export const SERIAL_NUMBER_PATTERN = /^[A-Za-z0-9\-_]*$/;

/**
 * Depot/Hospital ID pattern (Firestore document ID)
 * Allows alphanumeric and underscore
 */
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * Date format pattern (DD.MM.YYYY)
 */
export const DATE_FORMAT_PATTERN = /^\d{2}\.\d{2}\.\d{4}$/;

/**
 * Company name pattern
 * Allows alphanumeric, spaces, common punctuation
 */
export const COMPANY_NAME_PATTERN = /^[A-Za-z0-9\s\-_.&()]+$/;

// ============================================================================
// SECURITY CHECK FUNCTIONS
// ============================================================================

/**
 * Security threat types for logging and handling
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
  /** Sanitized value (if applicable) */
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

  // Check for excessive length
  if (value.length > maxLength) {
    threats.push('EXCESSIVE_LENGTH');
  }

  // Check for XSS patterns
  if (XSS_PATTERN.test(value)) {
    threats.push('XSS');
  }

  // Check for SQL injection patterns
  if (SQL_INJECTION_PATTERN.test(value)) {
    threats.push('SQL_INJECTION');
  }

  // Check for path traversal
  if (PATH_TRAVERSAL_PATTERN.test(value)) {
    threats.push('PATH_TRAVERSAL');
  }

  // Check for null byte injection
  if (NULL_BYTE_PATTERN.test(value)) {
    threats.push('NULL_BYTE');
  }

  return {
    isSafe: threats.length === 0,
    threats,
    sanitizedValue: threats.length > 0 ? sanitizeString(value) : value,
  };
}

// ============================================================================
// SANITIZATION FUNCTIONS
// ============================================================================

/**
 * Sanitizes a general string by removing control characters and normalizing whitespace
 * @param value - Input string to sanitize
 * @returns Sanitized string
 */
export function sanitizeString(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    // Remove null bytes
    .replace(NULL_BYTE_PATTERN, '')
    // Remove control characters (except newline and tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize multiple spaces to single space
    .replace(/\s+/g, ' ')
    // Trim whitespace
    .trim();
}

/**
 * Escapes HTML entities to prevent XSS
 * @param value - Input string to escape
 * @returns Escaped string safe for HTML rendering
 */
export function escapeHtml(value: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return value.replace(/[&<>"']/g, (char) => htmlEntities[char] || char);
}

/**
 * Sanitizes stock code input
 * @param value - Raw stock code input
 * @returns Sanitized stock code
 */
export function sanitizeStockCode(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    .toUpperCase()
    // Remove characters not allowed in stock codes
    .replace(/[^A-Z0-9\-_.]/g, '')
    // Limit length
    .slice(0, 50);
}

/**
 * Sanitizes lot number input
 * @param value - Raw lot number input
 * @returns Sanitized lot number
 */
export function sanitizeLotNumber(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    .toUpperCase()
    // Remove characters not allowed in lot numbers
    .replace(/[^A-Z0-9\-_.\/]/g, '')
    // Limit length
    .slice(0, 50);
}

/**
 * Sanitizes serial number input
 * @param value - Raw serial number input
 * @returns Sanitized serial number
 */
export function sanitizeSerialNumber(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    .toUpperCase()
    // Remove characters not allowed in serial numbers
    .replace(/[^A-Z0-9\-_]/g, '')
    // Limit length
    .slice(0, 100);
}

/**
 * Sanitizes company name input
 * @param value - Raw company name input
 * @returns Sanitized company name
 */
export function sanitizeCompanyName(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    // Remove characters not allowed in company names
    .replace(/[^A-Za-z0-9\s\-_.&()]/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Limit length
    .slice(0, 200);
}

/**
 * Sanitizes barcode input preserving GS1 control characters
 * @param value - Raw barcode input
 * @returns Sanitized barcode
 */
export function sanitizeBarcode(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    // Keep GS1 control characters (ASCII 29 = Group Separator, ASCII 30 = Record Separator)
    .replace(/[^\x1D\x1E\x20-\x7E]/g, '')
    // Limit length
    .slice(0, 500);
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Firestore document ID schema
 */
export const DocumentIdSchema = z
  .string()
  .min(1, 'Kimlik boş olamaz')
  .max(100, 'Kimlik çok uzun')
  .regex(DOCUMENT_ID_PATTERN, 'Geçersiz kimlik formatı');

/**
 * Stock code schema
 */
export const StockCodeSchema = z
  .string()
  .min(1, 'Stok kodu boş olamaz')
  .max(50, 'Stok kodu en fazla 50 karakter olabilir')
  .regex(STOCK_CODE_PATTERN, 'Geçersiz stok kodu formatı')
  .transform(sanitizeStockCode);

/**
 * Lot number schema (optional)
 */
export const LotNumberSchema = z
  .string()
  .max(50, 'Lot numarası en fazla 50 karakter olabilir')
  .regex(LOT_NUMBER_PATTERN, 'Geçersiz lot numarası formatı')
  .transform(sanitizeLotNumber)
  .optional()
  .default('');

/**
 * Serial number schema (optional)
 */
export const SerialNumberSchema = z
  .string()
  .max(100, 'Seri numarası en fazla 100 karakter olabilir')
  .regex(SERIAL_NUMBER_PATTERN, 'Geçersiz seri numarası formatı')
  .transform(sanitizeSerialNumber)
  .optional()
  .default('');

/**
 * Date string schema (DD.MM.YYYY format)
 */
export const DateStringSchema = z
  .string()
  .max(10, 'Geçersiz tarih formatı')
  .refine(
    (val) => !val || DATE_FORMAT_PATTERN.test(val),
    'Tarih DD.MM.YYYY formatında olmalıdır'
  )
  .optional()
  .default('');

/**
 * Quantity schema
 */
export const QuantitySchema = z
  .number()
  .int('Adet tam sayı olmalıdır')
  .min(1, 'Adet en az 1 olmalıdır')
  .max(100000, 'Adet en fazla 100.000 olabilir');

/**
 * Transfer item schema
 */
export const TransferItemSchema = z.object({
  stokKodu: StockCodeSchema,
  stokAdi: z.string().min(1).max(200).transform(sanitizeString),
  lotNumarasi: LotNumberSchema,
  miad: DateStringSchema,
  seriNumarasi: SerialNumberSchema,
});

/**
 * Transfer row schema (extends TransferItem with transfer-specific fields)
 */
export const TransferRowSchema = TransferItemSchema.extend({
  id: z.string().optional(),
  key: z.string().min(1),
  adet: QuantitySchema,
  isGroup: z.boolean().optional().default(false),
  depotId: z.string().optional(),
  depotName: z.string().optional(),
});

/**
 * Manual lot payload schema
 */
export const ManualLotPayloadSchema = z.object({
  code: StockCodeSchema,
  name: z.string().min(1, 'Ürün adı gereklidir').max(200).transform(sanitizeString),
  lot: z.string().min(1, 'Lot numarası gereklidir').max(50).transform(sanitizeLotNumber),
  miad: z.string().min(1, 'Miad gereklidir').max(10),
  qty: QuantitySchema,
});

/**
 * Manual quantity payload schema
 */
export const ManualQtyPayloadSchema = z.object({
  code: StockCodeSchema,
  name: z.string().min(1, 'Ürün adı gereklidir').max(200).transform(sanitizeString),
  qty: QuantitySchema,
});

/**
 * Transfer form state schema
 */
export const TransferFormStateSchema = z.object({
  selectedDepotId: DocumentIdSchema,
  selectedLabId: z.string(), // Can be empty in borç mode
  isBorcMode: z.boolean(),
  selectedBorcDepotId: z.string(), // Required only in borç mode
  selectedCompany: z.string().transform(sanitizeCompanyName),
  directTransferItems: z.array(TransferRowSchema).max(1000, 'En fazla 1000 ürün transfer edilebilir'),
  selectedFormatId: z.string(),
});

/**
 * Complete transfer validation schema
 * Validates entire transfer before processing
 */
export const CompleteTransferSchema = TransferFormStateSchema.refine(
  (data) => {
    // Must have a source depot
    if (!data.selectedDepotId) return false;
    // Must have items to transfer
    if (data.directTransferItems.length === 0) return false;
    // In borç mode, company is required
    if (data.isBorcMode && !data.selectedCompany) return false;
    // In lab mode, target lab is required
    if (!data.isBorcMode && !data.selectedLabId) return false;
    return true;
  },
  {
    message: 'Transfer için gerekli tüm alanlar doldurulmalıdır',
  }
);

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates transfer readiness before processing
 * @param formState - Current form state
 * @returns Validation result with detailed errors
 */
export function validateTransferReadiness(
  formState: Partial<TransferFormState>
): TransferValidationResult {
  const errors: TransferValidationError[] = [];

  // Check depot selection
  if (!formState.selectedDepotId) {
    errors.push({
      field: 'selectedDepotId',
      message: 'Kaynak depo seçilmelidir',
      code: 'DEPOT_NOT_SELECTED',
    });
  }

  // Check target selection based on mode
  if (formState.isBorcMode) {
    if (!formState.selectedBorcDepotId) {
      errors.push({
        field: 'selectedBorcDepotId',
        message: 'Borç deposu seçilmelidir',
        code: 'TARGET_NOT_SELECTED',
      });
    }
    if (!formState.selectedCompany) {
      errors.push({
        field: 'selectedCompany',
        message: 'Firma seçilmelidir',
        code: 'COMPANY_NOT_SELECTED',
      });
    }
  } else {
    if (!formState.selectedLabId) {
      errors.push({
        field: 'selectedLabId',
        message: 'Hedef laboratuvar seçilmelidir',
        code: 'TARGET_NOT_SELECTED',
      });
    }
  }

  // Check items
  if (!formState.directTransferItems || formState.directTransferItems.length === 0) {
    errors.push({
      field: 'directTransferItems',
      message: 'Transfer edilecek en az bir ürün eklenmelidir',
      code: 'NO_ITEMS',
    });
  }

  // Validate each item
  formState.directTransferItems?.forEach((item, index) => {
    if (!item.adet || item.adet < 1) {
      errors.push({
        field: `directTransferItems[${index}].adet`,
        message: `${item.stokAdi || item.stokKodu} için geçersiz adet`,
        code: 'INVALID_QUANTITY',
      });
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates manual lot payload
 * @param payload - Manual lot addition payload
 * @returns Validation result
 */
export function validateManualLotPayload(
  payload: ManualLotPayload
): { success: true; data: ManualLotPayload } | { success: false; errors: z.ZodError } {
  const result = ManualLotPayloadSchema.safeParse(payload);
  if (result.success) {
    return { success: true, data: { ...result.data, code: result.data.code, name: result.data.name, lot: result.data.lot, miad: result.data.miad, qty: result.data.qty } };
  }
  return { success: false, errors: result.error };
}

/**
 * Validates manual quantity payload
 * @param payload - Manual quantity addition payload
 * @returns Validation result
 */
export function validateManualQtyPayload(
  payload: ManualQtyPayload
): { success: true; data: ManualQtyPayload } | { success: false; errors: z.ZodError } {
  const result = ManualQtyPayloadSchema.safeParse(payload);
  if (result.success) {
    return { success: true, data: { ...result.data, code: result.data.code, name: result.data.name, qty: result.data.qty } };
  }
  return { success: false, errors: result.error };
}

/**
 * Parses and validates date string in various formats
 * @param dateStr - Date string to parse
 * @returns Parsed date or null if invalid
 */
export function parseAndValidateDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const trimmed = dateStr.trim();

  // Try DD.MM.YYYY format
  const ddmmyyyy = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) return date;
  }

  // Try YYYY-MM-DD format
  const yyyymmdd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) return date;
  }

  // Try MM/YYYY format (for expiry dates)
  const mmyyyy = trimmed.match(/^(\d{2})\/(\d{4})$/);
  if (mmyyyy) {
    const [, month, year] = mmyyyy;
    // Set to last day of month for expiry
    const date = new Date(parseInt(year), parseInt(month), 0);
    if (!isNaN(date.getTime())) return date;
  }

  // Try YYYY-MM format
  const yyyymm = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (yyyymm) {
    const [, year, month] = yyyymm;
    const date = new Date(parseInt(year), parseInt(month), 0);
    if (!isNaN(date.getTime())) return date;
  }

  return null;
}

/**
 * Checks if a date is expired (before today)
 * @param dateStr - Date string in DD.MM.YYYY format
 * @returns Whether the date is expired
 */
export function isExpired(dateStr: string): boolean {
  const date = parseAndValidateDate(dateStr);
  if (!date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return date < today;
}

/**
 * Validates that a serial number is unique in the transfer list
 * @param seriNumarasi - Serial number to check
 * @param stokKodu - Stock code (serial uniqueness is per product)
 * @param existingItems - Current transfer items
 * @returns Whether the serial is unique
 */
export function isSerialUnique(
  seriNumarasi: string,
  stokKodu: string,
  existingItems: TransferRow[]
): boolean {
  if (!seriNumarasi) return true;

  return !existingItems.some(
    (item) => item.stokKodu === stokKodu && item.seriNumarasi === seriNumarasi
  );
}

/**
 * Calculates remaining stock for a product/lot combination
 * @param stokKodu - Stock code
 * @param lotNumarasi - Lot number (optional)
 * @param stockInDepot - Total stock count in depot
 * @param queuedItems - Items already queued for transfer
 * @returns Remaining stock available
 */
export function calculateRemainingStock(
  stokKodu: string,
  lotNumarasi: string | undefined,
  stockInDepot: number,
  queuedItems: TransferRow[]
): number {
  const queued = queuedItems
    .filter(
      (item) =>
        item.stokKodu === stokKodu &&
        (lotNumarasi ? item.lotNumarasi === lotNumarasi : true)
    )
    .reduce((sum, item) => sum + (item.adet ?? 1), 0);

  return Math.max(0, stockInDepot - queued);
}

// ============================================================================
// ERROR MESSAGE HELPERS
// ============================================================================

/**
 * Formats Zod validation errors for user display
 * @param errors - Zod validation errors
 * @returns Formatted error message
 */
export function formatZodErrors(errors: z.ZodError): string {
  return errors.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/**
 * Gets user-friendly error message for validation error code
 * @param code - Validation error code
 * @returns User-friendly error message
 */
export function getValidationErrorMessage(code: TransferValidationErrorCode): string {
  const messages: Record<TransferValidationErrorCode, string> = {
    DEPOT_NOT_SELECTED: 'Lütfen kaynak depo seçin',
    TARGET_NOT_SELECTED: 'Lütfen hedef kurum seçin',
    NO_ITEMS: 'Transfer listesi boş',
    INSUFFICIENT_STOCK: 'Yeterli stok bulunmuyor',
    INVALID_QUANTITY: 'Geçersiz adet değeri',
    EXPIRED_ITEM: 'Miadı geçmiş ürün transfer edilemez',
    COMPANY_NOT_SELECTED: 'Lütfen firma seçin',
  };

  return messages[code] || 'Bilinmeyen doğrulama hatası';
}
