
'use client';
import React, { useState, useEffect, useMemo, ChangeEvent } from 'react';
import type { Depot, Hospital, ProductCode, MinMaxRule } from '@/lib/types';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, writeBatch, addDoc, serverTimestamp } from 'firebase/firestore';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Upload, Download, Loader2, Save, Trash2, SlidersHorizontal, Clock, Search, X, Plus } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { exportDataToExcel, readExcelData } from '@/lib/utils';

interface MinMaxSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  target: Depot | Hospital;
  targetType: 'depot' | 'hospital' | 'laboratory' | 'spare_parts_depot';
  productCodes: ProductCode[];
  toast: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void;
}

interface RuleState {
  [stockCode: string]: {
    min: number | string;
    max: number | string;
    maxGun?: number | string;
    aylikTuketimLimiti?: number | string;
    ortalamaTuketimSuresi?: number | string;
    tuketimSuresiBirimi?: 'gun' | 'saat';
    enabled: boolean;
  }
}

type PanelTab = 'selected' | 'unselected';

export default function MinMaxSettingsPanel({ isOpen, onClose, target, targetType, productCodes, toast }: MinMaxSettingsPanelProps) {
  const [rules, setRules] = useState<RuleState>({});
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [existingRuleCodes, setExistingRuleCodes] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<PanelTab>('selected');

  const collectionName = targetType === 'depot' ? 'depots' : targetType === 'spare_parts_depot' ? 'yedekParcaDepoMinMax' : 'hospitals';
  const isDepotLike = targetType === 'depot' || targetType === 'spare_parts_depot';
  const locationLabel = targetType === 'depot' ? 'depo' : targetType === 'spare_parts_depot' ? 'yedek parça deposu' : 'hastane';
  const targetId = target?.id;
  const targetName = target?.name || 'Hedef';

  useEffect(() => {
    if (!isOpen || !targetId) return;
    const fetchRules = async () => {
      setIsLoading(true);
      const fetchedRules: RuleState = {};
      try {
        const rulesRef = collection(db, collectionName, targetId, "minMaxRules");
        const snapshot = await getDocs(rulesRef);
        snapshot.forEach(d => {
          const data = d.data() as MinMaxRule;
          if (data.stokKodu) {
            fetchedRules[data.stokKodu] = {
              min: data.min ?? 0,
              max: data.max ?? 0,
              maxGun: (data.maxGun ?? '') as string | number,
              aylikTuketimLimiti: (data.aylikTuketimLimiti ?? '') as string | number,
              ortalamaTuketimSuresi: (data.ortalamaTuketimSuresi ?? '') as string | number,
              tuketimSuresiBirimi: data.tuketimSuresiBirimi ?? 'gun',
              enabled: true
            };
          }
        });
        setRules(fetchedRules);
        setExistingRuleCodes(new Set(Object.keys(fetchedRules)));
      } catch (error) {
        console.error(`Error fetching min-max rules for ${targetType}:`, error);
        toast({ title: "Hata", description: "Min-Max kuralları yüklenirken bir sorun oluştu.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    };
    fetchRules();
  }, [isOpen, targetId, toast, targetType, collectionName]);

  const handleCheckboxChange = (stockCode: string, checked: boolean | string) => {
    setRules(prev => {
      const newRules = { ...prev };
      if (checked) {
        newRules[stockCode] = { ...(newRules[stockCode] || { min: '', max: '', maxGun: '', aylikTuketimLimiti: '', ortalamaTuketimSuresi: '', tuketimSuresiBirimi: 'gun' }), enabled: true };
      } else {
        if (newRules[stockCode]) {
          newRules[stockCode].enabled = false;
        } else {
          newRules[stockCode] = { min: '', max: '', maxGun: '', aylikTuketimLimiti: '', ortalamaTuketimSuresi: '', tuketimSuresiBirimi: 'gun', enabled: false };
        }
      }
      return newRules;
    });
  };

  const handleRuleChange = (stockCode: string, field: 'min' | 'max' | 'maxGun' | 'aylikTuketimLimiti' | 'ortalamaTuketimSuresi', value: string) => {
    const numValue = value === '' ? '' : Number(value);
    setRules(prev => ({
      ...prev,
      [stockCode]: { ...(prev[stockCode] ?? { min: '', max: '', maxGun: '', aylikTuketimLimiti: '', ortalamaTuketimSuresi: '', tuketimSuresiBirimi: 'gun', enabled: true }), [field]: numValue }
    }));
  };

  const handleBirimChange = (stockCode: string, birim: 'gun' | 'saat') => {
    setRules(prev => ({
      ...prev,
      [stockCode]: { ...(prev[stockCode] ?? { min: '', max: '', maxGun: '', aylikTuketimLimiti: '', ortalamaTuketimSuresi: '', tuketimSuresiBirimi: 'gun', enabled: true }), tuketimSuresiBirimi: birim }
    }));
  };

  const handleExcelUpsertRules = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    try {
      const jsonData = await readExcelData(file, toast);
      const updatedRules: RuleState = {};
      const validProductCodes = new Set(productCodes.map(product => product.stokKodu).filter(Boolean) as string[]);
      let upsertedRows = 0;
      let newlyEnabledRows = 0;
      let skippedRows = 0;

      jsonData.forEach((row: any) => {
        const stockCode = String(row['stock_code'] || row['Stok Kodu'] || '').trim();
        if (!stockCode || !validProductCodes.has(stockCode)) { skippedRows++; return; }
        const min = Number(row['min']);
        const max = Number(row['max']);
        const maxGun = Number(row['max_gun'] || row['Max Gün']);
        const aylikTuketimLimiti = Number(row['aylik_tuketim_limiti'] || row['Aylık Tüketim Limiti']);
        const ortalamaTuketimSuresi = Number(row['ortalama_tuketim_suresi'] || row['Ort. Tüketim Süresi']);
        const tuketimBirimi = String(row['tuketim_birimi'] || row['Tüketim Birimi'] || '').toLowerCase();
        if (isNaN(min) || isNaN(max) || min < 0 || max < min) { skippedRows++; return; }
        const willBeNewRule = !existingRuleCodes.has(stockCode);
        updatedRules[stockCode] = {
          min, max,
          maxGun: isNaN(maxGun) ? '' : maxGun,
          aylikTuketimLimiti: isNaN(aylikTuketimLimiti) ? '' : aylikTuketimLimiti,
          ortalamaTuketimSuresi: isNaN(ortalamaTuketimSuresi) ? '' : ortalamaTuketimSuresi,
          tuketimSuresiBirimi: tuketimBirimi === 'saat' ? 'saat' : (rules[stockCode]?.tuketimSuresiBirimi ?? 'gun'),
          enabled: true
        };
        upsertedRows++;
        if (willBeNewRule) newlyEnabledRows++;
      });

      if (upsertedRows === 0) {
        toast({ title: "İşlenecek Veri Yok", description: "Excel dosyasında geçerli veri bulunamadı.", variant: "destructive" });
        return;
      }
      const mergedRules = { ...rules, ...updatedRules };
      setRules(mergedRules);
      setExistingRuleCodes(new Set(Object.keys(mergedRules).filter(code => mergedRules[code]?.enabled)));
      setActiveTab('selected');
      toast({ title: "Başarılı", description: `${upsertedRows} kural işlendi${newlyEnabledRows > 0 ? `, ${newlyEnabledRows} yeni` : ''}${skippedRows > 0 ? `, ${skippedRows} atlandı` : ''}.` });
    } catch (error) {
      toast({ title: "Excel Hatası", description: "Excel dosyası işlenirken bir sorun oluştu.", variant: "destructive" });
    } finally {
      setIsLoading(false);
      if (event.target) event.target.value = '';
    }
  };

  const handleExportCurrentRules = () => {
    const enabledRules = Object.entries(rules).filter(([, rule]) => rule.enabled);
    if (enabledRules.length === 0) {
      toast({ title: "Veri Yok", description: "Dışa aktarılacak aktif kural bulunmuyor.", variant: "default" });
      return;
    }
    const dataToExport = enabledRules.map(([stockCode, rule]) => ({
      'Stok Kodu': stockCode,
      min: rule.min,
      max: rule.max,
      'Max Gün': rule.maxGun,
      'Aylık Tüketim Limiti': rule.aylikTuketimLimiti,
      'Ort. Tüketim Süresi': rule.ortalamaTuketimSuresi,
      'Tüketim Birimi': rule.tuketimSuresiBirimi === 'saat' ? 'Saat' : 'Gün',
    }));
    exportDataToExcel(dataToExport, `${targetName}_MinMax_Kurallari`, 'Kurallar', toast);
  };

  const handleSaveRules = async () => {
    setIsLoading(true);
    let hasError = false;
    if (!targetId) {
      toast({ title: "Hata", description: "Hedef bilgisi eksik.", variant: "destructive" });
      setIsLoading(false);
      return;
    }
    const rulesCollectionRef = collection(db, collectionName, targetId, "minMaxRules");
    const existingRulesSnapshot = await getDocs(rulesCollectionRef);
    const existingRuleIds = new Set(existingRulesSnapshot.docs.map(d => d.id));

    const batches = [];
    let currentBatch = writeBatch(db);
    let opCount = 0;

    const BATCH_LIMIT = 450;

    const commitOp = () => {
      opCount++;
      if (opCount >= BATCH_LIMIT) {
        batches.push(currentBatch);
        currentBatch = writeBatch(db);
        opCount = 0;
      }
    };

    for (const stockCode in rules) {
      const rule = rules[stockCode];
      const ruleRef = doc(db, collectionName, targetId, "minMaxRules", stockCode);
      const historyRef = doc(collection(db, 'minMaxHistory'));

      if (rule.enabled) {
        const min = Number(rule.min);
        const max = Number(rule.max);
        const maxGun = rule.maxGun === '' ? undefined : Number(rule.maxGun);
        const aylikTuketimLimiti = rule.aylikTuketimLimiti === '' ? undefined : Number(rule.aylikTuketimLimiti);
        const ortalamaTuketimSuresi = rule.ortalamaTuketimSuresi === '' ? undefined : Number(rule.ortalamaTuketimSuresi);
        const tuketimSuresiBirimi = rule.tuketimSuresiBirimi ?? 'gun';
        if (isNaN(min) || isNaN(max) || min < 0 || max < min || (maxGun !== undefined && (isNaN(maxGun) || maxGun < 0)) || (aylikTuketimLimiti !== undefined && isNaN(aylikTuketimLimiti))) {
          toast({ title: `Hata: ${stockCode}`, description: `Geçersiz değerler.`, variant: "destructive" });
          hasError = true;
          continue;
        }
        const dataToSet: MinMaxRule = { stokKodu: stockCode, min, max };
        if (maxGun !== undefined) dataToSet.maxGun = maxGun;
        if (aylikTuketimLimiti !== undefined) dataToSet.aylikTuketimLimiti = aylikTuketimLimiti;
        if (ortalamaTuketimSuresi !== undefined) { dataToSet.ortalamaTuketimSuresi = ortalamaTuketimSuresi; dataToSet.tuketimSuresiBirimi = tuketimSuresiBirimi; }
        
        currentBatch.set(ruleRef, dataToSet);
        commitOp();
        
        currentBatch.set(historyRef, { ...dataToSet, locationId: targetId, locationType: targetType, timestamp: serverTimestamp() });
        commitOp();
      } else {
        if (existingRuleIds.has(stockCode)) {
          currentBatch.delete(ruleRef);
          commitOp();
          
          currentBatch.set(historyRef, { stokKodu: stockCode, min: null, max: null, maxGun: null, aylikTuketimLimiti: null, locationId: targetId, locationType: targetType, timestamp: serverTimestamp(), action: 'deleted' });
          commitOp();
        }
      }
    }
    
    if (opCount > 0) {
      batches.push(currentBatch);
    }
    
    if (hasError) { setIsLoading(false); return; }
    try {
      for (const b of batches) {
        await b.commit();
      }
      toast({ title: "Başarılı", description: `${targetName} için min-max kuralları kaydedildi.` });
      onClose();
    } catch (error) {
      console.error("Error saving rules:", error);
      toast({ title: "Veritabanı Hatası", description: "Kurallar kaydedilirken bir sorun oluştu.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetRules = async () => {
    if (!window.confirm(`${targetName} için tanımlanmış tüm min-max kuralları kalıcı olarak silinecektir. Emin misiniz?`)) return;
    setIsLoading(true);
    try {
      if (!targetId) {
        toast({ title: "Hata", description: "Hedef bilgisi eksik.", variant: "destructive" });
        setIsLoading(false);
        return;
      }
      const rulesRef = collection(db, collectionName, targetId, "minMaxRules");
      const snapshot = await getDocs(rulesRef);
      if (snapshot.empty) {
        toast({ title: "Bilgi", description: `Bu ${locationLabel} için zaten tanımlı kural bulunmuyor.`, variant: "default" });
        setIsLoading(false);
        return;
      }
      
      const batches = [];
      let currentBatch = writeBatch(db);
      let opCount = 0;
      
      const BATCH_LIMIT = 450;
      const commitOp = () => {
        opCount++;
        if (opCount >= BATCH_LIMIT) {
          batches.push(currentBatch);
          currentBatch = writeBatch(db);
          opCount = 0;
        }
      };

      snapshot.forEach(d => {
        currentBatch.delete(d.ref);
        commitOp();
      });

      if (opCount > 0) {
        batches.push(currentBatch);
      }

      for (const b of batches) {
        await b.commit();
      }
      
      setRules({});
      setExistingRuleCodes(new Set());
      toast({ title: "Başarılı", description: `Tüm min-max kuralları sıfırlandı.` });
    } catch (error) {
      console.error("Error resetting rules:", error);
      toast({ title: "Hata", description: "Kurallar sıfırlanırken bir hata oluştu.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const matchesSearch = (product: ProductCode) => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return true;
    return (product.stokAdi ?? '').toLowerCase().includes(keyword) || (product.stokKodu ?? '').toLowerCase().includes(keyword);
  };

  const selectedProducts = useMemo(() =>
    productCodes.filter(p => Boolean(rules[p.stokKodu ?? '']?.enabled) && matchesSearch(p)),
    [productCodes, rules, searchQuery]
  );

  const unselectedProducts = useMemo(() =>
    productCodes.filter(p => !rules[p.stokKodu ?? '']?.enabled && matchesSearch(p)),
    [productCodes, rules, searchQuery]
  );

  const selectedCount = useMemo(() =>
    productCodes.filter(p => Boolean(rules[p.stokKodu ?? '']?.enabled)).length,
    [productCodes, rules]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--dashboard-bg, #f8fafc)' }}>
      {/* Top bar */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 px-4 sm:px-6 py-3 border-b" style={{ background: 'var(--dashboard-card, #fff)', borderColor: 'var(--dashboard-stroke, #e5e7eb)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <SlidersHorizontal className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--dashboard-accent, #6366f1)' }} />
          <div className="min-w-0">
            <h1 className="text-sm font-bold truncate" style={{ color: 'var(--dashboard-text, #111)' }}>Min-Max Stok Seviyeleri</h1>
            <p className="text-[11px] truncate" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>{target.name} &middot; {selectedCount} ürün tanımlı</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleSaveRules}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-40 transition-all active:scale-95"
            style={{ background: 'var(--dashboard-accent, #6366f1)' }}
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Kaydet
          </button>
          <button onClick={onClose} className="p-2 rounded-xl transition-colors hover:bg-black/5" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-2 px-4 sm:px-6 py-2.5 border-b" style={{ borderColor: 'var(--dashboard-stroke, #e5e7eb)', background: 'var(--dashboard-card, #fff)' }}>
        {/* Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md px-3 py-1.5 rounded-xl" style={{ background: 'var(--dashboard-pressed, #f3f4f6)' }}>
          <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--dashboard-muted, #6b7280)' }} />
          <input
            type="text"
            placeholder="Ürün adı veya stok kodu ile ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--dashboard-muted)]"
            style={{ color: 'var(--dashboard-text, #111)' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="p-0.5 rounded hover:bg-black/5">
              <X className="w-3 h-3" style={{ color: 'var(--dashboard-muted, #6b7280)' }} />
            </button>
          )}
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={handleExportCurrentRules} disabled={isLoading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors hover:bg-black/5" style={{ color: 'var(--dashboard-text, #111)' }}>
            <Download className="w-3.5 h-3.5" /> İndir
          </button>
          <label htmlFor="minmax-excel-update" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-colors hover:bg-black/5" style={{ color: 'var(--dashboard-text, #111)' }}>
            <Upload className="w-3.5 h-3.5" /> Excel Yükle
            <input id="minmax-excel-update" type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpsertRules} />
          </label>
          <button onClick={handleResetRules} disabled={isLoading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors hover:bg-red-50" style={{ color: '#B91C1C' }}>
            <Trash2 className="w-3.5 h-3.5" /> Sıfırla
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 sm:px-6 pt-3 pb-0">
        <button
          onClick={() => setActiveTab('selected')}
          className="px-4 py-2 rounded-t-xl text-xs font-semibold transition-colors border border-b-0"
          style={{
            background: activeTab === 'selected' ? 'var(--dashboard-card, #fff)' : 'transparent',
            color: activeTab === 'selected' ? 'var(--dashboard-accent, #6366f1)' : 'var(--dashboard-muted, #6b7280)',
            borderColor: activeTab === 'selected' ? 'var(--dashboard-stroke, #e5e7eb)' : 'transparent',
          }}
        >
          Tanımlı Ürünler ({selectedProducts.length})
        </button>
        <button
          onClick={() => setActiveTab('unselected')}
          className="px-4 py-2 rounded-t-xl text-xs font-semibold transition-colors border border-b-0"
          style={{
            background: activeTab === 'unselected' ? 'var(--dashboard-card, #fff)' : 'transparent',
            color: activeTab === 'unselected' ? 'var(--dashboard-accent, #6366f1)' : 'var(--dashboard-muted, #6b7280)',
            borderColor: activeTab === 'unselected' ? 'var(--dashboard-stroke, #e5e7eb)' : 'transparent',
          }}
        >
          <Plus className="w-3 h-3 inline mr-1" />
          Ürün Ekle ({unselectedProducts.length})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 sm:px-6 pb-4 border-t" style={{ borderColor: 'var(--dashboard-stroke, #e5e7eb)' }}>
        {isLoading && !Object.keys(rules).length ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--dashboard-accent, #6366f1)' }} />
            <span className="ml-2 text-sm" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>Yükleniyor...</span>
          </div>
        ) : activeTab === 'selected' ? (
          selectedProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>
              <SlidersHorizontal className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm font-medium">{searchQuery ? 'Eşleşen tanımlı ürün yok.' : 'Henüz min-max kuralı tanımlanmamış.'}</p>
              <p className="text-xs mt-1">Ürün Ekle sekmesinden ürün seçerek başlayın.</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--dashboard-stroke, #e5e7eb)' }}>
                    <th className="text-left px-4 sm:px-6 py-2.5 text-[10px] font-semibold uppercase tracking-wider w-10" style={{ color: 'var(--dashboard-muted, #6b7280)' }}></th>
                    <th className="text-left px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>Ürün</th>
                    <th className="text-left px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider w-[90px]" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>Min</th>
                    <th className="text-left px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider w-[90px]" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>Max</th>
                    <th className="text-left px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider w-[90px]" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>Max Gün</th>
                    {!isDepotLike && (
                      <th className="text-left px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider w-[110px]" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>Aylık Limit</th>
                    )}
                    <th className="text-left px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider w-[160px]" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Ort. Tüketim</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProducts.map(product => {
                    const rule = rules[product.stokKodu!];
                    const isEnabled = rule?.enabled ?? false;
                    return (
                      <tr key={product.id} className="border-b transition-colors hover:bg-black/[.015]" style={{ borderColor: 'var(--dashboard-stroke, #e5e7eb)' }}>
                        <td className="px-4 sm:px-6 py-2">
                          <Checkbox
                            checked={isEnabled}
                            onCheckedChange={(checked) => handleCheckboxChange(product.stokKodu!, checked)}
                          />
                        </td>
                        <td className="px-2 py-2 min-w-[180px]">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--dashboard-text, #111)' }}>{product.stokAdi}</p>
                          <p className="text-[10px] font-mono" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>{product.stokKodu}</p>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            value={isEnabled ? (rule?.min ?? '') : ''}
                            onChange={e => handleRuleChange(product.stokKodu!, 'min', e.target.value)}
                            disabled={!isEnabled}
                            className="w-full h-8 px-2.5 rounded-lg text-xs border-0 outline-none disabled:opacity-30"
                            style={{ background: 'var(--dashboard-pressed, #f3f4f6)', color: 'var(--dashboard-text, #111)' }}
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            value={isEnabled ? (rule?.max ?? '') : ''}
                            onChange={e => handleRuleChange(product.stokKodu!, 'max', e.target.value)}
                            disabled={!isEnabled}
                            className="w-full h-8 px-2.5 rounded-lg text-xs border-0 outline-none disabled:opacity-30"
                            style={{ background: 'var(--dashboard-pressed, #f3f4f6)', color: 'var(--dashboard-text, #111)' }}
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            value={isEnabled ? (rule?.maxGun ?? '') : ''}
                            onChange={e => handleRuleChange(product.stokKodu!, 'maxGun', e.target.value)}
                            disabled={!isEnabled}
                            className="w-full h-8 px-2.5 rounded-lg text-xs border-0 outline-none disabled:opacity-30"
                            style={{ background: 'var(--dashboard-pressed, #f3f4f6)', color: 'var(--dashboard-text, #111)' }}
                            placeholder="-"
                          />
                        </td>
                        {!isDepotLike && (
                          <td className="px-2 py-2">
                            <input
                              type="number"
                              value={isEnabled ? (rule?.aylikTuketimLimiti ?? '') : ''}
                              onChange={e => handleRuleChange(product.stokKodu!, 'aylikTuketimLimiti', e.target.value)}
                              disabled={!isEnabled}
                              className="w-full h-8 px-2.5 rounded-lg text-xs border-0 outline-none disabled:opacity-30"
                              style={{ background: 'var(--dashboard-pressed, #f3f4f6)', color: 'var(--dashboard-text, #111)' }}
                              placeholder="-"
                            />
                          </td>
                        )}
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              value={isEnabled ? (rule?.ortalamaTuketimSuresi ?? '') : ''}
                              onChange={e => handleRuleChange(product.stokKodu!, 'ortalamaTuketimSuresi', e.target.value)}
                              disabled={!isEnabled}
                              className="w-16 h-8 px-2.5 rounded-lg text-xs border-0 outline-none disabled:opacity-30"
                              style={{ background: 'var(--dashboard-pressed, #f3f4f6)', color: 'var(--dashboard-text, #111)' }}
                              placeholder="-"
                              min={0}
                              step={0.5}
                            />
                            <Select
                              value={isEnabled ? (rule?.tuketimSuresiBirimi ?? 'gun') : 'gun'}
                              onValueChange={(val) => handleBirimChange(product.stokKodu!, val as 'gun' | 'saat')}
                              disabled={!isEnabled}
                            >
                              <SelectTrigger className="h-8 w-[68px] text-[11px] border-0 rounded-lg" style={{ background: 'var(--dashboard-pressed, #f3f4f6)' }}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="gun">Gün</SelectItem>
                                <SelectItem value="saat">Saat</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* Unselected / Add Products Tab */
          unselectedProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>
              <Plus className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm font-medium">{searchQuery ? 'Eşleşen ürün yok.' : 'Tüm ürünler zaten tanımlı.'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 pt-3">
              {unselectedProducts.map(product => (
                <button
                  key={product.id}
                  onClick={() => { handleCheckboxChange(product.stokKodu!, true); setActiveTab('selected'); }}
                  className="flex items-center gap-3 p-3 rounded-xl border text-left transition-all hover:shadow-sm active:scale-[0.99]"
                  style={{ borderColor: 'var(--dashboard-stroke, #e5e7eb)', background: 'var(--dashboard-card, #fff)' }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--dashboard-pressed, #f3f4f6)' }}>
                    <Plus className="w-4 h-4" style={{ color: 'var(--dashboard-accent, #6366f1)' }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate" style={{ color: 'var(--dashboard-text, #111)' }}>{product.stokAdi}</p>
                    <p className="text-[10px] font-mono truncate" style={{ color: 'var(--dashboard-muted, #6b7280)' }}>{product.stokKodu}</p>
                  </div>
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
