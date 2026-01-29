'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDocs, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { exportAllDataToJSON, exportAllDataToCSV } from '@/lib/utils';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import {
  FileSpreadsheet,
  Files,
  FileJson,
  Loader2,
  CalendarClock,
  Calculator,
  History as HistoryIcon,
  Activity,
  Archive,
  Barcode,
  Trash2,
  Package,
  TrendingUp,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function RaporlamaPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isCumulativeModalOpen, setIsCumulativeModalOpen] = useState(false);
  const [isCihazUstuModalOpen, setIsCihazUstuModalOpen] = useState(false);
  const [isStokIslemleriModalOpen, setIsStokIslemleriModalOpen] = useState(false);

  const handleExport = async (format: 'json' | 'csv') => {
    setIsExporting(true);
    toast({ title: "Dışa Aktarma Başlatıldı", description: "Tüm sistem verileri toplanıyor. Bu işlem biraz zaman alabilir..." });
    try {
      const collectionsToExport = [
        'users', 'hospitals', 'depots', 'borcDepots', 'devices', 
        'hospitalDeviceAssignments', 'productCodes', 'addressDefinitions', 
        'depoStok', 'orders', 'shipments', 'transfers', 
        'tuketimKayitlari', 'efficiencyDataRecords', 
        'depotStockCountSessions', 'laboratoryStockCountSessions', 'kumulatifRaporlar'
      ];
      
      const promises = collectionsToExport.map(c => getDocs(collection(db, c)));
      const snapshots = await Promise.all(promises);

      const data: Record<string, any[]> = {};
      snapshots.forEach((snap, index) => {
        const collName = collectionsToExport[index];
        data[collName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      });


      if (format === 'json') {
        exportAllDataToJSON(data, 'invitrolab_tum_veriler', toast);
      } else {
        exportAllDataToCSV(data, 'invitrolab_tum_veriler', toast);
      }
    } catch (error: any) {
      console.error('Export error:', error);
      toast({ title: 'Hata', description: 'Veriler dışa aktarılırken bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };
  
  const handleCumulativeNavigation = (path: string) => {
    router.push(path);
    setIsCumulativeModalOpen(false);
  };

  const navigateTo = (path: string) => {
    router.push(path);
    setIsCihazUstuModalOpen(false);
  };

  const handleStokIslemleriNavigation = (path: string) => {
    router.push(path);
    setIsStokIslemleriModalOpen(false);
  };

  return (
    <>
      <div className="space-y-6">
        <Card className="shadow-lg">
          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between">
            <div>
              <CardTitle className="text-xl font-headline flex items-center">
                <FileSpreadsheet className="mr-2 h-6 w-6 text-primary" />
                Raporlama ve Veri Yönetimi
              </CardTitle>
              <CardDescription>
                Harici PDF raporlarını yönetin veya özel stok raporlarına ulaşın.
              </CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap mt-4 sm:mt-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/tuketim-istatistikleri')}
              >
                <TrendingUp className="h-4 w-4 mr-2" /> Tüketim İstatistikleri
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCumulativeModalOpen(true)}
              >
                <Archive className="h-4 w-4 mr-2" /> Kümülatif
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCihazUstuModalOpen(true)}
              >
                <Activity className="h-4 w-4 mr-2" /> Cihaz Üstü
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsStokIslemleriModalOpen(true)}
              >
                <Package className="h-4 w-4 mr-2" /> Stok İşlemleri
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/raporlama/seri-no-format')}
              >
                <Barcode className="mr-2 h-4 w-4" />
                Seri No Format Tanımla
              </Button>
            </div>
          </CardHeader>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-headline">Tüm Verileri Dışa Aktar</CardTitle>
            <CardDescription>
              Sistemdeki tüm ana ve işlem verilerini JSON veya çok sayfalı Excel formatında indirin.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <Button onClick={() => handleExport('json')} disabled={isExporting}>
              {isExporting ? <Loader2 className="animate-spin mr-2" /> : <FileJson className="mr-2 h-4 w-4" />}
              JSON Olarak Dışa Aktar
            </Button>
            <Button onClick={() => handleExport('csv')} disabled={isExporting}>
              {isExporting ? <Loader2 className="animate-spin mr-2" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
              Excel Olarak Dışa Aktar
            </Button>
          </CardContent>
        </Card>
      </div>
      
      <Dialog open={isCumulativeModalOpen} onOpenChange={setIsCumulativeModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-headline flex items-center">
              <Archive className="mr-2 h-6 w-6" />
              Kümülatif Paneli
            </DialogTitle>
            <DialogDescription>
              Gitmek istediğiniz kümülatif analiz sayfasını seçin.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
              <Button variant="outline" onClick={() => handleCumulativeNavigation('/kumulatif-hesaplama')}>
                <Calculator className="h-4 w-4 mr-2" /> Kümülatif Hesaplama
              </Button>
              <Button variant="outline" onClick={() => handleCumulativeNavigation('/raporlama/kumulatif-analiz')}>
                <Activity className="h-4 w-4 mr-2" /> Kümülatif Analiz
              </Button>
              <Button variant="outline" onClick={() => handleCumulativeNavigation('/kumulatif-gecmis')}>
                <HistoryIcon className="h-4 w-4 mr-2" /> Kümülatif Geçmişi
              </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCihazUstuModalOpen} onOpenChange={setIsCihazUstuModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-headline flex items-center">
              <Activity className="mr-2 h-6 w-6" /> Cihaz Üstü
            </DialogTitle>
            <DialogDescription>
              Cihaz üstü işlemlerini ekleyin veya geçmişi görüntüleyin.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <Button variant="outline" onClick={() => navigateTo('/raporlama/cihaz-ustu-ekle')}>
              Cihaz Üstü Ekle
            </Button>
            <Button variant="outline" onClick={() => navigateTo('/raporlama/cihaz-ustu-gecmisi')}>
              Cihaz Üstü Geçmişi
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isStokIslemleriModalOpen} onOpenChange={setIsStokIslemleriModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-headline flex items-center">
              <Package className="mr-2 h-6 w-6" /> Stok İşlemleri
            </DialogTitle>
            <DialogDescription>
              Stok raporları ve analizlerine erişin.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <Button variant="outline" onClick={() => handleStokIslemleriNavigation('/raporlama/imha-edilen-kitler')}>
              <Trash2 className="h-4 w-4 mr-2" /> İmha Edilen Kitler
            </Button>
            <Button variant="outline" onClick={() => handleStokIslemleriNavigation('/raporlama/hareketsiz-stok-raporu')}>
              <CalendarClock className="h-4 w-4 mr-2" /> Hareketsiz Stok Raporu
            </Button>
            <Button variant="outline" onClick={() => handleStokIslemleriNavigation('/raporlama/minmax-urun-grafik')}>
              <Activity className="h-4 w-4 mr-2" /> Min-Max Ürün Grafiği
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
