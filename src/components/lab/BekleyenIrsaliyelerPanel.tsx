'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle, Trash2, ChevronRight, Inbox, FileText, Wand2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  doc,
  writeBatch,
  deleteDoc,
} from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { matchesCompanyScope, withCompanyScope } from '@/lib/company-scope';
import type { BekleyenIrsaliye, BekleyenIrsaliyeItem } from '@/lib/types';
import { touchStockMetadata, useInvalidateQueries } from '@/hooks/useFirebaseQueries';
import { normalizeMiad } from '@/lib/date';
import { generateId } from '@/lib/utils';
import TimestampText from '@/components/TimestampText';

interface BekleyenIrsaliyelerPanelProps {
  /** Hangi konum türü için bekleyen irsaliyeleri göstereceğimiz. */
  locationType: 'hospital' | 'depot';
  locationId: string;
  locationName: string;
}

export default function BekleyenIrsaliyelerPanel({
  locationType,
  locationId,
  locationName,
}: BekleyenIrsaliyelerPanelProps) {
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const { invalidateDepoStok } = useInvalidateQueries();
  const [allItems, setAllItems] = useState<BekleyenIrsaliye[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIrsaliye, setSelectedIrsaliye] = useState<BekleyenIrsaliye | null>(null);
  const [transferring, setTransferring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId) {
      setAllItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, 'bekleyenIrsaliyeler'), orderBy('scannedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: BekleyenIrsaliye[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as any;
        if (!matchesCompanyScope(data, currentCompanyId, isSuperAdmin)) return;
        if (data.status !== 'pending') return;
        // Only show invoices linked to the selected location of the right type.
        if (data.locationType !== locationType || data.locationId !== locationId) return;
        list.push({ id: docSnap.id, ...data } as BekleyenIrsaliye);
      });
      setAllItems(list);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsubscribe();
  }, [locationType, locationId, currentCompanyId, isSuperAdmin]);

  const items = useMemo(() => allItems, [allItems]);

  const handleTransfer = async (irsaliye: BekleyenIrsaliye) => {
    if (!currentUserProfile) {
      toast({ title: 'Hata', description: 'Bu işlemi yapmak için giriş yapmalısınız.', variant: 'destructive' });
      return;
    }
    const matched = irsaliye.items.filter(i => i.stokKodu && i.convertedQuantity > 0);
    if (matched.length === 0) {
      toast({ title: 'Aktarılacak ürün yok', description: 'Bu irsaliyede geçerli ürün bulunmuyor.', variant: 'destructive' });
      return;
    }
    if (!confirm(`${irsaliye.dosyaName}\n\n${matched.length} ürün, toplam ${irsaliye.totalConvertedQuantity} birim ${locationName} stoğuna aktarılacak. Devam edilsin mi?`)) {
      return;
    }

    setTransferring(irsaliye.id);
    try {
      const userName = currentUserProfile.name || currentUserProfile.email || 'Bilinmeyen';
      const userUid = currentUserProfile.uid || currentUser?.uid || null;
      const irsaliyeNo = irsaliye.irsaliyeNumber || irsaliye.dosyaName;
      // For depots we mirror the Ceomed flow: depoStok docs use depotId/depotName
      // and a malKabulTransactions document is written so the receipt shows up in
      // mal kabul geçmişi. Hospitals keep the old "shipped to lab" semantics.
      const isDepot = locationType === 'depot';
      const transactionId = isDepot ? `MK-IRS-${generateId()}` : '';
      // Aggregate lines per stokKodu+lot+miad for mal kabul transaction.
      const lineMap = new Map<string, {
        stokKodu: string;
        stokAdi: string;
        lotNumarasi: string;
        miad: string;
        adet: number;
        serials: string[];
      }>();

      let written = 0;
      let docsInBatch = 0;
      let batch = writeBatch(db);
      const commitAndReset = async () => {
        if (docsInBatch === 0) return;
        await batch.commit();
        batch = writeBatch(db);
        docsInBatch = 0;
      };

      for (const item of matched) {
        const qty = Math.max(1, Math.round(item.convertedQuantity || 0));
        const miadNorm = item.miad ? (normalizeMiad(item.miad) || item.miad) : '';
        if (isDepot) {
          const key = `${item.stokKodu}||${item.lot || ''}||${miadNorm}`;
          const prev = lineMap.get(key) || {
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi || item.stokKodu,
            lotNumarasi: item.lot || '',
            miad: miadNorm,
            adet: 0,
            serials: [] as string[],
          };
          prev.adet += qty;
          lineMap.set(key, prev);
        }
        for (let i = 0; i < qty; i++) {
          const ref = doc(collection(db, 'depoStok'));
          const base = isDepot
            ? {
                depotId: locationId,
                depotName: locationName,
                stokKodu: item.stokKodu,
                stokAdi: item.stokAdi || item.stokKodu,
                lotNumarasi: item.lot || '',
                miad: miadNorm,
                seriNumarasi: '',
                rafAdresi: '',
                irsaliyeNumarasi: irsaliye.irsaliyeNumber || '',
                eklenmeTarihi: Timestamp.now(),
                isShipped: false,
                hedefKurumId: '',
                hedefKurum: '',
                createdByName: userName,
                createdByUid: userUid,
                source: 'bekleyen_irsaliye',
                kaynak: 'bekleyen_irsaliye',
                kaynakDosyaId: irsaliye.dosyaId,
                kaynakIrsaliyeId: irsaliye.id,
                kaynakIrsaliyeNumarasi: irsaliye.irsaliyeNumber || null,
                malKabulTransactionId: transactionId,
              }
            : {
                stokKodu: item.stokKodu,
                stokAdi: item.stokAdi || item.stokKodu,
                lotNumarasi: item.lot || '',
                miad: miadNorm,
                seriNumarasi: '',
                isShipped: true,
                hedefKurumId: locationId,
                hedefKurum: locationName,
                eklenmeTarihi: Timestamp.now(),
                sevkTarihi: Timestamp.now(),
                kaynak: 'bekleyen_irsaliye',
                kaynakDosyaId: irsaliye.dosyaId,
                kaynakIrsaliyeId: irsaliye.id,
                kaynakIrsaliyeNumarasi: irsaliye.irsaliyeNumber || null,
                createdByName: userName,
                createdByUid: userUid,
              };
          batch.set(ref, withCompanyScope(base, currentCompanyId));
          docsInBatch += 1;
          written += 1;
          if (docsInBatch >= 450) await commitAndReset();
        }
      }

      // For depot transfers: write malKabulTransactions header + lines so the
      // receipt appears in mal kabul geçmişi exactly like a Ceomed approval.
      if (isDepot) {
        const txRef = doc(db, 'malKabulTransactions', transactionId);
        batch.set(txRef, withCompanyScope({
          transactionId,
          depotId: locationId,
          depotName: locationName,
          userId: userUid || '',
          userName,
          timestamp: Timestamp.now(),
          irsaliyeNo,
          itemCount: written,
          brands: irsaliye.brands || [],
          mode: 'verified',
          source: 'bekleyen_irsaliye',
          kaynakIrsaliyeId: irsaliye.id,
          kaynakDosyaId: irsaliye.dosyaId,
        }, currentCompanyId));
        docsInBatch += 1;
        for (const line of lineMap.values()) {
          const lineRef = doc(collection(txRef, 'lines'));
          batch.set(lineRef, withCompanyScope(line, currentCompanyId));
          docsInBatch += 1;
          if (docsInBatch >= 450) await commitAndReset();
        }
      }

      // Mark the pending invoice as transferred in the final batch.
      batch.update(doc(db, 'bekleyenIrsaliyeler', irsaliye.id), {
        status: 'transferred',
        transferredAt: Timestamp.now(),
        transferredByUid: userUid,
        transferredByName: userName,
        ...(transactionId ? { malKabulTransactionId: transactionId } : {}),
      });
      await batch.commit();
      await touchStockMetadata();
      await invalidateDepoStok();

      toast({
        title: 'Stoğa aktarıldı',
        description: isDepot
          ? `${written} kayıt ${locationName} deposuna eklendi. Mal kabul geçmişine yazıldı.`
          : `${written} birim ürün ${locationName} stoğuna eklendi.`,
      });
      setSelectedIrsaliye(null);
    } catch (err: any) {
      console.error('Transfer error:', err);
      toast({ title: 'Hata', description: err?.message || 'Stoğa aktarma sırasında hata oluştu.', variant: 'destructive' });
    } finally {
      setTransferring(null);
    }
  };

  const handleCancel = async (irsaliye: BekleyenIrsaliye) => {
    if (!confirm(`${irsaliye.dosyaName} bekleyen irsaliyesi silinecek. Dosya yönetimindeki PDF'i etkilemez. Devam edilsin mi?`)) {
      return;
    }
    setDeleting(irsaliye.id);
    try {
      await deleteDoc(doc(db, 'bekleyenIrsaliyeler', irsaliye.id));
      toast({ title: 'Silindi', description: 'Bekleyen irsaliye listeden kaldırıldı.' });
      if (selectedIrsaliye?.id === irsaliye.id) setSelectedIrsaliye(null);
    } catch (err: any) {
      toast({ title: 'Hata', description: err?.message || 'Silinemedi.', variant: 'destructive' });
    } finally {
      setDeleting(null);
    }
  };

  if (!locationId) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Inbox className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Bekleyen İrsaliyeler</h3>
        <span className="text-xs text-muted-foreground">({items.length})</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Dosya yönetiminde taranıp onaylanmış irsaliyeler. Bir satıra tıklayıp ürünleri inceleyip stoğa aktarabilirsiniz.
      </p>

      <div className="border rounded-lg overflow-hidden bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 px-4 text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Bu {locationType === 'depot' ? 'depo' : 'laboratuvar'} için bekleyen irsaliye bulunmuyor.
            <p className="text-xs mt-1">Dosya yönetiminde bir PDF irsaliye tarayıp onayladığınızda burada görünür.</p>
          </div>
        ) : (
          <div className="divide-y">
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => setSelectedIrsaliye(it)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
              >
                <FileText className="h-4 w-4 text-red-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">
                      {it.brands.length > 0 ? it.brands.join(' • ') : (it.supplierName || it.dosyaName)}
                    </p>
                    {it.irsaliyeNumber && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">
                        #{it.irsaliyeNumber}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                    <span>
                      <strong className="text-foreground">{it.itemCount}</strong> ürün ·{' '}
                      <strong className="text-foreground">{it.totalConvertedQuantity}</strong> birim
                    </span>
                    {it.irsaliyeDate && <span>İrs. Tarihi: {it.irsaliyeDate}</span>}
                    <span>
                      Tarandı: <TimestampText value={it.scannedAt} />
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!selectedIrsaliye} onOpenChange={(o) => { if (!o) setSelectedIrsaliye(null); }}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {selectedIrsaliye?.dosyaName}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {selectedIrsaliye?.brands.length ? `Markalar: ${selectedIrsaliye.brands.join(', ')}` : ''}
              {selectedIrsaliye?.irsaliyeNumber ? ` · No: ${selectedIrsaliye.irsaliyeNumber}` : ''}
              {selectedIrsaliye?.irsaliyeDate ? ` · Tarih: ${selectedIrsaliye.irsaliyeDate}` : ''}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 px-5 py-3">
            {selectedIrsaliye && (
              <div className="space-y-2">
                {selectedIrsaliye.items.map((it: BekleyenIrsaliyeItem, idx: number) => (
                  <div key={idx} className="border rounded-lg p-3 grid grid-cols-12 gap-2 items-center bg-card">
                    <div className="col-span-12 sm:col-span-5 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium truncate">{it.stokAdi}</p>
                        {it.matchConfidence === 'low' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">düşük güven</span>
                        )}
                        {it.matchConfidence === 'medium' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">orta güven</span>
                        )}
                        {it.conversionApplied && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-0.5">
                            <Wand2 className="h-2.5 w-2.5" /> AI dönüştürdü
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-muted-foreground">{it.stokKodu}</p>
                      {it.marka && <p className="text-[10px] text-muted-foreground">{it.marka}</p>}
                      {it.conversionReasoning && (
                        <p className="text-[10px] text-muted-foreground italic mt-1">{it.conversionReasoning}</p>
                      )}
                    </div>
                    <div className="col-span-4 sm:col-span-2 text-xs">
                      <span className="text-muted-foreground">Lot:</span>{' '}
                      <span className="font-mono">{it.lot || '-'}</span>
                    </div>
                    <div className="col-span-4 sm:col-span-2 text-xs">
                      <span className="text-muted-foreground">Miad:</span> {it.miad || '-'}
                    </div>
                    <div className="col-span-4 sm:col-span-1 text-right text-xs">
                      <p className="text-muted-foreground text-[10px]">Faturadaki</p>
                      <p className="font-medium">{it.sourceQuantity} {it.sourceUnit || ''}</p>
                    </div>
                    <div className="col-span-12 sm:col-span-2 text-right">
                      <p className="text-[10px] text-emerald-700 font-semibold">{it.anaBirim || it.convertedUnit || 'Adet'}</p>
                      <p className="text-base font-bold">{it.convertedQuantity}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <DialogFooter className="px-5 py-3 border-t flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {selectedIrsaliye && (
                <span>
                  Toplam: <strong>{selectedIrsaliye.itemCount}</strong> çeşit,{' '}
                  <strong>{selectedIrsaliye.totalConvertedQuantity}</strong> birim
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => selectedIrsaliye && handleCancel(selectedIrsaliye)}
                disabled={deleting === selectedIrsaliye?.id || transferring === selectedIrsaliye?.id}
              >
                {deleting === selectedIrsaliye?.id ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Siliniyor</>
                ) : (
                  <><Trash2 className="h-4 w-4 mr-1" /> İptal Et</>
                )}
              </Button>
              <Button
                onClick={() => selectedIrsaliye && handleTransfer(selectedIrsaliye)}
                disabled={transferring === selectedIrsaliye?.id || deleting === selectedIrsaliye?.id}
              >
                {transferring === selectedIrsaliye?.id ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Aktarılıyor</>
                ) : (
                  <><CheckCircle className="h-4 w-4 mr-1" /> Stoğa Aktar</>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
