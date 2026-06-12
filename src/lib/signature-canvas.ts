/**
 * Signature images are stored inside Firestore action-form documents.
 * Keep their backing store independent from high-DPR phones so memory and
 * serialized PNG size do not vary by device model.
 */
export const MAX_SIGNATURE_PIXEL_RATIO = 2;
export const MAX_SIGNATURE_HISTORY_ENTRIES = 12;

export function getSignaturePixelRatio(devicePixelRatio: number | undefined): number {
  if (!Number.isFinite(devicePixelRatio) || !devicePixelRatio || devicePixelRatio < 1) {
    return 1;
  }

  return Math.min(devicePixelRatio, MAX_SIGNATURE_PIXEL_RATIO);
}

export function getSignatureExportDimensions(width: number, height: number) {
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}
