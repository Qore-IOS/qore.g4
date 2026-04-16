'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Hospital, Device, AssignedDevice, DeviceLabPool } from '@/lib/types';
import { useToast } from "@/hooks/use-toast";
import { collection, onSnapshot, query, orderBy, where, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import AplikasyonPanel from '@/components/aplikasyon-panel';
import { Loader2, Download, Upload } from 'lucide-react';
import { filterByCompanyScope } from '@/lib/company-scope';
import { reserveActionFormNumber } from '@/lib/form-number';
import { format } from 'date-fns';

export default function AplikasyonPaneliPage() {
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { currentUserProfile, isSuperAdmin, currentCompanyId } = useAuth();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [hospitalDeviceAssignments, setHospitalDeviceAssignments] = useState<AssignedDevice[]>([]);
  const [deviceLabPools, setDeviceLabPools] = useState<DeviceLabPool[]>([]);
  const isAdminRole = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'super_admin';

  const fetchAllApplicationData = useCallback(async () => {
    setIsLoading(true);
    try {
      const unsubHospitals = onSnapshot(
        query(collection(db, 'hospitals'), orderBy('name', 'asc')),
        (snap) => setHospitals(filterByCompanyScope(
          snap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)),
          currentCompanyId,
          isSuperAdmin
        )),
        (err) => {
          console.error("Hospitals listener error:", err);
          toast({ title: 'Veri Hatası', description: 'Hastaneler yüklenemedi.', variant: 'destructive' });
        }
      );

      const unsubDevices = onSnapshot(
        collection(db, 'devices'),
        (snap) => setDevices(filterByCompanyScope(
          snap.docs.map(d => ({ id: d.id, ...d.data() } as Device)),
          currentCompanyId,
          isSuperAdmin
        )),
        (err) => {
          console.error("Devices listener error:", err);
          toast({ title: 'Veri Hatası', description: 'Cihazlar yüklenemedi.', variant: 'destructive' });
        }
      );

      const unsubAssignments = onSnapshot(
        collection(db, 'hospitalDeviceAssignments'),
        (snap) => {
          setHospitalDeviceAssignments(filterByCompanyScope(
            snap.docs.map(d => ({ id: d.id, ...d.data() } as AssignedDevice)),
            currentCompanyId,
            isSuperAdmin
          ));
        },
        (err) => {
          console.error("Assignments listener error:", err);
          toast({ title: 'Veri Hatası', description: 'Cihaz atamaları yüklenemedi.', variant: 'destructive' });
        }
      );

      // Fetch active lab pools
      const unsubLabPools = onSnapshot(
        query(collection(db, 'deviceLabPools'), where('active', '==', true)),
        (snap) => {
          setDeviceLabPools(filterByCompanyScope(
            snap.docs.map(d => ({ id: d.id, ...d.data() } as DeviceLabPool)),
            currentCompanyId,
            isSuperAdmin
          ));
          setIsLoading(false);
        },
        (err) => {
          console.error("Lab pools listener error:", err);
          setIsLoading(false);
        }
      );

      return () => {
        unsubHospitals();
        unsubDevices();
        unsubAssignments();
        unsubLabPools();
      };
    } catch (error) {
      console.error("Error setting up listeners:", error);
      toast({ title: 'Kurulum Hatası', description: 'Veri dinleyicileri kurulamadı.', variant: 'destructive' });
      setIsLoading(false);
      return () => {};
    }
  }, [toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    const cleanupPromise = fetchAllApplicationData();
    return () => {
      cleanupPromise.then(cleanup => cleanup && cleanup());
    };
  }, [fetchAllApplicationData]);


  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="ml-4 text-lg">Aplikasyon Paneli Yükleniyor...</p></div>
  }

  const buildScopedOptions = () => {
    const assignedLabs = currentUserProfile?.assignedLaboratories || [];
    const scopedHospitals = (isAdminRole || assignedLabs.length === 0)
      ? hospitals
      : hospitals.filter((h) => assignedLabs.includes(h.id));
    const scopedHospitalIds = new Set(scopedHospitals.map((h) => h.id));
    const scopedDevices = devices.filter((d) => scopedHospitalIds.has(d.hospitalId));
    return { scopedHospitals, scopedDevices };
  };

  const downloadExcelTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const { scopedHospitals, scopedDevices } = buildScopedOptions();
      const today = new Date();
      const ws = XLSX.utils.aoa_to_sheet([
        ['Lab Adı', 'Cihaz Seri No', 'İşlem Türü', 'Başlangıç Tarihi', 'Başlangıç Saati', 'Bitiş Tarihi', 'Bitiş Saati', 'Cihaz Durumu', 'Yapılan İşlemler (virgülle)', 'Açıklama', 'Arıza Adı (opsiyonel)', 'Yedek Parça Kodu', 'Yedek Parça Adı', 'Yedek Parça Seri No (opsiyonel)', 'Yedek Parça Adet'],
        [scopedHospitals[0]?.name || '', scopedDevices[0]?.seriNumarasi || '', 'rutin_kurum_ziyareti', today, '09:00', today, '10:00', 'calisiyor', 'aplikasyon_kontrol', 'Toplu giriş', '', 'SERBEST-KOD', 'Serbest Yedek Parça', '', 1],
      ]);
      ws.D2 = ws.D2 || { t: 'd', v: today };
      ws.F2 = ws.F2 || { t: 'd', v: today };
      ws.D2.z = 'yyyy-mm-dd';
      ws.F2.z = 'yyyy-mm-dd';
      const seceneklerRows: Array<[string, string, string, string]> = [
        ['BAŞLIK', 'SEÇENEK', 'LAB', 'CİHAZ'],
        ['İşlem Türü', 'rutin_kurum_ziyareti', '', ''],
        ['İşlem Türü', 'periyodik_bakim', '', ''],
        ['İşlem Türü', 'ariza', '', ''],
        ['İşlem Türü', 'alis', '', ''],
        ['İşlem Türü', 'roche_bilgisayar_arizasi', '', ''],
        ['İşlem Türü', 'diger', '', ''],
        ['Yapılan İşlem', 'aplikasyon_kontrol', '', ''],
        ['Yapılan İşlem', 'kalibrasyon_kontrol', '', ''],
        ['Yapılan İşlem', 'qc_materyal_kontrol', '', ''],
        ['Yapılan İşlem', 'ornek_sonucu_karsilastirma', '', ''],
        ['Yapılan İşlem', 'reaktif_yenileme', '', ''],
        ['Yapılan İşlem', 'kalibrator_yenileme', '', ''],
        ['Yapılan İşlem', 'qc_yenileme', '', ''],
        ['Yapılan İşlem', 'cv_calismasi', '', ''],
        ['Yapılan İşlem', 'diger', '', ''],
        ['Cihaz Durumu', 'calisiyor', '', ''],
        ['Cihaz Durumu', 'arizali', '', ''],
        ['Cihaz Durumu', 'denemede', '', ''],
        ['Cihaz Durumu', 'diger', '', ''],
        ...scopedHospitals.map((h) => ['Lab', h.name, '', '']),
        ...scopedDevices.map((d) => ['Cihaz Seri No', d.seriNumarasi || '', scopedHospitals.find((h) => h.id === d.hospitalId)?.name || '', d.cihazAdi || d.model || '']),
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'AplikasyonFormlar');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(seceneklerRows), 'Secenekler');
      XLSX.writeFile(wb, `aplikasyon_toplu_form_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
      toast({ title: 'Şablon indirildi', description: 'Aplikasyon için toplu form şablonu indirildi.' });
    } catch (err) {
      console.error('template error', err);
      toast({ title: 'Hata', description: 'Excel şablonu oluşturulamadı.', variant: 'destructive' });
    }
  };

  const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false });
      const { scopedHospitals, scopedDevices } = buildScopedOptions();
      const labMap = new Map(scopedHospitals.map((h) => [String(h.name || '').trim().toLowerCase(), h]));
      let ok = 0;
      let fail = 0;
      for (const row of rows) {
        const labName = String(row['Lab Adı'] ?? '').trim();
        const serial = String(row['Cihaz Seri No'] ?? '').trim();
        const islemTuru = String(row['İşlem Türü'] ?? '').trim();
        const baslangicTarihi = String(row['Başlangıç Tarihi'] ?? '').trim();
        const baslangicSaati = String(row['Başlangıç Saati'] ?? '').trim();
        const bitisTarihi = String(row['Bitiş Tarihi'] ?? '').trim();
        const bitisSaati = String(row['Bitiş Saati'] ?? '').trim();
        const cihazDurumu = String(row['Cihaz Durumu'] ?? '').trim();
        if (!labName || !serial || !islemTuru || !baslangicTarihi || !baslangicSaati || !bitisTarihi || !bitisSaati || !cihazDurumu) { fail += 1; continue; }
        const lab = labMap.get(labName.toLowerCase());
        if (!lab) { fail += 1; continue; }
        const device = scopedDevices.find((d) => d.hospitalId === lab.id && String(d.seriNumarasi || '').trim() === serial);
        if (!device) { fail += 1; continue; }
        const actions: Record<string, any>[] = String(row['Yapılan İşlemler (virgülle)'] ?? '').split(',').map((v) => v.trim()).filter(Boolean).map((operation) => ({
          id: `excel_op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'operation',
          action: operation,
          quantity: 1,
          isManualEntry: true,
        }));
        const partCode = String(row['Yedek Parça Kodu'] ?? '').trim();
        const partName = String(row['Yedek Parça Adı'] ?? '').trim();
        if (partCode || partName) {
          actions.push({
            id: `excel_part_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'part_change',
            action: 'parca_degisimi',
            stokKodu: partCode,
            stokAdi: partName,
            serialNumber: String(row['Yedek Parça Seri No (opsiyonel)'] ?? '').trim() || undefined,
            quantity: Math.max(1, Number(row['Yedek Parça Adet'] ?? 1) || 1),
            isManualEntry: true,
          });
        }
        const formRef = doc(collection(db, 'aplikasyonActionForms'));
        const formNo = await reserveActionFormNumber({
          db,
          companyId: currentCompanyId,
          userUid: currentUserProfile?.uid || 'unknown',
          userName: currentUserProfile?.name || currentUserProfile?.displayName || '',
          formTypeLetter: 'A',
        });
        const payload = {
          deviceId: device.id,
          cihazAdi: device.cihazAdi || device.model,
          seriNumarasi: device.seriNumarasi || '',
          hospitalId: lab.id,
          labName: lab.name,
          actions,
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
          formType: 'aplikasyon',
          importedFromExcel: true,
        };
        await setDoc(formRef, payload);
        await setDoc(doc(db, 'deviceActionForms', formRef.id), payload);
        ok += 1;
      }
      toast({ title: 'Excel içe aktarma tamamlandı', description: `Başarılı satır: ${ok} • Başarısız satır: ${fail}` });
    } catch (err) {
      console.error('upload error', err);
      toast({ title: 'Hata', description: 'Excel yükleme başarısız.', variant: 'destructive' });
    }
  };

  const commonProps = {
    hospitals,
    devices,
    setDevices,
    hospitalDeviceAssignments,
    labPools: deviceLabPools,
    userAssignedLabs: currentUserProfile?.assignedLaboratories || [],
    userRole: currentUserProfile?.role || '',
    toast,
    setSubView: () => {},
    fetchAllApplicationData: async () => { await fetchAllApplicationData(); },
  };

  return (
    <div className="space-y-3">
      <div className="px-4 sm:px-8 pt-4 flex gap-2">
        <button onClick={downloadExcelTemplate} className="cihaz-tool-item flex items-center gap-2 px-3 py-2 text-sm font-medium">
          <Download className="h-4 w-4" />
          <span>Excel Şablonu</span>
        </button>
        <label className="cihaz-tool-item flex items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer">
          <Upload className="h-4 w-4" />
          <span>Excel Yükle</span>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
        </label>
      </div>
      <AplikasyonPanel {...commonProps} />
    </div>
  );
}
