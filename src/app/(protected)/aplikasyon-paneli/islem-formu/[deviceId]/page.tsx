'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, addDoc, serverTimestamp, query, getDocs, where } from 'firebase/firestore';
import type { Device, Hospital } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, Wrench, ClipboardList, Trash2, Save, History } from 'lucide-react';
import BackButton from '@/components/BackButton';
import Image from 'next/image';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import SignaturePad from '@/components/SignaturePad';
import type { SignaturePadRef } from '@/components/SignaturePad';

// Part change types (Parça Değişimi)
type PartChangeType = 'lamba_degisimi' | 'kuvet_degisimi' | 'reaktif_degisimi' | '';

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

type ActionItem = {
  id: string;
  type: 'part_change' | 'operation';
  action: PartChangeType | OperationType | '';
  quantity: number;
  description?: string;
};

type ActionFormRecord = {
    id: string;
    createdAt: { toDate: () => Date };
    createdByName: string;
    actions: ActionItem[];
    personnelSignature?: string;
    technicianSignature?: string;
};

const PART_CHANGE_LABELS: Record<PartChangeType, string> = {
  '': 'Parça Seçin',
  lamba_degisimi: 'Lamba Değişimi',
  kuvet_degisimi: 'Küvet Değişimi',
  reaktif_degisimi: 'Reaktif Değişimi',
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

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ActionFormRecord[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [signatureStep, setSignatureStep] = useState<'personnel' | 'technician'>('personnel');
  const personnelSignatureRef = useRef<SignaturePadRef>(null);
  const technicianSignatureRef = useRef<SignaturePadRef>(null);
  const [signatures, setSignatures] = useState<{ personnel?: string; technician?: string }>({});

  // Operation selection modal
  const [isOperationModalOpen, setIsOperationModalOpen] = useState(false);
  const [selectedOperations, setSelectedOperations] = useState<OperationType[]>([]);
  const [digerAciklama, setDigerAciklama] = useState('');

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

  const addPartChangeRow = () => {
    setActions(prev => [...prev, { id: crypto.randomUUID(), type: 'part_change', action: '', quantity: 1, description: '' }]);
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
    // Validate part changes have selection
    const invalidPartChange = actions.find(a => a.type === 'part_change' && (!a.action || a.quantity <= 0));
    if (invalidPartChange) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm parça değişimi satırlarında bir parça seçin ve geçerli bir adet girin.', variant: 'destructive' });
      return;
    }

    // Validate "diger" operation has description
    const invalidDiger = actions.find(a => a.action === 'diger' && !a.description?.trim());
    if (invalidDiger) {
      toast({ title: 'Eksik Bilgi', description: '"Diğer" işlemi için açıklama zorunludur.', variant: 'destructive' });
      return;
    }

    setSignatures({});
    setSignatureStep('personnel');
    setIsSignatureModalOpen(true);
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
            personnelSignature: finalSignatures.personnel || null,
            technicianSignature: finalSignatures.technician || null,
            createdAt: serverTimestamp(),
            createdByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
            createdByUid: currentUserProfile?.uid,
            formType: 'aplikasyon',
        });
        toast({title: 'Başarılı', description: `İşlem formu #${docRef.id.substring(0,6)}... kaydedildi.`});
        setActions([]);
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
      return PART_CHANGE_LABELS[item.action as PartChangeType] || item.action;
    }
    return OPERATION_LABELS[item.action as OperationType] || item.action;
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
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              <Button onClick={addPartChangeRow} variant="outline">
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
                    <TableHead className="w-24">Adet</TableHead>
                    <TableHead className="w-48">Açıklama</TableHead>
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
                          <span className={`text-xs font-medium px-2 py-1 rounded ${item.type === 'part_change' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                            {item.type === 'part_change' ? 'Parça' : 'İşlem'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {item.type === 'part_change' ? (
                            <Select value={item.action} onValueChange={(v) => updateAction(item.id, 'action', v)}>
                              <SelectTrigger><SelectValue placeholder="Parça seçin..."/></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="lamba_degisimi">Lamba Değişimi</SelectItem>
                                <SelectItem value="kuvet_degisimi">Küvet Değişimi</SelectItem>
                                <SelectItem value="reaktif_degisimi">Reaktif Değişimi</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="font-medium">{OPERATION_LABELS[item.action as OperationType] || item.action}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.type === 'part_change' ? (
                            <Input type="number" value={item.quantity} onChange={(e) => updateAction(item.id, 'quantity', Number(e.target.value))} min="1"/>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.action === 'diger' || item.type === 'part_change' ? (
                            <Input
                              type="text"
                              value={item.description || ''}
                              onChange={(e) => updateAction(item.id, 'description', e.target.value)}
                              placeholder={item.action === 'diger' ? 'Açıklama (zorunlu)' : 'Açıklama...'}
                              className={item.action === 'diger' && !item.description ? 'border-destructive' : ''}
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

      {/* History Modal */}
      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="max-w-3xl">
            <DialogHeader>
                <DialogTitle>Aplikasyon İşlem Geçmişi: {device.cihazAdi}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] mt-4">
                {isHistoryLoading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin"/></div> :
                 history.length === 0 ? <p className="text-center text-muted-foreground p-8">Bu cihaz için geçmiş aplikasyon işlem formu bulunmuyor.</p> :
                 (
                    <Table>
                        <TableHeader><TableRow><TableHead>Tarih</TableHead><TableHead>Kullanıcı</TableHead><TableHead>İşlemler</TableHead></TableRow></TableHeader>
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
                                                    ? `${PART_CHANGE_LABELS[act.action as PartChangeType] || act.action}: ${act.quantity} adet`
                                                    : OPERATION_LABELS[act.action as OperationType] || act.action
                                                  }
                                                  {act.description && <span className="text-muted-foreground ml-1">({act.description})</span>}
                                                </li>
                                            ))}
                                        </ul>
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
            <DialogTitle>İmza</DialogTitle>
          </DialogHeader>
          {signatureStep === 'personnel' && (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">İşlemi Yapan Personel</p>
              <SignaturePad ref={personnelSignatureRef} />
              <DialogFooter className="mt-4 gap-2">
                <Button variant="outline" onClick={() => { personnelSignatureRef.current?.clear(); }}>Temizle</Button>
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
