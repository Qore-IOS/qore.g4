/**
 * @fileoverview Validation schemas and utilities for Product Usage module
 * @description Zod-based validation with security measures, input sanitization,
 * and comprehensive validation rules for consumption operations
 * @module lib/urun-kullanim/validation
 * @version 1.0.0
 */

import { z } from 'zod';
import type {
  ManualDeductionPayload,
  TrashBinItem,
  FaultReportPayload,
  ConsumptionValidationResult,
  ConsumptionValidationError,
  ConsumptionValidationErrorCode,
  VerificationItemGroup,
} from './types';

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
 * Lot number validation pattern
 */
export const LOT_NUMBER_PATTERN = /^[A-Za-z0-9\-_.\/]*$/;

/**
 * Serial number validation pattern
 */
export const SERIAL_NUMBER_PATTERN = /^[A-Za-z0-9\-_]*$/;

/**
 * Firestore document ID pattern
 */
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * Date format pattern (DD.MM.YYYY)
 */
export const DATE_FORMAT_PATTERN = /^\d{2}\.\d{2}\.\d{4}$/;

/**
 * Disposal barcode pattern
 */
export const DISPOSAL_BARCODE_PATTERN = /^[A-Za-z0-9]+$/;

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
    sanitizedValue: threats.length > 0 ? sanitizeString(value) : value,
  };
}

// ============================================================================
// SANITIZATION FUNCTIONS
// ============================================================================

/**
 * Sanitizes a general string
 * @param value - Input string to sanitize
 * @returns Sanitized string
 */
export function sanitizeString(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .replace(NULL_BYTE_PATTERN, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escapes HTML entities
 * @param value - Input string to escape
 * @returns Escaped string
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
 * @param value - Raw stock code
 * @returns Sanitized stock code
 */
export function sanitizeStockCode(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\-_.]/g, '')
    .slice(0, 50);
}

/**
 * Sanitizes lot number input
 * @param value - Raw lot number
 * @returns Sanitized lot number
 */
export function sanitizeLotNumber(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\-_.\/]/g, '')
    .slice(0, 50);
}

/**
 * Sanitizes serial number input
 * @param value - Raw serial number
 * @returns Sanitized serial number
 */
export function sanitizeSerialNumber(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\-_]/g, '')
    .slice(0, 100);
}

/**
 * Sanitizes barcode input preserving GS1 control characters
 * @param value - Raw barcode
 * @returns Sanitized barcode
 */
export function sanitizeBarcode(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    .replace(/[^\x1D\x1E\x20-\x7E]/g, '')
    .slice(0, 500);
}

/**
 * Sanitizes fault description input
 * @param value - Raw description
 * @returns Sanitized description
 */
export function sanitizeFaultDescription(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 1000);
}

/**
 * Sanitizes disposal barcode
 * @param value - Raw disposal barcode
 * @param expectedLength - Expected barcode length
 * @returns Sanitized disposal barcode
 */
export function sanitizeDisposalBarcode(
  value: string | null | undefined,
  expectedLength = 16
): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, expectedLength);
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
 * Quantity schema
 */
export const QuantitySchema = z
  .number()
  .int('Adet tam sayı olmalıdır')
  .min(1, 'Adet en az 1 olmalıdır')
  .max(10000, 'Adet en fazla 10.000 olabilir');

/**
 * Remaining tests schema
 */
export const RemainingTestsSchema = z
  .number()
  .int('Kalan test adeti tam sayı olmalıdır')
  .min(0, 'Kalan test adeti negatif olamaz')
  .max(100000, 'Kalan test adeti çok yüksek');

/**
 * Manual deduction payload schema
 */
export const ManualDeductionPayloadSchema = z.object({
  productCode: StockCodeSchema,
  lotNumarasi: z.string().min(1, 'Lot numarası gereklidir').transform(sanitizeLotNumber),
  miad: z.string().max(20),
  quantity: QuantitySchema,
  laboratoryId: DocumentIdSchema,
});

/**
 * Trash bin item schema
 */
export const TrashBinItemSchema = z.object({
  id: z.string().min(1),
  productCode: StockCodeSchema,
  productName: z.string().min(1).max(200).transform(sanitizeString),
  remainingTests: RemainingTestsSchema,
});

/**
 * Fault report payload schema
 */
export const FaultReportPayloadSchema = z.object({
  hospitalId: DocumentIdSchema,
  labName: z.string().min(1).max(200).transform(sanitizeString),
  deviceId: DocumentIdSchema,
  model: z.string().min(1).max(200).transform(sanitizeString),
  serial: z.string().max(100).transform(sanitizeString),
  faultType: z.enum(['teknik_servis', 'aplikasyon']),
  openedByUid: z.string().min(1),
  openedByName: z.string().min(1).max(200).transform(sanitizeString),
  openDescription: z.string().max(1000).transform(sanitizeFaultDescription),
});

/**
 * Disposal barcode schema
 */
export const DisposalBarcodeSchema = z
  .string()
  .min(1, 'İmha barkodu gereklidir')
  .max(20, 'İmha barkodu çok uzun')
  .regex(DISPOSAL_BARCODE_PATTERN, 'Geçersiz imha barkodu formatı');

/**
 * Verification item group schema
 */
export const VerificationItemGroupSchema = z.object({
  stokKodu: StockCodeSchema,
  stokAdi: z.string().min(1).max(200),
  lotNumarasi: z.string().max(50),
  miad: z.string().max(20),
  tuketilenAdet: z.number().int().min(0),
  dogrulananAdet: z.number().int().min(0),
  originalRecordIds: z.array(z.string()),
});

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates consumption readiness
 * @param params - Consumption parameters
 * @returns Validation result
 */
export function validateConsumptionReadiness(params: {
  laboratoryId?: string;
  stockItem?: { stokKodu: string; seriNumarasi?: string } | null;
  productFound?: boolean;
  isAlreadyConsumed?: boolean;
}): ConsumptionValidationResult {
  const errors: ConsumptionValidationError[] = [];

  if (!params.laboratoryId) {
    errors.push({
      field: 'laboratoryId',
      message: 'Lütfen kullanım yapılacak laboratuvarı seçin',
      code: 'LABORATORY_NOT_SELECTED',
    });
  }

  if (!params.productFound) {
    errors.push({
      field: 'product',
      message: 'Barkoddan bir ürün çözümlenemedi',
      code: 'PRODUCT_NOT_FOUND',
    });
  }

  if (!params.stockItem) {
    errors.push({
      field: 'stockItem',
      message: 'Ürün laboratuvar stoğunda bulunamadı',
      code: 'INSUFFICIENT_STOCK',
    });
  }

  if (params.isAlreadyConsumed) {
    errors.push({
      field: 'consumption',
      message: 'Bu ürün daha önce stoktan düşülmüş',
      code: 'ALREADY_CONSUMED',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates manual deduction payload
 * @param payload - Manual deduction payload
 * @returns Validation result
 */
export function validateManualDeduction(
  payload: ManualDeductionPayload
): { success: true; data: ManualDeductionPayload } | { success: false; errors: z.ZodError } {
  const result = ManualDeductionPayloadSchema.safeParse(payload);
  if (result.success) {
    return { success: true, data: { ...result.data, productCode: result.data.productCode, lotNumarasi: result.data.lotNumarasi, miad: result.data.miad, quantity: result.data.quantity, laboratoryId: result.data.laboratoryId } };
  }
  return { success: false, errors: result.error };
}

/**
 * Validates trash bin items
 * @param items - Trash bin items to validate
 * @returns Validation result
 */
export function validateTrashBinItems(
  items: TrashBinItem[]
): { success: true; data: TrashBinItem[] } | { success: false; errors: string[] } {
  const errors: string[] = [];

  if (items.length === 0) {
    errors.push('En az bir ürün eklemelisiniz');
  }

  items.forEach((item, index) => {
    const result = TrashBinItemSchema.safeParse(item);
    if (!result.success) {
      errors.push(`Ürün ${index + 1}: ${result.error.issues[0].message}`);
    }
  });

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: items };
}

/**
 * Validates fault report payload
 * @param payload - Fault report payload
 * @returns Validation result
 */
export function validateFaultReport(
  payload: FaultReportPayload
): { success: true; data: FaultReportPayload } | { success: false; errors: z.ZodError } {
  const result = FaultReportPayloadSchema.safeParse(payload);
  if (result.success) {
    return { success: true, data: { ...result.data, hospitalId: result.data.hospitalId, labName: result.data.labName, deviceId: result.data.deviceId, model: result.data.model, serial: result.data.serial, faultType: result.data.faultType, openedByUid: result.data.openedByUid, openedByName: result.data.openedByName, openDescription: result.data.openDescription } };
  }
  return { success: false, errors: result.error };
}

/**
 * Validates disposal barcode
 * @param barcode - Disposal barcode
 * @param expectedLength - Expected length
 * @returns Validation result
 */
export function validateDisposalBarcode(
  barcode: string,
  expectedLength = 16
): { isValid: boolean; error?: string; sanitized: string } {
  const sanitized = sanitizeDisposalBarcode(barcode, expectedLength);

  if (!sanitized) {
    return { isValid: false, error: 'İmha barkodu boş olamaz', sanitized: '' };
  }

  if (sanitized.length !== expectedLength) {
    return {
      isValid: false,
      error: `İmha barkodu ${expectedLength} hane olmalıdır. Girilen: ${sanitized.length}`,
      sanitized,
    };
  }

  return { isValid: true, sanitized };
}

/**
 * Extracts lot number from disposal barcode
 * @param barcode - Disposal barcode
 * @param lotLength - Length of lot number portion
 * @returns Extracted lot number
 */
export function extractLotFromDisposalBarcode(
  barcode: string,
  lotLength = 8
): string {
  const sanitized = sanitizeDisposalBarcode(barcode);
  return sanitized.substring(0, lotLength);
}

/**
 * Checks if a verification item can be verified
 * @param item - Verification item
 * @returns Whether item can accept more verifications
 */
export function canVerifyItem(item: VerificationItemGroup): boolean {
  return item.dogrulananAdet < item.tuketilenAdet;
}

/**
 * Checks if a verification item is fully verified
 * @param item - Verification item
 * @returns Whether item is fully verified
 */
export function isFullyVerified(item: VerificationItemGroup): boolean {
  return item.dogrulananAdet === item.tuketilenAdet && item.tuketilenAdet > 0;
}

/**
 * Calculates verification progress percentage
 * @param item - Verification item
 * @returns Progress percentage (0-100)
 */
export function calculateVerificationProgress(item: VerificationItemGroup): number {
  if (item.tuketilenAdet === 0) return 0;
  return Math.round((item.dogrulananAdet / item.tuketilenAdet) * 100);
}

// ============================================================================
// DATE VALIDATION
// ============================================================================

/**
 * Parses and validates date string
 * @param dateStr - Date string to parse
 * @returns Parsed date or null
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

  return null;
}

/**
 * Checks if a date is expired
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
export function getValidationErrorMessage(code: ConsumptionValidationErrorCode): string {
  const messages: Record<ConsumptionValidationErrorCode, string> = {
    LABORATORY_NOT_SELECTED: 'Lütfen laboratuvar seçin',
    PRODUCT_NOT_FOUND: 'Ürün bulunamadı',
    INSUFFICIENT_STOCK: 'Yeterli stok bulunmuyor',
    ALREADY_CONSUMED: 'Ürün zaten tüketilmiş',
    INVALID_BARCODE: 'Geçersiz barkod formatı',
    TRACKING_MODE_MISMATCH: 'Takip modu uyumsuzluğu',
  };

  return messages[code] || 'Bilinmeyen doğrulama hatası';
}
