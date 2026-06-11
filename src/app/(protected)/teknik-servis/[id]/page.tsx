'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import BackButton from '@/components/BackButton';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle, Loader2, Wrench, FilePenLine, FlaskConical, Building2, ChevronDown, ChevronUp, History, CalendarClock, RotateCcw, FileEdit, FilePlus, ClipboardList, Download, Upload } from 'lucide-react';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  getDocs,
  updateDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
  setDoc,
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
import { matchesCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { classifyStopFault } from '@/lib/stop-fault';
import { getAffectedDeviceIds } from '@/lib/device-faults';
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
import { reserveActionFormNumber } from '@/lib/form-number';


export default function TeknikServisDetayPage() {
  const params = useParams();
  const hospitalId = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

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
  const [returnConditionDialogOpen, setReturnConditionDialogOpen] = useState(false);
  const [pendingReturnItem, setPendingReturnItem] = useState<PersonalStockItem | null>(null);
  const [pendingReturnType, setPendingReturnType] = useState<'return_to_depot' | 'submit_to_depot'>('return_to_depot');
  const [returnCondition, setReturnCondition] = useState<'iyi' | 'arizali' | 'miadi_gecmis' | 'diger'>('iyi');
  const [returnConditionNote, setReturnConditionNote] = useState('');

  // Diğer Firma Arıza modal state
  const [isDigerFirmaModalOpen, setIsDigerFirmaModalOpen] = useState(false);
  const [digerFirmaAdi, setDigerFirmaAdi] = useState('');
  const [tespitEdilenAriza, setTespitEdilenAriza] = useState('');
  const [yapilanIslem, setYapilanIslem] = useState('');
  const [isDigerFirmaSaving, setIsDigerFirmaSaving] = useState(false);

  // Device fault history state
  const [deviceFaultHistory, setDeviceFaultHistory] = useState<Record<string, { description: string; closedAt: Date }[]>>({});
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set());
  const [stopFaultCountsByDevice, setStopFaultCountsByDevice] = useState<Record<string, { e: number; s: number; n: number }>>({});

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
    const qDevices = scopedQuery('devices', currentCompanyId, isSuperAdmin, where('hospitalId', '==', hospitalId));
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
        if (!data.faultType || !matchesCompanyScope(data, currentCompanyId, isSuperAdmin)) return;

        getAffectedDeviceIds(data).forEach((deviceId) => {
          if (!deviceIds.has(deviceId)) return;

          if (!idsMap[deviceId]) idsMap[deviceId] = [];
          if (!idsMap[deviceId].includes(d.id)) {
            if (data.faultType === 'teknik_servis') idsMap[deviceId].unshift(d.id);
            else idsMap[deviceId].push(d.id);
          }

          // Cihazda iki tür arıza da varsa bu panelin kendi arıza türünü önceliklendir.
          if (map[deviceId] !== 'teknik_servis') {
            map[deviceId] = data.faultType;
          }
        });
      });
      setOpenFaultMap(map);
      setOpenFaultReportIds(idsMap);
    });
    return () => unsub();
  }, [devicesByHospital, currentCompanyId, isSuperAdmin]);

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

  useEffect(() => {
    if (!hospitalId) return;
    const q = scopedQuery('deviceFaultReports', currentCompanyId, isSuperAdmin, where('hospitalId', '==', hospitalId));
    const unsub = onSnapshot(q, (snap) => {
      const counts: Record<string, { e: number; s: number; n: number }> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const deviceId = String(data.deviceId || '');
        if (!deviceId) return;
        const stopType = classifyStopFault(data);
        if (!stopType) return;
        if (!counts[deviceId]) counts[deviceId] = { e: 0, s: 0, n: 0 };
        if (stopType === 'e_stop') counts[deviceId].e += 1;
        if (stopType === 's_stop') counts[deviceId].s += 1;
        if (stopType === 'normal_stop') counts[deviceId].n += 1;
      });
      setStopFaultCountsByDevice(counts);
    });
    return () => unsub();
  }, [hospitalId]);

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
        const partsQ = scopedQuery(
          'periodicPartChanges',
          currentCompanyId,
          isSuperAdmin,
          where('deviceId', '==', device.id)
        );
        const partsSnap = await getDocs(partsQ);
        const parts = partsSnap.docs.map(d => ({ id: d.id, ...d.data() } as PeriodicPartChange));

        // Fetch periodic part change logs for this device
        const partLogsQ = scopedQuery(
          'periodicPartChangeLogs',
          currentCompanyId,
          isSuperAdmin,
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
      const draftQuery = scopedQuery(
        'draftActionForms',
        currentCompanyId,
        isSuperAdmin,
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
    const activeFaultType = openFaultMap[device.id];
    if (activeFaultType) {
      setSelectedDevice(device);
      setSelectedDeviceFaultType(activeFaultType);
      const openIds = openFaultReportIds[device.id] || [];
      setFaultIdForSelectedDevice(openIds.length > 0 ? openIds[0] : null);
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

  const requestReturnToDepot = (item: PersonalStockItem, type: 'return_to_depot' | 'submit_to_depot') => {
    setPendingReturnItem(item);
    setPendingReturnType(type);
    setReturnCondition('iyi');
    setReturnConditionNote('');
    setReturnConditionDialogOpen(true);
  };

  // Handle return to depot (for depot-sourced items)
  const handleReturnToDepot = async (item: PersonalStockItem, condition: 'iyi' | 'arizali' | 'miadi_gecmis' | 'diger', conditionNote: string) => {
    if (!currentUser || !currentUserProfile) return;
    setProcessingItemId(item.id);
    try {
      // Update personal stock status
      await updateDoc(doc(db, 'personalStock', item.id), {
        status: 'pending_return',
        returnRequestedAt: serverTimestamp(),
      });

      // Create pending return record
      await addDoc(collection(db, 'pendingReturns'), withCompanyScope({
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
        returnCondition: condition,
        returnConditionNote: conditionNote || null,
      }, currentCompanyId));

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
  const handleSubmitToDepot = async (item: PersonalStockItem, condition: 'iyi' | 'arizali' | 'miadi_gecmis' | 'diger', conditionNote: string) => {
    if (!currentUser || !currentUserProfile) return;
    setProcessingItemId(item.id);
    try {
      // Update personal stock status
      await updateDoc(doc(db, 'personalStock', item.id), {
        status: 'pending_return',
        returnRequestedAt: serverTimestamp(),
      });

      // Create pending return record
      await addDoc(collection(db, 'pendingReturns'), withCompanyScope({
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
        returnCondition: condition,
        returnConditionNote: conditionNote || null,
      }, currentCompanyId));

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

  const submitReturnRequest = async () => {
    if (!pendingReturnItem) return;
    if (returnCondition === 'diger' && !returnConditionNote.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Diğer durumu için açıklama zorunludur.', variant: 'destructive' });
      return;
    }
    const note = returnConditionNote.trim();
    if (pendingReturnType === 'return_to_depot') {
      await handleReturnToDepot(pendingReturnItem, returnCondition, note);
    } else {
      await handleSubmitToDepot(pendingReturnItem, returnCondition, note);
    }
    setReturnConditionDialogOpen(false);
    setPendingReturnItem(null);
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

  const teknikIslemTipleri = ['cihaz', 'ups', 'su_sistemi'] as const;
  const teknikIslemTurleri = ['rutin_kurum_ziyareti', 'periyodik_bakim', 'cihaz_kurulumu', 'ariza', 'sw_update', 'alis', 'roche_bilgisayar_arizasi'] as const;
  const teknikYapilanIslemler = ['genel_temizlik_yaglama', 'temel_fonksiyon_testleri', 'mekanik_ayarlar_kontrol', 'optik_ayarlar_kontrol', 'pipetleme_transfer_ayarlari'] as const;
  const cihazDurumlari = ['calisiyor', 'arizali', 'denemede', 'diger'] as const;

  const fetchTemplateOptions = async () => {
    const [hospitalsSnap, devicesSnap] = await Promise.all([
      getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
      getDocs(scopedQuery('devices', currentCompanyId, isSuperAdmin)),
    ]);

    const hospitals = hospitalsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Hospital[];
    const devices = devicesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Device[];

    const hospitalMap = new Map(hospitals.map((h) => [h.id, h.name]));
    const serialRows = devices
      .filter((d) => d.seriNumarasi)
      .map((d) => [hospitalMap.get(d.hospitalId) || '', d.cihazAdi || d.model || '', d.seriNumarasi || ''])
      .sort((a, b) => `${a[0]}-${a[2]}`.localeCompare(`${b[0]}-${b[2]}`, 'tr'));

    return {
      labRows: hospitals.map((h) => [h.name]).sort((a, b) => a[0].localeCompare(b[0], 'tr')),
      serialRows,
    };
  };

  const downloadExcelTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const today = new Date();
      const { labRows, serialRows } = await fetchTemplateOptions();

      const formRows = [[
        'Lab Adı',
        'Cihaz Seri No',
        'İşlem Tipi',
        'İşlem Türü',
        'Başlangıç Tarihi',
        'Başlangıç Saati',
        'Bitiş Tarihi',
        'Bitiş Saati',
        'Cihaz Durumu',
        'Yapılan İşlemler (virgülle)',
        'Açıklama',
        'Arıza Adı (opsiyonel)',
        'Yedek Parça Kodu',
        'Yedek Parça Adı',
        'Yedek Parça Seri No (opsiyonel)',
        'Yedek Parça Adet',
      ], [
        hospital?.name || '',
        devicesByHospital[0]?.seriNumarasi || '',
        'cihaz',
        'rutin_kurum_ziyareti',
        today,
        '09:00',
        today,
        '10:00',
        'calisiyor',
        'genel_temizlik_yaglama',
        'Geriye dönük form girişi',
        '',
        'SERBEST-KOD',
        'Serbest Yedek Parça',
        '',
        1,
      ]];
      const ws = XLSX.utils.aoa_to_sheet(formRows);
      ws.E2 = ws.E2 || { t: 'd', v: today };
      ws.G2 = ws.G2 || { t: 'd', v: today };
      ws.E2.z = 'yyyy-mm-dd';
      ws.G2.z = 'yyyy-mm-dd';

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'TeknikServisFormlar');

      const optionRows = [
        ['Alan', 'Değer 1', 'Değer 2', 'Değer 3'],
        ...labRows.map((r) => ['Lab Adı', r[0], '', '']),
        ...serialRows.map((r) => ['Cihaz Seri No', r[2], r[0], r[1]]),
        ...teknikIslemTipleri.map((v) => ['İşlem Tipi', v, '', '']),
        ...teknikIslemTurleri.map((v) => ['İşlem Türü', v, '', '']),
        ...teknikYapilanIslemler.map((v) => ['Yapılan İşlem', v, '', '']),
        ...cihazDurumlari.map((v) => ['Cihaz Durumu', v, '', '']),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(optionRows), 'Secenekler');

      XLSX.writeFile(wb, `teknik_servis_toplu_form_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
      toast({ title: 'Şablon indirildi', description: 'Teknik servis toplu form şablonu hazır.' });
    } catch (error) {
      console.error('Error creating excel template:', error);
      toast({ title: 'Hata', description: 'Excel şablonu oluşturulamadı.', variant: 'destructive' });
    }
  };

  const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '', raw: false });

      if (rows.length === 0) {
        toast({ title: 'Uyarı', description: 'Excel dosyasında satır bulunamadı.', variant: 'default' });
        return;
      }

      const [hospitalsSnap, devicesSnap] = await Promise.all([
        getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('devices', currentCompanyId, isSuperAdmin)),
      ]);
      const hospitals = hospitalsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Hospital[];
      const devices = devicesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Device[];
      const hospitalMapByName = new Map(hospitals.map((h) => [String(h.name || '').trim().toLowerCase(), h]));

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        try {
          const labName = String(row['Lab Adı'] ?? '').trim();
          const serial = String(row['Cihaz Seri No'] ?? '').trim();
          const islemTipi = String(row['İşlem Tipi'] ?? '').trim();
          const islemTuru = String(row['İşlem Türü'] ?? '').trim();
          const baslangicTarihi = String(row['Başlangıç Tarihi'] ?? '').trim();
          const bitisTarihi = String(row['Bitiş Tarihi'] ?? '').trim();
          const baslangicSaati = String(row['Başlangıç Saati'] ?? '').trim();
          const bitisSaati = String(row['Bitiş Saati'] ?? '').trim();
          const cihazDurumu = String(row['Cihaz Durumu'] ?? '').trim();

          if (!labName || !serial || !islemTipi || !islemTuru || !baslangicTarihi || !bitisTarihi || !baslangicSaati || !bitisSaati || !cihazDurumu) {
            failCount += 1;
            continue;
          }

          const hospitalMatch = hospitalMapByName.get(labName.toLowerCase());
          if (!hospitalMatch) {
            failCount += 1;
            continue;
          }

          const deviceMatch = devices.find((d) => String(d.hospitalId) === hospitalMatch.id && String(d.seriNumarasi || '').trim() === serial);
          if (!deviceMatch) {
            failCount += 1;
            continue;
          }

          const actions: Record<string, any>[] = String(row['Yapılan İşlemler (virgülle)'] ?? '')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
            .map((operation) => ({
              id: `excel_op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'operation' as const,
              action: operation,
              quantity: 1,
              isManualEntry: true,
            }));

          const yedekParcaKodu = String(row['Yedek Parça Kodu'] ?? '').trim();
          const yedekParcaAdi = String(row['Yedek Parça Adı'] ?? '').trim();
          if (yedekParcaKodu || yedekParcaAdi) {
            actions.push({
              id: `excel_part_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'part_change' as const,
              action: 'parca_degisimi',
              stokKodu: yedekParcaKodu,
              stokAdi: yedekParcaAdi,
              serialNumber: String(row['Yedek Parça Seri No (opsiyonel)'] ?? '').trim() || undefined,
              quantity: Math.max(1, Number(row['Yedek Parça Adet'] ?? 1) || 1),
              isManualEntry: true,
            });
          }

          const formRef = doc(collection(db, 'teknikServisActionForms'));
          const formNo = await reserveActionFormNumber({
            db,
            companyId: currentCompanyId,
            userUid: currentUserProfile?.uid || 'unknown',
            userName: currentUserProfile?.name || currentUserProfile?.displayName || '',
            formTypeLetter: 'T',
          });

          const payload = {
            deviceId: deviceMatch.id,
            cihazAdi: deviceMatch.cihazAdi || deviceMatch.model,
            seriNumarasi: deviceMatch.seriNumarasi || '',
            hospitalId: deviceMatch.hospitalId,
            labName: hospitalMatch.name,
            actions,
            islemTipi,
            islemTuru,
            aciklama: String(row['Açıklama'] ?? '').trim(),
            baslangicSaati,
            bitisSaati,
            baslangicTarihi,
            bitisTarihi,
            cihazDurumu,
            cihazDurumuAciklama: cihazDurumu === 'diger' ? String(row['Cihaz Durumu Açıklama'] ?? '').trim() : null,
            selectedFaultName: String(row['Arıza Adı (opsiyonel)'] ?? '').trim() || null,
            selectedFaultId: null,
            isCustomFault: !!String(row['Arıza Adı (opsiyonel)'] ?? '').trim(),
            createdAt: serverTimestamp(),
            formNo,
            createdByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
            createdByUid: currentUserProfile?.uid || null,
            companyId: currentCompanyId || null,
            formType: 'teknik_servis',
            importedFromExcel: true,
          };

          await setDoc(formRef, payload);
          await setDoc(doc(db, 'deviceActionForms', formRef.id), payload);
          successCount += 1;
        } catch (err) {
          console.error(`Excel row import failed (row ${i + 2}):`, err);
          failCount += 1;
        }
      }

      toast({
        title: 'Excel içe aktarma tamamlandı',
        description: `Başarılı satır: ${successCount} • Başarısız satır: ${failCount}`,
        variant: failCount > 0 ? 'default' : 'default',
      });
    } catch (error) {
      console.error('Error importing excel forms:', error);
      toast({ title: 'Hata', description: 'Excel yüklenirken hata oluştu.', variant: 'destructive' });
    }
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
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => router.push(`/teknik-servis/islem-formu/lab-${hospitalId}`)}
                className="cihaz-tool-item flex items-center gap-2 px-3 py-2 text-sm font-medium bg-[var(--dashboard-accent)] text-white hover:bg-[var(--dashboard-accent)]/90 shadow-sm"
              >
                <ClipboardList className="h-4 w-4" />
                <span className="hidden sm:inline">Laboratuvar Formu</span>
              </button>
              <button
                onClick={downloadExcelTemplate}
                className="cihaz-tool-item flex items-center gap-2 px-3 py-2 text-sm font-medium"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Excel Şablonu</span>
              </button>
              <label className="cihaz-tool-item flex items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer">
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Excel Yükle</span>
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
              </label>
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
                // For teknik servis panel: red for teknik_servis faults, amber for aplikasyon faults.
                // Use real-time arıza yönetimi records as source of truth.
                const faultFromReports = openFaultMap[device.id];
                const effectiveFaultType = faultFromReports || null;
                const isTeknikServisFaulty = effectiveFaultType === 'teknik_servis';
                const isAplikasyonFaulty = effectiveFaultType === 'aplikasyon';
                const isFaulty = isTeknikServisFaulty || isAplikasyonFaulty;
                const deviceMaintenanceItems = maintenanceData[device.id] || [];
                const stopCounts = stopFaultCountsByDevice[device.id] || { e: 0, s: 0, n: 0 };

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
                            <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] w-full">
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 font-semibold">E <span className="font-normal">{stopCounts.e}</span></span>
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 font-semibold">S <span className="font-normal">{stopCounts.s}</span></span>
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 font-semibold">N <span className="font-normal">{stopCounts.n}</span></span>
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
                : 'Bu cihaz için bir aplikasyon arıza kaydı bulunmaktadır. Arıza kaydı salt okunur görüntülenir; teknik servis işlem formu yine de oluşturabilirsiniz.'}
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
                    onClick={() => selectedDevice?.id && navigateToAction(`/teknik-servis/islem-formu/${selectedDevice.id}`)}
                    className="cihaz-tool-item px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <FilePenLine className="h-4 w-4" /> Teknik Servis İşlem Formu Aç
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
                            onClick={() => requestReturnToDepot(item, 'return_to_depot')}
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
                            onClick={() => requestReturnToDepot(item, 'submit_to_depot')}
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

      <Dialog open={returnConditionDialogOpen} onOpenChange={setReturnConditionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>İade Durumu Seçimi</DialogTitle>
            <DialogDescription>
              {pendingReturnItem?.stokAdi || 'Parça'} için iade durumunu seçin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Parça Durumu</Label>
            <select
              value={returnCondition}
              onChange={(e) => setReturnCondition(e.target.value as any)}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            >
              <option value="iyi">İyi</option>
              <option value="arizali">Arızalı</option>
              <option value="miadi_gecmis">Miadı Geçik</option>
              <option value="diger">Diğer</option>
            </select>
            {returnCondition === 'diger' && (
              <div className="space-y-1">
                <Label>Açıklama</Label>
                <Textarea
                  value={returnConditionNote}
                  onChange={(e) => setReturnConditionNote(e.target.value)}
                  placeholder="Durumu açıklayın"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <button onClick={() => setReturnConditionDialogOpen(false)} className="cihaz-tool-item px-4 py-2 text-sm font-medium">Vazgeç</button>
            <button onClick={submitReturnRequest} className="cihaz-tool-item px-4 py-2 text-sm font-medium">Talep Oluştur</button>
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
