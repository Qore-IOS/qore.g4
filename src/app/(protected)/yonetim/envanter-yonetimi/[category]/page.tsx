
'use client';
import React, { useState, useEffect, useCallback, useMemo, ChangeEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, Loader2, Filter, Search, Eye, Pencil } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, addDoc, deleteDoc, doc, query, where, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import BackButton from '@/components/BackButton';
import type { Hospital, Depot, Asset } from '@/lib/types';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';


type FilterableColumn = keyof Omit<Asset, 'id' | 'aciklama'>;

const FilterPopover: React.FC<{
  column: FilterableColumn;
  title: string;
  options: string[];
  selectedValues: Set<string>;
  onSelectionChange: (column: FilterableColumn, newSelection: Set<string>) => void;
}> = ({ column, title, options, selectedValues, onSelectionChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isAllSelected = options.length > 0 && selectedValues.size === options.length;

  const handleSelectAll = () => {
    if (isAllSelected) {
      onSelectionChange(column, new Set());
    } else {
      onSelectionChange(column, new Set(options));
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 -ml-3">
          {title}
          <Filter className="ml-2 h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Ara..." />
          <CommandList>
            <CommandEmpty>Sonuç bulunamadı.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={handleSelectAll} className="cursor-pointer">
                <Checkbox checked={isAllSelected} className="mr-2" />
                Tümünü Seç
              </CommandItem>
              {options.map(option => (
                <CommandItem
                  key={option}
                  onSelect={() => {
                    const newSelection = new Set(selectedValues);
                    if (newSelection.has(option)) {
                      newSelection.delete(option);
                    } else {
                      newSelection.add(option);
                    }
                    onSelectionChange(column, newSelection);
                  }}
                  className="cursor-pointer"
                >
                  <Checkbox checked={selectedValues.has(option)} className="mr-2" />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default function AssetCategoryPage() {
  const params = useParams();
  const router = useRouter();
  const categoryName = decodeURIComponent(Array.isArray(params.category) ? params.category[0] : params.category || '');
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [locations, setLocations] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Partial<Asset>>({});
  const [manualLocation, setManualLocation] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');

  const [filters, setFilters] = useState<Record<FilterableColumn, Set<string>>>({
      demirbasNo: new Set(),
      urunKodu: new Set(),
      urunAdi: new Set(),
      marka: new Set(),
      model: new Set(),
      seriNumarasi: new Set(),
      durum: new Set(),
      konum: new Set(),
      teslimEdilenPersonel: new Set(),
      manuelKonum: new Set(),
      category: new Set(),
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch locations (labs and depots)
      const [labsSnap, depotsSnap] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'depots')),
      ]);
      const labLocations = filterByCompanyScope(
        labsSnap.docs.map(doc => ({ value: (doc.data() as Hospital).name, label: `Lab: ${(doc.data() as Hospital).name}`, companyId: (doc.data() as any).companyId })),
        currentCompanyId,
        isSuperAdmin
      ).map(({ value, label }) => ({ value, label }));
      const depotLocations = filterByCompanyScope(
        depotsSnap.docs.map(doc => ({ value: (doc.data() as Depot).name, label: `Depo: ${(doc.data() as Depot).name}`, companyId: (doc.data() as any).companyId })),
        currentCompanyId,
        isSuperAdmin
      ).map(({ value, label }) => ({ value, label }));
      setLocations([...labLocations, ...depotLocations, { value: 'Diğer', label: 'Diğer (Manuel Giriş)' }].sort((a,b) => a.label.localeCompare(b.label)));

      // Fetch assets for the current category
      const assetsSnap = await getDocs(query(collection(db, 'assets'), where('category', '==', categoryName)));
      setAssets(filterByCompanyScope(
        assetsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Asset)),
        currentCompanyId,
        isSuperAdmin
      ));

    } catch (e) {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [categoryName, toast, currentCompanyId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!editingAsset.demirbasNo) {
      toast({ title: 'Eksik Bilgi', description: 'Demirbaş No alanı zorunludur.', variant: 'destructive' });
      return;
    }
    const finalKonum = editingAsset.konum === 'Diğer' ? manualLocation.trim() : editingAsset.konum;
    if (!finalKonum) {
        toast({ title: 'Eksik Bilgi', description: 'Konum alanı zorunludur.', variant: 'destructive' });
        return;
    }

    setLoading(true);
    
    const dataToSave: Partial<Asset> = {
      ...editingAsset,
      konum: finalKonum,
      category: categoryName,
      manuelKonum: editingAsset.konum === 'Diğer' ? manualLocation.trim() : undefined,
    };
    
    try {
      if (editingAsset.id) {
        await setDoc(doc(db, 'assets', editingAsset.id), withCompanyScope(dataToSave as Record<string, any>, currentCompanyId), { merge: true });
      } else {
        await addDoc(collection(db, 'assets'), withCompanyScope(dataToSave as Record<string, any>, currentCompanyId));
      }
      toast({ title: 'Başarılı', description: 'Envanter kalemi kaydedildi.' });
      setIsModalOpen(false);
      fetchData(); // Refresh list
    } catch(e) {
        toast({ title: 'Hata', description: 'Kayıt sırasında bir hata oluştu.', variant: 'destructive' });
    } finally {
        setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu kaydı silmek istediğinizden emin misiniz?')) {
      setLoading(true);
      try {
        await deleteDoc(doc(db, 'assets', id));
        toast({ title: 'Silindi', description: 'Envanter kaydı silindi.', variant: 'destructive' });
        fetchData(); // Refresh list
      } catch(e) {
          toast({ title: 'Hata', description: 'Silme işlemi başarısız oldu.', variant: 'destructive' });
      } finally {
          setLoading(false);
      }
    }
  };
  
  const handleOpenModal = (asset?: Asset) => {
    setEditingAsset(asset || {});
    const isPredefined = locations.some(l => l.value === asset?.konum);
    if (asset?.konum && !isPredefined) {
      setEditingAsset(prev => ({ ...prev, konum: 'Diğer' }));
      setManualLocation(asset.konum);
    } else {
      setManualLocation('');
    }
    setIsModalOpen(true);
  };

  const handleFilterChange = (column: FilterableColumn, newSelection: Set<string>) => {
    setFilters(prev => ({ ...prev, [column]: newSelection }));
  };

  const uniqueFilterOptions = useMemo(() => {
    const options: Record<FilterableColumn, Set<string>> = {
      demirbasNo: new Set(),
      urunKodu: new Set(),
      urunAdi: new Set(),
      marka: new Set(),
      model: new Set(),
      seriNumarasi: new Set(),
      durum: new Set(),
      konum: new Set(),
      teslimEdilenPersonel: new Set(),
      manuelKonum: new Set(),
      category: new Set(),
    };
    assets.forEach(asset => {
      (Object.keys(options) as FilterableColumn[]).forEach(key => {
        if(asset[key]) options[key].add(asset[key]!);
      });
    });
    return {
      demirbasNo: Array.from(options.demirbasNo).sort(),
      urunKodu: Array.from(options.urunKodu).sort(),
      urunAdi: Array.from(options.urunAdi).sort(),
      marka: Array.from(options.marka).sort(),
      model: Array.from(options.model).sort(),
      seriNumarasi: Array.from(options.seriNumarasi).sort(),
      durum: Array.from(options.durum).sort(),
      konum: Array.from(options.konum).sort(),
      teslimEdilenPersonel: Array.from(options.teslimEdilenPersonel).sort(),
      manuelKonum: Array.from(options.manuelKonum).sort(),
      category: Array.from(options.category).sort(),
    };
  }, [assets]);
  
  const filteredAssets = useMemo(() => {
    const activeFilterKeys = (Object.keys(filters) as FilterableColumn[]).filter(
        key => filters[key].size > 0
    );
    let scopedAssets = assets;
    if (globalSearch.trim()) {
      const q = globalSearch.toLocaleLowerCase('tr').trim();
      scopedAssets = scopedAssets.filter((asset) =>
        `${asset.urunAdi || ''} ${asset.demirbasNo || ''} ${asset.konum || ''} ${asset.category || ''}`.toLocaleLowerCase('tr').includes(q)
      );
    }
    if (activeFilterKeys.length === 0) return scopedAssets;

    return scopedAssets.filter(asset => {
        return activeFilterKeys.every(key => {
            const selectedValues = filters[key];
            const assetValue = asset[key];
            return selectedValues.has(assetValue!);
        });
    });
  }, [assets, filters, globalSearch]);

  const statusStyles: Record<string, string> = {
    iyi: 'bg-emerald-100 text-emerald-700',
    orta: 'bg-amber-100 text-amber-700',
    kötü: 'bg-rose-100 text-rose-700',
    'çok kötü': 'bg-rose-200 text-rose-800',
  };

  const stats = useMemo(() => ({
    total: assets.length,
    assigned: assets.filter(a => Boolean(a.zimmetliKisi || a.teslimEdilenPersonel)).length,
    unassigned: assets.filter(a => !a.zimmetliKisi && !a.teslimEdilenPersonel).length,
    totalCost: assets.reduce((sum, a) => sum + (Number(a.alimFiyatiTl) || 0), 0),
  }), [assets]);

  return (
    <>
      <div className="p-6 lg:p-8 space-y-6 cihaz-shell">
        <div className="flex items-center justify-between">
          <BackButton fallback="/yonetim/envanter-yonetimi" />
          <Button onClick={() => handleOpenModal()} size="sm" disabled={loading} className="bg-[var(--dashboard-accent)] text-white">
            <PlusCircle className="mr-2 h-4 w-4" />
            Yeni Ürün Ekle
          </Button>
        </div>

        <Card className="cihaz-card-strong">
          <CardHeader>
            <CardTitle className="text-2xl font-headline capitalize">{categoryName}</CardTitle>
            <CardDescription>Bu kategoriye ait demirbaş envanteri.</CardDescription>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              <div className="cihaz-card p-3"><p className="text-xs text-muted-foreground">Toplam Ürün</p><p className="text-xl font-semibold">{stats.total}</p></div>
              <div className="cihaz-card p-3"><p className="text-xs text-muted-foreground">Zimmetli</p><p className="text-xl font-semibold text-sky-600">{stats.assigned}</p></div>
              <div className="cihaz-card p-3"><p className="text-xs text-muted-foreground">Boşta</p><p className="text-xl font-semibold text-amber-600">{stats.unassigned}</p></div>
              <div className="cihaz-card p-3"><p className="text-xs text-muted-foreground">Toplam Maliyet</p><p className="text-xl font-semibold">{stats.totalCost.toLocaleString('tr-TR')} ₺</p></div>
            </div>
            <div className="relative max-w-md">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Ürün, konum veya kategori ara..."
                className="max-w-md pl-9 bg-[var(--dashboard-surface-2)]"
              />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : (
              <ScrollArea className="h-[60vh] border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><FilterPopover column="demirbasNo" title="Demirbaş No" options={uniqueFilterOptions.demirbasNo} selectedValues={filters.demirbasNo} onSelectionChange={handleFilterChange} /></TableHead>
                      <TableHead><FilterPopover column="seriNumarasi" title="Seri No" options={uniqueFilterOptions.seriNumarasi} selectedValues={filters.seriNumarasi} onSelectionChange={handleFilterChange} /></TableHead>
                      <TableHead><FilterPopover column="durum" title="Durum" options={uniqueFilterOptions.durum} selectedValues={filters.durum} onSelectionChange={handleFilterChange} /></TableHead>
                      <TableHead><FilterPopover column="marka" title="Marka" options={uniqueFilterOptions.marka} selectedValues={filters.marka} onSelectionChange={handleFilterChange} /></TableHead>
                      <TableHead><FilterPopover column="konum" title="Konum" options={uniqueFilterOptions.konum} selectedValues={filters.konum} onSelectionChange={handleFilterChange} /></TableHead>
                      <TableHead>Personel</TableHead>
                      <TableHead>Alım Fiyatı (TL)</TableHead>
                      <TableHead className="text-right">İşlemler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAssets.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8">Bu kategori için kayıtlı ürün yok veya filtre ile eşleşmiyor.</TableCell></TableRow>
                    ) : (
                      filteredAssets.map(asset => (
                        <TableRow key={asset.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/yonetim/envanter-yonetimi/${categoryName}/${asset.id}`)}>
                          <TableCell className="font-mono text-xs">{asset.demirbasNo}</TableCell>
                          <TableCell className="font-mono text-xs">{asset.seriNumarasi}</TableCell>
                          <TableCell className="capitalize">
                            <Badge className={cn("font-medium", statusStyles[(asset.durum || '').toLowerCase()] || 'bg-slate-100 text-slate-700')}>
                              {asset.durum || '-'}
                            </Badge>
                          </TableCell>
                          <TableCell>{asset.marka}</TableCell>
                          <TableCell>{asset.konum}</TableCell>
                          <TableCell>{asset.zimmetliKisi || asset.teslimEdilenPersonel || '-'}</TableCell>
                          <TableCell>{typeof asset.alimFiyatiTl === 'number' ? asset.alimFiyatiTl.toLocaleString('tr-TR') : '-'}</TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); router.push(`/yonetim/envanter-yonetimi/${categoryName}/${asset.id}`); }} disabled={loading}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleOpenModal(asset); }} disabled={loading}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDelete(asset.id); }} disabled={loading}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingAsset.id ? 'Ürün Düzenle' : `Yeni ${categoryName} Ekle`}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <Input placeholder="Demirbaş No" value={editingAsset.demirbasNo || ''} onChange={e => setEditingAsset({ ...editingAsset, demirbasNo: e.target.value })} />
            <Input placeholder="Ürün Adı" value={editingAsset.urunAdi || ''} onChange={e => setEditingAsset({ ...editingAsset, urunAdi: e.target.value })} />
            <Input placeholder="Ürün Seri Numarası" value={editingAsset.seriNumarasi || ''} onChange={e => setEditingAsset({ ...editingAsset, seriNumarasi: e.target.value })} />
            <Select value={editingAsset.durum || ''} onValueChange={value => setEditingAsset({...editingAsset, durum: value as any})}>
              <SelectTrigger><SelectValue placeholder="Ürün Durumu..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="iyi">İyi</SelectItem>
                <SelectItem value="orta">Orta</SelectItem>
                <SelectItem value="kötü">Kötü</SelectItem>
                <SelectItem value="çok kötü">Çok Kötü</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Marka" value={editingAsset.marka || ''} onChange={e => setEditingAsset({ ...editingAsset, marka: e.target.value })} />
            <Input placeholder="Model" value={editingAsset.model || ''} onChange={e => setEditingAsset({ ...editingAsset, model: e.target.value })} />
            <Select value={editingAsset.konum || ''} onValueChange={value => setEditingAsset({ ...editingAsset, konum: value })}>
              <SelectTrigger><SelectValue placeholder="Konum seçin..." /></SelectTrigger>
              <SelectContent>
                {locations.map(loc => (
                  <SelectItem key={loc.value} value={loc.value}>{loc.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {editingAsset.konum === 'Diğer' && (
              <Input placeholder="Manuel Konum Girin" value={manualLocation} onChange={e => setManualLocation(e.target.value)} />
            )}
            <Input placeholder="Teslim Edilen Personel" value={editingAsset.teslimEdilenPersonel || ''} onChange={e => setEditingAsset({ ...editingAsset, teslimEdilenPersonel: e.target.value })} />
            <Input
              placeholder="Alım Fiyatı (TL)"
              type="number"
              min={0}
              step="0.01"
              value={editingAsset.alimFiyatiTl ?? ''}
              onChange={e => setEditingAsset({ ...editingAsset, alimFiyatiTl: Number(e.target.value) || 0 })}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input type="date" placeholder="Satın Alma Tarihi" value={editingAsset.satinAlmaTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, satinAlmaTarihi: e.target.value })} />
              <Input type="date" placeholder="Garanti Bitiş Tarihi" value={editingAsset.garantiBitisTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, garantiBitisTarihi: e.target.value })} />
              <Input type="number" min={0} placeholder="Planlı Kullanım Ömrü (Yıl)" value={editingAsset.planliKullanimOmruYil ?? ''} onChange={e => setEditingAsset({ ...editingAsset, planliKullanimOmruYil: Number(e.target.value) || 0 })} />
              <Select value={editingAsset.amortismanYontemi || 'dogrusal'} onValueChange={value => setEditingAsset({ ...editingAsset, amortismanYontemi: value as 'dogrusal' | 'azalan_bakiye' })}>
                <SelectTrigger><SelectValue placeholder="Amortisman Yöntemi" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dogrusal">Doğrusal</SelectItem>
                  <SelectItem value="azalan_bakiye">Azalan Bakiye</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" placeholder="Amortisman Başlangıç Tarihi" value={editingAsset.amortismanBaslangicTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, amortismanBaslangicTarihi: e.target.value })} />
              <Input type="date" placeholder="Hurda Tarihi" value={editingAsset.hurdaTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, hurdaTarihi: e.target.value })} />
              <Input type="date" placeholder="İmha Tarihi" value={editingAsset.imhaTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, imhaTarihi: e.target.value })} />
              <Input type="date" placeholder="Satış Tarihi" value={editingAsset.satisTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, satisTarihi: e.target.value })} />
              <Input type="date" placeholder="Son Bakım Tarihi" value={editingAsset.sonBakimTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, sonBakimTarihi: e.target.value })} />
              <Input type="date" placeholder="Sonraki Bakım Tarihi" value={editingAsset.sonrakiBakimTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, sonrakiBakimTarihi: e.target.value })} />
              <Input type="date" placeholder="Son Kalibrasyon Tarihi" value={editingAsset.sonKalibrasyonTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, sonKalibrasyonTarihi: e.target.value })} />
              <Input type="date" placeholder="Sonraki Kalibrasyon Tarihi" value={editingAsset.sonrakiKalibrasyonTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, sonrakiKalibrasyonTarihi: e.target.value })} />
              <Input type="number" min={0} step="0.01" placeholder="Bakım Maliyeti (TL)" value={editingAsset.bakimMaliyetiTl ?? ''} onChange={e => setEditingAsset({ ...editingAsset, bakimMaliyetiTl: Number(e.target.value) || 0 })} />
              <Input placeholder="Zimmetli Kişi" value={editingAsset.zimmetliKisi || ''} onChange={e => setEditingAsset({ ...editingAsset, zimmetliKisi: e.target.value })} />
              <Input type="date" placeholder="Check-Out Tarihi" value={editingAsset.checkOutTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, checkOutTarihi: e.target.value })} />
              <Input type="date" placeholder="Check-In Tarihi" value={editingAsset.checkInTarihi || ''} onChange={e => setEditingAsset({ ...editingAsset, checkInTarihi: e.target.value })} />
              <Input placeholder="Dijital İmza" value={editingAsset.dijitalImza || ''} onChange={e => setEditingAsset({ ...editingAsset, dijitalImza: e.target.value })} />
              <Input placeholder="Zimmet Fiş No" value={editingAsset.zimmetFisNo || ''} onChange={e => setEditingAsset({ ...editingAsset, zimmetFisNo: e.target.value })} />
            </div>
            <Textarea placeholder="Açıklama" value={editingAsset.aciklama || ''} onChange={e => setEditingAsset({ ...editingAsset, aciklama: e.target.value })} />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleSave} disabled={loading}>{loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
