/**
 * @fileoverview Zod validation schemas for Verimlilik (Efficiency) modules
 * @description Provides comprehensive validation for efficiency calculations,
 * statistics, and related data with security checks for XSS, SQL injection,
 * path traversal, and null byte injection.
 * @module lib/verimlilik/validation
 * @version 1.0.0
 */

import { z } from 'zod';

// =============================================================================
// SECURITY PATTERNS
// =============================================================================

/**
 * XSS attack pattern detection
 * Detects common script injection patterns
 */
const XSS_PATTERN = /(<script|javascript:|on\w+\s*=|<iframe|<object|<embed|<link|<style|expression\s*\(|url\s*\()/gi;

/**
 * SQL injection pattern detection
 * Detects common SQL injection attempts
 */
const SQL_INJECTION_PATTERN = /((\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bUNION\b|\bEXEC\b|\bEXECUTE\b)[\s\S]*(\bFROM\b|\bINTO\b|\bWHERE\b|\bTABLE\b|\bDATABASE\b))|(-{2}|;|\bOR\b\s+\d+\s*=\s*\d+|\bAND\b\s+\d+\s*=\s*\d+|'\s*OR\s*'|'\s*AND\s*')/gi;

/**
 * Path traversal pattern detection
 * Detects directory traversal attempts
 */
const PATH_TRAVERSAL_PATTERN = /(\.\.[\/\\]|\.\.%2[fF]|%2[eE]%2[eE]%2[fF]|\.\.%5[cC])/g;

/**
 * Null byte injection pattern detection
 * Detects null byte injection attempts
 */
const NULL_BYTE_PATTERN = /(\x00|%00|\\0|\\x00)/g;

// =============================================================================
// SECURITY TYPES
// =============================================================================

/**
 * Security threat types
 */
export type SecurityThreat = 'xss' | 'sql_injection' | 'path_traversal' | 'null_byte';

/**
 * Security check result
 */
export interface SecurityCheckResult {
  /** Whether the input is safe */
  isSafe: boolean;
  /** Detected threats */
  threats: SecurityThreat[];
  /** Sanitized value */
  sanitizedValue: string;
}

// =============================================================================
// SECURITY FUNCTIONS
// =============================================================================

/**
 * Performs comprehensive security check on a string value
 * @param value - The value to check
 * @param maxLength - Maximum allowed length (default: 500)
 * @returns Security check result with threats and sanitized value
 */
export function securityCheck(value: string, maxLength = 500): SecurityCheckResult {
  const threats: SecurityThreat[] = [];

  // Reset lastIndex for global regex patterns
  XSS_PATTERN.lastIndex = 0;
  SQL_INJECTION_PATTERN.lastIndex = 0;
  PATH_TRAVERSAL_PATTERN.lastIndex = 0;
  NULL_BYTE_PATTERN.lastIndex = 0;

  // Check for XSS
  if (XSS_PATTERN.test(value)) {
    threats.push('xss');
  }

  // Reset and check for SQL injection
  SQL_INJECTION_PATTERN.lastIndex = 0;
  if (SQL_INJECTION_PATTERN.test(value)) {
    threats.push('sql_injection');
  }

  // Reset and check for path traversal
  PATH_TRAVERSAL_PATTERN.lastIndex = 0;
  if (PATH_TRAVERSAL_PATTERN.test(value)) {
    threats.push('path_traversal');
  }

  // Reset and check for null byte injection
  NULL_BYTE_PATTERN.lastIndex = 0;
  if (NULL_BYTE_PATTERN.test(value)) {
    threats.push('null_byte');
  }

  // Sanitize value
  let sanitizedValue = value
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>'"]/g, '') // Remove dangerous characters
    .trim()
    .slice(0, maxLength);

  return {
    isSafe: threats.length === 0,
    threats,
    sanitizedValue,
  };
}

/**
 * Sanitizes a document ID for Firestore
 * @param id - The document ID to sanitize
 * @returns Sanitized document ID
 */
export function sanitizeDocumentId(id: string): string {
  if (!id || typeof id !== 'string') return '';
  return id
    .replace(/[\/\\.#$\[\]]/g, '_')
    .replace(/\s+/g, '_')
    .trim()
    .slice(0, 100);
}

/**
 * Sanitizes a hospital/laboratory ID
 * @param id - The hospital ID to sanitize
 * @returns Sanitized hospital ID
 */
export function sanitizeHospitalId(id: string): string {
  if (!id || typeof id !== 'string') return '';
  return id
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .trim()
    .slice(0, 50);
}

/**
 * Sanitizes a stock code
 * @param code - The stock code to sanitize
 * @returns Sanitized stock code
 */
export function sanitizeStockCode(code: string): string {
  if (!code || typeof code !== 'string') return '';
  return code
    .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ\-_.]/gi, '')
    .trim()
    .slice(0, 50);
}

/**
 * Sanitizes a hospital/laboratory name
 * @param name - The name to sanitize
 * @returns Sanitized name
 */
export function sanitizeHospitalName(name: string): string {
  if (!name || typeof name !== 'string') return '';
  return name
    .replace(/[<>'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Sanitizes a product name
 * @param name - The product name to sanitize
 * @returns Sanitized product name
 */
export function sanitizeProductName(name: string): string {
  if (!name || typeof name !== 'string') return '';
  return name
    .replace(/[<>'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Sanitizes a numeric value
 * @param value - The value to sanitize
 * @param min - Minimum allowed value (default: 0)
 * @param max - Maximum allowed value (default: 1000000)
 * @returns Sanitized numeric value
 */
export function sanitizeNumber(
  value: unknown,
  min = 0,
  max = 1000000
): number {
  if (value === null || value === undefined || value === '') return 0;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return 0;
  return Math.max(min, Math.min(max, num));
}

/**
 * Sanitizes a percentage value
 * @param value - The value to sanitize
 * @returns Sanitized percentage (0-100)
 */
export function sanitizePercentage(value: unknown): number {
  return sanitizeNumber(value, 0, 100);
}

/**
 * Sanitizes a general string
 * @param value - The value to sanitize
 * @param maxLength - Maximum length (default: 500)
 * @returns Sanitized string
 */
export function sanitizeString(value: unknown, maxLength = 500): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

// =============================================================================
// BASIC ZOD SCHEMAS
// =============================================================================

/**
 * Schema for validating month (0-11)
 */
export const MonthSchema = z.number().int().min(0).max(11);

/**
 * Schema for validating year
 */
export const YearSchema = z.number().int().min(2000).max(2100);

/**
 * Schema for validating currency
 */
export const CurrencySchema = z.enum(['TRY', 'USD', 'EUR']);

/**
 * Schema for validating sort direction
 */
export const SortDirectionSchema = z.enum(['asc', 'desc']);

/**
 * Schema for validating Column 22 mode
 */
export const Column22ModeSchema = z.enum(['kumulatif', 'hakedis']);

// =============================================================================
// EFFICIENCY ROW SCHEMAS
// =============================================================================

/**
 * Schema for efficiency row data
 */
export const EfficiencyRowSchema = z.object({
  productId: z.string().min(1).max(50),
  productName: z.string().min(1).max(200),
  packageTests: z.number().int().min(0).max(100000),
  packageSize: z.number().int().min(1).max(1000).optional(),
  consumption: z.number().min(0).max(10000000),
  carryOverPrev: z.number().min(0).max(10000000),
  total: z.number().min(0).max(10000000),
  rerun: z.number().min(0).max(10000000),
  routine: z.number().min(0).max(10000000),
  control: z.number().min(0).max(10000000),
  calib: z.number().min(0).max(10000000),
  eomDeviceOn: z.number().min(0).max(10000000),
  knownLoss: z.number().min(0).max(10000000),
  unknownLoss: z.number().min(0).max(10000000),
  unknownLossBoxes: z.number().min(0).max(1000000),
  deviceEffPct: z.number().min(0).max(100),
  kitEffPct: z.number().min(0).max(100),
});

/**
 * Schema for total efficiency table row
 */
export const TotalEfficiencyRowSchema = z.object({
  id: z.string().min(1).max(150),
  labId: z.string().min(1).max(50),
  labName: z.string().min(1).max(200),
  labKod: z.string().max(50).optional().default(''),
  stokKodu: z.string().min(1).max(50),
  stokAdi: z.string().min(1).max(200),
  testAdi: z.string().max(200).optional().default(''),
  ambalajDegeri: z.number().int().min(0).max(100000),
  cihazGrubu: z.string().max(100).optional().default(''),
  baslangicStokuKutu: z.number().min(0).max(10000000),
  ayBasiCihazUstuTest: z.number().min(0).max(10000000),
  totalAyBasiStok: z.number().min(0).max(10000000),
  ayBasiSevkiyatKutu: z.number().min(0).max(10000000),
  goztepeSevkiyat: z.number().min(0).max(10000000),
  kurumlarArasiSevk: z.number().min(0).max(10000000),
  kurumlarArasiSevkKaynakLabId: z.string().max(50).optional(),
  lojistikAraTransfer: z.number().min(0).max(10000000),
  sevkiyatlarSonrasiTotalTest: z.number().min(0).max(10000000),
  kumulatifTotal: z.number().min(0).max(10000000),
  donemSonuStokKutu: z.number().min(0).max(10000000),
  donemSonuCihazUstuTest: z.number().min(0).max(10000000),
  donemSonuToplamTest: z.number().min(0).max(10000000),
  hakEdis: z.number().min(0).max(10000000),
  stokDogrulukFark: z.number(),
  stokDogrulukYuzde: z.number(),
  kitVerimlilikFark: z.number(),
  kitVerimlilikYuzde: z.number(),
});

/**
 * Schema for efficiency metrics
 */
export const EfficiencyMetricsSchema = z.object({
  toplamKumulatif: z.number().min(0),
  toplamBeklenenTuketim: z.number().min(0),
  toplamHakEdis: z.number().min(0),
  stokSapmaYuzde: z.number(),
  kitSapmaYuzde: z.number(),
  stokDogrulukSkoru: z.number().min(0).max(100),
  kitVerimlilikSkoru: z.number().min(0).max(100),
  genelVerimlilik: z.number().min(0).max(100),
  toplamEtkiDegeri: z.number().min(0).default(0),
  maliyetAgirlikli: z.boolean().default(false),
  hesaplananSatirSayisi: z.number().int().min(0).default(0),
  algoritma: z.literal('value-impact-efficiency-index').default('value-impact-efficiency-index'),
});

// =============================================================================
// HISTORY RECORD SCHEMAS
// =============================================================================

/**
 * Schema for efficiency history record
 */
export const EfficiencyHistoryRecordSchema = z.object({
  id: z.string().min(1).max(100),
  hospitalId: z.string().min(1).max(50),
  hospitalName: z.string().min(1).max(200),
  month: MonthSchema,
  year: YearSchema,
  lastUpdated: z.date().optional(),
  rows: z.array(EfficiencyRowSchema),
});

/**
 * Schema for total efficiency record
 */
export const TotalEfficiencyRecordSchema = z.object({
  id: z.string().min(1).max(100),
  poolId: z.string().min(1).max(50),
  poolName: z.string().min(1).max(200),
  month: MonthSchema,
  year: YearSchema,
  rows: z.array(TotalEfficiencyRowSchema),
  createdAt: z.object({
    seconds: z.number(),
    nanoseconds: z.number(),
  }).nullable(),
  createdByName: z.string().max(100),
  efficiencyMetrics: EfficiencyMetricsSchema.optional(),
});

// =============================================================================
// FILTER AND SORT SCHEMAS
// =============================================================================

/**
 * Schema for sort configuration
 */
export const SortConfigSchema = z.object({
  column: z.enum(['stokDogrulukFark', 'kitVerimlilikFark']).nullable(),
  direction: SortDirectionSchema,
});

/**
 * Schema for date range
 */
export const DateRangeSchema = z.object({
  from: z.date().optional(),
  to: z.date().optional(),
}).refine(
  (data) => {
    if (data.from && data.to) {
      return data.from <= data.to;
    }
    return true;
  },
  { message: 'Start date must be before or equal to end date' }
);

// =============================================================================
// HAK EDİŞ SCHEMAS
// =============================================================================

/**
 * Schema for Hak Ediş definition
 */
export const HakEdisDefinitionSchema = z.object({
  id: z.string().min(1).max(50),
  sutKodu: z.string().min(1).max(50),
  sutTestAdi: z.string().min(1).max(200),
  linkedStokKodu: z.string().min(1).max(50),
  hakEdisMiktari: z.number().min(0),
});

// =============================================================================
// COST SCHEMAS
// =============================================================================

/**
 * Schema for cost checkpoint
 */
export const CostCheckpointSchema = z.object({
  id: z.string().min(1).max(50),
  year: YearSchema,
  month: MonthSchema,
  createdAt: z.date(),
});

/**
 * Schema for product cost
 */
export const ProductCostSchema = z.object({
  cost: z.number().min(0),
  currency: CurrencySchema,
});

/**
 * Schema for exchange rates
 */
export const ExchangeRatesSchema = z.object({
  EUR: z.number().positive(),
  USD: z.number().positive(),
  TRY: z.number().positive(),
});

// =============================================================================
// INTER-LAB TRANSFER SCHEMAS
// =============================================================================

/**
 * Schema for inter-lab transfer
 */
export const InterLabTransferSchema = z.object({
  sourceLabId: z.string().min(1).max(50),
  sourceLabName: z.string().min(1).max(200),
  kutuAdet: z.number().int().min(0).max(100000),
});

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validates efficiency row data
 * @param data - The data to validate
 * @returns Validation result with success flag, data or errors
 */
export function validateEfficiencyRow(data: unknown): {
  success: boolean;
  data?: z.infer<typeof EfficiencyRowSchema>;
  errors?: z.ZodError;
} {
  try {
    const validatedData = EfficiencyRowSchema.parse(data);
    return { success: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error };
    }
    throw error;
  }
}

/**
 * Validates total efficiency row data
 * @param data - The data to validate
 * @returns Validation result with success flag, data or errors
 */
export function validateTotalEfficiencyRow(data: unknown): {
  success: boolean;
  data?: z.infer<typeof TotalEfficiencyRowSchema>;
  errors?: z.ZodError;
} {
  try {
    const validatedData = TotalEfficiencyRowSchema.parse(data);
    return { success: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error };
    }
    throw error;
  }
}

/**
 * Validates efficiency metrics data
 * @param data - The data to validate
 * @returns Validation result with success flag, data or errors
 */
export function validateEfficiencyMetrics(data: unknown): {
  success: boolean;
  data?: z.infer<typeof EfficiencyMetricsSchema>;
  errors?: z.ZodError;
} {
  try {
    const validatedData = EfficiencyMetricsSchema.parse(data);
    return { success: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error };
    }
    throw error;
  }
}

/**
 * Validates date range
 * @param data - The date range to validate
 * @returns Validation result with success flag, data or errors
 */
export function validateDateRange(data: unknown): {
  success: boolean;
  data?: z.infer<typeof DateRangeSchema>;
  errors?: z.ZodError;
} {
  try {
    const validatedData = DateRangeSchema.parse(data);
    return { success: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error };
    }
    throw error;
  }
}

/**
 * Validates exchange rates
 * @param data - The exchange rates to validate
 * @returns Validation result with success flag, data or errors
 */
export function validateExchangeRates(data: unknown): {
  success: boolean;
  data?: z.infer<typeof ExchangeRatesSchema>;
  errors?: z.ZodError;
} {
  try {
    const validatedData = ExchangeRatesSchema.parse(data);
    return { success: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error };
    }
    throw error;
  }
}

// =============================================================================
// BUSINESS LOGIC FUNCTIONS
// =============================================================================

/**
 * Calculates weighted efficiency from rows
 * @param rows - Array of efficiency rows
 * @returns Weighted efficiency percentage (0-100)
 */
export function calculateWeightedEfficiency(
  rows: Array<{
    kitEffPct?: number;
    carryOverPrev?: number;
    consumption?: number;
    eomDeviceOn?: number;
    anaTuketimTestAdeti?: number;
  }>
): number {
  if (!rows || rows.length === 0) return 0;

  let totalWeightedEfficiency = 0;
  let totalConsumption = 0;

  for (const row of rows) {
    const anaTuketim =
      row.anaTuketimTestAdeti ??
      (row.carryOverPrev || 0) + (row.consumption || 0) - (row.eomDeviceOn || 0);

    if (anaTuketim > 0) {
      totalWeightedEfficiency += (row.kitEffPct || 0) * anaTuketim;
      totalConsumption += anaTuketim;
    }
  }

  if (totalConsumption === 0) return 0;
  return Math.max(0, totalWeightedEfficiency / totalConsumption);
}

/**
 * Calculates efficiency metrics from total efficiency rows
 * @param rows - Array of total efficiency table rows
 * @returns Efficiency metrics summary
 */
export function calculateEfficiencyMetrics(
  rows: Array<{
    kumulatifTotal: number;
    sevkiyatlarSonrasiTotalTest: number;
    donemSonuToplamTest: number;
    hakEdis: number;
    stokDogrulukFark: number;
    kitVerimlilikFark: number;
  }>
): z.infer<typeof EfficiencyMetricsSchema> {
  if (!rows || rows.length === 0) {
    return {
      toplamKumulatif: 0,
      toplamBeklenenTuketim: 0,
      toplamHakEdis: 0,
      stokSapmaYuzde: 0,
      kitSapmaYuzde: 0,
      stokDogrulukSkoru: 100,
      kitVerimlilikSkoru: 100,
      genelVerimlilik: 100,
      toplamEtkiDegeri: 0,
      maliyetAgirlikli: false,
      hesaplananSatirSayisi: 0,
      algoritma: 'value-impact-efficiency-index',
    };
  }

  const clampScore = (value: number) => Math.max(0, Math.min(100, value));
  const deviationToScore = (deviation: number, denominator: number) => {
    if (denominator <= 0) return 100;
    return clampScore(100 - (Math.abs(deviation) / denominator) * 100);
  };

  let toplamKumulatif = 0;
  let toplamBeklenenTuketim = 0;
  let toplamHakEdis = 0;
  let toplamEtkiDegeri = 0;
  let weightedStockScore = 0;
  let weightedKitScore = 0;
  let weightedGeneralScore = 0;
  let hesaplananSatirSayisi = 0;

  rows.forEach(row => {
    const beklenenTuketim = row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest;
    const volume = Math.max(0, row.kumulatifTotal || 0);
    const stockScore = deviationToScore(row.stokDogrulukFark, volume);
    const kitScore = deviationToScore(row.kitVerimlilikFark, volume);
    const generalScore = (stockScore + kitScore) / 2;

    toplamKumulatif += row.kumulatifTotal;
    toplamBeklenenTuketim += beklenenTuketim;
    toplamHakEdis += row.hakEdis;

    if (volume <= 0) return;

    toplamEtkiDegeri += volume;
    weightedStockScore += stockScore * volume;
    weightedKitScore += kitScore * volume;
    weightedGeneralScore += generalScore * volume;
    hesaplananSatirSayisi += 1;
  });

  const stokSapmaYuzde = toplamKumulatif !== 0
    ? ((toplamBeklenenTuketim - toplamKumulatif) / toplamKumulatif) * 100
    : 0;

  const kitSapmaYuzde = toplamKumulatif !== 0
    ? ((toplamKumulatif - toplamHakEdis) / toplamKumulatif) * 100
    : 0;

  if (toplamEtkiDegeri === 0) {
    return {
      toplamKumulatif,
      toplamBeklenenTuketim,
      toplamHakEdis,
      stokSapmaYuzde,
      kitSapmaYuzde,
      stokDogrulukSkoru: 100,
      kitVerimlilikSkoru: 100,
      genelVerimlilik: 100,
      toplamEtkiDegeri: 0,
      maliyetAgirlikli: false,
      hesaplananSatirSayisi: 0,
      algoritma: 'value-impact-efficiency-index',
    };
  }

  return {
    toplamKumulatif,
    toplamBeklenenTuketim,
    toplamHakEdis,
    stokSapmaYuzde,
    kitSapmaYuzde,
    stokDogrulukSkoru: weightedStockScore / toplamEtkiDegeri,
    kitVerimlilikSkoru: weightedKitScore / toplamEtkiDegeri,
    genelVerimlilik: weightedGeneralScore / toplamEtkiDegeri,
    toplamEtkiDegeri,
    maliyetAgirlikli: false,
    hesaplananSatirSayisi,
    algoritma: 'value-impact-efficiency-index',
  };
}

/**
 * Calculates stock accuracy difference (Column 20)
 * @param sevkiyatlarSonrasiTotalTest - Total tests after shipments
 * @param donemSonuToplamTest - Period end total tests
 * @param kumulatifTotal - Cumulative total
 * @returns Stock accuracy difference
 */
export function calculateStokDogrulukFark(
  sevkiyatlarSonrasiTotalTest: number,
  donemSonuToplamTest: number,
  kumulatifTotal: number
): number {
  return sevkiyatlarSonrasiTotalTest - donemSonuToplamTest - kumulatifTotal;
}

/**
 * Calculates kit efficiency difference (Column 21)
 * @param kumulatifTotal - Cumulative total
 * @param hakEdis - Earned amount
 * @returns Kit efficiency difference
 */
export function calculateKitVerimlilikFark(
  kumulatifTotal: number,
  hakEdis: number
): number {
  return kumulatifTotal - hakEdis;
}

/**
 * Calculates deviation percentage
 * @param fark - Difference value
 * @param base - Base value for percentage calculation
 * @returns Deviation percentage
 */
export function calculateDeviationPercentage(fark: number, base: number): number {
  if (base === 0) return 0;
  return (fark / base) * 100;
}

/**
 * Calculates box loss (Column 22)
 * @param testFark - Test difference
 * @param ambalajDegeri - Package size
 * @returns Box loss value
 */
export function calculateBoxLoss(testFark: number, ambalajDegeri: number): number {
  if (ambalajDegeri <= 0) return 0;
  return testFark / ambalajDegeri;
}

/**
 * Gets efficiency color class based on score
 * @param score - Efficiency score (0-100)
 * @returns Tailwind CSS color class
 */
export function getEfficiencyColorClass(score: number): string {
  if (score >= 90) return 'text-green-600';
  if (score >= 70) return 'text-yellow-600';
  if (score >= 50) return 'text-orange-600';
  return 'text-red-600';
}

/**
 * Gets efficiency background color class based on score
 * @param score - Efficiency score (0-100)
 * @returns Tailwind CSS background color class
 */
export function getEfficiencyBgColorClass(score: number): string {
  if (score >= 90) return 'text-green-500';
  if (score >= 70) return 'text-yellow-500';
  if (score >= 50) return 'text-orange-500';
  return 'text-red-500';
}

/**
 * Formats a number for display in Turkish locale
 * @param value - The number to format
 * @param fractionDigits - Number of fraction digits (default: 0)
 * @returns Formatted number string
 */
export function formatNumberTR(value: number, fractionDigits = 0): string {
  return value.toLocaleString('tr-TR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * Formats a percentage for display
 * @param value - The percentage value
 * @param fractionDigits - Number of fraction digits (default: 1)
 * @returns Formatted percentage string
 */
export function formatPercentage(value: number, fractionDigits = 1): string {
  return `%${value.toFixed(fractionDigits)}`;
}

/**
 * Validates and sanitizes period key (MM-YYYY format)
 * @param periodKey - The period key to validate
 * @returns Sanitized period key or empty string
 */
export function validatePeriodKey(periodKey: string): string {
  if (!periodKey || typeof periodKey !== 'string') return '';
  const match = periodKey.match(/^(\d{2})-(\d{4})$/);
  if (!match) return '';
  const month = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return '';
  return periodKey;
}

/**
 * Generates period key from month and year
 * @param month - Month (0-11)
 * @param year - Year
 * @returns Period key in MM-YYYY format
 */
export function generatePeriodKey(month: number, year: number): string {
  const validMonth = MonthSchema.safeParse(month);
  const validYear = YearSchema.safeParse(year);
  if (!validMonth.success || !validYear.success) return '';
  return `${String(month + 1).padStart(2, '0')}-${year}`;
}
