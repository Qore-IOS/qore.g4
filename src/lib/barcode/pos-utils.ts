
// src/lib/barcode/pos-utils.ts
// Tek nokta: Pos alanlarını sayısallaştırır ve tip seviyesinde kesişim döndürür.
import type { PositionDef, BarcodeFormat } from '../types';

export type LoosePos = { start?: number | string; length?: number | string } & Record<string, unknown>;

/**
 * normalizePos:
 * - Runtime: start/length => Number(...)
 * - Type:  ({start:number; length:number} & T) döndürür.
 *   Çağrı yerinde T "Pos" ise sonuç tipi "OldPos & Pos" olur => derleyici tatmin olur.
 */
export function normalizePos(p: any): PositionDef {
  return {
    start: Number(p?.start ?? 0),
    length: Number(p?.length ?? 0),
  };
}


/** İsteğe bağlı: tüm format kaydını normalize eden yardımcı */
export function normalizeFormat(f: any): Partial<BarcodeFormat> {
  return {
    ...f,
    // Ensure these existing fields are processed
    reference: normalizePos(f.reference),
    lot: normalizePos(f.lot),
    expiry: {
      ...normalizePos(f.expiry),
      pattern: f.expiry?.pattern || 'YYMMDD',
    },
    // --- ADD THESE NEW FIELDS ---
    serial: normalizePos(f.serial),
    trackSerial: f.trackSerial === true, // Ensure boolean
    trackLot: f.trackLot !== false,      // Default to true if undefined for legacy compatibility
    // ----------------------------
    totalLength: Number(f.totalLength ?? 0),
    priority: Number(f.priority ?? 10),
  };
}
