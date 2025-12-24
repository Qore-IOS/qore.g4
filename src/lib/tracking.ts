// src/lib/tracking.ts
export type TrackingMode =
  | 'serial'
  | 'lot_barcode'
  | 'lot_manual'
  | 'qty_barcode'
  | 'qty_manual';

export const TRACKING_MODE_LABEL: Record<TrackingMode, string> = {
  serial: 'Seri No Takibi',
  lot_barcode: 'Barkodlu Lot Takibi',
  lot_manual: 'Manuel Lot Takibi',
  qty_barcode: 'Barkodlu Adet Takibi',
  qty_manual: 'Manuel Adet Takibi',
};

export function resolveDefaultTrackingMode(p: {
  trackingMode?: TrackingMode;
  marka?: string;
  manufacturer?: string;
  stokAdi?: string;
}): TrackingMode {
  if (p.trackingMode) return p.trackingMode;
  const brand = (p.marka || p.manufacturer || p.stokAdi || '').toLowerCase();
  // Default Roche to serial until manually changed
  if (brand.includes('roche')) return 'serial';
  return 'qty_barcode';
}

export const trackingModeToExcel = (m?: TrackingMode) => m ?? 'qty_barcode';
export const trackingModeFromExcel = (val?: string): TrackingMode => {
  const v = (val || '').toString().trim().toLowerCase();
  switch (v) {
    case 'serial':
    case 'seri':
    case 'seri_no':
      return 'serial';
    case 'lot_barcode':
    case 'barkodlu_lot':
      return 'lot_barcode';
    case 'lot_manual':
    case 'manuel_lot':
      return 'lot_manual';
    case 'qty_manual':
    case 'manuel_adet':
      return 'qty_manual';
    default:
      return 'qty_barcode';
  }
};

/**
 * Resolves the effective tracking mode based on what the barcode actually contains.
 * This allows products to support multiple barcode formats with different tracking modes.
 *
 * @param parsed - The parsed barcode data (to check what it contains)
 * @param matchedFormat - The barcode format that was matched during parsing
 * @param product - The product data (for fallback to static tracking mode)
 * @returns The effective tracking mode to use for this specific scan
 */
export function resolveEffectiveTrackingMode(
  parsed: { seriNumarasi?: string; lotNumarasi?: string } | null | undefined,
  matchedFormat: { trackSerial?: boolean; trackLot?: boolean } | null | undefined,
  product?: { trackingMode?: TrackingMode; marka?: string; manufacturer?: string; stokAdi?: string }
): TrackingMode {
  // If we have parsed data and a matched format, determine mode based on actual barcode content
  if (parsed && matchedFormat) {
    const hasSeri = !!(parsed.seriNumarasi && parsed.seriNumarasi.trim());
    const hasLot = !!(parsed.lotNumarasi && parsed.lotNumarasi.trim());

    console.log('[resolveEffectiveTrackingMode] Parsed:', {
      seriNumarasi: parsed.seriNumarasi,
      lotNumarasi: parsed.lotNumarasi,
      hasSeri,
      hasLot,
      matchedFormat: { trackSerial: matchedFormat.trackSerial, trackLot: matchedFormat.trackLot }
    });

    // If barcode has serial number and format supports it
    if (hasSeri && matchedFormat.trackSerial === true) {
      console.log('[resolveEffectiveTrackingMode] → serial mode (has seri)');
      return 'serial';
    }

    // If barcode has lot (but no serial) and format supports it
    if (hasLot && !hasSeri && matchedFormat.trackLot !== false) {
      console.log('[resolveEffectiveTrackingMode] → lot_barcode mode (has lot, no seri)');
      return 'lot_barcode';
    }

    // Otherwise quantity tracking
    console.log('[resolveEffectiveTrackingMode] → qty_barcode mode (fallback)');
    return 'qty_barcode';
  }

  // Fall back to product's static tracking mode
  if (product) {
    const mode = resolveDefaultTrackingMode(product);
    console.log('[resolveEffectiveTrackingMode] → fallback to product tracking mode:', mode);
    return mode;
  }

  // Ultimate fallback
  console.log('[resolveEffectiveTrackingMode] → ultimate fallback (qty_barcode)');
  return 'qty_barcode';
}
