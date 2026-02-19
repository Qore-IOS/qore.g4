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
  setDoc
} from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { generateId } from '@/lib/utils';

type LocationType = 'depot' | 'hospital';

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' }),
}));
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

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

  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [depots, setDepots] = useState<Depot[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<DeviceGroup[]>([]);
  const [depoStok, setDepoStok] = useState<DepoStokItem[]>([]);
  const [depotRulesMap, setDepotRulesMap] = useState<Record<string, Record<string, MinMaxRule>>>({});
  const [hospitalRulesMap, setHospitalRulesMap] = useState<Record<string, Record<string, MinMaxRule>>>({});

  const [selectedDepotIds, setSelectedDepotIds] = useState<string[]>([]);
  const [selectedLabIds, setSelectedLabIds] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedProductGroups, setSelectedProductGroups] = useState<string[]>([]);
  const [selectedDeviceGroups, setSelectedDeviceGroups] = useState<string[]>([]);
  const [yeterlilikGun, setYeterlilikGun] = useState<number | string>('');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);

  const [depotSearch, setDepotSearch] = useState('');
  const [labSearch, setLabSearch] = useState('');
  const [generatedItems, setGeneratedItems] = useState<GeneratedOrderItem[]>([]);

  const [openOrders, setOpenOrders] = useState<CentralOrder[]>([]);
  const [completedOrders, setCompletedOrders] = useState<CentralOrder[]>([]);
  const [cihazUstuMap, setCihazUstuMap] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [depotsSnap, hospitalsSnap, productsSnap, stokSnap, groupsSnap, centralOrdersSnap, cihazUstuSnap] = await Promise.all([
          getDocs(collection(db, 'depots')),
          getDocs(collection(db, 'hospitals')),
          getDocs(collection(db, 'productCodes')),
          getDocs(collection(db, 'depoStok')),
          getDocs(collection(db, 'deviceGroups')),
          getDocs(query(collection(db, 'centralOrders'), orderBy('createdAt', 'desc'))),
          getDocs(collection(db, 'cihazUstuGecmisi')),
        ]);

        const depotsData = depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot));
        const hospitalsData = hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital));
        const productsData = productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode));
        const stokData = stokSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
        const deviceGroupsData = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() } as DeviceGroup));

        setDepots(depotsData);
        setHospitals(hospitalsData);
        setProductCodes(productsData);
        setDepoStok(stokData);
        setDeviceGroups(deviceGroupsData);

        const depotRuleEntries = await Promise.all(
          depotsData.map(async depot => {
            const rs = await getDocs(collection(db, 'depots', depot.id, 'minMaxRules'));
            const rules = rs.docs.reduce<Record<string, MinMaxRule>>((acc, d) => {
              const r = d.data() as MinMaxRule;
              if (r?.stokKodu) acc[r.stokKodu] = r;
              return acc;
            }, {});
            return [depot.id, rules] as const;
          })
        );

        const hospitalRuleEntries = await Promise.all(
          hospitalsData.map(async hospital => {
            const rs = await getDocs(collection(db, 'hospitals', hospital.id, 'minMaxRules'));
            const rules = rs.docs.reduce<Record<string, MinMaxRule>>((acc, d) => {
              const r = d.data() as MinMaxRule;
              if (r?.stokKodu) acc[r.stokKodu] = r;
              return acc;
            }, {});
            return [hospital.id, rules] as const;
          })
        );

        setDepotRulesMap(Object.fromEntries(depotRuleEntries));
        setHospitalRulesMap(Object.fromEntries(hospitalRuleEntries));

        const cihazMap: Record<string, Record<string, number>> = {};
        cihazUstuSnap.docs.forEach(d => {
          const data = d.data() as any;
          const hospitalId = String(data.hospitalId ?? '').trim();
          const period = String(data.period ?? '').trim();
          if (!hospitalId || !period) return;

          if (!cihazMap[period]) cihazMap[period] = {};
          const items = Array.isArray(data.items) ? data.items : [];
          items.forEach((item: any) => {
            const productId = String(item.productId ?? '').trim();
            const value = Number(item.value ?? 0);
            if (!productId || Number.isNaN(value)) return;
            const key = `${hospitalId}::${productId}`;
            cihazMap[period][key] = (cihazMap[period][key] ?? 0) + value;
          });
        });
        setCihazUstuMap(cihazMap);

        const orders = centralOrdersSnap.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            ...(data as CentralOrder),
            id: d.id,
            createdAt: toDate(data.createdAt),
          } as CentralOrder;
        });

        setOpenOrders(orders.filter(o => o.status !== 'completed'));
        setCompletedOrders(orders.filter(o => o.status === 'completed'));
      } catch (error) {
        console.error(error);
        toast({ title: 'Hata', description: 'Merkez sipariş verileri yüklenemedi.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [toast]);

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

  const getCurrentStockCount = (locationType: LocationType, locationId: string, stokKodu: string) => {
    if (locationType === 'depot') {
      return depoStok.filter(st => st.depotId === locationId && !st.isShipped && st.stokKodu === stokKodu).length;
    }

    return depoStok.filter(st => st.hedefKurumId === locationId && st.isShipped && st.stokKodu === stokKodu).length;
  };

  const getLinkedLaboratoryStockCount = (depotId: string, stokKodu: string) => {
    const depot = depots.find(d => d.id === depotId);
    const linkedLabIds = depot?.linkedLaboratoryIds || [];
    if (linkedLabIds.length === 0) return 0;

    const relevantLabIds = linkedLabIds.filter(labId => Boolean(hospitalRulesMap[labId]?.[stokKodu]));
    if (relevantLabIds.length === 0) return 0;

    return depoStok.filter(st => (
      st.isShipped
      && Boolean(st.hedefKurumId)
      && relevantLabIds.includes(st.hedefKurumId as string)
      && st.stokKodu === stokKodu
    )).length;
  };

  const periodKey = `${String(selectedMonth).padStart(2, '0')}-${selectedYear}`;

  const getCihazUstuAdet = (locationType: LocationType, locationId: string, stokKodu: string) => {
    const periodData = cihazUstuMap[periodKey] || {};

    if (locationType === 'hospital') {
      return periodData[`${locationId}::${stokKodu}`] ?? 0;
    }

    const depot = depots.find(d => d.id === locationId);
    const linkedLabIds = depot?.linkedLaboratoryIds || [];
    if (linkedLabIds.length === 0) return 0;

    const relevantLabIds = linkedLabIds.filter(labId => Boolean(hospitalRulesMap[labId]?.[stokKodu]));
    return relevantLabIds.reduce((sum, labId) => sum + (periodData[`${labId}::${stokKodu}`] ?? 0), 0);
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
        });
      });

      setGeneratedItems(generated);
      toast({ title: 'Hazır', description: `${generated.length} satır sipariş hesaplandı.` });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (generatedItems.length === 0) {
      toast({ title: 'Hata', description: 'Kaydedilecek sipariş satırı yok.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const id = generateId();
      const orderRef = doc(db, 'centralOrders', id);

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

      await setDoc(orderRef, {
        id,
        status: 'open',
        createdAt: serverTimestamp(),
        selectedDepotIds,
        selectedLabIds,
        selectedBrands,
        selectedProductGroups,
        selectedDeviceGroups,
        yeterlilikGun: Number(yeterlilikGun),
        items,
      });

      toast({ title: 'Başarılı', description: 'Merkez sipariş oluşturuldu.' });
      setOpenOrders(prev => [{
        id,
        status: 'open',
        createdAt: new Date(),
        selectedDepotIds,
        selectedLabIds,
        selectedBrands,
        selectedProductGroups,
        selectedDeviceGroups,
        yeterlilikGun: Number(yeterlilikGun),
        items,
      }, ...prev]);
      setGeneratedItems([]);
    } catch (error) {
      console.error(error);
      toast({ title: 'Hata', description: 'Sipariş kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
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
  const filteredLabs = hospitals.filter(h => h.name?.toLowerCase().includes(labSearch.toLowerCase()));

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

                <div className="space-y-2">
                  <Label>Laboratuvarlar</Label>
                  <Input placeholder="Laboratuvar ara..." value={labSearch} onChange={e => setLabSearch(e.target.value)} />
                  <ScrollArea className="h-52 border rounded-md p-2">
                    <div className="space-y-2">
                      {filteredLabs.map(hospital => (
                        <label key={hospital.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox checked={selectedLabIds.includes(hospital.id)} onCheckedChange={() => toggleSelection(hospital.id, selectedLabIds, setSelectedLabIds)} />
                          <span>{hospital.name}</span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>

            <Card className="xl:col-span-8">
              <CardHeader>
                <CardTitle>Sipariş Ayarları</CardTitle>
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
                </div>
                <p className="text-xs text-muted-foreground">
                  Cihaz üstü veriler seçili ay/yıl dönemindeki cihazUstuGecmisi kayıtlarından alınır; kutu karşılığı ambalaj değerine göre yukarı yuvarlanır.
                </p>

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
                      </TableHeader>
                      <TableBody>
                        {generatedItems.map(item => (
                          <TableRow key={item.key}>
                            <TableCell>{item.locationName} <Badge variant="secondary" className="ml-2">{item.locationType === 'depot' ? 'Depo' : 'Lab'}</Badge></TableCell>
                            <TableCell>{item.stokKodu}</TableCell>
                            <TableCell>{item.stokAdi}</TableCell>
                            <TableCell>{item.mevcutAdet}</TableCell>
                            <TableCell>{item.laboratuvarAdet}</TableCell>
                            <TableCell>{item.toplamAdet}</TableCell>
                            <TableCell>{item.cihazUstuAdet}</TableCell>
                            <TableCell>{item.cihazUstuKutu}</TableCell>
                            <TableCell>{item.genelToplam}</TableCell>
                            <TableCell>{item.hedefAdet}</TableCell>
                            <TableCell className="font-semibold">{item.siparisAdedi}</TableCell>
                            <TableCell>{item.max} / {item.maxGun ?? '-'}</TableCell>
                          </TableRow>
                        ))}
                        {generatedItems.length === 0 && (
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
                {openOrders.map(order => (
                  <button
                    key={order.id}
                    className="w-full text-left border rounded-md p-3 hover:bg-muted"
                    onClick={() => router.push(`/merkez-siparis/acik-siparis/${order.id}`)}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-semibold">Merkez Sipariş #{order.id}</p>
                        <p className="text-xs text-muted-foreground">{order.createdAt ? order.createdAt.toLocaleString('tr-TR') : '-'}</p>
                      </div>
                      <Badge>{order.items.length} ürün</Badge>
                    </div>
                  </button>
                ))}
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
                {completedOrders.map(order => (
                  <button
                    key={order.id}
                    className="w-full text-left border rounded-md p-3 hover:bg-muted"
                    onClick={() => router.push(`/merkez-siparis/acik-siparis/${order.id}`)}
                  >
                    <div className="flex justify-between items-center gap-4">
                      <div>
                        <p className="font-semibold">Merkez Sipariş #{order.id}</p>
                        <p className="text-xs text-muted-foreground">{order.createdAt ? order.createdAt.toLocaleString('tr-TR') : '-'}</p>
                      </div>
                      <p className="text-sm">{mismatchSummaryText(order)}</p>
                    </div>
                  </button>
                ))}
                {completedOrders.length === 0 && <p className="text-muted-foreground">Tamamlanan sipariş yok.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {isLoading && <p className="text-sm text-muted-foreground">Yükleniyor...</p>}
    </div>
  );
}
