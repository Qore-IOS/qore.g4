/**
 * @fileoverview Ana veri okuyucuları — Web SDK yolu.
 *
 * NEDEN VAR: `productCodes` ve `barcodeFormats`, web uygulamasında Admin SDK
 * sunucu action'ları üzerinden okunur (`@/actions/stokActions`). O tercih
 * bilinçliydi — IndexedDB katmanını atlayıp ilk yüklemeyi hızlandırıyor.
 *
 * Ama masaüstü terminali statik bir paket olarak çalışır: arkasında Next
 * sunucusu YOKTUR, dolayısıyla sunucu action'ı çağıramaz. Dahası terminalin
 * ihtiyacı tam tersidir — verinin IndexedDB'de kalması istenir, çünkü depoda
 * internet saatlerce gitmiş olabilir ve ürün kodları olmadan barkod
 * çözümlenemez.
 *
 * Bu modül aynı sonucu Web SDK ile üretir. Firestore'un kalıcı önbelleği açık
 * olduğu için (bkz. `src/lib/firebase.ts`), çevrimdışıyken sorgular
 * kendiliğinden yerel önbellekten cevaplanır.
 */

import { getScopedDocs } from '@/lib/document-helpers';
import type { BarcodeFormat } from '@/lib/barcode';
import type { ProductCode } from '@/lib/types';

/**
 * Şirket kapsamındaki tüm ürün kodları.
 *
 * `getProductCodesAction` ile aynı sonucu verir; kapsam filtresi
 * `getScopedDocs` içinde (şirket + `__legacy__`) uygulanır.
 */
export async function fetchProductCodes(
  companyId: string | null | undefined,
  isSuperAdmin: boolean | undefined,
): Promise<ProductCode[]> {
  const docs = await getScopedDocs('productCodes', companyId, isSuperAdmin);
  return docs.map(d => ({ id: d.id, ...d.data() }) as ProductCode);
}

/**
 * Şirket kapsamındaki ETKİN barkod formatları, öncelik sırasına göre.
 *
 * `active !== false` filtresi sunucu tarafındaki eşdeğeriyle birebir aynıdır:
 * alanı hiç olmayan eski kayıtlar etkin sayılır, yalnızca açıkça `false`
 * olanlar elenir.
 *
 * Filtre BİLEREK istemcide uygulanır, sorguya `where('active','==',true)`
 * konmaz — öyle olsaydı `active` alanı bulunmayan eski format belgeleri
 * sonuçtan tamamen düşerdi ve o formatlarla basılmış barkodlar okunamaz hâle
 * gelirdi.
 */
export async function fetchBarcodeFormats(
  companyId: string | null | undefined,
  isSuperAdmin: boolean | undefined,
): Promise<BarcodeFormat[]> {
  const docs = await getScopedDocs('barcodeFormats', companyId, isSuperAdmin);
  return docs
    .map(d => ({ id: d.id, ...d.data() }) as BarcodeFormat & { active?: boolean; priority?: number })
    .filter(f => f.active !== false)
    .sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));
}
