// src/lib/barcode/pos-utils.ts
// Tek nokta: Pos alanlarını sayısallaştırır ve tip seviyesinde kesişim döndürür.

export type LoosePos = { start?: number | string; length?: number | string } & Record<string, unknown>;

/**
 * normalizePos:
 * - Runtime: start/length => Number(...)
 * - Type:  ({start:number; length:number} & T) döndürür.
 *   Çağrı yerinde T "Pos" ise sonuç tipi "OldPos & Pos" olur => derleyici tatmin olur.
 */
export function normalizePos<T extends LoosePos | null | undefined>(
  v: T
): ({ start: number; length: number } & (T extends null | undefined ? {} : NonNullable<T>)) {
  const start = Number((v as any)?.start ?? 0);
  const length = Number((v as any)?.length ?? 0);
  const rest = (v ?? {}) as object;
  return { start, length, ...rest } as any;
}

/** İsteğe bağlı: tüm format kaydını normalize eden yardımcı */
export function normalizeFormat<F extends {
  reference?: LoosePos | null;
  lot?: LoosePos | null;
  expiry?: (LoosePos & Record<string, unknown>) | null;
  barcodeNumber?: LoosePos | null;
}>(f: F) {
  return {
    ...f,
    reference: normalizePos(f.reference),
    lot: f.lot != null ? normalizePos(f.lot) : undefined,
    // expiry genelde ekstra alanlar içerir → normalize + merge
    expiry: f.expiry != null ? { ...normalizePos(f.expiry) } : undefined,
    barcodeNumber: f.barcodeNumber != null ? normalizePos(f.barcodeNumber) : undefined,
  };
}
