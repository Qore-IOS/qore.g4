import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type CeomedItem = {
  stokKodu?: string;
  lot?: string;
  miyat?: string;
  adet?: number | string;
};

type SupplierOrderItem = {
  stokKodu?: string;
  stokAdi?: string;
  siparisAdedi?: number;
  /** Ceomed stok girişlerinden bu kaleme düşen kümülatif giriş adedi */
  alinanAdet?: number;
};

/**
 * Stok kodunu kanonik forma indirger (baştaki sıfırlar atılır) — Ceomed ile yerel
 * kodlar arasındaki sıfır farkına karşı. Panel tarafındaki normCode ile aynıdır.
 */
function normCode(value: unknown): string {
  const code = String(value ?? '').trim();
  return code.replace(/^0+/, '') || code;
}

/** Lot kimliği: aynı stok kodunun farklı lot/miadları ayrı satırlardır. */
function lotKey(item: CeomedItem): string {
  return `${item.stokKodu ?? ''}|${item.lot ?? ''}|${item.miyat ?? ''}`;
}

/**
 * İki senkron fotoğrafı arasındaki **girişleri** stok koduna göre toplar.
 *
 * Lot bazında POZİTİF değişimler toplanır: yeni bir lot belirdiyse tamamı,
 * mevcut bir lot arttıysa artış kadarı giriş sayılır. Net fark yerine lot bazlı
 * pozitif fark kullanılır; böylece mal girişiyle eş zamanlı tüketim, gelen malı
 * maskelemez.
 */
export function computeIncomingByCode(
  beforeItems: CeomedItem[],
  afterItems: CeomedItem[],
): Map<string, number> {
  const beforeByLot = new Map<string, number>();
  for (const item of beforeItems || []) {
    beforeByLot.set(lotKey(item), (beforeByLot.get(lotKey(item)) || 0) + (Number(item?.adet) || 0));
  }

  const incoming = new Map<string, number>();
  for (const item of afterItems || []) {
    const code = normCode(item?.stokKodu);
    if (!code) continue;
    const current = Number(item?.adet) || 0;
    const previous = beforeByLot.get(lotKey(item)) || 0;
    const delta = current - previous;
    if (delta > 0) incoming.set(code, (incoming.get(code) || 0) + delta);
  }
  return incoming;
}

function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Ceomed entegre bir ana depoya mal girişi yapıldığında, o depoya ait bekleyen
 * tedarikçi siparişlerini otomatik tamamlar.
 *
 * Gelen adetler eski siparişten yeniye (FIFO) dağıtılır; bir siparişin TÜM
 * kalemlerinde alınan adet sipariş adedine ulaştığında sipariş `tamamlandi`
 * olur. Kısmi girişler `items[].alinanAdet` üzerinde birikir, böylece birden
 * fazla senkrona yayılan teslimatlar da toplanır.
 */
export const onCeomedStockSyncedCompleteSupplierOrders = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .firestore.document('ceomedDepoStok/{depotId}')
  .onWrite(async (change, context) => {
    const depotId = context.params.depotId as string;
    const after = change.after.exists ? (change.after.data() as any) : null;
    if (!after) return;
    const before = change.before.exists ? (change.before.data() as any) : null;

    const incoming = computeIncomingByCode(before?.items || [], after?.items || []);
    if (incoming.size === 0) return;

    let pendingSnap: FirebaseFirestore.QuerySnapshot;
    try {
      pendingSnap = await db
        .collection('supplierOrders')
        .where('anaDepoId', '==', depotId)
        .where('status', '==', 'bekliyor')
        .get();
    } catch (err) {
      logger.error(`[supplierOrderAutoComplete] Bekleyen siparişler okunamadı (${depotId}):`, err);
      return;
    }
    if (pendingSnap.empty) return;

    // FIFO: en eski sipariş önce karşılanır.
    const orders = pendingSnap.docs.sort(
      (a, b) => toMillis(a.data()?.createdAt) - toMillis(b.data()?.createdAt),
    );

    const remaining = new Map(incoming);
    const updates: Array<{ ref: FirebaseFirestore.DocumentReference; payload: Record<string, unknown> }> = [];

    for (const orderDoc of orders) {
      const data = orderDoc.data() as { items?: SupplierOrderItem[] };
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) continue;

      let touched = false;
      const nextItems = items.map((item) => {
        const code = normCode(item?.stokKodu);
        const ordered = Number(item?.siparisAdedi) || 0;
        const already = Number(item?.alinanAdet) || 0;
        const need = Math.max(0, ordered - already);
        if (!code || need <= 0) return item;

        const available = remaining.get(code) || 0;
        if (available <= 0) return item;

        const allocated = Math.min(need, available);
        remaining.set(code, available - allocated);
        touched = true;
        return { ...item, alinanAdet: already + allocated };
      });

      if (!touched) continue;

      const complete = nextItems.every(
        (item) => (Number(item?.alinanAdet) || 0) >= (Number(item?.siparisAdedi) || 0),
      );

      const payload: Record<string, unknown> = { items: nextItems };
      if (complete) {
        payload.status = 'tamamlandi';
        payload.completedAt = admin.firestore.FieldValue.serverTimestamp();
        payload.completedBy = 'Otomatik (Ceomed stok girişi)';
        payload.autoCompleted = true;
      }
      updates.push({ ref: orderDoc.ref, payload });

      if (Array.from(remaining.values()).every((qty) => qty <= 0)) break;
    }

    if (updates.length === 0) return;

    try {
      const batch = db.batch();
      updates.forEach(({ ref, payload }) => batch.set(ref, payload, { merge: true }));
      await batch.commit();
      const completed = updates.filter((u) => u.payload.status === 'tamamlandi').length;
      logger.info(
        `[supplierOrderAutoComplete] ${depotId}: ${updates.length} sipariş güncellendi, ${completed} tanesi tamamlandı.`,
      );
    } catch (err) {
      logger.error(`[supplierOrderAutoComplete] Sipariş güncellenemedi (${depotId}):`, err);
    }
  });
