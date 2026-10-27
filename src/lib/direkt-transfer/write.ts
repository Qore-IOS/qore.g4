/**
 * @fileoverview Direkt transfer yazma katmanı — TEK KAYNAK.
 *
 * Bir stok kaleminin depodan laboratuvara (ya da borç deposuna) taşınırken
 * ürettiği yazımları tanımlar:
 *
 *   - `depoStok`        → kalem sevk edilmiş olarak işaretlenir (kısmi
 *                          transferde kaynak azaltılır + hedef için yeni belge)
 *   - `serialHistory`   → seri numarasının hareket geçmişi
 *   - Seri No Defteri   → `transfer` / `borc` olayı (ve hedefte tüketim takibi
 *                          kapalıysa ek `tuketim` olayı)
 *   - `transfers/items` → sevk irsaliyesinin satırı
 *   - `tuketimKayitlari`→ hedefte takip kapalıysa doğrudan tüketim kaydı
 *
 * NEDEN AYRI BİR MODÜL:
 * Bu mantık `direkt-transfer-panel.tsx` içindeki 200 satırlık bir döngüde
 * yaşıyordu. Masaüstü terminali (`/terminal/transfer`) aynı koleksiyonlara
 * yazdığı için ikinci bir kopya, iki uygulamanın stoğu farklı şekillerde
 * güncellemesi anlamına gelirdi. Panelin orkestrasyonu (tahsis, optimistik UI,
 * tutanak basımı) kendisinde kalır; BELGE ÜRETİMİ burada tek yerdedir.
 */

import {
  Timestamp,
  collection,
  doc,
  type WriteBatch,
  type DocumentReference,
} from '../data/client';

import { db } from '../data/client';
import { withCompanyScope } from '@/lib/company-scope';
import { getStockItemQuantity } from '@/lib/stock-quantity';
import type { SerialEventInput } from '@/lib/serial-ledger/core';
import type { ConsumptionRecord, DepoStokItem } from '@/lib/types';

/** Transfer sırasında kalem başına taşınacak adedi taşıyan genişletilmiş tip. */
export type TransferableStockItem = DepoStokItem & { transferAdet?: number };

/** Bir transfer oturumunun değişmeyen bağlamı. */
export type TransferWriteContext = {
  /** Bu transferin `transfers` belgesi — kalem yazımları buna bağlanır. */
  transferRef: DocumentReference;
  sourceDepotId: string;
  sourceDepotName: string;
  /** Borç modunda hedef laboratuvar yoktur. */
  targetHospitalId: string | null;
  targetName: string;
  isBorcMode: boolean;
  /** Borç modunda hedef borç deposu kimliği. */
  targetBorcDepotId?: string | null;
  /** Borç modunda ilgili firma. */
  company?: string | null;
  /**
   * Hedef laboratuvarda tüketim takibi KAPALI mı?
   *
   * Kapalıysa transfer aynı anda tüketim sayılır: kalem hedef stoğa
   * yazılmaz, doğrudan `tuketimKayitlari`'na düşer.
   */
  trackingDisabled: boolean;
  actorUid: string | null;
  actorName: string | null;
  /** `stokKodu → { anaBirim, ambalajDegeri }` — irsaliye satırı için. */
  productMetaByCode?: Map<string, { anaBirim?: string; ambalajDegeri?: number | null }>;
  /**
   * Bu sevkiyat bir siparişi karşılıyorsa siparişin kimliği.
   *
   * Verildiğinde defter olayı `transfer` yerine `siparis_karsilama` tipiyle
   * yazılır ve `refs.orderId` doldurulur — sipariş karşılama ile serbest
   * transfer, geçmişte birbirinden ayırt edilebilmelidir.
   */
  orderId?: string | null;
};

/** Tek bir kalemin yazımından dönen, çağıranın ihtiyaç duyduğu bilgiler. */
export type TransferItemWriteResult = {
  /** Bu kalem için taşınan adet. */
  transferQty: number;
  /** Hedefteki `depoStok` belge kimliği (kısmi transferde yeni kimlik). */
  targetDocId: string;
  /**
   * Bu kalemin ürettiği Seri No Defteri olayları.
   *
   * BİLEREK batch'e yazılmaz: bir transfer yüzlerce kalem içerebilir ve defter
   * olayları tek `writeBatch`'in 500 işlem sınırını aşar. Çağıran bunları
   * toplar ve stok yazımı BAŞARILI olduktan sonra `appendSerialEvents()` ile
   * partiler hâlinde yazar. Defter türetilmiş bir dizindir; stok yazımının
   * atomikliğini onun için riske atmayız.
   */
  ledgerEvents: SerialEventInput[];
};

/**
 * Tek bir stok kaleminin transfer yazımlarını verilen batch'e ekler.
 *
 * @returns Taşınan adet, hedef belge kimliği ve (yazılmamış) defter olayları.
 */
export function applyTransferItemWrites(
  batch: WriteBatch,
  item: TransferableStockItem,
  ctx: TransferWriteContext,
  companyId: string | null | undefined,
): TransferItemWriteResult {
  const transferQty = item.transferAdet ?? getStockItemQuantity(item);
  const originalQty = getStockItemQuantity(item);
  const isPartial = transferQty < originalQty;
  const ledgerEvents: SerialEventInput[] = [];

  // Kısmi transferde hedef için YENİ belge gerekir; tam transferde mevcut
  // belge yerinde güncellenir.
  const targetRef = isPartial ? doc(collection(db, 'depoStok')) : doc(db, 'depoStok', item.id);
  const targetDocId = targetRef.id;

  const buildConsumptionRecord = (): Omit<ConsumptionRecord, 'id'> => ({
    stokKodu: item.stokKodu,
    stokAdi: item.stokAdi,
    lotNumarasi: item.lotNumarasi || '',
    miad: item.miad as never,
    seriNumarasi: item.seriNumarasi || '',
    laboratoryId: ctx.targetHospitalId || '',
    laboratoryName: ctx.targetName,
    consumptionTimestamp: new Date(),
    consumptionType: 'normal_kullanim' as const,
    userId: ctx.actorUid ?? 'unknown',
    userName: ctx.actorName ?? 'Unknown User',
  });

  if (isPartial) {
    // 1) Kaynak belgeden taşınan adedi düş.
    batch.update(doc(db, 'depoStok', item.id), { adet: originalQty - transferQty });

    if (ctx.trackingDisabled) {
      batch.set(
        doc(collection(db, 'tuketimKayitlari')),
        withCompanyScope(buildConsumptionRecord(), companyId),
      );
    } else {
      // 2) Taşınan kısım için hedef belgesi oluştur.
      const targetData: Record<string, unknown> = {
        ...item,
        id: targetDocId,
        adet: transferQty,
        isShipped: true,
        sevkTarihi: Timestamp.now(),
        hedefKurum: ctx.targetName,
        hedefKurumId: ctx.targetHospitalId,
        transferId: ctx.transferRef.id,
        sourceDepotId: ctx.sourceDepotId,
        sourceDepotName: ctx.sourceDepotName,
      };
      delete targetData.transferAdet;
      batch.set(targetRef, targetData);
    }
  } else if (ctx.trackingDisabled) {
    // Tam transfer + hedefte takip kapalı → stok belgesi silinir, tüketim yazılır.
    batch.delete(targetRef);
    batch.set(
      doc(collection(db, 'tuketimKayitlari')),
      withCompanyScope(buildConsumptionRecord(), companyId),
    );
  } else {
    // Tam transfer → mevcut belge sevk edilmiş olarak işaretlenir.
    batch.set(
      targetRef,
      {
        isShipped: true,
        sevkTarihi: Timestamp.now(),
        hedefKurum: ctx.targetName,
        hedefKurumId: ctx.targetHospitalId,
        transferId: ctx.transferRef.id,
        sourceDepotId: ctx.sourceDepotId,
        sourceDepotName: ctx.sourceDepotName,
      },
      { merge: true },
    );
  }

  if (ctx.isBorcMode) {
    batch.set(
      doc(collection(db, 'borcTransfers')),
      withCompanyScope(
        {
          fromDepotId: ctx.sourceDepotId,
          toBorcDepotId: ctx.targetBorcDepotId,
          company: ctx.company,
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          lot: item.lotNumarasi,
          miad: item.miad,
          seriNumarasi: item.seriNumarasi,
          isReturned: false,
          timestamp: Timestamp.now(),
          adet: transferQty,
        },
        companyId,
      ),
    );
  }

  if (item.seriNumarasi) {
    batch.set(doc(collection(db, `serialHistory/${item.seriNumarasi}/events`)), {
      type: 'transfer',
      transferId: ctx.transferRef.id,
      details: {
        sourceDepotId: ctx.sourceDepotId,
        sourceDepotName: ctx.sourceDepotName,
        targetName: ctx.targetName,
        targetHospitalId: ctx.targetHospitalId,
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        lotNumarasi: item.lotNumarasi,
        miad: item.miad,
        adet: transferQty,
      },
      timestamp: Timestamp.now(),
    });

    ledgerEvents.push({
      type: ctx.isBorcMode ? 'borc' : ctx.orderId ? 'siparis_karsilama' : 'transfer',
      stokKodu: item.stokKodu,
      stokAdi: item.stokAdi,
      seriNumarasi: item.seriNumarasi,
      lotNumarasi: item.lotNumarasi || '',
      miad: typeof item.miad === 'string' ? item.miad : '',
      source: {
        locationType: 'depot',
        locationId: ctx.sourceDepotId,
        locationName: ctx.sourceDepotName,
      },
      location: ctx.isBorcMode
        ? { locationType: 'borc', locationId: ctx.targetBorcDepotId || '', locationName: ctx.targetName }
        : { locationType: 'lab', locationId: ctx.targetHospitalId || '', locationName: ctx.targetName },
      refs: {
        transferId: ctx.transferRef.id,
        depoStokId: targetDocId,
        ...(ctx.orderId ? { orderId: ctx.orderId } : {}),
      },
      actorUid: ctx.actorUid,
      actorName: ctx.actorName,
      details: { adet: transferQty, company: ctx.isBorcMode ? ctx.company ?? null : null },
    });

    // Hedefte tüketim takibi kapalıysa transfer aynı anda tüketimdir.
    if (ctx.trackingDisabled) {
      ledgerEvents.push({
        type: 'tuketim',
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        seriNumarasi: item.seriNumarasi,
        lotNumarasi: item.lotNumarasi || '',
        miad: typeof item.miad === 'string' ? item.miad : '',
        source: {
          locationType: 'lab',
          locationId: ctx.targetHospitalId || '',
          locationName: ctx.targetName,
        },
        refs: {
          transferId: ctx.transferRef.id,
          ...(ctx.orderId ? { orderId: ctx.orderId } : {}),
        },
        actorUid: ctx.actorUid,
        actorName: ctx.actorName,
        details: { reason: 'hedefte_tuketim_takibi_kapali' },
      });
    }
  }

  const meta = ctx.productMetaByCode?.get(item.stokKodu || '');
  batch.set(doc(db, 'transfers', ctx.transferRef.id, 'items', targetDocId), {
    stokKodu: item.stokKodu,
    stokAdi: item.stokAdi,
    lotNumarasi: item.lotNumarasi || '',
    miad: item.miad || '',
    seriNumarasi: item.seriNumarasi || '',
    adet: transferQty,
    anaBirim: meta?.anaBirim || 'Adet',
    ambalajDegeri: meta?.ambalajDegeri ?? null,
  });

  return { transferQty, targetDocId, ledgerEvents };
}

/** Transfer başlığının (`transfers/{id}`) gövdesini üretir. */
export function buildTransferHeader(
  ctx: TransferWriteContext,
  totalShippedAdet: number,
  timestamp: unknown,
) {
  return {
    id: ctx.transferRef.id,
    timestamp,
    sourceDepotId: ctx.sourceDepotId,
    sourceDepotName: ctx.sourceDepotName,
    targetName: ctx.targetName,
    targetHospitalId: ctx.targetHospitalId || null,
    mode: ctx.isBorcMode ? ('borc' as const) : ('lab' as const),
    company: ctx.isBorcMode ? ctx.company ?? null : null,
    itemCount: totalShippedAdet,
    createdByUid: ctx.actorUid ?? '',
    createdByName: ctx.actorName ?? '',
  };
}
