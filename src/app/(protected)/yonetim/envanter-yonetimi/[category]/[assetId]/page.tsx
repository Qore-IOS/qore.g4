
'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, QrCode, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { doc, getDoc, collection, getDocs, updateDoc, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import BackButton from '@/components/BackButton';
import QRCode from 'qrcode';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/auth-context';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { generateId } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Asset {
  id: string;
  category: string;
  demirbasNo: string;
  urunKodu: string;
  urunAdi: string;
  marka: string;
  model: string;
  konum: string;
  teslimEdilenPersonel: string;
  aciklama: string;
}

interface Location {
    id: string;
    name: string;
}

interface AssetHistoryEntry {
    id: string;
    timestamp: any;
    changedBy: string;
    previousState: { konum: string; teslimEdilenPersonel: string };
    newState: { konum: string; teslimEdilenPersonel: string };
}

export default function AssetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();
  const assetId = Array.isArray(params.assetId) ? params.assetId[0] : params.assetId;

  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');

  const [locations, setLocations] = useState<Location[]>([]);
  const [newLocation, setNewLocation] = useState('');
  const [newPersonel, setNewPersonel] = useState('');
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);

  useEffect(() => {
    if (!assetId) {
      toast({ title: 'Hata', description: 'Geçersiz ürün ID.', variant: 'destructive' });
      router.back();
      return;
    }

    const fetchAssetAndLocations = async () => {
      setLoading(true);
      try {
        const [assetDocSnap, labsSnap, depotsSnap] = await Promise.all([
          getDoc(doc(db, 'assets', assetId)),
          getDocs(collection(db, 'hospitals')),
          getDocs(collection(db, 'depots')),
        ]);

        if (assetDocSnap.exists()) {
          const assetData = { id: assetDocSnap.id, ...assetDocSnap.data() } as Asset;
          setAsset(assetData);
          setNewLocation(assetData.konum);
          setNewPersonel(assetData.teslimEdilenPersonel);
        } else {
          toast({ title: 'Bulunamadı', description: 'Bu ID ile eşleşen ürün bulunamadı.', variant: 'destructive' });
        }
        
        const labLocations = filterByCompanyScope(
          labsSnap.docs.map(d => ({ id: d.id, name: d.data().name, companyId: (d.data() as any).companyId })),
          currentUserProfile?.companyId,
          currentUserProfile?.role === 'super_admin'
        ).map(({ id, name }) => ({ id, name }));
        const depotLocations = filterByCompanyScope(
          depotsSnap.docs.map(d => ({ id: d.id, name: d.data().name, companyId: (d.data() as any).companyId })),
          currentUserProfile?.companyId,
          currentUserProfile?.role === 'super_admin'
        ).map(({ id, name }) => ({ id, name }));
        setLocations([...labLocations, ...depotLocations].sort((a,b) => a.name.localeCompare(b.name)));

        // Fetch history
        const historyQuery = query(collection(db, 'assets', assetId, 'assetHistory'), orderBy('timestamp', 'desc'));
        const historySnap = await getDocs(historyQuery);
        setHistory(filterByCompanyScope(
          historySnap.docs.map(d => ({ id: d.id, ...d.data() } as AssetHistoryEntry)),
          currentUserProfile?.companyId,
          currentUserProfile?.role === 'super_admin'
        ));

      } catch (e) {
        toast({ title: 'Hata', description: 'Ürün bilgileri yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };

    fetchAssetAndLocations();
  }, [assetId, router, toast]);
  
  useEffect(() => {
    if (asset) {
        const url = window.location.href;
        QRCode.toDataURL(url, { width: 256, margin: 2 }, (err, dataUrl) => {
            if (err) {
                console.error('QR Code generation error:', err);
                setQrCodeDataUrl('');
            } else {
                setQrCodeDataUrl(dataUrl);
            }
        });
    }
  }, [asset]);

  const handleSaveChanges = async () => {
    if (!asset) return;
    const hasChanges = newLocation !== asset.konum || newPersonel !== asset.teslimEdilenPersonel;
    if (!hasChanges) {
        toast({title: "Değişiklik Yok", description: "Herhangi bir değişiklik yapılmadı.", variant: "default"});
        return;
    }
    
    setIsSaving(true);
    try {
      const historyEntry = {
        timestamp: serverTimestamp(),
        changedBy: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
        previousState: {
          konum: asset.konum,
          teslimEdilenPersonel: asset.teslimEdilenPersonel,
        },
        newState: {
          konum: newLocation,
          teslimEdilenPersonel: newPersonel,
        },
      };

      await addDoc(collection(db, 'assets', asset.id, 'assetHistory'), withCompanyScope(historyEntry, currentUserProfile?.companyId));
      await updateDoc(doc(db, 'assets', asset.id), {
        konum: newLocation,
        teslimEdilenPersonel: newPersonel,
      });

      // Optimistically update local state
      setAsset(prev => ({ ...prev!, konum: newLocation, teslimEdilenPersonel: newPersonel }));
      setHistory(prev => [{...historyEntry, id: generateId(), timestamp: new Date() }, ...prev]);
      
      toast({title: 'Başarılı', description: 'Değişiklikler kaydedildi.'});

    } catch (e) {
        toast({title: 'Hata', description: 'Değişiklikler kaydedilemedi.', variant: 'destructive'});
    } finally {
        setIsSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (!asset) {
    return (
      <div className="p-6">
        <BackButton fallback={`/yonetim/envanter-yonetimi/${params.category}`} />
        <p className="mt-4 text-center text-muted-foreground">Ürün bulunamadı.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
        <BackButton fallback={`/yonetim/envanter-yonetimi/${asset.category}`} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-2xl font-headline">{asset.urunAdi}</CardTitle>
                        <CardDescription>Demirbaş No: {asset.demirbasNo} | Ürün Kodu: {asset.urunKodu}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <p><strong>Marka:</strong> {asset.marka}</p>
                            <p><strong>Model:</strong> {asset.model}</p>
                            <p><strong>Konum:</strong> {asset.konum}</p>
                            <p><strong>Personel:</strong> {asset.teslimEdilenPersonel}</p>
                        </div>
                        {asset.aciklama && (
                            <div>
                                <p><strong>Açıklama:</strong></p>
                                <p className="text-muted-foreground">{asset.aciklama}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle>Düzenleme ve Geçmiş</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                             <div>
                                <label className="text-sm font-medium">Yeni Konum</label>
                                <Select value={newLocation} onValueChange={setNewLocation}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        {locations.map(loc => <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                             </div>
                             <div>
                                <label className="text-sm font-medium">Yeni Personel</label>
                                <Input value={newPersonel} onChange={e => setNewPersonel(e.target.value)} />
                             </div>
                             <div className="md:col-span-2">
                                <Button onClick={handleSaveChanges} disabled={isSaving}>
                                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Save className="h-4 w-4 mr-2"/>}
                                    Değişiklikleri Kaydet
                                </Button>
                             </div>
                         </div>
                         <div>
                            <h4 className="font-medium mb-2">Değişiklik Geçmişi</h4>
                            <ScrollArea className="h-40 border rounded-md">
                                {history.length === 0 ? (
                                    <p className="p-4 text-sm text-muted-foreground text-center">Geçmiş kayıt yok.</p>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Tarih</TableHead>
                                                <TableHead>Değişiklik</TableHead>
                                                <TableHead>Yapan</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {history.map(h => {
                                                const prev = h.previousState;
                                                const curr = h.newState;
                                                let desc = '';
                                                if (prev.konum !== curr.konum) desc += `Konum: ${prev.konum} → ${curr.konum}. `;
                                                if (prev.teslimEdilenPersonel !== curr.teslimEdilenPersonel) desc += `Personel: ${prev.teslimEdilenPersonel} → ${curr.teslimEdilenPersonel}.`;
                                                
                                                return (
                                                <TableRow key={h.id}>
                                                    <TableCell className="text-xs">{h.timestamp ? format(h.timestamp.toDate(), 'dd.MM.yyyy HH:mm', {locale: tr}) : '-'}</TableCell>
                                                    <TableCell className="text-xs">{desc}</TableCell>
                                                    <TableCell className="text-xs">{h.changedBy}</TableCell>
                                                </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                )}
                            </ScrollArea>
                         </div>
                    </CardContent>
                </Card>
            </div>
            <div className="md:col-span-1">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5"/> QR Kod</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center">
                        {qrCodeDataUrl ? (
                            <Image src={qrCodeDataUrl} alt="QR Code" width={256} height={256} />
                        ) : (
                            <div className="w-64 h-64 bg-muted flex items-center justify-center">
                                <Loader2 className="h-8 w-8 animate-spin" />
                            </div>
                        )}
                        <p className="text-xs text-center mt-2 text-muted-foreground">Bu QR kodu okutarak bu sayfaya doğrudan erişebilirsiniz.</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    </div>
  );
}
