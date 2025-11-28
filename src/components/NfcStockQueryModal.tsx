
'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Nfc, Smartphone, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, query, where, getDocs } from 'firebase/firestore';
import type { ProductCode, DeviceGroup, DepoStokItem, Hospital } from '@/lib/types';
import Image from 'next/image';

interface NfcStockQueryModalProps {
  isOpen: boolean;
  onClose: () => void;
  productCodes: ProductCode[];
  deviceGroups: DeviceGroup[];
  allStock: DepoStokItem[];
}

function normalizeUid(raw: string): string | null {
  const hex = (raw || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hex.length === 16 ? hex : null;
}

function suffix6FromHex(hex16: string): string {
  const last12 = hex16.slice(-12);
  return last12.match(/.{1,2}/g)!.join(':');
}

type ProductStockInfo = {
  product: ProductCode;
  deviceGroupImage?: string;
  depotCount: number;
  labCounts: { name: string; count: number }[];
};

export default function NfcStockQueryModal({
  isOpen,
  onClose,
  productCodes,
  deviceGroups,
  allStock,
}: NfcStockQueryModalProps) {
  const { toast } = useToast();
  const [uid, setUid] = useState('');
  const [status, setStatus] = useState<'idle' | 'scanning' | 'loading' | 'found' | 'not_found'>('idle');
  const [productInfo, setProductInfo] = useState<ProductStockInfo | null>(null);

  const handleScan = async (scannedUid: string) => {
    setStatus('loading');
    const hexUid = normalizeUid(scannedUid);
    if (!hexUid) {
      toast({ title: 'Geçersiz UID', description: 'Okunan etiket seri numarası geçersiz.', variant: 'destructive' });
      setStatus('idle');
      return;
    }

    try {
      const tagSnap = await getDoc(doc(db, 'lot_tags', hexUid));
      if (!tagSnap.exists()) {
        setStatus('not_found');
        return;
      }

      const { productCode, lot } = tagSnap.data();
      const product = productCodes.find(p => p.stokKodu === productCode);
      if (!product) {
        setStatus('not_found');
        return;
      }

      const depotCount = allStock.filter(s =>
        !s.isShipped && s.stokKodu === productCode && s.lotNumarasi === lot
      ).length;

      const labStock = allStock.filter(s =>
        s.isShipped && s.stokKodu === productCode && s.lotNumarasi === lot
      );
      
      const labCountsMap: Record<string, number> = {};
      labStock.forEach(item => {
        const labName = item.hedefKurum || 'Bilinmeyen Lab';
        labCountsMap[labName] = (labCountsMap[labName] || 0) + 1;
      });

      const labCounts = Object.entries(labCountsMap).map(([name, count]) => ({ name, count }));
      const deviceGroup = deviceGroups.find(dg => dg.name === product.cihazGrubu);

      setProductInfo({
        product,
        deviceGroupImage: deviceGroup?.imageUrl,
        depotCount,
        labCounts
      });
      setStatus('found');

    } catch (error) {
      console.error("NFC stock query error:", error);
      toast({ title: 'Sorgu Hatası', description: 'Veritabanı sorgusu sırasında bir hata oluştu.', variant: 'destructive' });
      setStatus('idle');
    }
  };

  const startWebNfcScan = async () => {
    try {
      // @ts-ignore
      const ndef = new NDEFReader();
      await ndef.scan();
      setStatus('scanning');
      toast({ title: 'NFC Okuyucu Aktif', description: 'Lütfen etiketi telefonunuza yaklaştırın.' });
      ndef.onreading = (event: any) => {
        if (event.serialNumber) {
          handleScan(event.serialNumber);
        }
      };
    } catch (error) {
      toast({ title: 'Web NFC Başlatılamadı', description: 'Bu özellik sadece HTTPS üzerinden Android Chrome\'da çalışır.', variant: 'destructive' });
    }
  };
  
  useEffect(() => {
    if (!isOpen) {
      setStatus('idle');
      setProductInfo(null);
      setUid('');
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Nfc /> NFC ile Stok Sorgula</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="flex gap-2">
            <Button onClick={startWebNfcScan} disabled={status === 'scanning' || typeof window === 'undefined' || !('NDEFReader' in window)}>
              <Smartphone className="mr-2 h-4 w-4" /> Telefon ile Tara
            </Button>
            <Input
              placeholder="Veya harici okuyucudan gelen UID'yi girin..."
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleScan(uid);
              }}
              className="font-mono"
            />
          </div>

          <div className="min-h-[300px] border rounded-lg p-4 flex items-center justify-center bg-muted/30">
            {status === 'idle' && <p className="text-muted-foreground">Sorgulamak için bir etiket okutun.</p>}
            {status === 'scanning' && <div className="text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" /><p>Etiket bekleniyor...</p></div>}
            {status === 'loading' && <div className="text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" /><p>Veriler yükleniyor...</p></div>}
            {status === 'not_found' && <div className="text-center text-destructive"><XCircle className="h-8 w-8 mx-auto mb-2" /><p>Okutulan etiket sistemdeki hiçbir ürünle eşleşmedi.</p></div>}
            
            {status === 'found' && productInfo && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold">{productInfo.product.stokAdi}</h3>
                  <p className="text-sm font-mono text-muted-foreground">{productInfo.product.stokKodu}</p>
                  <p className="text-3xl font-bold">{productInfo.product.miad || 'Miad Bilgisi Yok'}</p>
                  <div className="space-y-2 pt-2">
                    <div className="flex justify-between items-center bg-background p-2 rounded-md">
                      <span className="font-medium">Depo Adedi:</span>
                      <Badge variant="secondary" className="text-lg">{productInfo.depotCount}</Badge>
                    </div>
                    {productInfo.labCounts.map(lab => (
                      <div key={lab.name} className="flex justify-between items-center p-2 rounded-md">
                        <span className="text-sm">{lab.name}:</span>
                        <Badge className="text-base">{lab.count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-center">
                  {productInfo.deviceGroupImage && (
                    <Image
                      src={`/${productInfo.deviceGroupImage}`}
                      alt={productInfo.product.cihazGrubu || 'Cihaz Grubu'}
                      width={200}
                      height={200}
                      className="object-contain"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
