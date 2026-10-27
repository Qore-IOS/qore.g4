/**
 * @fileoverview Sipariş karşılama yazma katmanı — TEK KAYNAK.
 *
 * Bir siparişin toplanıp sevk edilmesi, direkt transferle AYNI fiziksel olayı
 * üretir: stok depodan çıkar, laboratuvara geçer, seri geçmişi ve defter
 * kaydı oluşur. Tek farkı, olayın bir siparişe bağlı olması ve sipariş
 * belgesinin kapanmasıdır.
 *
 * Bu yüzden burada ikinci bir stok yazma mantığı YOKTUR:
 * `applyTransferItemWrites` (bkz. `src/lib/direkt-transfer/write.ts`) aynen
 * kullanılır, sipariş bağlamı ona parametre olarak verilir. Bu modül yalnızca
 * siparişe özgü iki şeyi ekler:
 *
 *   1. FEFO toplama listesi üretimi
 *   2. Siparişin kapanışı (tam karşılandıysa arşive, kısmiyse `kismi`)
 */

import { doc, serverTimestamp, type WriteBatch } from '../data/client';
import { compareAsc, parse as parseDate } from 'date-fns';

import { db } from '../data/client';
import { archiveCompletedOrderInBatch } from '@/lib/orders-archive';
import { getStockItemQuantity } from '@/lib/stock-quantity';
import { aggregateOrderItemsByProduct } from '@/lib/siparisler/picking';
import type { DepoStokItem, Order, OrderItem, ProductCode } from '@/lib/types';

/** Toplama listesinin tek satırı. */
export type PickingRow = {
  stokKodu: string;
  stokAdi: string;
  /** Siparişte istenen adet. */
  istenen: number;
  /** FEFO'ya göre önerilen ilk kalem — kullanıcıya "nereden al" der. */
  onerilenLot: string;
  onerilenMiad: string;
  onerilenRaf: string;
  /** Depoda bu ürün için toplam kullanılabilir adet. */
  mevcut: number;
};

/**
 * Miadı en yakın olan önce: FEFO.
 *
 * Miad `dd.MM.yyyy` metni olarak saklanır; ayrıştırılamayan kayıtlar sıralamayı
 * bozmamak için eşit sayılır (mevcut toplama ekranıyla aynı davranış).
 */
export function sortByFefo<T extends { miad?: unknown }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    try {
      return compareAsc(
        parseDate(String(a.miad ?? ''), 'dd.MM.yyyy', new Date()),
        parseDate(String(b.miad ?? ''), 'dd.MM.yyyy', new Date()),
      );
    } catch {
      return 0;
    }
  });
}

/**
 * Sipariş kalemlerinden toplama listesi üretir.
 *
 * Aynı ürün koddan birden çok satır varsa tek satıra indirgenir
 * (`aggregateOrderItemsByProduct`) — web toplama ekranıyla aynı kural.
 */
export function buildPickingList(
  order: Pick<Order, 'items'>,
  depotStock: DepoStokItem[],
  productCodes: ProductCode[],
): PickingRow[] {
  const requested = aggregateOrderItemsByProduct<OrderItem>(order.items || []);

  return requested.map(item => {
    const stokKodu = item.stokKodu || '';
    const forProduct = sortByFefo(depotStock.filter(s => s.stokKodu === stokKodu));
    const suggested = forProduct[0];
    const product = productCodes.find(p => p.stokKodu === stokKodu);

    return {
      stokKodu,
      stokAdi: product?.stokAdi || item.stokAdi || suggested?.stokAdi || '',
      istenen: item.adet ?? 0,
      onerilenLot: suggested?.lotNumarasi || '—',
      onerilenMiad: typeof suggested?.miad === 'string' ? suggested.miad : '—',
      onerilenRaf: suggested?.rafAdresi || '—',
      mevcut: forProduct.reduce((n, s) => n + getStockItemQuantity(s), 0),
    };
  });
}

/**
 * Siparişin kapanışını batch'e ekler.
 *
 * Tam karşılandıysa sipariş `ordersArchive`'a taşınır (kopyala + sil) —
 * `orders` yalnızca aktif siparişleri tutar ve süresiz büyümez. Kısmi
 * karşılamada kalan kalemler yazılır ve durum `kismi` olur.
 *
 * Bu kural web toplama ekranından çıkarılmıştır; iki yolun siparişi farklı
 * biçimde kapatması, sipariş listelerinde birbirini tutmayan durumlar demekti.
 *
 * @returns Sipariş tamamen karşılandı mı?
 */
export function applyOrderCompletionWrite(
  batch: WriteBatch,
  params: {
    order: Order;
    /** Ürün kodu → sevk edilen toplam adet. */
    shippedByCode: Record<string, number>;
    actorUid: string | null;
    actorName: string | null;
  },
): boolean {
  const { order, shippedByCode, actorUid, actorName } = params;

  const remainingPool = { ...shippedByCode };
  const remainingItems = (order.items || [])
    .map(item => {
      const code = item.stokKodu || '';
      const available = remainingPool[code] || 0;
      const subtract = Math.min(item.adet ?? 0, available);
      if (subtract > 0) remainingPool[code] = available - subtract;
      return { ...item, adet: (item.adet ?? 0) - subtract };
    })
    .filter(item => item.adet > 0);

  const complete = remainingItems.length === 0;

  if (complete) {
    archiveCompletedOrderInBatch(batch, order.id, order as unknown as Record<string, unknown>, {
      transferredAt: serverTimestamp(),
      transferredById: actorUid,
      transferredBy: actorName || 'Bilinmeyen Kullanıcı',
      completedAt: serverTimestamp(),
    });
  } else {
    batch.update(doc(db, 'orders', order.id), {
      items: remainingItems,
      status: 'kismi',
      partialTransferAt: serverTimestamp(),
    });
  }

  return complete;
}
