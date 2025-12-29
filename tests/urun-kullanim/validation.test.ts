/**
 * @fileoverview Comprehensive unit tests for Product Usage validation module
 * @description Tests for input validation, security patterns, and business rules
 * @module tests/urun-kullanim/validation.test
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  securityCheck,
  sanitizeBarcode,
  sanitizeDisposalBarcode,
  sanitizeString,
  sanitizeStockCode,
  sanitizeLotNumber,
  sanitizeSerialNumber,
  sanitizeFaultDescription,
  ManualDeductionPayloadSchema,
  TrashBinItemSchema,
  FaultReportPayloadSchema,
  DisposalBarcodeSchema,
  validateConsumptionReadiness,
  validateDisposalBarcode,
  validateManualDeduction,
  validateTrashBinItems,
  validateFaultReport,
  extractLotFromDisposalBarcode,
  canVerifyItem,
  isFullyVerified,
  calculateVerificationProgress,
  parseAndValidateDate,
  isExpired,
  formatZodErrors,
} from '../../src/lib/urun-kullanim/validation.js';

// =============================================================================
// SECURITY CHECK TESTS
// =============================================================================

describe('securityCheck', () => {
  it('should return safe for normal input', () => {
    const result = securityCheck('normal-input-123');
    assert.strictEqual(result.isSafe, true);
    assert.deepStrictEqual(result.threats, []);
  });

  it('should detect SQL injection patterns - SELECT', () => {
    const result = securityCheck('SELECT * FROM users');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('SQL_INJECTION'));
  });

  it('should detect SQL injection patterns - DROP TABLE', () => {
    const result = securityCheck('DROP TABLE users FROM database');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('SQL_INJECTION'));
  });

  it('should detect SQL injection patterns - UNION', () => {
    const result = securityCheck("' UNION SELECT * FROM passwords");
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('SQL_INJECTION'));
  });

  it('should detect SQL injection patterns - OR equals', () => {
    const result = securityCheck("admin' OR 1=1");
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('SQL_INJECTION'));
  });

  it('should detect XSS patterns - script tag', () => {
    const result = securityCheck('<script>alert("xss")</script>');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('XSS'));
  });

  it('should detect XSS patterns - javascript protocol', () => {
    const result = securityCheck('javascript:void(0)');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('XSS'));
  });

  it('should detect XSS patterns - onerror', () => {
    const result = securityCheck('<img onerror="evil()" src="x">');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('XSS'));
  });

  it('should detect path traversal - ../', () => {
    const result = securityCheck('../../../etc/passwd');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('PATH_TRAVERSAL'));
  });

  it('should detect path traversal - ..\\', () => {
    const result = securityCheck('..\\..\\windows\\system32');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('PATH_TRAVERSAL'));
  });

  it('should detect null bytes', () => {
    const result = securityCheck('file.txt\x00.jpg');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('NULL_BYTE'));
  });

  it('should detect excessive length', () => {
    const longString = 'a'.repeat(600);
    const result = securityCheck(longString);
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('EXCESSIVE_LENGTH'));
  });

  it('should detect multiple threats simultaneously', () => {
    const result = securityCheck('<script>SELECT * FROM users</script>');
    assert.strictEqual(result.isSafe, false);
    assert.ok(result.threats.includes('XSS'));
    assert.ok(result.threats.includes('SQL_INJECTION'));
  });

  it('should handle empty string', () => {
    const result = securityCheck('');
    assert.strictEqual(result.isSafe, true);
    assert.deepStrictEqual(result.threats, []);
  });

  it('should handle Turkish characters safely', () => {
    const result = securityCheck('Ürün Kullanım İşlemi Başarılı');
    assert.strictEqual(result.isSafe, true);
    assert.deepStrictEqual(result.threats, []);
  });

  it('should handle null input', () => {
    // @ts-expect-error - Testing null handling
    const result = securityCheck(null);
    assert.strictEqual(result.isSafe, true);
    assert.deepStrictEqual(result.threats, []);
  });
});

// =============================================================================
// SANITIZATION TESTS
// =============================================================================

describe('sanitizeString', () => {
  it('should trim whitespace', () => {
    const result = sanitizeString('  hello world  ');
    assert.strictEqual(result, 'hello world');
  });

  it('should remove null bytes', () => {
    const result = sanitizeString('hello\x00world');
    assert.strictEqual(result, 'helloworld');
  });

  it('should remove control characters', () => {
    const result = sanitizeString('hello\x01\x02\x03world');
    assert.strictEqual(result, 'helloworld');
  });

  it('should collapse multiple spaces', () => {
    const result = sanitizeString('hello    world');
    assert.strictEqual(result, 'hello world');
  });

  it('should return empty string for null', () => {
    const result = sanitizeString(null);
    assert.strictEqual(result, '');
  });

  it('should return empty string for undefined', () => {
    const result = sanitizeString(undefined);
    assert.strictEqual(result, '');
  });
});

describe('sanitizeStockCode', () => {
  it('should convert to uppercase', () => {
    const result = sanitizeStockCode('abc123');
    assert.strictEqual(result, 'ABC123');
  });

  it('should trim whitespace', () => {
    const result = sanitizeStockCode('  PROD001  ');
    assert.strictEqual(result, 'PROD001');
  });

  it('should remove special characters', () => {
    const result = sanitizeStockCode('PROD@#$001');
    assert.strictEqual(result, 'PROD001');
  });

  it('should allow hyphens and underscores', () => {
    const result = sanitizeStockCode('PROD-001_A');
    assert.strictEqual(result, 'PROD-001_A');
  });

  it('should limit length to 50', () => {
    const longCode = 'A'.repeat(100);
    const result = sanitizeStockCode(longCode);
    assert.strictEqual(result.length, 50);
  });

  it('should return empty for null', () => {
    const result = sanitizeStockCode(null);
    assert.strictEqual(result, '');
  });
});

describe('sanitizeLotNumber', () => {
  it('should convert to uppercase', () => {
    const result = sanitizeLotNumber('lot123');
    assert.strictEqual(result, 'LOT123');
  });

  it('should allow forward slashes', () => {
    const result = sanitizeLotNumber('LOT/2024/001');
    assert.strictEqual(result, 'LOT/2024/001');
  });

  it('should remove invalid characters', () => {
    const result = sanitizeLotNumber('LOT@#$123');
    assert.strictEqual(result, 'LOT123');
  });
});

describe('sanitizeSerialNumber', () => {
  it('should convert to uppercase', () => {
    const result = sanitizeSerialNumber('sn123abc');
    assert.strictEqual(result, 'SN123ABC');
  });

  it('should limit length to 100', () => {
    const longSerial = 'A'.repeat(150);
    const result = sanitizeSerialNumber(longSerial);
    assert.strictEqual(result.length, 100);
  });
});

describe('sanitizeBarcode', () => {
  it('should trim whitespace', () => {
    const result = sanitizeBarcode('  ABC123  ');
    assert.strictEqual(result, 'ABC123');
  });

  it('should limit length to 500', () => {
    const longBarcode = 'A'.repeat(600);
    const result = sanitizeBarcode(longBarcode);
    assert.strictEqual(result.length, 500);
  });

  it('should return empty string for null', () => {
    const result = sanitizeBarcode(null);
    assert.strictEqual(result, '');
  });

  it('should preserve GS1 control characters', () => {
    const result = sanitizeBarcode('\x1D01234567890\x1D10LOT');
    assert.ok(result.includes('\x1D'));
  });
});

describe('sanitizeDisposalBarcode', () => {
  it('should return valid 16-digit barcode', () => {
    const result = sanitizeDisposalBarcode('1234567890123456');
    assert.strictEqual(result, '1234567890123456');
  });

  it('should convert to uppercase', () => {
    const result = sanitizeDisposalBarcode('abcdef1234567890');
    assert.strictEqual(result, 'ABCDEF1234567890');
  });

  it('should remove non-alphanumeric characters', () => {
    const result = sanitizeDisposalBarcode('ABCD-1234-5678-90XY');
    // After removing dashes, we have ABCD1234567890XY (16 chars)
    assert.strictEqual(result, 'ABCD1234567890XY');
  });

  it('should trim and limit to expected length', () => {
    const result = sanitizeDisposalBarcode('  12345678901234567890  ', 16);
    assert.strictEqual(result.length, 16);
  });

  it('should return empty for null', () => {
    const result = sanitizeDisposalBarcode(null);
    assert.strictEqual(result, '');
  });
});

describe('sanitizeFaultDescription', () => {
  it('should remove angle brackets', () => {
    const result = sanitizeFaultDescription('<b>bold</b> text');
    // Angle brackets are replaced with empty string
    assert.strictEqual(result, 'bbold/b text');
  });

  it('should limit length to 1000', () => {
    const longDesc = 'a'.repeat(2000);
    const result = sanitizeFaultDescription(longDesc);
    assert.strictEqual(result.length, 1000);
  });

  it('should collapse multiple spaces', () => {
    const result = sanitizeFaultDescription('hello    world');
    assert.strictEqual(result, 'hello world');
  });
});

// =============================================================================
// ZOD SCHEMA TESTS
// =============================================================================

describe('ManualDeductionPayloadSchema', () => {
  it('should validate correct payload', () => {
    const payload = {
      productCode: 'PROD001',
      lotNumarasi: 'LOT123',
      miad: '31.12.2025',
      quantity: 5,
      laboratoryId: 'lab123',
    };
    const result = ManualDeductionPayloadSchema.safeParse(payload);
    assert.strictEqual(result.success, true);
  });

  it('should reject empty productCode', () => {
    const payload = {
      productCode: '',
      lotNumarasi: 'LOT123',
      miad: '31.12.2025',
      quantity: 5,
      laboratoryId: 'lab123',
    };
    const result = ManualDeductionPayloadSchema.safeParse(payload);
    assert.strictEqual(result.success, false);
  });

  it('should reject quantity less than 1', () => {
    const payload = {
      productCode: 'PROD001',
      lotNumarasi: 'LOT123',
      miad: '31.12.2025',
      quantity: 0,
      laboratoryId: 'lab123',
    };
    const result = ManualDeductionPayloadSchema.safeParse(payload);
    assert.strictEqual(result.success, false);
  });

  it('should reject quantity greater than 10000', () => {
    const payload = {
      productCode: 'PROD001',
      lotNumarasi: 'LOT123',
      miad: '31.12.2025',
      quantity: 10001,
      laboratoryId: 'lab123',
    };
    const result = ManualDeductionPayloadSchema.safeParse(payload);
    assert.strictEqual(result.success, false);
  });

  it('should reject empty laboratoryId', () => {
    const payload = {
      productCode: 'PROD001',
      lotNumarasi: 'LOT123',
      miad: '31.12.2025',
      quantity: 5,
      laboratoryId: '',
    };
    const result = ManualDeductionPayloadSchema.safeParse(payload);
    assert.strictEqual(result.success, false);
  });
});

describe('TrashBinItemSchema', () => {
  it('should validate correct item', () => {
    const item = {
      id: 'item123',
      productCode: 'PROD001',
      productName: 'Test Kiti',
      remainingTests: 10,
    };
    const result = TrashBinItemSchema.safeParse(item);
    assert.strictEqual(result.success, true);
  });

  it('should reject negative remainingTests', () => {
    const item = {
      id: 'item123',
      productCode: 'PROD001',
      productName: 'Test Kiti',
      remainingTests: -5,
    };
    const result = TrashBinItemSchema.safeParse(item);
    assert.strictEqual(result.success, false);
  });

  it('should reject remainingTests exceeding 100000', () => {
    const item = {
      id: 'item123',
      productCode: 'PROD001',
      productName: 'Test Kiti',
      remainingTests: 100001,
    };
    const result = TrashBinItemSchema.safeParse(item);
    assert.strictEqual(result.success, false);
  });

  it('should accept zero remainingTests', () => {
    const item = {
      id: 'item123',
      productCode: 'PROD001',
      productName: 'Empty Kit',
      remainingTests: 0,
    };
    const result = TrashBinItemSchema.safeParse(item);
    assert.strictEqual(result.success, true);
  });
});

describe('FaultReportPayloadSchema', () => {
  it('should validate correct payload', () => {
    const payload = {
      hospitalId: 'hosp123',
      labName: 'Merkez Laboratuvar',
      deviceId: 'dev456',
      model: 'Cobas 6000',
      serial: 'SN123456',
      faultType: 'teknik_servis' as const,
      openedByUid: 'user789',
      openedByName: 'Dr. Ahmet Yılmaz',
      openDescription: 'Cihaz kalibrasyon hatası veriyor',
    };
    const result = FaultReportPayloadSchema.safeParse(payload);
    assert.strictEqual(result.success, true);
  });

  it('should accept empty openDescription', () => {
    const payload = {
      hospitalId: 'hosp123',
      labName: 'Merkez Laboratuvar',
      deviceId: 'dev456',
      model: 'Cobas 6000',
      serial: 'SN123456',
      faultType: 'aplikasyon' as const,
      openedByUid: 'user789',
      openedByName: 'Dr. Ahmet Yılmaz',
      openDescription: '',
    };
    const result = FaultReportPayloadSchema.safeParse(payload);
    assert.strictEqual(result.success, true);
  });

  it('should reject invalid faultType', () => {
    const payload = {
      hospitalId: 'hosp123',
      labName: 'Merkez Laboratuvar',
      deviceId: 'dev456',
      model: 'Cobas 6000',
      serial: 'SN123456',
      faultType: 'invalid_type',
      openedByUid: 'user789',
      openedByName: 'Dr. Ahmet Yılmaz',
      openDescription: '',
    };
    const result = FaultReportPayloadSchema.safeParse(payload);
    assert.strictEqual(result.success, false);
  });
});

// =============================================================================
// VALIDATION FUNCTION TESTS
// =============================================================================

describe('validateConsumptionReadiness', () => {
  it('should return valid when all conditions met', () => {
    const result = validateConsumptionReadiness({
      laboratoryId: 'lab123',
      stockItem: { stokKodu: 'PROD001', seriNumarasi: 'SN123' },
      productFound: true,
      isAlreadyConsumed: false,
    });
    assert.strictEqual(result.isValid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  it('should fail when laboratory not selected', () => {
    const result = validateConsumptionReadiness({
      laboratoryId: '',
      stockItem: { stokKodu: 'PROD001' },
      productFound: true,
    });
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some(e => e.code === 'LABORATORY_NOT_SELECTED'));
  });

  it('should fail when product not found', () => {
    const result = validateConsumptionReadiness({
      laboratoryId: 'lab123',
      stockItem: null,
      productFound: false,
    });
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some(e => e.code === 'PRODUCT_NOT_FOUND'));
  });

  it('should fail when stock item is null', () => {
    const result = validateConsumptionReadiness({
      laboratoryId: 'lab123',
      stockItem: null,
      productFound: true,
    });
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some(e => e.code === 'INSUFFICIENT_STOCK'));
  });

  it('should fail when already consumed', () => {
    const result = validateConsumptionReadiness({
      laboratoryId: 'lab123',
      stockItem: { stokKodu: 'PROD001' },
      productFound: true,
      isAlreadyConsumed: true,
    });
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some(e => e.code === 'ALREADY_CONSUMED'));
  });
});

describe('validateDisposalBarcode', () => {
  it('should validate correct barcode', () => {
    const result = validateDisposalBarcode('ABCD123456789012');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.sanitized, 'ABCD123456789012');
  });

  it('should fail for empty barcode', () => {
    const result = validateDisposalBarcode('');
    assert.strictEqual(result.isValid, false);
    assert.ok(result.error?.includes('boş'));
  });

  it('should fail for barcode too short', () => {
    const result = validateDisposalBarcode('ABCD12345');
    assert.strictEqual(result.isValid, false);
    assert.ok(result.error?.includes('16 hane'));
  });

  it('should sanitize and validate', () => {
    const result = validateDisposalBarcode('  abcd123456789012  ');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.sanitized, 'ABCD123456789012');
  });
});

describe('extractLotFromDisposalBarcode', () => {
  it('should extract first 8 characters as lot', () => {
    const result = extractLotFromDisposalBarcode('ABCD123456789012');
    assert.strictEqual(result, 'ABCD1234');
  });

  it('should handle shorter barcodes', () => {
    const result = extractLotFromDisposalBarcode('ABCD');
    assert.strictEqual(result, 'ABCD');
  });

  it('should sanitize before extracting', () => {
    const result = extractLotFromDisposalBarcode('  abcd123456  ');
    assert.strictEqual(result, 'ABCD1234');
  });
});

describe('validateTrashBinItems', () => {
  it('should validate correct items', () => {
    const items = [
      { id: 'item1', productCode: 'PROD001', productName: 'Test Kit', remainingTests: 5 },
      { id: 'item2', productCode: 'PROD002', productName: 'Test Kit 2', remainingTests: 10 },
    ];
    const result = validateTrashBinItems(items);
    assert.strictEqual(result.success, true);
  });

  it('should fail for empty items', () => {
    const result = validateTrashBinItems([]);
    assert.strictEqual(result.success, false);
    assert.ok(result.errors?.includes('En az bir ürün eklemelisiniz'));
  });

  it('should fail for invalid item', () => {
    const items = [
      { id: 'item1', productCode: '', productName: 'Test Kit', remainingTests: 5 },
    ];
    const result = validateTrashBinItems(items);
    assert.strictEqual(result.success, false);
  });
});

// =============================================================================
// VERIFICATION HELPER TESTS
// =============================================================================

describe('Verification Helpers', () => {
  const mockItem = {
    stokKodu: 'PROD001',
    stokAdi: 'Test Kit',
    lotNumarasi: 'LOT123',
    miad: '31.12.2025',
    tuketilenAdet: 10,
    dogrulananAdet: 5,
    originalRecordIds: ['rec1', 'rec2'],
  };

  it('canVerifyItem should return true when not fully verified', () => {
    assert.strictEqual(canVerifyItem(mockItem), true);
  });

  it('canVerifyItem should return false when fully verified', () => {
    const fullyVerified = { ...mockItem, dogrulananAdet: 10 };
    assert.strictEqual(canVerifyItem(fullyVerified), false);
  });

  it('isFullyVerified should return true when fully verified', () => {
    const fullyVerified = { ...mockItem, dogrulananAdet: 10 };
    assert.strictEqual(isFullyVerified(fullyVerified), true);
  });

  it('isFullyVerified should return false when not fully verified', () => {
    assert.strictEqual(isFullyVerified(mockItem), false);
  });

  it('isFullyVerified should return false for zero consumption', () => {
    const zeroItem = { ...mockItem, tuketilenAdet: 0, dogrulananAdet: 0 };
    assert.strictEqual(isFullyVerified(zeroItem), false);
  });

  it('calculateVerificationProgress should return correct percentage', () => {
    assert.strictEqual(calculateVerificationProgress(mockItem), 50);
  });

  it('calculateVerificationProgress should return 0 for zero consumption', () => {
    const zeroItem = { ...mockItem, tuketilenAdet: 0, dogrulananAdet: 0 };
    assert.strictEqual(calculateVerificationProgress(zeroItem), 0);
  });

  it('calculateVerificationProgress should return 100 for fully verified', () => {
    const fullyVerified = { ...mockItem, dogrulananAdet: 10 };
    assert.strictEqual(calculateVerificationProgress(fullyVerified), 100);
  });
});

// =============================================================================
// DATE VALIDATION TESTS
// =============================================================================

describe('parseAndValidateDate', () => {
  it('should parse DD.MM.YYYY format', () => {
    const result = parseAndValidateDate('31.12.2025');
    assert.ok(result instanceof Date);
    assert.strictEqual(result?.getFullYear(), 2025);
    assert.strictEqual(result?.getMonth(), 11); // December
    assert.strictEqual(result?.getDate(), 31);
  });

  it('should parse YYYY-MM-DD format', () => {
    const result = parseAndValidateDate('2025-12-31');
    assert.ok(result instanceof Date);
    assert.strictEqual(result?.getFullYear(), 2025);
  });

  it('should return null for invalid date', () => {
    const result = parseAndValidateDate('invalid-date');
    assert.strictEqual(result, null);
  });

  it('should return null for empty string', () => {
    const result = parseAndValidateDate('');
    assert.strictEqual(result, null);
  });

  it('should return null for null', () => {
    // @ts-expect-error - Testing null handling
    const result = parseAndValidateDate(null);
    assert.strictEqual(result, null);
  });
});

describe('isExpired', () => {
  it('should return true for past date', () => {
    const result = isExpired('01.01.2020');
    assert.strictEqual(result, true);
  });

  it('should return false for future date', () => {
    const result = isExpired('31.12.2030');
    assert.strictEqual(result, false);
  });

  it('should return false for invalid date', () => {
    const result = isExpired('invalid');
    assert.strictEqual(result, false);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
  describe('Unicode and Special Characters', () => {
    it('should handle Turkish special characters in product names', () => {
      const item = {
        id: 'item1',
        productCode: 'PROD_TR',
        productName: 'İmmünoloji Testi - Çölyak',
        remainingTests: 5,
      };
      const result = TrashBinItemSchema.safeParse(item);
      assert.strictEqual(result.success, true);
    });

    it('should handle Turkish characters in stock code', () => {
      // Stock codes should be ASCII only
      const result = sanitizeStockCode('ÜRÜN001');
      assert.ok(!result.includes('Ü'));
    });
  });

  describe('Numeric Boundaries', () => {
    it('should accept minimum valid quantity (1)', () => {
      const payload = {
        productCode: 'PROD001',
        lotNumarasi: 'LOT123',
        miad: '31.12.2025',
        quantity: 1,
        laboratoryId: 'lab123',
      };
      const result = ManualDeductionPayloadSchema.safeParse(payload);
      assert.strictEqual(result.success, true);
    });

    it('should accept maximum valid quantity (10000)', () => {
      const payload = {
        productCode: 'PROD001',
        lotNumarasi: 'LOT123',
        miad: '31.12.2025',
        quantity: 10000,
        laboratoryId: 'lab123',
      };
      const result = ManualDeductionPayloadSchema.safeParse(payload);
      assert.strictEqual(result.success, true);
    });
  });

  describe('Empty and Null Handling', () => {
    it('should handle null in sanitizeString', () => {
      const result = sanitizeString(null);
      assert.strictEqual(result, '');
    });

    it('should handle undefined in sanitizeBarcode', () => {
      const result = sanitizeBarcode(undefined);
      assert.strictEqual(result, '');
    });

    it('should handle undefined in sanitizeStockCode', () => {
      const result = sanitizeStockCode(undefined);
      assert.strictEqual(result, '');
    });
  });
});

console.log('✅ All urun-kullanim validation tests loaded successfully');
