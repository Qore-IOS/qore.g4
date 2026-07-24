'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Loader2,
  Mail,
  MailWarning,
  PackageSearch,
  Send,
  Star,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery, getScopedDocs } from '@/lib/firestore-helpers';
import { withCompanyScope, filterByCompanyScope } from '@/lib/company-scope';
import { generateId } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useDepots } from '@/hooks/useFirebaseQueries';
import type {
  BrandDefinition,
  MinMaxRule,
  ProductCode,
  SupplierOrder,
  SupplierOrderItem,
} from '@/lib/types';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LOJISTIK_HOME_PATH } from '@/lib/lojistik/navigation';

// Lojistik görünümüyle uyumlu ortak tasarım sınıfları (sayımlar sayfasıyla aynı).
const PANEL_CLASS =
  'rounded-[26px] border border-emerald-950/10 bg-white/85 shadow-[0_24px_55px_-32px_rgba(6,78,59,0.35)] backdrop-blur-xl dark:border-fuchsia-400/15 dark:bg-[#160e1e]/80 dark:shadow-[0_28px_65px_-34px_rgba(0,0,0,0.85)]';
const FIELD_LABEL_CLASS =
  'mb-1.5 block text-xs font-extrabold uppercase tracking-[0.08em] text-[#587169] dark:text-[#a994b5]';
const CONTROL_CLASS =
  'min-h-11 rounded-xl border-emerald-950/10 bg-white/85 font-bold text-[#29473f] dark:border-fuchsia-300/20 dark:bg-[#160e1e]/85 dark:text-[#d6bfe3]';
const PRIMARY_BTN_CLASS =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-fuchsia-500 dark:hover:bg-fuchsia-600 dark:focus-visible:ring-fuchsia-300/30';

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' }),
}));
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

/**
 * Eksik/0 maxGun için varsayılan gün. Kurumlar maxGun'u 30/60 olarak tanımlar;
 * boş bırakılırsa ürün talepten düşmesin diye 30 güne düşülür.
 */
const DEFAULT_MAX_GUN = 30;

/**
 * Stok kodunu kanonik forma indirger (baştaki sıfırlar atılır). Ceomed'den gelen
 * kodlarla yerel min/max kodları arasında baştaki sıfır farkı olsa bile eşleşmeyi
 * garanti eder; kod tamamen sıfırsa orijinali korunur.
 */
const normCode = (value: unknown): string => {
  const code = String(value ?? '').trim();
  return code.replace(/^0+/, '') || code;
};

type RuleWithLocation = MinMaxRule & { locationId: string };

interface ComputedRow {
  stokKodu: string;
  stokAdi: string;
  anaDepoStok: number;
  /** Total Verimlilik kümülatif total (Sütun 15) — tüm hastanelerin dönemsel toplamı */
  testAdedi: number;
  /** Aylık toplam tüketim (kutu) = testAdedi / ambalaj değeri */
  aylikTuketimKutu: number;
  gunlukToplam: number; // günlük gereken adet (tüm kurumların toplamı)
  gerekliAdet: number;
  siparisAdedi: number;
}

const toDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
};

async function fetchMinMaxRules(
  parentCollection: 'depots' | 'hospitals',
  id: string,
): Promise<Record<string, MinMaxRule>> {
  const snap = await getDocs(collection(db, parentCollection, id, 'minMaxRules'));
  return snap.docs.reduce<Record<string, MinMaxRule>>((acc, d) => {
    const r = d.data() as MinMaxRule;
    const code = String(r?.stokKodu || d.id || '').trim();
    if (code) acc[code] = { ...r, stokKodu: code };
    return acc;
  }, {});
}

export default function TedarikciSiparisPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile, currentUser, currentCompanyId, isSuperAdmin } = useAuth();

  const { data: depots = [], isLoading: depotsLoading } = useDepots();

  const [brands, setBrands] = useState<BrandDefinition[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);

  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);
  const [yeterlilikGun, setYeterlilikGun] = useState<number | string>('');

  const [openOrders, setOpenOrders] = useState<SupplierOrder[]>([]);
  const [completedOrders, setCompletedOrders] = useState<SupplierOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  // Ağır veriler yalnızca bir marka seçildikten sonra indirilir.
  const hasBrand = !!selectedBrandId;

  // Ürün kataloğu — app genelindeki hook ile aynı cache anahtarını kullanır (paylaşımlı),
  // ancak yalnızca marka seçilince etkinleşir.
  const { data: productCodes = [], isLoading: productsLoading } = useQuery({
    queryKey: ['productCodes', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const { getProductCodesAction } = await import('@/actions/stokActions');
      return (await getProductCodesAction(currentCompanyId, isSuperAdmin ?? false)) as ProductCode[];
    },
    enabled: hasBrand && (!!currentCompanyId || isSuperAdmin === true),
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });

  // Ana depo stoğu (Ceomed ise ceomedDepoStok, değilse depoStok) — marka seçilince,
  // yalnızca ilgili depo için çekilir. Kanonik stok koduna göre indekslenir.
  const [anaDepoStockByCode, setAnaDepoStockByCode] = useState<Map<string, number>>(new Map());
  const [stockLoading, setStockLoading] = useState(false);

  // Seçili dönem için Total Verimlilik kümülatif total (Sütun 15) — stok koduna göre
  // tüm hastanelerin toplamı (kanonik koda göre indekslenir).
  const [kumulatifByCode, setKumulatifByCode] = useState<Map<string, number>>(new Map());
  const [kumulatifLoading, setKumulatifLoading] = useState(false);

  useEffect(() => {
    if (currentUserProfile?.role && currentUserProfile.role !== 'lojistik_sorumlusu') {
      router.replace('/dashboard');
    }
  }, [currentUserProfile?.role, router]);

  const anaDepo = useMemo(() => depots.find(d => d.isAnaDepo), [depots]);

  const relevantDepotIds = useMemo(
    () => (anaDepo ? [anaDepo.id, ...((anaDepo.linkedSideDepotIds || []).filter(id => id && id !== anaDepo.id))] : []),
    [anaDepo],
  );
  const relevantLabIds = useMemo(
    () => (anaDepo ? (anaDepo.linkedLaboratoryIds || []).filter(Boolean) : []),
    [anaDepo],
  );

  const productByStockCode = useMemo(() => {
    return productCodes.reduce<Record<string, ProductCode>>((acc, product) => {
      const code = (product.stokKodu ?? '').trim();
      if (code) acc[code] = product;
      return acc;
    }, {});
  }, [productCodes]);

  // Min/max rules for the main depot, its side depots and its linked labs.
  const depotRuleQueries = useQueries({
    queries: relevantDepotIds.map(id => ({
      queryKey: ['tedarikci', 'minMaxRules', 'depot', id],
      queryFn: () => fetchMinMaxRules('depots', id),
      staleTime: 30 * 60 * 1000,
      enabled: hasBrand,
    })),
  });
  const labRuleQueries = useQueries({
    queries: relevantLabIds.map(id => ({
      queryKey: ['tedarikci', 'minMaxRules', 'hospital', id],
      queryFn: () => fetchMinMaxRules('hospitals', id),
      staleTime: 30 * 60 * 1000,
      enabled: hasBrand,
    })),
  });

  const rulesLoading =
    depotRuleQueries.some(q => q.isLoading) || labRuleQueries.some(q => q.isLoading);

  // Fetch brand definitions.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setBrandsLoading(true);
      try {
        const docs = await getScopedDocs('def_brands', currentCompanyId, isSuperAdmin);
        if (cancelled) return;
        setBrands(
          docs
            .map(d => ({ id: d.id, ...(d.data() as Omit<BrandDefinition, 'id'>) }))
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr')),
        );
      } catch (e) {
        if (!cancelled) toast({ title: 'Hata', description: 'Markalar yüklenemedi.', variant: 'destructive' });
      } finally {
        if (!cancelled) setBrandsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [currentCompanyId, isSuperAdmin, toast]);

  const loadOrders = useMemo(
    () => async () => {
      setOrdersLoading(true);
      try {
        const snap = await getDocs(scopedQuery('supplierOrders', currentCompanyId, isSuperAdmin));
        const all = filterByCompanyScope(
          snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<SupplierOrder, 'id'>) })),
          currentCompanyId,
          isSuperAdmin,
        ).sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
        setOpenOrders(all.filter(o => o.status !== 'tamamlandi'));
        setCompletedOrders(all.filter(o => o.status === 'tamamlandi'));
      } catch (e) {
        console.error(e);
        toast({ title: 'Hata', description: 'Tedarikçi siparişleri yüklenemedi.', variant: 'destructive' });
      } finally {
        setOrdersLoading(false);
      }
    },
    [currentCompanyId, isSuperAdmin, toast],
  );

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const selectedBrand = useMemo(
    () => brands.find(b => b.id === selectedBrandId) || null,
    [brands, selectedBrandId],
  );

  // Ana depo stoğu marka seçilince, yalnızca ilgili depo için çekilir.
  // Ceomed entegre depoda anlık stok ceomedDepoStok'tan; diğer depolarda yerel
  // depoStok'tan (yalnızca o depo) alınır. Her ikisi de kanonik koda indekslenir.
  useEffect(() => {
    if (!hasBrand || !anaDepo) {
      setAnaDepoStockByCode(new Map());
      setStockLoading(false);
      return;
    }
    let cancelled = false;
    const depotId = anaDepo.id;
    const isCeomed = !!anaDepo.ceomedEnabled;
    const load = async () => {
      setStockLoading(true);
      try {
        const stok = await import('@/actions/stokActions');
        const record = isCeomed
          ? await stok.getCeomedDepoStockByCode(depotId, currentCompanyId, isSuperAdmin)
          : await stok.getDepotStockByCode(depotId, currentCompanyId, isSuperAdmin);
        const map = new Map<string, number>();
        for (const [rawCode, qty] of Object.entries(record)) {
          const code = normCode(rawCode);
          if (!code) continue;
          map.set(code, (map.get(code) || 0) + (Number(qty) || 0));
        }
        if (!cancelled) setAnaDepoStockByCode(map);
      } catch (e) {
        console.error('[tedarikci-siparis] Ana depo stoğu okunamadı:', e);
        if (!cancelled) {
          setAnaDepoStockByCode(new Map());
          toast({ title: 'Uyarı', description: 'Ana depo stoğu okunamadı.', variant: 'destructive' });
        }
      } finally {
        if (!cancelled) setStockLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [hasBrand, anaDepo?.id, anaDepo?.ceomedEnabled, currentCompanyId, isSuperAdmin, toast]);

  // Seçili döneme ait Total Verimlilik kümülatif total'i (Sütun 15) tüm hastaneler
  // için stok koduna göre topla. Yalnızca marka seçilince çekilir; dönem değişince
  // yeniden çekilir.
  useEffect(() => {
    if (!hasBrand) {
      setKumulatifByCode(new Map());
      setKumulatifLoading(false);
      return;
    }
    let cancelled = false;
    const monthIndex = selectedMonth - 1; // total verimlilik ayları 0-indeksli
    const load = async () => {
      setKumulatifLoading(true);
      try {
        const { getTotalEfficiencyKumulatifByStok } = await import('@/actions/stokActions');
        const record = await getTotalEfficiencyKumulatifByStok(
          selectedYear,
          monthIndex,
          currentCompanyId,
          isSuperAdmin,
        );
        const map = new Map<string, number>();
        for (const [rawCode, value] of Object.entries(record)) {
          const code = normCode(rawCode);
          if (!code) continue;
          map.set(code, (map.get(code) || 0) + (Number(value) || 0));
        }
        if (!cancelled) setKumulatifByCode(map);
      } catch (e) {
        console.error('[tedarikci-siparis] Kümülatif total okunamadı:', e);
        if (!cancelled) setKumulatifByCode(new Map());
      } finally {
        if (!cancelled) setKumulatifLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [hasBrand, selectedMonth, selectedYear, currentCompanyId, isSuperAdmin]);

  // Seçili markaya ait, min/max tanımlı benzersiz ürün listesi + hesap.
  const rows = useMemo<ComputedRow[]>(() => {
    if (!anaDepo || !selectedBrand) return [];

    const brandName = (selectedBrand.name || '').trim();
    const hedefGun = Number(yeterlilikGun);
    const gunGecerli = Number.isFinite(hedefGun) && hedefGun > 0;

    // Tüm kurumların (ana depo + yan depolar + bağlı lablar) kurallarını birleştir.
    const rulesByCode = new Map<string, RuleWithLocation[]>();
    const addRules = (map: Record<string, MinMaxRule> | undefined, locationId: string) => {
      if (!map) return;
      Object.values(map).forEach(rule => {
        const code = String(rule.stokKodu || '').trim();
        if (!code) return;
        const list = rulesByCode.get(code) || [];
        list.push({ ...rule, stokKodu: code, locationId });
        rulesByCode.set(code, list);
      });
    };
    relevantDepotIds.forEach((id, i) => addRules(depotRuleQueries[i]?.data, id));
    relevantLabIds.forEach((id, i) => addRules(labRuleQueries[i]?.data, id));

    const result: ComputedRow[] = [];
    rulesByCode.forEach((rulesForCode, code) => {
      const product = productByStockCode[code];
      // Marka filtresi: ürün kataloğundan markası eşleşenler.
      const marka = (product?.marka ?? '').trim();
      if (brandName && marka !== brandName) return;

      // Günlük saha ihtiyacı: SADECE bağlı yan depolar + bağlı lablar üzerinden.
      // Ana depo talebe dahil edilmez (yalnızca stok kaynağıdır). Her kurumun
      // günlük kutu ihtiyacı = maxGün / max; tümü toplanır.
      let gunlukToplam = 0;
      rulesForCode.forEach(rule => {
        if (rule.locationId === anaDepo.id) return; // ana depo talebe dahil değil
        const max = Number(rule.max ?? 0);
        if (max <= 0) return;
        const maxGun = Number(rule.maxGun ?? 0);
        const effectiveGun = maxGun > 0 ? maxGun : DEFAULT_MAX_GUN;
        gunlukToplam += effectiveGun / max;
      });
      if (gunlukToplam <= 0) return;

      const anaDepoStok = anaDepoStockByCode.get(normCode(code)) || 0;
      const gerekliAdet = gunGecerli ? Math.ceil(gunlukToplam * hedefGun) : 0;
      const siparisAdedi = Math.max(0, gerekliAdet - anaDepoStok);

      // Total Verimlilik kümülatif total (tüm hastaneler, seçili dönem).
      const testAdedi = kumulatifByCode.get(normCode(code)) || 0;
      const ambalaj = Number(product?.ambalajDegeri) || 0;
      const aylikTuketimKutu = ambalaj > 0 ? Math.ceil(testAdedi / ambalaj) : 0;

      result.push({
        stokKodu: code,
        stokAdi: product?.stokAdi || code,
        anaDepoStok,
        testAdedi,
        aylikTuketimKutu,
        gunlukToplam,
        gerekliAdet,
        siparisAdedi,
      });
    });

    return result.sort(
      (a, b) =>
        a.stokAdi.localeCompare(b.stokAdi, 'tr') || a.stokKodu.localeCompare(b.stokKodu, 'tr'),
    );
  }, [
    anaDepo,
    selectedBrand,
    yeterlilikGun,
    relevantDepotIds,
    relevantLabIds,
    depotRuleQueries,
    labRuleQueries,
    productByStockCode,
    anaDepoStockByCode,
    kumulatifByCode,
  ]);

  const orderableRows = useMemo(() => rows.filter(r => r.siparisAdedi > 0), [rows]);
  const totalSiparisAdedi = useMemo(
    () => orderableRows.reduce((sum, r) => sum + r.siparisAdedi, 0),
    [orderableRows],
  );

  const periodKey = `${String(selectedMonth).padStart(2, '0')}-${selectedYear}`;
  // Marka seçildikten sonra tabloyu besleyen ağır verilerin yüklenme durumu.
  const dataLoading = hasBrand && (productsLoading || rulesLoading || stockLoading);

  const handleCreateOrder = async () => {
    if (!anaDepo) {
      toast({ title: 'Ana depo yok', description: 'Depo Yönetimi\'nden bir depoyu "Ana Depo" olarak seçin.', variant: 'destructive' });
      return;
    }
    if (!selectedBrand) {
      toast({ title: 'Marka seçin', description: 'Sipariş oluşturmak için bir marka seçin.', variant: 'destructive' });
      return;
    }
    const hedefGun = Number(yeterlilikGun);
    if (!hedefGun || hedefGun <= 0) {
      toast({ title: 'Yeterlilik günü', description: 'Geçerli bir yeterlilik gün sayısı girin.', variant: 'destructive' });
      return;
    }
    if (orderableRows.length === 0) {
      toast({ title: 'Sipariş edilecek ürün yok', description: 'Hesaba göre sipariş adedi 0. Mevcut stok yeterli.' });
      return;
    }

    setIsSaving(true);
    const id = generateId();
    const items: SupplierOrderItem[] = orderableRows.map(r => ({
      stokKodu: r.stokKodu,
      stokAdi: r.stokAdi,
      anaDepoStok: r.anaDepoStok,
      gerekliAdet: r.gerekliAdet,
      siparisAdedi: r.siparisAdedi,
    }));

    const payload = {
      status: 'bekliyor' as const,
      markaId: selectedBrand.id,
      markaAdi: selectedBrand.name,
      markaMail: (selectedBrand.mail || '').trim(),
      donem: periodKey,
      yeterlilikGun: hedefGun,
      anaDepoId: anaDepo.id,
      anaDepoAdi: anaDepo.name,
      items,
      toplamKalem: items.length,
      toplamAdet: totalSiparisAdedi,
      mailStatus: 'pending' as const,
      createdBy: currentUserProfile?.name || currentUser?.email || 'Bilinmiyor',
      createdById: currentUserProfile?.uid || currentUser?.uid || '',
      createdAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, 'supplierOrders', id), withCompanyScope(payload, currentUserProfile?.companyId));
      toast({
        title: 'Sipariş oluşturuldu',
        description: selectedBrand.mail
          ? `${selectedBrand.name} için sipariş kaydedildi, otomatik mail gönderiliyor.`
          : `${selectedBrand.name} için sipariş kaydedildi. Markanın mail adresi tanımlı değil.`,
      });
      await loadOrders();
    } catch (e) {
      console.error(e);
      toast({ title: 'Hata', description: 'Sipariş kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async (order: SupplierOrder) => {
    setCompletingId(order.id);
    // Optimistic
    setOpenOrders(prev => prev.filter(o => o.id !== order.id));
    setCompletedOrders(prev => [{ ...order, status: 'tamamlandi' }, ...prev]);
    try {
      await updateDoc(doc(db, 'supplierOrders', order.id), {
        status: 'tamamlandi',
        completedAt: serverTimestamp(),
        completedBy: currentUserProfile?.name || currentUser?.email || 'Bilinmiyor',
      });
      toast({ title: 'Tamamlandı', description: 'Sipariş tamamlandı olarak işaretlendi.' });
    } catch (e) {
      console.error(e);
      // Rollback
      setCompletedOrders(prev => prev.filter(o => o.id !== order.id));
      setOpenOrders(prev => [order, ...prev]);
      toast({ title: 'Hata', description: 'Sipariş güncellenemedi.', variant: 'destructive' });
    } finally {
      setCompletingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1700px] px-1 py-2 sm:px-2 sm:py-4">
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-bold text-[#587169] transition-colors hover:bg-white/60 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 dark:text-[#a994b5] dark:hover:bg-white/5 dark:hover:text-fuchsia-200 dark:focus-visible:ring-fuchsia-300/30"
            onClick={() => router.push(LOJISTIK_HOME_PATH)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Lojistik ana sayfa
          </button>
          <div className="mt-2 flex items-center gap-2 text-emerald-600 dark:text-fuchsia-300">
            <Building2 className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-extrabold uppercase tracking-[0.18em]">Lojistik çalışma alanı</span>
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.035em] text-[#0f2a24] dark:text-[#f4ecfa] sm:text-4xl">
            Tedarikçi Sipariş
          </h1>
          <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-[#587169] dark:text-[#a994b5] sm:text-base">
            Marka ve dönem seçin; min/max tanımlarından sipariş adetlerini hesaplayın ve markaya otomatik sipariş maili gönderin.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreateOrder}
          disabled={isSaving || !anaDepo || !selectedBrand || orderableRows.length === 0}
          className={`${PRIMARY_BTN_CLASS} self-start py-2 xl:self-auto`}
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Siparişi Oluştur
          {orderableRows.length > 0 && (
            <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-white/25 px-1.5 text-xs font-extrabold">
              {orderableRows.length}
            </span>
          )}
        </button>
      </header>

      {!depotsLoading && !anaDepo && (
        <div className="mb-5 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
          <Star className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">Ana depo seçilmemiş.</p>
            <p className="font-medium">Tedarikçi sipariş hesabı için Yönetim → Tanımlar → Depo Yönetimi üzerinden bir depoyu <b>Ana Depo</b> olarak işaretleyin.</p>
          </div>
        </div>
      )}

      {/* Seçim alanı */}
      <section className={`${PANEL_CLASS} mb-5 p-5`}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className={FIELD_LABEL_CLASS}>Marka</label>
            <Select value={selectedBrandId} onValueChange={setSelectedBrandId} disabled={brandsLoading}>
              <SelectTrigger className={CONTROL_CLASS}>
                <SelectValue placeholder={brandsLoading ? 'Yükleniyor...' : 'Marka seçin'} />
              </SelectTrigger>
              <SelectContent>
                {brands.map(b => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                    {!b.mail && '  ·  mail yok'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBrand && (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-[#587169] dark:text-[#a994b5]">
                {selectedBrand.mail ? (
                  <><Mail className="h-3 w-3" /> {selectedBrand.mail}</>
                ) : (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <MailWarning className="h-3 w-3" /> Mail adresi tanımlı değil
                  </span>
                )}
              </p>
            )}
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Dönem (Ay)</label>
            <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
              <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Dönem (Yıl)</label>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Ana Depo</label>
            <div className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-950/10 bg-white/60 px-3 text-sm font-bold text-[#29473f] dark:border-fuchsia-300/20 dark:bg-white/[0.035] dark:text-[#d6bfe3]">
              {anaDepo ? (
                <>
                  <span className="flex min-w-0 items-center gap-1 truncate"><Star className="h-3.5 w-3.5 shrink-0 text-amber-500" /><span className="truncate">{anaDepo.name}</span></span>
                  {anaDepo.ceomedEnabled && (
                    <span className="shrink-0 rounded-full border border-sky-200 bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/15 dark:text-sky-200">Ceomed</span>
                  )}
                </>
              ) : (
                <span className="font-semibold text-[#587169] dark:text-[#a994b5]">Seçilmedi</span>
              )}
            </div>
          </div>
        </div>
        {anaDepo && (
          <p className="mt-3 text-xs font-semibold text-[#587169] dark:text-[#a994b5]">
            Talep kapsamı: <b className="text-[#29473f] dark:text-[#d6bfe3]">{anaDepo.name}</b>
            {relevantDepotIds.length > 1 && ` + ${relevantDepotIds.length - 1} yan depo`}
            {relevantLabIds.length > 0 && ` + ${relevantLabIds.length} bağlı laboratuvar`}
          </p>
        )}
      </section>

      {/* Hesap tablosu */}
      <section className={`${PANEL_CLASS} mb-5 overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-emerald-950/10 px-5 py-4 dark:border-fuchsia-300/15 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-[#0f2a24] dark:text-[#f4ecfa]">
            <PackageSearch className="h-5 w-5 text-emerald-600 dark:text-fuchsia-300" />
            Hesaplanan Sipariş Listesi
            {selectedBrand && <span className="font-semibold text-[#587169] dark:text-[#a994b5]">— {selectedBrand.name}</span>}
          </h2>
          <div className="flex items-center gap-2">
            <label htmlFor="yeterlilik" className="whitespace-nowrap text-xs font-extrabold uppercase tracking-[0.08em] text-[#587169] dark:text-[#a994b5]">Yeterlilik Gün Sayısı</label>
            <Input
              id="yeterlilik"
              type="number"
              min={1}
              className={`w-28 ${CONTROL_CLASS}`}
              value={yeterlilikGun}
              onChange={(e) => setYeterlilikGun(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              placeholder="Örn. 60"
            />
          </div>
        </div>

        {depotsLoading ? (
          <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm font-semibold text-[#587169] dark:text-[#a994b5]">
            <Loader2 className="h-5 w-5 animate-spin" /> Depolar yükleniyor…
          </div>
        ) : !anaDepo ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
            <Star className="h-9 w-9 text-emerald-500/65 dark:text-fuchsia-300/65" />
            <p className="mt-4 font-bold text-[#29473f] dark:text-[#d6bfe3]">Önce bir ana depo tanımlayın.</p>
          </div>
        ) : !selectedBrand ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
            <PackageSearch className="h-9 w-9 text-emerald-500/65 dark:text-fuchsia-300/65" />
            <p className="mt-4 font-bold text-[#29473f] dark:text-[#d6bfe3]">Listeyi görmek için bir marka seçin.</p>
          </div>
        ) : dataLoading ? (
          <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm font-semibold text-[#587169] dark:text-[#a994b5]">
            <Loader2 className="h-5 w-5 animate-spin" /> Veriler hazırlanıyor…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
            <PackageSearch className="h-9 w-9 text-emerald-500/65 dark:text-fuchsia-300/65" />
            <p className="mt-4 font-bold text-[#29473f] dark:text-[#d6bfe3]">Ürün bulunamadı</p>
            <p className="mt-2 max-w-lg text-sm text-[#587169] dark:text-[#a994b5]">Seçili markaya ait, ana depo/lab/yan depolarda min-max tanımlı ürün bulunamadı.</p>
          </div>
        ) : (
          <>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left">
                <thead className="sticky top-0 z-10 bg-[#f7fcf9]/95 text-xs font-extrabold uppercase tracking-[0.07em] text-[#587169] backdrop-blur dark:bg-[#160e1e]/95 dark:text-[#a994b5]">
                  <tr>
                    <th className="px-5 py-4">Stok Kodu</th>
                    <th className="px-4 py-4">Stok Adı</th>
                    <th className="px-4 py-4 text-right">Ana Depo Stok</th>
                    <th className="px-4 py-4 text-right">
                      Test Adedi
                      <span className="block text-[10px] font-bold normal-case tracking-normal text-[#70857e] dark:text-[#8e7c9a]">Küm. Total</span>
                    </th>
                    <th className="px-4 py-4 text-right">
                      Aylık Toplam Tüketim
                      <span className="block text-[10px] font-bold normal-case tracking-normal text-[#70857e] dark:text-[#8e7c9a]">(Kutu)</span>
                    </th>
                    <th className="px-4 py-4 text-right">
                      Gerekli Adet
                      {Number(yeterlilikGun) > 0 && (
                        <span className="block text-[10px] font-bold normal-case tracking-normal text-[#70857e] dark:text-[#8e7c9a]">{yeterlilikGun} günlük</span>
                      )}
                    </th>
                    <th className="px-5 py-4 text-right">Sipariş Adedi</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr
                      key={row.stokKodu}
                      className={`text-sm transition-colors hover:bg-emerald-50/70 dark:hover:bg-fuchsia-300/[0.055] ${row.siparisAdedi > 0 ? '' : 'opacity-60'}`}
                    >
                      <td className="border-t border-emerald-950/10 px-5 py-3.5 font-mono text-xs font-semibold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">{row.stokKodu}</td>
                      <td className="border-t border-emerald-950/10 px-4 py-3.5 font-semibold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">{row.stokAdi}</td>
                      <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">{row.anaDepoStok}</td>
                      <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">
                        {kumulatifLoading ? <span className="text-[#70857e] dark:text-[#8e7c9a]">…</span> : row.testAdedi > 0 ? row.testAdedi : <span className="text-[#70857e] dark:text-[#8e7c9a]">0</span>}
                      </td>
                      <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">
                        {kumulatifLoading ? <span className="text-[#70857e] dark:text-[#8e7c9a]">…</span> : row.aylikTuketimKutu > 0 ? row.aylikTuketimKutu : <span className="text-[#70857e] dark:text-[#8e7c9a]">0</span>}
                      </td>
                      <td className="border-t border-emerald-950/10 px-4 py-3.5 text-right tabular-nums font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">
                        {Number(yeterlilikGun) > 0 ? row.gerekliAdet : <span className="text-[#70857e] dark:text-[#8e7c9a]">—</span>}
                      </td>
                      <td className="border-t border-emerald-950/10 px-5 py-3.5 text-right tabular-nums text-base font-black dark:border-fuchsia-300/15">
                        {row.siparisAdedi > 0 ? (
                          <span className="text-emerald-600 dark:text-fuchsia-300">{row.siparisAdedi}</span>
                        ) : (
                          <span className="text-[#70857e] dark:text-[#8e7c9a]">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-950/10 px-5 py-3 text-sm dark:border-fuchsia-300/15">
              <span className="font-semibold text-[#587169] dark:text-[#a994b5]">
                {rows.length} ürün · sipariş edilecek {orderableRows.length} kalem
              </span>
              <span className="font-extrabold text-[#0f2a24] dark:text-[#f4ecfa]">Toplam Sipariş Adedi: {totalSiparisAdedi}</span>
            </div>
          </>
        )}
      </section>

      {/* Açık tedarikçi siparişler */}
      <section className={`${PANEL_CLASS} mb-5 overflow-hidden`}>
        <div className="border-b border-emerald-950/10 px-5 py-4 dark:border-fuchsia-300/15">
          <h2 className="text-lg font-extrabold text-[#0f2a24] dark:text-[#f4ecfa]">Açık Tedarikçi Siparişler</h2>
          <p className="mt-1 text-sm font-medium text-[#587169] dark:text-[#a994b5]">Bekleyen siparişler. Teslim alındığında &quot;Tamamlandı&quot; ile kapatın.</p>
        </div>
        {ordersLoading ? (
          <div className="flex min-h-[140px] items-center justify-center gap-2 text-sm font-semibold text-[#587169] dark:text-[#a994b5]">
            <Loader2 className="h-5 w-5 animate-spin" /> Siparişler yükleniyor…
          </div>
        ) : openOrders.length === 0 ? (
          <div className="flex min-h-[140px] flex-col items-center justify-center p-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500/65 dark:text-fuchsia-300/65" />
            <p className="mt-3 font-bold text-[#29473f] dark:text-[#d6bfe3]">Bekleyen sipariş yok.</p>
          </div>
        ) : (
          <div className="divide-y divide-emerald-950/10 dark:divide-fuchsia-300/15">
            {openOrders.map(order => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-extrabold text-[#29473f] dark:text-[#d6bfe3]">{order.markaAdi}</span>
                    <span className="rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/15 dark:text-amber-200">Bekliyor</span>
                    <span className="text-xs font-semibold text-[#70857e] dark:text-[#8e7c9a]">{order.donem}</span>
                    {order.mailStatus === 'sent' && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"><Mail className="h-3 w-3" />mail gönderildi</span>
                    )}
                    {order.mailStatus === 'failed' && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400"><MailWarning className="h-3 w-3" />mail gönderilemedi</span>
                    )}
                    {order.mailStatus === 'skipped' && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400"><MailWarning className="h-3 w-3" />mail adresi yok</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs font-semibold text-[#70857e] dark:text-[#8e7c9a]">
                    {order.toplamKalem} kalem · {order.toplamAdet} adet · {order.anaDepoAdi}
                    {toDate(order.createdAt) && ` · ${toDate(order.createdAt)!.toLocaleString('tr-TR')}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleComplete(order)}
                  disabled={completingId === order.id}
                  className={`${PRIMARY_BTN_CLASS} px-4`}
                >
                  {completingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Tamamlandı
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tamamlanan siparişler */}
      {completedOrders.length > 0 && (
        <section className={`${PANEL_CLASS} overflow-hidden`}>
          <div className="border-b border-emerald-950/10 px-5 py-4 dark:border-fuchsia-300/15">
            <h2 className="text-lg font-extrabold text-[#0f2a24] dark:text-[#f4ecfa]">Tamamlanan Siparişler</h2>
          </div>
          <div className="divide-y divide-emerald-950/10 dark:divide-fuchsia-300/15">
            {completedOrders.slice(0, 30).map(order => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-[#29473f] dark:text-[#d6bfe3]">{order.markaAdi}</span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/15 dark:text-emerald-200">Tamamlandı</span>
                  <span className="text-xs font-semibold text-[#70857e] dark:text-[#8e7c9a]">{order.donem}</span>
                </div>
                <span className="text-xs font-semibold text-[#70857e] dark:text-[#8e7c9a]">
                  {order.toplamKalem} kalem · {order.toplamAdet} adet
                  {toDate(order.completedAt) && ` · ${toDate(order.completedAt)!.toLocaleDateString('tr-TR')}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
