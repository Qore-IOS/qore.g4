'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Timestamp, addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { resolveImageSrc } from '@/lib/image-utils';
import { Calendar, ChevronRight, FileText, Loader2, ArrowLeft, AlertTriangle, RefreshCw, Search, Package, Plus, Camera, Image as ImageIcon, X } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Depot, Device, DeviceLabPool, Hospital, PersonalStockItem, PoolWarehouseStockItem } from '@/lib/types';
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
    personalStockId?: string;
    poolStockId?: string;
    poolWarehouseId?: string;
    isManualEntry?: boolean;
    removedPartImageUrl?: string;
    usedPartImageUrl?: string;
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
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [personalStock, setPersonalStock] = useState<PersonalStockItem[]>([]);
  const [poolStockItems, setPoolStockItems] = useState<PoolWarehouseStockItem[]>([]);
  const [partSearchQuery, setPartSearchQuery] = useState('');
  const [selectedStockItem, setSelectedStockItem] = useState<PersonalStockItem | null>(null);
  const [selectedPoolStockItem, setSelectedPoolStockItem] = useState<PoolWarehouseStockItem | null>(null);
  const [stockSourceTab, setStockSourceTab] = useState<'personal' | 'pool'>('personal');
  const [manualPartCode, setManualPartCode] = useState('');
  const [manualPartName, setManualPartName] = useState('');
  const [manualSerialNumber, setManualSerialNumber] = useState('');
  const [partQuantity, setPartQuantity] = useState(1);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [removedPartStokKodu, setRemovedPartStokKodu] = useState('');
  const [removedPartStokAdi, setRemovedPartStokAdi] = useState('');
  const [removedPartSerialNumber, setRemovedPartSerialNumber] = useState('');
  const [removedPartImageFile, setRemovedPartImageFile] = useState<File | null>(null);
  const [removedPartImagePreview, setRemovedPartImagePreview] = useState<string | null>(null);
  const [usedPartImageFile, setUsedPartImageFile] = useState<File | null>(null);
  const [usedPartImagePreview, setUsedPartImagePreview] = useState<string | null>(null);
  const removedPartImageInputRef = useRef<HTMLInputElement>(null);
  const usedPartImageInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    (async () => {
      try {
        const q = query(
          collection(db, 'personalStock'),
          where('ownerUid', '==', currentUserProfile.uid),
          where('status', '==', 'in_stock')
        );
        const snap = await getDocs(q);
        setPersonalStock(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PersonalStockItem)));
      } catch (error) {
        console.error('Error fetching personal stock:', error);
      }
    })();
  }, [currentUserProfile?.uid]);

  useEffect(() => {
    if (!form?.hospitalId) return;
    (async () => {
      try {
        const poolsSnap = await getDocs(collection(db, 'deviceLabPools'));
        const matchingPoolIds = poolsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as DeviceLabPool))
          .filter((pool) => pool.memberIds?.includes(form.hospitalId || ''))
          .map((pool) => pool.id);

        if (matchingPoolIds.length === 0) {
          setPoolStockItems([]);
          return;
        }

        const depotsSnap = await getDocs(collection(db, 'depots'));
        const poolWarehouseIds = depotsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Depot))
          .filter((depot) => depot.isPoolWarehouse && depot.linkedDeviceLabPoolIds?.some((id) => matchingPoolIds.includes(id)))
          .map((depot) => depot.id);

        if (poolWarehouseIds.length === 0) {
          setPoolStockItems([]);
          return;
        }

        const allPoolStock: PoolWarehouseStockItem[] = [];
        for (const warehouseId of poolWarehouseIds) {
          const stockQ = query(
            collection(db, 'poolWarehouseStock'),
            where('poolWarehouseId', '==', warehouseId),
            where('status', '==', 'in_stock')
          );
          const stockSnap = await getDocs(stockQ);
          stockSnap.docs.forEach((d) => allPoolStock.push({ id: d.id, ...d.data() } as PoolWarehouseStockItem));
        }
        setPoolStockItems(allPoolStock);
      } catch (error) {
        console.error('Error fetching pool stock:', error);
      }
    })();
  }, [form?.hospitalId]);

  const filteredStock = useMemo(() => {
    if (!partSearchQuery) return personalStock;
    const q = partSearchQuery.toLowerCase();
    return personalStock.filter((p) =>
      p.stokKodu.toLowerCase().includes(q) || p.stokAdi.toLowerCase().includes(q) || p.serialNumber.toLowerCase().includes(q)
    );
  }, [partSearchQuery, personalStock]);

  const filteredPoolStock = useMemo(() => {
    if (!partSearchQuery) return poolStockItems;
    const q = partSearchQuery.toLowerCase();
    return poolStockItems.filter((p) =>
      p.stokKodu.toLowerCase().includes(q) || p.stokAdi.toLowerCase().includes(q) || p.serialNumber.toLowerCase().includes(q)
    );
  }, [partSearchQuery, poolStockItems]);

  const installedPartDefaults = useMemo(() => ({
    stokKodu: showManualEntry ? manualPartCode.trim() : (selectedStockItem?.stokKodu || selectedPoolStockItem?.stokKodu || ''),
    stokAdi: showManualEntry ? manualPartName.trim() : (selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || ''),
  }), [showManualEntry, manualPartCode, manualPartName, selectedStockItem, selectedPoolStockItem]);

  useEffect(() => {
    if (!isAddPartModalOpen) return;
    setRemovedPartStokKodu(installedPartDefaults.stokKodu);
    setRemovedPartStokAdi(installedPartDefaults.stokAdi);
  }, [isAddPartModalOpen, installedPartDefaults]);

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
    setPartSearchQuery('');
    setSelectedStockItem(null);
    setSelectedPoolStockItem(null);
    setStockSourceTab('personal');
    setManualPartCode('');
    setManualPartName('');
    setManualSerialNumber('');
    setPartQuantity(1);
    setShowManualEntry(false);
    setRemovedPartStokKodu('');
    setRemovedPartStokAdi('');
    setRemovedPartSerialNumber('');
    setRemovedPartImageFile(null);
    setRemovedPartImagePreview(null);
    setUsedPartImageFile(null);
    setUsedPartImagePreview(null);
  };

  const handleRemovedPartImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRemovedPartImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setRemovedPartImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleUsedPartImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUsedPartImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setUsedPartImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const uploadPartImage = async (file: File, pathPrefix: 'removed-parts' | 'used-parts'): Promise<string | null> => {
    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', pathPrefix);
      formData.append('deviceId', form?.deviceId || 'unknown-device');

      const response = await fetch('/api/storage/upload-image', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'Resim yüklenemedi.');
      }

      return payload.url as string;
    } catch (error: any) {
      toast({ title: 'Hata', description: error?.message || 'Resim yüklenemedi.', variant: 'destructive' });
      return null;
    } finally {
      setIsUploadingImage(false);
    }
  };

  const saveAddedPart = async () => {
    if (!form) return;

    if (!selectedStockItem && !selectedPoolStockItem && !(showManualEntry && manualPartCode && manualPartName && manualSerialNumber)) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen stoktan bir parça seçin veya manuel giriş yapın.', variant: 'destructive' });
      return;
    }

    let removedPartImageUrl: string | undefined;
    if (removedPartImageFile) {
      removedPartImageUrl = (await uploadPartImage(removedPartImageFile, 'removed-parts')) || undefined;
    }

    let usedPartImageUrl: string | undefined;
    if (usedPartImageFile) {
      usedPartImageUrl = (await uploadPartImage(usedPartImageFile, 'used-parts')) || undefined;
    }

    const isManual = showManualEntry;
    const stokKodu = isManual ? manualPartCode.trim() : (selectedStockItem?.stokKodu || selectedPoolStockItem?.stokKodu || '');
    const stokAdi = isManual ? manualPartName.trim() : (selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || '');
    const serialNumber = isManual ? manualSerialNumber.trim() : (selectedStockItem?.serialNumber || selectedPoolStockItem?.serialNumber || '');
    const quantity = isManual ? partQuantity : 1;

    const appendedAction = {
      id: crypto.randomUUID(),
      type: 'part_change',
      action: isManual ? 'manual_part' : (selectedStockItem?.productCodeId || selectedPoolStockItem?.productCodeId || stokAdi),
      stokKodu,
      stokAdi,
      quantity,
      serialNumber,
      personalStockId: selectedStockItem?.id,
      poolStockId: selectedPoolStockItem?.id,
      poolWarehouseId: selectedPoolStockItem?.poolWarehouseId,
      poolWarehouseName: selectedPoolStockItem?.poolWarehouseName,
      removedPartStokKodu: removedPartStokKodu.trim(),
      removedPartStokAdi: removedPartStokAdi.trim(),
      removedPartSerialNumber: removedPartSerialNumber.trim(),
      removedPartImageUrl,
      usedPartImageUrl,
      isManualEntry: isManual,
    };

    const updatedActions = [...(form.actions || []), appendedAction] as any[];

    try {
      setIsSavingAddedPart(true);
      const now = new Date();
      const formType = moduleType === 'teknik-servis' ? 'teknik_servis' : 'aplikasyon';
      const batch = writeBatch(db);

      batch.update(doc(db, getCollectionName(moduleType), form.id), {
        actions: updatedActions,
        updatedAt: serverTimestamp(),
      });

      const historyRef = doc(collection(db, 'actionFormHistoryLogs'));
      batch.set(historyRef, {
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
          removedPartImageUrl: appendedAction.removedPartImageUrl || '',
          usedPartImageUrl: appendedAction.usedPartImageUrl || '',
        },
        updatedByUid: currentUserProfile?.uid || '',
        updatedByName: currentUserProfile?.name || currentUserProfile?.email || '',
        updatedAt: serverTimestamp(),
      });

      if (appendedAction.personalStockId) {
        const stockRef = doc(db, 'personalStock', appendedAction.personalStockId);
        batch.update(stockRef, {
          status: 'used',
          usedAt: Timestamp.fromDate(now),
          usedOnDeviceId: form.deviceId,
          usedOnDeviceName: form.cihazAdi || '',
          usedOnFormId: form.id,
          usedOnFormType: formType,
          usedPartImageUrl: appendedAction.usedPartImageUrl || null,
        });

        const useLogRef = doc(collection(db, 'sparePartTransferLogs'));
        batch.set(useLogRef, {
          action: 'use_on_device',
          personalStockId: appendedAction.personalStockId,
          stokKodu: appendedAction.stokKodu,
          stokAdi: appendedAction.stokAdi,
          serialNumber: appendedAction.serialNumber,
          deviceId: form.deviceId,
          deviceName: form.cihazAdi || '',
          labName: form.labName || '',
          formId: form.id,
          formType,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || currentUserProfile?.email || '',
          usageImageUrl: appendedAction.usedPartImageUrl || null,
        });
      }

      if (appendedAction.poolStockId) {
        const poolStockRef = doc(db, 'poolWarehouseStock', appendedAction.poolStockId);
        batch.update(poolStockRef, {
          status: 'used',
          usedAt: Timestamp.fromDate(now),
          usedByUid: currentUserProfile?.uid || '',
          usedByName: currentUserProfile?.name || currentUserProfile?.email || '',
          usedOnDeviceId: form.deviceId,
          usedOnDeviceName: form.cihazAdi || '',
          usedOnFormId: form.id,
          usedOnFormType: formType,
          usedOnLabId: form.hospitalId || '',
          usedOnLabName: form.labName || '',
        });

        const poolUseLogRef = doc(collection(db, 'sparePartTransferLogs'));
        batch.set(poolUseLogRef, {
          action: 'use_from_pool',
          poolStockId: appendedAction.poolStockId,
          poolWarehouseId: appendedAction.poolWarehouseId || '',
          poolWarehouseName: appendedAction.poolWarehouseName || '',
          stokKodu: appendedAction.stokKodu,
          stokAdi: appendedAction.stokAdi,
          serialNumber: appendedAction.serialNumber,
          deviceId: form.deviceId,
          deviceName: form.cihazAdi || '',
          labName: form.labName || '',
          formId: form.id,
          formType,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || currentUserProfile?.email || '',
        });
      }

      await batch.commit();

      setForm((prev) => (prev ? { ...prev, actions: updatedActions as any } : prev));
      if (appendedAction.personalStockId) {
        setPersonalStock((prev) => prev.filter((item) => item.id !== appendedAction.personalStockId));
      }
      if (appendedAction.poolStockId) {
        setPoolStockItems((prev) => prev.filter((item) => item.id !== appendedAction.poolStockId));
      }
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
        <DialogContent className="left-0 right-0 top-auto bottom-0 translate-x-0 translate-y-0 w-screen max-w-none h-[100dvh] max-h-[100dvh] rounded-none border-0 bg-background p-0 shadow-none overflow-hidden sm:left-[50%] sm:right-auto sm:top-[50%] sm:bottom-auto sm:w-full sm:max-w-2xl sm:h-auto sm:max-h-[90vh] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:border sm:shadow-lg">
          <DialogHeader className="px-4 sm:px-6 py-4 border-b border-[var(--dashboard-stroke)]">
            <DialogTitle className="text-lg font-semibold tracking-tight text-[var(--dashboard-text)]">Yedek Parça Değişimi</DialogTitle>
          </DialogHeader>
          <div className="flex-1 px-4 sm:px-6 py-4 space-y-4 overflow-y-auto">
            <div className="p-4 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] space-y-3">
              <Label className="font-semibold text-sm text-[var(--dashboard-text)]">1. Parça Seçin</Label>

              {poolStockItems.length > 0 && !showManualEntry && (
                <div className="flex gap-1 p-1 rounded-xl bg-[var(--dashboard-surface)]" style={{ border: '1px solid var(--dashboard-stroke)' }}>
                  <button onClick={() => { setStockSourceTab('personal'); setSelectedPoolStockItem(null); }} className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all" style={{ background: stockSourceTab === 'personal' ? 'var(--dashboard-surface-2)' : 'transparent', color: stockSourceTab === 'personal' ? 'var(--dashboard-text)' : 'var(--dashboard-muted)', boxShadow: stockSourceTab === 'personal' ? 'var(--dashboard-raised-soft)' : 'none' }}>
                    <Package className="h-3 w-3 inline mr-1" />Şahsi Stok ({personalStock.length})
                  </button>
                  <button onClick={() => { setStockSourceTab('pool'); setSelectedStockItem(null); }} className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all" style={{ background: stockSourceTab === 'pool' ? 'var(--dashboard-surface-2)' : 'transparent', color: stockSourceTab === 'pool' ? 'var(--dashboard-text)' : 'var(--dashboard-muted)', boxShadow: stockSourceTab === 'pool' ? 'var(--dashboard-raised-soft)' : 'none' }}>
                    <Package className="h-3 w-3 inline mr-1" />Havuz Stok ({poolStockItems.length})
                  </button>
                </div>
              )}

              {!showManualEntry && stockSourceTab === 'personal' ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Parça kodu, adı veya seri no ile arayın..." value={partSearchQuery} onChange={(e) => setPartSearchQuery(e.target.value)} className="pl-10" />
                  </div>
                  <ScrollArea className="h-44 rounded-xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
                    {filteredStock.length === 0 ? <div className="p-4 text-center text-[var(--dashboard-muted)]">{personalStock.length === 0 ? 'Şahsi stokunuzda yedek parça bulunmuyor.' : 'Sonuç bulunamadı.'}</div> : (
                      <div className="p-2 space-y-1">
                        {filteredStock.map((item) => (
                          <button key={item.id} onClick={() => { setSelectedStockItem(item); setSelectedPoolStockItem(null); }} className={`w-full text-left p-3 rounded-xl transition-colors ${selectedStockItem?.id === item.id ? 'bg-[var(--dashboard-accent)]/10 border border-[var(--dashboard-accent)]/40' : 'hover:bg-[var(--dashboard-surface-2)] border border-transparent'}`}>
                            <div className="flex justify-between items-start"><div><p className="font-medium text-[var(--dashboard-text)]">{item.stokAdi}</p><p className="text-xs text-[var(--dashboard-muted)] font-mono">{item.stokKodu}</p></div><div className="text-right"><p className="text-xs font-mono text-[var(--dashboard-text)]">{item.serialNumber}</p><p className="text-xs text-[var(--dashboard-muted)]">{item.source === 'depot' ? 'Depodan' : 'Cihazdan'}</p></div></div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <button onClick={() => setShowManualEntry(true)} className="w-full text-xs text-[var(--dashboard-accent)] hover:text-[var(--dashboard-accent)]/80 flex items-center justify-center gap-2 py-2 font-medium transition-colors"><Plus className="h-4 w-4" />Stokta yok, manuel ekle</button>
                </>
              ) : !showManualEntry && stockSourceTab === 'pool' ? (
                <>
                  <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input placeholder="Havuz stokta ara..." value={partSearchQuery} onChange={(e) => setPartSearchQuery(e.target.value)} className="pl-10" /></div>
                  <ScrollArea className="h-44 rounded-xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
                    {filteredPoolStock.length === 0 ? <div className="p-4 text-center text-[var(--dashboard-muted)]">{poolStockItems.length === 0 ? 'Havuz depoda yedek parça bulunmuyor.' : 'Sonuç bulunamadı.'}</div> : (
                      <div className="p-2 space-y-1">
                        {filteredPoolStock.map((item) => (
                          <button key={item.id} onClick={() => { setSelectedPoolStockItem(item); setSelectedStockItem(null); }} className={`w-full text-left p-3 rounded-xl transition-colors ${selectedPoolStockItem?.id === item.id ? 'bg-purple-100/80 border border-purple-300/60' : 'hover:bg-[var(--dashboard-surface-2)] border border-transparent'}`}>
                            <div className="flex justify-between items-start"><div><p className="font-medium text-[var(--dashboard-text)]">{item.stokAdi}</p><p className="text-xs text-[var(--dashboard-muted)] font-mono">{item.stokKodu}</p></div><div className="text-right"><p className="text-xs font-mono text-[var(--dashboard-text)]">{item.serialNumber}</p><p className="text-xs text-purple-600">{item.poolWarehouseName}</p></div></div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <button onClick={() => setShowManualEntry(true)} className="w-full text-xs text-[var(--dashboard-accent)] hover:text-[var(--dashboard-accent)]/80 flex items-center justify-center gap-2 py-2 font-medium transition-colors"><Plus className="h-4 w-4" />Stokta yok, manuel ekle</button>
                </>
              ) : (
                <div className="space-y-2">
                  <Input placeholder="Parça Kodu" value={manualPartCode} onChange={(e) => setManualPartCode(e.target.value)} />
                  <Input placeholder="Parça Adı" value={manualPartName} onChange={(e) => setManualPartName(e.target.value)} />
                  <Input placeholder="Seri No" value={manualSerialNumber} onChange={(e) => setManualSerialNumber(e.target.value)} />
                  <Input type="number" min={1} value={partQuantity} onChange={(e) => setPartQuantity(Math.max(1, Number(e.target.value || '1')))} />
                  <button onClick={() => setShowManualEntry(false)} className="w-full text-xs text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] py-1">Stok listesine geri dön</button>
                </div>
              )}
            </div>

            <div className="p-4 rounded-2xl border border-amber-200/80 bg-amber-50/40 space-y-3">
              <Label className="font-semibold text-sm text-[var(--dashboard-text)]">2. Cihazdan Çıkan Parça Bilgisi <span className="font-normal text-[var(--dashboard-muted)]">(zorunlu)</span></Label>
              <div className="space-y-2"><Label className="text-xs">Parça Kodu</Label><Input value={removedPartStokKodu} onChange={(e) => setRemovedPartStokKodu(e.target.value)} placeholder="Takılan parçadan otomatik doldurulur" /><p className="text-xs text-[var(--dashboard-muted)]">Takılan parçanın kodundan otomatik alınır.</p></div>
              <div className="space-y-2"><Label className="text-xs">Seri No (Opsiyonel)</Label><Input value={removedPartSerialNumber} onChange={(e) => setRemovedPartSerialNumber(e.target.value)} placeholder="Çıkan parça seri no..." /></div>
              <div className="space-y-2"><Label className="text-xs">Parça Adı</Label><Input value={removedPartStokAdi} onChange={(e) => setRemovedPartStokAdi(e.target.value)} placeholder="Takılan parçadan otomatik doldurulur" /><p className="text-xs text-[var(--dashboard-muted)]">Takılan parçanın adından otomatik alınır.</p></div>
              <div className="space-y-2"><Label className="text-xs flex items-center gap-1"><Camera className="h-3 w-3" />Çıkan Parça Fotoğrafı (Opsiyonel)</Label><input type="file" accept="image/*" ref={removedPartImageInputRef} onChange={handleRemovedPartImageSelect} className="hidden" />{removedPartImagePreview ? <div className="relative"><img src={removedPartImagePreview} alt="Çıkan parça" className="w-full h-32 object-cover rounded-md border" /><button type="button" className="absolute top-1 right-1 h-6 w-6 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600" onClick={() => { setRemovedPartImageFile(null); setRemovedPartImagePreview(null); if (removedPartImageInputRef.current) removedPartImageInputRef.current.value=''; }}><X className="h-3 w-3" /></button></div> : <button type="button" className="w-full h-16 border border-dashed border-[var(--dashboard-stroke)] rounded-xl flex flex-col items-center justify-center gap-1 hover:bg-[var(--dashboard-surface-2)]" onClick={() => removedPartImageInputRef.current?.click()}><ImageIcon className="h-5 w-5 text-[var(--dashboard-muted)]" /><span className="text-xs text-[var(--dashboard-muted)]">Çıkan parça fotoğrafı (Kamera/Galeri)</span></button>}</div>
              <div className="space-y-2"><Label className="text-xs flex items-center gap-1"><Camera className="h-3 w-3" />Takılan/Kullanılan Parça Fotoğrafı (Opsiyonel)</Label><input type="file" accept="image/*" ref={usedPartImageInputRef} onChange={handleUsedPartImageSelect} className="hidden" />{usedPartImagePreview ? <div className="relative"><img src={usedPartImagePreview} alt="Takılan parça" className="w-full h-32 object-cover rounded-md border" /><button type="button" className="absolute top-1 right-1 h-6 w-6 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600" onClick={() => { setUsedPartImageFile(null); setUsedPartImagePreview(null); if (usedPartImageInputRef.current) usedPartImageInputRef.current.value=''; }}><X className="h-3 w-3" /></button></div> : <button type="button" className="w-full h-16 border border-dashed border-[var(--dashboard-stroke)] rounded-xl flex flex-col items-center justify-center gap-1 hover:bg-[var(--dashboard-surface-2)]" onClick={() => usedPartImageInputRef.current?.click()}><ImageIcon className="h-5 w-5 text-[var(--dashboard-muted)]" /><span className="text-xs text-[var(--dashboard-muted)]">Takılan parça fotoğrafı (Kamera/Galeri)</span></button>}</div>
            </div>

            {(selectedStockItem || selectedPoolStockItem || (showManualEntry && manualPartCode && manualSerialNumber)) && (
              <div className={`p-3 border rounded-xl text-sm ${selectedPoolStockItem ? 'bg-purple-50/80 border-purple-200/60' : 'bg-emerald-50/80 border-emerald-200/60'}`}>
                <p className={`font-medium ${selectedPoolStockItem ? 'text-purple-800' : 'text-emerald-800'}`}>
                  Takılacak: {selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || manualPartName} ({selectedStockItem?.serialNumber || selectedPoolStockItem?.serialNumber || manualSerialNumber})
                  {selectedPoolStockItem && <span className="ml-1 text-xs text-purple-600">(Havuz: {selectedPoolStockItem.poolWarehouseName})</span>}
                </p>
                <p className={selectedPoolStockItem ? 'text-purple-700' : 'text-emerald-700'}>
                  Çıkacak: {removedPartStokAdi || selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || manualPartName} ({removedPartSerialNumber || 'Seri No Yok'})
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="px-4 sm:px-6 py-3 sm:py-4 border-t border-[var(--dashboard-stroke)] grid grid-cols-2 gap-2 sm:flex sm:justify-end sm:gap-2">
            <button className="w-full sm:w-auto cihaz-tool-item px-4 py-2.5 text-sm font-medium" onClick={() => setIsAddPartModalOpen(false)}>İptal</button>
            <button className="w-full sm:w-auto cihaz-tool-item px-4 py-2.5 text-sm font-medium bg-[var(--dashboard-accent)] text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2" onClick={saveAddedPart} disabled={(!selectedStockItem && !selectedPoolStockItem && !(showManualEntry && manualPartCode && manualPartName && manualSerialNumber)) || isUploadingImage || isSavingAddedPart}>
              {(isUploadingImage || isSavingAddedPart) ? <><Loader2 className="h-4 w-4 animate-spin" />Yükleniyor...</> : 'Ekle'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
