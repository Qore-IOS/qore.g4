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
import { useQueries } from '@tanstack/react-query';
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
import {
  useDepots,
  useProductCodes,
  useDepoStok,
} from '@/hooks/useFirebaseQueries';
import type {
  BrandDefinition,
  MinMaxRule,
  ProductCode,
  SupplierOrder,
  SupplierOrderItem,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LOJISTIK_HOME_PATH } from '@/lib/lojistik/navigation';

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
  const { data: productCodes = [], isLoading: productsLoading } = useProductCodes();
  const { data: depoStok = [], isLoading: stokLoading } = useDepoStok();

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

  // Ceomed entegre ana depoların anlık stoğu ceomedDepoStok/{depotId} dokümanından
  // gelir (yerel depoStok kayıtları yoktur). null = Ceomed dışı depo.
  const [ceomedStockByCode, setCeomedStockByCode] = useState<Map<string, number> | null>(null);
  const [ceomedStockLoading, setCeomedStockLoading] = useState(false);

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
    })),
  });
  const labRuleQueries = useQueries({
    queries: relevantLabIds.map(id => ({
      queryKey: ['tedarikci', 'minMaxRules', 'hospital', id],
      queryFn: () => fetchMinMaxRules('hospitals', id),
      staleTime: 30 * 60 * 1000,
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

  // Ceomed entegre ana depoda anlık stok harici sunucudan senkronlanır ve
  // ceomedDepoStok/{depotId} dokümanında items[] olarak tutulur (her satırda adet).
  // Ceomed dışı depolarda stok yerel depoStok dokümanlarından sayılır.
  useEffect(() => {
    if (!anaDepo?.ceomedEnabled) {
      setCeomedStockByCode(null);
      setCeomedStockLoading(false);
      return;
    }
    let cancelled = false;
    const depotId = anaDepo.id;
    const load = async () => {
      setCeomedStockLoading(true);
      try {
        // Admin SDK üzerinden okunur (ceomedDepoStok client kurallarında kapalı).
        const { getCeomedDepoStockByCode } = await import('@/actions/stokActions');
        const record = await getCeomedDepoStockByCode(depotId, currentCompanyId, isSuperAdmin);
        const map = new Map<string, number>();
        for (const [rawCode, qty] of Object.entries(record)) {
          const code = normCode(rawCode);
          if (!code) continue;
          map.set(code, (map.get(code) || 0) + (Number(qty) || 0));
        }
        if (!cancelled) setCeomedStockByCode(map);
      } catch (e) {
        console.error('[tedarikci-siparis] Ceomed depo stoğu okunamadı:', e);
        if (!cancelled) {
          setCeomedStockByCode(new Map());
          toast({ title: 'Uyarı', description: 'Ceomed ana depo stoğu okunamadı.', variant: 'destructive' });
        }
      } finally {
        if (!cancelled) setCeomedStockLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [anaDepo?.id, anaDepo?.ceomedEnabled, currentCompanyId, isSuperAdmin, toast]);

  // Seçili döneme ait Total Verimlilik kümülatif total'i (Sütun 15) tüm hastaneler
  // için stok koduna göre topla. Admin SDK aksiyonuyla okunur (totalEfficiencyRecords
  // havuz + dönem başına saklanır). Dönem değişince yeniden çekilir.
  useEffect(() => {
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
  }, [selectedMonth, selectedYear, currentCompanyId, isSuperAdmin]);

  // Ana depo stok haritası (kanonik stok koduna göre indekslenir).
  const anaDepoStockByCode = useMemo(() => {
    if (!anaDepo) return new Map<string, number>();
    // Ceomed entegre depo: harici senkron stoğu kullan.
    if (anaDepo.ceomedEnabled) {
      return ceomedStockByCode ?? new Map<string, number>();
    }
    // Standart depo: sevk edilmemiş, ana depoya ait her doc = 1 adet.
    const map = new Map<string, number>();
    for (const st of depoStok) {
      if (st.isShipped) continue;
      if (st.depotId !== anaDepo.id) continue;
      const code = normCode(st.stokKodu);
      if (!code) continue;
      map.set(code, (map.get(code) || 0) + 1);
    }
    return map;
  }, [depoStok, anaDepo, ceomedStockByCode]);

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

      // Günlük gereken adet: her kurumdaki max'ı 1 güne indirip topla.
      let gunlukToplam = 0;
      rulesForCode.forEach(rule => {
        const max = Number(rule.max ?? 0);
        if (max <= 0) return;
        const maxGun = Number(rule.maxGun ?? 0);
        const effectiveGun = maxGun > 0 ? maxGun : DEFAULT_MAX_GUN;
        gunlukToplam += max / effectiveGun;
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
  const isLoading = depotsLoading || productsLoading || stokLoading;

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
    <div className="mx-auto w-full max-w-[1700px] px-2 py-4 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push(LOJISTIK_HOME_PATH)} className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Geri Dön
          </Button>
          <div>
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
              <Building2 className="h-6 w-6 text-amber-500" />
              Tedarikçi Sipariş
            </h1>
            <p className="text-sm text-muted-foreground">
              Marka ve dönem seçin; min/max tanımlarından sipariş adetlerini hesaplayın ve markaya otomatik sipariş maili gönderin.
            </p>
          </div>
        </div>
        <Button
          onClick={handleCreateOrder}
          disabled={isSaving || !anaDepo || !selectedBrand || orderableRows.length === 0}
          className="gap-2"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Siparişi Oluştur
          {orderableRows.length > 0 && (
            <Badge variant="secondary" className="ml-1">{orderableRows.length}</Badge>
          )}
        </Button>
      </div>

      {!isLoading && !anaDepo && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <Star className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Ana depo seçilmemiş.</p>
            <p>Tedarikçi sipariş hesabı için Yönetim → Tanımlar → Depo Yönetimi üzerinden bir depoyu <b>Ana Depo</b> olarak işaretleyin.</p>
          </div>
        </div>
      )}

      {/* Seçim alanı */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-sm">Marka</Label>
            <Select value={selectedBrandId} onValueChange={setSelectedBrandId} disabled={brandsLoading}>
              <SelectTrigger className="mt-1">
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
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
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
            <Label className="text-sm">Dönem (Ay)</Label>
            <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Dönem (Yıl)</Label>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Ana Depo</Label>
            <div className="mt-1 h-10 flex items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
              {anaDepo ? (
                <>
                  <span className="flex items-center gap-1 font-medium min-w-0 truncate"><Star className="h-3.5 w-3.5 shrink-0 text-amber-500" /><span className="truncate">{anaDepo.name}</span></span>
                  {anaDepo.ceomedEnabled && (
                    <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-400/15 dark:text-sky-200">Ceomed</span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">Seçilmedi</span>
              )}
            </div>
          </div>
        </div>
        {anaDepo && (
          <p className="mt-3 text-xs text-muted-foreground">
            Talep kapsamı: <b>{anaDepo.name}</b>
            {relevantDepotIds.length > 1 && ` + ${relevantDepotIds.length - 1} yan depo`}
            {relevantLabIds.length > 0 && ` + ${relevantLabIds.length} bağlı laboratuvar`}
          </p>
        )}
      </div>

      {/* Hesap tablosu */}
      <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b p-4 flex-wrap">
          <h2 className="text-base font-bold flex items-center gap-2">
            <PackageSearch className="h-4 w-4 text-primary" />
            Hesaplanan Sipariş Listesi
            {selectedBrand && <span className="text-muted-foreground font-normal">— {selectedBrand.name}</span>}
          </h2>
          <div className="flex items-center gap-2">
            <Label htmlFor="yeterlilik" className="text-sm whitespace-nowrap">Yeterlilik Gün Sayısı</Label>
            <Input
              id="yeterlilik"
              type="number"
              min={1}
              className="w-28"
              value={yeterlilikGun}
              onChange={(e) => setYeterlilikGun(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              placeholder="Örn. 60"
            />
          </div>
        </div>

        {isLoading || (selectedBrand && rulesLoading) || (anaDepo?.ceomedEnabled && ceomedStockLoading) ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Veriler hazırlanıyor…
          </div>
        ) : !anaDepo ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Önce bir ana depo tanımlayın.</div>
        ) : !selectedBrand ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Listeyi görmek için bir marka seçin.</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Seçili markaya ait, ana depo/lab/yan depolarda min-max tanımlı ürün bulunamadı.
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-[520px]">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-[140px]">Stok Kodu</TableHead>
                    <TableHead>Stok Adı</TableHead>
                    <TableHead className="text-right w-[130px]">Ana Depo Stok</TableHead>
                    <TableHead className="text-right w-[120px]">
                      Test Adedi
                      <span className="block text-[10px] font-normal text-muted-foreground">Küm. Total</span>
                    </TableHead>
                    <TableHead className="text-right w-[140px]">
                      Aylık Toplam Tüketim
                      <span className="block text-[10px] font-normal text-muted-foreground">(Kutu)</span>
                    </TableHead>
                    <TableHead className="text-right w-[150px]">
                      Gerekli Adet
                      {Number(yeterlilikGun) > 0 && (
                        <span className="block text-[10px] font-normal text-muted-foreground">{yeterlilikGun} günlük</span>
                      )}
                    </TableHead>
                    <TableHead className="text-right w-[130px]">Sipariş Adedi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow key={row.stokKodu} className={row.siparisAdedi > 0 ? '' : 'opacity-60'}>
                      <TableCell className="font-mono text-xs">{row.stokKodu}</TableCell>
                      <TableCell className="text-sm">{row.stokAdi}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.anaDepoStok}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {kumulatifLoading ? (
                          <span className="text-muted-foreground">…</span>
                        ) : row.testAdedi > 0 ? (
                          row.testAdedi
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {kumulatifLoading ? (
                          <span className="text-muted-foreground">…</span>
                        ) : row.aylikTuketimKutu > 0 ? (
                          row.aylikTuketimKutu
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(yeterlilikGun) > 0 ? row.gerekliAdet : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-bold">
                        {row.siparisAdedi > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400">{row.siparisAdedi}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
            <div className="flex items-center justify-between gap-3 border-t p-3 text-sm flex-wrap">
              <span className="text-muted-foreground">
                {rows.length} ürün · sipariş edilecek {orderableRows.length} kalem
              </span>
              <span className="font-bold">Toplam Sipariş Adedi: {totalSiparisAdedi}</span>
            </div>
          </>
        )}
      </div>

      {/* Açık tedarikçi siparişler */}
      <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
        <div className="border-b p-4">
          <h2 className="text-base font-bold">Açık Tedarikçi Siparişler</h2>
          <p className="text-xs text-muted-foreground">Bekleyen siparişler. Teslim alındığında &quot;Tamamlandı&quot; ile kapatın.</p>
        </div>
        {ordersLoading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Siparişler yükleniyor…
          </div>
        ) : openOrders.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Bekleyen sipariş yok.</div>
        ) : (
          <div className="divide-y">
            {openOrders.map(order => (
              <div key={order.id} className="flex items-center justify-between gap-3 p-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{order.markaAdi}</span>
                    <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">Bekliyor</Badge>
                    <span className="text-xs text-muted-foreground">{order.donem}</span>
                    {order.mailStatus === 'sent' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"><Mail className="h-3 w-3" />mail gönderildi</span>
                    )}
                    {order.mailStatus === 'failed' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-rose-600"><MailWarning className="h-3 w-3" />mail gönderilemedi</span>
                    )}
                    {order.mailStatus === 'skipped' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-600"><MailWarning className="h-3 w-3" />mail adresi yok</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {order.toplamKalem} kalem · {order.toplamAdet} adet · {order.anaDepoAdi}
                    {toDate(order.createdAt) && ` · ${toDate(order.createdAt)!.toLocaleString('tr-TR')}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleComplete(order)}
                  disabled={completingId === order.id}
                  className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {completingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Tamamlandı
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tamamlanan siparişler */}
      {completedOrders.length > 0 && (
        <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
          <div className="border-b p-4">
            <h2 className="text-base font-bold">Tamamlanan Siparişler</h2>
          </div>
          <div className="divide-y">
            {completedOrders.slice(0, 30).map(order => (
              <div key={order.id} className="flex items-center justify-between gap-3 p-3 flex-wrap text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{order.markaAdi}</span>
                  <Badge variant="outline" className="border-emerald-400 text-emerald-700 dark:text-emerald-300">Tamamlandı</Badge>
                  <span className="text-xs text-muted-foreground">{order.donem}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {order.toplamKalem} kalem · {order.toplamAdet} adet
                  {toDate(order.completedAt) && ` · ${toDate(order.completedAt)!.toLocaleDateString('tr-TR')}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
