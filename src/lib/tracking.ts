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
 * Resolves the effective tracking mode based on the matched barcode format.
 * This allows products to support multiple barcode formats with different tracking modes.
 *
 * @param matchedFormat - The barcode format that was matched during parsing
 * @param product - The product data (for fallback to static tracking mode)
 * @returns The effective tracking mode to use for this specific scan
 */
export function resolveEffectiveTrackingMode(
  matchedFormat: { trackSerial?: boolean; trackLot?: boolean } | null | undefined,
  product?: { trackingMode?: TrackingMode; marka?: string; manufacturer?: string; stokAdi?: string }
): TrackingMode {
  // If a format was matched, use its tracking capabilities
  if (matchedFormat) {
    if (matchedFormat.trackSerial === true) {
      return 'serial';
    }
    if (matchedFormat.trackLot !== false) {
      return 'lot_barcode';
    }
    return 'qty_barcode';
  }

  // Fall back to product's static tracking mode
  if (product) {
    return resolveDefaultTrackingMode(product);
  }

  // Ultimate fallback
  return 'qty_barcode';
}
