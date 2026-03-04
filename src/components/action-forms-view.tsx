'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { resolveImageSrc } from '@/lib/image-utils';
import { Calendar, ChevronRight, FileText, Loader2, ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Device, Hospital } from '@/lib/types';
import TeknikServisTutanakPDFButton from '@/components/exports/TeknikServisTutanakPDFButton';
import AplikasyonTutanakPDFButton from '@/components/exports/AplikasyonTutanakPDFButton';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';

type ModuleType = 'teknik-servis' | 'aplikasyon-paneli';

type ActionRecord = {
  id: string;
  deviceId: string;
  cihazAdi?: string;
  seriNumarasi?: string;
  hospitalId?: string;
  labName?: string;
  aciklama?: string;
  islemTipi?: string;
  islemTuru?: string;
  createdAt?: { toDate?: () => Date };
  createdByName?: string;
  createdByUid?: string;
  baslangicSaati?: string;
  bitisSaati?: string;
  cihazDurumu?: string;
  selectedFaultName?: string;
  faultName?: string;
  selectedTests?: string[];
  actions?: Array<{
    id?: string;
    type?: string;
    action?: string;
    stokKodu?: string;
    stokAdi?: string;
    quantity?: number;
    description?: string;
    serialNumber?: string;
    removedPartStokKodu?: string;
    removedPartStokAdi?: string;
    removedPartSerialNumber?: string;
    poolWarehouseName?: string;
  }>;
  selectedMaintenanceTasks?: Array<{ id?: string; taskName?: string }>;
};

const ISLEM_TURU_LABELS: Record<string, string> = {
  rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
  periyodik_bakim: 'Periyodik Bakım',
  cihaz_kurulumu: 'Cihaz Kurulumu',
  ariza: 'Arıza',
  sw_update: 'SW Update',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
};

const CIHAZ_DURUMU_LABELS: Record<string, string> = {
  calisiyor: 'Çalışıyor',
  arizali: 'Arızalı',
  denemede: 'Denemede',
  diger: 'Diğer',
};

const ISLEM_TIPI_LABELS: Record<string, string> = {
  cihaz: 'Cihaz',
  ups: 'UPS',
  su_sistemi: 'Su Sistemi',
};

function getCollectionName(moduleType: ModuleType) {
  return moduleType === 'teknik-servis' ? 'teknikServisActionForms' : 'aplikasyonActionForms';
}

function getTitle(moduleType: ModuleType) {
  return moduleType === 'teknik-servis' ? 'Teknik Servis İşlem Formları' : 'Aplikasyon İşlem Formları';
}

export function ActionFormsListView({ moduleType }: { moduleType: ModuleType }) {
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<ActionRecord[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const FORMS_PER_PAGE = 20;

  useEffect(() => {
    const fetchForms = async () => {
      setLoading(true);
      const snap = await getDocs(collection(db, getCollectionName(moduleType)));
      setForms(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ActionRecord));
      setLoading(false);
    };

    fetchForms().catch((error) => {
      console.error('Form list fetch error', error);
      setLoading(false);
    });
  }, [moduleType]);

  useEffect(() => {
    setCurrentPage(1);
  }, [moduleType, currentUserProfile?.uid]);

  const ownForms = useMemo(() => {
    const uid = currentUserProfile?.uid;
    if (!uid) return [];

    return forms
      .filter((form) => form.createdByUid === uid)
      .sort((a, b) => {
        const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return bTime - aTime;
      });
  }, [forms, currentUserProfile?.uid]);

  const totalPages = Math.max(1, Math.ceil(ownForms.length / FORMS_PER_PAGE));
  const clampedPage = Math.min(currentPage, totalPages);
  const pagedForms = useMemo(() => {
    const start = (clampedPage - 1) * FORMS_PER_PAGE;
    return ownForms.slice(start, start + FORMS_PER_PAGE);
  }, [clampedPage, ownForms]);

  return (
    <div className="cihaz-shell px-4 py-6 sm:px-8 sm:py-10">
      <div className="max-w-6xl mx-auto space-y-5">
        <BackButton fallback={`/${moduleType}`} />
        <div className="cihaz-card-strong p-5 sm:p-7">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <FileText className="h-5 w-5 text-[var(--dashboard-accent)]" />
            </span>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-[var(--dashboard-text)]">{getTitle(moduleType)}</h1>
              <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">Sadece sizin oluşturduğunuz işlem formları</p>
            </div>
          </div>
        </div>

        <div className="cihaz-card-strong p-2 sm:p-3">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-[var(--dashboard-muted)]">
              <Loader2 className="h-5 w-5 animate-spin" /> Yükleniyor...
            </div>
          ) : ownForms.length === 0 ? (
            <div className="text-center py-16 text-[var(--dashboard-muted)]">Size ait işlem formu bulunmuyor.</div>
          ) : (
            <div className="space-y-3">
              <ScrollArea className="h-[62vh]">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[var(--dashboard-stroke)]">
                      <TableHead className="text-[var(--dashboard-muted)]">Tarih</TableHead>
                      <TableHead className="text-[var(--dashboard-muted)]">Cihaz</TableHead>
                      <TableHead className="text-[var(--dashboard-muted)]">Laboratuvar</TableHead>
                      <TableHead className="text-[var(--dashboard-muted)]">İşlem Türü</TableHead>
                      <TableHead className="text-[var(--dashboard-muted)]">Oluşturan</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedForms.map((form) => (
                      <TableRow
                        key={form.id}
                        className="cursor-pointer border-[var(--dashboard-stroke)] hover:bg-[var(--dashboard-surface-2)]/50"
                        onClick={() => router.push(`/${moduleType}/tum-formlar/${form.id}`)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3 w-3 text-[var(--dashboard-muted)]" />
                            <span className="text-sm">{form.createdAt?.toDate ? format(form.createdAt.toDate(), 'dd.MM.yyyy', { locale: tr }) : '-'}</span>
                          </div>
                          <span className="text-xs text-[var(--dashboard-muted)] ml-[18px]">{form.createdAt?.toDate ? format(form.createdAt.toDate(), 'HH:mm', { locale: tr }) : ''}</span>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium text-[var(--dashboard-text)]">{form.cihazAdi || '-'}</div>
                          <div className="text-xs text-[var(--dashboard-muted)] font-mono">{form.seriNumarasi || '-'}</div>
                        </TableCell>
                        <TableCell className="text-sm">{form.labName || '-'}</TableCell>
                        <TableCell>
                          <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', form.islemTuru === 'ariza' ? 'bg-red-50 text-red-700 border border-red-200/60' : form.islemTuru === 'periyodik_bakim' ? 'bg-blue-50 text-blue-700 border border-blue-200/60' : 'bg-[var(--dashboard-surface-2)] text-[var(--dashboard-text)]')}>
                            {ISLEM_TURU_LABELS[form.islemTuru || ''] || '-'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{form.createdByName || '-'}</TableCell>
                        <TableCell><ChevronRight className="h-4 w-4 text-[var(--dashboard-muted)]" /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>

              <div className="flex items-center justify-between gap-3 px-2">
                <p className="text-xs text-[var(--dashboard-muted)]">
                  Toplam {ownForms.length} kayıt &middot; Sayfa {clampedPage}/{totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={clampedPage <= 1}
                    className="cihaz-tool-item px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    Önceki
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={clampedPage >= totalPages}
                    className="cihaz-tool-item px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    Sonraki
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--dashboard-muted)] font-medium">{label}</span>
      <span className="text-sm text-[var(--dashboard-text)]">{value}</span>
    </div>
  );
}


function prettifyActionText(value?: string) {
  if (!value) return '-';
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1))
    .join(' ');
}


export function ActionFormDetailView({ moduleType, formId }: { moduleType: ModuleType; formId: string }) {
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ActionRecord | null>(null);
  const [deviceImageUrl, setDeviceImageUrl] = useState<string | null>(null);
  const [labDevices, setLabDevices] = useState<Device[]>([]);
  const [partTransferModalOpen, setPartTransferModalOpen] = useState(false);
  const [selectedActionIndex, setSelectedActionIndex] = useState<number | null>(null);
  const [selectedTargetDeviceId, setSelectedTargetDeviceId] = useState<string>('');
  const [isSavingPartTransfer, setIsSavingPartTransfer] = useState(false);
  const [isAddPartModalOpen, setIsAddPartModalOpen] = useState(false);
  const [isSavingAddedPart, setIsSavingAddedPart] = useState(false);
  const [newPartCode, setNewPartCode] = useState('');
  const [newPartName, setNewPartName] = useState('');
  const [newPartQuantity, setNewPartQuantity] = useState('1');
  const [newPartSerial, setNewPartSerial] = useState('');
  const [removedPartCode, setRemovedPartCode] = useState('');
  const [removedPartName, setRemovedPartName] = useState('');
  const [removedPartSerial, setRemovedPartSerial] = useState('');
  const [newPartNote, setNewPartNote] = useState('');

  useEffect(() => {
    const fetchForm = async () => {
      setLoading(true);
      const ref = doc(db, getCollectionName(moduleType), formId);
      const snap = await getDoc(ref);
      const nextForm = snap.exists() ? ({ id: snap.id, ...snap.data() } as ActionRecord) : null;
      setForm(nextForm);

      if (nextForm?.deviceId) {
        const deviceSnap = await getDoc(doc(db, 'devices', nextForm.deviceId));
        if (deviceSnap.exists()) {
          const data = deviceSnap.data() as Device;
          setDeviceImageUrl(data.imageUrl || null);
        }
      }

      if (nextForm?.hospitalId) {
        const q = query(collection(db, 'devices'), where('hospitalId', '==', nextForm.hospitalId));
        const devicesSnap = await getDocs(q);
        const candidates = devicesSnap.docs
          .map((item) => ({ id: item.id, ...item.data() } as Device))
          .filter((item) => item.id !== nextForm.deviceId);
        setLabDevices(candidates);
      } else {
        setLabDevices([]);
      }

      setLoading(false);
    };

    fetchForm().catch((error) => {
      console.error('Form detail fetch error', error);
      setLoading(false);
    });
  }, [moduleType, formId]);

  const pdfSection = useMemo(() => {
    if (!form) return null;

    const device = { id: form.deviceId, cihazAdi: form.cihazAdi, seriNumarasi: form.seriNumarasi, hospitalId: form.hospitalId } as Device;
    const hospital = form.labName ? ({ id: form.hospitalId || '', name: form.labName } as Hospital) : null;

    if (moduleType === 'teknik-servis') {
      return <TeknikServisTutanakPDFButton device={device} hospital={hospital} actionRecord={form as any} className="ml-auto" />;
    }

    return <AplikasyonTutanakPDFButton device={device} hospital={hospital} actionRecord={form as any} className="ml-auto" />;
  }, [form, moduleType]);

  const openPartTransferModal = (actionIndex: number) => {
    setSelectedActionIndex(actionIndex);
    setSelectedTargetDeviceId('');
    setPartTransferModalOpen(true);
  };

  const savePartTransfer = async () => {
    if (!form || selectedActionIndex === null || !form.actions || !form.actions[selectedActionIndex]) return;
    if (!selectedTargetDeviceId) {
      toast({ title: 'Cihaz seçin', description: 'Lütfen parçanın aktarılacağı cihazı seçin.', variant: 'destructive' });
      return;
    }

    const targetDevice = labDevices.find((item) => item.id === selectedTargetDeviceId);
    if (!targetDevice) {
      toast({ title: 'Cihaz bulunamadı', description: 'Seçilen cihaz listede yok.', variant: 'destructive' });
      return;
    }

    try {
      setIsSavingPartTransfer(true);
      const updatedActions = [...form.actions];
      const currentAction = { ...updatedActions[selectedActionIndex] } as any;

      updatedActions[selectedActionIndex] = {
        ...currentAction,
        reassignedDeviceId: targetDevice.id,
        reassignedDeviceName: (targetDevice.cihazAdi || (targetDevice as any).model || 'Cihaz') as string,
        reassignedDeviceSerial: targetDevice.seriNumarasi || '',
        reassignedAt: new Date(),
        reassignedByUid: currentUserProfile?.uid || '',
        reassignedByName: currentUserProfile?.name || currentUserProfile?.email || '',
      };

      await updateDoc(doc(db, getCollectionName(moduleType), form.id), {
        actions: updatedActions,
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, 'actionFormPartReassignLogs'), {
        formId: form.id,
        moduleType,
        actionIndex: selectedActionIndex,
        stokKodu: currentAction.stokKodu || '',
        stokAdi: currentAction.stokAdi || '',
        fromDeviceId: form.deviceId,
        fromDeviceName: form.cihazAdi || '',
        fromDeviceSerial: form.seriNumarasi || '',
        toDeviceId: targetDevice.id,
        toDeviceName: targetDevice.cihazAdi || (targetDevice as any).model || '',
        toDeviceSerial: targetDevice.seriNumarasi || '',
        labName: form.labName || '',
        hospitalId: form.hospitalId || '',
        updatedByUid: currentUserProfile?.uid || '',
        updatedByName: currentUserProfile?.name || currentUserProfile?.email || '',
        updatedAt: serverTimestamp(),
      });

      setForm((prev) => (prev ? { ...prev, actions: updatedActions as any } : prev));
      setPartTransferModalOpen(false);
      toast({ title: 'Parça aktarımı kaydedildi', description: 'Parça bilgisi seçilen cihaz ile güncellendi.' });
    } catch (error) {
      console.error('Part reassignment error:', error);
      toast({ title: 'Kayıt hatası', description: 'Parça aktarımı kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSavingPartTransfer(false);
    }
  };

  const resetPartModalState = () => {
    setNewPartCode('');
    setNewPartName('');
    setNewPartQuantity('1');
    setNewPartSerial('');
    setRemovedPartCode('');
    setRemovedPartName('');
    setRemovedPartSerial('');
    setNewPartNote('');
  };

  const saveAddedPart = async () => {
    if (!form) return;

    if (!newPartCode.trim() || !newPartName.trim()) {
      toast({ title: 'Eksik bilgi', description: 'Parça kodu ve parça adı zorunludur.', variant: 'destructive' });
      return;
    }

    const quantity = Number(newPartQuantity || '1');
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast({ title: 'Geçersiz adet', description: 'Adet 0’dan büyük olmalıdır.', variant: 'destructive' });
      return;
    }

    const appendedAction = {
      id: nanoid(),
      type: 'part_change',
      action: newPartName.trim(),
      stokKodu: newPartCode.trim(),
      stokAdi: newPartName.trim(),
      quantity,
      serialNumber: newPartSerial.trim(),
      removedPartStokKodu: removedPartCode.trim(),
      removedPartStokAdi: removedPartName.trim(),
      removedPartSerialNumber: removedPartSerial.trim(),
      description: newPartNote.trim(),
      isManualEntry: true,
      addedAfterSave: true,
      addedAfterSaveAt: new Date(),
      addedAfterSaveByUid: currentUserProfile?.uid || '',
      addedAfterSaveByName: currentUserProfile?.name || currentUserProfile?.email || '',
    };

    const updatedActions = [...(form.actions || []), appendedAction] as any[];

    try {
      setIsSavingAddedPart(true);
      await updateDoc(doc(db, getCollectionName(moduleType), form.id), {
        actions: updatedActions,
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, 'actionFormHistoryLogs'), {
        formId: form.id,
        moduleType,
        type: 'part_added_after_save',
        part: {
          stokKodu: appendedAction.stokKodu,
          stokAdi: appendedAction.stokAdi,
          quantity: appendedAction.quantity,
          serialNumber: appendedAction.serialNumber || '',
          removedPartStokKodu: appendedAction.removedPartStokKodu || '',
          removedPartStokAdi: appendedAction.removedPartStokAdi || '',
          removedPartSerialNumber: appendedAction.removedPartSerialNumber || '',
          description: appendedAction.description || '',
        },
        updatedByUid: currentUserProfile?.uid || '',
        updatedByName: currentUserProfile?.name || currentUserProfile?.email || '',
        updatedAt: serverTimestamp(),
      });

      setForm((prev) => (prev ? { ...prev, actions: updatedActions as any } : prev));
      setIsAddPartModalOpen(false);
      resetPartModalState();
      toast({ title: 'Parça eklendi', description: 'Değişen parça forma ve form geçmişine kaydedildi.' });
    } catch (error) {
      console.error('Add part after save error:', error);
      toast({ title: 'Kayıt hatası', description: 'Parça kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSavingAddedPart(false);
    }
  };

  return (
    <div className="cihaz-shell px-4 py-6 sm:px-8 sm:py-10">
      <div className="max-w-5xl mx-auto space-y-5">
        <button onClick={() => router.push(`/${moduleType}/tum-formlar`)} className="cihaz-focus-ring flex items-center gap-1.5 text-sm text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]">
          <ArrowLeft className="h-4 w-4" /> Listeye Dön
        </button>

        {loading ? (
          <div className="cihaz-card-strong p-16 flex justify-center text-[var(--dashboard-muted)]"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !form ? (
          <div className="cihaz-card-strong p-10 text-center text-[var(--dashboard-muted)]">Form bulunamadı.</div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              {pdfSection}
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddPartModalOpen(true)}
                className="ml-auto"
              >
                Değişen Parça Ekle
              </Button>
            </div>
            <div className="cihaz-card p-5 space-y-4">
              <div className="pb-3 border-b border-[var(--dashboard-stroke)] flex items-start gap-3">
                {deviceImageUrl ? (
                  <div className="w-16 h-16 rounded-xl border border-[var(--dashboard-stroke)] bg-white/70 overflow-hidden shrink-0">
                    <Image src={resolveImageSrc(deviceImageUrl)} alt={form.cihazAdi || 'Cihaz'} width={64} height={64} className="w-full h-full object-contain" />
                  </div>
                ) : null}
                <div>
                  <h3 className="text-base font-semibold text-[var(--dashboard-text)]">{form.cihazAdi || 'Cihaz'}</h3>
                  <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">Seri No: {form.seriNumarasi || '-'} · {form.labName || '-'}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <InfoField label="Form ID" value={`${form.id.slice(0, 8)}...`} />
                <InfoField label="Oluşturan" value={form.createdByName || '-'} />
                <InfoField label="Tarih" value={form.createdAt?.toDate ? format(form.createdAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'} />
                <InfoField label="İşlem Tipi" value={ISLEM_TIPI_LABELS[form.islemTipi || ''] || '-'} />
                <InfoField label="İşlem Türü" value={ISLEM_TURU_LABELS[form.islemTuru || ''] || '-'} />
                <InfoField label="Cihaz Durumu" value={CIHAZ_DURUMU_LABELS[form.cihazDurumu || ''] || '-'} />
                {form.baslangicSaati && <InfoField label="Başlangıç" value={form.baslangicSaati} />}
                {form.bitisSaati && <InfoField label="Bitiş" value={form.bitisSaati} />}
              </div>

              {(form.selectedFaultName || form.faultName) && (
                <div className="pt-3 border-t border-[var(--dashboard-stroke)]">
                  <div className="flex items-center gap-1.5 mb-1.5"><AlertTriangle className="h-4 w-4 text-red-500" /><span className="text-sm font-medium">Tespit Edilen Arıza</span></div>
                  <p className="text-sm text-red-600">{form.selectedFaultName || form.faultName}</p>
                </div>
              )}

              {form.actions && form.actions.length > 0 && (
                <div className="pt-3 border-t border-[var(--dashboard-stroke)] space-y-2">
                  <div className="text-sm font-medium text-[var(--dashboard-text)]">Yapılan İşlemler ve Yedek Parça Değişimleri</div>
                  {form.actions.map((action, idx) => (
                    <div key={action.id || idx} className="rounded-xl border border-[var(--dashboard-stroke)] p-3 bg-[var(--dashboard-surface-2)]/40 text-sm">
                      <div className="font-medium text-[var(--dashboard-text)]">{prettifyActionText(action.action)}</div>
                      <div className="text-xs text-[var(--dashboard-muted)] mt-1 flex items-center gap-2 flex-wrap">
                        <span>{action.type === 'part_change' ? `Yedek Parça · ${action.stokKodu || '-'} / ${action.stokAdi || '-'} · Adet: ${action.quantity || 0}` : 'Operasyon'}</span>
                        {(action as any).isPostClosure && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 border border-orange-200">Sonradan Eklendi{(action as any).addedByName ? ` - ${(action as any).addedByName}` : ''}</span>
                        )}
                      </div>
                      {action.type === 'part_change' && (
                        <div className="flex items-center gap-2 flex-wrap mt-2">
                          {action.stokKodu && <span className="text-[11px] px-2 py-1 rounded-full bg-blue-100 text-blue-700 border border-blue-200">Stok: {action.stokKodu}</span>}
                          {action.stokAdi && <span className="text-[11px] px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">{action.stokAdi}</span>}
                          {!!action.quantity && <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">Adet: {action.quantity}</span>}
                          {(action as any).reassignedDeviceName && (
                            <span className="text-[11px] px-2 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                              Yeni Cihaz: {(action as any).reassignedDeviceName} {(action as any).reassignedDeviceSerial ? `(${(action as any).reassignedDeviceSerial})` : ''}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => openPartTransferModal(idx)}
                            className="cihaz-tool-item inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px]"
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Değişim
                          </button>
                        </div>
                      )}
                      {(action.serialNumber || action.poolWarehouseName) && <div className="text-xs text-[var(--dashboard-muted)] mt-0.5">{action.serialNumber ? `Seri: ${action.serialNumber}` : ''} {action.poolWarehouseName ? `· Depo: ${action.poolWarehouseName}` : ''}</div>}
                      {(action.removedPartStokKodu || action.removedPartStokAdi || action.removedPartSerialNumber) && (
                        <div className="text-xs text-[var(--dashboard-muted)] mt-0.5">Sökülen Parça: {action.removedPartStokKodu || '-'} / {action.removedPartStokAdi || '-'} {action.removedPartSerialNumber ? `· Seri: ${action.removedPartSerialNumber}` : ''}</div>
                      )}
                      {action.description && <div className="text-xs text-[var(--dashboard-text)] mt-1">Not: {action.description}</div>}
                    </div>
                  ))}
                </div>
              )}

              {form.selectedMaintenanceTasks && form.selectedMaintenanceTasks.length > 0 && (
                <div className="pt-3 border-t border-[var(--dashboard-stroke)]">
                  <div className="text-sm font-medium mb-2">Periyodik Bakım Kalemleri</div>
                  <div className="flex flex-wrap gap-2">{form.selectedMaintenanceTasks.map((task, index) => <span key={task.id || index} className="text-xs px-2.5 py-1 rounded-full bg-[var(--dashboard-surface-2)]">{task.taskName || task.id || 'Bakım Kalemi'}</span>)}</div>
                </div>
              )}

              {form.selectedTests && form.selectedTests.length > 0 && (
                <div className="pt-3 border-t border-[var(--dashboard-stroke)]">
                  <div className="text-sm font-medium mb-2">İlişkili Testler</div>
                  <div className="flex flex-wrap gap-2">{form.selectedTests.map((test, index) => <span key={`${test}-${index}`} className="text-xs px-2.5 py-1 rounded-full bg-[var(--dashboard-surface-2)]">{test}</span>)}</div>
                </div>
              )}

              {form.aciklama && (
                <div className="pt-3 border-t border-[var(--dashboard-stroke)]">
                  <div className="text-sm font-medium mb-1.5">Açıklama</div>
                  <p className="text-sm text-[var(--dashboard-muted)] whitespace-pre-wrap">{form.aciklama}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={partTransferModalOpen} onOpenChange={setPartTransferModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Yedek Parçayı Başka Cihaza Aktar</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[var(--dashboard-muted)]">Aynı laboratuvardaki cihazlardan birini seçin (mevcut form cihazı hariç).</p>
            <div className="max-h-[40vh] overflow-y-auto border border-[var(--dashboard-stroke)] rounded-xl p-2 space-y-1">
              {labDevices.length === 0 ? (
                <p className="text-sm text-[var(--dashboard-muted)] p-2">Seçilebilecek başka cihaz bulunamadı.</p>
              ) : (
                labDevices.map((device) => {
                  const label = `${device.cihazAdi || (device as any).model || 'Cihaz'} - ${device.seriNumarasi || '-'}`;
                  const isSelected = selectedTargetDeviceId === device.id;
                  return (
                    <button
                      type="button"
                      key={device.id}
                      onClick={() => setSelectedTargetDeviceId(device.id)}
                      className={cn('w-full text-left px-3 py-2 rounded-lg text-sm border', isSelected ? 'bg-amber-50 border-amber-300 text-amber-900' : 'border-transparent hover:bg-[var(--dashboard-surface-2)]')}
                    >
                      {label}
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPartTransferModalOpen(false)}>İptal</Button>
              <Button onClick={savePartTransfer} disabled={isSavingPartTransfer || !selectedTargetDeviceId || labDevices.length === 0}>
                {isSavingPartTransfer ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Kaydet'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAddPartModalOpen}
        onOpenChange={(open) => {
          setIsAddPartModalOpen(open);
          if (!open) resetPartModalState();
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Değişen Parça Ekle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-[var(--dashboard-muted)]">Parça Kodu *</label>
                <Input value={newPartCode} onChange={(e) => setNewPartCode(e.target.value)} placeholder="Örn: D1" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--dashboard-muted)]">Parça Adı *</label>
                <Input value={newPartName} onChange={(e) => setNewPartName(e.target.value)} placeholder="Örn: Halogen Lamp" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--dashboard-muted)]">Adet *</label>
                <Input type="number" min={1} value={newPartQuantity} onChange={(e) => setNewPartQuantity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--dashboard-muted)]">Takılan Seri No</label>
                <Input value={newPartSerial} onChange={(e) => setNewPartSerial(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--dashboard-muted)]">Sökülen Parça Kodu</label>
                <Input value={removedPartCode} onChange={(e) => setRemovedPartCode(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--dashboard-muted)]">Sökülen Parça Adı</label>
                <Input value={removedPartName} onChange={(e) => setRemovedPartName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--dashboard-muted)]">Sökülen Parça Seri No</label>
              <Input value={removedPartSerial} onChange={(e) => setRemovedPartSerial(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--dashboard-muted)]">Not</label>
              <Input value={newPartNote} onChange={(e) => setNewPartNote(e.target.value)} placeholder="İsteğe bağlı" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsAddPartModalOpen(false)}>İptal</Button>
              <Button onClick={saveAddedPart} disabled={isSavingAddedPart}>
                {isSavingAddedPart ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Kaydet'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
