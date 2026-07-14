'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import type { Depot, Hospital, ProductCode, MinMaxRule, DepoStokItem, DeviceGroup } from '@/lib/types';
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { subDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LabSelector } from '@/components/common/LabSelector';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { exportDataToExcel, generateId } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { 
  useDepots, 
  useHospitals, 
  useProductCodes, 
  useDeviceGroups, 
  useDepoStok, 
  useMinMaxRulesForDepot, 
  useMinMaxRulesForHospital 
} from '@/hooks/useFirebaseQueries';
import { filterByCompanyScope } from '@/lib/company-scope';
import { useQueries } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

type LocationType = 'depot' | 'hospital';

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' }),
}));
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

const normalizeStockCode = (value: unknown) => String(value ?? '').trim();
const stockCodeVariants = (value: unknown) => {
  const code = normalizeStockCode(value);
  if (!code) return [];
  const trimmedZero = code.replace(/^0+/, '');
  return Array.from(new Set([code, trimmedZero].filter(Boolean)));
};
const normalizePeriodKey = (value: unknown) => {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{1,2})-(\d{4})$/);
  if (!m) return raw;
  return `${m[1].padStart(2, '0')}-${m[2]}`;
};

interface GeneratedOrderItem {
  key: string;
  locationType: LocationType;
  locationId: string;
  locationName: string;
  stokKodu: string;
  stokAdi: string;
  marka?: string;
  urunGrubu?: string;
  cihazGrubu?: string;
  mevcutAdet: number;
  laboratuvarAdet: number;
  toplamAdet: number;
  cihazUstuAdet: number;
  cihazUstuKutu: number;
  genelToplam: number;
  hedefAdet: number;
  siparisAdedi: number;
  min: number;
  max: number;
  maxGun?: number;
  costPerUnit: number;
}

interface CentralOrderItem {
  stokKodu: string;
  stokAdi: string;
  orderedQty: number;
  receivedQty: number;
  locationType: LocationType;
  locationId: string;
  locationName: string;
  marka?: string;
  urunGrubu?: string;
  cihazGrubu?: string;
  status?: 'ok' | 'eksik' | 'fazla';
  discrepancyResolved?: boolean;
}

interface CentralOrder {
  id: string;
  status: 'open' | 'completed';
  createdAt?: Date;
  createdBy?: string;
  createdById?: string;
  selectedDepotIds: string[];
  selectedLabIds: string[];
  selectedBrands: string[];
  selectedProductGroups: string[];
  selectedDeviceGroups: string[];
  yeterlilikGun: number;
  items: CentralOrderItem[];
  discrepancySummary?: { eksik: number; fazla: number };
}

function MerkezSiparisSkeleton() {
  return (
    <div className="space-y-6 p-6 animate-pulse">
      <div className="flex gap-4 mb-4">
        <div className="h-10 w-32 bg-muted rounded" />
        <div className="h-10 w-32 bg-muted rounded" />
        <div className="h-10 w-32 bg-muted rounded" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-4 h-[600px] bg-muted rounded-xl" />
        <div className="xl:col-span-8 space-y-6">
          <div className="h-48 bg-muted rounded-xl" />
          <div className="h-[400px] bg-muted rounded-xl" />
        </div>
      </div>
    </div>
  );
}

const toDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
};

export default function MerkezSiparisPanel() {
  const { toast } = useToast();
  const router = useRouter();
  const { currentUserProfile, currentUser, currentCompanyId, isSuperAdmin } = useAuth();

  // Optimized Fetching
  const { data: depots = [], isLoading: depotsLoading } = useDepots();
  const { data: hospitals = [], isLoading: hospitalsLoading } = useHospitals();
  const { data: productCodes = [], isLoading: productsLoading } = useProductCodes();
  const { data: depoStok = [], isLoading: stokLoading } = useDepoStok();
  const { data: deviceGroups = [], isLoading: groupsLoading } = useDeviceGroups();

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Parallel fetching of min-max rules
  const depotRulesQueries = useQueries({
    queries: depots.map(d => ({
      queryKey: ['minMaxRules', 'depot', d.id],
      queryFn: async () => {
        const snap = await getDocs(collection(db, 'depots', d.id, 'minMaxRules'));
        return snap.docs.reduce<Record<string, MinMaxRule>>((acc, doc) => {
          const r = doc.data() as MinMaxRule;
          if (r?.stokKodu) acc[r.stokKodu] = r;
          return acc;
        }, {});
      },
      staleTime: 30 * 60 * 1000,
    }))
  });

  const hospitalRulesQueries = useQueries({
    queries: hospitals.map(h => ({
      queryKey: ['minMaxRules', 'hospital', h.id],
      queryFn: async () => {
        const snap = await getDocs(collection(db, 'hospitals', h.id, 'minMaxRules'));
        return snap.docs.reduce<Record<string, MinMaxRule>>((acc, doc) => {
          const r = doc.data() as MinMaxRule;
          if (r?.stokKodu) acc[r.stokKodu] = r;
          return acc;
        }, {});
      },
      staleTime: 30 * 60 * 1000,
    }))
  });

  const depotRulesMap = useMemo(() => {
    const map: Record<string, Record<string, MinMaxRule>> = {};
    depots.forEach((d, i) => {
      if (depotRulesQueries[i].data) map[d.id] = depotRulesQueries[i].data!;
    });
    return map;
  }, [depots, depotRulesQueries]);

  const hospitalRulesMap = useMemo(() => {
    const map: Record<string, Record<string, MinMaxRule>> = {};
    hospitals.forEach((h, i) => {
      if (hospitalRulesQueries[i].data) map[h.id] = hospitalRulesQueries[i].data!;
    });
    return map;
  }, [hospitals, hospitalRulesQueries]);

  const [selectedDepotIds, setSelectedDepotIds] = useState<string[]>([]);
  const [selectedLabIds, setSelectedLabIds] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedProductGroups, setSelectedProductGroups] = useState<string[]>([]);
  const [selectedDeviceGroups, setSelectedDeviceGroups] = useState<string[]>([]);
  const [yeterlilikGun, setYeterlilikGun] = useState<number | string>('');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);

  const [depotSearch, setDepotSearch] = useState('');
  const [showSelectionPanel, setShowSelectionPanel] = useState(true);
  const [generatedItems, setGeneratedItems] = useState<GeneratedOrderItem[]>([]);
  const [tableFilters, setTableFilters] = useState<Record<string, string>>({});

  const [openOrders, setOpenOrders] = useState<CentralOrder[]>([]);
  const [completedOrders, setCompletedOrders] = useState<CentralOrder[]>([]);
  const [cihazUstuMap, setCihazUstuMap] = useState<Record<string, Record<string, number>>>({});

  const isLoading = depotsLoading || hospitalsLoading || productsLoading || stokLoading || groupsLoading;

  useEffect(() => {
    const fetchAdditional = async () => {
      try {
        // Açık siparişler genelde az (<200), tamamlananlar zamanla birikir.
        // Açıkları tam çek, tamamlananları son 90 gün + limit(500) ile sınırla.
        const completedSinceTs = Timestamp.fromDate(subDays(new Date(), 90));
        const [openOrdersSnap, completedOrdersSnap, cihazUstuSnap] = await Promise.all([
          getDocs(scopedQuery(
            'centralOrders',
            currentCompanyId,
            isSuperAdmin,
            where('status', '!=', 'completed'),
            orderBy('status'),
            orderBy('createdAt', 'desc'),
            limit(500),
          )),
          getDocs(scopedQuery(
            'centralOrders',
            currentCompanyId,
            isSuperAdmin,
            where('status', '==', 'completed'),
            where('createdAt', '>=', completedSinceTs),
            orderBy('createdAt', 'desc'),
            limit(500),
          )),
          getDocs(scopedQuery('cihazUstuGecmisi', currentCompanyId, isSuperAdmin)),
        ]);

        const cihazMap: Record<string, Record<string, number>> = {};
        cihazUstuSnap.docs.forEach(d => {
          const data = d.data() as any;
          const hospitalId = String(data.hospitalId ?? '').trim();
          const period = normalizePeriodKey(data.period);
          if (!hospitalId || !period) return;

          if (!cihazMap[period]) cihazMap[period] = {};
          const items = Array.isArray(data.items) ? data.items : [];
          items.forEach((item: any) => {
            const productId = normalizeStockCode(item.productId);
            const value = Number(item.value ?? 0);
            if (!productId || Number.isNaN(value)) return;
            stockCodeVariants(productId).forEach(variant => {
              const key = `${hospitalId}::${variant}`;
              cihazMap[period][key] = (cihazMap[period][key] ?? 0) + value;
            });
          });
        });
        setCihazUstuMap(cihazMap);

        const toOrder = (d: any): CentralOrder => {
          const data = d.data() as Record<string, unknown>;
          return {
            ...(data as CentralOrder),
            id: d.id,
            createdAt: toDate(data.createdAt),
          } as CentralOrder;
        };

        setOpenOrders(openOrdersSnap.docs.map(toOrder));
        setCompletedOrders(completedOrdersSnap.docs.map(toOrder));
      } catch (error) {
        console.error(error);
      }
    };
    fetchAdditional();
  }, [currentCompanyId, isSuperAdmin]);

  const productByStockCode = useMemo(() => {
    return productCodes.reduce<Record<string, ProductCode>>((acc, product) => {
      const stockCode = (product.stokKodu ?? '').trim();
      if (stockCode) acc[stockCode] = product;
      return acc;
    }, {});
  }, [productCodes]);

  const selectedRules = useMemo(() => {
    const items: Array<{ locationType: LocationType; locationId: string; locationName: string; rule: MinMaxRule }> = [];

    selectedDepotIds.forEach(depotId => {
      const rules = depotRulesMap[depotId] ?? {};
      const depotName = depots.find(d => d.id === depotId)?.name ?? depotId;
      Object.values(rules).forEach(rule => {
        const stokKodu = (rule.stokKodu ?? '').trim();
        if (!stokKodu) return;
        items.push({
          locationType: 'depot',
          locationId: depotId,
          locationName: depotName,
          rule: { ...rule, stokKodu },
        });
      });
    });

    selectedLabIds.forEach(labId => {
      const rules = hospitalRulesMap[labId] ?? {};
      const labName = hospitals.find(h => h.id === labId)?.name ?? labId;
      Object.values(rules).forEach(rule => {
        const stokKodu = (rule.stokKodu ?? '').trim();
        if (!stokKodu) return;
        items.push({
          locationType: 'hospital',
          locationId: labId,
          locationName: labName,
          rule: { ...rule, stokKodu },
        });
      });
    });

    return items;
  }, [selectedDepotIds, selectedLabIds, depotRulesMap, hospitalRulesMap, depots, hospitals]);

  const uniqueSelectedProducts = useMemo(() => {
    const byStockCode = new Map<string, ProductCode>();

    selectedRules.forEach(({ rule }) => {
      const product = productByStockCode[rule.stokKodu];
      if (!product) return;
      if (!byStockCode.has(rule.stokKodu)) byStockCode.set(rule.stokKodu, product);
    });

    return Array.from(byStockCode.values());
  }, [selectedRules, productByStockCode]);

  const availableBrands = useMemo(() => {
    const brands = new Set<string>();
    uniqueSelectedProducts.forEach(product => {
      const brand = (product.marka ?? '').trim();
      if (brand) brands.add(brand);
    });
    return Array.from(brands).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [uniqueSelectedProducts]);

  const productsAfterBrandFilter = useMemo(() => {
    if (selectedBrands.length === 0) return uniqueSelectedProducts;
    return uniqueSelectedProducts.filter(product => {
      const brand = (product.marka ?? '').trim();
      return selectedBrands.includes(brand);
    });
  }, [uniqueSelectedProducts, selectedBrands]);

  const availableProductGroups = useMemo(() => {
    const groups = new Set<string>();
    productsAfterBrandFilter.forEach(product => {
      const group = (product.urunGrubu ?? '').trim();
      if (group) groups.add(group);
    });
    return Array.from(groups).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [productsAfterBrandFilter]);

  const productsAfterGroupFilter = useMemo(() => {
    if (selectedProductGroups.length === 0) return productsAfterBrandFilter;
    return productsAfterBrandFilter.filter(product => {
      const group = (product.urunGrubu ?? '').trim();
      return selectedProductGroups.includes(group);
    });
  }, [productsAfterBrandFilter, selectedProductGroups]);

  const availableDeviceGroups = useMemo(() => {
    const groups = new Set<string>();
    productsAfterGroupFilter.forEach(product => {
      const group = (product.cihazGrubu ?? '').trim();
      if (group) groups.add(group);
    });
    return Array.from(groups).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [productsAfterGroupFilter]);

  useEffect(() => {
    setSelectedBrands(prev => prev.filter(brand => availableBrands.includes(brand)));
  }, [availableBrands]);

  useEffect(() => {
    setSelectedProductGroups(prev => prev.filter(group => availableProductGroups.includes(group)));
  }, [availableProductGroups]);

  useEffect(() => {
    setSelectedDeviceGroups(prev => prev.filter(group => availableDeviceGroups.includes(group)));
  }, [availableDeviceGroups]);
  const toggleSelection = (value: string, selected: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(prev => (prev.includes(value) ? prev.filter(x => x !== value) : [...prev, value]));
  };

  // PERF (Faz 4): Stok sayımlarını O(1) lookup'a indir. Önceden getCurrentStockCount
  // ve getLinkedLaboratoryStockCount HER çağrıda tüm depoStok'u .filter ile tarıyordu;
  // handleGenerate bunları kural×lokasyon kez çağırınca O(kural×lokasyon×|depoStok|)
  // senkron yük oluşuyordu (Siparişler INP'sinin baş suçlusu). Stok BİR KEZ Map'e
  // indekslenir; sayım sonuçları orijinal filtrelerle birebir aynıdır.
  const { depotStockCountMap, labStockCountMap } = useMemo(() => {
    const depotMap = new Map<string, number>();
    const labMap = new Map<string, number>();
    for (const st of depoStok) {
      if (!st.stokKodu) continue;
      if (!st.isShipped) {
        if (st.depotId) {
          const k = `${st.depotId}|${st.stokKodu}`;
          depotMap.set(k, (depotMap.get(k) ?? 0) + 1);
        }
      } else if (st.hedefKurumId) {
        const k = `${st.hedefKurumId}|${st.stokKodu}`;
        labMap.set(k, (labMap.get(k) ?? 0) + 1);
      }
    }
    return { depotStockCountMap: depotMap, labStockCountMap: labMap };
  }, [depoStok]);

  const getCurrentStockCount = (locationType: LocationType, locationId: string, stokKodu: string) => {
    if (locationType === 'depot') {
      return depotStockCountMap.get(`${locationId}|${stokKodu}`) ?? 0;
    }

    return labStockCountMap.get(`${locationId}|${stokKodu}`) ?? 0;
  };

  const getLinkedLaboratoryStockCount = (depotId: string, stokKodu: string) => {
    const depot = depots.find(d => d.id === depotId);
    const linkedLabIds = depot?.linkedLaboratoryIds || [];
    if (linkedLabIds.length === 0) return 0;

    const relevantLabIds = linkedLabIds.filter(labId => Boolean(hospitalRulesMap[labId]?.[stokKodu]));
    if (relevantLabIds.length === 0) return 0;

    // labStockCountMap zaten hedefKurumId|stokKodu bazında sevk edilmiş stoğu sayıyor;
    // ilgili lab'ların toplamı orijinal tek-filtre sonucuyla aynıdır (her sevk kaydının
    // tek hedefKurumId'si var → çift sayım yok).
    let total = 0;
    for (const labId of relevantLabIds) {
      total += labStockCountMap.get(`${labId}|${stokKodu}`) ?? 0;
    }
    return total;
  };

  const periodKey = normalizePeriodKey(`${String(selectedMonth).padStart(2, '0')}-${selectedYear}`);

  const getCihazUstuAdet = (locationType: LocationType, locationId: string, stokKodu: string) => {
    const periodData = cihazUstuMap[periodKey] || {};

    if (locationType === 'hospital') {
      return stockCodeVariants(stokKodu).reduce((sum, variant) => sum + (periodData[`${locationId}::${variant}`] ?? 0), 0);
    }

    const depot = depots.find(d => d.id === locationId);
    const linkedLabIds = depot?.linkedLaboratoryIds || [];
    if (linkedLabIds.length === 0) return 0;

    return linkedLabIds.reduce((sum, labId) => sum + stockCodeVariants(stokKodu).reduce((sub, variant) => sub + (periodData[`${labId}::${variant}`] ?? 0), 0), 0);
  };

  const applyFilters = (rule: MinMaxRule) => {
    const product = productByStockCode[(rule.stokKodu ?? '').trim()];
    if (!product) return false;

    const brand = (product.marka ?? '').trim();
    const productGroup = (product.urunGrubu ?? '').trim();
    const deviceGroup = (product.cihazGrubu ?? '').trim();

    if (selectedBrands.length > 0 && !selectedBrands.includes(brand)) return false;
    if (selectedProductGroups.length > 0 && !selectedProductGroups.includes(productGroup)) return false;

    if (availableDeviceGroups.length > 0 && selectedDeviceGroups.length > 0 && !selectedDeviceGroups.includes(deviceGroup)) {
      return false;
    }

    return true;
  };

  const handleGenerate = () => {
    const hedefGun = Number(yeterlilikGun);
    if (!hedefGun || hedefGun <= 0) {
      toast({ title: 'Hata', description: 'Lütfen geçerli bir yeterlilik günü girin.', variant: 'destructive' });
      return;
    }

    if (selectedDepotIds.length === 0 && selectedLabIds.length === 0) {
      toast({ title: 'Hata', description: 'En az bir depo veya laboratuvar seçin.', variant: 'destructive' });
      return;
    }

    setIsGenerating(true);
    try {
      const generated: GeneratedOrderItem[] = [];

      selectedRules.forEach(({ locationType, locationId, locationName, rule }) => {
        if (!applyFilters(rule)) return;

        const product = productByStockCode[rule.stokKodu];
        if (!product) return;

        const max = Number(rule.max ?? 0);
        const maxGun = Number(rule.maxGun ?? 0);
        if (max <= 0) return;

        const hedefAdet = maxGun > 0
          ? Math.ceil((hedefGun / maxGun) * max)
          : max;

        const depoAdet = getCurrentStockCount(locationType, locationId, rule.stokKodu);
        const laboratuvarAdet = locationType === 'depot'
          ? getLinkedLaboratoryStockCount(locationId, rule.stokKodu)
          : 0;
        const toplamAdet = depoAdet + laboratuvarAdet;
        const cihazUstuAdet = getCihazUstuAdet(locationType, locationId, rule.stokKodu);
        const ambalaj = Number(product.ambalajDegeri ?? 0);
        const cihazUstuKutu = ambalaj > 0 ? Math.ceil(cihazUstuAdet / ambalaj) : 0;
        const genelToplam = toplamAdet + cihazUstuKutu;
        const siparisAdedi = Math.max(0, hedefAdet - genelToplam);

        if (siparisAdedi <= 0) return;

        generated.push({
          key: `${locationType}:${locationId}:${rule.stokKodu}`,
          locationType,
          locationId,
          locationName,
          stokKodu: rule.stokKodu,
          stokAdi: product.stokAdi,
          marka: product.marka,
          urunGrubu: product.urunGrubu,
          cihazGrubu: product.cihazGrubu,
          mevcutAdet: depoAdet,
          laboratuvarAdet,
          toplamAdet,
          cihazUstuAdet,
          cihazUstuKutu,
          genelToplam,
          hedefAdet,
          siparisAdedi,
          min: Number(rule.min ?? 0),
          max,
          maxGun: maxGun > 0 ? maxGun : undefined,
          costPerUnit: Number(product.cost ?? 0),
        });
      });

      setGeneratedItems(generated);
      toast({ title: 'Hazır', description: `${generated.length} satır sipariş hesaplandı.` });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = () => {
    if (generatedItems.length === 0) {
      toast({ title: 'Hata', description: 'Kaydedilecek sipariş satırı yok.', variant: 'destructive' });
      return;
    }

    // --- OPTIMISTIC UI ---
    const previousGeneratedItems = [...generatedItems];
    const previousOpenOrders = [...openOrders];

    const id = generateId();
    const items: CentralOrderItem[] = generatedItems.map(item => ({
      stokKodu: item.stokKodu,
      stokAdi: item.stokAdi,
      orderedQty: item.siparisAdedi,
      receivedQty: 0,
      locationType: item.locationType,
      locationId: item.locationId,
      locationName: item.locationName,
      marka: item.marka,
      urunGrubu: item.urunGrubu,
      cihazGrubu: item.cihazGrubu,
    }));

    const newOrder = {
      id,
      status: 'open',
      createdAt: new Date(),
      selectedDepotIds,
      selectedLabIds,
      selectedBrands,
      selectedProductGroups,
      selectedDeviceGroups,
      yeterlilikGun: Number(yeterlilikGun),
      createdBy: currentUserProfile?.name || currentUser?.email || 'Bilinmiyor',
      createdById: currentUserProfile?.uid || currentUser?.uid || '',
      items,
    };

    // Ekranı beklemeden temizle ve açık siparişlere anında ekle
    setGeneratedItems([]);
    setOpenOrders(prev => [newOrder as any, ...prev]);

    toast({
      title: 'Siparişiniz İletiliyor...',
      description: 'Arka planda kaydediliyor, çıkış yapmayınız.',
      duration: 3000
    });

    // --- ARKA PLAN İŞLEMİ (Fire and Forget) ---
    (async () => {
      try {
        const orderRef = doc(db, 'centralOrders', id);
        
        await setDoc(orderRef, {
          ...newOrder,
          createdAt: serverTimestamp(), // Sunucu saati ile eziyoruz
        });

        toast({ title: 'Başarılı', description: 'Merkez sipariş oluşturuldu.' });
      } catch (error) {
        console.error(error);
        // --- ROLLBACK ---
        setGeneratedItems(previousGeneratedItems);
        setOpenOrders(previousOpenOrders);
        toast({ title: 'İşlem İptal Edildi (Rollback)', description: 'Sipariş kaydedilemedi, veritabanı hatası.', variant: 'destructive' });
      }
    })();
  };

  const renderMultiSelect = (
    title: string,
    values: string[],
    selected: string[],
    setSelected: React.Dispatch<React.SetStateAction<string[]>>,
    emptyMessage?: string,
  ) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{title}</Label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setSelected(values)} disabled={values.length === 0}>Tümünü Seç</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setSelected([])} disabled={selected.length === 0}>Temizle</Button>
      </div>
      <ScrollArea className="h-28 border rounded-md p-2">
        <div className="space-y-2">
          {values.map(value => (
            <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={selected.includes(value)} onCheckedChange={() => toggleSelection(value, selected, setSelected)} />
              <span>{value}</span>
            </label>
          ))}
          {values.length === 0 && <p className="text-xs text-muted-foreground">{emptyMessage ?? 'Seçim için önce depo/laboratuvar belirleyin.'}</p>}
        </div>
      </ScrollArea>
    </div>
  );

  const mismatchSummaryText = (order: CentralOrder) => {
    const eksik = order.discrepancySummary?.eksik ?? 0;
    const fazla = order.discrepancySummary?.fazla ?? 0;

    if (eksik === 0 && fazla === 0) return 'Tüm ürünler tam teslim edildi.';
    if (eksik > 0 && fazla === 0) return `${eksik} adet üründe eksik var.`;
    if (eksik === 0 && fazla > 0) return `${fazla} adet üründe fazla var.`;
    return `${eksik} adet üründe eksik, ${fazla} adet üründe fazla var.`;
  };

  const filteredDepots = depots.filter(d => d.name?.toLowerCase().includes(depotSearch.toLowerCase()));

  const handleGeneratedItemChange = (key: string, field: 'cihazUstuAdet' | 'siparisAdedi', value: string) => {
    const numericValue = Math.max(0, Number(value) || 0);
    setGeneratedItems(prev => prev.map(item => {
      if (item.key !== key) return item;
      if (field === 'siparisAdedi') {
        return { ...item, siparisAdedi: numericValue };
      }

      const cihazUstuKutu = Math.ceil(numericValue / Math.max(1, item.min || 1));
      const genelToplam = item.toplamAdet + numericValue;
      const siparisAdedi = Math.max(0, item.hedefAdet - genelToplam);
      return {
        ...item,
        cihazUstuAdet: numericValue,
        cihazUstuKutu,
        genelToplam,
        siparisAdedi,
      };
    }));
  };

  const filteredGeneratedItems = useMemo(() => {
    return generatedItems.filter(item => {
      return Object.entries(tableFilters).every(([column, filterValue]) => {
        if (!filterValue?.trim()) return true;
        const normalizedFilter = filterValue.toLowerCase();
        const value = String((item as Record<string, unknown>)[column] ?? '').toLowerCase();
        return value.includes(normalizedFilter);
      });
    });
  }, [generatedItems, tableFilters]);

  const totalVisibleCost = useMemo(() => {
    return filteredGeneratedItems.reduce((sum, item) => sum + (item.costPerUnit * item.siparisAdedi), 0);
  }, [filteredGeneratedItems]);

  const handleExportGeneratedList = () => {
    if (filteredGeneratedItems.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak sipariş listesi bulunamadı.' });
      return;
    }

    const rows = filteredGeneratedItems.map(item => ({
      Konum: item.locationName,
      KonumTipi: item.locationType === 'depot' ? 'Depo' : 'Laboratuvar',
      StokKodu: item.stokKodu,
      UrunAdi: item.stokAdi,
      DepoAdet: item.mevcutAdet,
      LabAdet: item.laboratuvarAdet,
      ToplamAdet: item.toplamAdet,
      CihazUstuAdet: item.cihazUstuAdet,
      CihazUstuKutu: item.cihazUstuKutu,
      GenelToplam: item.genelToplam,
      HedefAdet: item.hedefAdet,
      SiparisAdedi: item.siparisAdedi,
      BirimFiyatTL: item.costPerUnit,
      SatirMaliyetTL: item.costPerUnit * item.siparisAdedi,
    }));

    exportDataToExcel(rows, 'Merkez_Siparis_Olusturulan_Liste', 'Siparis', toast);
  };

  const getOrderMeta = (order: CentralOrder) => {
    const brands = Array.from(new Set(order.items.map(i => (i.marka ?? '').trim()).filter(Boolean))).join(', ') || '-';
    const locations = Array.from(new Set(order.items.map(i => i.locationName).filter(Boolean))).join(', ') || '-';
    const orderCost = order.items.reduce((sum, item) => {
      const product = productByStockCode[item.stokKodu];
      const unitPrice = Number(product?.cost ?? 0);
      return sum + (unitPrice * Number(item.orderedQty ?? 0));
    }, 0);

    return { brands, locations, orderCost };
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="create">
        <TabsList>
          <TabsTrigger value="create">Sipariş Oluştur</TabsTrigger>
          <TabsTrigger value="open">Açık Siparişler</TabsTrigger>
          <TabsTrigger value="completed">Tamamlanan Siparişler</TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="mt-4">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            {showSelectionPanel && (
            <Card className="xl:col-span-4">
              <CardHeader>
                <CardTitle>Depo / Laboratuvar Seçimi</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label>Depolar</Label>
                  <Input placeholder="Depo ara..." value={depotSearch} onChange={e => setDepotSearch(e.target.value)} />
                  <ScrollArea className="h-52 border rounded-md p-2">
                    <div className="space-y-2">
                      {filteredDepots.map(depot => (
                        <label key={depot.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox checked={selectedDepotIds.includes(depot.id)} onCheckedChange={() => toggleSelection(depot.id, selectedDepotIds, setSelectedDepotIds)} />
                          <span>{depot.name}</span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                <LabSelector
                  mode="multi"
                  label="Laboratuvarlar"
                  labs={hospitals.map(h => ({ id: h.id, name: h.name, kod: h.kod }))}
                  values={selectedLabIds}
                  onValuesChange={setSelectedLabIds}
                  placeholder="Laboratuvar seçin"
                  showChips
                />
              </CardContent>
            </Card>
            )}

            <Card className={showSelectionPanel ? "xl:col-span-8" : "xl:col-span-12"}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Sipariş Ayarları</CardTitle>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowSelectionPanel(prev => !prev)}>
                  {showSelectionPanel ? 'Seçim Panelini Gizle' : 'Seçim Panelini Göster'}
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {renderMultiSelect('Marka', availableBrands, selectedBrands, setSelectedBrands, 'Seçili konumların min-max ürünlerinde marka bulunamadı.')}
                  {renderMultiSelect('Ürün Grubu', availableProductGroups, selectedProductGroups, setSelectedProductGroups, 'Seçili marka filtresine göre ürün grubu bulunamadı.')}
                  {renderMultiSelect('Cihaz Grubu', availableDeviceGroups, selectedDeviceGroups, setSelectedDeviceGroups, 'Seçili ürün gruplarında cihaz grubu bulunmuyor, bu filtre opsiyoneldir.')}
                </div>

                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-1">
                    <Label>Dönem (Ay / Yıl)</Label>
                    <div className="flex gap-2">
                      <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                        <SelectTrigger className="w-40"><SelectValue placeholder="Ay" /></SelectTrigger>
                        <SelectContent>
                          {MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                        <SelectTrigger className="w-28"><SelectValue placeholder="Yıl" /></SelectTrigger>
                        <SelectContent>
                          {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Yeterlilik Günü</Label>
                    <Input type="number" min="1" value={yeterlilikGun} onChange={e => setYeterlilikGun(e.target.value)} className="w-40" />
                  </div>
                  <Button onClick={handleGenerate} disabled={isGenerating || isLoading}>Max'a Göre Sipariş Oluştur</Button>
                  <Button variant="default" onClick={handleSave} disabled={isSaving || generatedItems.length === 0}>Kaydet</Button>
                  <Button variant="outline" onClick={handleExportGeneratedList} disabled={filteredGeneratedItems.length === 0}>Excel'e Aktar</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cihaz üstü veriler seçili ay/yıl dönemindeki cihazUstuGecmisi kayıtlarından alınır; kutu karşılığı ambalaj değerine göre yukarı yuvarlanır.
                </p>

                <div className="flex justify-end items-center gap-4 text-sm">
                  <span className="font-medium">Sipariş Maliyeti: {totalVisibleCost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</span>
                  <Badge variant="secondary">Toplam Ürün: {filteredGeneratedItems.length}</Badge>
                </div>

                <div className="border rounded-md">
                  <ScrollArea className="h-[420px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Konum</TableHead>
                          <TableHead>Stok Kodu</TableHead>
                          <TableHead>Ürün</TableHead>
                          <TableHead>Depo Adet</TableHead>
                          <TableHead>Lab Adet</TableHead>
                          <TableHead>Toplam</TableHead>
                          <TableHead>Cihaz Üstü Adet</TableHead>
                          <TableHead>Cihaz Üstü Kutu</TableHead>
                          <TableHead>Genel Toplam</TableHead>
                          <TableHead>Hedef</TableHead>
                          <TableHead>Sipariş</TableHead>
                          <TableHead>Max/Max Gün</TableHead>
                        </TableRow>
                        <TableRow>
                          {[
                            'locationName',
                            'stokKodu',
                            'stokAdi',
                            'mevcutAdet',
                            'laboratuvarAdet',
                            'toplamAdet',
                            'cihazUstuAdet',
                            'cihazUstuKutu',
                            'genelToplam',
                            'hedefAdet',
                            'siparisAdedi',
                            'max',
                          ].map(column => (
                            <TableHead key={column}>
                              <Input
                                value={tableFilters[column] ?? ''}
                                onChange={e => setTableFilters(prev => ({ ...prev, [column]: e.target.value }))}
                                placeholder="Filtre"
                                className="h-8"
                              />
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredGeneratedItems.map(item => (
                          <TableRow key={item.key}>
                            <TableCell>{item.locationName} <Badge variant="secondary" className="ml-2">{item.locationType === 'depot' ? 'Depo' : 'Lab'}</Badge></TableCell>
                            <TableCell>{item.stokKodu}</TableCell>
                            <TableCell>{item.stokAdi}</TableCell>
                            <TableCell>{item.mevcutAdet}</TableCell>
                            <TableCell>{item.laboratuvarAdet}</TableCell>
                            <TableCell>{item.toplamAdet}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min="0"
                                value={item.cihazUstuAdet}
                                onChange={e => handleGeneratedItemChange(item.key, 'cihazUstuAdet', e.target.value)}
                                className="w-24"
                              />
                            </TableCell>
                            <TableCell>{item.cihazUstuKutu}</TableCell>
                            <TableCell>{item.genelToplam}</TableCell>
                            <TableCell>{item.hedefAdet}</TableCell>
                            <TableCell className="font-semibold">
                              <Input
                                type="number"
                                min="0"
                                value={item.siparisAdedi}
                                onChange={e => handleGeneratedItemChange(item.key, 'siparisAdedi', e.target.value)}
                                className="w-24"
                              />
                            </TableCell>
                            <TableCell>{item.max} / {item.maxGun ?? '-'}</TableCell>
                          </TableRow>
                        ))}
                        {filteredGeneratedItems.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={12} className="text-center text-muted-foreground py-10">Henüz sipariş oluşturulmadı.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="open" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Açık Siparişler</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {openOrders.map(order => {
                  const meta = getOrderMeta(order);
                  return (
                  <button
                    key={order.id}
                    className="w-full text-left border rounded-md p-3 hover:bg-muted"
                    onClick={() => router.push(`/merkez-siparis/acik-siparis/${order.id}`)}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-semibold">{meta.brands} - {meta.orderCost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</p>
                        <p className="text-xs text-muted-foreground">
                          {order.createdAt ? order.createdAt.toLocaleString('tr-TR') : '-'} • {order.createdBy ?? '-'} • {meta.locations}
                        </p>
                      </div>
                      <Badge>{order.items.length} ürün</Badge>
                    </div>
                  </button>
                  );
                })}
                {openOrders.length === 0 && <p className="text-muted-foreground">Açık sipariş yok.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Tamamlanan Siparişler</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {completedOrders.map(order => {
                  const meta = getOrderMeta(order);
                  return (
                  <button
                    key={order.id}
                    className="w-full text-left border rounded-md p-3 hover:bg-muted"
                    onClick={() => router.push(`/merkez-siparis/acik-siparis/${order.id}`)}
                  >
                    <div className="flex justify-between items-center gap-4">
                      <div>
                        <p className="font-semibold">{meta.brands} - {meta.orderCost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</p>
                        <p className="text-xs text-muted-foreground">
                          {order.createdAt ? order.createdAt.toLocaleString('tr-TR') : '-'} • {order.createdBy ?? '-'} • {meta.locations}
                        </p>
                      </div>
                      <p className="text-sm">{mismatchSummaryText(order)}</p>
                    </div>
                  </button>
                    );
                })}
                {completedOrders.length === 0 && <p className="text-muted-foreground">Tamamlanan sipariş yok.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {isLoading && generatedItems.length === 0 && <MerkezSiparisSkeleton />}
    </div>
  );
}
