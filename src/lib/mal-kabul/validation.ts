/**
 * @fileoverview Mal Kabul Panel Validation System
 * @description Comprehensive validation schemas and utilities for input validation,
 * security checks, and data sanitization for the Goods Receiving panel.
 * @module lib/mal-kabul/validation
 * @version 1.0.0
 */

import { z } from 'zod';
import type {
  ScanRow,
  MalKabulLine,
  MalKabulHeader,
  IrsaliyeParseResult,
  LotAddPayload,
  QtyAddPayload,
  StockDocumentData,
} from './types';

// =============================================================================
// REGEX PATTERNS
// =============================================================================

/**
 * Regex patterns for validation
 */
export const PATTERNS = {
  /** Stock code pattern: alphanumeric with dashes, 3-50 chars */
  STOCK_CODE: /^[A-Za-z0-9\-._]{3,50}$/,
  /** Lot number pattern: alphanumeric with some special chars */
  LOT_NUMBER: /^[A-Za-z0-9\-._/]{1,50}$/,
  /** Serial number pattern: alphanumeric with some special chars */
  SERIAL_NUMBER: /^[A-Za-z0-9\-._/]{1,100}$/,
  /** Date pattern: YYYY-MM-DD or DD.MM.YYYY */
  DATE: /^(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})$/,
  /** Expiry date pattern: supports various formats */
  EXPIRY_DATE: /^(\d{4}-\d{2}(-\d{2})?|\d{2}\.\d{2}\.\d{4}|\d{2}\/\d{4})$/,
  /** Barcode pattern: alphanumeric with GS1 control chars */
  BARCODE: /^[\x00-\x7F]{5,200}$/,
  /** Rack address pattern */
  RACK_ADDRESS: /^[A-Za-z0-9\-._/\s]{1,50}$/,
  /** Invoice number pattern */
  INVOICE_NUMBER: /^[A-Za-z0-9\-._/\s]{1,100}$/,
  /** Transaction ID pattern */
  TRANSACTION_ID: /^MK-[A-Za-z0-9]{8,20}$/,
  /** Firebase document ID pattern */
  FIREBASE_DOC_ID: /^[A-Za-z0-9]{20}$/,
  /** User ID (Firebase UID) pattern */
  USER_ID: /^[A-Za-z0-9]{20,128}$/,
  /** Email pattern */
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  /** XSS prevention - blocks script tags and event handlers */
  XSS_DANGEROUS: /<script|javascript:|on\w+\s*=/i,
  /** SQL injection prevention - blocks common SQL patterns */
  SQL_INJECTION: /(\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bUNION\b|--|;)/i,
} as const;

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

/**
 * Stock code schema
 */
export const stockCodeSchema = z
  .string()
  .min(1, 'Stok kodu boş olamaz')
  .max(50, 'Stok kodu 50 karakterden uzun olamaz')
  .regex(PATTERNS.STOCK_CODE, 'Stok kodu geçersiz karakterler içeriyor');

/**
 * Lot number schema
 */
export const lotNumberSchema = z
  .string()
  .max(50, 'Lot numarası 50 karakterden uzun olamaz')
  .regex(PATTERNS.LOT_NUMBER, 'Lot numarası geçersiz karakterler içeriyor')
  .optional()
  .or(z.literal(''));

/**
 * Serial number schema
 */
export const serialNumberSchema = z
  .string()
  .max(100, 'Seri numarası 100 karakterden uzun olamaz')
  .optional()
  .or(z.literal(''));

/**
 * Expiry date schema
 */
export const expiryDateSchema = z
  .string()
  .max(20, 'Miad 20 karakterden uzun olamaz')
  .optional()
  .or(z.literal(''));

/**
 * Rack address schema
 */
export const rackAddressSchema = z
  .string()
  .max(50, 'Raf adresi 50 karakterden uzun olamaz')
  .optional()
  .or(z.literal(''));

/**
 * Invoice number schema
 */
export const invoiceNumberSchema = z
  .string()
  .max(100, 'İrsaliye numarası 100 karakterden uzun olamaz')
  .optional()
  .or(z.literal(''));

/**
 * Quantity schema
 */
export const quantitySchema = z
  .number()
  .int('Adet tam sayı olmalı')
  .min(1, 'Adet en az 1 olmalı')
  .max(100000, 'Adet 100.000\'den fazla olamaz');

/**
 * Barcode data schema
 */
export const barcodeDataSchema = z
  .string()
  .min(5, 'Barkod verisi çok kısa')
  .max(200, 'Barkod verisi çok uzun')
  .refine(
    (val) => !PATTERNS.XSS_DANGEROUS.test(val),
    'Barkod verisi güvenlik açığı içeriyor'
  );

/**
 * Base scanned item schema
 */
export const scannedItemSchema = z.object({
  id: z.string().min(1),
  barkod: barcodeDataSchema,
  stokKodu: stockCodeSchema,
  stokAdi: z.string().min(1).max(200),
  lotNumarasi: lotNumberSchema.default(''),
  miad: expiryDateSchema.default(''),
  seriNumarasi: serialNumberSchema.default(''),
  rafAdresi: rackAddressSchema.default(''),
  irsaliyeNumarasi: invoiceNumberSchema.default(''),
  isSelected: z.boolean().default(false),
  timestamp: z.date(),
  isProcessed: z.boolean().default(false),
});

/**
 * Scan row schema (extended with grouping)
 */
export const scanRowSchema = scannedItemSchema.extend({
  adet: quantitySchema.optional(),
  isGroup: z.boolean().optional(),
  expectedAdet: quantitySchema.optional(),
  scannedSerials: z.array(serialNumberSchema).optional(),
  key: z.string().optional(),
  items: z.array(scannedItemSchema).optional(),
});

/**
 * Mal Kabul line schema
 */
export const malKabulLineSchema = z.object({
  stokKodu: stockCodeSchema,
  stokAdi: z.string().min(1).max(200),
  lotNumarasi: z.string().max(50).default(''),
  miad: z.string().max(20).default(''),
  adet: quantitySchema,
  serials: z.array(z.string().max(100)).default([]),
});

/**
 * Mal Kabul header schema
 */
export const malKabulHeaderSchema = z.object({
  transactionId: z.string().regex(PATTERNS.TRANSACTION_ID),
  depotId: z.string().min(1),
  depotName: z.string().min(1).max(200),
  userId: z.string().min(1),
  userName: z.string().min(1).max(200),
  timestamp: z.any(), // Firestore Timestamp
  itemCount: z.number().int().min(0),
  brands: z.array(z.string().max(100)),
  mode: z.enum(['verified', 'unverified']),
});

/**
 * Lot add payload schema
 */
export const lotAddPayloadSchema = z.object({
  code: stockCodeSchema,
  name: z.string().min(1).max(200),
  lot: z.string().min(1, 'Lot numarası zorunlu').max(50),
  miad: z.string().min(1, 'Miad zorunlu').max(20),
  qty: quantitySchema,
});

/**
 * Quantity add payload schema
 */
export const qtyAddPayloadSchema = z.object({
  code: stockCodeSchema,
  name: z.string().min(1).max(200),
  qty: quantitySchema,
});

/**
 * Irsaliye parse result schema
 */
export const irsaliyeParseResultSchema = z.object({
  stokKodu: stockCodeSchema,
  lot: lotNumberSchema,
  miad: expiryDateSchema,
  quantity: quantitySchema,
});

/**
 * Depot selection schema
 */
export const depotSelectionSchema = z.object({
  depotId: z.string().min(1, 'Depo seçimi zorunlu'),
});

/**
 * Address assignment schema
 */
export const addressAssignmentSchema = z.object({
  address: z.string().min(1, 'Adres boş olamaz').max(50),
  selectedItems: z.array(z.string()).min(1, 'En az bir ürün seçilmeli'),
});

/**
 * Invoice assignment schema
 */
export const invoiceAssignmentSchema = z.object({
  invoiceNumber: z.string().min(1, 'İrsaliye numarası boş olamaz').max(100),
  selectedItems: z.array(z.string()).min(1, 'En az bir ürün seçilmeli'),
});

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validation result type
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

/**
 * Validate scan row data
 */
export function validateScanRow(data: unknown): ValidationResult<ScanRow> {
  const result = scanRowSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data as ScanRow };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

/**
 * Validate mal kabul line data
 */
export function validateMalKabulLine(data: unknown): ValidationResult<MalKabulLine> {
  const result = malKabulLineSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data as MalKabulLine };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

/**
 * Validate lot add payload
 */
export function validateLotAddPayload(data: unknown): ValidationResult<LotAddPayload> {
  const result = lotAddPayloadSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data as LotAddPayload };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

/**
 * Validate quantity add payload
 */
export function validateQtyAddPayload(data: unknown): ValidationResult<QtyAddPayload> {
  const result = qtyAddPayloadSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data as QtyAddPayload };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

/**
 * Validate barcode data
 */
export function validateBarcodeData(barcode: string): ValidationResult<string> {
  const result = barcodeDataSchema.safeParse(barcode);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => e.message),
  };
}

/**
 * Validate irsaliye parse results
 */
export function validateIrsaliyeResults(
  results: unknown[]
): ValidationResult<IrsaliyeParseResult[]> {
  const validated: IrsaliyeParseResult[] = [];
  const errors: string[] = [];

  results.forEach((item, index) => {
    const result = irsaliyeParseResultSchema.safeParse(item);
    if (result.success) {
      validated.push(result.data as IrsaliyeParseResult);
    } else {
      errors.push(`Öğe ${index + 1}: ${result.error.errors.map(e => e.message).join(', ')}`);
    }
  });

  if (errors.length === 0) {
    return { success: true, data: validated };
  }
  return { success: validated.length > 0, data: validated, errors };
}

// =============================================================================
// SANITIZATION FUNCTIONS
// =============================================================================

/**
 * Sanitize string input by removing potentially dangerous characters
 */
export function sanitizeString(input: string): string {
  if (!input) return '';

  return input
    // Remove control characters except newlines and tabs
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Trim whitespace
    .trim()
    // Normalize whitespace
    .replace(/\s+/g, ' ');
}

/**
 * Sanitize and escape HTML entities
 */
export function escapeHtml(input: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return input.replace(/[&<>"']/g, char => map[char]);
}

/**
 * Sanitize barcode data
 */
export function sanitizeBarcode(barcode: string): string {
  if (!barcode) return '';

  // Remove non-printable characters except GS1 control chars (29, 30, 31)
  return barcode
    .split('')
    .filter(char => {
      const code = char.charCodeAt(0);
      // Allow printable ASCII and GS1 control characters
      return (code >= 32 && code <= 126) || code === 29 || code === 30 || code === 31;
    })
    .join('')
    .trim();
}

/**
 * Sanitize stock code
 */
export function sanitizeStockCode(code: string): string {
  if (!code) return '';
  return code.replace(/[^A-Za-z0-9\-._]/g, '').substring(0, 50);
}

/**
 * Sanitize lot number
 */
export function sanitizeLotNumber(lot: string): string {
  if (!lot) return '';
  return lot.replace(/[^A-Za-z0-9\-._/]/g, '').substring(0, 50);
}

/**
 * Sanitize serial number
 */
export function sanitizeSerialNumber(serial: string): string {
  if (!serial) return '';
  return serial.replace(/[^A-Za-z0-9\-._/]/g, '').substring(0, 100);
}

/**
 * Sanitize all fields of a scan row
 */
export function sanitizeScanRow(row: Partial<ScanRow>): Partial<ScanRow> {
  return {
    ...row,
    barkod: row.barkod ? sanitizeBarcode(row.barkod) : '',
    stokKodu: row.stokKodu ? sanitizeStockCode(row.stokKodu) : '',
    stokAdi: row.stokAdi ? sanitizeString(row.stokAdi) : '',
    lotNumarasi: row.lotNumarasi ? sanitizeLotNumber(row.lotNumarasi) : '',
    seriNumarasi: row.seriNumarasi ? sanitizeSerialNumber(row.seriNumarasi) : '',
    rafAdresi: row.rafAdresi ? sanitizeString(row.rafAdresi) : '',
    irsaliyeNumarasi: row.irsaliyeNumarasi ? sanitizeString(row.irsaliyeNumarasi) : '',
  };
}

// =============================================================================
// SECURITY CHECKS
// =============================================================================

/**
 * Check for XSS patterns in input
 */
export function hasXssPattern(input: string): boolean {
  return PATTERNS.XSS_DANGEROUS.test(input);
}

/**
 * Check for SQL injection patterns in input
 */
export function hasSqlInjectionPattern(input: string): boolean {
  return PATTERNS.SQL_INJECTION.test(input);
}

/**
 * Comprehensive security check on input
 */
export function securityCheck(input: string): { safe: boolean; threats: string[] } {
  const threats: string[] = [];

  if (hasXssPattern(input)) {
    threats.push('XSS pattern detected');
  }

  if (hasSqlInjectionPattern(input)) {
    threats.push('SQL injection pattern detected');
  }

  // Check for excessively long input
  if (input.length > 10000) {
    threats.push('Input exceeds maximum length');
  }

  // Check for null bytes
  if (input.includes('\x00')) {
    threats.push('Null byte detected');
  }

  return {
    safe: threats.length === 0,
    threats,
  };
}

// =============================================================================
// BUSINESS RULE VALIDATIONS
// =============================================================================

/**
 * Validate that required fields are present for goods receipt
 */
export function validateGoodsReceiptReadiness(
  items: ScanRow[],
  depotId: string
): ValidationResult<ScanRow[]> {
  const errors: string[] = [];

  if (!depotId) {
    errors.push('Depo seçilmeli');
  }

  if (items.length === 0) {
    errors.push('İşlenecek ürün bulunmuyor');
  }

  const unprocessedItems = items.filter(i => !i.isProcessed);

  if (unprocessedItems.length === 0) {
    errors.push('İşlenecek yeni ürün bulunmuyor');
  }

  const itemsWithoutAddress = unprocessedItems.filter(i => !i.rafAdresi);
  if (itemsWithoutAddress.length > 0) {
    errors.push(`${itemsWithoutAddress.length} ürüne adres atanmamış`);
  }

  const itemsWithoutInvoice = unprocessedItems.filter(i => !i.irsaliyeNumarasi);
  if (itemsWithoutInvoice.length > 0) {
    errors.push(`${itemsWithoutInvoice.length} ürüne irsaliye numarası atanmamış`);
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: unprocessedItems };
}

/**
 * Validate expiry date is in the future
 */
export function validateExpiryDate(miad: string): ValidationResult<Date> {
  if (!miad) {
    return { success: true, data: new Date() }; // Empty is allowed
  }

  // Try to parse the date
  let date: Date;

  // Try YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(miad)) {
    date = new Date(miad);
  }
  // Try DD.MM.YYYY format
  else if (/^\d{2}\.\d{2}\.\d{4}$/.test(miad)) {
    const [day, month, year] = miad.split('.');
    date = new Date(`${year}-${month}-${day}`);
  }
  // Try YYYY-MM format
  else if (/^\d{4}-\d{2}$/.test(miad)) {
    date = new Date(`${miad}-01`);
  }
  // Try MM/YYYY format
  else if (/^\d{2}\/\d{4}$/.test(miad)) {
    const [month, year] = miad.split('/');
    date = new Date(`${year}-${month}-01`);
  }
  else {
    return { success: false, errors: ['Miad formatı tanınmıyor'] };
  }

  if (isNaN(date.getTime())) {
    return { success: false, errors: ['Geçersiz tarih'] };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (date < today) {
    return {
      success: false,
      errors: ['Miad tarihi geçmiş'],
    };
  }

  return { success: true, data: date };
}

/**
 * Validate duplicate serial numbers
 */
export function validateNoDuplicateSerials(
  newSerial: string,
  existingSerials: Set<string>,
  sessionSerials: Set<string>
): ValidationResult<string> {
  if (!newSerial) {
    return { success: true, data: '' };
  }

  if (existingSerials.has(newSerial)) {
    return {
      success: false,
      errors: ['Bu seri numarası depoda zaten mevcut'],
    };
  }

  if (sessionSerials.has(newSerial)) {
    return {
      success: false,
      errors: ['Bu seri numarası bu oturumda zaten tarandı'],
    };
  }

  return { success: true, data: newSerial };
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type {
  ScanRow,
  MalKabulLine,
  MalKabulHeader,
  IrsaliyeParseResult,
  LotAddPayload,
  QtyAddPayload,
  StockDocumentData,
} from './types';
