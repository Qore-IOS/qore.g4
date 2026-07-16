'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { Check, ChevronDown, Download, FileSpreadsheet, History, Loader2, Mic, Package, ScanBarcode, Search } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { Depot, DepoStokItem, Hospital, MinMaxRule, ProductCode } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';
import { parseAndResolveBarcode } from '@/lib/barcode';
import useHidScanner from '@/hooks/useHidScanner';
import { cn, playFeedback } from '@/lib/utils';

type LabGroup = { id: string; name: string; productCodes: Set<string> };
type CountEntry = {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  urunGrubu?: string;
  ambalajDegeri: number;
  currentQty: number;
  countedQty: string;
  counted: boolean;
  stockItems: DepoStokItem[];
  serials: string[];
  scannedSerials: Set<string>;
  manualTouched: boolean;
};

const emptyTotals = { current: 0, counted: 0, rows: 0, completed: 0 };

function productLabel(product?: ProductCode, fallback?: DepoStokItem) {
  return product?.stokAdi || fallback?.stokAdi || '';
}

function isSerialTracked(items: DepoStokItem[]) {
  return items.some(item => !!item.seriNumarasi);
}

function formatQty(value: number) {
  return value.toLocaleString('tr-TR');
}

export default function DepoSayimPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { formats: barcodeFormats } = useSafeBarcodeFormats();

  const [bootLoading, setBootLoading] = useState(true);
  const [countLoading, setCountLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [products, setProducts] = useState<ProductCode[]>([]);
  const [labGroups, setLabGroups] = useState<LabGroup[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState('');
  const [selectedLabId, setSelectedLabId] = useState('');
  const [entries, setEntries] = useState<Record<string, CountEntry>>({});
  const [search, setSearch] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [completing, setCompleting] = useState<Set<string>>(() => new Set());

  const productsByCode = useMemo(() => new Map(products.map(p => [p.stokKodu, p])), [products]);
  const selectedDepot = depots.find(d => d.id === selectedDepotId);
  const selectedLab = labGroups.find(g => g.id === selectedLabId);

  useEffect(() => {
    let alive = true;
    async function loadBootstrap() {
      setBootLoading(true);
      try {
        const [depotsSnap, productsSnap, hospitalsSnap] = await Promise.all([
          getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
        ]);
        if (!alive) return;
        const depotList = filterOperationalSourceDepots(depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)), currentUserProfile);
        const productList = productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode));
        const hospitals = hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital));
        const groups: LabGroup[] = [];
        for (const hospital of hospitals) {
          const rulesSnap = await getDocs(collection(db, 'hospitals', hospital.id, 'minMaxRules'));
          const codes = new Set<string>();
          rulesSnap.docs.forEach(ruleDoc => {
            const rule = ruleDoc.data() as MinMaxRule;
            if (rule.stokKodu) codes.add(rule.stokKodu);
          });
          if (codes.size > 0) groups.push({ id: hospital.id, name: hospital.name || hospital.ad || hospital.id, productCodes: codes });
        }
        if (!alive) return;
        setDepots(depotList);
        setProducts(productList);
        setLabGroups(groups.sort((a, b) => a.name.localeCompare(b.name, 'tr')));
        if (!selectedDepotId && depotList[0]?.id) setSelectedDepotId(depotList[0].id);
      } catch (error) {
        console.error(error);
        toast({ title: 'Veri yüklenemedi', description: 'Depo, ürün veya laboratuvar tanımları alınamadı.', variant: 'destructive' });
      } finally {
        if (alive) setBootLoading(false);
      }
    }
    loadBootstrap();
    return () => { alive = false; };
  }, [currentCompanyId, currentUserProfile, isSuperAdmin, selectedDepotId, toast]);

  const startCount = useCallback(async () => {
    if (!selectedDepotId) {
      toast({ title: 'Depo seçin', variant: 'destructive' });
      return;
    }
    setCountLoading(true);
    try {
      const selectedDepotName = depots.find(depot => depot.id === selectedDepotId)?.name || '';
      const stockSnap = await getDocs(query(collection(db, 'depoStok'), where('depotId', '==', selectedDepotId)));
      const stockItems = filterByCompanyScope(stockSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)), currentCompanyId, isSuperAdmin)
        .filter(item => !item.isShipped)
        .filter(item => item.depotId === selectedDepotId)
        .filter(item => !item.depotName || !selectedDepotName || item.depotName === selectedDepotName);


      const firstLabByProduct = new Map<string, LabGroup>();
      labGroups.forEach(group => group.productCodes.forEach(code => {
        if (!firstLabByProduct.has(code)) firstLabByProduct.set(code, group);
      }));

      const groupedEntries: Record<string, CountEntry> = {};
      stockItems.forEach(item => {
        const product = productsByCode.get(item.stokKodu);
        const lab = firstLabByProduct.get(item.stokKodu);
        if (!lab) return;
        const current = groupedEntries[item.stokKodu] ?? {
          stokKodu: item.stokKodu,
          stokAdi: productLabel(product, item),
          marka: product?.marka || '',
          urunGrubu: product?.urunGrubu,
          ambalajDegeri: product?.ambalajDegeri || item.ambalajDegeri || 1,
          currentQty: 0,
          countedQty: '',
          counted: false,
          stockItems: [],
          serials: [],
          scannedSerials: new Set<string>(),
          manualTouched: false,
        };
        current.currentQty += 1;
        current.stockItems.push(item);
        if (item.seriNumarasi) current.serials.push(item.seriNumarasi);
        groupedEntries[item.stokKodu] = current;
      });

      setEntries(groupedEntries);
      const labsWithStock = labGroups.filter(group => Array.from(group.productCodes).some(code => groupedEntries[code]));
      setSelectedLabId(prev => (prev && labsWithStock.some(g => g.id === prev) ? prev : labsWithStock[0]?.id || ''));
      toast({ title: 'Sayım hazır', description: `${Object.keys(groupedEntries).length} stok kodu listelendi.` });
    } catch (error) {
      console.error(error);
      toast({ title: 'Stok yüklenemedi', description: 'Seçilen deponun stoğu alınamadı.', variant: 'destructive' });
    } finally {
      setCountLoading(false);
    }
  }, [currentCompanyId, depots, isSuperAdmin, labGroups, productsByCode, selectedDepotId, toast]);

  const visibleLabGroups = useMemo(() => labGroups.filter(group => Array.from(group.productCodes).some(code => entries[code])), [entries, labGroups]);

  const visibleEntries = useMemo(() => {
    if (!selectedLab) return [];
    const lower = search.toLocaleLowerCase('tr');
    return Array.from(selectedLab.productCodes)
      .map(code => entries[code])
      .filter(Boolean)
      .filter(entry => !onlyOpen || !entry.counted)
      .filter(entry => !lower || entry.stokAdi.toLocaleLowerCase('tr').includes(lower) || entry.stokKodu.toLocaleLowerCase('tr').includes(lower))
      .sort((a, b) => Number(a.counted) - Number(b.counted) || a.stokAdi.localeCompare(b.stokAdi, 'tr'));
  }, [entries, onlyOpen, search, selectedLab]);

  const totals = useMemo(() => Object.values(entries).reduce((acc, entry) => {
    acc.current += entry.currentQty;
    acc.counted += Number(entry.countedQty || 0);
    acc.rows += 1;
    if (entry.counted) acc.completed += 1;
    return acc;
  }, { ...emptyTotals }), [entries]);

  const updateCount = useCallback((stokKodu: string, value: string, manualTouched = true) => {
    const clean = value.replace(/[^0-9]/g, '');
    setEntries(prev => {
      const entry = prev[stokKodu];
      if (!entry) return prev;
      return { ...prev, [stokKodu]: { ...entry, countedQty: clean, counted: false, manualTouched: entry.manualTouched || manualTouched } };
    });
  }, []);

  const completeRow = useCallback((stokKodu: string) => {
    const currentList = visibleEntries;
    const next = currentList.find(entry => entry.stokKodu !== stokKodu && !entry.counted);
    setCompleting(prev => new Set(prev).add(stokKodu));
    window.setTimeout(() => {
      setEntries(prev => {
        const entry = prev[stokKodu];
        if (!entry || entry.countedQty.trim() === '') return prev;
        return { ...prev, [stokKodu]: { ...entry, counted: true } };
      });
      setCompleting(prev => { const copy = new Set(prev); copy.delete(stokKodu); return copy; });
      if (next) setFocusTarget(next.stokKodu);
    }, 260);
  }, [visibleEntries]);

  const handleScan = useCallback((raw: string) => {
    const resolved = parseAndResolveBarcode(raw, barcodeFormats as any, products);
    const parsed = resolved?.parsed;
    const stokKodu = parsed?.stokKodu || resolved?.product?.stokKodu || raw;
    const entry = entries[stokKodu];
    if (!entry) {
      playFeedback(true);
      toast({ title: 'Ürün bu sayım grubunda yok', description: stokKodu, variant: 'destructive' });
      return;
    }
    setSelectedLabId(labGroups.find(group => group.productCodes.has(stokKodu))?.id || selectedLabId);
    setEntries(prev => {
      const target = prev[stokKodu];
      if (!target) return prev;
      const nextScanned = new Set(target.scannedSerials);
      const seri = parsed?.seriNumarasi;
      if (seri) nextScanned.add(seri);
      const nextCount = String(Number(target.countedQty || 0) + 1);
      return { ...prev, [stokKodu]: { ...target, countedQty: nextCount, scannedSerials: nextScanned, counted: false, manualTouched: false } };
    });
    playFeedback();
  }, [barcodeFormats, entries, labGroups, products, selectedLabId, toast]);

  useHidScanner({ enabled: scannerActive, allowDuringInputs: false, onScan: ({ raw }) => handleScan(raw) } as any);

  const saveCount = useCallback(async () => {
    if (!selectedDepot || !currentUserProfile) return;
    if (!confirm('Depo stoğu sayılan adetlere göre güncellenecek. Devam edilsin mi?')) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      Object.values(entries).forEach(entry => {
        if (!entry.counted) return;
        const counted = Number(entry.countedQty || 0);
        const diff = counted - entry.currentQty;
        const serialTracked = isSerialTracked(entry.stockItems);
        if (diff < 0) {
          if (serialTracked && entry.manualTouched) {
            entry.stockItems.forEach(item => batch.set(doc(db, 'depoStok', item.id), { lastCountedQty: counted, lastCountedAt: serverTimestamp(), lastCountedBy: currentUserProfile.uid }, { merge: true }));
          } else {
            const keepSerials = entry.scannedSerials;
            const toDelete = serialTracked && keepSerials.size > 0
              ? entry.stockItems.filter(item => !keepSerials.has(item.seriNumarasi || '')).slice(0, Math.abs(diff))
              : entry.stockItems.slice(0, Math.abs(diff));
            toDelete.forEach(item => batch.delete(doc(db, 'depoStok', item.id)));
          }
        } else if (diff > 0) {
          for (let i = 0; i < diff; i += 1) {
            const newRef = doc(collection(db, 'depoStok'));
            batch.set(newRef, withCompanyScope({
              depotId: selectedDepot.id,
              depotName: selectedDepot.name,
              stokKodu: entry.stokKodu,
              stokAdi: entry.stokAdi,
              seriNumarasi: `SAYIM-${Date.now()}-${i}`,
              eklenmeTarihi: new Date(),
              isShipped: false,
              urunGrubu: entry.urunGrubu,
              ambalajDegeri: entry.ambalajDegeri,
              irsaliyeNumarasi: 'DEPO_SAYIM_FAZLA',
              createdByName: currentUserProfile.name || '',
            }, currentCompanyId));
          }
        }
      });
      batch.set(doc(collection(db, 'depotStockCountSessions')), withCompanyScope({
        depotId: selectedDepot.id,
        depotName: selectedDepot.name,
        createdBy: currentUserProfile.uid,
        createdByName: currentUserProfile.name || '',
        createdAt: serverTimestamp(),
        currentTotal: totals.current,
        countedTotal: totals.counted,
        completedRows: totals.completed,
        totalRows: totals.rows,
        items: Object.values(entries).filter(e => e.counted).map(e => ({ stokKodu: e.stokKodu, stokAdi: e.stokAdi, currentQty: e.currentQty, countedQty: Number(e.countedQty || 0), labGroupId: labGroups.find(g => g.productCodes.has(e.stokKodu))?.id || null })),
      }, currentCompanyId));
      await batch.commit();
      toast({ title: 'Sayım kaydedildi', description: 'Depo stoğu sayım sonuçlarına göre güncellendi.' });
      router.push('/depo-sayim/gecmis');
    } catch (error) {
      console.error(error);
      toast({ title: 'Kaydedilemedi', description: 'Depo stoğu güncellenirken hata oluştu.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [currentCompanyId, currentUserProfile, entries, labGroups, router, selectedDepot, toast, totals]);

  if (bootLoading) {
    return <div className="min-h-screen grid place-items-center text-[var(--dashboard-muted)]"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  if (Object.keys(entries).length === 0) {
    return (
      <div className="min-h-screen bg-[var(--dashboard-bg)] p-4 sm:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => router.push('/stok-yonetimi')}>Geri Dön</Button>
          <Button variant="outline" onClick={() => router.push('/depo-sayim/gecmis')}><History className="w-4 h-4 mr-2" /> Sayım Geçmişi</Button>
        </div>
        <div className="cihaz-card p-6 sm:p-8 space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-[var(--dashboard-text)]">Depo Sayımı</h1>
            <p className="text-sm text-[var(--dashboard-muted)] mt-2">Önce depo seçilir; seçilmeden hiçbir deponun stoğu indirilmez. Sonraki ekranda ürünler, min/max tanımlı laboratuvar gruplarına göre sayılır.</p>
          </div>
          <div className="max-w-xl space-y-2">
            <label className="text-xs font-semibold uppercase text-[var(--dashboard-muted)]">Depo</label>
            <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
              <SelectTrigger className="h-12"><SelectValue placeholder="Depo seçin" /></SelectTrigger>
              <SelectContent>{depots.map(depot => <SelectItem key={depot.id} value={depot.id}>{depot.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={startCount} disabled={!selectedDepotId || countLoading} className="h-12 px-6">
            {countLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Sayımı Başlat
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--dashboard-bg)] flex">
      <aside className="hidden md:block w-72 p-4 border-r border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]/70">
        <div className="cihaz-card p-4 mb-4">
          <p className="text-xs uppercase font-bold text-[var(--dashboard-muted)]">Depo</p>
          <h2 className="text-lg font-bold text-[var(--dashboard-text)]">{selectedDepot?.name}</h2>
          <p className="text-xs text-[var(--dashboard-muted)] mt-1">{totals.completed}/{totals.rows} ürün sayıldı</p>
        </div>
        <div className="space-y-2">
          {visibleLabGroups.map(group => {
            const groupEntries = Array.from(group.productCodes).map(code => entries[code]).filter(Boolean);
            const completed = groupEntries.filter(entry => entry.counted).length;
            return (
              <button key={group.id} onClick={() => setSelectedLabId(group.id)} className={cn('w-full text-left p-3 rounded-2xl transition-all', selectedLabId === group.id ? 'bg-[var(--dashboard-accent)]/15 ring-1 ring-[var(--dashboard-accent)]/40' : 'hover:bg-[var(--dashboard-surface-2)]')}>
                <div className="font-bold text-sm text-[var(--dashboard-text)] truncate">{group.name}</div>
                <div className="text-xs text-[var(--dashboard-muted)] mt-1">{completed}/{groupEntries.length} ürün</div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex-1 min-w-0 pb-28">
        <div className="sticky top-0 z-20 p-4 bg-[var(--dashboard-bg)]/95 backdrop-blur">
          <div className="cihaz-card p-4 flex items-center gap-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setEntries({})}>Depo Seç</Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-[var(--dashboard-text)] truncate">{selectedDepot?.name} Depo Sayımı</h1>
              <p className="text-xs text-[var(--dashboard-muted)]">Mevcut: {formatQty(totals.current)} · Sayılan: {formatQty(totals.counted)} · {totals.completed}/{totals.rows} satır</p>
            </div>
            <ToolButton icon={<ScanBarcode className="w-4 h-4" />} label={scannerActive ? 'Barkod Aktif' : 'Barkod'} active={scannerActive} onClick={() => setScannerActive(v => !v)} />
            <ToolButton icon={<Mic className="w-4 h-4" />} label="Sesli" onClick={() => toast({ title: 'Sesli sayım', description: 'Bu akış maliyet sayım ile aynı arayüze hazırlandı; sesli komut entegrasyonu için buton ayrıldı.' })} />
            <ToolButton icon={<Download className="w-4 h-4" />} label="Şablon" onClick={() => toast({ title: 'Şablon', description: 'Depo sayım şablonu hazırlanıyor.' })} />
            <ToolButton icon={<FileSpreadsheet className="w-4 h-4" />} label="Excel" onClick={() => toast({ title: 'Excel', description: 'Excel yükleme alanı bu yeni akışa bağlanacak.' })} />
          </div>
          <div className="md:hidden mt-3">
            <Select value={selectedLabId} onValueChange={setSelectedLabId}>
              <SelectTrigger className="h-12"><SelectValue placeholder="Laboratuvar grubu" /></SelectTrigger>
              <SelectContent>{visibleLabGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dashboard-muted)]" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ürün ara..." className="w-full h-11 pl-10 pr-3 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] outline-none text-sm" />
            </div>
            <Button variant={onlyOpen ? 'default' : 'outline'} onClick={() => setOnlyOpen(v => !v)}>Sadece Açıklar</Button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {visibleEntries.map(entry => (
            <CountCard key={entry.stokKodu} entry={entry} focus={focusTarget === entry.stokKodu} completing={completing.has(entry.stokKodu)} onChange={value => updateCount(entry.stokKodu, value)} onComplete={() => completeRow(entry.stokKodu)} />
          ))}
          {visibleEntries.length === 0 && <div className="cihaz-card p-10 text-center text-sm text-[var(--dashboard-muted)]">Bu grupta ürün bulunamadı.</div>}
        </div>

        <div className="fixed left-0 right-0 bottom-0 z-30 p-4 bg-gradient-to-t from-[var(--dashboard-bg)] via-[var(--dashboard-bg)] to-transparent">
          <div className="cihaz-card mx-auto max-w-5xl p-3 flex items-center gap-4">
            <MiniStat label="Mevcut" value={formatQty(totals.current)} />
            <MiniStat label="Sayılan" value={formatQty(totals.counted)} accent />
            <MiniStat label="Tamamlanan" value={`${totals.completed}/${totals.rows}`} />
            <div className="flex-1" />
            <Button onClick={saveCount} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Kaydet</Button>
          </div>
        </div>
      </main>
    </div>
  );
}

function ToolButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={cn('h-10 px-3 rounded-2xl inline-flex items-center gap-2 text-xs font-bold shadow-[var(--dashboard-pressed)] bg-[var(--dashboard-surface-2)] whitespace-nowrap', active && 'text-emerald-700 bg-emerald-50')}>{icon}{label}</button>;
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div><p className="text-[10px] uppercase font-bold text-[var(--dashboard-muted)]">{label}</p><p className={cn('text-lg font-extrabold tabular-nums', accent ? 'text-[var(--dashboard-accent)]' : 'text-[var(--dashboard-text)]')}>{value}</p></div>;
}

function CountCard({ entry, focus, completing, onChange, onComplete }: { entry: CountEntry; focus: boolean; completing: boolean; onChange: (value: string) => void; onComplete: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [serialOpen, setSerialOpen] = useState(false);
  useEffect(() => {
    if (focus) {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    }
  }, [focus]);
  const serialTracked = isSerialTracked(entry.stockItems);
  return (
    <div className={cn('cihaz-card p-4 transition-all duration-300', entry.counted && 'ring-1 ring-emerald-400 bg-emerald-500/5')} style={{ transform: completing ? 'translateX(110%) scale(.98)' : undefined, opacity: completing ? 0 : 1 }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-[var(--dashboard-text)] leading-tight">{entry.stokAdi}</h3>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--dashboard-muted)]">
            <span>{entry.stokKodu}</span>
            {entry.marka && <span className="px-2 py-0.5 rounded-full bg-[var(--dashboard-surface-2)]">{entry.marka}</span>}
            {serialTracked && <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Seri takipli</span>}
          </div>
        </div>
        <button onClick={onComplete} className={cn('w-11 h-11 rounded-full grid place-items-center shadow-[var(--dashboard-pressed)]', entry.counted ? 'bg-emerald-500 text-white' : 'bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]')}><Check className="w-5 h-5" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 mt-4">
        <div className="rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] p-4">
          <p className="text-[10px] uppercase font-bold text-[var(--dashboard-muted)]">Mevcut Stok</p>
          <p className="text-3xl font-extrabold text-[var(--dashboard-text)]">{formatQty(entry.currentQty)}</p>
        </div>
        <div className="rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] p-4 focus-within:ring-2 focus-within:ring-emerald-300">
          <p className="text-[10px] uppercase font-bold text-[var(--dashboard-muted)]">Sayılan Stok</p>
          <input ref={inputRef} inputMode="numeric" value={entry.countedQty} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onComplete(); } }} placeholder="0" className="w-full bg-transparent outline-none text-3xl font-extrabold text-[var(--dashboard-text)]" />
        </div>
        <div className="rounded-2xl bg-[var(--dashboard-accent)] text-white p-4 min-w-[150px]">
          <p className="text-[10px] uppercase font-bold opacity-80">Fark</p>
          <p className="text-3xl font-extrabold">{formatQty(Number(entry.countedQty || 0) - entry.currentQty)}</p>
        </div>
      </div>
      {serialTracked && (
        <div className="mt-3">
          <button onClick={() => setSerialOpen(v => !v)} className="text-xs font-bold text-[var(--dashboard-muted)] inline-flex items-center gap-1">Seri numaraları ({entry.serials.length}) <ChevronDown className={cn('w-3 h-3 transition-transform', serialOpen && 'rotate-180')} /></button>
          {serialOpen && <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">{entry.serials.map(serial => <span key={serial} className={cn('font-mono text-xs rounded-xl border px-2 py-1', entry.scannedSerials.has(serial) ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-[var(--dashboard-stroke)] text-[var(--dashboard-muted)]')}>{serial}</span>)}</div>}
        </div>
      )}
    </div>
  );
}
