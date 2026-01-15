/**
 * @fileoverview Comprehensive unit tests for Verimlilik validation module
 * @description Tests security checks, sanitization functions, Zod schemas,
 * validation functions, and business logic calculations.
 * @module tests/verimlilik/validation.test
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  securityCheck,
  sanitizeDocumentId,
  sanitizeHospitalId,
  sanitizeStockCode,
  sanitizeHospitalName,
  sanitizeProductName,
  sanitizeNumber,
  sanitizePercentage,
  sanitizeString,
  MonthSchema,
  YearSchema,
  CurrencySchema,
  SortDirectionSchema,
  Column22ModeSchema,
  EfficiencyRowSchema,
  TotalEfficiencyRowSchema,
  EfficiencyMetricsSchema,
  DateRangeSchema,
  ExchangeRatesSchema,
  InterLabTransferSchema,
  validateEfficiencyRow,
  validateTotalEfficiencyRow,
  validateEfficiencyMetrics,
  validateDateRange,
  validateExchangeRates,
  calculateWeightedEfficiency,
  calculateEfficiencyMetrics,
  calculateStokDogrulukFark,
  calculateKitVerimlilikFark,
  calculateDeviationPercentage,
  calculateBoxLoss,
  getEfficiencyColorClass,
  getEfficiencyBgColorClass,
  formatNumberTR,
  formatPercentage,
  validatePeriodKey,
  generatePeriodKey,
} from '../../src/lib/verimlilik/validation';

// =============================================================================
// SECURITY CHECK TESTS
// =============================================================================

describe('securityCheck', () => {
  beforeEach(() => {
    // Reset any global state if needed
  });

  it('should detect XSS attacks with script tags', () => {
    const result = securityCheck('<script>alert("xss")</script>');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('xss'));
  });

  it('should detect XSS attacks with javascript: protocol', () => {
    const result = securityCheck('javascript:alert(1)');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('xss'));
  });

  it('should detect XSS attacks with onclick events', () => {
    const result = securityCheck('<div onclick="evil()">click</div>');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('xss'));
  });

  it('should detect SQL injection with SELECT statements', () => {
    const result = securityCheck("SELECT * FROM users WHERE 1=1");
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('sql_injection'));
  });

  it('should detect SQL injection with OR 1=1', () => {
    const result = securityCheck("' OR 1=1 --");
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('sql_injection'));
  });

  it('should detect SQL injection with UNION', () => {
    const result = securityCheck("UNION SELECT password FROM users");
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('sql_injection'));
  });

  it('should detect path traversal attacks', () => {
    const result = securityCheck('../../../etc/passwd');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('path_traversal'));
  });

  it('should detect URL-encoded path traversal', () => {
    const result = securityCheck('%2e%2e%2fetc/passwd');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('path_traversal'));
  });

  it('should detect null byte injection', () => {
    const result = securityCheck('file.txt\x00.jpg');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('null_byte'));
  });

  it('should detect URL-encoded null bytes', () => {
    const result = securityCheck('file.txt%00.jpg');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('null_byte'));
  });

  it('should pass safe strings', () => {
    const result = securityCheck('Normal laboratory name 2024');
    assert.strictEqual(result.isSafe, true);
    assert.strictEqual(result.threats.length, 0);
  });

  it('should pass Turkish characters', () => {
    const result = securityCheck('Ankara Üniversitesi Tıp Fakültesi Laboratuvarı');
    assert.strictEqual(result.isSafe, true);
    assert.strictEqual(result.threats.length, 0);
  });

  it('should truncate long strings', () => {
    const longString = 'a'.repeat(1000);
    const result = securityCheck(longString, 100);
    assert.strictEqual(result.sanitizedValue.length, 100);
  });

  it('should sanitize HTML tags from output', () => {
    const result = securityCheck('<b>bold text</b>');
    assert.ok(!result.sanitizedValue.includes('<'));
    assert.ok(!result.sanitizedValue.includes('>'));
  });

  it('should handle multiple threats simultaneously', () => {
    const result = securityCheck('<script>SELECT * FROM ../users</script>');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('xss'));
    assert.ok(result.threats.includes('sql_injection') || result.threats.includes('path_traversal'));
  });
});

// =============================================================================
// SANITIZATION FUNCTION TESTS
// =============================================================================

describe('sanitizeDocumentId', () => {
  it('should remove forward slashes', () => {
    assert.strictEqual(sanitizeDocumentId('path/to/doc'), 'path_to_doc');
  });

  it('should remove backslashes', () => {
    assert.strictEqual(sanitizeDocumentId('path\\to\\doc'), 'path_to_doc');
  });

  it('should remove dots', () => {
    assert.strictEqual(sanitizeDocumentId('doc.name'), 'doc_name');
  });

  it('should replace spaces with underscores', () => {
    assert.strictEqual(sanitizeDocumentId('doc name'), 'doc_name');
  });

  it('should truncate to 100 characters', () => {
    const longId = 'a'.repeat(150);
    assert.strictEqual(sanitizeDocumentId(longId).length, 100);
  });

  it('should return empty string for null/undefined', () => {
    assert.strictEqual(sanitizeDocumentId(null as any), '');
    assert.strictEqual(sanitizeDocumentId(undefined as any), '');
  });
});

describe('sanitizeHospitalId', () => {
  it('should keep alphanumeric characters', () => {
    assert.strictEqual(sanitizeHospitalId('hospital123'), 'hospital123');
  });

  it('should keep underscores and hyphens', () => {
    assert.strictEqual(sanitizeHospitalId('hospital_id-123'), 'hospital_id-123');
  });

  it('should remove special characters', () => {
    assert.strictEqual(sanitizeHospitalId('hospital@#$%'), 'hospital');
  });

  it('should truncate to 50 characters', () => {
    const longId = 'a'.repeat(100);
    assert.strictEqual(sanitizeHospitalId(longId).length, 50);
  });
});

describe('sanitizeStockCode', () => {
  it('should keep alphanumeric and Turkish characters', () => {
    assert.strictEqual(sanitizeStockCode('ÜRÜN123'), 'ÜRÜN123');
  });

  it('should keep hyphens, underscores, dots', () => {
    assert.strictEqual(sanitizeStockCode('CODE-123_A.1'), 'CODE-123_A.1');
  });

  it('should remove angle brackets', () => {
    assert.strictEqual(sanitizeStockCode('<CODE>'), 'CODE');
  });
});

describe('sanitizeHospitalName', () => {
  it('should remove angle brackets and quotes', () => {
    assert.strictEqual(sanitizeHospitalName('<Hospital "Name">'), 'Hospital Name');
  });

  it('should normalize spaces', () => {
    assert.strictEqual(sanitizeHospitalName('Hospital   Name'), 'Hospital Name');
  });

  it('should truncate to 200 characters', () => {
    const longName = 'a'.repeat(300);
    assert.strictEqual(sanitizeHospitalName(longName).length, 200);
  });
});

describe('sanitizeProductName', () => {
  it('should remove dangerous characters', () => {
    assert.strictEqual(sanitizeProductName("Product '<Name>\""), 'Product Name');
  });

  it('should preserve Turkish characters', () => {
    assert.strictEqual(sanitizeProductName('Ürün İsmi Özel'), 'Ürün İsmi Özel');
  });
});

describe('sanitizeNumber', () => {
  it('should return number as-is when in range', () => {
    assert.strictEqual(sanitizeNumber(50), 50);
  });

  it('should clamp to minimum', () => {
    assert.strictEqual(sanitizeNumber(-10, 0, 100), 0);
  });

  it('should clamp to maximum', () => {
    assert.strictEqual(sanitizeNumber(150, 0, 100), 100);
  });

  it('should parse string numbers', () => {
    assert.strictEqual(sanitizeNumber('42'), 42);
  });

  it('should return 0 for invalid input', () => {
    assert.strictEqual(sanitizeNumber('invalid'), 0);
    assert.strictEqual(sanitizeNumber(null), 0);
    assert.strictEqual(sanitizeNumber(undefined), 0);
    assert.strictEqual(sanitizeNumber(''), 0);
  });

  it('should handle NaN', () => {
    assert.strictEqual(sanitizeNumber(NaN), 0);
  });
});

describe('sanitizePercentage', () => {
  it('should clamp to 0-100 range', () => {
    assert.strictEqual(sanitizePercentage(-10), 0);
    assert.strictEqual(sanitizePercentage(150), 100);
    assert.strictEqual(sanitizePercentage(75), 75);
  });
});

describe('sanitizeString', () => {
  it('should remove angle brackets', () => {
    assert.strictEqual(sanitizeString('<script>'), 'script');
  });

  it('should trim whitespace', () => {
    assert.strictEqual(sanitizeString('  text  '), 'text');
  });

  it('should truncate to max length', () => {
    const result = sanitizeString('a'.repeat(100), 50);
    assert.strictEqual(result.length, 50);
  });

  it('should handle null/undefined', () => {
    assert.strictEqual(sanitizeString(null), '');
    assert.strictEqual(sanitizeString(undefined), '');
  });
});

// =============================================================================
// ZOD SCHEMA TESTS
// =============================================================================

describe('MonthSchema', () => {
  it('should accept valid months 0-11', () => {
    for (let i = 0; i <= 11; i++) {
      const result = MonthSchema.safeParse(i);
      assert.strictEqual(result.success, true);
    }
  });

  it('should reject invalid months', () => {
    assert.strictEqual(MonthSchema.safeParse(-1).success, false);
    assert.strictEqual(MonthSchema.safeParse(12).success, false);
    assert.strictEqual(MonthSchema.safeParse(1.5).success, false);
  });
});

describe('YearSchema', () => {
  it('should accept valid years', () => {
    assert.strictEqual(YearSchema.safeParse(2024).success, true);
    assert.strictEqual(YearSchema.safeParse(2000).success, true);
    assert.strictEqual(YearSchema.safeParse(2100).success, true);
  });

  it('should reject invalid years', () => {
    assert.strictEqual(YearSchema.safeParse(1999).success, false);
    assert.strictEqual(YearSchema.safeParse(2101).success, false);
  });
});

describe('CurrencySchema', () => {
  it('should accept valid currencies', () => {
    assert.strictEqual(CurrencySchema.safeParse('TRY').success, true);
    assert.strictEqual(CurrencySchema.safeParse('USD').success, true);
    assert.strictEqual(CurrencySchema.safeParse('EUR').success, true);
  });

  it('should reject invalid currencies', () => {
    assert.strictEqual(CurrencySchema.safeParse('GBP').success, false);
    assert.strictEqual(CurrencySchema.safeParse('invalid').success, false);
  });
});

describe('SortDirectionSchema', () => {
  it('should accept valid directions', () => {
    assert.strictEqual(SortDirectionSchema.safeParse('asc').success, true);
    assert.strictEqual(SortDirectionSchema.safeParse('desc').success, true);
  });

  it('should reject invalid directions', () => {
    assert.strictEqual(SortDirectionSchema.safeParse('up').success, false);
  });
});

describe('Column22ModeSchema', () => {
  it('should accept valid modes', () => {
    assert.strictEqual(Column22ModeSchema.safeParse('kumulatif').success, true);
    assert.strictEqual(Column22ModeSchema.safeParse('hakedis').success, true);
  });

  it('should reject invalid modes', () => {
    assert.strictEqual(Column22ModeSchema.safeParse('invalid').success, false);
  });
});

describe('EfficiencyRowSchema', () => {
  it('should accept valid efficiency row', () => {
    const validRow = {
      productId: 'PROD001',
      productName: 'Test Product',
      packageTests: 100,
      consumption: 500,
      carryOverPrev: 50,
      total: 600,
      rerun: 10,
      routine: 550,
      control: 20,
      calib: 15,
      eomDeviceOn: 30,
      knownLoss: 45,
      unknownLoss: 5,
      unknownLossBoxes: 1,
      deviceEffPct: 95.5,
      kitEffPct: 92.3,
    };
    const result = EfficiencyRowSchema.safeParse(validRow);
    assert.strictEqual(result.success, true);
  });

  it('should reject row with missing required fields', () => {
    const invalidRow = {
      productId: 'PROD001',
      // missing other required fields
    };
    const result = EfficiencyRowSchema.safeParse(invalidRow);
    assert.strictEqual(result.success, false);
  });

  it('should reject row with negative values', () => {
    const invalidRow = {
      productId: 'PROD001',
      productName: 'Test',
      packageTests: -100, // invalid
      consumption: 0,
      carryOverPrev: 0,
      total: 0,
      rerun: 0,
      routine: 0,
      control: 0,
      calib: 0,
      eomDeviceOn: 0,
      knownLoss: 0,
      unknownLoss: 0,
      unknownLossBoxes: 0,
      deviceEffPct: 0,
      kitEffPct: 0,
    };
    const result = EfficiencyRowSchema.safeParse(invalidRow);
    assert.strictEqual(result.success, false);
  });
});

describe('EfficiencyMetricsSchema', () => {
  it('should accept valid metrics', () => {
    const validMetrics = {
      toplamKumulatif: 10000,
      toplamBeklenenTuketim: 9500,
      toplamHakEdis: 9000,
      stokSapmaYuzde: 2.5,
      kitSapmaYuzde: 3.0,
      stokDogrulukSkoru: 97.5,
      kitVerimlilikSkoru: 97.0,
      genelVerimlilik: 97.25,
    };
    const result = EfficiencyMetricsSchema.safeParse(validMetrics);
    assert.strictEqual(result.success, true);
  });

  it('should reject metrics with scores over 100', () => {
    const invalidMetrics = {
      toplamKumulatif: 10000,
      toplamBeklenenTuketim: 9500,
      toplamHakEdis: 9000,
      stokSapmaYuzde: 2.5,
      kitSapmaYuzde: 3.0,
      stokDogrulukSkoru: 105, // invalid
      kitVerimlilikSkoru: 97.0,
      genelVerimlilik: 97.25,
    };
    const result = EfficiencyMetricsSchema.safeParse(invalidMetrics);
    assert.strictEqual(result.success, false);
  });
});

describe('DateRangeSchema', () => {
  it('should accept valid date range', () => {
    const validRange = {
      from: new Date('2024-01-01'),
      to: new Date('2024-12-31'),
    };
    const result = DateRangeSchema.safeParse(validRange);
    assert.strictEqual(result.success, true);
  });

  it('should accept partial date range', () => {
    const partialRange = { from: new Date('2024-01-01') };
    const result = DateRangeSchema.safeParse(partialRange);
    assert.strictEqual(result.success, true);
  });

  it('should reject invalid date range (from > to)', () => {
    const invalidRange = {
      from: new Date('2024-12-31'),
      to: new Date('2024-01-01'),
    };
    const result = DateRangeSchema.safeParse(invalidRange);
    assert.strictEqual(result.success, false);
  });
});

describe('ExchangeRatesSchema', () => {
  it('should accept valid rates', () => {
    const validRates = {
      EUR: 1,
      USD: 1.08,
      TRY: 38.5,
    };
    const result = ExchangeRatesSchema.safeParse(validRates);
    assert.strictEqual(result.success, true);
  });

  it('should reject zero or negative rates', () => {
    const invalidRates = {
      EUR: 1,
      USD: 0,
      TRY: -1,
    };
    const result = ExchangeRatesSchema.safeParse(invalidRates);
    assert.strictEqual(result.success, false);
  });
});

describe('InterLabTransferSchema', () => {
  it('should accept valid transfer', () => {
    const validTransfer = {
      sourceLabId: 'LAB001',
      sourceLabName: 'Source Laboratory',
      kutuAdet: 10,
    };
    const result = InterLabTransferSchema.safeParse(validTransfer);
    assert.strictEqual(result.success, true);
  });

  it('should reject negative box count', () => {
    const invalidTransfer = {
      sourceLabId: 'LAB001',
      sourceLabName: 'Source Laboratory',
      kutuAdet: -5,
    };
    const result = InterLabTransferSchema.safeParse(invalidTransfer);
    assert.strictEqual(result.success, false);
  });
});

// =============================================================================
// VALIDATION FUNCTION TESTS
// =============================================================================

describe('validateEfficiencyRow', () => {
  it('should return success for valid row', () => {
    const validRow = {
      productId: 'PROD001',
      productName: 'Test Product',
      packageTests: 100,
      consumption: 500,
      carryOverPrev: 50,
      total: 600,
      rerun: 10,
      routine: 550,
      control: 20,
      calib: 15,
      eomDeviceOn: 30,
      knownLoss: 45,
      unknownLoss: 5,
      unknownLossBoxes: 1,
      deviceEffPct: 95.5,
      kitEffPct: 92.3,
    };
    const result = validateEfficiencyRow(validRow);
    assert.strictEqual(result.success, true);
    assert.ok(result.data);
  });

  it('should return errors for invalid row', () => {
    const result = validateEfficiencyRow({ invalid: 'data' });
    assert.strictEqual(result.success, false);
    assert.ok(result.errors);
  });
});

describe('validateEfficiencyMetrics', () => {
  it('should return success for valid metrics', () => {
    const validMetrics = {
      toplamKumulatif: 10000,
      toplamBeklenenTuketim: 9500,
      toplamHakEdis: 9000,
      stokSapmaYuzde: 2.5,
      kitSapmaYuzde: 3.0,
      stokDogrulukSkoru: 97.5,
      kitVerimlilikSkoru: 97.0,
      genelVerimlilik: 97.25,
    };
    const result = validateEfficiencyMetrics(validMetrics);
    assert.strictEqual(result.success, true);
  });
});

describe('validateDateRange', () => {
  it('should return success for valid range', () => {
    const result = validateDateRange({
      from: new Date('2024-01-01'),
      to: new Date('2024-12-31'),
    });
    assert.strictEqual(result.success, true);
  });
});

describe('validateExchangeRates', () => {
  it('should return success for valid rates', () => {
    const result = validateExchangeRates({
      EUR: 1,
      USD: 1.08,
      TRY: 38.5,
    });
    assert.strictEqual(result.success, true);
  });
});

// =============================================================================
// BUSINESS LOGIC FUNCTION TESTS
// =============================================================================

describe('calculateWeightedEfficiency', () => {
  it('should return 0 for empty array', () => {
    assert.strictEqual(calculateWeightedEfficiency([]), 0);
  });

  it('should return 0 for null/undefined', () => {
    assert.strictEqual(calculateWeightedEfficiency(null as any), 0);
    assert.strictEqual(calculateWeightedEfficiency(undefined as any), 0);
  });

  it('should calculate weighted efficiency correctly', () => {
    const rows = [
      { kitEffPct: 90, carryOverPrev: 100, consumption: 400, eomDeviceOn: 50, anaTuketimTestAdeti: 450 },
      { kitEffPct: 80, carryOverPrev: 50, consumption: 200, eomDeviceOn: 25, anaTuketimTestAdeti: 225 },
    ];
    const result = calculateWeightedEfficiency(rows);
    // (90 * 450 + 80 * 225) / (450 + 225) = (40500 + 18000) / 675 = 86.67
    assert.ok(result > 86 && result < 87);
  });

  it('should return 0 when total consumption is 0', () => {
    const rows = [
      { kitEffPct: 90, carryOverPrev: 0, consumption: 0, eomDeviceOn: 0 },
    ];
    assert.strictEqual(calculateWeightedEfficiency(rows), 0);
  });
});

describe('calculateEfficiencyMetrics', () => {
  it('should return default metrics for empty array', () => {
    const result = calculateEfficiencyMetrics([]);
    assert.strictEqual(result.toplamKumulatif, 0);
    assert.strictEqual(result.genelVerimlilik, 100);
  });

  it('should calculate metrics correctly', () => {
    const rows = [
      {
        kumulatifTotal: 1000,
        sevkiyatlarSonrasiTotalTest: 1100,
        donemSonuToplamTest: 100,
        hakEdis: 950,
        stokDogrulukFark: 0,
        kitVerimlilikFark: 50,
      },
      {
        kumulatifTotal: 2000,
        sevkiyatlarSonrasiTotalTest: 2200,
        donemSonuToplamTest: 200,
        hakEdis: 1900,
        stokDogrulukFark: 0,
        kitVerimlilikFark: 100,
      },
    ];
    const result = calculateEfficiencyMetrics(rows);
    assert.strictEqual(result.toplamKumulatif, 3000);
    assert.strictEqual(result.toplamHakEdis, 2850);
  });
});

describe('calculateStokDogrulukFark', () => {
  it('should calculate stock accuracy difference correctly', () => {
    // (sevkiyatlarSonrasi - donemSonuToplam) - kumulatif
    const result = calculateStokDogrulukFark(1000, 100, 850);
    assert.strictEqual(result, 50); // (1000 - 100) - 850 = 50
  });

  it('should handle zero values', () => {
    const result = calculateStokDogrulukFark(0, 0, 0);
    assert.strictEqual(result, 0);
  });
});

describe('calculateKitVerimlilikFark', () => {
  it('should calculate kit efficiency difference correctly', () => {
    // kumulatif - hakEdis
    const result = calculateKitVerimlilikFark(1000, 950);
    assert.strictEqual(result, 50);
  });
});

describe('calculateDeviationPercentage', () => {
  it('should calculate deviation percentage correctly', () => {
    const result = calculateDeviationPercentage(50, 1000);
    assert.strictEqual(result, 5); // (50 / 1000) * 100 = 5
  });

  it('should return 0 when base is 0', () => {
    const result = calculateDeviationPercentage(50, 0);
    assert.strictEqual(result, 0);
  });
});

describe('calculateBoxLoss', () => {
  it('should calculate box loss correctly', () => {
    const result = calculateBoxLoss(100, 50); // 100 tests / 50 per box = 2 boxes
    assert.strictEqual(result, 2);
  });

  it('should return 0 when ambalajDegeri is 0', () => {
    const result = calculateBoxLoss(100, 0);
    assert.strictEqual(result, 0);
  });

  it('should return 0 for negative ambalajDegeri', () => {
    const result = calculateBoxLoss(100, -50);
    assert.strictEqual(result, 0);
  });
});

// =============================================================================
// UTILITY FUNCTION TESTS
// =============================================================================

describe('getEfficiencyColorClass', () => {
  it('should return green for scores >= 90', () => {
    assert.strictEqual(getEfficiencyColorClass(90), 'text-green-600');
    assert.strictEqual(getEfficiencyColorClass(95), 'text-green-600');
    assert.strictEqual(getEfficiencyColorClass(100), 'text-green-600');
  });

  it('should return yellow for scores 70-89', () => {
    assert.strictEqual(getEfficiencyColorClass(70), 'text-yellow-600');
    assert.strictEqual(getEfficiencyColorClass(85), 'text-yellow-600');
    assert.strictEqual(getEfficiencyColorClass(89.9), 'text-yellow-600');
  });

  it('should return orange for scores 50-69', () => {
    assert.strictEqual(getEfficiencyColorClass(50), 'text-orange-600');
    assert.strictEqual(getEfficiencyColorClass(65), 'text-orange-600');
  });

  it('should return red for scores < 50', () => {
    assert.strictEqual(getEfficiencyColorClass(49), 'text-red-600');
    assert.strictEqual(getEfficiencyColorClass(0), 'text-red-600');
  });
});

describe('getEfficiencyBgColorClass', () => {
  it('should return appropriate background colors', () => {
    assert.strictEqual(getEfficiencyBgColorClass(90), 'text-green-500');
    assert.strictEqual(getEfficiencyBgColorClass(70), 'text-yellow-500');
    assert.strictEqual(getEfficiencyBgColorClass(50), 'text-orange-500');
    assert.strictEqual(getEfficiencyBgColorClass(30), 'text-red-500');
  });
});

describe('formatNumberTR', () => {
  it('should format numbers in Turkish locale', () => {
    const result = formatNumberTR(1234567);
    assert.ok(result.includes('1'));
    assert.ok(result.includes('234'));
  });

  it('should respect fraction digits', () => {
    const result = formatNumberTR(123.456, 2);
    assert.ok(result.includes('123'));
  });
});

describe('formatPercentage', () => {
  it('should format percentage with default precision', () => {
    const result = formatPercentage(85.678);
    assert.strictEqual(result, '%85.7');
  });

  it('should format percentage with custom precision', () => {
    const result = formatPercentage(85.678, 2);
    assert.strictEqual(result, '%85.68');
  });
});

describe('validatePeriodKey', () => {
  it('should accept valid period keys', () => {
    assert.strictEqual(validatePeriodKey('01-2024'), '01-2024');
    assert.strictEqual(validatePeriodKey('12-2024'), '12-2024');
  });

  it('should reject invalid format', () => {
    assert.strictEqual(validatePeriodKey('2024-01'), '');
    assert.strictEqual(validatePeriodKey('1-2024'), '');
    assert.strictEqual(validatePeriodKey('invalid'), '');
  });

  it('should reject invalid months', () => {
    assert.strictEqual(validatePeriodKey('00-2024'), '');
    assert.strictEqual(validatePeriodKey('13-2024'), '');
  });

  it('should reject invalid years', () => {
    assert.strictEqual(validatePeriodKey('01-1999'), '');
    assert.strictEqual(validatePeriodKey('01-2101'), '');
  });

  it('should return empty for null/undefined', () => {
    assert.strictEqual(validatePeriodKey(null as any), '');
    assert.strictEqual(validatePeriodKey(undefined as any), '');
  });
});

describe('generatePeriodKey', () => {
  it('should generate valid period keys', () => {
    assert.strictEqual(generatePeriodKey(0, 2024), '01-2024');
    assert.strictEqual(generatePeriodKey(11, 2024), '12-2024');
    assert.strictEqual(generatePeriodKey(5, 2025), '06-2025');
  });

  it('should return empty for invalid month', () => {
    assert.strictEqual(generatePeriodKey(-1, 2024), '');
    assert.strictEqual(generatePeriodKey(12, 2024), '');
  });

  it('should return empty for invalid year', () => {
    assert.strictEqual(generatePeriodKey(0, 1999), '');
    assert.strictEqual(generatePeriodKey(0, 2101), '');
  });
});

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

describe('Edge Cases', () => {
  it('security check handles empty string', () => {
    const result = securityCheck('');
    assert.strictEqual(result.isSafe, true);
    assert.strictEqual(result.sanitizedValue, '');
  });

  it('sanitization handles numeric strings', () => {
    assert.strictEqual(sanitizeNumber('123.45'), 123.45);
  });

  it('weighted efficiency handles single row', () => {
    const rows = [
      { kitEffPct: 85, carryOverPrev: 100, consumption: 400, eomDeviceOn: 50 },
    ];
    const result = calculateWeightedEfficiency(rows);
    assert.ok(result === 85);
  });

  it('metrics calculation handles all zero values', () => {
    const rows = [
      {
        kumulatifTotal: 0,
        sevkiyatlarSonrasiTotalTest: 0,
        donemSonuToplamTest: 0,
        hakEdis: 0,
        stokDogrulukFark: 0,
        kitVerimlilikFark: 0,
      },
    ];
    const result = calculateEfficiencyMetrics(rows);
    assert.strictEqual(result.toplamKumulatif, 0);
    assert.strictEqual(result.genelVerimlilik, 100);
  });
});
