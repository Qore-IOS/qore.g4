
'use client';
import React, { useState, useEffect, ChangeEvent } from 'react';
import type { Depot, Hospital, ProductCode, MinMaxRule } from '@/lib/types';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, writeBatch, deleteDoc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Upload, Download, Loader2, Save, Trash2, SlidersHorizontal } from 'lucide-react';
import { exportDataToExcel, readExcelData } from '@/lib/utils';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface MinMaxSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  target: Depot | Hospital;
  targetType: 'depot' | 'hospital' | 'laboratory';
  productCodes: ProductCode[];
  toast: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void;
}

interface RuleState {
  [stockCode: string]: {
    min: number | string;
    max: number | string;
    maxGun?: number | string;
    aylikTuketimLimiti?: number | string;
    enabled: boolean;
  }
}

export default function MinMaxSettingsPanel({ isOpen, onClose, target, targetType, productCodes, toast }: MinMaxSettingsPanelProps) {
  const [rules, setRules] = useState<RuleState>({});
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSearch, setSelectedSearch] = useState('');
  const [unselectedSearch, setUnselectedSearch] = useState('');
  
  const collectionName = targetType === 'depot' ? 'depots' : 'hospitals';

  useEffect(() => {
    if (!target || !target.id) return;
    const fetchRules = async () => {
      setIsLoading(true);
      const fetchedRules: RuleState = {};
      try {
        const rulesRef = collection(db, collectionName, target.id!, "minMaxRules");
        const snapshot = await getDocs(rulesRef);
        snapshot.forEach(doc => {
          const data = doc.data() as MinMaxRule;
          if (data.stokKodu) {
            fetchedRules[data.stokKodu] = {
              min: data.min ?? 0,
              max: data.max ?? 0,
              maxGun: (data.maxGun ?? '') as string | number,
              aylikTuketimLimiti: (data.aylikTuketimLimiti ?? '') as string | number,
              enabled: true
            };
          }
        });
        setRules(fetchedRules);
      } catch (error) {
        console.error(`Error fetching min-max rules for ${targetType}:`, error);
        toast({ title: "Hata", description: "Min-Max kuralları yüklenirken bir sorun oluştu.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    };
    fetchRules();
  }, [target, toast, targetType, collectionName]);
  
  const handleCheckboxChange = (stockCode: string, checked: boolean | string) => {
    setRules(prev => {
        const newRules = { ...prev };
        if (checked) {
            newRules[stockCode] = { ...(newRules[stockCode] || { min: '', max: '', maxGun: '', aylikTuketimLimiti: '' }), enabled: true };
        } else {
            if(newRules[stockCode]) {
              newRules[stockCode].enabled = false;
            } else {
              newRules[stockCode] = { min: '', max: '', maxGun: '', aylikTuketimLimiti: '', enabled: false };
            }
        }
        return newRules;
    });
  };
  
  const handleRuleChange = (stockCode: string, field: 'min' | 'max' | 'maxGun' | 'aylikTuketimLimiti', value: string) => {
    const numValue = value === '' ? '' : Number(value);
    setRules(prev => ({
        ...prev,
        [stockCode]: { ...(prev[stockCode] ?? { min: '', max: '', maxGun: '', aylikTuketimLimiti: '', enabled: true }), [field]: numValue }
    }));
  };

  const handleExcelUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    try {
      const jsonData = await readExcelData(file, toast);
      const newRules: RuleState = {};
      let validRows = 0;
      jsonData.forEach((row: any) => {
        const stock_code = String(row['stock_code'] || row['Stok Kodu'] || '').trim();
        const min = Number(row['min']);
        const max = Number(row['max']);
        const maxGun = Number(row['max_gun'] || row['Max Gün']);
        const aylikTuketimLimiti = Number(row['aylik_tuketim_limiti'] || row['Aylık Tüketim Limiti']);
        if (productCodes.some(p => p.stokKodu === stock_code) && !isNaN(min) && !isNaN(max) && min >= 0 && max >= min) {
          newRules[stock_code] = { min, max, maxGun: isNaN(maxGun) ? '' : maxGun, aylikTuketimLimiti: isNaN(aylikTuketimLimiti) ? '' : aylikTuketimLimiti, enabled: true };
          validRows++;
        }
      });
      setRules(prev => ({...prev, ...newRules}));
      toast({ title: "Başarılı", description: `${validRows} kural Excel'den yüklendi ve mevcut kurallarla birleştirildi.` });
    } catch (error) {
      toast({ title: "Excel Hatası", description: "Excel dosyası işlenirken bir sorun oluştu.", variant: "destructive" });
    } finally {
      setIsLoading(false);
      if(event.target) event.target.value = '';
    }
  };

  const downloadTemplate = () => {
    exportDataToExcel([{ 'Stok Kodu': '', min: 0, max: 0, 'Max Gün': '', 'Aylık Tüketim Limiti': 0 }], 'MinMax_Sablonu', 'Kurallar', toast);
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
      'Aylık Tüketim Limiti': rule.aylikTuketimLimiti
    }));

    exportDataToExcel(dataToExport, `${target.name}_Mevcut_MinMax_Kurallari`, 'Kurallar', toast);
  };


  const handleSaveRules = async () => {
    setIsLoading(true);
    const batch = writeBatch(db);
    let hasError = false;

    const rulesCollectionRef = collection(db, collectionName, target.id!, "minMaxRules");
    const existingRulesSnapshot = await getDocs(rulesCollectionRef);
    const existingRuleIds = new Set(existingRulesSnapshot.docs.map(doc => doc.id));

    const historyWrites: Promise<any>[] = [];

    for (const stockCode in rules) {
      const rule = rules[stockCode];
      const ruleRef = doc(db, collectionName, target.id!, "minMaxRules", stockCode);

      if (rule.enabled) {
        const min = Number(rule.min);
        const max = Number(rule.max);
        const maxGun = rule.maxGun === '' ? undefined : Number(rule.maxGun);
        const aylikTuketimLimiti = rule.aylikTuketimLimiti === '' ? undefined : Number(rule.aylikTuketimLimiti);

        if (isNaN(min) || isNaN(max) || min < 0 || max < min || (maxGun !== undefined && (isNaN(maxGun) || maxGun < 0)) || (aylikTuketimLimiti !== undefined && isNaN(aylikTuketimLimiti))) {
          toast({ title: `Hata: ${stockCode}`, description: `Geçersiz değerler. Kayıt atlandı.`, variant: "destructive" });
          hasError = true;
          continue; 
        }
        
        const dataToSet: MinMaxRule = { stokKodu: stockCode, min, max };
        if (maxGun !== undefined) {
          dataToSet.maxGun = maxGun;
        }
        if (aylikTuketimLimiti !== undefined) {
          dataToSet.aylikTuketimLimiti = aylikTuketimLimiti;
        }

        batch.set(ruleRef, dataToSet);
        
        historyWrites.push(addDoc(collection(db, 'minMaxHistory'), {
          ...dataToSet,
          locationId: target.id,
          locationType: targetType,
          timestamp: serverTimestamp(),
        }));
      } else {
        if (existingRuleIds.has(stockCode)) {
            batch.delete(ruleRef);
            historyWrites.push(addDoc(collection(db, 'minMaxHistory'), {
                stokKodu: stockCode,
                min: null,
                max: null,
                maxGun: null,
                aylikTuketimLimiti: null,
                locationId: target.id,
                locationType: targetType,
                timestamp: serverTimestamp(),
                action: 'deleted',
            }));
        }
      }
    }

    if (hasError) {
        setIsLoading(false);
        toast({ title: "İşlem Durduruldu", description: "Lütfen hatalı girişleri düzeltip tekrar deneyin.", variant: "destructive" });
        return;
    }

    try {
      await batch.commit();
      await Promise.all(historyWrites);
      toast({ title: "Başarılı", description: `${target.name} için min-max kuralları kaydedildi.` });
      onClose();
    } catch (error) {
      console.error("Error saving rules:", error);
      toast({ title: "Veritabanı Hatası", description: "Kurallar kaydedilirken bir sorun oluştu.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const matchesSearch = (product: ProductCode, searchTerm: string) => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return true;

    return (
      (product.stokAdi ?? '').toLowerCase().includes(keyword)
      || (product.stokKodu ?? '').toLowerCase().includes(keyword)
    );
  };

  const selectedProducts = productCodes.filter(product => {
    const stockCode = product.stokKodu ?? '';
    return Boolean(rules[stockCode]?.enabled) && matchesSearch(product, selectedSearch);
  });

  const unselectedProducts = productCodes.filter(product => {
    const stockCode = product.stokKodu ?? '';
    return !rules[stockCode]?.enabled && matchesSearch(product, unselectedSearch);
  });
  
  const handleResetRules = async () => {
    setIsLoading(true);
    try {
        const rulesRef = collection(db, collectionName, target.id!, "minMaxRules");
        const snapshot = await getDocs(rulesRef);
        if(snapshot.empty) {
            toast({ title: "Bilgi", description: `Bu ${targetType === 'depot' ? 'depo' : 'hastane'} için zaten tanımlı kural bulunmuyor.`, variant: "default" });
            setIsLoading(false);
            return;
        }

        const batch = writeBatch(db);
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        setRules({});
        toast({ title: "Başarılı", description: `${target.name} için tüm min-max kuralları sıfırlandı.`});
    } catch (error) {
        console.error("Error resetting rules:", error);
        toast({ title: "Hata", description: "Kurallar sıfırlanırken bir hata oluştu.", variant: "destructive" });
    } finally {
        setIsLoading(false);
    }
  };


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center">
            <SlidersHorizontal className="mr-2 h-6 w-6" /> Min-Max Stok Seviyeleri: {target.name}
          </DialogTitle>
          <DialogDescription>
            Bu {targetType === 'depot' ? 'depoda' : 'hastanede'} işlem görebilecek ürünleri ve bu ürünler için stok seviyelerini belirleyin.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-grow flex flex-col gap-4 overflow-hidden">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Toplu İşlemler</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button onClick={downloadTemplate} variant="outline" size="sm" disabled={isLoading}><Download className="mr-2 h-4 w-4"/>Şablon</Button>
              <Button onClick={handleExportCurrentRules} variant="outline" size="sm" disabled={isLoading}><Download className="mr-2 h-4 w-4"/>Mevcut Kuralları İndir</Button>
              <Button asChild variant="outline" size="sm" disabled={isLoading}><label htmlFor="minmax-excel-upload" className="cursor-pointer flex items-center"><Upload className="mr-2 h-4 w-4"/>Yükle<input id="minmax-excel-upload" type="file" accept=".xlsx, .xls" className="hidden" onChange={handleExcelUpload} /></label></Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={isLoading}><Trash2 className="mr-2 h-4 w-4"/>Tüm Kuralları Sıfırla</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Bu işlem geri alınamaz. {target.name} için tanımlanmış tüm min-max kuralları kalıcı olarak silinecektir.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction onClick={handleResetRules} className='bg-destructive hover:bg-destructive/90'>Onayla ve Sıfırla</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          <div className="flex-grow grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
            <div className="border rounded-md overflow-hidden flex flex-col min-h-0">
              <div className="p-3 border-b space-y-2">
                <p className="font-medium text-sm">Seçilen Ürünler ({selectedProducts.length})</p>
                <Input
                  placeholder="Seçilenlerde ürün ara..."
                  value={selectedSearch}
                  onChange={(e) => setSelectedSearch(e.target.value)}
                  className="h-8"
                />
              </div>
              <ScrollArea className="flex-1">
                {isLoading && !Object.keys(rules).length ? <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin"/></div> :
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Aktif</TableHead>
                      <TableHead>Ürün Adı (Stok Kodu)</TableHead>
                      <TableHead className="w-24">Min</TableHead>
                      <TableHead className="w-24">Max</TableHead>
                      <TableHead className="w-24">Max Gün</TableHead>
                      <TableHead className="w-32">Aylık Max Tüketim</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedProducts.map(product => {
                      const rule = rules[product.stokKodu!];
                      const isEnabled = rule?.enabled ?? false;
                      return (
                        <TableRow key={product.id}>
                          <TableCell>
                            <Checkbox
                              checked={isEnabled}
                              onCheckedChange={(checked) => handleCheckboxChange(product.stokKodu!, checked)}
                            />
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">{product.stokAdi}</p>
                            <p className="text-xs text-muted-foreground font-code">{product.stokKodu}</p>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={isEnabled ? (rule?.min ?? '') : ''}
                              onChange={e => handleRuleChange(product.stokKodu!, 'min', e.target.value)}
                              disabled={!isEnabled}
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={isEnabled ? (rule?.max ?? '') : ''}
                              onChange={e => handleRuleChange(product.stokKodu!, 'max', e.target.value)}
                              disabled={!isEnabled}
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={isEnabled ? (rule?.maxGun ?? '') : ''}
                              onChange={e => handleRuleChange(product.stokKodu!, 'maxGun', e.target.value)}
                              disabled={!isEnabled}
                              className="h-8"
                              placeholder="Boş bırak"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={isEnabled ? (rule?.aylikTuketimLimiti ?? '') : ''}
                              onChange={e => handleRuleChange(product.stokKodu!, 'aylikTuketimLimiti', e.target.value)}
                              disabled={!isEnabled || targetType === 'depot'}
                              className="h-8"
                              placeholder={targetType === 'depot' ? 'N/A' : 'Limit'}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {selectedProducts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                          Seçilen ürün bulunamadı.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>}
              </ScrollArea>
            </div>

            <div className="border rounded-md overflow-hidden flex flex-col min-h-0">
              <div className="p-3 border-b space-y-2">
                <p className="font-medium text-sm">Seçilmeyen Ürünler ({unselectedProducts.length})</p>
                <Input
                  placeholder="Seçilmeyenlerde ürün ara..."
                  value={unselectedSearch}
                  onChange={(e) => setUnselectedSearch(e.target.value)}
                  className="h-8"
                />
              </div>
              <ScrollArea className="flex-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Aktif</TableHead>
                      <TableHead>Ürün Adı (Stok Kodu)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unselectedProducts.map(product => (
                      <TableRow key={product.id}>
                        <TableCell>
                          <Checkbox
                            checked={false}
                            onCheckedChange={(checked) => handleCheckboxChange(product.stokKodu!, checked)}
                          />
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{product.stokAdi}</p>
                          <p className="text-xs text-muted-foreground font-code">{product.stokKodu}</p>
                        </TableCell>
                      </TableRow>
                    ))}
                    {unselectedProducts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={2} className="text-center text-muted-foreground py-6">
                          Seçilmeyen ürün bulunamadı.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </div>
        </div>

        <DialogFooter className="pt-4 border-t">
          <DialogClose asChild><Button variant="outline" disabled={isLoading}>İptal</Button></DialogClose>
          <Button onClick={handleSaveRules} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
            <Save className="mr-2 h-4 w-4"/> Kuralları Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
