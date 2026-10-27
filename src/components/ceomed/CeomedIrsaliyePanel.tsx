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
  getDocs,
  setDoc,
} from '../../lib/data/client';
import { db } from '../../lib/data/client';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/document-helpers';
import { withCompanyScope } from '@/lib/company-scope';
import { useDepots, useHospitals, useProductCodes } from '@/hooks/useDatabaseQueries';
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
  Trash2,
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
  sevkAdresi?: string;
  durumAciklama: string;
  itemCount: number;
  items: CeomedItem[];
  status: 'pending' | 'approved' | 'rejected' | 'deleted';
  syncedAt?: Timestamp;
  approvedAt?: Timestamp;
}

// Sevk adresini normalize et: küçük harf, Türkçe karakterler sadeleşir, noktalama/boşluk temizlenir.
function normalizeAddress(s?: string): string {
  if (!s) return '';
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, ''); // sadece harf+rakam kalsın
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
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { data: hospitals = [] } = useHospitals();
  const { data: depots = [] } = useDepots();
  const { data: productCodes = [] } = useProductCodes();
  const { toast } = useToast();

  const [list, setList] = useState<PendingIrsaliye[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [recordStatusFilter, setRecordStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'deleted' | 'all'>('pending');
  const [tarihBaslangic, setTarihBaslangic] = useState<string>(''); // yyyy-MM-dd input
  const [tarihBitis, setTarihBitis] = useState<string>('');

  const [selected, setSelected] = useState<PendingIrsaliye | null>(null);
  const [approving, setApproving] = useState(false);
  const [targetHospitalId, setTargetHospitalId] = useState<string>('');
  const [targetDepotId, setTargetDepotId] = useState<string>('');

  useEffect(() => {
    // Deps: auth değişimine yanıt vermeli — aksi halde listener stale
    // currentCompanyId/isSuperAdmin ile sabit kalıyordu.
    const q = scopedQuery('pendingCeomedIrsaliye', currentCompanyId, isSuperAdmin);
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
  }, [currentCompanyId, isSuperAdmin]);

  // Depot lookup by ceomedCariKodu
  const depotByCari = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const d of depots) {
      const c = (d as any).ceomedCariKodu;
      if (c) map.set(String(c).trim().toUpperCase(), { id: d.id, name: d.name });
    }
    return map;
  }, [depots]);

  // Product lookup by stokKodu
  const productByStokKodu = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of productCodes) {
      if (p.stokKodu) map.set(String(p.stokKodu).trim(), p);
    }
    return map;
  }, [productCodes]);

  const hospitalById = useMemo(() => {
    const map = new Map<string, any>();
    for (const h of hospitals) map.set(h.id, h);
    return map;
  }, [hospitals]);

  // Aynı cari koduna birden fazla hastane atanabilir (ana + ek hizmetler aynı cariyi paylaşır).
  const hospitalsByCari = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const h of hospitals as any[]) {
      const c = h.ceomedCariKodu ? String(h.ceomedCariKodu).trim().toUpperCase() : '';
      if (!c) continue;
      const arr = map.get(c);
      if (arr) arr.push(h); else map.set(c, [h]);
    }
    return map;
  }, [hospitals]);

  /**
   * Bir irsaliye için hedef laboratuvarı çözer.
   * - Aynı cariyi paylaşan tüm hastaneler + onların ek hizmetleri aday havuzunu oluşturur.
   * - İrsaliyenin sevkAdresi bu havuzdaki bir hastanenin sevkAdresi ile birebir eşleşirse hedef odur.
   * - Eşleşme yoksa varsayılan: ek hizmeti olan ana hastane (yoksa cariyi paylaşan ilk hastane).
   */
  const resolveTarget = useMemo(() => {
    return (irs: PendingIrsaliye) => {
      const cari = (irs.cariKodu || '').trim().toUpperCase();
      const withCode = hospitalsByCari.get(cari) || [];
      if (withCode.length === 0) {
        return { mainId: null, mainName: null, routedId: null, routedName: null, matchedByAddress: false, ambiguous: false };
      }
      // Aday havuz: cariyi paylaşan hastaneler + ek hizmet çocukları (dedup)
      const candMap = new Map<string, any>();
      for (const h of withCode) {
        candMap.set(h.id, h);
        for (const ekId of (h.ekHizmetLabIds || [])) {
          const ek = hospitalById.get(ekId);
          if (ek) candMap.set(ek.id, ek);
        }
      }
      const candidates = Array.from(candMap.values());
      // Varsayılan ana: ek hizmeti olan hastane (yoksa ilk)
      const mainHospital = withCode.find((h) => (h.ekHizmetLabIds || []).length > 0) || withCode[0];

      const irsAddr = normalizeAddress(irs.sevkAdresi);
      let routed: any = null;
      let ambiguous = false;
      if (irsAddr) {
        const matches = candidates.filter((c) => c?.sevkAdresi && normalizeAddress(c.sevkAdresi) === irsAddr);
        if (matches.length === 1) routed = matches[0];
        else if (matches.length > 1) { routed = matches[0]; ambiguous = true; }
      }
      const target = routed || mainHospital;
      return {
        mainId: mainHospital.id,
        mainName: mainHospital.name,
        routedId: target.id,
        routedName: target.name,
        matchedByAddress: !!routed && routed.id !== mainHospital.id,
        ambiguous,
      };
    };
  }, [hospitalsByCari, hospitalById]);

  // Detay açılınca sevk adresine göre hedefi otomatik seç
  useEffect(() => {
    if (!selected) { setTargetHospitalId(''); return; }
    const t = resolveTarget(selected);
    setTargetHospitalId(t.routedId || '');
  }, [selected, resolveTarget]);

  const filtered = useMemo(() => {
    return list.filter((i) => {
      if (recordStatusFilter !== 'all' && i.status !== recordStatusFilter) return false;
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
  }, [list, statusFilter, recordStatusFilter, tarihBaslangic, tarihBitis]);

  const handleDelete = async (irs: PendingIrsaliye) => {
    const wasApproved = irs.status === 'approved';
    const note = wasApproved
      ? `${irs.irsaliyeNo} silinsin mi? Bu irsaliyeden eklenen tüm stok kayıtları da SİLİNECEK ve sync bunu bir daha yüklemeyecek.`
      : `${irs.irsaliyeNo} silinsin mi? Sync bunu bir daha yüklemeyecek.`;
    if (!confirm(note)) return;
    try {
      // Approved ise depoStok'tan ceomedIrsaliyeId eşleşen kayıtları temizle
      let removedStock = 0;
      if (wasApproved) {
        const stockSnap = await getDocs(
          scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('ceomedIrsaliyeId', '==', irs.ceomedId))
        );
        removedStock = stockSnap.size;
        for (let i = 0; i < stockSnap.docs.length; i += 400) {
          const chunk = stockSnap.docs.slice(i, i + 400);
          const batch = writeBatch(db);
          chunk.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }
      // Soft-delete: dokümanı silme, status='deleted' işaretle ki sync bir daha geri getirmesin
      await updateDoc(doc(db, 'pendingCeomedIrsaliye', irs.id), {
        status: 'deleted',
        deletedAt: serverTimestamp(),
        deletedBy: currentUser?.uid || null,
        deletedByName: currentUserProfile?.name || currentUser?.email || '',
      });
      toast({
        title: 'Silindi',
        description: wasApproved
          ? `${irs.irsaliyeNo}: ${removedStock} stok kaydı temizlendi, irsaliye işaretlendi.`
          : `${irs.irsaliyeNo} silindi.`,
      });
      setSelected(null);
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Hata', description: e.message, variant: 'destructive' });
    }
  };

  const handleApprove = async (irs: PendingIrsaliye) => {
    const cari = (irs.cariKodu || '').trim().toUpperCase();
    // Hastane hedefi: adres-farkındalı, çoklu-cari çözümü
    const resolved = resolveTarget(irs);
    // Depo hedefi: ceomedCariKodu eşleşen depo
    const mainDepotMatch = depotByCari.get(cari);

    if (!resolved.mainId && !mainDepotMatch) {
      toast({
        title: 'Eşleşme yok',
        description: `${irs.cariKodu} kodlu cariye karşılık gelen laboratuvar/depo bulunamadı. Yönetim → Laboratuvarlar veya Yönetim → Depolar'dan Ceomed Cari Kodu alanını doldurun.`,
        variant: 'destructive',
      });
      return;
    }

    const mainMatch = resolved.mainId ? { id: resolved.mainId, name: resolved.mainName as string } : null;
    const targetHospital = resolved.mainId
      ? hospitals.find((h) => h.id === (targetHospitalId || resolved.routedId || resolved.mainId))
      : null;
    const targetDepot = mainDepotMatch
      ? depots.find((d) => d.id === (targetDepotId || mainDepotMatch.id))
      : null;

    const useDepot = !!targetDepotId || (!targetHospital && !!targetDepot);
    if (!useDepot && !targetHospital) {
      toast({ title: 'Hata', description: 'Hedef laboratuvar bulunamadı.', variant: 'destructive' });
      return;
    }
    if (useDepot && !targetDepot) {
      toast({ title: 'Hata', description: 'Hedef depo bulunamadı.', variant: 'destructive' });
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
        if (product.trackingMode !== 'serial') {
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
                depotId: useDepot ? targetDepot!.id : '',
                depotName: useDepot ? targetDepot!.name : '',
                stokKodu: item.STOK_KODU,
                stokAdi: product.stokAdi || '',
                lotNumarasi: item.LOT || '',
                miad: item.MIYAT ? normalizeMiad(item.MIYAT) : '',
                seriNumarasi: item.BARKOD_SERI || '',
                rafAdresi: '',
                irsaliyeNumarasi: irs.irsaliyeNo,
                eklenmeTarihi: Timestamp.now(),
                isShipped: !useDepot,
                // Kuruma direkt aktarımda onay anı = sevk anı; Total Verimlilik
                // "Ay Başı Sevk (Kutu)" otomatik doldurma bu tarihe göre sayar.
                sevkTarihi: useDepot ? null : Timestamp.now(),
                hedefKurumId: useDepot ? '' : targetHospital!.id,
                hedefKurum: useDepot ? '' : targetHospital!.name,
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

      if (useDepot) {
        const txRef = doc(db, 'malKabulTransactions', `MK-CEOMED-${irs.ceomedId}`);
        const lineMap = new Map<string, { stokKodu: string; stokAdi: string; lotNumarasi: string; miad: string; adet: number; serials: string[] }>();
        for (const item of irs.items || []) {
          const product = productByStokKodu.get(String(item.STOK_KODU).trim());
          if (!product || product.trackingMode !== 'serial') continue;
          const key = `${item.STOK_KODU}||${item.LOT || ''}||${item.MIYAT || ''}`;
          const prev = lineMap.get(key) || { stokKodu: item.STOK_KODU, stokAdi: product.stokAdi || '', lotNumarasi: item.LOT || '', miad: item.MIYAT ? normalizeMiad(item.MIYAT) : '', adet: 0, serials: [] };
          prev.adet += Math.max(1, Number(item.MIKTAR) || 1);
          if (item.BARKOD_SERI) prev.serials.push(item.BARKOD_SERI);
          lineMap.set(key, prev);
        }
        const lineBatch = writeBatch(db);
        lineBatch.set(txRef, withCompanyScope({
          transactionId: `MK-CEOMED-${irs.ceomedId}`,
          depotId: targetDepot!.id,
          depotName: targetDepot!.name,
          userId: currentUser?.uid || '',
          userName: currentUserProfile?.name || currentUser?.email || 'Ceomed Sync',
          timestamp: Timestamp.now(),
          irsaliyeNo: irs.irsaliyeNo,
          itemCount: added,
          mode: 'verified',
          source: 'ceomed',
          ceomedIrsaliyeId: irs.ceomedId,
        }, currentCompanyId));
        for (const line of lineMap.values()) {
          lineBatch.set(doc(collection(txRef, 'lines')), withCompanyScope(line, currentCompanyId));
        }
        await lineBatch.commit();
      }

      await updateDoc(doc(db, 'pendingCeomedIrsaliye', irs.id), {
        status: 'approved',
        approvedAt: serverTimestamp(),
        approvedBy: currentUser?.uid || null,
        approvedByName: currentUserProfile?.name || currentUser?.email || '',
        hospitalId: useDepot ? null : targetHospital!.id,
        hospitalName: useDepot ? null : targetHospital!.name,
        depotId: useDepot ? targetDepot!.id : null,
        depotName: useDepot ? targetDepot!.name : null,
        mainHospitalId: mainMatch?.id || null,
        mainHospitalName: mainMatch?.name || null,
        mainDepotId: mainDepotMatch?.id || null,
        mainDepotName: mainDepotMatch?.name || null,
        routedTo: (!useDepot && mainMatch && targetHospital && targetHospital.id !== mainMatch.id) ? targetHospital.id : null,
      });

      toast({
        title: 'İrsaliye onaylandı',
        description:
          `${useDepot ? targetDepot!.name : targetHospital!.name} stoğuna ${added} kayıt eklendi.` +
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

  const handleRestore = async (irs: PendingIrsaliye) => {
    await updateDoc(doc(db, 'pendingCeomedIrsaliye', irs.id), {
      status: 'pending',
      restoredAt: serverTimestamp(),
    });
    toast({ title: 'Geri yüklendi', description: `${irs.irsaliyeNo} tekrar onay bekliyor.` });
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
            laboratuvar/depo hedefine seri takipli ürünler aktarılır.
          </p>
        </div>
      </div>

      {/* Filtreler */}
      <div className="px-6 pb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-[var(--dashboard-muted)] mb-1 block">Kayıt</label>
          <Select value={recordStatusFilter} onValueChange={(v) => setRecordStatusFilter(v as any)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Onay Bekleyen</SelectItem>
              <SelectItem value="approved">Onaylanan</SelectItem>
              <SelectItem value="rejected">Reddedilen</SelectItem>
              <SelectItem value="deleted">Silinen</SelectItem>
              <SelectItem value="all">Tümü</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-[var(--dashboard-muted)] mb-1 block">ERP Durumu</label>
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
          <div className="flex flex-col items-center justify-center py-10 text-[var(--dashboard-muted)] text-center px-4">
            <Package className="h-8 w-8 mb-2 opacity-50" />
            {list.length === 0 ? (
              <>
                <p className="text-sm font-medium">Bu firma için kayıt bulunamadı.</p>
                <p className="text-xs mt-2 max-w-md">
                  Sync yazdığı dokümanlara <code className="px-1 rounded bg-black/10">companyId</code> tag'i koymuyor olabilir.
                  Sync makinasındaki <code className="px-1 rounded bg-black/10">.env</code> dosyasına{' '}
                  <code className="px-1 rounded bg-black/10">CEOMED_COMPANY_ID</code> ekleyip{' '}
                  <code className="px-1 rounded bg-black/10">node backfillCompanyId.js</code> bir kere çalıştırılmalı
                  (eski tag'siz kayıtlar tag'lenir, yeni kayıtlar otomatik tag'lenmeye başlar).
                </p>
              </>
            ) : (
              <p className="text-sm">
                {recordStatusFilter === 'pending'
                  ? 'Onay bekleyen irsaliye yok.'
                  : recordStatusFilter === 'approved'
                  ? 'Onaylanan irsaliye yok.'
                  : recordStatusFilter === 'rejected'
                  ? 'Reddedilen irsaliye yok.'
                  : recordStatusFilter === 'deleted'
                  ? 'Silinen irsaliye yok.'
                  : 'Filtre sonucu boş.'}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((i) => {
              const matchT = resolveTarget(i);
              const match = matchT.mainId ? { id: matchT.mainId, name: matchT.mainName as string } : null;
              const depotMatch = depotByCari.get((i.cariKodu || '').trim().toUpperCase());
              const statusBadge =
                i.status === 'approved'
                  ? { text: 'Onaylandı', cls: 'bg-emerald-100 text-emerald-700' }
                  : i.status === 'rejected'
                  ? { text: 'Reddedildi', cls: 'bg-red-100 text-red-700' }
                  : i.status === 'deleted'
                  ? { text: 'Silindi', cls: 'bg-gray-200 text-gray-600' }
                  : { text: 'Bekliyor', cls: 'bg-amber-100 text-amber-700' };
              return (
                <div
                  key={i.id}
                  className="w-full rounded-2xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] hover:bg-[var(--dashboard-surface)] transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 p-4">
                    <button
                      onClick={() => setSelected(i)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-sm">{i.irsaliyeNo}</span>
                        <span className="text-xs text-[var(--dashboard-muted)]">{i.tarih}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadge.cls}`}>
                          {statusBadge.text}
                        </span>
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
                        {match ? (() => {
                          const t = resolveTarget(i);
                          return t.matchedByAddress ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                              <CheckCircle className="h-3 w-3" /> Yönlendirildi: {t.routedName} <span className="text-[var(--dashboard-muted)]">(adres eşleşti)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                              <CheckCircle className="h-3 w-3" /> Eşleşti: {match.name}
                            </span>
                          );
                        })() : depotMatch ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                            <CheckCircle className="h-3 w-3" /> Eşleşti (depo): {depotMatch.name}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
                            <AlertTriangle className="h-3 w-3" /> Eşleşmedi (ceomedCariKodu yok)
                          </span>
                        )}
                      </div>
                    </button>
                    <div className="text-right shrink-0 flex items-center gap-3">
                      <div>
                        <div className="text-lg font-bold">{i.itemCount}</div>
                        <div className="text-[10px] text-[var(--dashboard-muted)]">barkod</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(i);
                        }}
                        className="p-2 rounded-lg hover:bg-red-100 text-red-500 transition-colors"
                        title="Sil"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detay Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setTargetHospitalId(''); setTargetDepotId(''); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {selected?.irsaliyeNo} — {selected?.cariUnvan}
            </DialogTitle>
          </DialogHeader>
          {selected && (() => {
            const cari = (selected.cariKodu || '').trim().toUpperCase();
            const withCode = (hospitalsByCari.get(cari) || []) as any[];
            const mainHospital = withCode.find((h) => (h.ekHizmetLabIds || []).length > 0) || withCode[0] || null;
            // Aday havuz: cariyi paylaşan tüm hastaneler + ek hizmet çocukları (ana hariç, dropdown için)
            const candMap = new Map<string, any>();
            for (const h of withCode) {
              for (const ekId of (h.ekHizmetLabIds || [])) {
                const ek = hospitalById.get(ekId);
                if (ek) candMap.set(ek.id, ek);
              }
              // Cariyi paylaşan diğer hastaneler de seçilebilir olsun
              if (mainHospital && h.id !== mainHospital.id) candMap.set(h.id, h);
            }
            const ekHizmetLabs = Array.from(candMap.values()) as { id: string; name: string }[];
            const showRouting = selected.status === 'pending' && mainHospital && ekHizmetLabs.length > 0;
            return (
              <>
                {showRouting && (() => {
                  const t = resolveTarget(selected);
                  return (
                  <div className="rounded-xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] p-3 mb-2">
                    <label className="text-xs text-[var(--dashboard-muted)] mb-1 block">
                      Hedef Laboratuvar (yönlendirme)
                    </label>
                    {selected.sevkAdresi && (
                      <p className="text-[11px] text-[var(--dashboard-muted)] mb-1">
                        İrsaliye sevk adresi: <span className="font-medium">{selected.sevkAdresi}</span>
                      </p>
                    )}
                    {t.matchedByAddress && (
                      <p className="text-[11px] text-emerald-600 mb-1 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Sevk adresi eşleşti — otomatik "{t.routedName}" seçildi.
                        {t.ambiguous && ' (Birden fazla eşleşme, ilki seçildi — kontrol edin.)'}
                      </p>
                    )}
                    <Select
                      value={targetHospitalId || mainHospital!.id}
                      onValueChange={(v) => setTargetHospitalId(v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={mainHospital!.id}>
                          {mainHospital!.name} (Ana)
                        </SelectItem>
                        {ekHizmetLabs.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name} (Ek hizmet)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  );
                })()}
                <div className="flex-1 overflow-y-auto space-y-2 pr-2">
              {(selected.items || []).map((item, idx) => {
                const product = productByStokKodu.get(String(item.STOK_KODU).trim());
                const isSeri = product?.trackingMode === 'serial';
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
              </>
            );
          })()}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="text-red-600 hover:bg-red-50"
              onClick={() => selected && handleDelete(selected)}
              disabled={approving}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Sil
            </Button>
            {selected?.status === 'pending' && (
              <>
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
              </>
            )}
            {(selected?.status === 'deleted' || selected?.status === 'rejected') && (
              <Button onClick={() => selected && handleRestore(selected)}>
                Geri Yükle
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
