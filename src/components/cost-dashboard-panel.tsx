
'use client';
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import type { ProductCode, DepoStokItem, ConsumptionRecord, Currency } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LineChart, PieChart, ResponsiveContainer, Line, Pie, Cell, Tooltip, XAxis, YAxis, Legend, BarChart, Bar } from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format, startOfMonth, endOfMonth, eachMonthOfInterval, isValid } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from "@/hooks/use-toast";


const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7f50', '#d0ed57', '#ff8042', '#00C49F'];

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  EUR: '€',
  USD: '$',
  TRY: '₺',
};

const PRIMARY_API_KEY = 'e69314b14644080788775553';
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

async function fetchPrimaryRates(): Promise<Record<Currency, number>> {
  const res = await fetch(`https://v6.exchangerate-api.com/v6/${PRIMARY_API_KEY}/latest/EUR`);
  if (!res.ok) throw new Error('Primary API fetch failed');
  const data = await res.json();
  if (!data.conversion_rates?.USD || !data.conversion_rates?.TRY) {
      throw new Error('Primary API missing required currency rates');
  }
  return {
    EUR: 1,
    USD: data.conversion_rates.USD,
    TRY: data.conversion_rates.TRY,
  };
}

async function fetchBackupRates(): Promise<Record<Currency, number>> {
  const res = await fetch(`https://api.frankfurter.app/latest?from=EUR&to=USD,TRY`);
  if (!res.ok) throw new Error('Backup API fetch failed');
  const data = await res.json();
  if (!data.rates?.USD || !data.rates?.TRY) {
    throw new Error('Backup API missing required currency rates');
  }
  return {
    EUR: 1,
    USD: data.rates.USD,
    TRY: data.rates.TRY,
  };
}

interface CostDashboardPanelProps {
  productCodes: ProductCode[];
  depoStok: DepoStokItem[];
  tuketimKayitlari: ConsumptionRecord[];
}


export default function CostDashboardPanel({ productCodes, depoStok, tuketimKayitlari }: CostDashboardPanelProps) {
  const [rates, setRates] = useState<Record<Currency, number> | null>(null);
  const [currency, setCurrency] = useState<Currency>('TRY');
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const fetchAndCacheRates = useCallback(async () => {
    const cacheKey = 'exchange_rates_cache';
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_TTL) {
                setRates(data);
                return;
            }
        }
    } catch (e) {
        console.error("Error reading from cache", e);
    }
    
    try {
        const primaryData = await fetchPrimaryRates();
        setRates(primaryData);
        localStorage.setItem(cacheKey, JSON.stringify({ data: primaryData, timestamp: Date.now() }));
    } catch (primaryError) {
        console.warn("Primary API failed:", primaryError, "Trying backup.");
        try {
            const backupData = await fetchBackupRates();
            setRates(backupData);
            localStorage.setItem(cacheKey, JSON.stringify({ data: backupData, timestamp: Date.now() }));
        } catch (backupError) {
            console.error("Backup API failed:", backupError);
            toast({
                title: 'Döviz Kuru Hatası',
                description: 'Döviz kurları alınamadı. Lütfen daha sonra tekrar deneyin.',
                variant: 'destructive'
            });
            // Use stale cache if available
            const cached = localStorage.getItem(cacheKey);
            if (cached) setRates(JSON.parse(cached).data);
        }
    }
  }, [toast]);


  useEffect(() => {
    const fetchRates = async () => {
      setIsLoading(true);
      await fetchAndCacheRates();
      setIsLoading(false);
    };
    fetchRates();
  }, [fetchAndCacheRates]);
  
  const productMap = useMemo(() => {
    const map = new Map<string, ProductCode>();
    productCodes.forEach(p => map.set(p.stokKodu, p));
    return map;
  }, [productCodes]);

  const getCostInEur = useCallback((itemStokKodu: string) => {
    if (!rates) return 0;
    const product = productMap.get(itemStokKodu);
    if (!product || !product.cost || !product.currency) return 0;

    switch (product.currency) {
        case 'EUR': return product.cost;
        case 'USD': return product.cost / (rates.USD || 1);
        case 'TRY': return product.cost / (rates.TRY || 1);
        default: return 0;
    }
  }, [rates, productMap]);

  const totalCosts = useMemo(() => {
    if (!rates) return { EUR: 0, USD: 0, TRY: 0, byProduct: [] };
    let totalEUR = 0;
    const costByProduct: Record<string, { name: string; costEUR: number }> = {};
    const currentStock = depoStok.filter(item => !item.isShipped);

    currentStock.forEach(item => {
      const costEUR = getCostInEur(item.stokKodu);
      totalEUR += costEUR;
      if (!costByProduct[item.stokKodu]) {
        costByProduct[item.stokKodu] = { name: item.stokAdi, costEUR: 0 };
      }
      costByProduct[item.stokKodu].costEUR += costEUR;
    });

    return {
      EUR: totalEUR,
      USD: totalEUR * rates.USD,
      TRY: totalEUR * rates.TRY,
      byProduct: Object.entries(costByProduct).map(([code, { name, costEUR }]) => ({
        code,
        name,
        cost: costEUR * (rates?.[currency] ?? 1),
      })),
    };
  }, [depoStok, currency, rates, productMap, getCostInEur]);

  const monthlyChartData = useMemo(() => {
    if (!rates) return [];
    const now = new Date();
    const lastYear = new Date(now.getFullYear() -1, now.getMonth(), now.getDate());
    const months = eachMonthOfInterval({ start: lastYear, end: now });

    return months.map(monthStart => {
        const monthEnd = endOfMonth(monthStart);
        const monthConsumptions = tuketimKayitlari.filter(k => {
            if (!k.consumptionTimestamp || !isValid(new Date(k.consumptionTimestamp))) return false;
            const d = new Date(k.consumptionTimestamp);
            return d >= monthStart && d <= monthEnd;
        });

        const monthCostEUR = monthConsumptions.reduce((sum, k) => sum + getCostInEur(k.stokKodu), 0);
        return {
            month: format(monthStart, 'MMM yy', { locale: tr }),
            cost: monthCostEUR * (rates?.[currency] ?? 1),
        };
    });
  }, [tuketimKayitlari, rates, currency, getCostInEur]);

  const brandPieData = useMemo(() => {
    if (!rates) return [];
    const brandMap = new Map<string, number>();
    const currentStock = depoStok.filter(item => !item.isShipped);
    currentStock.forEach(item => {
      const product = productMap.get(item.stokKodu);
      if (!product?.marka) return;
      const costEUR = getCostInEur(item.stokKodu);
      brandMap.set(product.marka, (brandMap.get(product.marka) || 0) + costEUR);
    });
    return Array.from(brandMap.entries()).map(([name, value]) => ({ name, value: value * (rates?.[currency] ?? 1) }));
  }, [depoStok, rates, currency, productMap, getCostInEur]);
  
  const labDailyCosts = useMemo(() => {
      if (!rates) return [];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const startOfDay = new Date(yesterday.setHours(0, 0, 0, 0));
      const endOfDay = new Date(yesterday.setHours(23, 59, 59, 999));

      const costs: Record<string, number> = {};

      tuketimKayitlari.forEach(k => {
          if (!k.consumptionTimestamp || !isValid(new Date(k.consumptionTimestamp))) return;
          const d = new Date(k.consumptionTimestamp);
          if (d >= startOfDay && d <= endOfDay && k.laboratoryName) {
              costs[k.laboratoryName] = (costs[k.laboratoryName] || 0) + getCostInEur(k.stokKodu);
          }
      });
      return Object.entries(costs).map(([name, costEUR]) => ({
          name, cost: costEUR * (rates?.[currency] ?? 1)
      })).sort((a,b) => b.cost - a.cost);

  }, [tuketimKayitlari, rates, currency, getCostInEur]);
  
  const quarterlyData = useMemo(() => {
    if (!rates) return [0,0,0,0];
    const quarters = [0, 0, 0, 0];
    tuketimKayitlari.forEach(k => {
      if (!k.consumptionTimestamp || !isValid(new Date(k.consumptionTimestamp))) return;
      const d = new Date(k.consumptionTimestamp);
      const q = Math.floor(d.getMonth() / 3);
      quarters[q] += getCostInEur(k.stokKodu);
    });
    return quarters.map(q => q * (rates?.[currency] ?? 1));
  }, [tuketimKayitlari, rates, currency, getCostInEur]);


  if (isLoading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Top Left */}
        <Card className="col-span-1 lg:col-span-2 glass-card">
          <CardHeader>
            <CardTitle>Toplam Envanter Maliyeti</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-primary mb-4">{CURRENCY_SYMBOLS[currency]} {(totalCosts[currency as keyof Pick<typeof totalCosts, 'EUR' | 'USD' | 'TRY'>] as number).toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            <div className="flex gap-2">
                {(['EUR', 'USD', 'TRY'] as Currency[]).map(cur => (
                    <Button size="sm" variant={currency === cur ? 'default' : 'outline'} onClick={() => setCurrency(cur)} key={cur}>
                        {cur}
                    </Button>
                ))}
                 <Button size="sm" variant="secondary" onClick={() => setIsDetailOpen(true)} className="ml-auto">Detaylar</Button>
            </div>
          </CardContent>
        </Card>
        
        {/* Top Right */}
        <Card className="col-span-1 lg:col-span-3 glass-card">
            <CardHeader><CardTitle>Aylık Maliyet Trendi</CardTitle></CardHeader>
            <CardContent className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyChartData}>
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${CURRENCY_SYMBOLS[currency]}${Number(value).toLocaleString('tr-TR')}`} />
                    <Tooltip contentStyle={{backgroundColor: 'hsl(var(--background)/0.8)', border: '1px solid hsl(var(--border))'}} />
                    <Line type="monotone" dataKey="cost" stroke="hsl(var(--primary))" strokeWidth={2} dot={{r:4}} activeDot={{r:6}} />
                    </LineChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
        
        {/* Middle Left */}
        <Card className="col-span-1 lg:col-span-2 glass-card">
            <CardHeader><CardTitle>Marka Bazlı Maliyet Dağılımı</CardTitle></CardHeader>
            <CardContent className="h-[250px]">
                 <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                    <Pie data={brandPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                        {brandPieData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value) => `${CURRENCY_SYMBOLS[currency]}${Number(value).toLocaleString('tr-TR', {minimumFractionDigits: 2})}`} />
                    <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
        
        {/* Middle Right */}
        <Card className="col-span-1 lg:col-span-3 glass-card">
            <CardHeader><CardTitle>Laboratuvar Günlük Tüketim Maliyetleri (Dün)</CardTitle></CardHeader>
            <CardContent>
                <ScrollArea className="h-[250px]">
                    <ul className="space-y-2 pr-4">
                        {labDailyCosts.length > 0 ? labDailyCosts.map(lab => (
                            <li key={lab.name} className="flex justify-between items-center text-sm p-2 rounded-md bg-muted/30">
                                <span className="font-medium">{lab.name}</span>
                                <span className="font-semibold">{CURRENCY_SYMBOLS[currency]} {lab.cost.toLocaleString('tr-TR', {minimumFractionDigits: 2})}</span>
                            </li>
                        )) : <p className="text-muted-foreground text-center pt-8">Dün için tüketim verisi bulunamadı.</p>}
                    </ul>
                </ScrollArea>
            </CardContent>
        </Card>
        
        {/* Bottom */}
        <div className="col-span-1 lg:col-span-5 glass-card p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quarterlyData.map((val, i) => (
                <Card key={i} className="text-center bg-background/50">
                    <CardHeader className="pb-2"><CardTitle>Çeyrek {i + 1}</CardTitle></CardHeader>
                    <CardContent className="text-2xl font-bold text-primary">
                        {CURRENCY_SYMBOLS[currency]} {val.toLocaleString('tr-TR', {minimumFractionDigits: 2})}
                    </CardContent>
                </Card>
            ))}
            </div>
        </div>
      </div>

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Ürün Bazlı Maliyet Dağılımı</DialogTitle></DialogHeader>
          <ScrollArea className="h-[400px] mt-4 border rounded-md">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Ürün</TableHead>
                        <TableHead className="text-right">Maliyet</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {totalCosts.byProduct.filter(p => p.cost > 0).sort((a,b) => b.cost - a.cost).map(p => (
                        <TableRow key={p.code}>
                            <TableCell className="font-medium">{p.name}</TableCell>
                            <TableCell className="text-right font-mono">{CURRENCY_SYMBOLS[currency]} {p.cost.toLocaleString('tr-TR', {minimumFractionDigits: 2})}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
