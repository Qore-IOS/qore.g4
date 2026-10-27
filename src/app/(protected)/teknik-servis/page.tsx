'use client';
import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Hospital, Device, AssignedDevice, DeviceLabPool } from '@/lib/types';
import { useToast } from "@/hooks/use-toast";
import { collection, doc, setDoc, serverTimestamp } from '../../../lib/data/client';
import { db } from '../../../lib/data/client';
import { useAuth } from '@/contexts/auth-context';
import {
  useHospitals,
  useDevicesForLabs,
  useDeviceLabPools,
} from '@/hooks/useDatabaseQueries';
import TeknikServisPanel from '@/components/teknik-servis-panel';
import { HospitalGridPanelSkeleton } from '@/components/perf/PanelSkeletons';
import { Download, Upload } from 'lucide-react';
import { reserveActionFormNumber } from '@/lib/form-number';
import { format } from 'date-fns';

export default function TeknikServisPage() {
  const { toast } = useToast();
  const { currentUserProfile, currentCompanyId } = useAuth();
  const queryClient = useQueryClient();

  const isAdminRole = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'super_admin';

  // TanStack Query — cache shared with other panels (cihaz-yonetimi-host, stok-yonetimi).
  // Static data (hospitals, devices, assignments, lab pools) changes rarely; TQ falls back
  // to refetchOnWindowFocus + 30 min staleTime, which keeps the list responsive without
  // a permanent realtime listener.
  // PERF (Faz 6 mobil): Lab-scoped teknisyen YALNIZCA atandığı lab'ların cihazlarını çeker
  // (tüm şirket koleksiyonu yerine) → panel açılışındaki 15+ sn'lik veri beklemesi biter.
  // Admin/superadmin (atanmış lab yok) → null = tüm liste (eski davranış).
  const assignedLabIds = currentUserProfile?.assignedLaboratories ?? [];
  const labScope = isAdminRole || assignedLabIds.length === 0 ? null : assignedLabIds;

  const hospitalsQuery = useHospitals();
  const devicesQuery = useDevicesForLabs(labScope);
  const labPoolsQuery = useDeviceLabPools();

  const isLoading =
    hospitalsQuery.isLoading ||
    devicesQuery.isLoading ||
    labPoolsQuery.isLoading;

  useEffect(() => {
    const anyError =
      hospitalsQuery.isError || devicesQuery.isError || labPoolsQuery.isError;
    if (anyError) {
      toast({ title: 'Veri Hatası', description: 'Teknik servis verileri yüklenemedi.', variant: 'destructive' });
    }
  }, [hospitalsQuery.isError, devicesQuery.isError, labPoolsQuery.isError, toast]);

  const hospitals = (hospitalsQuery.data ?? []) as Hospital[];
  const devices = (devicesQuery.data ?? []) as Device[];
  const deviceLabPools = (labPoolsQuery.data ?? []) as DeviceLabPool[];

  // Sort hospitals by name to preserve previous orderBy('name', 'asc') behavior.
  const sortedHospitals = React.useMemo(
    () => [...hospitals].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr')),
    [hospitals],
  );

  // Compatibility shim: subcomponents historically called fetchAllApplicationData()
  // to refresh after writes. We invalidate the cached queries instead — TQ refetches
  // automatically and any consumer re-renders with the new data.
  const refreshAll = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['hospitals'] }),
      queryClient.invalidateQueries({ queryKey: ['devices'] }),
      queryClient.invalidateQueries({ queryKey: ['deviceLabPools'] }),
    ]);
  }, [queryClient]);


  if (isLoading) {
    // PERF (Faz 6 mobil): Boş ekran + ortada spinner yerine layout-eşleşen skeleton.
    // Mobilde anında panel yapısı görünür → "geç açılma" hissini ortadan kaldırır.
    return <HospitalGridPanelSkeleton />;
  }

  const buildScopedOptions = () => {
    const assignedLabs = currentUserProfile?.assignedLaboratories || [];
    const scopedHospitals = (isAdminRole || assignedLabs.length === 0)
      ? sortedHospitals
      : sortedHospitals.filter((h) => assignedLabs.includes(h.id));
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
        ['Lab Adı', 'Cihaz Seri No', 'İşlem Tipi', 'İşlem Türü', 'Başlangıç Tarihi', 'Başlangıç Saati', 'Bitiş Tarihi', 'Bitiş Saati', 'Cihaz Durumu', 'Yapılan İşlemler (virgülle)', 'Açıklama', 'Arıza Adı (opsiyonel)', 'Yedek Parça Kodu', 'Yedek Parça Adı', 'Yedek Parça Seri No (opsiyonel)', 'Yedek Parça Adet'],
        [scopedHospitals[0]?.name || '', scopedDevices[0]?.seriNumarasi || '', 'cihaz', 'rutin_kurum_ziyareti', today, '09:00', today, '10:00', 'calisiyor', 'genel_temizlik_yaglama', 'Toplu giriş', '', 'SERBEST-KOD', 'Serbest Yedek Parça', '', 1],
      ]);
      ws.E2 = ws.E2 || { t: 'd', v: today };
      ws.G2 = ws.G2 || { t: 'd', v: today };
      ws.E2.z = 'yyyy-mm-dd';
      ws.G2.z = 'yyyy-mm-dd';

      const seceneklerRows: Array<[string, string, string, string]> = [
        ['BAŞLIK', 'SEÇENEK', 'LAB', 'CİHAZ'],
        ['İşlem Tipi', 'cihaz', '', ''],
        ['İşlem Tipi', 'ups', '', ''],
        ['İşlem Tipi', 'su_sistemi', '', ''],
        ['İşlem Türü', 'rutin_kurum_ziyareti', '', ''],
        ['İşlem Türü', 'periyodik_bakim', '', ''],
        ['İşlem Türü', 'cihaz_kurulumu', '', ''],
        ['İşlem Türü', 'ariza', '', ''],
        ['İşlem Türü', 'sw_update', '', ''],
        ['İşlem Türü', 'alis', '', ''],
        ['İşlem Türü', 'roche_bilgisayar_arizasi', '', ''],
        ['Yapılan İşlem', 'genel_temizlik_yaglama', '', ''],
        ['Yapılan İşlem', 'temel_fonksiyon_testleri', '', ''],
        ['Yapılan İşlem', 'mekanik_ayarlar_kontrol', '', ''],
        ['Yapılan İşlem', 'optik_ayarlar_kontrol', '', ''],
        ['Yapılan İşlem', 'pipetleme_transfer_ayarlari', '', ''],
        ['Cihaz Durumu', 'calisiyor', '', ''],
        ['Cihaz Durumu', 'arizali', '', ''],
        ['Cihaz Durumu', 'denemede', '', ''],
        ['Cihaz Durumu', 'diger', '', ''],
        ...scopedHospitals.map((h) => ['Lab', h.name, '', '']),
        ...scopedDevices.map((d) => ['Cihaz Seri No', d.seriNumarasi || '', scopedHospitals.find((h) => h.id === d.hospitalId)?.name || '', d.cihazAdi || d.model || '']),
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'TeknikServisFormlar');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(seceneklerRows), 'Secenekler');
      XLSX.writeFile(wb, `teknik_servis_toplu_form_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
      toast({ title: 'Şablon indirildi', description: 'Teknik servis için toplu form şablonu indirildi.' });
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
        const islemTipi = String(row['İşlem Tipi'] ?? '').trim();
        const islemTuru = String(row['İşlem Türü'] ?? '').trim();
        const baslangicTarihi = String(row['Başlangıç Tarihi'] ?? '').trim();
        const baslangicSaati = String(row['Başlangıç Saati'] ?? '').trim();
        const bitisTarihi = String(row['Bitiş Tarihi'] ?? '').trim();
        const bitisSaati = String(row['Bitiş Saati'] ?? '').trim();
        const cihazDurumu = String(row['Cihaz Durumu'] ?? '').trim();
        if (!labName || !serial || !islemTipi || !islemTuru || !baslangicTarihi || !baslangicSaati || !bitisTarihi || !bitisSaati || !cihazDurumu) { fail += 1; continue; }
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

        const formRef = doc(collection(db, 'teknikServisActionForms'));
        const formNo = await reserveActionFormNumber({
          db,
          companyId: currentCompanyId,
          userUid: currentUserProfile?.uid || 'unknown',
          userName: currentUserProfile?.name || currentUserProfile?.displayName || '',
          formTypeLetter: 'T',
        });
        const payload = {
          deviceId: device.id,
          cihazAdi: device.cihazAdi || device.model,
          seriNumarasi: device.seriNumarasi || '',
          hospitalId: lab.id,
          labName: lab.name,
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
        ok += 1;
      }
      toast({ title: 'Excel içe aktarma tamamlandı', description: `Başarılı satır: ${ok} • Başarısız satır: ${fail}` });
    } catch (err) {
      console.error('upload error', err);
      toast({ title: 'Hata', description: 'Excel yükleme başarısız.', variant: 'destructive' });
    }
  };

  const commonProps = {
    hospitals: sortedHospitals,
    devices,
    // Cached devices come from TanStack Query; the panel does not actually mutate
    // the list (the prop is in the interface but not destructured). Keep a no-op
    // setter so the component contract stays satisfied.
    setDevices: (() => {}) as React.Dispatch<React.SetStateAction<Device[]>>,
    // Panel bu prop'u kullanmıyor (arayüzde var ama destructure edilmiyor); ölü
    // assignments sorgusu kaldırıldı → boş dizi geçilir.
    hospitalDeviceAssignments: [] as AssignedDevice[],
    labPools: deviceLabPools,
    userAssignedLabs: currentUserProfile?.assignedLaboratories || [],
    userRole: currentUserProfile?.role || '',
    toast,
    setSubView: () => {}, // No subviews in this dedicated page
    fetchAllApplicationData: refreshAll,
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
      <TeknikServisPanel {...commonProps} />
    </div>
  );
}
