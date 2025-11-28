
'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { getDocs, collection, query, where, Timestamp } from 'firebase/firestore';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import type { Depot, Hospital, ProductCode, MinMaxRule } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProductOption {
  id: string;
  stokKodu: string;
  stokAdi: string;
}
interface MinMaxRecord {
  timestamp: Date;
  min: number | null;
  max: number | null;
  locationName: string; 
}
interface ChartDataPoint {
  time: number; 
  [key: string]: any; 
}

interface MultiSelectPopoverProps {
  label: string;
  options: { id: string, name: string }[];
  selected: string[];
  onSelectedChange: (selected: string[]) => void;
}

const MultiSelectPopover: React.FC<MultiSelectPopoverProps> = ({ label, options, selected, onSelectedChange }) => {
  const [open, setOpen] = useState(false);
  const selectedNames = options.filter(opt => selected.includes(opt.id)).map(opt => opt.name).join(', ');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          <span className="truncate">{selectedNames || `Select ${label}...`}</span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder={`Search ${label}...`} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  key={option.id}
                  onSelect={() => {
                    const newSelection = selected.includes(option.id)
                      ? selected.filter(id => id !== option.id)
                      : [...selected, option.id];
                    onSelectedChange(newSelection);
                  }}
                  className="cursor-pointer"
                >
                  <Checkbox checked={selected.includes(option.id)} className="mr-2" />
                  {option.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default function MinMaxUrunGrafikPanel() {
  const { toast } = useToast();
  
  const [loading, setLoading] = useState({ filters: true, products: true, chart: false });

  const [brands, setBrands] = useState<string[]>([]);
  const [depots, setDepots] = useState<{ id: string; name: string }[]>([]);
  const [labs, setLabs] = useState<{ id: string; name: string }[]>([]);
  const [allProducts, setAllProducts] = useState<ProductCode[]>([]);

  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [selectedDepots, setSelectedDepots] = useState<string[]>([]);
  const [selectedLabs, setSelectedLabs] = useState<string[]>([]);
  
  const [availableProducts, setAvailableProducts] = useState<ProductOption[]>([]);
  const [productSearch, setProductSearch] = useState<string>('');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);

  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(prev => ({ ...prev, filters: true }));
      try {
        const [prodSnap, depSnap, labSnap] = await Promise.all([
            getDocs(collection(db, 'productCodes')),
            getDocs(collection(db, 'depots')),
            getDocs(collection(db, 'hospitals'))
        ]);
        const productsData = prodSnap.docs.map(d => d.data() as ProductCode);
        setAllProducts(productsData);
        setBrands(Array.from(new Set(productsData.map(p => p.marka).filter(Boolean) as string[])));
        setDepots(depSnap.docs.map(d => ({ id: d.id, name: (d.data() as Depot).name })));
        setLabs(labSnap.docs.map(d => ({ id: d.id, name: (d.data() as Hospital).name })));
      } catch (e: any) {
        toast({ title: 'Hata', description: 'Filtre verileri yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(prev => ({ ...prev, filters: false }));
      }
    })();
  }, [toast]);

  useEffect(() => {
    if (!selectedBrand) {
      setAvailableProducts([]);
      return;
    }
    setLoading(p => ({...p, products: true}));
    const productsOfBrand = allProducts.filter(p => p.marka === selectedBrand);
    setAvailableProducts(productsOfBrand.map(p => ({ id: p.id, stokKodu: p.stokKodu, stokAdi: p.stokAdi })));
    setSelectedProducts([]);
    setLoading(p => ({...p, products: false}));
  }, [selectedBrand, allProducts]);

  useEffect(() => {
    const combinedLocations = [...selectedDepots, ...selectedLabs];
    if (selectedProducts.length === 0 || combinedLocations.length === 0) {
      setChartData([]);
      return;
    }
    (async () => {
        setLoading(prev => ({ ...prev, chart: true }));
        try {
            const allRecords: { productCode: string; record: MinMaxRecord }[] = [];
            const productChunks: string[][] = [];
            for (let i = 0; i < selectedProducts.length; i += 10) {
                productChunks.push(selectedProducts.slice(i, i + 10));
            }

            for (const productChunk of productChunks) {
                const histQuery = query(
                    collection(db, 'minMaxHistory'),
                    where('stokKodu', 'in', productChunk),
                    where('locationId', 'in', combinedLocations)
                );
                const snap = await getDocs(histQuery);
                snap.forEach(doc => {
                    const d = doc.data();
                    const location = d.locationType === 'depot' ? depots.find(dep => dep.id === d.locationId) : labs.find(l => l.id === d.locationId);
                    allRecords.push({
                        productCode: d.stokKodu,
                        record: {
                            timestamp: (d.timestamp as Timestamp).toDate(),
                            min: d.min,
                            max: d.max,
                            locationName: location?.name || d.locationId
                        }
                    });
                });
            }
            
            const points = allRecords.map(({ productCode, record }) => ({
                time: record.timestamp.getTime(),
                [`${productCode}_min`]: record.min,
                [`${productCode}_max`]: record.max,
            })).sort((a, b) => a.time - b.time);
            
            setChartData(points);

        } catch (e: any) {
            console.error(e);
            toast({ title: 'Hata', description: 'Grafik verileri yüklenemedi. Firestore `in` sorgusu 10 elemanla sınırlıdır.', variant: 'destructive' });
        } finally {
             setLoading(prev => ({ ...prev, chart: false }));
        }
    })();
  }, [selectedProducts, selectedDepots, selectedLabs, toast, depots, labs]);
  
  const visibleProducts = useMemo(() => {
      if (!productSearch) return availableProducts;
      const lowercasedFilter = productSearch.toLowerCase();
      return availableProducts.filter(p => 
          p.stokAdi.toLowerCase().includes(lowercasedFilter) || 
          p.stokKodu.toLowerCase().includes(lowercasedFilter)
      );
  }, [productSearch, availableProducts]);

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl font-headline">Min-Max Ürün Grafiği</CardTitle>
        <CardDescription>
          Filtreleri seçerek, ürünlerin zaman içindeki min/max stok seviyelerindeki değişimlerini görüntüleyin.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg bg-muted/50">
          <div>
            <label className="font-medium text-sm mb-1 block">Marka</label>
            <Select value={selectedBrand} onValueChange={setSelectedBrand} disabled={loading.filters}>
              <SelectTrigger><SelectValue placeholder="Marka seçin..." /></SelectTrigger>
              <SelectContent>{brands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="font-medium text-sm mb-1 block">Laboratuvarlar</label>
            <MultiSelectPopover label="Labs" options={labs} selected={selectedLabs} onSelectedChange={setSelectedLabs} />
          </div>
          <div>
            <label className="font-medium text-sm mb-1 block">Depolar</label>
            <MultiSelectPopover label="Depots" options={depots} selected={selectedDepots} onSelectedChange={setSelectedDepots} />
          </div>
        </div>

        {selectedBrand && (
        <>
          <div>
            <label className="font-medium text-sm mb-1 block">Ürün Ara / Seç</label>
             <Input
              placeholder="Ürün ara..."
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              className="mb-2"
            />
            <ScrollArea className="h-40 w-full rounded-md border p-2">
              {loading.products ? <div className="flex justify-center p-4"><Loader2 className="animate-spin h-6 w-6"/></div> :
              <div className="space-y-1">
                {visibleProducts.length === 0 ? <p className="text-sm text-muted-foreground p-2">Bu filtrelerle eşleşen ürün bulunamadı.</p> :
                 visibleProducts.map(p => (
                  <label key={p.id} className="flex items-center space-x-2 cursor-pointer p-1 rounded hover:bg-muted">
                    <Checkbox
                      checked={selectedProducts.includes(p.stokKodu)}
                      onCheckedChange={checked => {
                        setSelectedProducts(prev =>
                          checked ? [...prev, p.stokKodu] : prev.filter(code => code !== p.stokKodu)
                        );
                      }}
                    />
                    <span className="text-sm">{p.stokAdi} ({p.stokKodu})</span>
                  </label>
                ))}
              </div>}
            </ScrollArea>
          </div>

          <Card className="h-96 w-full p-4">
            {loading.chart ? (
                 <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>
            ) : chartData.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">Grafik için ürün ve konum seçin veya seçili kombinasyon için geçmiş veri bulunamadı.</div>
            ) : (
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    type="number" 
                    domain={['dataMin', 'dataMax']} 
                    tickFormatter={(ts) => format(new Date(ts), 'dd MMM yy HH:mm')}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tickCount={6}
                  />
                  <YAxis />
                  <Tooltip labelFormatter={(ts) => format(new Date(ts), 'dd MMM yyyy HH:mm')}/>
                  <Legend />
                  {selectedProducts.map((code, index) => {
                    const productName = availableProducts.find(p => p.stokKodu === code)?.stokAdi || code;
                    return (
                        <React.Fragment key={code}>
                            <Line connectNulls type="monotone" dataKey={`${code}_min`} name={`${productName} Min`} stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                            <Line connectNulls type="monotone" dataKey={`${code}_max`} name={`${productName} Max`} stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                        </React.Fragment>
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        </>
        )}
      </CardContent>
    </Card>
  );
}
