'use client';
import React, { ChangeEvent, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookText, Download, Loader2, Upload } from 'lucide-react';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import DefinitionManager from './DefinitionManager';
import DeviceGroupManager from './DeviceGroupManager';
import BrandManager from './BrandManager';

type DefinitionType =
  | 'def_brands'
  | 'def_labGroups'
  | 'def_testGroups'
  | 'def_deviceGroups'
  | 'def_productGroups'
  | 'def_mainUnits';

type DefinitionConfig = {
  type: DefinitionType;
  title: string;
  placeholder: string;
  excelHeader: string;
  isDeviceGroup?: boolean;
};

const DEFINITION_CONFIG: DefinitionConfig[] = [
  { type: 'def_brands', title: 'Markalar', placeholder: 'Yeni marka adı...', excelHeader: 'Markalar' },
  { type: 'def_labGroups', title: 'Laboratuvar Grupları', placeholder: 'Yeni laboratuvar grubu...', excelHeader: 'Laboratuvar Grupları' },
  { type: 'def_testGroups', title: 'Test Grupları', placeholder: 'Yeni test grubu...', excelHeader: 'Test Grupları' },
  { type: 'def_deviceGroups', title: 'Cihaz Grupları', placeholder: 'Yeni cihaz grubu...', excelHeader: 'Cihaz Grupları', isDeviceGroup: true },
  { type: 'def_productGroups', title: 'Ürün Grupları', placeholder: 'Yeni ürün grubu...', excelHeader: 'Ürün Grupları' },
  { type: 'def_mainUnits', title: 'Ana Birimler', placeholder: 'Yeni ana birim...', excelHeader: 'Ana Birimler' },
];

const normalizeHeader = (value: string) => value
  .trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/[çğıöşü]/g, character => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[character] || character)
  .replace(/[^a-z0-9]/g, '');

export default function UrunKodlariTanimlarPanel() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleDownloadTemplate = () => {
    const worksheet = XLSX.utils.json_to_sheet([
      Object.fromEntries(DEFINITION_CONFIG.map(config => [config.excelHeader, ''])),
    ]);
    worksheet['!cols'] = DEFINITION_CONFIG.map(() => ({ wch: 24 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tanımlar');
    XLSX.writeFile(workbook, 'Urun_Tanimlari_Sablonu.xlsx');
  };

  const handleExcelImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error('Excel dosyasında okunabilir sayfa bulunamadı.');

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });
      const valuesByType = new Map<DefinitionType, Set<string>>(
        DEFINITION_CONFIG.map(config => [config.type, new Set<string>()])
      );
      const configByHeader = new Map(DEFINITION_CONFIG.map(config => [normalizeHeader(config.excelHeader), config]));

      rows.forEach(row => {
        Object.entries(row).forEach(([header, rawValue]) => {
          const config = configByHeader.get(normalizeHeader(header));
          const name = String(rawValue ?? '').trim();
          if (config && name) valuesByType.get(config.type)?.add(name);
        });
      });

      const requestedCount = Array.from(valuesByType.values()).reduce((sum, names) => sum + names.size, 0);
      if (requestedCount === 0) {
        throw new Error('Şablondaki tanım sütunlarında aktarılacak veri bulunamadı.');
      }

      const existingByType = new Map<DefinitionType, Set<string>>();
      await Promise.all(DEFINITION_CONFIG.map(async config => {
        const snapshot = await getDocs(collection(db, config.type));
        existingByType.set(
          config.type,
          new Set(snapshot.docs.map(item => String(item.data().name || '').trim().toLocaleLowerCase('tr-TR')).filter(Boolean))
        );
      }));

      const additions: Array<{ type: DefinitionType; name: string }> = [];
      valuesByType.forEach((names, type) => {
        const existingNames = existingByType.get(type) || new Set<string>();
        names.forEach(name => {
          const normalizedName = name.toLocaleLowerCase('tr-TR');
          if (!existingNames.has(normalizedName)) {
            additions.push({ type, name });
            existingNames.add(normalizedName);
          }
        });
      });

      for (let start = 0; start < additions.length; start += 450) {
        const batch = writeBatch(db);
        additions.slice(start, start + 450).forEach(({ type, name }) => {
          batch.set(doc(collection(db, type)), { name });
        });
        await batch.commit();
      }

      setRefreshKey(value => value + 1);
      toast({
        title: 'Excel aktarımı tamamlandı',
        description: `${additions.length} ortak tanım eklendi, ${requestedCount - additions.length} mevcut tanım atlandı.`,
      });
    } catch (error) {
      toast({
        title: 'Excel aktarımı başarısız',
        description: error instanceof Error ? error.message : 'Dosya işlenirken beklenmeyen bir hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleExcelImport}
      />
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <BookText className="h-6 w-6 text-primary" />
              Ürün Tanımlamaları
            </CardTitle>
            <CardDescription>
              Bu tanımlar firmadan bağımsızdır ve tüm firmalarda ortak kullanılır. Tek tek ekleyebilir veya Excel ile toplu aktarabilirsiniz.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handleDownloadTemplate} disabled={isImporting}>
              <Download className="mr-2 h-4 w-4" />
              Excel Şablonu
            </Button>
            <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
              {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Excel'den Aktar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Aynı tanım (büyük/küçük harf farkı gözetilmeden) yeniden eklenmez. Cihaz grubu görselleri ve ana birim 3D modelleri aktarım sonrasında ayrıca düzenlenebilir.
          </p>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {DEFINITION_CONFIG.map(({ type, title, placeholder, isDeviceGroup }) => (
          isDeviceGroup ? (
            <DeviceGroupManager key={`${type}-${refreshKey}`} refreshKey={refreshKey} />
          ) : type === 'def_brands' ? (
            <BrandManager key={`${type}-${refreshKey}`} refreshKey={refreshKey} />
          ) : (
            <DefinitionManager key={`${type}-${refreshKey}`} type={type} title={title} placeholder={placeholder} refreshKey={refreshKey} />
          )
        ))}
      </div>
    </div>
  );
}
