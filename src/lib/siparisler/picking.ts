import { getStockItemQuantity } from '../stock-quantity';

const LOT_IDENTIFIER_PREFIX = 'PICK_LOT:';
const LOT_IDENTIFIER_SEPARATOR = ':UNIT:';

export function aggregateOrderItemsByProduct<T extends { stokKodu?: string; adet?: number }>(items: T[]): T[] {
  const requestedByProduct = new Map<string, T>();

  for (const item of items) {
    const stokKodu = item.stokKodu || '';
    if (!stokKodu) continue;

    const existing = requestedByProduct.get(stokKodu);
    if (existing) {
      existing.adet = (existing.adet ?? 0) + (item.adet ?? 0);
    } else {
      requestedByProduct.set(stokKodu, { ...item, stokKodu, adet: item.adet ?? 0 });
    }
  }

  return [...requestedByProduct.values()];
}

export function encodeLotPickingIdentifier(lot: string, unitIndex: number): string {
  return `${LOT_IDENTIFIER_PREFIX}${encodeURIComponent(lot)}${LOT_IDENTIFIER_SEPARATOR}${unitIndex}`;
}

export function decodeLotPickingIdentifier(identifier: string): string {
  if (identifier.startsWith(LOT_IDENTIFIER_PREFIX)) {
    const encodedLot = identifier.slice(LOT_IDENTIFIER_PREFIX.length).split(LOT_IDENTIFIER_SEPARATOR, 1)[0];
    try {
      return decodeURIComponent(encodedLot);
    } catch {
      return encodedLot;
    }
  }

  // Backwards compatibility for identifiers created before lot-independent picking.
  const lastDashIndex = identifier.lastIndexOf('-');
  return lastDashIndex > 0 ? identifier.substring(0, lastDashIndex) : identifier;
}

export function findAvailableStockForQuantityScan<T extends { lotNumarasi?: string; adet?: number }>(
  stockItems: T[],
  scannedIdentifiers: string[],
  requestedLot?: string,
): T | undefined {
  const quantityByLot = stockItems.reduce((acc, item) => {
    const lot = item.lotNumarasi || '';
    acc.set(lot, (acc.get(lot) ?? 0) + getStockItemQuantity(item));
    return acc;
  }, new Map<string, number>());
  const scannedByLot = scannedIdentifiers.reduce((acc, identifier) => {
    const lot = decodeLotPickingIdentifier(identifier);
    acc.set(lot, (acc.get(lot) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());

  return stockItems.find(item => {
    const lot = item.lotNumarasi || '';
    if (requestedLot && lot !== requestedLot) return false;
    return (scannedByLot.get(lot) ?? 0) < (quantityByLot.get(lot) ?? 0);
  });
}
