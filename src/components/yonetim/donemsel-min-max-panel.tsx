'use client';

import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { CalendarRange, Check, Download, FileSpreadsheet, Loader2, Plus, Save, Search, Upload, X } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { useDepots, useHospitals, useProductCodes } from '@/hooks/useFirebaseQueries';
import { withCompanyScope } from '@/lib/company-scope';
import { exportDataToExcel, readExcelData } from '@/lib/utils';
import type { MinMaxPeriodConfig, MinMaxRule } from '@/lib/types';
import { DEFAULT_MIN_MAX_PERIOD_CONFIG, getActiveMinMaxPeriod, normalizePeriodId } from '@/lib/seasonal-min-max';
import { YonetimHeader, YonetimShell } from '@/components/yonetim-ui/YonetimHub';

type LocationType = 'hospital' | 'depot';
type Location = { id: string; name: string; code: string; type: LocationType };
type RowValues = Record<string, { min: number | ''; max: number | '' }>;

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const inputClass = 'h-9 w-20 rounded-lg border border-border bg-background px-2 text-center text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary';

export default function DonemselMinMaxPanel() {
  const { currentCompanyId } = useAuth();
  const { toast } = useToast();
  const { data: hospitals = [], isLoading: hospitalsLoading } = useHospitals();
  const { data: depots = [], isLoading: depotsLoading } = useDepots();
  const { data: products = [], isLoading: productsLoading } = useProductCodes();
  const [config, setConfig] = useState<MinMaxPeriodConfig>(DEFAULT_MIN_MAX_PERIOD_CONFIG);
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set());
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, RowValues>>({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const locations = useMemo<Location[]>(() => [
    ...hospitals.map(item => ({ id: item.id, name: item.name, code: item.kod || item.id, type: 'hospital' as const })),
    ...depots.map(item => ({ id: item.id, name: item.name, code: item.ceomedDepoKodu || item.id, type: 'depot' as const })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'tr')), [hospitals, depots]);
  const locationMap = useMemo(() => new Map(locations.map(item => [`${item.type}:${item.id}`, item])), [locations]);
  const productMap = useMemo(() => new Map(products.map(item => [item.stokKodu, item])), [products]);
  const activePeriod = getActiveMinMaxPeriod(config);

  useEffect(() => {
    if (!currentCompanyId) return;
    getDoc(doc(db, 'minMaxPeriodConfigs', currentCompanyId)).then(snapshot => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setConfig({ periods: data.periods || DEFAULT_MIN_MAX_PERIOD_CONFIG.periods, monthPeriodMap: data.monthPeriodMap || DEFAULT_MIN_MAX_PERIOD_CONFIG.monthPeriodMap });
      }
    }).catch(error => console.error('[donemsel-min-max] config', error));
  }, [currentCompanyId]);

  const updatePeriod = (index: number, name: string) => {
    const oldId = config.periods[index].id;
    const id = normalizePeriodId(name) || oldId;
    setConfig(prev => ({
      periods: prev.periods.map((period, i) => i === index ? { id, name } : period),
      monthPeriodMap: Object.fromEntries(Object.entries(prev.monthPeriodMap).map(([month, period]) => [month, period === oldId ? id : period])) as Record<number, string>,
    }));
  };

  const addPeriod = () => {
    const id = `donem-${config.periods.length + 1}`;
    setConfig(prev => ({ ...prev, periods: [...prev.periods, { id, name: `Dönem ${prev.periods.length + 1}` }] }));
  };

  const removePeriod = (id: string) => {
    if (config.periods.length <= 1) return;
    const fallback = config.periods.find(period => period.id !== id)!.id;
    setConfig(prev => ({
      periods: prev.periods.filter(period => period.id !== id),
      monthPeriodMap: Object.fromEntries(Object.entries(prev.monthPeriodMap).map(([month, period]) => [month, period === id ? fallback : period])) as Record<number, string>,
    }));
  };

  const toggleLocation = async (key: string) => {
    const next = new Set(selectedLocations);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelectedLocations(next);
    if (!next.has(key) || values[key]) return;
    const location = locationMap.get(key);
    if (!location) return;
    setBusy(true);
    try {
      const parent = location.type === 'depot' ? 'depots' : 'hospitals';
      const snapshot = await getDocs(collection(db, parent, location.id, 'minMaxRules'));
      const loaded: RowValues = {};
      snapshot.forEach(ruleDoc => {
        const rule = ruleDoc.data() as MinMaxRule;
        loaded[rule.stokKodu || ruleDoc.id] = Object.fromEntries(config.periods.map(period => [period.id, rule.donemDegerleri?.[period.id] || { min: rule.min ?? 0, max: rule.max ?? 0 }]));
      });
      setValues(prev => ({ ...prev, [key]: loaded }));
      setSelectedProducts(prev => new Set([...prev, ...Object.keys(loaded)]));
    } finally { setBusy(false); }
  };

  const setCell = (locationKey: string, stockCode: string, periodId: string, field: 'min' | 'max', raw: string) => {
    const parsed = raw === '' ? '' : Math.max(0, Number(raw));
    setValues(prev => ({ ...prev, [locationKey]: { ...(prev[locationKey] || {}), [stockCode]: { ...(prev[locationKey]?.[stockCode] || {}), [periodId]: { ...(prev[locationKey]?.[stockCode]?.[periodId] || { min: '', max: '' }), [field]: parsed } } } }));
  };

  const validate = () => {
    for (const key of selectedLocations) for (const stockCode of selectedProducts) for (const period of config.periods) {
      const cell = values[key]?.[stockCode]?.[period.id];
      if (!cell || cell.min === '' || cell.max === '' || Number(cell.max) < Number(cell.min)) return `${locationMap.get(key)?.name} / ${stockCode} / ${period.name}: Min ve Max geçerli olmalı, Max Min'den küçük olmamalı.`;
    }
    return null;
  };

  const save = async () => {
    if (!currentCompanyId || selectedLocations.size === 0 || selectedProducts.size === 0) return;
    const error = validate();
    if (error) return toast({ title: 'Geçersiz değer', description: error, variant: 'destructive' });
    setBusy(true);
    try {
      await setDoc(doc(db, 'minMaxPeriodConfigs', currentCompanyId), withCompanyScope({ ...config, updatedAt: serverTimestamp() }, currentCompanyId));
      let batch = writeBatch(db); let count = 0; const batches = [];
      for (const key of selectedLocations) {
        const location = locationMap.get(key)!;
        const parent = location.type === 'depot' ? 'depots' : 'hospitals';
        for (const stockCode of selectedProducts) {
          const donemDegerleri = Object.fromEntries(config.periods.map(period => [period.id, { min: Number(values[key][stockCode][period.id].min), max: Number(values[key][stockCode][period.id].max) }]));
          const current = donemDegerleri[activePeriod.id] || Object.values(donemDegerleri)[0];
          batch.set(doc(db, parent, location.id, 'minMaxRules', stockCode), { stokKodu: stockCode, min: current.min, max: current.max, donemDegerleri }, { merge: true });
          if (++count === 450) { batches.push(batch); batch = writeBatch(db); count = 0; }
        }
      }
      if (count) batches.push(batch);
      for (const item of batches) await item.commit();
      toast({ title: 'Dönemsel tanımlar kaydedildi', description: `${selectedLocations.size} kurum ve ${selectedProducts.size} ürün güncellendi.` });
    } catch (error) {
      console.error('[donemsel-min-max] save', error);
      toast({ title: 'Kayıt başarısız', description: 'Dönemsel min-max tanımları kaydedilemedi.', variant: 'destructive' });
    } finally { setBusy(false); }
  };

  const templateRows = () => [...selectedLocations].flatMap(key => {
    const location = locationMap.get(key)!;
    return [...selectedProducts].map(stockCode => ({
      'Kurum Türü': location.type === 'hospital' ? 'Lab' : 'Depo', 'Lab / Depo Adı': location.name, 'Lab / Depo Kodu': location.code,
      'Stok Kodu': stockCode, ...Object.fromEntries(config.periods.flatMap(period => [[`${period.name} Min`, values[key]?.[stockCode]?.[period.id]?.min ?? ''], [`${period.name} Max`, values[key]?.[stockCode]?.[period.id]?.max ?? '']]))
    }));
  });

  const exportTemplate = () => {
    if (!selectedLocations.size || !selectedProducts.size) return toast({ title: 'Seçim gerekli', description: 'Şablon için en az bir kurum ve ürün seçin.', variant: 'destructive' });
    exportDataToExcel(templateRows(), 'Donemsel_Min_Max_Sablonu', 'Min-Max', toast);
  };

  const importExcel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true);
    try {
      const rows = await readExcelData(file, toast); let imported = 0;
      const nextLocations = new Set(selectedLocations); const nextProducts = new Set(selectedProducts); const nextValues = structuredClone(values);
      for (const row of rows) {
        const code = String(row['Lab / Depo Kodu'] ?? '').trim(); const stockCode = String(row['Stok Kodu'] ?? '').trim();
        const location = locations.find(item => item.code === code); if (!location || !productMap.has(stockCode)) continue;
        const key = `${location.type}:${location.id}`; nextLocations.add(key); nextProducts.add(stockCode); nextValues[key] ||= {}; nextValues[key][stockCode] ||= {};
        let valid = true;
        for (const period of config.periods) {
          const min = Number(row[`${period.name} Min`]); const max = Number(row[`${period.name} Max`]);
          if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) { valid = false; break; }
          nextValues[key][stockCode][period.id] = { min, max };
        }
        if (valid) imported++;
      }
      setSelectedLocations(nextLocations); setSelectedProducts(nextProducts); setValues(nextValues);
      toast({ title: 'Excel işlendi', description: `${imported} satır aktarıma hazırlandı.` });
    } finally { setBusy(false); event.target.value = ''; }
  };

  const filteredProducts = products.filter(product => `${product.stokKodu} ${product.stokAdi}`.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr')));
  const loading = hospitalsLoading || depotsLoading || productsLoading;

  return <YonetimShell>
    <YonetimHeader title="Dönemsel Min-Max Ayarları" description="Laboratuvar ve depolar için mevsimsel stok eşiklerini tekli veya toplu yönetin." backHref="/yonetim/tanimlar" rightAction={<button onClick={save} disabled={busy || !selectedLocations.size || !selectedProducts.size} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>} Kaydet</button>} />

    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-bold"><CalendarRange className="h-5 w-5 text-cyan-600"/> Dönem ve ay planı</h2><p className="mt-1 text-sm text-muted-foreground">Bu ay etkin: <strong className="text-foreground">{activePeriod.name}</strong></p></div><button onClick={addPeriod} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold hover:bg-muted"><Plus className="h-4 w-4"/> Dönem ekle</button></div>
      <div className="mt-4 flex flex-wrap gap-2">{config.periods.map((period, index) => <div key={period.id} className="flex items-center rounded-xl border bg-background p-1"><input aria-label={`${index + 1}. dönem adı`} value={period.name} onChange={e => updatePeriod(index, e.target.value)} className="h-9 w-28 bg-transparent px-2 text-sm font-semibold outline-none"/>{config.periods.length > 1 && <button aria-label={`${period.name} dönemini sil`} onClick={() => removePeriod(period.id)} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><X className="h-4 w-4"/></button>}</div>)}</div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">{MONTHS.map((month, index) => <label key={month} className="rounded-xl border bg-background p-2 text-xs font-semibold"><span className="mb-1 block text-muted-foreground">{month}</span><select value={config.monthPeriodMap[index + 1]} onChange={e => setConfig(prev => ({ ...prev, monthPeriodMap: { ...prev.monthPeriodMap, [index + 1]: e.target.value } }))} className="h-9 w-full cursor-pointer rounded-lg border bg-card px-2 text-sm">{config.periods.map(period => <option key={period.id} value={period.id}>{period.name}</option>)}</select></label>)}</div>
    </section>

    <div className="grid gap-4 xl:grid-cols-[280px_300px_minmax(0,1fr)]">
      <Selection title="1. Kurumlar" subtitle={`${selectedLocations.size} seçili`} loading={loading}>{locations.map(location => { const key = `${location.type}:${location.id}`; return <Choice key={key} selected={selectedLocations.has(key)} onClick={() => toggleLocation(key)} title={location.name} subtitle={`${location.type === 'hospital' ? 'Lab' : 'Depo'} · ${location.code}`}/>; })}</Selection>
      <Selection title="2. Ürünler" subtitle={`${selectedProducts.size} seçili`} loading={loading} header={<div className="flex h-10 items-center gap-2 rounded-xl border px-3"><Search className="h-4 w-4 text-muted-foreground"/><input aria-label="Ürün ara" value={search} onChange={e => setSearch(e.target.value)} placeholder="Stok kodu veya adı" className="min-w-0 flex-1 bg-transparent text-sm outline-none"/></div>}>{filteredProducts.map(product => <Choice key={product.stokKodu} selected={selectedProducts.has(product.stokKodu!)} onClick={() => { const next = new Set(selectedProducts); next.has(product.stokKodu!) ? next.delete(product.stokKodu!) : next.add(product.stokKodu!); setSelectedProducts(next); }} title={product.stokAdi || product.stokKodu!} subtitle={product.stokKodu!}/>)}</Selection>
      <section className="min-w-0 rounded-2xl border border-border bg-card shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2 border-b p-4"><div><h2 className="font-bold">3. Dönem değerleri</h2><p className="text-xs text-muted-foreground">{selectedLocations.size * selectedProducts.size} tanım satırı</p></div><div className="flex gap-2"><button onClick={exportTemplate} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-bold hover:bg-muted"><Download className="h-4 w-4"/> Şablon</button><button onClick={() => fileRef.current?.click()} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-bold hover:bg-muted"><Upload className="h-4 w-4"/> Toplu aktar</button><input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={importExcel} className="hidden"/></div></div>
        <div className="max-h-[680px] overflow-auto">{!selectedLocations.size || !selectedProducts.size ? <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center text-muted-foreground"><FileSpreadsheet className="mb-3 h-10 w-10 opacity-40"/><p className="font-semibold">Kurum ve ürün seçerek başlayın.</p><p className="mt-1 text-sm">Tek bir kurum veya birden çok kurum birlikte seçilebilir.</p></div> : <table className="w-full min-w-[700px] text-sm"><thead className="sticky top-0 z-10 bg-card"><tr className="border-b"><th className="px-3 py-3 text-left">Kurum / Ürün</th>{config.periods.map(period => <th key={period.id} className="px-2 py-3 text-center">{period.name}<span className="block text-[10px] font-medium text-muted-foreground">Min / Max</span></th>)}</tr></thead><tbody>{[...selectedLocations].flatMap(key => [...selectedProducts].map(stockCode => <tr key={`${key}:${stockCode}`} className="border-b hover:bg-muted/30"><td className="px-3 py-3"><strong className="block">{locationMap.get(key)?.name}</strong><span className="text-xs text-muted-foreground">{stockCode} · {productMap.get(stockCode)?.stokAdi}</span></td>{config.periods.map(period => <td key={period.id} className="px-2 py-2"><div className="flex justify-center gap-1"><input aria-label={`${period.name} minimum`} type="number" min="0" value={values[key]?.[stockCode]?.[period.id]?.min ?? ''} onChange={e => setCell(key, stockCode, period.id, 'min', e.target.value)} className={inputClass}/><input aria-label={`${period.name} maksimum`} type="number" min="0" value={values[key]?.[stockCode]?.[period.id]?.max ?? ''} onChange={e => setCell(key, stockCode, period.id, 'max', e.target.value)} className={inputClass}/></div></td>)}</tr>))}</tbody></table>}</div>
      </section>
    </div>
  </YonetimShell>;
}

function Selection({ title, subtitle, loading, header, children }: { title: string; subtitle: string; loading: boolean; header?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-border bg-card shadow-sm"><div className="border-b p-4"><h2 className="font-bold">{title}</h2><p className="text-xs text-muted-foreground">{subtitle}</p>{header && <div className="mt-3">{header}</div>}</div><div className="max-h-[680px] space-y-1 overflow-auto p-2">{loading ? <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin"/> : children}</div></section>;
}

function Choice({ selected, onClick, title, subtitle }: { selected: boolean; onClick: () => void; title: string; subtitle: string }) {
  return <button type="button" onClick={onClick} className={`flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${selected ? 'border-cyan-500 bg-cyan-500/10' : 'border-transparent hover:bg-muted'}`}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-muted-foreground/40'}`}>{selected && <Check className="h-3.5 w-3.5"/>}</span><span className="min-w-0"><strong className="block truncate text-sm">{title}</strong><span className="block truncate text-xs text-muted-foreground">{subtitle}</span></span></button>;
}
