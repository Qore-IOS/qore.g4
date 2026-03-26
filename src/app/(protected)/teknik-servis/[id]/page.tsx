
'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import BackButton from '@/components/BackButton';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle, Loader2, Wrench, FilePenLine, FlaskConical, Building2, ChevronDown, ChevronUp, History, CalendarClock, RotateCcw, FileEdit, FilePlus } from 'lucide-react';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  getDocs,
  limit as firestoreLimit,
  updateDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Hospital, Device, DeviceFaultReport, PersonalStockItem, MaintenancePlan, MaintenanceLog, PeriodicPartChange, PeriodicPartChangeLog } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { Package, ArrowLeftRight, Warehouse } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';
import { resolveImageSrc } from '@/lib/image-utils';
import { useToast } from '@/hooks/use-toast';
import { withCompanyScope } from '@/lib/company-scope';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';


export default function TeknikServisDetayPage() {
  const params = useParams();
  const hospitalId = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId } = useAuth();

  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [devicesByHospital, setDevicesByHospital] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  // Real-time open fault reports: deviceId -> faultType
  const [openFaultMap, setOpenFaultMap] = useState<Record<string, 'teknik_servis' | 'aplikasyon'>>({});
  // Track fault report IDs per device for orphan cleanup
  const [openFaultReportIds, setOpenFaultReportIds] = useState<Record<string, string[]>>({});

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [faultIdForSelectedDevice, setFaultIdForSelectedDevice] = useState<string | null>(null);
  const [selectedDeviceFaultType, setSelectedDeviceFaultType] = useState<string | null>(null);

  // Personal stock modal state
  const [isPersonalStockModalOpen, setIsPersonalStockModalOpen] = useState(false);
  const [personalStock, setPersonalStock] = useState<PersonalStockItem[]>([]);
  const [personalStockLoading, setPersonalStockLoading] = useState(false);
  const [processingItemId, setProcessingItemId] = useState<string | null>(null);

  // Diğer Firma Arıza modal state
  const [isDigerFirmaModalOpen, setIsDigerFirmaModalOpen] = useState(false);
  const [digerFirmaAdi, setDigerFirmaAdi] = useState('');
  const [tespitEdilenAriza, setTespitEdilenAriza] = useState('');
  const [yapilanIslem, setYapilanIslem] = useState('');
  const [isDigerFirmaSaving, setIsDigerFirmaSaving] = useState(false);

  // Device fault history state
  const [deviceFaultHistory, setDeviceFaultHistory] = useState<Record<string, { description: string; closedAt: Date }[]>>({});
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set());

  // Maintenance flip state
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [maintenanceData, setMaintenanceData] = useState<Record<string, { taskName: string; daysRemaining: number; type: 'maintenance' | 'part' }[]>>({});
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);

  // Draft continuation state
  const [isDraftModalOpen, setIsDraftModalOpen] = useState(false);
  const [deviceDraft, setDeviceDraft] = useState<{ id: string; createdByName: string; createdAt: Date; updatedByName?: string; updatedAt?: Date } | null>(null);
  const [draftCheckDevice, setDraftCheckDevice] = useState<Device | null>(null);


  // --- Fetch hospital once ---
  useEffect(() => {
    if (!hospitalId) {
      router.push('/teknik-servis');
      return;
    }
    const unsub = onSnapshot(doc(db, 'hospitals', hospitalId), (doc) => {
        if(doc.exists()) {
            setHospital({ id: doc.id, ...(doc.data() as any) });
        }
    });
    return () => unsub();
  }, [hospitalId, router]);

  // --- Live devices for this hospital ---
  useEffect(() => {
    if (!hospitalId) {
      setDevicesByHospital([]);
      return;
    }
    setLoading(true);
    const qDevices = query(collection(db, 'devices'), where('hospitalId', '==', hospitalId));
    const unsub = onSnapshot(
      qDevices,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) } as Device))
          .sort((a, b) => (String(a.order ?? 99)).localeCompare(String(b.order ?? 99)));
        setDevicesByHospital(list);
        setLoading(false);
      },
      (err) => {
        console.error('devices listen error', err);
        toast({ title: 'Hata', description: 'Cihazlar yüklenemedi.', variant: 'destructive' });
        setDevicesByHospital([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [hospitalId, toast]);

  // --- Real-time open fault reports for this hospital's devices ---
  useEffect(() => {
    if (devicesByHospital.length === 0) {
      setOpenFaultMap({});
      return;
    }
    const deviceIds = new Set(devicesByHospital.map(d => d.id));
    const qFaults = query(
      collection(db, 'deviceFaultReports'),
      where('status', 'in', ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'])
    );
    const unsub = onSnapshot(qFaults, (snap) => {
      const map: Record<string, 'teknik_servis' | 'aplikasyon'> = {};
      const idsMap: Record<string, string[]> = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.deviceId && data.faultType && deviceIds.has(data.deviceId)) {
          // Track all fault report IDs per device
          if (!idsMap[data.deviceId]) idsMap[data.deviceId] = [];
          idsMap[data.deviceId].push(d.id);
          // For teknik servis panel: teknik_servis is primary (red), aplikasyon is secondary (amber)
          // If device has both, prefer teknik_servis
          if (map[data.deviceId] === 'teknik_servis') return;
          map[data.deviceId] = data.faultType;
        }
      });
      setOpenFaultMap(map);
      setOpenFaultReportIds(idsMap);
    });
    return () => unsub();
  }, [devicesByHospital]);

  // Auto-cleanup orphaned fault reports: if device.arizaDurumu is 'yok' but openFaultMap has entries
  useEffect(() => {
    if (devicesByHospital.length === 0 || Object.keys(openFaultMap).length === 0) return;

    const orphanedReportIds: string[] = [];
    devicesByHospital.forEach((device) => {
      const deviceFaultStatus = device.arizaDurumu;
      const hasOpenReports = openFaultMap[device.id];
      if (hasOpenReports && (!deviceFaultStatus || deviceFaultStatus === 'yok')) {
        // Device says healthy but there are open fault reports -> orphaned
        const ids = openFaultReportIds[device.id] || [];
        orphanedReportIds.push(...ids);
      }
    });

    if (orphanedReportIds.length === 0) return;

    // Auto-close orphaned fault reports
    const closeOrphans = async () => {
      for (const reportId of orphanedReportIds) {
        try {
          const reportRef = doc(db, 'deviceFaultReports', reportId);
          await updateDoc(reportRef, {
            status: 'cozuldu',
            closedAt: serverTimestamp(),
            closedByUid: 'system',
            closedByName: 'Sistem (Otomatik Temizlik)',
            closeDescription: 'Cihaz sağlıklı durumda olduğu için yetim arıza kaydı otomatik kapatıldı.',
          });
        } catch (err) {
          console.error('Failed to auto-close orphaned fault report:', reportId, err);
        }
      }
    };
    closeOrphans();
  }, [devicesByHospital, openFaultMap, openFaultReportIds]);

  // Fetch fault history for all devices
  useEffect(() => {
    if (devicesByHospital.length === 0) return;

    const fetchFaultHistory = async () => {
      const historyMap: Record<string, { description: string; closedAt: Date }[]> = {};

      for (const device of devicesByHospital) {
        try {
          // Query without orderBy to avoid composite index requirement
          const q = query(
            collection(db, 'deviceFaultReports'),
            where('deviceId', '==', device.id),
            where('status', '==', 'closed')
          );
          const snap = await getDocs(q);
          const faults = snap.docs.map(d => {
            const data = d.data();
            return {
              description: data.description || 'Açıklama yok',
              closedAt: data.closedAt?.toDate?.() || new Date(),
            };
          });
          // Sort by closedAt descending and take top 10
          faults.sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime());
          historyMap[device.id] = faults.slice(0, 10);
        } catch (err) {
          console.error(`Error fetching fault history for device ${device.id}:`, err);
          historyMap[device.id] = [];
        }
      }
      setDeviceFaultHistory(historyMap);
    };

    fetchFaultHistory();
  }, [devicesByHospital]);

  // Fetch maintenance data for all devices
  const fetchMaintenanceData = useCallback(async () => {
    if (devicesByHospital.length === 0) return;
    setMaintenanceLoading(true);
    const result: Record<string, { taskName: string; daysRemaining: number; type: 'maintenance' | 'part' }[]> = {};
    const now = new Date();

    for (const device of devicesByHospital) {
      const items: { taskName: string; daysRemaining: number; type: 'maintenance' | 'part' }[] = [];

      try {
        // Fetch maintenance plans for this device
        const plansQ = query(
          collection(db, 'maintenancePlans'),
          where('deviceId', '==', device.id)
        );
        const plansSnap = await getDocs(plansQ);
        const plans = plansSnap.docs.map(d => ({ id: d.id, ...d.data() } as MaintenancePlan));

        // Fetch maintenance logs for this device
        const logsQ = query(
          collection(db, 'maintenanceLogs'),
          where('deviceId', '==', device.id)
        );
        const logsSnap = await getDocs(logsQ);
        const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() } as MaintenanceLog));

        for (const plan of plans) {
          // Find the latest log for this plan
          const planLogs = logs
            .filter(l => l.planId === plan.id)
            .sort((a, b) => {
              const dateA = a.nextDueDate instanceof Date ? a.nextDueDate : (a.nextDueDate as any)?.toDate?.() || new Date(0);
              const dateB = b.nextDueDate instanceof Date ? b.nextDueDate : (b.nextDueDate as any)?.toDate?.() || new Date(0);
              return dateB.getTime() - dateA.getTime();
            });

          let nextDue: Date | null = null;
          if (planLogs.length > 0) {
            const raw = planLogs[0].nextDueDate;
            nextDue = raw instanceof Date ? raw : (raw as any)?.toDate?.() || null;
          } else {
            // No log exists, calculate from plan creation date
            const created = plan.createdAt instanceof Date ? plan.createdAt : (plan.createdAt as any)?.toDate?.() || now;
            nextDue = new Date(created);
            if (plan.periodUnit === 'hafta') nextDue.setDate(nextDue.getDate() + plan.periodValue * 7);
            else if (plan.periodUnit === 'ay') nextDue.setMonth(nextDue.getMonth() + plan.periodValue);
            else if (plan.periodUnit === 'yil') nextDue.setFullYear(nextDue.getFullYear() + plan.periodValue);
          }

          if (nextDue) {
            const diffMs = nextDue.getTime() - now.getTime();
            const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            items.push({ taskName: plan.taskName, daysRemaining, type: 'maintenance' });
          }
        }

        // Fetch periodic part changes for this device
        const partsQ = query(
          collection(db, 'periodicPartChanges'),
          where('deviceId', '==', device.id)
        );
        const partsSnap = await getDocs(partsQ);
        const parts = partsSnap.docs.map(d => ({ id: d.id, ...d.data() } as PeriodicPartChange));

        // Fetch periodic part change logs for this device
        const partLogsQ = query(
          collection(db, 'periodicPartChangeLogs'),
          where('deviceId', '==', device.id)
        );
        const partLogsSnap = await getDocs(partLogsQ);
        const partLogs = partLogsSnap.docs.map(d => ({ id: d.id, ...d.data() } as PeriodicPartChangeLog));

        for (const part of parts) {
          const relatedLogs = partLogs
            .filter(l => l.periodicPartChangeId === part.id)
            .sort((a, b) => {
              const dateA = a.nextDueDate instanceof Date ? a.nextDueDate : (a.nextDueDate as any)?.toDate?.() || new Date(0);
              const dateB = b.nextDueDate instanceof Date ? b.nextDueDate : (b.nextDueDate as any)?.toDate?.() || new Date(0);
              return dateB.getTime() - dateA.getTime();
            });

          let nextDue: Date | null = null;
          if (relatedLogs.length > 0) {
            const raw = relatedLogs[0].nextDueDate;
            nextDue = raw instanceof Date ? raw : (raw as any)?.toDate?.() || null;
          } else if (part.nextDueDate) {
            nextDue = part.nextDueDate instanceof Date ? part.nextDueDate : (part.nextDueDate as any)?.toDate?.() || null;
          }

          if (nextDue) {
            const diffMs = nextDue.getTime() - now.getTime();
            const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            items.push({ taskName: `${part.stokAdi}`, daysRemaining, type: 'part' });
          }
        }
      } catch (err) {
        console.error(`Error fetching maintenance data for device ${device.id}:`, err);
      }

      // Sort by days remaining ascending
      items.sort((a, b) => a.daysRemaining - b.daysRemaining);
      result[device.id] = items;
    }

    setMaintenanceData(result);
    setMaintenanceLoading(false);
  }, [devicesByHospital]);

  // Fetch maintenance data when toggled on
  useEffect(() => {
    if (showMaintenance && Object.keys(maintenanceData).length === 0) {
      fetchMaintenanceData();
    }
  }, [showMaintenance, maintenanceData, fetchMaintenanceData]);

  const toggleDeviceExpand = (deviceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedDevices(prev => {
      const newSet = new Set(prev);
      if (newSet.has(deviceId)) {
        newSet.delete(deviceId);
      } else {
        newSet.add(deviceId);
      }
      return newSet;
    });
  };

  const handleDeviceClick = async (device: Device) => {
    // Check for existing drafts for this device
    try {
      const draftQuery = query(
        collection(db, 'draftActionForms'),
        where('deviceId', '==', device.id),
        where('formType', '==', 'teknik_servis')
      );
      const draftSnap = await getDocs(draftQuery);

      if (!draftSnap.empty) {
        const draftDoc = draftSnap.docs[0];
        const draftData = draftDoc.data();
        const createdAt = draftData.createdAt?.toDate?.() || new Date(draftData.createdAt);
        const updatedAt = draftData.updatedAt?.toDate?.() || null;
        setDeviceDraft({
          id: draftDoc.id,
          createdByName: draftData.createdByName || 'Bilinmeyen',
          createdAt,
          updatedByName: draftData.updatedByName || undefined,
          updatedAt: updatedAt || undefined,
        });
        setDraftCheckDevice(device);
        setIsDraftModalOpen(true);
        return;
      }
    } catch (err) {
      console.error('Error checking for drafts:', err);
    }

    // For teknik servis panel:
    // - If device has teknik_servis fault, show modal with options
    // - If device has aplikasyon fault, show info that it's an aplikasyon fault (can't manage)
    // - If no fault, go directly to islem-formu
    if (device.arizaDurumu && device.arizaDurumu !== 'yok') {
      setSelectedDevice(device);
      setSelectedDeviceFaultType(device.arizaDurumu);
      // Find the open fault report for this device
      try {
        const q = query(
          collection(db, 'deviceFaultReports'),
          where('deviceId', '==', device.id),
          where('status', '==', 'open'),
          firestoreLimit(1)
        );
        const faultSnap = await getDocs(q);
        if (!faultSnap.empty) {
          setFaultIdForSelectedDevice(faultSnap.docs[0].id);
        } else {
          setFaultIdForSelectedDevice(null); // No open fault found
        }
      } catch (error) {
        console.error("Error finding open fault report:", error);
        setFaultIdForSelectedDevice(null);
      }
      setIsModalOpen(true);
    } else {
      router.push(`/teknik-servis/islem-formu/${device.id}`);
    }
  };

  const navigateToAction = (path: string) => {
    setIsModalOpen(false);
    router.push(path);
  };

  // Load personal stock when modal opens
  const loadPersonalStock = useCallback(async () => {
    if (!currentUser) return;
    setPersonalStockLoading(true);
    try {
      const q = query(
        collection(db, 'personalStock'),
        where('ownerUid', '==', currentUser.uid),
        where('status', '==', 'in_stock')
      );
      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate?.() || new Date(),
      })) as PersonalStockItem[];
      setPersonalStock(items.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ));
    } catch (err) {
      console.error('Error loading personal stock:', err);
      toast({ title: 'Hata', description: 'Şahsi stok yüklenemedi.', variant: 'destructive' });
    } finally {
      setPersonalStockLoading(false);
    }
  }, [currentUser, toast]);

  const openPersonalStockModal = () => {
    setIsPersonalStockModalOpen(true);
    loadPersonalStock();
  };

  // Handle return to depot (for depot-sourced items)
  const handleReturnToDepot = async (item: PersonalStockItem) => {
    if (!currentUser || !currentUserProfile) return;
    setProcessingItemId(item.id);
    try {
      // Update personal stock status
      await updateDoc(doc(db, 'personalStock', item.id), {
        status: 'pending_return',
        returnRequestedAt: serverTimestamp(),
      });

      // Create pending return record
      await addDoc(collection(db, 'pendingReturns'), {
        personalStockId: item.id,
        ownerUid: item.ownerUid,
        ownerName: item.ownerName,
        productCodeId: item.productCodeId,
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        serialNumber: item.serialNumber,
        source: item.source,
        returnType: 'return_to_depot',
        status: 'pending',
        requestedAt: serverTimestamp(),
        requestedByUid: currentUser.uid,
        requestedByName: currentUserProfile.displayName || currentUser.email || '',
      });

      // Create log entry
      await addDoc(collection(db, 'sparePartTransferLogs'), withCompanyScope({
        action: 'return_to_depot',
        personalStockId: item.id,
        productCodeId: item.productCodeId,
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        serialNumber: item.serialNumber,
        performedByUid: currentUser.uid,
        performedByName: currentUserProfile.displayName || currentUser.email || '',
        timestamp: serverTimestamp(),
        details: `${item.stokAdi} (${item.serialNumber}) depoya iade talebi oluşturuldu.`,
      }, currentCompanyId));

      toast({ title: 'Başarılı', description: 'Depoya iade talebi oluşturuldu.' });
      loadPersonalStock();
    } catch (err) {
      console.error('Error returning to depot:', err);
      toast({ title: 'Hata', description: 'İade talebi oluşturulamadı.', variant: 'destructive' });
    } finally {
      setProcessingItemId(null);
    }
  };

  // Handle submit to depot (for device-sourced items - removed parts)
  const handleSubmitToDepot = async (item: PersonalStockItem) => {
    if (!currentUser || !currentUserProfile) return;
    setProcessingItemId(item.id);
    try {
      // Update personal stock status
      await updateDoc(doc(db, 'personalStock', item.id), {
        status: 'pending_return',
        returnRequestedAt: serverTimestamp(),
      });

      // Create pending return record
      await addDoc(collection(db, 'pendingReturns'), {
        personalStockId: item.id,
        ownerUid: item.ownerUid,
        ownerName: item.ownerName,
        productCodeId: item.productCodeId,
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        serialNumber: item.serialNumber,
        source: item.source,
        sourceDeviceId: item.sourceDeviceId,
        sourceDeviceName: item.sourceDeviceName,
        returnType: 'submit_to_depot',
        status: 'pending',
        requestedAt: serverTimestamp(),
        requestedByUid: currentUser.uid,
        requestedByName: currentUserProfile.displayName || currentUser.email || '',
      });

      // Create log entry
      await addDoc(collection(db, 'sparePartTransferLogs'), withCompanyScope({
        action: 'submit_to_depot',
        personalStockId: item.id,
        productCodeId: item.productCodeId,
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        serialNumber: item.serialNumber,
        performedByUid: currentUser.uid,
        performedByName: currentUserProfile.displayName || currentUser.email || '',
        timestamp: serverTimestamp(),
        details: `${item.stokAdi} (${item.serialNumber}) depoya teslim talebi oluşturuldu. Kaynak cihaz: ${item.sourceDeviceName || 'Bilinmiyor'}`,
      }, currentCompanyId));

      toast({ title: 'Başarılı', description: 'Depoya teslim talebi oluşturuldu.' });
      loadPersonalStock();
    } catch (err) {
      console.error('Error submitting to depot:', err);
      toast({ title: 'Hata', description: 'Teslim talebi oluşturulamadı.', variant: 'destructive' });
    } finally {
      setProcessingItemId(null);
    }
  };

  // Handle Diğer Firma Arıza form submission
  const handleDigerFirmaSubmit = async () => {
    // Validate all fields are filled
    if (!digerFirmaAdi.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen diğer firma adını girin.', variant: 'destructive' });
      return;
    }
    if (!tespitEdilenAriza.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tespit edilen arızayı girin.', variant: 'destructive' });
      return;
    }
    if (!yapilanIslem.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen yapılan işlemi girin.', variant: 'destructive' });
      return;
    }

    setIsDigerFirmaSaving(true);
    try {
      // Create a record for the other company fault
      await addDoc(collection(db, 'digerFirmaArizalar'), {
        hospitalId,
        hospitalName: hospital?.name || '',
        digerFirmaAdi: digerFirmaAdi.trim(),
        tespitEdilenAriza: tespitEdilenAriza.trim(),
        yapilanIslem: yapilanIslem.trim(),
        createdAt: serverTimestamp(),
        createdByUid: currentUser?.uid || '',
        createdByName: currentUserProfile?.name || currentUserProfile?.displayName || '',
        formType: 'teknik_servis',
      });

      toast({ title: 'Başarılı', description: 'Diğer firma arıza kaydı oluşturuldu.' });

      // Reset form and close modal
      setDigerFirmaAdi('');
      setTespitEdilenAriza('');
      setYapilanIslem('');
      setIsDigerFirmaModalOpen(false);
    } catch (err) {
      console.error('Error saving diğer firma arıza:', err);
      toast({ title: 'Hata', description: 'Kayıt oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsDigerFirmaSaving(false);
    }
  };

  const openDigerFirmaModal = () => {
    setDigerFirmaAdi('');
    setTespitEdilenAriza('');
    setYapilanIslem('');
    setIsDigerFirmaModalOpen(true);
  };

  if (loading) {
    return (
      <div className="cihaz-shell flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
          <p className="text-sm text-[var(--dashboard-muted)]">Yükleniyor…</p>
        </div>
      </div>
    );
  }

  if (!hospital) {
    return (
      <div className="cihaz-shell flex items-center justify-center min-h-screen">
        <p className="text-[var(--dashboard-muted)]">Hastane bulunamadı.</p>
      </div>
    );
  }

  return (
    <>
      <div className="cihaz-shell px-4 py-6 sm:px-6 sm:py-8 space-y-6">
        <BackButton fallback="/teknik-servis" />

        {/* Header */}
        <header className="cihaz-card-strong px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
                <Building2 className="h-5 w-5 text-[var(--dashboard-accent)]" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-[var(--dashboard-text)]">{hospital.name}</h1>
                <p className="text-sm text-[var(--dashboard-muted)]">Cihaz Durumları</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowMaintenance(prev => !prev)}
                className={cn(
                  "cihaz-tool-item flex items-center gap-2 px-3 py-2 text-sm font-medium",
                  showMaintenance && "bg-[var(--dashboard-accent)] text-white shadow-none"
                )}
              >
                {showMaintenance ? <RotateCcw className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
                <span className="hidden sm:inline">{showMaintenance ? 'Cihazlara Dön' : 'Bakım Periyotları'}</span>
              </button>
              <button
                onClick={openDigerFirmaModal}
                className="cihaz-tool-item flex items-center gap-2 px-3 py-2 text-sm font-medium"
              >
                <Building2 className="h-4 w-4" />
                <span className="hidden sm:inline">Diğer Firma Arıza</span>
              </button>
              <button
                onClick={openPersonalStockModal}
                className="cihaz-tool-item flex items-center gap-2 px-3 py-2 text-sm font-medium"
              >
                <Package className="h-4 w-4" />
                <span className="hidden sm:inline">Şahsi Stoğum</span>
              </button>
            </div>
          </div>
        </header>

        {/* Device Grid */}
        <div>
          {devicesByHospital.length === 0 ? (
            <p className="text-[var(--dashboard-muted)] text-center py-8">
              Bu hastane için tanımlı cihaz bulunmuyor.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {devicesByHospital.map((device) => {
                // For teknik servis panel: red for teknik_servis faults, amber for aplikasyon faults
                // Check both device.arizaDurumu and real-time open fault reports
                const faultFromReports = openFaultMap[device.id];
                const faultFromDevice = device.arizaDurumu && device.arizaDurumu !== 'yok' ? device.arizaDurumu : null;
                const effectiveFaultType = faultFromReports || faultFromDevice;
                const isTeknikServisFaulty = effectiveFaultType === 'teknik_servis';
                const isAplikasyonFaulty = effectiveFaultType === 'aplikasyon';
                const isFaulty = isTeknikServisFaulty || isAplikasyonFaulty;
                const deviceMaintenanceItems = maintenanceData[device.id] || [];

                return (
                  <div key={device.id} className="device-flip-container">
                    <div className={cn("device-flip-inner", showMaintenance && "flipped")}>
                      {/* FRONT - Device Image */}
                      <div className="device-flip-front">
                        <div className="cihaz-card p-4">
                          <button
                            className="flex flex-col items-center group text-center cursor-pointer w-full"
                            onClick={() => handleDeviceClick(device)}
                          >
                            <div className="mb-2">
                              <p className="font-semibold text-sm truncate text-[var(--dashboard-text)]" title={device.cihazAdi || device.model}>
                                {device.cihazAdi || device.model}
                              </p>
                              <p className="text-xs text-[var(--dashboard-muted)] font-mono">
                                {device.seriNumarasi || 'SN yok'}
                              </p>
                            </div>
                            <div className="relative w-full aspect-square">
                              {device.imageUrl ? (
                                <Image
                                  src={resolveImageSrc(device.imageUrl)}
                                  alt={device.cihazAdi || device.model || ''}
                                  width={1024}
                                  height={1024}
                                  className="object-contain"
                                  priority
                                />
                              ) : (
                                <div className="w-full h-full bg-[var(--dashboard-surface-2)] flex items-center justify-center text-xs text-[var(--dashboard-muted)] rounded-md">
                                  Görsel Yok
                                </div>
                              )}
                            </div>
                            <div
                                className={cn(
                                    "w-full h-4 animate-pulse mt-1",
                                    isTeknikServisFaulty ? 'bg-red-500/50' : isAplikasyonFaulty ? 'bg-amber-500/50' : 'bg-green-500/50'
                                )}
                                style={{ filter: 'blur(12px)' }}
                            />
                            <div className="mt-2 h-10">
                              {isTeknikServisFaulty ? (
                                <>
                                  <p className="text-xs text-red-500 font-semibold flex items-center justify-center">
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    Arızalı (Teknik Servis)
                                  </p>
                                  {device.arizaAciklamasi && (
                                    <p className="text-xs text-[var(--dashboard-muted)] truncate" title={device.arizaAciklamasi}>
                                      {device.arizaAciklamasi}
                                    </p>
                                  )}
                                </>
                              ) : isAplikasyonFaulty ? (
                                <>
                                  <p className="text-xs text-amber-600 font-semibold flex items-center justify-center">
                                    <FlaskConical className="h-3 w-3 mr-1" />
                                    Arızalı (Aplikasyon)
                                  </p>
                                  {device.arizaAciklamasi && (
                                    <p className="text-xs text-[var(--dashboard-muted)] truncate" title={device.arizaAciklamasi}>
                                      {device.arizaAciklamasi}
                                    </p>
                                  )}
                                </>
                              ) : (
                                <p className="text-xs text-green-600 font-semibold flex items-center justify-center">
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Sağlıklı
                                </p>
                              )}
                            </div>

                            {/* Mini Fault History */}
                            {deviceFaultHistory[device.id]?.length > 0 && (
                              <div className="w-full mt-2 text-left" onClick={(e) => e.stopPropagation()}>
                                <div className="border border-[var(--dashboard-stroke)] rounded-md p-2 bg-[var(--dashboard-surface-2)]">
                                  <div className="flex items-center gap-1 text-xs text-[var(--dashboard-muted)] mb-1">
                                    <History className="h-3 w-3" />
                                    <span className="font-medium">Son Arızalar</span>
                                  </div>
                                  <div className="space-y-1">
                                    {deviceFaultHistory[device.id]
                                      .slice(0, expandedDevices.has(device.id) ? 10 : 3)
                                      .map((fault, idx) => (
                                        <div key={idx} className="text-xs border-l-2 border-[var(--dashboard-accent)]/30 pl-2 py-0.5">
                                          <p className="text-[var(--dashboard-muted)] truncate" title={fault.description}>
                                            {fault.description}
                                          </p>
                                          <p className="text-[10px] text-[var(--dashboard-muted)]/70">
                                            {format(fault.closedAt, 'dd.MM.yy', { locale: tr })}
                                          </p>
                                        </div>
                                      ))}
                                  </div>
                                  {deviceFaultHistory[device.id].length > 3 && (
                                    <button
                                      onClick={(e) => toggleDeviceExpand(device.id, e)}
                                      className="w-full mt-1 text-xs text-[var(--dashboard-accent)] hover:text-[var(--dashboard-accent)]/80 flex items-center justify-center gap-1 py-1"
                                    >
                                      {expandedDevices.has(device.id) ? (
                                        <>
                                          <ChevronUp className="h-3 w-3" />
                                          Daha az göster
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown className="h-3 w-3" />
                                          Daha fazla göster ({Math.min(deviceFaultHistory[device.id].length, 10) - 3})
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* BACK - Maintenance Info */}
                      <div className="device-flip-back">
                        <div className="maintenance-card-neumorphic p-4 h-full">
                          <div className="mb-3">
                            <p className="font-semibold text-sm truncate text-[var(--dashboard-text)]" title={device.cihazAdi || device.model}>
                              {device.cihazAdi || device.model}
                            </p>
                            <p className="text-xs text-[var(--dashboard-muted)] font-mono">
                              {device.seriNumarasi || 'SN yok'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 mb-3">
                            <CalendarClock className="h-4 w-4 text-[var(--dashboard-accent)]" />
                            <span className="text-xs font-semibold text-[var(--dashboard-accent)]">Bakım Periyotları</span>
                          </div>
                          {maintenanceLoading ? (
                            <div className="flex items-center justify-center py-6">
                              <Loader2 className="h-5 w-5 animate-spin text-[var(--dashboard-accent)]" />
                            </div>
                          ) : deviceMaintenanceItems.length === 0 ? (
                            <p className="text-xs text-[var(--dashboard-muted)] text-center py-4">
                              Tanımlı bakım periyodu yok
                            </p>
                          ) : (
                            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                              {deviceMaintenanceItems.map((item, idx) => (
                                <div
                                  key={idx}
                                  className={cn(
                                    "flex items-start justify-between gap-2 p-2 rounded-lg text-xs",
                                    item.daysRemaining <= 0
                                      ? "bg-red-100 border border-red-200"
                                      : item.daysRemaining <= 7
                                      ? "bg-amber-100 border border-amber-200"
                                      : "bg-[var(--dashboard-surface-2)] border border-transparent"
                                  )}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1">
                                      {item.type === 'part' && (
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"></span>
                                      )}
                                      {item.type === 'maintenance' && (
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0"></span>
                                      )}
                                      <span className="truncate font-medium" title={item.taskName}>
                                        {item.taskName}
                                      </span>
                                    </div>
                                  </div>
                                  <span className={cn(
                                    "font-bold whitespace-nowrap flex-shrink-0",
                                    item.daysRemaining <= 0
                                      ? "text-red-600"
                                      : item.daysRemaining <= 7
                                      ? "text-amber-600"
                                      : "text-[var(--dashboard-muted)]"
                                  )}>
                                    {item.daysRemaining <= 0
                                      ? `${Math.abs(item.daysRemaining)} gün gecikti`
                                      : `${item.daysRemaining} gün kaldı`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Device Action Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDeviceFaultType === 'teknik_servis'
                ? `Teknik Servis Arızası: ${selectedDevice?.cihazAdi}`
                : `Aplikasyon Arızası: ${selectedDevice?.cihazAdi}`}
            </DialogTitle>
            <DialogDescription>
              {selectedDeviceFaultType === 'teknik_servis'
                ? 'Bu cihaz için bir teknik servis arıza kaydı bulunmaktadır. Yapmak istediğiniz işlemi seçin.'
                : 'Bu cihaz için bir aplikasyon arıza kaydı bulunmaktadır. Bu arızayı yalnızca aplikasyon personeli yönetebilir.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-col sm:space-x-0 gap-2 pt-4">
              {selectedDeviceFaultType === 'teknik_servis' ? (
                <>
                  <button
                    onClick={() => faultIdForSelectedDevice && navigateToAction(`/ariza-yonetimi/${faultIdForSelectedDevice}`)}
                    disabled={!faultIdForSelectedDevice}
                    className="cihaz-tool-item px-4 py-2.5 text-sm font-medium bg-[var(--dashboard-accent)] text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Wrench className="h-4 w-4" /> Arıza Kaydını Yönet
                  </button>
                  <button
                    onClick={() => selectedDevice?.id && navigateToAction(`/teknik-servis/islem-formu/${selectedDevice.id}`)}
                    className="cihaz-tool-item px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <FilePenLine className="h-4 w-4" /> Yeni Servis İşlemi Oluştur
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => faultIdForSelectedDevice && navigateToAction(`/ariza-yonetimi/${faultIdForSelectedDevice}`)}
                    disabled={!faultIdForSelectedDevice}
                    className="cihaz-tool-item px-4 py-2.5 text-sm font-medium bg-[var(--dashboard-surface-2)] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FlaskConical className="h-4 w-4" /> Arıza Kaydını Görüntüle (Salt Okunur)
                  </button>
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="cihaz-tool-item px-4 py-2.5 text-sm font-medium flex items-center justify-center"
                  >
                    Kapat
                  </button>
                </>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Personal Stock Modal */}
      <Dialog open={isPersonalStockModalOpen} onOpenChange={setIsPersonalStockModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Şahsi Stoğum
            </DialogTitle>
            <DialogDescription>
              Size teslim edilen ve stoğunuzda bulunan yedek parçalar aşağıda listelenmektedir.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            {personalStockLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-[var(--dashboard-accent)]" />
              </div>
            ) : personalStock.length === 0 ? (
              <div className="text-center py-8 text-[var(--dashboard-muted)]">
                Stoğunuzda yedek parça bulunmuyor.
              </div>
            ) : (
              <div className="space-y-3">
                {personalStock.map(item => (
                  <div
                    key={item.id}
                    className={cn(
                      'p-3 border rounded-lg',
                      item.source === 'depot'
                        ? 'bg-blue-50/60 border-blue-200/60'
                        : 'bg-amber-50/60 border-amber-200/60'
                    )}
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn(
                            'text-xs font-medium px-2 py-0.5 rounded',
                            item.source === 'depot'
                              ? 'bg-blue-100/70 text-blue-700'
                              : 'bg-amber-100/70 text-amber-700'
                          )}>
                            {item.source === 'depot' ? 'Depodan' : 'Cihazdan'}
                          </span>
                        </div>
                        <p className="font-medium text-[var(--dashboard-text)]">{item.stokAdi}</p>
                        <p className="text-xs text-[var(--dashboard-muted)] font-mono">{item.stokKodu}</p>
                        <p className="text-sm mt-1 text-[var(--dashboard-text)]">
                          Seri No: <span className="font-mono">{item.serialNumber}</span>
                        </p>
                        {item.source === 'device' && item.sourceDeviceName && (
                          <p className="text-xs text-[var(--dashboard-muted)] mt-1">
                            Kaynak: {item.sourceDeviceName}
                          </p>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        {item.source === 'depot' ? (
                          <button
                            onClick={() => handleReturnToDepot(item)}
                            disabled={processingItemId === item.id}
                            className="cihaz-tool-item px-3 py-2 text-sm font-medium whitespace-nowrap flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {processingItemId === item.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <ArrowLeftRight className="h-4 w-4" />
                                Depoya İade
                              </>
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleSubmitToDepot(item)}
                            disabled={processingItemId === item.id}
                            className="cihaz-tool-item px-3 py-2 text-sm font-medium whitespace-nowrap flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {processingItemId === item.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Warehouse className="h-4 w-4" />
                                Depoya Teslim
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          <DialogFooter>
            <button
              onClick={() => setIsPersonalStockModalOpen(false)}
              className="cihaz-tool-item px-4 py-2.5 text-sm font-medium"
            >
              Kapat
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diger Firma Ariza Modal */}
      <Dialog open={isDigerFirmaModalOpen} onOpenChange={setIsDigerFirmaModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Diğer Firma Arıza Kaydı
            </DialogTitle>
            <DialogDescription>
              Başka bir firma cihazıyla ilgili arıza kaydı oluşturun. Tüm alanlar zorunludur.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="digerFirmaAdi">
                Diğer Firma Adı <span className="text-red-500">*</span>
              </Label>
              <Input
                id="digerFirmaAdi"
                placeholder="Firma adını girin..."
                value={digerFirmaAdi}
                onChange={(e) => setDigerFirmaAdi(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tespitEdilenAriza">
                Tespit Edilen Arıza <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="tespitEdilenAriza"
                placeholder="Tespit edilen arızayı açıklayın..."
                value={tespitEdilenAriza}
                onChange={(e) => setTespitEdilenAriza(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="yapilanIslem">
                Yapılan İşlem <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="yapilanIslem"
                placeholder="Yapılan işlemi açıklayın..."
                value={yapilanIslem}
                onChange={(e) => setYapilanIslem(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button
              onClick={() => setIsDigerFirmaModalOpen(false)}
              className="cihaz-tool-item px-4 py-2.5 text-sm font-medium"
            >
              İptal
            </button>
            <button
              onClick={handleDigerFirmaSubmit}
              disabled={isDigerFirmaSaving || !digerFirmaAdi.trim() || !tespitEdilenAriza.trim() || !yapilanIslem.trim()}
              className="cihaz-tool-item px-4 py-2.5 text-sm font-medium bg-[var(--dashboard-accent)] text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isDigerFirmaSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Kaydet
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Draft Continuation Modal */}
      <Dialog open={isDraftModalOpen} onOpenChange={setIsDraftModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-[var(--dashboard-accent)]" />
              Ara Kayıt Bulundu
            </DialogTitle>
            <DialogDescription>
              Bu cihaz için bir ara kayıt bulunmaktadır. Devam etmek veya yeni form oluşturmak için seçim yapın.
            </DialogDescription>
          </DialogHeader>

          {deviceDraft && (
            <div className="rounded-xl bg-[var(--dashboard-surface-2)] p-4 space-y-1">
              <p className="text-sm font-medium text-[var(--dashboard-text)]">
                Ara Kaydı Oluşturan: <span className="text-[var(--dashboard-accent)]">{deviceDraft.createdByName}</span>
              </p>
              <p className="text-xs text-[var(--dashboard-muted)]">
                Tarih: {format(deviceDraft.createdAt, 'dd.MM.yyyy HH:mm', { locale: tr })}
              </p>
              {deviceDraft.updatedByName && deviceDraft.updatedAt && (
                <p className="text-xs text-[var(--dashboard-muted)]">
                  Son Güncelleme: {deviceDraft.updatedByName} - {format(deviceDraft.updatedAt, 'dd.MM.yyyy HH:mm', { locale: tr })}
                </p>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-col sm:space-x-0 gap-2 pt-4">
            <button
              onClick={() => {
                if (draftCheckDevice && deviceDraft) {
                  setIsDraftModalOpen(false);
                  router.push(`/teknik-servis/islem-formu/${draftCheckDevice.id}?draftId=${deviceDraft.id}`);
                }
              }}
              className="cihaz-tool-item px-4 py-2.5 text-sm font-medium bg-[var(--dashboard-accent)] text-white flex items-center justify-center gap-2"
            >
              <FileEdit className="h-4 w-4" />
              Ara Kayıttan Devam Et
            </button>
            <button
              onClick={() => {
                if (draftCheckDevice) {
                  setIsDraftModalOpen(false);
                  router.push(`/teknik-servis/islem-formu/${draftCheckDevice.id}`);
                }
              }}
              className="cihaz-tool-item px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2"
            >
              <FilePlus className="h-4 w-4" />
              Yeni Form Oluştur
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
