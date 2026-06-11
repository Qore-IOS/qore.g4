/**
 * Tamamlanan sipariş arşivi (`ordersArchive`).
 *
 * Siparişler tamamlandığında (`status: 'completed'`) `orders` koleksiyonunda
 * BIRAKILMAZ; aynı atomik `writeBatch` içinde `ordersArchive`'a taşınır
 * (kopyala + sil). Böylece canlı `orders` koleksiyonu yalnızca aktif
 * siparişleri (pending / toplaniyor / eksik) tutar ve süresiz büyümez —
 * sipariş panelinin canlı dinleyicisi küçük ve hızlı kalır.
 *
 * Okuma tarafı:
 *  - Tamamlanan listelerini gösteren paneller hem `orders` (status==completed,
 *    backfill öncesi kalanlar) hem `ordersArchive`'ı okuyup birleştirir
 *    (`mergeOrdersById`) — geçiş döneminde veri kaybı olmaz.
 *  - ID ile tekil sipariş arayan yerler `orders`'ta bulamazsa arşive düşer
 *    (`getOrderDocWithArchiveFallback`).
 */
import {
  doc,
  getDoc,
  serverTimestamp,
  type DocumentData,
  type DocumentSnapshot,
  type WriteBatch,
} from 'firebase/firestore';
import { getDocResilient } from '@/lib/firestore-network-recovery';
import { db } from '@/lib/firebase';

export const ORDERS_COLLECTION = 'orders';
export const ORDERS_ARCHIVE_COLLECTION = 'ordersArchive';

/**
 * Tamamlanan bir siparişi, verilen `batch` içinde `orders`'tan `ordersArchive`'a
 * taşır: arşive tam kopyayı yazar, canlı koleksiyondan siler. Çağıran taraf
 * `batch.commit()` ile atomik olarak işler.
 *
 * @param batch        Açık writeBatch.
 * @param orderId      Sipariş doküman id'si (arşivde de aynı id kullanılır).
 * @param orderData    Siparişin tam verisi (id alanı dahil edilebilir; mevcut
 *                     `where('id','in', …)` sorgularıyla uyum için korunur).
 * @param completion   Tamamlama alanları (status, transferredAt/By, vb.).
 */
export function archiveCompletedOrderInBatch(
  batch: WriteBatch,
  orderId: string,
  orderData: DocumentData,
  completion: DocumentData,
): void {
  batch.set(doc(db, ORDERS_ARCHIVE_COLLECTION, orderId), {
    ...orderData,
    ...completion,
    status: 'completed',
    archivedAt: serverTimestamp(),
  });
  batch.delete(doc(db, ORDERS_COLLECTION, orderId));
}

/**
 * Bir siparişi id ile getirir; canlı `orders`'ta yoksa `ordersArchive`'a düşer.
 * Detay/geçmiş ekranları için: tamamlanıp arşive taşınmış siparişler de bulunur.
 */
export async function getOrderDocWithArchiveFallback(
  orderId: string,
): Promise<DocumentSnapshot<DocumentData>> {
  const live = await getDocResilient(doc(db, ORDERS_COLLECTION, orderId));
  if (live.exists()) return live;
  return getDocResilient(doc(db, ORDERS_ARCHIVE_COLLECTION, orderId));
}

/**
 * İki sipariş listesini id'ye göre tekilleştirip birleştirir (ilk gelen kazanır).
 * Tamamlanan listelerini canlı + arşiv kaynaklarından birleştirmek için.
 */
export function mergeOrdersById<T extends { id?: string }>(...lists: T[][]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      const id = item?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
    }
  }
  return out;
}
