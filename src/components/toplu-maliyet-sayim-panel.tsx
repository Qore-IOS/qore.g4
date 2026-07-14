'use client';
// Toplu maliyet sayım girişi: birden fazla lab/depo için tek ekrandan,
// Excel şablonu ile veya elle, döneme bağlı maliyet sayımı girme akışı.
//
// Adımlar:
//   1. Lokasyonları çoklu seç
//   2. Marka + ürün grubu + dönem seç
//   3. Giriş ekranı — Excel şablonu indir/yükle, arayüzde gözden geçir, kaydet
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ProductCode, MinMaxRule } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Search,
  TestTube,
  Building2,
  Loader2,
  X,
  Download,
  FileSpreadsheet,
  Save,
  Layers,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { normalizeCompanyId } from '@/lib/company-scope';
import {
  downloadTopluMaliyetSayimTemplate,
  parseTopluMaliyetSayimExcel,
  normalizeLokasyonAdi,
} from '@/lib/labCountExcel';

// ============================================================================
// TYPES
// ============================================================================

type LocationType = 'lab' | 'depot';
type UrunGrubu = 'kit' | 'sarf' | 'yedek_parca';

interface LocationOption {
  id: string;
  name: string;
}

interface BulkEntry {
  stokAdedi: string;      // '' = girilmedi; '0' dahi girilmiş sayılır
  cihazUstuAdedi: string; // '' = girilmedi
}

interface TopluMaliyetSayimPanelProps {
  locationType: LocationType;
  locations: LocationOption[];
  productCodes: ProductCode[];
  onClose: () => void;
}

type Step = 'locations' | 'filters' | 'entry';

// ============================================================================
// HELPERS
// ============================================================================

const URUN_GRUBU_LABELS: Record<UrunGrubu, string> = {
  kit: 'Kit',
  sarf: 'Sarf',
  yedek_parca: 'Yedek Parça',
};

function entryKey(locationId: string, stokKodu: string): string {
  return `${locationId}|${stokKodu}`;
}

/** '' = girilmedi; herhangi bir değer (0 dahil) girilmiş sayılır. */
function isEntered(entry?: BulkEntry): boolean {
  if (!entry) return false;
  return entry.stokAdedi.trim() !== '' || entry.cihazUstuAdedi.trim() !== '';
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function TopluMaliyetSayimPanel({
  locationType,
  locations,
  productCodes,
  onClose,
}: TopluMaliyetSayimPanelProps) {
  const { currentUserProfile, currentCompanyId } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('locations');
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set());
  const [locationSearch, setLocationSearch] = useState('');

  // Lokasyon başına tanımlı stok kodları (minMaxRules'tan)
  const [rulesByLocation, setRulesByLocation] = useState<Record<string, Set<string>>>({});
  const [isLoadingRules, setIsLoadingRules] = useState(false);

  // Filtreler (boş küme = tümü)
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<UrunGrubu>>(new Set());

  // Dönem
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());

  // Giriş ekranı
  const [entries, setEntries] = useState<Record<string, BulkEntry>>({});
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [isExcelBusy, setIsExcelBusy] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
    value: i,
    label: new Date(0, i, 1).toLocaleString('tr-TR', { month: 'long' }),
  })), []);
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 7 }, (_, i) => y - 3 + i);
  }, []);
  const period = useMemo(
    () => `${year}-${String(month + 1).padStart(2, '0')}`,
    [month, year],
  );
  const periodLabel = useMemo(
    () => `${monthOptions[month]?.label ?? ''} ${year}`,
    [month, year, monthOptions],
  );

  const selectedLocations = useMemo(
    () => locations.filter(l => selectedLocationIds.has(l.id)),
    [locations, selectedLocationIds],
  );

  const productByCode = useMemo(
    () => new Map(productCodes.map(p => [p.stokKodu, p])),
    [productCodes],
  );

  // ------------------------------------------------------------------
  // Adım 1 → 2: seçili lokasyonların minMaxRules'unu yükle
  // ------------------------------------------------------------------
  const loadRulesAndContinue = useCallback(async () => {
    if (selectedLocationIds.size === 0) return;
    setIsLoadingRules(true);
    try {
      const base = locationType === 'lab' ? 'hospitals' : 'depots';
      const ids = Array.from(selectedLocationIds);
      const snaps = await Promise.all(
        ids.map(id => getDocs(collection(db, `${base}/${id}/minMaxRules`))),
      );
      const map: Record<string, Set<string>> = {};
      ids.forEach((id, i) => {
        map[id] = new Set(snaps[i].docs.map(d => (d.data() as MinMaxRule).stokKodu));
      });
      setRulesByLocation(map);
      setStep('filters');
    } catch (err) {
      console.error('Toplu sayım minMaxRules yükleme hatası:', err);
      toast({ title: 'Hata', description: 'Lokasyon ürün tanımları yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoadingRules(false);
    }
  }, [selectedLocationIds, locationType, toast]);

  // ------------------------------------------------------------------
  // Kapsam: lokasyon başına filtrelenmiş ürün listesi
  // ------------------------------------------------------------------
  const scopedProductsByLocation = useMemo<Record<string, ProductCode[]>>(() => {
    const map: Record<string, ProductCode[]> = {};
    selectedLocations.forEach(loc => {
      const stokKoduSet = rulesByLocation[loc.id];
      if (!stokKoduSet) {
        map[loc.id] = [];
        return;
      }
      map[loc.id] = productCodes
        .filter(p => {
          if (!stokKoduSet.has(p.stokKodu)) return false;
          if (selectedBrands.size > 0 && !selectedBrands.has(p.marka || '')) return false;
          if (selectedGroups.size > 0 && !selectedGroups.has((p.urunGrubu || '') as UrunGrubu)) return false;
          return true;
        })
        .sort((a, b) => {
          const byMarka = (a.marka || '').localeCompare(b.marka || '', 'tr');
          if (byMarka !== 0) return byMarka;
          return a.stokAdi.localeCompare(b.stokAdi, 'tr');
        });
    });
    return map;
  }, [selectedLocations, rulesByLocation, productCodes, selectedBrands, selectedGroups]);

  // Seçili lokasyonlarda tanımlı tüm markalar (filtre seçenekleri)
  const availableBrands = useMemo(() => {
    const set = new Set<string>();
    Object.values(rulesByLocation).forEach(stokKodus => {
      stokKodus.forEach(kod => {
        const p = productByCode.get(kod);
        if (p?.marka) set.add(p.marka);
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [rulesByLocation, productByCode]);

  const availableGroups = useMemo(() => {
    const set = new Set<UrunGrubu>();
    Object.values(rulesByLocation).forEach(stokKodus => {
      stokKodus.forEach(kod => {
        const g = productByCode.get(kod)?.urunGrubu;
        if (g === 'kit' || g === 'sarf' || g === 'yedek_parca') set.add(g);
      });
    });
    return Array.from(set).sort();
  }, [rulesByLocation, productByCode]);

  // Lokasyon başına ilerleme: tanımlı ürün / sayım girilen ürün
  const progressByLocation = useMemo<Record<string, { total: number; entered: number }>>(() => {
    const map: Record<string, { total: number; entered: number }> = {};
    selectedLocations.forEach(loc => {
      const products = scopedProductsByLocation[loc.id] ?? [];
      const entered = products.filter(p => isEntered(entries[entryKey(loc.id, p.stokKodu)])).length;
      map[loc.id] = { total: products.length, entered };
    });
    return map;
  }, [selectedLocations, scopedProductsByLocation, entries]);

  const grandTotals = useMemo(() => {
    let total = 0;
    let entered = 0;
    Object.values(progressByLocation).forEach(p => {
      total += p.total;
      entered += p.entered;
    });
    return { total, entered };
  }, [progressByLocation]);

  // Giriş adımına geçerken ilk lokasyonu aktif yap
  useEffect(() => {
    if (step === 'entry' && !activeLocationId && selectedLocations.length > 0) {
      setActiveLocationId(selectedLocations[0].id);
    }
  }, [step, activeLocationId, selectedLocations]);

  // ------------------------------------------------------------------
  // Excel: şablon indirme + yükleme
  // ------------------------------------------------------------------
  const handleDownloadTemplate = useCallback(async () => {
    const rows = selectedLocations.flatMap(loc =>
      (scopedProductsByLocation[loc.id] ?? []).map(p => ({
        lokasyon: loc.name,
        marka: p.marka || '',
        stokKodu: p.stokKodu,
        stokAdi: p.stokAdi,
      })),
    );
    if (rows.length === 0) {
      toast({ title: 'Ürün yok', description: 'Seçilen filtrelerle sayıma dahil ürün bulunmuyor.' });
      return;
    }
    setIsExcelBusy(true);
    try {
      await downloadTopluMaliyetSayimTemplate(rows, `Toplu_Maliyet_Sayim_${period}.xlsx`);
      toast({ title: 'Şablon indirildi', description: `${selectedLocations.length} lokasyon, ${rows.length} ürün satırı içeren şablon indirildi.` });
    } catch (err: any) {
      console.error('Toplu sayım şablon indirme hatası:', err);
      toast({ title: 'Hata', description: err?.message || 'Şablon oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsExcelBusy(false);
    }
  }, [selectedLocations, scopedProductsByLocation, period, toast]);

  const handleExcelFileSelected = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setIsExcelBusy(true);
    try {
      const parsed = await parseTopluMaliyetSayimExcel(file);
      if (parsed.length === 0) {
        toast({ title: 'Veri bulunamadı', description: 'Yüklenen dosyada geçerli sayım girişi bulunamadı.', variant: 'destructive' });
        return;
      }

      // Lokasyon adı (normalize) → id eşlemesi
      const locationIdByName = new Map<string, string>();
      selectedLocations.forEach(loc => {
        locationIdByName.set(normalizeLokasyonAdi(loc.name), loc.id);
      });

      let applied = 0;
      let unknownLocation = 0;
      let unknownProduct = 0;
      setEntries(prev => {
        const next = { ...prev };
        parsed.forEach(({ lokasyon, stokKodu, stokAdedi, cihazUstuAdedi }) => {
          const locId = locationIdByName.get(normalizeLokasyonAdi(lokasyon));
          if (!locId) {
            unknownLocation++;
            return;
          }
          const inScope = (scopedProductsByLocation[locId] ?? []).some(p => p.stokKodu === stokKodu);
          if (!inScope) {
            unknownProduct++;
            return;
          }
          const key = entryKey(locId, stokKodu);
          const cur = next[key] ?? { stokAdedi: '', cihazUstuAdedi: '' };
          next[key] = {
            stokAdedi: stokAdedi !== null ? String(stokAdedi) : cur.stokAdedi,
            cihazUstuAdedi: cihazUstuAdedi !== null ? String(cihazUstuAdedi) : cur.cihazUstuAdedi,
          };
          applied++;
        });
        return next;
      });

      const parts: string[] = [`${applied} satır uygulandı`];
      if (unknownLocation > 0) parts.push(`${unknownLocation} satır bilinmeyen lokasyon`);
      if (unknownProduct > 0) parts.push(`${unknownProduct} satır kapsam dışı ürün`);
      toast({
        title: applied > 0 ? 'Excel yüklendi' : 'Eşleşen satır yok',
        description: parts.join(' · '),
        variant: applied > 0 ? 'default' : 'destructive',
      });
    } catch (err: any) {
      console.error('Toplu sayım Excel yükleme hatası:', err);
      toast({ title: 'Hata', description: err?.message || 'Excel dosyası okunamadı.', variant: 'destructive' });
    } finally {
      setIsExcelBusy(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  }, [selectedLocations, scopedProductsByLocation, toast]);

  // ------------------------------------------------------------------
  // Kaydet: her lokasyon için ayrı maliyetSayimSessions kaydı
  // ------------------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (isSaving) return;

    const perLocationItems = selectedLocations
      .map(loc => {
        const items = (scopedProductsByLocation[loc.id] ?? [])
          .filter(p => isEntered(entries[entryKey(loc.id, p.stokKodu)]))
          .map(p => {
            const e = entries[entryKey(loc.id, p.stokKodu)]!;
            return {
              stokKodu: p.stokKodu,
              stokAdi: p.stokAdi,
              marka: p.marka || '',
              stokAdedi: parseInt(e.stokAdedi, 10) || 0,
              cihazUstuAdedi: parseInt(e.cihazUstuAdedi, 10) || 0,
              cost: p.cost ?? 0,
              currency: p.currency || 'TRY',
              ambalajDegeri: Number(p.ambalajDegeri) || 1,
            };
          });
        return { loc, items };
      })
      .filter(x => x.items.length > 0);

    if (perLocationItems.length === 0) {
      toast({ title: 'Sayım yok', description: 'Kaydedilecek sayım girişi bulunamadı.' });
      return;
    }

    setIsSaving(true);
    try {
      await Promise.all(perLocationItems.map(({ loc, items }) =>
        addDoc(collection(db, 'maliyetSayimSessions'), {
          locationType,
          locationId: loc.id,
          locationName: loc.name,
          createdAt: serverTimestamp(),
          createdByUid: currentUserProfile?.uid ?? '',
          createdByName: currentUserProfile?.name ?? '',
          items,
          totalBrands: new Set(items.map(i => i.marka).filter(Boolean)).size,
          totalProducts: items.length,
          companyId: normalizeCompanyId(currentCompanyId),
          period,
          month,
          year,
          entryMethod: 'toplu',
        }),
      ));

      const totalItems = perLocationItems.reduce((s, x) => s + x.items.length, 0);
      toast({
        title: 'Toplu Sayım Kaydedildi',
        description: `${periodLabel} dönemi için ${perLocationItems.length} lokasyona toplam ${totalItems} ürün sayımı kaydedildi.`,
      });
      onClose();
    } catch (err) {
      console.error('Toplu sayım kaydetme hatası:', err);
      toast({ title: 'Kayıt Hatası', description: 'Toplu sayım kaydedilirken bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, selectedLocations, scopedProductsByLocation, entries, locationType, currentUserProfile, currentCompanyId, period, month, year, periodLabel, toast, onClose]);

  // ------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------
  const LocationIcon = locationType === 'lab' ? TestTube : Building2;
  const locationTypeLabel = locationType === 'lab' ? 'Laboratuvar' : 'Depo';

  // ---- Adım 1: Lokasyon çoklu seçimi ----
  if (step === 'locations') {
    const filtered = locationSearch.trim()
      ? locations.filter(l => normalizeText(l.name).includes(normalizeText(locationSearch)))
      : locations;
    return (
      <div className="cihaz-shell maliyet-clay min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-24">
          <div className="flex items-center gap-3 mb-6 px-1">
            <button
              onClick={onClose}
              className="shrink-0 flex items-center gap-1.5 text-sm text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Geri
            </button>
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <Layers className="h-5 w-5 text-[var(--dashboard-accent)]" />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)]">Toplu Sayım Gir</h1>
              <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">
                Toplu sayım girilecek {locationTypeLabel.toLocaleLowerCase('tr')}ları seçin
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] mb-3">
            <Search className="w-4 h-4 text-[var(--dashboard-muted)] shrink-0" />
            <input
              value={locationSearch}
              onChange={e => setLocationSearch(e.target.value)}
              placeholder={`${locationTypeLabel} ara...`}
              className="flex-1 bg-transparent text-sm text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)] outline-none"
            />
            {locationSearch && (
              <button onClick={() => setLocationSearch('')} className="text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs text-[var(--dashboard-muted)]">
              {selectedLocationIds.size} / {locations.length} seçildi
            </span>
            <button
              onClick={() => {
                setSelectedLocationIds(prev =>
                  prev.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id)),
                );
              }}
              className="text-xs font-semibold text-[var(--dashboard-accent)] hover:opacity-80"
            >
              {selectedLocationIds.size === filtered.length ? 'Seçimi Temizle' : 'Tümünü Seç'}
            </button>
          </div>

          <div className="space-y-2 mb-24">
            {filtered.length === 0 ? (
              <p className="text-center py-6 text-sm text-[var(--dashboard-muted)]">Sonuç bulunamadı.</p>
            ) : filtered.map(loc => {
              const isSelected = selectedLocationIds.has(loc.id);
              return (
                <button
                  key={loc.id}
                  onClick={() => {
                    setSelectedLocationIds(prev => {
                      const next = new Set(prev);
                      if (next.has(loc.id)) next.delete(loc.id);
                      else next.add(loc.id);
                      return next;
                    });
                  }}
                  className={cn(
                    'cihaz-tool-item cihaz-focus-ring flex items-center gap-3 px-4 py-3.5 w-full text-left',
                    isSelected && 'ring-2 ring-[var(--dashboard-accent)]',
                  )}
                >
                  <span className={cn(
                    'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors',
                    isSelected
                      ? 'border-[var(--dashboard-accent)] bg-[var(--dashboard-accent)]'
                      : 'border-[var(--dashboard-muted)]/30',
                  )}>
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] shrink-0">
                    <LocationIcon className="h-4 w-4 text-[var(--dashboard-accent)]" />
                  </span>
                  <span className="text-sm font-medium text-[var(--dashboard-text)] flex-1">{loc.name}</span>
                </button>
              );
            })}
          </div>

          <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)]/95 backdrop-blur-md px-4 sm:px-6 py-3">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--dashboard-muted)]">
                {selectedLocationIds.size} {locationTypeLabel.toLocaleLowerCase('tr')} seçildi
              </span>
              <Button
                onClick={loadRulesAndContinue}
                disabled={selectedLocationIds.size === 0 || isLoadingRules}
                className="h-10"
              >
                {isLoadingRules ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <ChevronRight className="w-4 h-4 mr-1.5" />}
                Devam Et
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Adım 2: Marka + ürün grubu + dönem ----
  if (step === 'filters') {
    return (
      <div className="cihaz-shell maliyet-clay min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-24">
          <div className="flex items-center gap-3 mb-6 px-1">
            <button
              onClick={() => setStep('locations')}
              className="shrink-0 flex items-center gap-1.5 text-sm text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Geri
            </button>
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <Layers className="h-5 w-5 text-[var(--dashboard-accent)]" />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)]">Filtre ve Dönem</h1>
              <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">
                {selectedLocations.length} {locationTypeLabel.toLocaleLowerCase('tr')} için marka, ürün grubu ve dönem seçin
              </p>
            </div>
          </div>

          {/* Dönem */}
          <div className="cihaz-card-strong rounded-2xl p-5 mb-4">
            <p className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-3">Dönem</p>
            <div className="flex items-center gap-2">
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="h-10 px-3 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-sm text-[var(--dashboard-text)] outline-none"
              >
                {monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="h-10 px-3 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-sm text-[var(--dashboard-text)] outline-none"
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {/* Ürün grubu */}
          <div className="cihaz-card-strong rounded-2xl p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Ürün Grubu</p>
              <span className="text-[11px] text-[var(--dashboard-muted)]">
                {selectedGroups.size === 0 ? 'Tümü dahil' : `${selectedGroups.size} grup seçili`}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableGroups.length === 0 ? (
                <p className="text-xs text-[var(--dashboard-muted)]">Tanımlı ürün grubu bulunamadı.</p>
              ) : availableGroups.map(g => {
                const isSelected = selectedGroups.has(g);
                return (
                  <button
                    key={g}
                    onClick={() => {
                      setSelectedGroups(prev => {
                        const next = new Set(prev);
                        if (next.has(g)) next.delete(g);
                        else next.add(g);
                        return next;
                      });
                    }}
                    className={cn(
                      'px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                      isSelected
                        ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                        : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]',
                    )}
                  >
                    {URUN_GRUBU_LABELS[g]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Marka */}
          <div className="cihaz-card-strong rounded-2xl p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Marka</p>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-[var(--dashboard-muted)]">
                  {selectedBrands.size === 0 ? 'Tümü dahil' : `${selectedBrands.size} marka seçili`}
                </span>
                {selectedBrands.size > 0 && (
                  <button
                    onClick={() => setSelectedBrands(new Set())}
                    className="text-[11px] font-semibold text-[var(--dashboard-accent)] hover:opacity-80"
                  >
                    Temizle
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableBrands.length === 0 ? (
                <p className="text-xs text-[var(--dashboard-muted)]">Tanımlı marka bulunamadı.</p>
              ) : availableBrands.map(b => {
                const isSelected = selectedBrands.has(b);
                return (
                  <button
                    key={b}
                    onClick={() => {
                      setSelectedBrands(prev => {
                        const next = new Set(prev);
                        if (next.has(b)) next.delete(b);
                        else next.add(b);
                        return next;
                      });
                    }}
                    className={cn(
                      'px-3 py-1.5 rounded-xl text-xs font-semibold transition-all',
                      isSelected
                        ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                        : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]',
                    )}
                  >
                    {b}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)]/95 backdrop-blur-md px-4 sm:px-6 py-3">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--dashboard-muted)]">
                {periodLabel} · {grandTotals.total} ürün kapsamda
              </span>
              <Button onClick={() => setStep('entry')} disabled={grandTotals.total === 0} className="h-10">
                <ChevronRight className="w-4 h-4 mr-1.5" />
                Sayım Ekranına Geç
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Adım 3: Toplu giriş ekranı ----
  const activeLocation = selectedLocations.find(l => l.id === activeLocationId) ?? selectedLocations[0];
  const activeProducts = activeLocation ? (scopedProductsByLocation[activeLocation.id] ?? []) : [];
  const visibleProducts = productSearch.trim()
    ? activeProducts.filter(p =>
        normalizeText(p.stokAdi).includes(normalizeText(productSearch)) ||
        normalizeText(p.stokKodu).includes(normalizeText(productSearch)))
    : activeProducts;

  return (
    <div className="cihaz-shell maliyet-clay min-h-screen flex flex-col">
      {/* Üst çubuk */}
      <div className="sticky top-0 z-[var(--z-sticky)] bg-[var(--dashboard-bg)]/95 backdrop-blur-md border-b border-[var(--dashboard-stroke)]">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap">
          <button
            onClick={() => setStep('filters')}
            className="shrink-0 flex items-center gap-2 text-sm text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Geri</span>
          </button>

          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--dashboard-accent)]" />
            <span className="text-sm font-semibold text-[var(--dashboard-text)]">Toplu Sayım</span>
            <span className="text-xs text-[var(--dashboard-muted)] px-2 py-0.5 rounded-lg bg-[var(--dashboard-surface-2)]">
              {periodLabel}
            </span>
          </div>

          {/* Excel */}
          <div className="flex items-center gap-1.5">
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="sr-only"
              onChange={(e) => handleExcelFileSelected(e.target.files?.[0])}
            />
            <button
              onClick={handleDownloadTemplate}
              disabled={isExcelBusy}
              title="Toplu sayım şablonunu Excel olarak indir"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExcelBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span className="hidden md:inline">Şablon İndir</span>
            </button>
            <button
              onClick={() => excelInputRef.current?.click()}
              disabled={isExcelBusy}
              title="Doldurulmuş Excel şablonunu yükleyerek sayım gir"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExcelBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              <span className="hidden md:inline">Excel ile Sayım</span>
            </button>
          </div>

          {/* Toplam ilerleme + kaydet */}
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-xs text-[var(--dashboard-muted)]">
              {grandTotals.entered} / {grandTotals.total} ürün girildi
            </span>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || grandTotals.entered === 0}
              className="h-9 text-xs"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
              Kaydet
            </Button>
          </div>
        </div>
      </div>

      {/* İçerik */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sol: lokasyon listesi */}
        <aside className="shrink-0 w-[260px] sm:w-[300px] border-r border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)] flex flex-col">
          <div className="px-4 py-3 border-b border-[var(--dashboard-stroke)]">
            <span className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">
              {locationTypeLabel} Listesi
            </span>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {selectedLocations.map(loc => {
                const prog = progressByLocation[loc.id] ?? { total: 0, entered: 0 };
                const isActive = loc.id === activeLocation?.id;
                const done = prog.total > 0 && prog.entered === prog.total;
                return (
                  <button
                    key={loc.id}
                    onClick={() => setActiveLocationId(loc.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-200',
                      isActive
                        ? 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-l-[3px] border-l-[var(--dashboard-accent)]'
                        : 'hover:bg-[var(--dashboard-surface-2)]/50',
                    )}
                  >
                    <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] shrink-0">
                      <LocationIcon className="h-4 w-4 text-[var(--dashboard-accent)]" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium block truncate text-[var(--dashboard-text)]">
                        {loc.name}
                      </span>
                      <span className="text-xs text-[var(--dashboard-muted)]">
                        {prog.total} tanımlı · <span className={cn(prog.entered > 0 && 'text-emerald-500 font-semibold')}>{prog.entered} girildi</span>
                      </span>
                    </div>
                    {done && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </aside>

        {/* Sağ: aktif lokasyonun ürünleri */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {activeLocation ? (
            <>
              <div className="px-4 sm:px-6 py-4 border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)]">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-lg font-bold text-[var(--dashboard-text)]">{activeLocation.name}</h2>
                    <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">
                      {progressByLocation[activeLocation.id]?.total ?? 0} tanımlı ürün
                      {' · '}
                      <span className="text-emerald-500">
                        {progressByLocation[activeLocation.id]?.entered ?? 0} sayım girildi
                      </span>
                    </p>
                  </div>
                  <div className="relative min-w-[160px] max-w-[280px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dashboard-muted)]" />
                    <Input
                      type="text"
                      placeholder="Ürün ara..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="pl-9 h-9 text-sm"
                    />
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="cihaz-card-strong m-4 sm:m-6 overflow-hidden">
                  {/* Başlık satırı */}
                  <div className="hidden sm:flex items-center gap-3 px-4 sm:px-5 py-2 border-b border-[var(--dashboard-stroke)] text-[10px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">
                    <span className="flex-1">Ürün</span>
                    <span className="w-24 text-center">Stok Adedi</span>
                    <span className="w-24 text-center">Cihaz Üstü</span>
                  </div>
                  {visibleProducts.length > 0 ? (
                    visibleProducts.map(product => {
                      const key = entryKey(activeLocation.id, product.stokKodu);
                      const entry = entries[key] ?? { stokAdedi: '', cihazUstuAdedi: '' };
                      const entered = isEntered(entry);
                      return (
                        <div
                          key={product.stokKodu}
                          className={cn(
                            'flex flex-wrap sm:flex-nowrap items-center gap-3 px-4 sm:px-5 py-3 border-b border-[var(--dashboard-stroke)] last:border-b-0 transition-all',
                            entered && 'bg-emerald-500/5',
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--dashboard-text)] truncate">
                              {product.stokAdi}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <span className="text-[11px] text-[var(--dashboard-muted)]">{product.stokKodu}</span>
                              {product.marka && (
                                <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] bg-[var(--dashboard-surface-2)] px-1.5 py-0.5 rounded">
                                  {product.marka}
                                </span>
                              )}
                              {product.urunGrubu && (
                                <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] bg-[var(--dashboard-surface-2)] px-1.5 py-0.5 rounded">
                                  {URUN_GRUBU_LABELS[product.urunGrubu as UrunGrubu] ?? product.urunGrubu}
                                </span>
                              )}
                              {entered && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-600">
                                  <Check className="w-2.5 h-2.5" />
                                  Girildi
                                </span>
                              )}
                            </div>
                          </div>
                          <Input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            placeholder="—"
                            value={entry.stokAdedi}
                            onChange={(e) => setEntries(prev => ({
                              ...prev,
                              [key]: { ...(prev[key] ?? { stokAdedi: '', cihazUstuAdedi: '' }), stokAdedi: e.target.value },
                            }))}
                            className="h-9 text-sm w-24 text-center shrink-0"
                            title="Stok Adedi"
                          />
                          <Input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            placeholder="—"
                            value={entry.cihazUstuAdedi}
                            onChange={(e) => setEntries(prev => ({
                              ...prev,
                              [key]: { ...(prev[key] ?? { stokAdedi: '', cihazUstuAdedi: '' }), cihazUstuAdedi: e.target.value },
                            }))}
                            className="h-9 text-sm w-24 text-center shrink-0"
                            title="Cihaz Üstü Test"
                          />
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-12 text-sm text-[var(--dashboard-muted)]">
                      {productSearch ? 'Aramayla eşleşen ürün bulunamadı.' : 'Bu lokasyonda seçili filtrelerle tanımlı ürün yok.'}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[var(--dashboard-muted)]">
              Sol panelden bir {locationTypeLabel.toLocaleLowerCase('tr')} seçin
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
