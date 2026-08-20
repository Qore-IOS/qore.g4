'use client';

/**
 * @fileoverview Ana veri (ürün kodları + barkod formatları) — İKİ KAYNAKLI okuma.
 *
 * NEDEN VAR
 *
 * Bu iki koleksiyon web uygulamasında Admin SDK üzerinden bir server action ile
 * okunur (`getProductCodesAction` / `getBarcodeFormatsAction`). Tercih meşru:
 * `companyId` etiketi HİÇ olmayan çok eski kayıtlar güvenlik kuralları gereği
 * istemci SDK'sıyla LİSTELENEMEZ (kuraldaki etiketsiz dal yalnız `get` için
 * açıktır) ama barkod çözümlemesi onlara bağımlıdır. Admin SDK kuralları
 * atladığı için hepsini görür.
 *
 * Bedeli üretimde şu oldu: Admin SDK yolu bozulunca (kimlik bilgisi / IAM izni /
 * proje kotası) server action `500` döndü ve iki koleksiyon da BOŞ kaldı.
 * Boş kalınca paneller kilitlendi:
 *
 *   - direkt transfer panelinde hazırlık göstergesi `products.length > 0`
 *     bekliyordu → panel sonsuza kadar "Sistem Hazırlanıyor…"da kaldı,
 *   - ürün kullanım panelinde `barcodeFormats.length > 0` bekleniyordu →
 *     "SİSTEM HAZIR" hiç olmadı, ürün düşümü yapılamadı.
 *
 * Tek bir arıza noktası tüm uygulamayı durduruyordu. Artık server action
 * düşerse `src/lib/master-data.ts` içindeki Web SDK karşılıklarına geçilir —
 * aynı fonksiyonları masaüstü terminali de kullanır, yani yedek yol zaten
 * üretimde çalışan bir yoldur.
 *
 * Sonuç kısmen eksik olabilir: etiketsiz eski kayıtlar yedek yolda gelmez.
 * Bunu `degraded` bayrağı söyler. Kilitlenmek yerine kısıtlı çalışmak.
 */

import type { BarcodeFormat } from '@/lib/barcode';
import type { ProductCode } from '@/lib/types';
import { fetchBarcodeFormats, fetchProductCodes } from '@/lib/master-data';
import { firebaseLogger } from '@/lib/logger';

export type MasterDataResult<T> = {
  items: T[];
  /** true → server action düştü, istemci SDK yedeğinden okundu. */
  degraded: boolean;
  /** Yedeğe düşüldüyse asıl sebep. */
  reason?: string;
};

function describe(error: unknown): string {
  const message = (error as any)?.message;
  return typeof message === 'string' && message ? message : String(error);
}

/**
 * Önce Admin SDK server action'ı dener, düşerse Web SDK yedeğine geçer.
 *
 * İKİSİ DE düşerse hata FIRLATILIR — çağıran (React Query / hook) hatayı
 * görsün diye. Sessizce boş dizi döndürmek panelleri yine sonsuz "yükleniyor"
 * durumunda bırakırdı; asıl düzeltilen davranış tam olarak budur.
 */
async function readWithFallback<T>(
  label: string,
  viaServerAction: () => Promise<T[]>,
  viaWebSdk: () => Promise<T[]>,
): Promise<MasterDataResult<T>> {
  try {
    return { items: await viaServerAction(), degraded: false };
  } catch (actionError) {
    const reason = describe(actionError);
    firebaseLogger.warn(
      `${label}: sunucu tarafı (Admin SDK) okuma başarısız, Web SDK yedeğine düşülüyor`,
      { reason },
    );
    try {
      return { items: await viaWebSdk(), degraded: true, reason };
    } catch (webSdkError) {
      firebaseLogger.error(`${label}: Web SDK yedeği de başarısız`, webSdkError, { reason });
      throw new Error(`${label} okunamadı. Sunucu: ${reason} · İstemci: ${describe(webSdkError)}`);
    }
  }
}

export async function fetchProductCodesResilient(
  companyId: string | null | undefined,
  isSuperAdmin: boolean,
): Promise<MasterDataResult<ProductCode>> {
  return readWithFallback<ProductCode>(
    'Ürün kodları',
    async () => {
      const { getProductCodesAction } = await import('@/actions/stokActions');
      return (await getProductCodesAction(companyId, isSuperAdmin)) as unknown as ProductCode[];
    },
    () => fetchProductCodes(companyId, isSuperAdmin),
  );
}

export async function fetchBarcodeFormatsResilient(
  companyId: string | null | undefined,
  isSuperAdmin: boolean,
): Promise<MasterDataResult<BarcodeFormat>> {
  const result = await readWithFallback<BarcodeFormat>(
    'Barkod formatları',
    async () => {
      const { getBarcodeFormatsAction } = await import('@/actions/stokActions');
      return (await getBarcodeFormatsAction(companyId, isSuperAdmin)) as unknown as BarcodeFormat[];
    },
    () => fetchBarcodeFormats(companyId, isSuperAdmin),
  );
  // Her iki yol da öncelik sırasını garanti etmeli; server action sıralamaz.
  return {
    ...result,
    items: result.items
      .slice()
      .sort((a, b) => ((a as any).priority ?? 10) - ((b as any).priority ?? 10)),
  };
}
