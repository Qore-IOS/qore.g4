'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, addDoc, serverTimestamp, query, getDocs, where } from 'firebase/firestore';
import type { Device, Hospital, ProductCode, User } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Wrench, ClipboardList, Trash2, Save, History, Search, Plus, FileText } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import BackButton from '@/components/BackButton';
import Image from 'next/image';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import SignaturePad from '@/components/SignaturePad';
import type { SignaturePadRef } from '@/components/SignaturePad';
import AplikasyonTutanakPDFButton from '@/components/exports/AplikasyonTutanakPDFButton';

// Operation types (Yapılan İşlem)
type OperationType =
  | 'aplikasyon_kontrol'
  | 'kalibrasyon_kontrol'
  | 'qc_materyal_kontrol'
  | 'ornek_sonucu_karsilastirma'
  | 'reaktif_yenileme'
  | 'kalibrator_yenileme'
  | 'qc_yenileme'
  | 'cv_calismasi'
  | 'diger';

// Cihaz Durumu
type CihazDurumu = 'calisiyor' | 'arizali' | 'denemede' | 'diger' | '';

type ActionItem = {
  id: string;
  type: 'part_change' | 'operation';
  action: string;
  stokKodu?: string;
  stokAdi?: string;
  quantity: number;
  description?: string;
  isManualEntry?: boolean;
};

type ActionFormRecord = {
    id: string;
    createdAt: { toDate: () => Date };
    createdByName: string;
    actions: ActionItem[];
    cihazDurumu?: CihazDurumu;
    cihazDurumuAciklama?: string;
    eslikEdenPersonel?: { uid: string; name: string; role: string }[];
    personnelSignature?: string;
    technicianSignature?: string;
};

const CIHAZ_DURUMU_LABELS: Record<CihazDurumu, string> = {
  '': 'Seçiniz',
  calisiyor: 'Çalışıyor',
  arizali: 'Arızalı',
  denemede: 'Denemede',
  diger: 'Diğer',
};

const OPERATION_LABELS: Record<OperationType, string> = {
  aplikasyon_kontrol: 'Aplikasyon Kontrol',
  kalibrasyon_kontrol: 'Kalibrasyon Kontrol',
  qc_materyal_kontrol: 'QC Materyal Kontrol',
  ornek_sonucu_karsilastirma: 'Örnek Sonucu Karşılaştırma',
  reaktif_yenileme: 'Reaktif Yenileme',
  kalibrator_yenileme: 'Kalibratör Yenileme',
  qc_yenileme: 'QC Yenileme',
  cv_calismasi: 'CV Çalışması',
  diger: 'Diğer',
};

const ALL_OPERATIONS: OperationType[] = [
  'aplikasyon_kontrol',
  'kalibrasyon_kontrol',
  'qc_materyal_kontrol',
  'ornek_sonucu_karsilastirma',
  'reaktif_yenileme',
  'kalibrator_yenileme',
  'qc_yenileme',
  'cv_calismasi',
  'diger',
];

export default function AplikasyonIslemFormuPage() {
  const params = useParams();
  const deviceId = params ? (Array.isArray(params.deviceId) ? params.deviceId[0] : params.deviceId as string) : '';
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();

  const [device, setDevice] = useState<Device | null>(null);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [aciklama, setAciklama] = useState('');

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ActionFormRecord[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [signatureStep, setSignatureStep] = useState<'pre_questions' | 'personnel' | 'technician'>('pre_questions');
  const personnelSignatureRef = useRef<SignaturePadRef>(null);
  const technicianSignatureRef = useRef<SignaturePadRef>(null);
  const [signatures, setSignatures] = useState<{ personnel?: string; technician?: string }>({});

  // Pre-signature questions
  const [cihazDurumu, setCihazDurumu] = useState<CihazDurumu>('');
  const [cihazDurumuAciklama, setCihazDurumuAciklama] = useState('');
  const [eslikEdenPersonel, setEslikEdenPersonel] = useState<{ uid: string; name: string; role: string }[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [personelSearchQuery, setPersonelSearchQuery] = useState('');

  // Operation selection modal
  const [isOperationModalOpen, setIsOperationModalOpen] = useState(false);
  const [selectedOperations, setSelectedOperations] = useState<OperationType[]>([]);
  const [digerAciklama, setDigerAciklama] = useState('');

  // Part selection modal
  const [isPartModalOpen, setIsPartModalOpen] = useState(false);
  const [spareParts, setSpareParts] = useState<ProductCode[]>([]);
  const [partSearchQuery, setPartSearchQuery] = useState('');
  const [selectedPart, setSelectedPart] = useState<ProductCode | null>(null);
  const [manualPartCode, setManualPartCode] = useState('');
  const [manualPartName, setManualPartName] = useState('');
  const [partQuantity, setPartQuantity] = useState(1);
  const [showManualEntry, setShowManualEntry] = useState(false);

  useEffect(() => {
    if (!deviceId) return;
    setLoading(true);
    (async () => {
      try {
        const deviceSnap = await getDoc(doc(db, 'devices', deviceId));
        if (!deviceSnap.exists()) {
          toast({ title: 'Hata', description: 'Cihaz bulunamadı.', variant: 'destructive' });
          router.back();
          return;
        }
        const deviceData = { id: deviceSnap.id, ...deviceSnap.data() } as Device;
        setDevice(deviceData);

        if (deviceData.hospitalId) {
          const hospitalSnap = await getDoc(doc(db, 'hospitals', deviceData.hospitalId));
          if (hospitalSnap.exists()) {
            setHospital({ id: hospitalSnap.id, ...hospitalSnap.data() } as Hospital);
          }
        }
      } catch (err) {
        console.error("Error fetching device/hospital data:", err);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    })();
  }, [deviceId, router, toast]);

  // Fetch spare parts
  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, 'productCodes'), where('urunGrubu', '==', 'yedek_parca'));
        const snap = await getDocs(q);
        setSpareParts(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ProductCode));
      } catch (err) {
        console.error("Error fetching spare parts:", err);
      }
    })();
  }, []);

  // Fetch users for accompanying personnel
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }) as User);
        setAllUsers(users.filter(u => u.role === 'teknik_servis' || u.role === 'aplikasyon'));
      } catch (err) {
        console.error("Error fetching users:", err);
      }
    })();
  }, []);

  // Sorted users based on current user's role
  const sortedUsers = useMemo(() => {
    const currentRole = currentUserProfile?.role;
    return [...allUsers].sort((a, b) => {
      // Current user's role type first
      if (currentRole === 'aplikasyon') {
        if (a.role === 'aplikasyon' && b.role !== 'aplikasyon') return -1;
        if (a.role !== 'aplikasyon' && b.role === 'aplikasyon') return 1;
      } else {
        if (a.role === 'teknik_servis' && b.role !== 'teknik_servis') return -1;
        if (a.role !== 'teknik_servis' && b.role === 'teknik_servis') return 1;
      }
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [allUsers, currentUserProfile?.role]);

  // Filtered users for search
  const filteredUsers = useMemo(() => {
    if (!personelSearchQuery) return sortedUsers;
    const q = personelSearchQuery.toLowerCase();
    return sortedUsers.filter(u =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  }, [sortedUsers, personelSearchQuery]);

  // Filtered spare parts
  const filteredParts = useMemo(() => {
    if (!partSearchQuery) return spareParts;
    const q = partSearchQuery.toLowerCase();
    return spareParts.filter(p =>
      p.stokKodu.toLowerCase().includes(q) ||
      p.stokAdi.toLowerCase().includes(q)
    );
  }, [spareParts, partSearchQuery]);

  const openPartModal = () => {
    setPartSearchQuery('');
    setSelectedPart(null);
    setManualPartCode('');
    setManualPartName('');
    setPartQuantity(1);
    setShowManualEntry(false);
    setIsPartModalOpen(true);
  };

  const addSelectedPart = () => {
    if (showManualEntry) {
      if (!manualPartCode.trim() || !manualPartName.trim()) {
        toast({ title: 'Eksik Bilgi', description: 'Lütfen parça kodu ve adını girin.', variant: 'destructive' });
        return;
      }
      const newItem: ActionItem = {
        id: crypto.randomUUID(),
        type: 'part_change',
        action: 'manual_part',
        stokKodu: manualPartCode.trim(),
        stokAdi: manualPartName.trim(),
        quantity: partQuantity,
        isManualEntry: true,
      };
      setActions(prev => [newItem, ...prev]);
    } else if (selectedPart) {
      const newItem: ActionItem = {
        id: crypto.randomUUID(),
        type: 'part_change',
        action: selectedPart.id,
        stokKodu: selectedPart.stokKodu,
        stokAdi: selectedPart.stokAdi,
        quantity: partQuantity,
      };
      setActions(prev => [newItem, ...prev]);
    } else {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen bir parça seçin.', variant: 'destructive' });
      return;
    }
    setIsPartModalOpen(false);
  };

  const toggleEslikEdenPersonel = (user: User) => {
    setEslikEdenPersonel(prev => {
      const exists = prev.find(p => p.uid === user.uid);
      if (exists) {
        return prev.filter(p => p.uid !== user.uid);
      }
      return [...prev, { uid: user.uid, name: user.name || user.email || '', role: user.role }];
    });
  };

  const openOperationModal = () => {
    setSelectedOperations([]);
    setDigerAciklama('');
    setIsOperationModalOpen(true);
  };

  const toggleOperation = (op: OperationType) => {
    setSelectedOperations(prev =>
      prev.includes(op) ? prev.filter(o => o !== op) : [...prev, op]
    );
  };

  const addSelectedOperations = () => {
    // Validate "diger" requires description
    if (selectedOperations.includes('diger') && !digerAciklama.trim()) {
      toast({ title: 'Eksik Bilgi', description: '"Diğer" seçeneği için açıklama zorunludur.', variant: 'destructive' });
      return;
    }

    const newItems: ActionItem[] = selectedOperations.map(op => ({
      id: crypto.randomUUID(),
      type: 'operation' as const,
      action: op,
      quantity: 1,
      description: op === 'diger' ? digerAciklama : '',
    }));

    setActions(prev => [...prev, ...newItems]);
    setIsOperationModalOpen(false);
    setSelectedOperations([]);
    setDigerAciklama('');
  };

  const updateAction = (id: string, field: keyof ActionItem, value: any) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  };

  const removeActionRow = (id: string) => {
    setActions(prev => prev.filter(a => a.id !== id));
  };

  const startSaveProcess = () => {
    // Validate açıklama (zorunlu)
    if (!aciklama.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen açıklama alanını doldurun.', variant: 'destructive' });
      return;
    }

    // Validate part changes have quantity
    const invalidPart = actions.find(a => a.type === 'part_change' && a.quantity <= 0);
    if (invalidPart) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm parça değişimlerinde geçerli bir adet girin.', variant: 'destructive' });
      return;
    }

    // Validate "diger" operation has description
    const invalidDiger = actions.find(a => a.action === 'diger' && !a.description?.trim());
    if (invalidDiger) {
      toast({ title: 'Eksik Bilgi', description: '"Diğer" işlemi için açıklama zorunludur.', variant: 'destructive' });
      return;
    }

    // Reset pre-signature state
    setCihazDurumu('');
    setCihazDurumuAciklama('');
    setEslikEdenPersonel([]);
    setPersonelSearchQuery('');
    setSignatures({});
    setSignatureStep('pre_questions');
    setIsSignatureModalOpen(true);
  };

  const proceedToSignature = () => {
    // Validate cihaz durumu
    if (!cihazDurumu) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen cihaz durumunu seçin.', variant: 'destructive' });
      return;
    }
    if (cihazDurumu === 'diger' && !cihazDurumuAciklama.trim()) {
      toast({ title: 'Eksik Bilgi', description: '"Diğer" seçeneği için açıklama zorunludur.', variant: 'destructive' });
      return;
    }
    setSignatureStep('personnel');
  };

  const handleSaveSignaturesAndFinish = async (finalSignatures: { personnel?: string; technician?: string }) => {
    setIsSaving(true);
    setIsSignatureModalOpen(false);

    try {
        const docRef = await addDoc(collection(db, 'aplikasyonActionForms'), {
            deviceId,
            cihazAdi: device?.cihazAdi || device?.model,
            seriNumarasi: device?.seriNumarasi,
            hospitalId: device?.hospitalId,
            labName: hospital?.name,
            actions,
            aciklama: aciklama.trim(),
            cihazDurumu,
            cihazDurumuAciklama: cihazDurumu === 'diger' ? cihazDurumuAciklama : null,
            eslikEdenPersonel: eslikEdenPersonel.length > 0 ? eslikEdenPersonel : null,
            personnelSignature: finalSignatures.personnel || null,
            technicianSignature: finalSignatures.technician || null,
            createdAt: serverTimestamp(),
            createdByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
            createdByUid: currentUserProfile?.uid,
            formType: 'aplikasyon',
        });
        toast({title: 'Başarılı', description: `İşlem formu #${docRef.id.substring(0,6)}... kaydedildi.`});
        setActions([]);
        setAciklama('');
    } catch(err) {
        console.error("Error saving action form:", err);
        toast({ title: 'Hata', description: 'Form kaydedilemedi.', variant: 'destructive'});
    } finally {
        setIsSaving(false);
    }
  };

  const openHistory = async () => {
    if (!deviceId) return;
    setIsHistoryLoading(true);
    setIsHistoryOpen(true);
    try {
        const q = query(
            collection(db, 'aplikasyonActionForms'),
            where('deviceId', '==', deviceId)
        );
        const snap = await getDocs(q);
        const historyItems = snap.docs.map(d => ({id: d.id, ...d.data()}) as ActionFormRecord);
        historyItems.sort((a,b) => b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime());
        setHistory(historyItems);
    } catch(err) {
        console.error("Error fetching history:", err);
        toast({title: 'Hata', description: 'Geçmiş yüklenemedi.', variant: 'destructive'});
    } finally {
        setIsHistoryLoading(false);
    }
  };

  const getActionLabel = (item: ActionItem): string => {
    if (item.type === 'part_change') {
      return item.stokAdi || item.action;
    }
    return OPERATION_LABELS[item.action as OperationType] || item.action;
  };

  const updateActionQuantity = (id: string, quantity: number) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, quantity } : a));
  };

  if (loading) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!device) {
    return <div className="p-6 text-center">Cihaz bilgileri yüklenemedi.</div>;
  }

  return (
    <>
      <div className="p-4 space-y-4">
        <BackButton fallback={`/aplikasyon-paneli/${device.hospitalId}`} />
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                  {device.imageUrl && (
                      <div className="w-32 h-32 flex-shrink-0 bg-muted rounded-lg p-2">
                          <Image src={`/${device.imageUrl}`} alt={device.cihazAdi || ''} width={128} height={128} className="object-contain w-full h-full" />
                      </div>
                  )}
                  <div>
                    <CardTitle className="text-2xl font-headline">Aplikasyon İşlem Formu: {device.cihazAdi}</CardTitle>
                    <CardDescription>Seri No: {device.seriNumarasi}</CardDescription>
                    <p className="text-sm mt-2"><strong>Laboratuvar:</strong> {hospital?.name || '-'}</p>
                    <p className="text-sm"><strong>İşlemi Yapan:</strong> {currentUserProfile?.name || '-'}</p>
                    <p className="text-sm"><strong>Tarih:</strong> {format(new Date(), 'dd.MM.yyyy HH:mm', { locale: tr })}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={openHistory}>
                    <History className="h-4 w-4 mr-2" />
                    Geçmiş
                </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Açıklama Alanı (Zorunlu) */}
            <div className="p-4 border rounded-lg bg-muted/30">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Açıklama <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  placeholder="Yapılan işlem hakkında açıklama yazın... (zorunlu)"
                  value={aciklama}
                  onChange={(e) => setAciklama(e.target.value)}
                  rows={3}
                  className={!aciklama.trim() ? 'border-amber-500/50' : ''}
                />
                <p className="text-xs text-muted-foreground">
                  Bu alan zorunludur. Yapılan işlemi detaylı şekilde açıklayınız.
                </p>
              </div>
            </div>

            {/* Butonlar */}
            <div className="flex flex-wrap gap-2">
              <Button onClick={openPartModal} variant="outline">
                <Wrench className="mr-2 h-4 w-4" /> Değişen Parça Ekle
              </Button>
              <Button onClick={openOperationModal} variant="outline">
                <ClipboardList className="mr-2 h-4 w-4" /> Yapılan İşlemi Seç
              </Button>
            </div>
            <ScrollArea className="h-72 border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Tür</TableHead>
                    <TableHead>İşlem/Parça</TableHead>
                    <TableHead className="w-32">Kod</TableHead>
                    <TableHead className="w-24">Adet</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actions.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground">Henüz işlem eklenmedi. Yukarıdaki butonları kullanarak parça değişimi veya işlem ekleyin.</TableCell></TableRow>
                  ) : (
                    actions.map(item => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <span className={`text-xs font-medium px-2 py-1 rounded ${item.type === 'part_change' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}`}>
                            {item.type === 'part_change' ? 'Parça' : 'İşlem'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{getActionLabel(item)}</span>
                          {item.isManualEntry && <span className="ml-2 text-xs text-muted-foreground">(Manuel)</span>}
                        </TableCell>
                        <TableCell>
                          {item.type === 'part_change' ? (
                            <span className="font-mono text-xs">{item.stokKodu || '-'}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.type === 'part_change' ? (
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateActionQuantity(item.id, Number(e.target.value))}
                              min="1"
                              className="w-20"
                            />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removeActionRow(item.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
          <CardFooter className="justify-end">
              <Button onClick={startSaveProcess} disabled={isSaving || actions.length === 0}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Kaydet
              </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Operation Selection Modal */}
      <Dialog open={isOperationModalOpen} onOpenChange={setIsOperationModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yapılan İşlemi Seç</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            {ALL_OPERATIONS.map(op => (
              <div key={op} className="flex items-start space-x-3">
                <Checkbox
                  id={op}
                  checked={selectedOperations.includes(op)}
                  onCheckedChange={() => toggleOperation(op)}
                />
                <div className="flex flex-col">
                  <Label htmlFor={op} className="cursor-pointer font-medium">
                    {OPERATION_LABELS[op]}
                  </Label>
                  {op === 'diger' && selectedOperations.includes('diger') && (
                    <Input
                      className="mt-2 w-full"
                      placeholder="Açıklama (zorunlu)"
                      value={digerAciklama}
                      onChange={(e) => setDigerAciklama(e.target.value)}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOperationModalOpen(false)}>İptal</Button>
            <Button onClick={addSelectedOperations} disabled={selectedOperations.length === 0}>
              Ekle ({selectedOperations.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Part Selection Modal */}
      <Dialog open={isPartModalOpen} onOpenChange={setIsPartModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Değişen Parça Ekle</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {!showManualEntry ? (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Parça kodu veya adı ile arayın..."
                    value={partSearchQuery}
                    onChange={(e) => setPartSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <ScrollArea className="h-48 border rounded-md">
                  {filteredParts.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground">
                      {spareParts.length === 0 ? 'Yedek parça tanımlı değil.' : 'Sonuç bulunamadı.'}
                    </div>
                  ) : (
                    <div className="p-2 space-y-1">
                      {filteredParts.map(part => (
                        <button
                          key={part.id}
                          onClick={() => setSelectedPart(part)}
                          className={`w-full text-left p-2 rounded-md transition-colors ${
                            selectedPart?.id === part.id
                              ? 'bg-primary/10 border-primary border'
                              : 'hover:bg-muted'
                          }`}
                        >
                          <p className="font-medium">{part.stokAdi}</p>
                          <p className="text-xs text-muted-foreground font-mono">{part.stokKodu}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowManualEntry(true)}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Listede yok, manuel ekle
                </Button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Parça Kodu <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="Parça kodunu girin..."
                    value={manualPartCode}
                    onChange={(e) => setManualPartCode(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Parça Adı <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="Parça adını girin..."
                    value={manualPartName}
                    onChange={(e) => setManualPartName(e.target.value)}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowManualEntry(false)}
                >
                  Listeden seç
                </Button>
              </div>
            )}
            <div className="space-y-2">
              <Label>Adet</Label>
              <Input
                type="number"
                value={partQuantity}
                onChange={(e) => setPartQuantity(Number(e.target.value))}
                min="1"
                className="w-24"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPartModalOpen(false)}>İptal</Button>
            <Button onClick={addSelectedPart}>
              Ekle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History Modal */}
      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="max-w-4xl">
            <DialogHeader>
                <DialogTitle>Aplikasyon İşlem Geçmişi: {device.cihazAdi}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] mt-4">
                {isHistoryLoading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin"/></div> :
                 history.length === 0 ? <p className="text-center text-muted-foreground p-8">Bu cihaz için geçmiş aplikasyon işlem formu bulunmuyor.</p> :
                 (
                    <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Tarih</TableHead>
                            <TableHead>Kullanıcı</TableHead>
                            <TableHead>İşlemler</TableHead>
                            <TableHead>Durum</TableHead>
                            <TableHead className="text-right">Tutanak</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                            {history.map(rec => (
                                <TableRow key={rec.id}>
                                    <TableCell className="text-xs">{format(rec.createdAt.toDate(), 'dd.MM.yyyy HH:mm', {locale: tr})}</TableCell>
                                    <TableCell>{rec.createdByName}</TableCell>
                                    <TableCell>
                                        <ul className="list-disc pl-4 text-sm">
                                            {rec.actions.map(act => (
                                                <li key={act.id}>
                                                  <span className={`text-xs px-1 rounded mr-1 ${act.type === 'part_change' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                                                    {act.type === 'part_change' ? 'Parça' : 'İşlem'}
                                                  </span>
                                                  {act.type === 'part_change'
                                                    ? `${act.stokAdi || act.action}: ${act.quantity} adet`
                                                    : OPERATION_LABELS[act.action as OperationType] || act.action
                                                  }
                                                  {act.description && <span className="text-muted-foreground ml-1">({act.description})</span>}
                                                </li>
                                            ))}
                                        </ul>
                                    </TableCell>
                                    <TableCell className="text-xs">
                                      {rec.cihazDurumu && CIHAZ_DURUMU_LABELS[rec.cihazDurumu]}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <AplikasyonTutanakPDFButton
                                            device={device}
                                            hospital={hospital}
                                            actionRecord={rec}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                 )
                }
            </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Signature Modal */}
      <Dialog open={isSignatureModalOpen} onOpenChange={setIsSignatureModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {signatureStep === 'pre_questions' ? 'Cihaz Durumu ve Eşlik Eden Personel' : 'İmza'}
            </DialogTitle>
          </DialogHeader>

          {/* Pre-questions step */}
          {signatureStep === 'pre_questions' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Cihaz Durumu <span className="text-destructive">*</span></Label>
                <RadioGroup
                  value={cihazDurumu}
                  onValueChange={(val) => setCihazDurumu(val as CihazDurumu)}
                  className="grid grid-cols-2 gap-2"
                >
                  {(Object.keys(CIHAZ_DURUMU_LABELS) as CihazDurumu[])
                    .filter(k => k !== '')
                    .map(key => (
                      <div key={key} className="flex items-center space-x-2">
                        <RadioGroupItem value={key} id={`durumu-${key}`} />
                        <Label htmlFor={`durumu-${key}`} className="cursor-pointer">
                          {CIHAZ_DURUMU_LABELS[key]}
                        </Label>
                      </div>
                    ))}
                </RadioGroup>
                {cihazDurumu === 'diger' && (
                  <Input
                    placeholder="Diğer durumu açıklayın..."
                    value={cihazDurumuAciklama}
                    onChange={(e) => setCihazDurumuAciklama(e.target.value)}
                    className="mt-2"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label>Eşlik Eden Personel (Opsiyonel)</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Personel ara..."
                    value={personelSearchQuery}
                    onChange={(e) => setPersonelSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <ScrollArea className="h-32 border rounded-md">
                  <div className="p-2 space-y-1">
                    {filteredUsers
                      .filter(u => u.uid !== currentUserProfile?.uid)
                      .map(user => (
                        <button
                          key={user.uid}
                          onClick={() => toggleEslikEdenPersonel(user)}
                          className={`w-full text-left p-2 rounded-md transition-colors flex justify-between items-center ${
                            eslikEdenPersonel.find(p => p.uid === user.uid)
                              ? 'bg-primary/10 border-primary border'
                              : 'hover:bg-muted'
                          }`}
                        >
                          <div>
                            <p className="font-medium">{user.name || user.email}</p>
                            <p className="text-xs text-muted-foreground">
                              {user.role === 'aplikasyon' ? 'Aplikasyon' : 'Teknik Servis'}
                            </p>
                          </div>
                          {eslikEdenPersonel.find(p => p.uid === user.uid) && (
                            <span className="text-primary text-sm">Seçildi</span>
                          )}
                        </button>
                      ))}
                  </div>
                </ScrollArea>
                {eslikEdenPersonel.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {eslikEdenPersonel.map(p => (
                      <span key={p.uid} className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <DialogFooter className="mt-4 gap-2">
                <Button variant="outline" onClick={() => setIsSignatureModalOpen(false)}>İptal</Button>
                <Button onClick={proceedToSignature}>Devam Et</Button>
              </DialogFooter>
            </div>
          )}

          {/* Personnel signature step */}
          {signatureStep === 'personnel' && (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">İşlemi Yapan Personel</p>
              <SignaturePad ref={personnelSignatureRef} />
              <DialogFooter className="mt-4 gap-2">
                <Button variant="outline" onClick={() => { personnelSignatureRef.current?.clear(); }}>Temizle</Button>
                <Button variant="secondary" onClick={() => setSignatureStep('pre_questions')}>Geri</Button>
                <Button onClick={() => handleSaveSignaturesAndFinish({})}>Atla</Button>
                <Button onClick={() => {
                  const sig = personnelSignatureRef.current?.getSignature();
                  if (sig) {
                    setSignatures({ personnel: sig });
                    setSignatureStep('technician');
                  } else {
                    setSignatureStep('technician');
                  }
                }}>
                  Devam Et
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Technician signature step */}
          {signatureStep === 'technician' && (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">Aplikasyon Uzmanı</p>
              <SignaturePad ref={technicianSignatureRef} />
              <DialogFooter className="mt-4 gap-2">
                <Button variant="outline" onClick={() => { technicianSignatureRef.current?.clear(); }}>Temizle</Button>
                <Button onClick={() => handleSaveSignaturesAndFinish(signatures)}>Bu Adımı Atla</Button>
                <Button variant="secondary" onClick={() => setSignatureStep('personnel')}>Geri</Button>
                <Button onClick={() => {
                  const techSig = technicianSignatureRef.current?.getSignature();
                  handleSaveSignaturesAndFinish({ ...signatures, technician: techSig });
                }}>
                  Tamamla ve Kaydet
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
