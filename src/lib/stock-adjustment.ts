'use client';

/**
 * Yönetici (admin) stok adedi düzeltmesi.
 *
 * Stok yönetimi panelinde bir satırın adedi elle değiştirilebilir:
 *  - Adet ARTIRILIRSA → eksik adet kadar yeni depoStok dokümanı oluşturulur ve
 *    bu giriş bir MAL KABUL kaydı (malKabulTransactions + lines) olarak yazılır.
 *  - Adet AZALTILIRSA → fazla dokümanlar silinir ve düşümün izlenebilmesi için
 *    LOG yazılır (stockAdjustmentLogs).
 * Her iki durumda da bir stockAdjustmentLogs kaydı tutulur.
 *
 * Bir depoStok dokümanı birden fazla fiziksel birimi temsil edebilir (toplu mal
 * kabul tek dokümana adet=N yazar), bu yüzden azaltmada dokümanlar sırayla
 * ağırlıklarınca (adet alanı) düşülür: yetmeyen kısım için doküman tamamen
 * silinir, kalan kısım için `adet` alanı kısmi olarak azaltılır.
 */
import { collection, doc, writeBatch, Timestamp } from './data/client';
import { db } from './data/client';
import { withCompanyScope } from '@/lib/company-scope';
import { appendSerialEventToBatch } from '@/lib/serial-ledger/client';

export interface AdjustableStockRow {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  miad?: string;
  anaBirim?: string;
  quantity: number;
  itemIds: string[];
  itemAdets?: Record<string, number>;
  /**
   * itemId → seriNumarasi. Silinen bir birimin Seri No Defteri satırını
   * `serbest` yapmak için gereklidir; aksi hâlde seri kalıcı olarak "depoda"
   * görünür ve aynı fiziksel ürün bir daha mal kabul edilemez.
   */
  itemSerials?: Record<string, string>;
  urunGrubu?: 'kit' | 'sarf';
  ambalajDegeri?: number;
  rafAdresi?: string;
}

export interface AdjustParams {
  row: AdjustableStockRow;
  newQuantity: number;
  depotId: string;
  depotName: string;
  companyId: string | null | undefined;
  user: { uid: string; name: string };
  reason: string;
}

export interface AdjustResult {
  direction: 'increase' | 'decrease';
  diff: number;
  created: number;
  deleted: number;
  transactionId?: string;
}

const genId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

export async function adjustGroupedStockQuantity(params: AdjustParams): Promise<AdjustResult> {
  const { row, newQuantity, depotId, depotName, companyId, user, reason } = params;
  const current = Number(row.quantity) || 0;
  const target = Math.max(0, Math.floor(Number(newQuantity)));
  const diff = target - current;
  if (diff === 0) throw new Error('Adet değişmedi.');
  const qtyOf = (id: string) => row.itemAdets?.[id] ?? 1;
  if (diff < 0 && Math.abs(diff) > row.itemIds.reduce((s, id) => s + qtyOf(id), 0)) {
    throw new Error('Silinecek stok kaydı sayısı yetersiz.');
  }

  const now = Timestamp.now();
  const batch = writeBatch(db);
  let created = 0;
  let deleted = 0;
  let transactionId: string | undefined;
  const affectedItemIds: string[] = [];

  if (diff > 0) {
    // ARTIŞ → mal kabul kaydı + yeni depoStok dokümanları
    transactionId = `MK-DZ-${genId()}`;
    const txRef = doc(db, 'malKabulTransactions', transactionId);
    batch.set(txRef, withCompanyScope({
      transactionId,
      depotId, depotName,
      userId: user.uid, userName: user.name,
      timestamp: now,
      itemCount: diff,
      brands: [],
      mode: 'manual-adjustment',
      note: reason,
    }, companyId));
    batch.set(doc(collection(txRef, 'lines')), withCompanyScope({
      stokKodu: row.stokKodu, stokAdi: row.stokAdi,
      lotNumarasi: row.lotNumarasi || '', miad: row.miad || '',
      adet: diff, serials: [],
    }, companyId));

    for (let i = 0; i < diff; i++) {
      batch.set(doc(collection(db, 'depoStok')), withCompanyScope({
        stokKodu: row.stokKodu, stokAdi: row.stokAdi,
        lotNumarasi: row.lotNumarasi || '', miad: row.miad || '',
        seriNumarasi: '', rafAdresi: row.rafAdresi || '',
        depotId, depotName,
        irsaliyeNumarasi: transactionId,
        isShipped: false,
        urunGrubu: row.urunGrubu, ambalajDegeri: row.ambalajDegeri,
        eklenmeTarihi: now,
        createdByUid: user.uid, createdByName: user.name,
        manualAdjustment: true,
      }, companyId));
      created++;
    }
  } else {
    // AZALIŞ → dokümanlar sırayla ağırlıklarınca düşülür: tam yetenler tamamen
    // silinir, kısmen yeten son doküman için adet alanı kısmi olarak azaltılır.
    let toRemove = Math.abs(diff);
    for (const id of row.itemIds) {
      if (toRemove <= 0) break;
      const q = qtyOf(id);
      if (q <= toRemove) {
        batch.delete(doc(db, 'depoStok', id));
        toRemove -= q;
        deleted += q;
        // Belge tamamen silindi → birim depodan çıktı. Defterde `serbest`
        // işaretlenir; depo sayımıyla düşülen bir birimle aynı davranış:
        // aynı seri yeniden mal kabul edilebilir, transfer edilebilir ve
        // tüketilebilir.
        const serial = row.itemSerials?.[id];
        if (serial) {
          appendSerialEventToBatch(batch, {
            type: 'duzeltme',
            status: 'serbest',
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            seriNumarasi: serial,
            lotNumarasi: row.lotNumarasi || '',
            miad: row.miad || '',
            source: { locationType: 'depot', locationId: depotId, locationName: depotName },
            location: { locationType: 'none', locationId: '', locationName: '' },
            refs: { depoStokId: id, depotId },
            actorUid: user.uid,
            actorName: user.name,
            details: { reason, adjustment: 'decrease' },
          }, companyId);
        }
      } else {
        batch.update(doc(db, 'depoStok', id), { adet: q - toRemove });
        deleted += toRemove;
        toRemove = 0;
      }
      affectedItemIds.push(id);
    }
  }

  // Her iki yönde de iz kaydı
  batch.set(doc(collection(db, 'stockAdjustmentLogs')), withCompanyScope({
    type: diff > 0 ? 'increase' : 'decrease',
    stokKodu: row.stokKodu, stokAdi: row.stokAdi,
    lotNumarasi: row.lotNumarasi || '', miad: row.miad || '',
    depotId, depotName,
    previousQuantity: current, newQuantity: target, diff,
    reason,
    relatedTransactionId: transactionId || null,
    deletedItemIds: diff < 0 ? affectedItemIds : [],
    userId: user.uid, userName: user.name,
    timestamp: now,
  }, companyId));

  await batch.commit();
  return { direction: diff > 0 ? 'increase' : 'decrease', diff, created, deleted, transactionId };
}
