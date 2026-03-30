
'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, QrCode, Save, UserCheck, ShieldCheck, History, Printer, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
  alimFiyatiTl?: number;
  satinAlmaTarihi?: string;
  garantiBitisTarihi?: string;
  planliKullanimOmruYil?: number;
  amortismanYontemi?: 'dogrusal' | 'azalan_bakiye';
  amortismanBaslangicTarihi?: string;
  hurdaTarihi?: string;
  imhaTarihi?: string;
  satisTarihi?: string;
  sonBakimTarihi?: string;
  sonrakiBakimTarihi?: string;
  sonKalibrasyonTarihi?: string;
  sonrakiKalibrasyonTarihi?: string;
  bakimMaliyetiTl?: number;
  zimmetliKisi?: string;
  checkOutTarihi?: string;
  checkInTarihi?: string;
  dijitalImza?: string;
  zimmetFisNo?: string;
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

interface CustodyEntry {
  id: string;
  action: 'check_out' | 'check_in';
  personel: string;
  digitalSignature?: string;
  zimmetFisNo?: string;
  note?: string;
  timestamp: any;
  changedBy: string;
}

export default function AssetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile, currentCompanyId } = useAuth();
  const assetId = Array.isArray(params.assetId) ? params.assetId[0] : params.assetId;

  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');

  const [locations, setLocations] = useState<Location[]>([]);
  const [newLocation, setNewLocation] = useState('');
  const [newPersonel, setNewPersonel] = useState('');
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [custodyHistory, setCustodyHistory] = useState<CustodyEntry[]>([]);
  const [assignmentPerson, setAssignmentPerson] = useState('');
  const [assignmentSignature, setAssignmentSignature] = useState('');
  const [assignmentNote, setAssignmentNote] = useState('');

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
          setAssignmentPerson(assetData.zimmetliKisi || assetData.teslimEdilenPersonel || '');
          setAssignmentSignature(assetData.dijitalImza || '');
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

        const custodyQuery = query(collection(db, 'assets', assetId, 'custodyHistory'), orderBy('timestamp', 'desc'));
        const custodySnap = await getDocs(custodyQuery);
        setCustodyHistory(filterByCompanyScope(
          custodySnap.docs.map(d => ({ id: d.id, ...d.data() } as CustodyEntry)),
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

  const createReceiptNo = () => `ZIM-${new Date().getFullYear()}-${generateId().slice(0, 8).toUpperCase()}`;

  const handleCheckOut = async () => {
    if (!asset || !assignmentPerson.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Check-out için personel zorunludur.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const receiptNo = createReceiptNo();
      const nowIso = new Date().toISOString().slice(0, 10);
      const entry = withCompanyScope({
        action: 'check_out',
        personel: assignmentPerson.trim(),
        digitalSignature: assignmentSignature.trim(),
        zimmetFisNo: receiptNo,
        note: assignmentNote.trim(),
        timestamp: serverTimestamp(),
        changedBy: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
      }, currentCompanyId);
      await addDoc(collection(db, 'assets', asset.id, 'custodyHistory'), entry);
      await updateDoc(doc(db, 'assets', asset.id), {
        zimmetliKisi: assignmentPerson.trim(),
        teslimEdilenPersonel: assignmentPerson.trim(),
        checkOutTarihi: nowIso,
        checkInTarihi: '',
        dijitalImza: assignmentSignature.trim(),
        zimmetFisNo: receiptNo,
      });
      setAsset(prev => prev ? ({
        ...prev,
        zimmetliKisi: assignmentPerson.trim(),
        teslimEdilenPersonel: assignmentPerson.trim(),
        checkOutTarihi: nowIso,
        checkInTarihi: '',
        dijitalImza: assignmentSignature.trim(),
        zimmetFisNo: receiptNo,
      }) : prev);
      toast({ title: 'Check-Out Tamamlandı', description: `Zimmet fişi oluşturuldu: ${receiptNo}` });
    } catch {
      toast({ title: 'Hata', description: 'Check-out kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheckIn = async () => {
    if (!asset) return;
    setIsSaving(true);
    try {
      const nowIso = new Date().toISOString().slice(0, 10);
      const entry = withCompanyScope({
        action: 'check_in',
        personel: assignmentPerson.trim() || asset.zimmetliKisi || '',
        digitalSignature: assignmentSignature.trim(),
        zimmetFisNo: asset.zimmetFisNo || '',
        note: assignmentNote.trim(),
        timestamp: serverTimestamp(),
        changedBy: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
      }, currentCompanyId);
      await addDoc(collection(db, 'assets', asset.id, 'custodyHistory'), entry);
      await updateDoc(doc(db, 'assets', asset.id), {
        checkInTarihi: nowIso,
        zimmetliKisi: '',
      });
      setAsset(prev => prev ? ({ ...prev, checkInTarihi: nowIso, zimmetliKisi: '' }) : prev);
      toast({ title: 'Check-In Tamamlandı', description: 'Teslim alma kaydı oluşturuldu.' });
    } catch {
      toast({ title: 'Hata', description: 'Check-in kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const depreciationInfo = useMemo(() => {
    if (!asset?.alimFiyatiTl || !asset?.planliKullanimOmruYil || !asset?.amortismanBaslangicTarihi) return null;
    const start = new Date(asset.amortismanBaslangicTarihi);
    if (Number.isNaN(start.getTime())) return null;
    const today = new Date();
    const elapsedYears = Math.max(0, (today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
    const usefulLife = asset.planliKullanimOmruYil;
    const rate = 1 / usefulLife;

    let netBookValue = asset.alimFiyatiTl;
    if (asset.amortismanYontemi === 'azalan_bakiye') {
      netBookValue = asset.alimFiyatiTl * Math.pow(1 - rate, elapsedYears);
    } else {
      netBookValue = asset.alimFiyatiTl * Math.max(0, 1 - (elapsedYears / usefulLife));
    }
    const kalanOmurYil = Math.max(0, usefulLife - elapsedYears);
    return { netBookValue, kalanOmurYil };
  }, [asset]);

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
    <div className="p-6 lg:p-8 space-y-6 cihaz-shell">
      <BackButton fallback={`/yonetim/envanter-yonetimi/${asset.category}`} />
      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.65fr] gap-6">
        <Card className="cihaz-card-strong">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-2xl font-headline">{asset.urunAdi || `${asset.marka} ${asset.model}`}</CardTitle>
              <Badge className="bg-[var(--dashboard-surface-2)] text-[var(--dashboard-text)]">{asset.category}</Badge>
              <Badge className={asset.zimmetliKisi ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'}>
                {asset.zimmetliKisi ? 'Zimmetli' : 'Boşta'}
              </Badge>
            </div>
            <CardDescription>Demirbaş No: {asset.demirbasNo} · Seri No: {asset.seriNumarasi || '-'} · Ürün Kodu: {asset.urunKodu || '-'}</CardDescription>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4 text-sm">
            <p><strong>Marka / Model:</strong> {asset.marka || '-'} / {asset.model || '-'}</p>
            <p><strong>Konum:</strong> {asset.konum || '-'}</p>
            <p><strong>Personel:</strong> {asset.teslimEdilenPersonel || '-'}</p>
            <p><strong>Aktif Zimmet:</strong> {asset.zimmetliKisi || '-'}</p>
            <p><strong>Alım Fiyatı:</strong> {(asset.alimFiyatiTl || 0).toLocaleString('tr-TR')} ₺</p>
            <p><strong>Planlı Ömür:</strong> {asset.planliKullanimOmruYil || 0} yıl</p>
            <p><strong>Garanti Bitişi:</strong> {asset.garantiBitisTarihi || '-'}</p>
            <p><strong>Sonraki Bakım / Kalibrasyon:</strong> {asset.sonrakiBakimTarihi || '-'} / {asset.sonrakiKalibrasyonTarihi || '-'}</p>
            {depreciationInfo && (
              <div className="md:col-span-2 rounded-md border p-3 text-sm space-y-1 bg-[var(--dashboard-surface-2)]">
                <p><strong>Net Defter Değeri:</strong> {depreciationInfo.netBookValue.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₺</p>
                <p><strong>Kalan Kullanım Ömrü:</strong> {depreciationInfo.kalanOmurYil.toFixed(1)} yıl</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="cihaz-card-strong">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5"/> QR & Etiket</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            {qrCodeDataUrl ? (
              <Image src={qrCodeDataUrl} alt="QR Code" width={240} height={240} />
            ) : (
              <div className="w-60 h-60 bg-muted flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            )}
            <div className="w-full grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Etiket Yazdır</Button>
              <Button variant="outline" onClick={() => qrCodeDataUrl && window.open(qrCodeDataUrl, '_blank')}><Download className="h-4 w-4 mr-2" />QR İndir</Button>
            </div>
            <p className="text-xs text-center text-muted-foreground">QR kod bu ürün sayfasına doğrudan erişim sağlar.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="cihaz-card">
          <CardHeader><CardTitle className="text-lg">Bilgi Güncelle</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Yeni Konum</label>
              <Select value={newLocation} onValueChange={setNewLocation}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{locations.map(loc => <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Yeni Personel</label>
              <Input value={newPersonel} onChange={e => setNewPersonel(e.target.value)} />
            </div>
            <Button onClick={handleSaveChanges} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Save className="h-4 w-4 mr-2"/>}
              Değişiklikleri Kaydet
            </Button>
          </CardContent>
        </Card>

        <Card className="cihaz-card">
          <CardHeader><CardTitle className="text-lg">Zimmet ve Hareket</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Personel" value={assignmentPerson} onChange={e => setAssignmentPerson(e.target.value)} />
            <Input placeholder="Dijital İmza (Ad Soyad)" value={assignmentSignature} onChange={e => setAssignmentSignature(e.target.value)} />
            <Input placeholder="Not" value={assignmentNote} onChange={e => setAssignmentNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleCheckOut} disabled={isSaving}><UserCheck className="h-4 w-4 mr-2" />Check-Out Yap</Button>
              <Button variant="outline" onClick={handleCheckIn} disabled={isSaving}><ShieldCheck className="h-4 w-4 mr-2" />Check-In Yap</Button>
            </div>
            <p className="text-xs text-muted-foreground">Check-Out: {asset.checkOutTarihi || '-'} · Check-In: {asset.checkInTarihi || '-'} · Fiş: {asset.zimmetFisNo || '-'}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="cihaz-card-strong">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Hareket Geçmişi</CardTitle>
        </CardHeader>
        <CardContent className="grid lg:grid-cols-2 gap-4">
          <ScrollArea className="h-56 border rounded-md">
            {history.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground text-center">Değişiklik geçmişi yok.</p>
            ) : (
              <div className="space-y-2 p-3">
                {history.map(h => (
                  <div key={h.id} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">{h.timestamp?.toDate ? format(h.timestamp.toDate(), 'dd.MM.yyyy HH:mm', {locale: tr}) : '-'}</p>
                    <p className="text-muted-foreground">
                      Konum: {h.previousState?.konum || '-'} → {h.newState?.konum || '-'} · Personel: {h.previousState?.teslimEdilenPersonel || '-'} → {h.newState?.teslimEdilenPersonel || '-'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          <ScrollArea className="h-56 border rounded-md">
            {custodyHistory.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground text-center">Zimmet hareketi yok.</p>
            ) : (
              <div className="space-y-2 p-3">
                {custodyHistory.map(h => (
                  <div key={h.id} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">{h.action === 'check_out' ? 'Check-Out' : 'Check-In'} · {h.timestamp?.toDate ? format(h.timestamp.toDate(), 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}</p>
                    <p className="text-muted-foreground">{h.personel || '-'} · Fiş: {h.zimmetFisNo || '-'}</p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
