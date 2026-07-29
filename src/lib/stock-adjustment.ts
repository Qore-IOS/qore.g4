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
 * depoStok'ta adet alanı yoktur: her doküman bir fiziksel birimdir, bu yüzden
 * adet = doküman sayısıdır.
 */
import { collection, doc, writeBatch, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { withCompanyScope } from '@/lib/company-scope';

export interface AdjustableStockRow {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  miad?: string;
  anaBirim?: string;
  quantity: number;
  itemIds: string[];
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
  if (diff < 0 && Math.abs(diff) > row.itemIds.length) {
    throw new Error('Silinecek stok kaydı sayısı yetersiz.');
  }

  const now = Timestamp.now();
  const batch = writeBatch(db);
  let created = 0;
  let deleted = 0;
  let transactionId: string | undefined;

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
    // AZALIŞ → fazla dokümanları sil (log aşağıda yazılır)
    row.itemIds.slice(0, Math.abs(diff)).forEach((id) => {
      batch.delete(doc(db, 'depoStok', id));
      deleted++;
    });
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
    deletedItemIds: diff < 0 ? row.itemIds.slice(0, Math.abs(diff)) : [],
    userId: user.uid, userName: user.name,
    timestamp: now,
  }, companyId));

  await batch.commit();
  return { direction: diff > 0 ? 'increase' : 'decrease', diff, created, deleted, transactionId };
}
