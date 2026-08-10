/**
 * @fileoverview `@/actions/stokActions` yerine geçen shim.
 *
 * NEDEN GEREKLİ: `src/actions/stokActions.ts` bir Next sunucu modülüdür ve
 * `firebase-admin` çeker. Statik paket bunu ne çalıştırabilir ne de
 * paketleyebilir (Node yerleşikleri tarayıcıda yok).
 *
 * Terminalin bu modülden ihtiyaç duyduğu YALNIZCA iki fonksiyon var; ikisi de
 * `src/lib/master-data.ts` içindeki Web SDK karşılıklarına yönlendirilir.
 * Bu bir gerileme değil, gereklilik: sunucu action'ları IndexedDB'yi atlamak
 * için yazılmıştı, terminalin ise tam tersine IndexedDB'ye ihtiyacı var —
 * çevrimdışıyken ürün kodları oradan okunacak.
 *
 * Başka bir fonksiyon çağrılırsa sessizce boş dönmek yerine AÇIKÇA hata
 * verilir: statik pakete sunucuya bağımlı yeni bir ekran eklendiğinde bunu
 * üretimde değil, ilk denemede görmek isteriz.
 */

import { fetchBarcodeFormats, fetchProductCodes } from '@/lib/master-data';

export async function getProductCodesAction(
  companyId: string | null | undefined,
  isSuperAdmin: boolean,
): Promise<Record<string, unknown>[]> {
  return (await fetchProductCodes(companyId, isSuperAdmin)) as unknown as Record<string, unknown>[];
}

export async function getBarcodeFormatsAction(
  companyId: string | null | undefined,
  isSuperAdmin: boolean,
): Promise<Record<string, unknown>[]> {
  return (await fetchBarcodeFormats(companyId, isSuperAdmin)) as unknown as Record<
    string,
    unknown
  >[];
}

/** Statik pakette karşılığı olmayan sunucu action'ları için ortak tuzak. */
function unsupported(name: string): never {
  throw new Error(
    `[terminal] "${name}" bir sunucu action'ı ve masaüstü paketinde çalışmaz. ` +
      'Gerekiyorsa Web SDK karşılığını src/lib/master-data.ts içine ekleyip ' +
      'buradan ona yönlendirin.',
  );
}

export const getDepotStockForTransfer = () => unsupported('getDepotStockForTransfer');
export const getDepotSerialIndex = () => unsupported('getDepotSerialIndex');
export const getPaginatedDepotStock = () => unsupported('getPaginatedDepotStock');
export const getDepoStokForOrders = () => unsupported('getDepoStokForOrders');
export const getExpiringProductsCountServer = () => unsupported('getExpiringProductsCountServer');
export const getRecoverableTransferredLabStock = () =>
  unsupported('getRecoverableTransferredLabStock');
