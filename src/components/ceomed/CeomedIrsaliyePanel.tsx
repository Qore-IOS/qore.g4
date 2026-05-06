'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  writeBatch,
  Timestamp,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { useHospitals, useProductCodes } from '@/hooks/useFirebaseQueries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { normalizeMiad } from '@/lib/date';
import {
  CheckCircle,
  AlertTriangle,
  Truck,
  Package,
  Loader2,
  Building2,
} from 'lucide-react';

interface CeomedItem {
  BARKOD_SERI: string;
  BARKOD: string;
  STOK_KODU: string;
  LOT: string;
  MIYAT: string;
  MIKTAR: number;
}

interface PendingIrsaliye {
  id: string;
  ceomedId: number;
  irsaliyeNo: string;
  tarih: string; // dd-MM-yyyy
  cariKodu: string;
  cariUnvan: string;
  durumAciklama: string;
  itemCount: number;
  items: CeomedItem[];
  status: 'pending' | 'approved' | 'rejected';
  syncedAt?: Timestamp;
  approvedAt?: Timestamp;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'Tümü' },
  { value: 'KURUMA SEVK EDILDI', label: 'Kuruma Sevk Edildi' },
  { value: 'MALZEME TOPLANABILIR', label: 'Malzeme Toplanabilir' },
  { value: 'MALZEME HAZIRLAMA DEVAM EDIYOR', label: 'Malzeme Hazırlama Devam Ediyor' },
  { value: 'IRSALIYE YAZDIRILABILIR', label: 'İrsaliye Yazdırılabilir' },
  { value: 'IRSALIYE YAZDIRILDI', label: 'İrsaliye Yazdırıldı' },
];

// dd-MM-yyyy -> Date
function parseTarih(s: string): Date | null {
  if (!s) return null;
  const [d, m, y] = s.split('-').map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

export default function CeomedIrsaliyePanel() {
  const { currentUser, currentUserProfile, currentCompanyId } = useAuth();
  const { data: hospitals = [] } = useHospitals();
  const { data: productCodes = [] } = useProductCodes();
  const { toast } = useToast();

  const [list, setList] = useState<PendingIrsaliye[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [tarihBaslangic, setTarihBaslangic] = useState<string>(''); // yyyy-MM-dd input
  const [tarihBitis, setTarihBitis] = useState<string>('');

  const [selected, setSelected] = useState<PendingIrsaliye | null>(null);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'pendingCeomedIrsaliye'),
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: PendingIrsaliye[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PendingIrsaliye, 'id'>),
        }));
        rows.sort((a, b) => (b.tarih || '').localeCompare(a.tarih || ''));
        setList(rows);
        setLoading(false);
      },
      (err) => {
        console.error('pendingCeomedIrsaliye listen error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Hospital lookup by ceomedCariKodu
  const hospitalByCari = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const h of hospitals) {
      const c = (h as any).ceomedCariKodu;
      if (c) map.set(String(c).trim().toUpperCase(), { id: h.id, name: h.name });
    }
    return map;
  }, [hospitals]);

  // Product lookup by stokKodu
  const productByStokKodu = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of productCodes) {
      if (p.stokKodu) map.set(String(p.stokKodu).trim(), p);
    }
    return map;
  }, [productCodes]);

  const filtered = useMemo(() => {
    return list.filter((i) => {
      if (statusFilter !== 'all') {
        if ((i.durumAciklama || '').toUpperCase() !== statusFilter) return false;
      }
      if (tarihBaslangic || tarihBitis) {
        const d = parseTarih(i.tarih);
        if (!d) return false;
        if (tarihBaslangic && d < new Date(tarihBaslangic)) return false;
        if (tarihBitis) {
          const end = new Date(tarihBitis);
          end.setHours(23, 59, 59, 999);
          if (d > end) return false;
        }
      }
      return true;
    });
  }, [list, statusFilter, tarihBaslangic, tarihBitis]);

  const handleApprove = async (irs: PendingIrsaliye) => {
    const match = hospitalByCari.get((irs.cariKodu || '').trim().toUpperCase());
    if (!match) {
      toast({
        title: 'Eşleşme yok',
        description: `${irs.cariKodu} kodlu cariye karşılık gelen laboratuvar bulunamadı. Yönetim → Laboratuvarlar'dan ceomedCariKodu alanını doldurun.`,
        variant: 'destructive',
      });
      return;
    }

    setApproving(true);
    try {
      const batch = writeBatch(db);
      let added = 0;
      let skippedNoProduct = 0;
      let skippedNotSeri = 0;

      for (const item of irs.items || []) {
        const product = productByStokKodu.get(String(item.STOK_KODU).trim());
        if (!product) {
          skippedNoProduct++;
          continue;
        }
        // İlk etapta sadece seri no takipli ürünler
        if (product.trackingMode !== 'seri') {
          skippedNotSeri++;
          continue;
        }
        const qty = Math.max(1, Number(item.MIKTAR) || 1);
        for (let i = 0; i < qty; i++) {
          const ref = doc(collection(db, 'depoStok'));
          batch.set(
            ref,
            withCompanyScope(
              {
                depotId: '',
                depotName: '',
                stokKodu: item.STOK_KODU,
                stokAdi: product.stokAdi || '',
                lotNumarasi: item.LOT || '',
                miad: item.MIYAT ? normalizeMiad(item.MIYAT) : '',
                seriNumarasi: item.BARKOD_SERI || '',
                rafAdresi: '',
                irsaliyeNumarasi: irs.irsaliyeNo,
                eklenmeTarihi: Timestamp.now(),
                isShipped: true,
                hedefKurumId: match.id,
                hedefKurum: match.name,
                createdByName: currentUserProfile?.name || currentUser?.email || 'Ceomed Sync',
                createdByUid: currentUser?.uid || null,
                source: 'ceomed',
                ceomedIrsaliyeId: irs.ceomedId,
              },
              currentCompanyId
            )
          );
          added++;
        }
      }

      await batch.commit();

      await updateDoc(doc(db, 'pendingCeomedIrsaliye', irs.id), {
        status: 'approved',
        approvedAt: serverTimestamp(),
        approvedBy: currentUser?.uid || null,
        approvedByName: currentUserProfile?.name || currentUser?.email || '',
        hospitalId: match.id,
        hospitalName: match.name,
      });

      toast({
        title: 'İrsaliye onaylandı',
        description:
          `${match.name} stoğuna ${added} kayıt eklendi.` +
          (skippedNoProduct ? ` ${skippedNoProduct} ürün eşleşmedi.` : '') +
          (skippedNotSeri ? ` ${skippedNotSeri} ürün seri takipli değil.` : ''),
      });
      setSelected(null);
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Hata',
        description: e.message || 'Onay sırasında hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async (irs: PendingIrsaliye) => {
    if (!confirm(`${irs.irsaliyeNo} reddedilsin mi?`)) return;
    await updateDoc(doc(db, 'pendingCeomedIrsaliye', irs.id), {
      status: 'rejected',
      rejectedAt: serverTimestamp(),
    });
    toast({ title: 'Reddedildi' });
    setSelected(null);
  };

  return (
    <div className="glass-card rounded-3xl overflow-hidden" style={{ borderRadius: '24px' }}>
      <div className="px-6 pt-6 pb-4 flex items-center gap-3">
        <span className="dashboard-panel-icon flex items-center justify-center w-10 h-10 rounded-full shrink-0">
          <Truck className="w-5 h-5" />
        </span>
        <div className="flex-1">
          <h2 className="text-xl font-bold" style={{ color: 'var(--dashboard-text)' }}>
            Ceomed İrsaliyeleri
          </h2>
          <p className="text-sm" style={{ color: 'var(--dashboard-muted)' }}>
            Ceomed ERP'den çekilmiş onay bekleyen irsaliyeler. Cari kodu eşleşen
            laboratuvara seri takipli ürünler aktarılır.
          </p>
        </div>
      </div>

      {/* Filtreler */}
      <div className="px-6 pb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-[var(--dashboard-muted)] mb-1 block">Durum</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-[var(--dashboard-muted)] mb-1 block">Başlangıç</label>
          <Input
            type="date"
            value={tarihBaslangic}
            onChange={(e) => setTarihBaslangic(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-[var(--dashboard-muted)] mb-1 block">Bitiş</label>
          <Input
            type="date"
            value={tarihBitis}
            onChange={(e) => setTarihBitis(e.target.value)}
          />
        </div>
      </div>

      {/* Liste */}
      <div className="px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-[var(--dashboard-muted)]">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Yükleniyor...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-[var(--dashboard-muted)]">
            <Package className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">Onay bekleyen irsaliye yok.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((i) => {
              const match = hospitalByCari.get((i.cariKodu || '').trim().toUpperCase());
              return (
                <button
                  key={i.id}
                  onClick={() => setSelected(i)}
                  className="w-full text-left rounded-2xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] hover:bg-[var(--dashboard-surface)] transition-colors p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{i.irsaliyeNo}</span>
                        <span className="text-xs text-[var(--dashboard-muted)]">{i.tarih}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--dashboard-surface)] text-[var(--dashboard-muted)]">
                          {i.durumAciklama}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[var(--dashboard-muted)] truncate">
                        <Building2 className="h-3 w-3 shrink-0" />
                        <span className="font-mono">{i.cariKodu}</span>
                        <span>•</span>
                        <span className="truncate">{i.cariUnvan}</span>
                      </div>
                      <div className="mt-1">
                        {match ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                            <CheckCircle className="h-3 w-3" /> Eşleşti: {match.name}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
                            <AlertTriangle className="h-3 w-3" /> Eşleşmedi (ceomedCariKodu yok)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold">{i.itemCount}</div>
                      <div className="text-[10px] text-[var(--dashboard-muted)]">barkod</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detay Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {selected?.irsaliyeNo} — {selected?.cariUnvan}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
              {(selected.items || []).map((item, idx) => {
                const product = productByStokKodu.get(String(item.STOK_KODU).trim());
                const isSeri = product?.trackingMode === 'seri';
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-[var(--dashboard-stroke)] p-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">{item.STOK_KODU}</span>
                          {product ? (
                            isSeri ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                Seri Takipli
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                                Seri Takipli Değil — Atlanacak
                              </span>
                            )
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                              Eşleşmedi
                            </span>
                          )}
                        </div>
                        <p className="text-[var(--dashboard-muted)] mt-0.5">
                          {product?.stokAdi || 'Stok kartı yok — açılması gerekiyor'}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px]">
                          <span>Seri: <strong>{item.BARKOD_SERI}</strong></span>
                          {item.LOT && <span>Lot: <strong>{item.LOT}</strong></span>}
                          {item.MIYAT && <span>Miad: <strong>{item.MIYAT}</strong></span>}
                          <span>Adet: <strong>{item.MIKTAR}</strong></span>
                        </div>
                      </div>
                      {!product && (
                        <a
                          href="/yonetim/urun-kodlari"
                          target="_blank"
                          className="text-[11px] text-[var(--dashboard-accent)] underline shrink-0"
                        >
                          Stok kartı aç
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => selected && handleReject(selected)}
              disabled={approving}
            >
              Reddet
            </Button>
            <Button
              onClick={() => selected && handleApprove(selected)}
              disabled={approving}
            >
              {approving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> İşleniyor...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" /> Stoğa Aktar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
