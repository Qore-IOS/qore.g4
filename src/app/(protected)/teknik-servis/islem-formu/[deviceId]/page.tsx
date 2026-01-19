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
import { Loader2, Wrench, ClipboardList, Trash2, Save, History, Search, Plus, Settings, Cog, FileText } from 'lucide-react';
import BackButton from '@/components/BackButton';
import Image from 'next/image';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import TeknikServisTutanakPDFButton from '@/components/exports/TeknikServisTutanakPDFButton';
import SignaturePad from '@/components/SignaturePad';
import type { SignaturePadRef } from '@/components/SignaturePad';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Textarea } from '@/components/ui/textarea';

// Operation types (Yapılan İşlem)
type OperationType =
  | 'genel_temizlik_yaglama'
  | 'temel_fonksiyon_testleri'
  | 'mekanik_ayarlar_kontrol'
  | 'optik_ayarlar_kontrol'
  | 'pipetleme_transfer_ayarlari';

// İşlem Tipi
type IslemTipi = 'cihaz' | 'ups' | 'su_sistemi' | '';

// İşlem Türü
type IslemTuru = 'kontrol' | 'periyodik_bakim' | 'cihaz_kurulumu' | 'ariza' | 'sw_update' | '';

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
    islemTipi?: IslemTipi;
    islemTuru?: IslemTuru;
    cihazDurumu?: CihazDurumu;
    cihazDurumuAciklama?: string;
    eslikEdenPersonel?: { uid: string; name: string; role: string }[];
    personnelSignature?: string;
    technicianSignature?: string;
};

const OPERATION_LABELS: Record<OperationType, string> = {
  genel_temizlik_yaglama: 'Genel Temizlik & Yağlama',
  temel_fonksiyon_testleri: 'Temel Fonksiyon Testleri',
  mekanik_ayarlar_kontrol: 'Mekanik Ayarlar & Kontrol',
  optik_ayarlar_kontrol: 'Optik Ayarlar & Kontrol',
  pipetleme_transfer_ayarlari: 'Pipetleme / Transfer Ayarları & Kontrol',
};

const ALL_OPERATIONS: OperationType[] = [
  'genel_temizlik_yaglama',
  'temel_fonksiyon_testleri',
  'mekanik_ayarlar_kontrol',
  'optik_ayarlar_kontrol',
  'pipetleme_transfer_ayarlari',
];

const ISLEM_TIPI_LABELS: Record<IslemTipi, string> = {
  '': 'Seçiniz',
  cihaz: 'Cihaz',
  ups: 'UPS',
  su_sistemi: 'Su Sistemi',
};

const ISLEM_TURU_LABELS: Record<IslemTuru, string> = {
  '': 'Seçiniz',
  kontrol: 'Kontrol',
  periyodik_bakim: 'Periyodik Bakım',
  cihaz_kurulumu: 'Cihaz Kurulumu',
  ariza: 'Arıza',
  sw_update: 'SW Update',
};

const CIHAZ_DURUMU_LABELS: Record<CihazDurumu, string> = {
  '': 'Seçiniz',
  calisiyor: 'Çalışıyor',
  arizali: 'Arızalı',
  denemede: 'Denemede',
  diger: 'Diğer',
};

export default function IslemFormuPage() {
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

  // İşlem Tipi ve Türü
  const [islemTipi, setIslemTipi] = useState<IslemTipi>('');
  const [islemTuru, setIslemTuru] = useState<IslemTuru>('');
  const [aciklama, setAciklama] = useState('');

  // History
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ActionFormRecord[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // Signature modal
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

  // Part selection modal
  const [isPartModalOpen, setIsPartModalOpen] = useState(false);
  const [spareParts, setSpareParts] = useState<ProductCode[]>([]);
  const [partSearchQuery, setPartSearchQuery] = useState('');
  const [selectedPart, setSelectedPart] = useState<ProductCode | null>(null);
  const [manualPartCode, setManualPartCode] = useState('');
  const [manualPartName, setManualPartName] = useState('');
  const [partQuantity, setPartQuantity] = useState(1);
  const [showManualEntry, setShowManualEntry] = useState(false);

  // Fetch device and hospital
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

  const openOperationModal = () => {
    setSelectedOperations([]);
    setIsOperationModalOpen(true);
  };

  const toggleOperation = (op: OperationType) => {
    setSelectedOperations(prev =>
      prev.includes(op) ? prev.filter(o => o !== op) : [...prev, op]
    );
  };

  const addSelectedOperations = () => {
    const newItems: ActionItem[] = selectedOperations.map(op => ({
      id: crypto.randomUUID(),
      type: 'operation' as const,
      action: op,
      quantity: 1,
    }));
    // Add to top of list
    setActions(prev => [...newItems, ...prev]);
    setIsOperationModalOpen(false);
    setSelectedOperations([]);
  };

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

  const removeActionRow = (id: string) => {
    setActions(prev => prev.filter(a => a.id !== id));
  };

  const updateActionQuantity = (id: string, quantity: number) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, quantity } : a));
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

  const startSaveProcess = () => {
    // Validate işlem tipi and türü
    if (!islemTipi) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen işlem tipini seçin.', variant: 'destructive' });
      return;
    }
    if (!islemTuru) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen işlem türünü seçin.', variant: 'destructive' });
      return;
    }

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
        const docRef = await addDoc(collection(db, 'deviceActionForms'), {
            deviceId,
            cihazAdi: device?.cihazAdi || device?.model,
            seriNumarasi: device?.seriNumarasi,
            hospitalId: device?.hospitalId,
            labName: hospital?.name,
            actions,
            islemTipi,
            islemTuru,
            aciklama: aciklama.trim(),
            cihazDurumu,
            cihazDurumuAciklama: cihazDurumu === 'diger' ? cihazDurumuAciklama : null,
            eslikEdenPersonel: eslikEdenPersonel.length > 0 ? eslikEdenPersonel : null,
            personnelSignature: finalSignatures.personnel || null,
            technicianSignature: finalSignatures.technician || null,
            createdAt: serverTimestamp(),
            createdByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
            createdByUid: currentUserProfile?.uid,
            formType: 'teknik_servis',
        });
        toast({title: 'Başarılı', description: `İşlem formu #${docRef.id.substring(0,6)}... kaydedildi.`});
        setActions([]);
        setIslemTipi('');
        setIslemTuru('');
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
            collection(db, 'deviceActionForms'),
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
    if (item.type === 'operation') {
      return OPERATION_LABELS[item.action as OperationType] || item.action;
    }
    return item.stokAdi || item.action;
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
        <BackButton fallback={`/teknik-servis/${device.hospitalId}`} />
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
                    <CardTitle className="text-2xl font-headline">Teknik Servis İşlem Formu: {device.cihazAdi}</CardTitle>
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
            {/* İşlem Tipi ve Türü Seçicileri */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/30">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  İşlem Tipi <span className="text-destructive">*</span>
                </Label>
                <Select value={islemTipi} onValueChange={(v) => setIslemTipi(v as IslemTipi)}>
                  <SelectTrigger>
                    <SelectValue placeholder="İşlem tipi seçin..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cihaz">Cihaz</SelectItem>
                    <SelectItem value="ups">UPS</SelectItem>
                    <SelectItem value="su_sistemi">Su Sistemi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Cog className="h-4 w-4" />
                  İşlem Türü <span className="text-destructive">*</span>
                </Label>
                <Select value={islemTuru} onValueChange={(v) => setIslemTuru(v as IslemTuru)}>
                  <SelectTrigger>
                    <SelectValue placeholder="İşlem türü seçin..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kontrol">Kontrol</SelectItem>
                    <SelectItem value="periyodik_bakim">Periyodik Bakım</SelectItem>
                    <SelectItem value="cihaz_kurulumu">Cihaz Kurulumu</SelectItem>
                    <SelectItem value="ariza">Arıza</SelectItem>
                    <SelectItem value="sw_update">SW Update</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

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

            {/* İşlem Listesi */}
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
              <div key={op} className="flex items-center space-x-3">
                <Checkbox
                  id={op}
                  checked={selectedOperations.includes(op)}
                  onCheckedChange={() => toggleOperation(op)}
                />
                <Label htmlFor={op} className="cursor-pointer font-medium">
                  {OPERATION_LABELS[op]}
                </Label>
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
                <DialogTitle>Teknik Servis İşlem Geçmişi: {device.cihazAdi}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] mt-4">
                {isHistoryLoading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin"/></div> :
                 history.length === 0 ? <p className="text-center text-muted-foreground p-8">Bu cihaz için geçmiş işlem formu bulunmuyor.</p> :
                 (
                    <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Tarih</TableHead>
                            <TableHead>Kullanıcı</TableHead>
                            <TableHead>Tip/Tür</TableHead>
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
                                    <TableCell className="text-xs">
                                      {rec.islemTipi && <span className="block">{ISLEM_TIPI_LABELS[rec.islemTipi]}</span>}
                                      {rec.islemTuru && <span className="text-muted-foreground">{ISLEM_TURU_LABELS[rec.islemTuru]}</span>}
                                    </TableCell>
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
                                                </li>
                                            ))}
                                        </ul>
                                    </TableCell>
                                    <TableCell className="text-xs">
                                      {rec.cihazDurumu && CIHAZ_DURUMU_LABELS[rec.cihazDurumu]}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <TeknikServisTutanakPDFButton
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

      {/* Pre-Signature & Signature Modal */}
      <Dialog open={isSignatureModalOpen} onOpenChange={setIsSignatureModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {signatureStep === 'pre_questions' ? 'Form Bilgileri' : 'İmza'}
            </DialogTitle>
          </DialogHeader>

          {/* Pre-Signature Questions */}
          {signatureStep === 'pre_questions' && (
            <div className="space-y-6 py-4">
              {/* Cihaz Durumu */}
              <div className="space-y-3">
                <Label className="text-base font-medium">
                  Cihaz Durumu <span className="text-destructive">*</span>
                </Label>
                <RadioGroup value={cihazDurumu} onValueChange={(v) => setCihazDurumu(v as CihazDurumu)}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="calisiyor" id="calisiyor" />
                    <Label htmlFor="calisiyor">Çalışıyor</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="arizali" id="arizali" />
                    <Label htmlFor="arizali">Arızalı</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="denemede" id="denemede" />
                    <Label htmlFor="denemede">Denemede</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="diger" id="diger" />
                    <Label htmlFor="diger">Diğer</Label>
                  </div>
                </RadioGroup>
                {cihazDurumu === 'diger' && (
                  <Input
                    placeholder="Açıklama (zorunlu)"
                    value={cihazDurumuAciklama}
                    onChange={(e) => setCihazDurumuAciklama(e.target.value)}
                    className={!cihazDurumuAciklama ? 'border-destructive' : ''}
                  />
                )}
              </div>

              {/* Eşlik Eden Personel */}
              <div className="space-y-3">
                <Label className="text-base font-medium">
                  Kurum Ziyaretinde Eşlik Eden Personel
                  <span className="text-muted-foreground text-sm font-normal ml-2">(Opsiyonel)</span>
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Personel ara..."
                    value={personelSearchQuery}
                    onChange={(e) => setPersonelSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <ScrollArea className="h-40 border rounded-md">
                  <div className="p-2 space-y-1">
                    {filteredUsers.map(user => (
                      <button
                        key={user.uid}
                        onClick={() => toggleEslikEdenPersonel(user)}
                        className={`w-full text-left p-2 rounded-md transition-colors flex items-center justify-between ${
                          eslikEdenPersonel.find(p => p.uid === user.uid)
                            ? 'bg-primary/10 border-primary border'
                            : 'hover:bg-muted'
                        }`}
                      >
                        <div>
                          <p className="font-medium">{user.name || user.email}</p>
                          <p className="text-xs text-muted-foreground capitalize">{user.role?.replace('_', ' ')}</p>
                        </div>
                        {eslikEdenPersonel.find(p => p.uid === user.uid) && (
                          <span className="text-primary text-xs">Seçildi</span>
                        )}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
                {eslikEdenPersonel.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Seçilen: {eslikEdenPersonel.map(p => p.name).join(', ')}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsSignatureModalOpen(false)}>İptal</Button>
                <Button onClick={proceedToSignature}>
                  İmzaya Geç
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Personnel Signature */}
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

          {/* Technician Signature */}
          {signatureStep === 'technician' && (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">Teknisyen</p>
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
