import type { YedekParcaDepoStokItem } from '@/lib/types';

type DepotItem = YedekParcaDepoStokItem & {
  anaBirim?: string;
  hucreNumarasi?: string;
};

export type DepotSelectableTrackingType = 'serial' | 'cell' | 'quantity';

export interface DepotSelectableStockItem {
  id?: string;
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  anaBirim?: string;
  serialNumber?: string;
  /** Kaynak stok kaydından taşınan lot numarası — Ceomed irsaliye girişi lot alanı için. */
  lotNumber?: string;
  hucreNumarasi?: string;
  address?: string;
  totalQuantity: number;
  trackingType: DepotSelectableTrackingType;
  isGrouped: boolean;
  sourceEntryIds: string[];
  cihazGrubu?: string;
}

interface BuildDepotSelectableItemsOptions {
  cellsOnly?: boolean;
}

export function buildDepotSelectableItems(
  items: DepotItem[],
  options: BuildDepotSelectableItemsOptions = {}
): DepotSelectableStockItem[] {
  const { cellsOnly = false } = options;

  const filtered = items.filter((item) => {
    if (cellsOnly) return !!item.hucreNumarasi;
    return true;
  });

  const grouped = new Map<string, DepotSelectableStockItem>();
  const result: DepotSelectableStockItem[] = [];

  for (const item of filtered) {
    const normalizedHucreNumarasi = (item.hucreNumarasi || '').trim();
    const normalizedSerialNumber = (item.serialNumber || '').trim();

    if (normalizedHucreNumarasi) {
      result.push({
        id: item.id,
        productCodeId: item.productCodeId,
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        anaBirim: item.anaBirim,
        serialNumber: normalizedSerialNumber,
        lotNumber: item.lotNumber,
        hucreNumarasi: normalizedHucreNumarasi,
        address: item.address,
        totalQuantity: 1,
        trackingType: 'cell',
        isGrouped: false,
        sourceEntryIds: [item.id],
        cihazGrubu: item.cihazGrubu,
      });
      continue;
    }

    if (normalizedSerialNumber) {
      if (cellsOnly) continue;
      result.push({
        id: item.id,
        productCodeId: item.productCodeId,
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        anaBirim: item.anaBirim,
        serialNumber: normalizedSerialNumber,
        lotNumber: item.lotNumber,
        address: item.address,
        totalQuantity: 1,
        trackingType: 'serial',
        isGrouped: false,
        sourceEntryIds: [item.id],
        cihazGrubu: item.cihazGrubu,
      });
      continue;
    }

    if (cellsOnly) continue;

    const key = `${item.productCodeId}__${item.stokKodu}__${item.stokAdi}__${item.anaBirim || ''}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.totalQuantity += item.quantity || 0;
      existing.sourceEntryIds.push(item.id);
    } else {
      // Adet bazlı gruplanmış satırlarda lot BİLEREK taşınmaz: grup birden çok
      // giriş kaydını birleştirir ve bunların lotları farklı olabilir. Birini
      // seçmek tahmin olurdu; Ceomed irsaliyesinde lot alanı boş kalır.
      grouped.set(key, {
        productCodeId: item.productCodeId,
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        anaBirim: item.anaBirim,
        address: item.address,
        totalQuantity: item.quantity || 0,
        trackingType: 'quantity',
        isGrouped: true,
        sourceEntryIds: [item.id],
        cihazGrubu: item.cihazGrubu,
      });
    }
  }

  return [...result, ...Array.from(grouped.values())].sort((a, b) => {
    const byName = a.stokAdi.localeCompare(b.stokAdi, 'tr');
    if (byName !== 0) return byName;
    if (a.isGrouped !== b.isGrouped) return a.isGrouped ? -1 : 1;
    return (a.serialNumber || a.hucreNumarasi || '').localeCompare(b.serialNumber || b.hucreNumarasi || '', 'tr');
  });
}
