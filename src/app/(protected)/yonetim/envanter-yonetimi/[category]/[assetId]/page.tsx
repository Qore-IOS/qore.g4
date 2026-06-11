
'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import NextImage from 'next/image';
import { Loader2, QrCode, Save, UserCheck, ShieldCheck, History, Printer, Download, ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { doc, getDoc, collection, getDocs, updateDoc, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { getDocsResilient, getDocResilient } from '@/lib/firestore-network-recovery';
import { db } from '@/lib/firebase';
import { filterByCompanyScope, withCompanyScope, matchesCompanyScope } from '@/lib/company-scope';
import QRCode from 'qrcode';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { generateId } from '@/lib/utils';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface Asset {
  id: string;
  category: string;
  demirbasNo: string;
  urunKodu: string;
  urunAdi: string;
  marka: string;
  model: string;
  konum: string;
  teslimEdilenPersonel: string;
  aciklama: string;
  alimFiyatiTl?: number;
  satinAlmaTarihi?: string;
  garantiBitisTarihi?: string;
  planliKullanimOmruYil?: number;
  amortismanYontemi?: 'dogrusal' | 'azalan_bakiye';
  amortismanBaslangicTarihi?: string;
  mulkiyet?: 'satin_alma' | 'kira';
  kiraTutari?: number;
  kiraDonemi?: 'aylik' | 'yillik';
  kiraBitisTarihi?: string;
  maliyetCurrency?: 'EUR' | 'USD' | 'TRY';
  hurdaTarihi?: string;
  imhaTarihi?: string;
  satisTarihi?: string;
  sonBakimTarihi?: string;
  sonrakiBakimTarihi?: string;
  sonKalibrasyonTarihi?: string;
  sonrakiKalibrasyonTarihi?: string;
  bakimMaliyetiTl?: number;
  zimmetliKisi?: string;
  checkOutTarihi?: string;
  checkInTarihi?: string;
  dijitalImza?: string;
  zimmetFisNo?: string;
  seriNumarasi?: string;
}

interface Location { id: string; name: string; }

const inputClass = "w-full h-9 px-3 rounded-xl text-sm bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)] outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/30";

const formatTry = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString('tr-TR')} ₺`
    : '-';

const getOwnershipLabel = (asset: Partial<Asset>) =>
  asset.mulkiyet === 'kira' ? 'Kiralık' : 'Satılık';

const getCostLabel = (asset: Partial<Asset>) => {
  if (asset.mulkiyet === 'kira') {
    const amount = formatTry(asset.kiraTutari);
    const period = asset.kiraDonemi === 'yillik' ? 'yıl' : 'ay';
    return amount === '-' ? '-' : `${amount} / ${period}`;
  }
  return formatTry(asset.alimFiyatiTl);
};

interface AssetHistoryEntry {
  id: string;
  timestamp: any;
  changedBy: string;
  previousState: { konum: string; teslimEdilenPersonel: string };
  newState: { konum: string; teslimEdilenPersonel: string };
}

interface CustodyEntry {
  id: string;
  action: 'check_out' | 'check_in';
  personel: string;
  digitalSignature?: string;
  zimmetFisNo?: string;
  note?: string;
  timestamp: any;
  changedBy: string;
}

function InfoRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--dashboard-stroke)]/50 last:border-0">
      <span className="text-xs text-[var(--dashboard-muted)]">{label}</span>
      <span className={cn("text-sm font-medium", accent ? "text-[var(--dashboard-accent)]" : "text-[var(--dashboard-text)]")}>{value}</span>
    </div>
  );
}

export default function AssetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const assetId = Array.isArray(params.assetId) ? params.assetId[0] : params.assetId;
  const categorySlug = Array.isArray(params.category) ? params.category[0] : params.category;

  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [newLocation, setNewLocation] = useState('');
  const [newPersonel, setNewPersonel] = useState('');
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [custodyHistory, setCustodyHistory] = useState<CustodyEntry[]>([]);
  const [assignmentPerson, setAssignmentPerson] = useState('');
  const [assignmentSignature, setAssignmentSignature] = useState('');
  const [assignmentNote, setAssignmentNote] = useState('');
  // Editable financial/maintenance fields
  const [editMulkiyet, setEditMulkiyet] = useState<'satin_alma' | 'kira'>('satin_alma');
  const [editAlimFiyati, setEditAlimFiyati] = useState<number | ''>('');
  const [editKiraTutari, setEditKiraTutari] = useState<number | ''>('');
  const [editKiraDonemi, setEditKiraDonemi] = useState<'aylik' | 'yillik'>('aylik');
  const [editKiraBitis, setEditKiraBitis] = useState('');
  const [editPlanliOmur, setEditPlanliOmur] = useState<number | ''>('');
  const [editGarantiBitis, setEditGarantiBitis] = useState('');
  const [editSonrakiBakim, setEditSonrakiBakim] = useState('');
  const [editSonrakiKalibrasyon, setEditSonrakiKalibrasyon] = useState('');
  const [isSavingFinancial, setIsSavingFinancial] = useState(false);

  useEffect(() => {
    if (!assetId) { router.back(); return; }
    const load = async () => {
      setLoading(true);
      try {
        const [snap, labsSnap, depotsSnap] = await Promise.all([
          getDocResilient(doc(db, 'assets', assetId)),
          getDocsResilient(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
          getDocsResilient(scopedQuery('depots', currentCompanyId, isSuperAdmin)),
        ]);
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as Asset;
          if (!matchesCompanyScope(data as any, currentCompanyId, isSuperAdmin)) {
            toast({ title: 'Erişim Reddedildi', description: 'Bu ürün şirketinize ait değil.', variant: 'destructive' });
            router.push(`/yonetim/envanter-yonetimi/${categorySlug}`);
            return;
          }
          setAsset(data);
          setNewLocation(data.konum);
          setNewPersonel(data.teslimEdilenPersonel);
          setAssignmentPerson(data.zimmetliKisi || data.teslimEdilenPersonel || '');
          setAssignmentSignature(data.dijitalImza || '');
          setEditMulkiyet(data.mulkiyet || 'satin_alma');
          setEditAlimFiyati(data.alimFiyatiTl ?? '');
          setEditKiraTutari(data.kiraTutari ?? '');
          setEditKiraDonemi(data.kiraDonemi || 'aylik');
          setEditKiraBitis(data.kiraBitisTarihi || '');
          setEditPlanliOmur(data.planliKullanimOmruYil ?? '');
          setEditGarantiBitis(data.garantiBitisTarihi || '');
          setEditSonrakiBakim(data.sonrakiBakimTarihi || '');
          setEditSonrakiKalibrasyon(data.sonrakiKalibrasyonTarihi || '');
        } else {
          toast({ title: 'Bulunamadı', variant: 'destructive' });
        }
        const labs = filterByCompanyScope(
          labsSnap.docs.map(d => ({ id: d.id, name: d.data().name, companyId: (d.data() as any).companyId })),
          currentUserProfile?.companyId, currentUserProfile?.role === 'super_admin'
        ).map(({ id, name }) => ({ id, name }));
        const depots = filterByCompanyScope(
          depotsSnap.docs.map(d => ({ id: d.id, name: d.data().name, companyId: (d.data() as any).companyId })),
          currentUserProfile?.companyId, currentUserProfile?.role === 'super_admin'
        ).map(({ id, name }) => ({ id, name }));
        setLocations([...labs, ...depots].sort((a, b) => a.name.localeCompare(b.name)));

        const [histSnap, custSnap] = await Promise.all([
          getDocsResilient(query(collection(db, 'assets', assetId, 'assetHistory'), orderBy('timestamp', 'desc'))),
          getDocsResilient(query(collection(db, 'assets', assetId, 'custodyHistory'), orderBy('timestamp', 'desc'))),
        ]);
        setHistory(histSnap.docs.map(d => ({ id: d.id, ...d.data() } as AssetHistoryEntry)));
        setCustodyHistory(custSnap.docs.map(d => ({ id: d.id, ...d.data() } as CustodyEntry)));
      } catch {
        toast({ title: 'Hata', description: 'Ürün bilgileri yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [assetId]);

  useEffect(() => {
    if (asset) {
      QRCode.toDataURL(window.location.href, { width: 256, margin: 2 }, (err, url) => {
        setQrCodeDataUrl(err ? '' : url);
      });
    }
  }, [asset]);

  const handleSaveChanges = async () => {
    if (!asset) return;
    if (newLocation === asset.konum && newPersonel === asset.teslimEdilenPersonel) {
      toast({ title: 'Değişiklik Yok' }); return;
    }
    setIsSaving(true);
    try {
      const entry = {
        timestamp: serverTimestamp(),
        changedBy: currentUserProfile?.name || 'Bilinmeyen',
        previousState: { konum: asset.konum, teslimEdilenPersonel: asset.teslimEdilenPersonel },
        newState: { konum: newLocation, teslimEdilenPersonel: newPersonel },
      };
      await addDoc(collection(db, 'assets', asset.id, 'assetHistory'), withCompanyScope(entry, currentUserProfile?.companyId));
      await updateDoc(doc(db, 'assets', asset.id), { konum: newLocation, teslimEdilenPersonel: newPersonel });
      setAsset(prev => prev ? { ...prev, konum: newLocation, teslimEdilenPersonel: newPersonel } : prev);
      setHistory(prev => [{ ...entry, id: generateId(), timestamp: new Date() }, ...prev]);
      toast({ title: 'Kaydedildi' });
    } catch {
      toast({ title: 'Hata', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveFinancial = async () => {
    if (!asset) return;
    setIsSavingFinancial(true);
    try {
      const updates: Record<string, any> = {
        mulkiyet: editMulkiyet,
        alimFiyatiTl: editAlimFiyati === '' ? 0 : editAlimFiyati,
        kiraTutari: editKiraTutari === '' ? 0 : editKiraTutari,
        kiraDonemi: editKiraDonemi,
        kiraBitisTarihi: editKiraBitis,
        planliKullanimOmruYil: editPlanliOmur === '' ? 0 : editPlanliOmur,
        garantiBitisTarihi: editGarantiBitis,
        sonrakiBakimTarihi: editSonrakiBakim,
        sonrakiKalibrasyonTarihi: editSonrakiKalibrasyon,
      };
      await updateDoc(doc(db, 'assets', asset.id), updates);
      setAsset(prev => prev ? { ...prev, ...updates } : prev);
      toast({ title: 'Mali & Bakım Bilgileri Kaydedildi' });
    } catch {
      toast({ title: 'Hata', variant: 'destructive' });
    } finally {
      setIsSavingFinancial(false);
    }
  };

  const createReceiptNo = () => `ZIM-${new Date().getFullYear()}-${generateId().slice(0, 8).toUpperCase()}`;

  const handleCheckOut = async () => {
    if (!asset || !assignmentPerson.trim()) {
      toast({ title: 'Personel zorunlu', variant: 'destructive' }); return;
    }
    setIsSaving(true);
    try {
      const receiptNo = createReceiptNo();
      const nowIso = new Date().toISOString().slice(0, 10);
      await addDoc(collection(db, 'assets', asset.id, 'custodyHistory'), withCompanyScope({
        action: 'check_out', personel: assignmentPerson.trim(), digitalSignature: assignmentSignature.trim(),
        zimmetFisNo: receiptNo, note: assignmentNote.trim(), timestamp: serverTimestamp(),
        changedBy: currentUserProfile?.name || 'Bilinmeyen',
      }, currentCompanyId));
      await updateDoc(doc(db, 'assets', asset.id), {
        zimmetliKisi: assignmentPerson.trim(), teslimEdilenPersonel: assignmentPerson.trim(),
        checkOutTarihi: nowIso, checkInTarihi: '', dijitalImza: assignmentSignature.trim(), zimmetFisNo: receiptNo,
      });
      setAsset(prev => prev ? { ...prev, zimmetliKisi: assignmentPerson.trim(), checkOutTarihi: nowIso, checkInTarihi: '', zimmetFisNo: receiptNo } : prev);
      toast({ title: 'Check-Out Tamamlandı', description: `Fiş: ${receiptNo}` });
    } catch {
      toast({ title: 'Hata', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheckIn = async () => {
    if (!asset) return;
    setIsSaving(true);
    try {
      const nowIso = new Date().toISOString().slice(0, 10);
      await addDoc(collection(db, 'assets', asset.id, 'custodyHistory'), withCompanyScope({
        action: 'check_in', personel: assignmentPerson.trim() || asset.zimmetliKisi || '',
        digitalSignature: assignmentSignature.trim(), zimmetFisNo: asset.zimmetFisNo || '',
        note: assignmentNote.trim(), timestamp: serverTimestamp(),
        changedBy: currentUserProfile?.name || 'Bilinmeyen',
      }, currentCompanyId));
      await updateDoc(doc(db, 'assets', asset.id), { checkInTarihi: nowIso, zimmetliKisi: '' });
      setAsset(prev => prev ? { ...prev, checkInTarihi: nowIso, zimmetliKisi: '' } : prev);
      toast({ title: 'Check-In Tamamlandı' });
    } catch {
      toast({ title: 'Hata', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const depreciationInfo = useMemo(() => {
    if (asset?.mulkiyet === 'kira' || !asset?.alimFiyatiTl || !asset?.planliKullanimOmruYil || !asset?.amortismanBaslangicTarihi) return null;
    const start = new Date(asset.amortismanBaslangicTarihi);
    if (Number.isNaN(start.getTime())) return null;
    const elapsed = Math.max(0, (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
    const life = asset.planliKullanimOmruYil;
    const nbv = asset.amortismanYontemi === 'azalan_bakiye'
      ? asset.alimFiyatiTl * Math.pow(1 - 1 / life, elapsed)
      : asset.alimFiyatiTl * Math.max(0, 1 - elapsed / life);
    return { nbv, remaining: Math.max(0, life - elapsed) };
  }, [asset]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center min-h-screen cihaz-shell">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="cihaz-shell min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-[var(--dashboard-muted)]">Ürün bulunamadı.</p>
        <Link href={`/yonetim/envanter-yonetimi/${categorySlug}`} className="text-sm text-[var(--dashboard-accent)] hover:underline">Geri Dön</Link>
      </div>
    );
  }

  return (
    <div className="cihaz-shell min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-24">

        {/* HEADER */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href={`/yonetim/envanter-yonetimi/${categorySlug}`}
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)] truncate">
              {asset.urunAdi || `${asset.marka} ${asset.model}`}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-[var(--dashboard-muted)]">DB: {asset.demirbasNo}</span>
              {asset.seriNumarasi && <span className="text-xs text-[var(--dashboard-muted)]">· SN: {asset.seriNumarasi}</span>}
              <span className={cn(
                "text-[10px] font-medium px-2 py-0.5 rounded-lg",
                asset.zimmetliKisi ? "bg-sky-500/10 text-sky-600" : "bg-emerald-500/10 text-emerald-600"
              )}>
                {asset.zimmetliKisi ? 'Zimmetli' : 'Boşta'}
              </span>
            </div>
          </div>
        </div>

        {/* TOP GRID: Details + QR */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_0.6fr] gap-5 mb-5">
          {/* Details Card */}
          <div className="cihaz-card-strong p-5 sm:p-6">
            <p className="text-[11px] font-semibold text-[var(--dashboard-accent)] uppercase tracking-wider mb-3">Ürün Bilgileri</p>
            <InfoRow label="Marka / Model" value={`${asset.marka || '-'} / ${asset.model || '-'}`} />
            <InfoRow label="Kategori" value={asset.category} />
            <InfoRow label="Konum" value={asset.konum || '-'} />
            <InfoRow label="Personel" value={asset.teslimEdilenPersonel || '-'} />
            <InfoRow label="Aktif Zimmet" value={asset.zimmetliKisi || '-'} />
            <InfoRow label="Mülkiyet Tipi" value={getOwnershipLabel(asset)} />
            <InfoRow label={asset.mulkiyet === 'kira' ? 'Kira Tutarı' : 'Alım Fiyatı'} value={getCostLabel(asset)} accent />
            {asset.mulkiyet === 'kira' && <InfoRow label="Kira Bitişi" value={asset.kiraBitisTarihi || '-'} />}
            <InfoRow label="Planlı Ömür" value={`${asset.planliKullanimOmruYil || 0} yıl`} />
            <InfoRow label="Garanti Bitişi" value={asset.garantiBitisTarihi || '-'} />
            <InfoRow label="Sonraki Bakım" value={asset.sonrakiBakimTarihi || '-'} />
            <InfoRow label="Sonraki Kalibrasyon" value={asset.sonrakiKalibrasyonTarihi || '-'} />

            {depreciationInfo && (
              <div className="mt-4 cihaz-pressed p-4 space-y-1">
                <p className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-2">Amortisman</p>
                <InfoRow label="Net Defter Değeri" value={`${depreciationInfo.nbv.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₺`} accent />
                <InfoRow label="Kalan Ömür" value={`${depreciationInfo.remaining.toFixed(1)} yıl`} />
              </div>
            )}
          </div>

          {/* QR Card */}
          <div className="cihaz-card-strong p-5 sm:p-6 flex flex-col items-center">
            <div className="flex items-center gap-2 mb-4 self-start">
              <QrCode className="w-4 h-4 text-[var(--dashboard-accent)]" />
              <p className="text-xs font-semibold text-[var(--dashboard-text)]">QR & Etiket</p>
            </div>
            {qrCodeDataUrl ? (
              <NextImage src={qrCodeDataUrl} alt="QR" width={200} height={200} className="rounded-xl" />
            ) : (
              <div className="w-[200px] h-[200px] rounded-xl bg-[var(--dashboard-surface-2)] flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--dashboard-muted)]" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 mt-4 w-full">
              <button onClick={() => window.print()} className="cihaz-tool-item h-9 px-3 text-xs font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] flex items-center justify-center gap-1.5">
                <Printer className="w-3.5 h-3.5" /> Yazdır
              </button>
              <button onClick={() => qrCodeDataUrl && window.open(qrCodeDataUrl, '_blank')} className="cihaz-tool-item h-9 px-3 text-xs font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] flex items-center justify-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> İndir
              </button>
            </div>
          </div>
        </div>

        {/* MIDDLE GRID: Location/Personnel + Custody */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
          {/* Location & Personnel Update */}
          <div className="cihaz-card p-5">
            <p className="text-[11px] font-semibold text-[var(--dashboard-accent)] uppercase tracking-wider mb-1">Konum & Personel Güncelle</p>
            <p className="text-[10px] text-[var(--dashboard-muted)] mb-3">Ürünün bulunduğu konumu ve sorumlu personeli değiştirin. Değişiklikler hareket geçmişine kaydedilir.</p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Konum</label>
                <Select value={newLocation} onValueChange={setNewLocation}>
                  <SelectTrigger className="h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-0"><SelectValue /></SelectTrigger>
                  <SelectContent>{locations.map(l => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Sorumlu Personel</label>
                <input className={inputClass} placeholder="Ad Soyad" value={newPersonel} onChange={e => setNewPersonel(e.target.value)} />
              </div>
              <button onClick={handleSaveChanges} disabled={isSaving} className="h-9 px-4 rounded-xl text-xs font-semibold bg-[var(--dashboard-accent)] text-white shadow-md hover:opacity-90 transition-all flex items-center gap-1.5 disabled:opacity-50">
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Kaydet
              </button>
            </div>
          </div>

          {/* Formal Custody (Zimmet) */}
          <div className="cihaz-card p-5">
            <p className="text-[11px] font-semibold text-[var(--dashboard-accent)] uppercase tracking-wider mb-1">Resmi Zimmet İşlemi</p>
            <p className="text-[10px] text-[var(--dashboard-muted)] mb-3">Demirbaş zimmet devri. Check-Out ile kişiye zimmetlenir, Check-In ile iade alınır. Fiş numarası otomatik oluşturulur.</p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Zimmetli Kişi</label>
                <input className={inputClass} placeholder="Ad Soyad" value={assignmentPerson} onChange={e => setAssignmentPerson(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Dijital İmza</label>
                <input className={inputClass} placeholder="Ad Soyad (onay)" value={assignmentSignature} onChange={e => setAssignmentSignature(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Not</label>
                <input className={inputClass} placeholder="Opsiyonel not" value={assignmentNote} onChange={e => setAssignmentNote(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button onClick={handleCheckOut} disabled={isSaving} className="h-9 px-3 rounded-xl text-xs font-semibold bg-[var(--dashboard-accent)] text-white shadow-md hover:opacity-90 transition-all flex items-center gap-1.5 disabled:opacity-50">
                  <UserCheck className="w-3.5 h-3.5" /> Zimmetle
                </button>
                <button onClick={handleCheckIn} disabled={isSaving} className="h-9 px-3 rounded-xl text-xs font-semibold bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors flex items-center gap-1.5 disabled:opacity-50">
                  <ShieldCheck className="w-3.5 h-3.5" /> İade Al
                </button>
              </div>
              <p className="text-[10px] text-[var(--dashboard-muted)]">
                Zimmet: {asset.checkOutTarihi || '-'} · İade: {asset.checkInTarihi || '-'} · Fiş: {asset.zimmetFisNo || '-'}
              </p>
            </div>
          </div>
        </div>

        {/* FINANCIAL & MAINTENANCE EDITABLE */}
        <div className="cihaz-card p-5 sm:p-6 mb-5">
          <p className="text-[11px] font-semibold text-[var(--dashboard-accent)] uppercase tracking-wider mb-1">Mali & Bakım Bilgileri</p>
          <p className="text-[10px] text-[var(--dashboard-muted)] mb-4">Satılık/kiralık bilgisi, garanti, bakım ve kalibrasyon tarihlerini güncelleyin.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Mülkiyet Tipi</label>
              <Select value={editMulkiyet} onValueChange={v => setEditMulkiyet(v as 'satin_alma' | 'kira')}>
                <SelectTrigger className="h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="satin_alma">Satılık</SelectItem>
                  <SelectItem value="kira">Kiralık</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editMulkiyet === 'kira' ? (
              <>
                <div>
                  <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Kira Tutarı (₺)</label>
                  <input className={inputClass} type="number" min={0} step="0.01" placeholder="0" value={editKiraTutari} onChange={e => setEditKiraTutari(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Kira Dönemi</label>
                  <Select value={editKiraDonemi} onValueChange={v => setEditKiraDonemi(v as 'aylik' | 'yillik')}>
                    <SelectTrigger className="h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aylik">Aylık</SelectItem>
                      <SelectItem value="yillik">Yıllık</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Kira Bitiş</label>
                  <input className={inputClass} type="date" value={editKiraBitis} onChange={e => setEditKiraBitis(e.target.value)} />
                </div>
              </>
            ) : (
              <div>
                <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Alım Fiyatı (₺)</label>
                <input className={inputClass} type="number" min={0} step="0.01" placeholder="0" value={editAlimFiyati} onChange={e => setEditAlimFiyati(e.target.value === '' ? '' : Number(e.target.value))} />
              </div>
            )}
            <div>
              <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Planlı Ömür (Yıl)</label>
              <input className={inputClass} type="number" min={0} placeholder="0" value={editPlanliOmur} onChange={e => setEditPlanliOmur(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Garanti Bitiş</label>
              <input className={inputClass} type="date" value={editGarantiBitis} onChange={e => setEditGarantiBitis(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Sonraki Bakım</label>
              <input className={inputClass} type="date" value={editSonrakiBakim} onChange={e => setEditSonrakiBakim(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">Sonraki Kalibrasyon</label>
              <input className={inputClass} type="date" value={editSonrakiKalibrasyon} onChange={e => setEditSonrakiKalibrasyon(e.target.value)} />
            </div>
            <div className="flex items-end">
              <button onClick={handleSaveFinancial} disabled={isSavingFinancial} className="h-9 px-4 rounded-xl text-xs font-semibold bg-[var(--dashboard-accent)] text-white shadow-md hover:opacity-90 transition-all flex items-center gap-1.5 disabled:opacity-50">
                {isSavingFinancial ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Kaydet
              </button>
            </div>
          </div>
        </div>

        {/* HISTORY */}
        <div className="cihaz-card-strong p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <History className="w-5 h-5 text-[var(--dashboard-accent)]" />
            <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">Geçmiş</h2>
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Movement */}
            <div>
              <p className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-2">Hareket Geçmişi</p>
              <ScrollArea className="h-56">
                {history.length === 0 ? (
                  <p className="text-center py-8 text-sm text-[var(--dashboard-muted)]">Kayıt yok.</p>
                ) : (
                  <div className="space-y-2 pr-2">
                    {history.map(h => (
                      <div key={h.id} className="px-3 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)]/50">
                        <p className="text-xs font-medium text-[var(--dashboard-text)]">
                          {h.timestamp?.toDate ? format(h.timestamp.toDate(), 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}
                        </p>
                        <p className="text-[11px] text-[var(--dashboard-muted)] mt-0.5">
                          {h.previousState?.konum || '-'} → {h.newState?.konum || '-'} · {h.previousState?.teslimEdilenPersonel || '-'} → {h.newState?.teslimEdilenPersonel || '-'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
            {/* Custody */}
            <div>
              <p className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-2">Zimmet Hareketi</p>
              <ScrollArea className="h-56">
                {custodyHistory.length === 0 ? (
                  <p className="text-center py-8 text-sm text-[var(--dashboard-muted)]">Kayıt yok.</p>
                ) : (
                  <div className="space-y-2 pr-2">
                    {custodyHistory.map(h => (
                      <div key={h.id} className="px-3 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)]/50">
                        <p className="text-xs font-medium text-[var(--dashboard-text)]">
                          <span className={h.action === 'check_out' ? 'text-[var(--dashboard-accent)]' : 'text-emerald-500'}>
                            {h.action === 'check_out' ? 'Check-Out' : 'Check-In'}
                          </span>
                          {' · '}{h.timestamp?.toDate ? format(h.timestamp.toDate(), 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}
                        </p>
                        <p className="text-[11px] text-[var(--dashboard-muted)] mt-0.5">
                          {h.personel || '-'} · Fiş: {h.zimmetFisNo || '-'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
