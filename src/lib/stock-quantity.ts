/**
 * Returns the real unit quantity represented by a stock document.
 *
 * Serial-tracked products are typically stored as one document per physical unit,
 * while lot-tracked and quantity-tracked products can store multiple units in a
 * single document via the `adet` field. Missing/invalid quantities fall back to
 * 1 for backwards compatibility with existing serial stock documents.
 */
export function getStockItemQuantity(item: object | null | undefined): number {
  const rawQuantity = Number((item as any)?.adet);
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) return 1;
  return Math.max(1, Math.floor(rawQuantity));
}

/** Sum real units across stock documents instead of counting documents. */
export function sumStockItemQuantities<T extends object>(items: T[]): number {
  return items.reduce((sum, item) => sum + getStockItemQuantity(item), 0);
}
