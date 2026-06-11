


'use client';
import { db } from '@/lib/firebase';
import {
  addDoc, collection, doc, serverTimestamp, Timestamp, updateDoc, getDoc, writeBatch, query, where, getDocs
} from 'firebase/firestore';
import { getDocsResilient, getDocResilient } from '@/lib/firestore-network-recovery';
import { createNotification, emitFaultOpened, emitFaultTransferred } from '@/lib/notifications';
import type { DeviceFaultStatus, InterventionType } from '@/lib/types';
import { withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';

export type DeviceFaultEventType = 'opened' | 'note' | 'status_change' | 'closed' | 'assigned' | 'intervention_started' | 'location_verified';

export type OpenFaultInput = {
  hospitalId: string;
  labName: string;
  deviceId: string;
  model: string;
  serial: string;
  faultType: 'teknik_servis' | 'aplikasyon';
  openedByUid: string;
  openedByName: string;
  openDescription?: string | null; // Allow null
  title?: string; // optional custom title
  faultDefinitionId?: string; // ID from faultDefinitions collection
  faultName?: string; // Name from faultDefinitions (for statistics)
  deviceImageUrl?: string; // Device model image URL for push notifications
  companyId?: string | null;
  affectsAllDevices?: boolean;
  affectedDeviceIds?: string[];
  stopLevel?: 'E STOP' | 'S STOP' | 'NORMAL STOP';
  notifyAllPersonnel?: boolean;
};

export async function openDeviceFaultReport(input: OpenFaultInput): Promise<string> {
  const {
    hospitalId, labName, deviceId, model, serial,
    faultType, openedByUid, openedByName, openDescription, title,
    faultDefinitionId, faultName, companyId, affectsAllDevices = false,
    affectedDeviceIds = [], stopLevel, notifyAllPersonnel = false
  } = input;

  let resolvedAffectedDeviceIds = affectedDeviceIds.filter(Boolean);
  if (affectsAllDevices && resolvedAffectedDeviceIds.length === 0 && hospitalId) {
    const allLabDevicesSnap = await getDocsResilient(
      scopedQuery('devices', companyId ?? null, false, where('hospitalId', '==', hospitalId))
    );
    resolvedAffectedDeviceIds = allLabDevicesSnap.docs.map((d) => d.id);
  }

  // Corrected flat structure for Google Sheets extension
  const report = {
    // Fields for Google Sheets
    'cihaz adı': model,
    'laboratuvar': labName,
    'personel': openedByName,
    'saat': serverTimestamp(), // Firestore will convert this to a timestamp
    'açıklama': openDescription ?? '',

    // Internal fields for the app
    hospitalId,
    labName,
    model,
    deviceId,
    serial,
    faultType,
    openedByUid,
    openedByName,
    description: openDescription ?? '',
    status: 'atama_bekliyor' as DeviceFaultStatus, // Yeni durumlar: atama_bekliyor → mudahale_bekliyor → mudahale_ediliyor → cozuldu
    title: title ?? `${labName} • ${model} (${serial}) • ${faultType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}`,
    openedAt: serverTimestamp(),
    // Yeni süre takibi alanları
    assignedAt: null,
    assignedToUid: null,
    assignedToName: null,
    interventionType: null,
    interventionStartedAt: null,
    locationVerifiedAt: null,
    relatedTests: [],
    // Fault definition fields (for statistics)
    faultDefinitionId: faultDefinitionId ?? null,
    faultName: faultName ?? null,
    affectsAllDevices,
    affectedDeviceIds: resolvedAffectedDeviceIds,
    stopLevel: stopLevel ?? null,
  };

  const reportRef = await addDoc(collection(db, 'deviceFaultReports'), withCompanyScope(report, companyId));

  // Update impacted device(s) arizaDurumu
  if (affectsAllDevices && resolvedAffectedDeviceIds.length > 0) {
    const batch = writeBatch(db);
    resolvedAffectedDeviceIds.forEach((id) => {
      if (!id) return;
      batch.update(doc(db, 'devices', id), {
        arizaDurumu: faultType,
        arizaAciklamasi: openDescription ?? '',
      });
    });
    await batch.commit();
  } else if (deviceId) {
    const deviceRef = doc(db, 'devices', deviceId);
    await updateDoc(deviceRef, {
      arizaDurumu: faultType,
      arizaAciklamasi: openDescription ?? '',
    });
  }

  // first history event (no change here)
  await addDoc(collection(db, 'deviceFaultReports', reportRef.id, 'history'), {
    type: 'opened' as DeviceFaultEventType,
    actorUid: openedByUid,
    actorName: openedByName,
    description: openDescription ?? '',
    timestamp: serverTimestamp(),
  });

  if (affectsAllDevices && resolvedAffectedDeviceIds.length > 0) {
    const historyBatch = writeBatch(db);
    resolvedAffectedDeviceIds.forEach((id) => {
      const historyRef = doc(collection(db, 'deviceFaultReports', reportRef.id, 'history'));
      historyBatch.set(historyRef, {
        type: 'opened',
        actorUid: openedByUid,
        actorName: openedByName,
        deviceId: id,
        description: `${stopLevel || 'STOP'} etkisi kapsamında cihaz arızalıya alındı.`,
        timestamp: serverTimestamp(),
      });
    });
    await historyBatch.commit();
  }

  // Emit notification after fault is successfully opened
  if (notifyAllPersonnel) {
    const stopDeviceName = stopLevel ? `${model} • ${stopLevel}` : model;
    const stopDescription = openDescription ?? `${stopLevel || 'STOP'} arızası açıldı.`;

    await Promise.all([
      emitFaultOpened({
        actor: { uid: openedByUid, name: openedByName },
        faultReportId: reportRef.id,
        assignedDeviceId: deviceId,
        deviceName: stopDeviceName,
        faultType: 'teknik_servis',
        hospitalId,
        hospitalName: labName,
        description: stopDescription,
        deviceImageUrl: input.deviceImageUrl,
      }),
      emitFaultOpened({
        actor: { uid: openedByUid, name: openedByName },
        faultReportId: reportRef.id,
        assignedDeviceId: deviceId,
        deviceName: stopDeviceName,
        faultType: 'aplikasyon',
        hospitalId,
        hospitalName: labName,
        description: stopDescription,
        deviceImageUrl: input.deviceImageUrl,
      }),
    ]);
  } else {
    await emitFaultOpened({
      actor: { uid: openedByUid, name: openedByName },
      faultReportId: reportRef.id,
      assignedDeviceId: deviceId,
      deviceName: model,
      faultType: faultType,
      hospitalId: hospitalId,
      hospitalName: labName,
      description: openDescription ?? undefined,
      deviceImageUrl: input.deviceImageUrl,
    });
  }

  return reportRef.id;
}

export async function appendFaultNote(reportId: string, actor: { uid: string; name: string }, description: string) {
  await addDoc(collection(db, 'deviceFaultReports', reportId, 'history'), {
    type: 'note' as DeviceFaultEventType,
    actorUid: actor.uid,
    actorName: actor.name,
    description,
    timestamp: serverTimestamp(),
  });
}

export async function closeDeviceFaultReport(
  reportId: string,
  params: {
    closedByUid: string;
    closedByName: string;
    closeDescription?: string;
    supportPersonnel?: { uid: string; name: string } | null;
    supportPersonnels?: { uid: string; name: string }[];
  }
) {
  const { closedByUid, closedByName, closeDescription, supportPersonnel } = params;
  const supportPersonnels = params.supportPersonnels ?? (supportPersonnel ? [supportPersonnel] : []);
  const primarySupportPersonnel = supportPersonnels[0] || null;
  const reportRef = doc(db, 'deviceFaultReports', reportId);

  const reportSnap = await getDocResilient(reportRef);
  if (!reportSnap.exists()) {
    throw new Error('Arıza raporu bulunamadı.');
  }
  const reportData = reportSnap.data();
  const deviceId = reportData?.deviceId;

  // Süre hesaplama
  const now = Date.now();
  const openedAt = reportData?.openedAt?.toDate?.()?.getTime() || now;
  const interventionStartedAt = reportData?.interventionStartedAt?.toDate?.()?.getTime() || now;
  const cozumSuresi = now - interventionStartedAt;
  const toplamCozumSuresi = now - openedAt;

  const batch = writeBatch(db);

  // 1. Update the fault report
  const updateData: Record<string, any> = {
    status: 'cozuldu' as DeviceFaultStatus, // Yeni status
    closedByUid,
    closedByName,
    closedAt: serverTimestamp(),
    closeDescription: closeDescription ?? '',
    cozumSuresi, // Müdahaleden çözüme süre
    toplamCozumSuresi, // Toplam süre
  };

  // Destek personeli bilgisi
  if (primarySupportPersonnel) {
    updateData.supportPersonnelUid = primarySupportPersonnel.uid;
    updateData.supportPersonnelName = primarySupportPersonnel.name;
  }
  updateData.supportPersonnelUids = supportPersonnels.map((p) => p.uid);
  updateData.supportPersonnelNames = supportPersonnels.map((p) => p.name);

  batch.update(reportRef, updateData);

  // 2. Update related device documents
  //    Check if there are other open fault reports for the same device
  if (reportData?.affectsAllDevices && Array.isArray(reportData?.affectedDeviceIds)) {
    const targetDeviceIds = (reportData.affectedDeviceIds as string[]).filter(Boolean);

    for (const targetDeviceId of targetDeviceIds) {
      const otherOpenFaults = await getDocsResilient(
        query(
          collection(db, 'deviceFaultReports'),
          where('deviceId', '==', targetDeviceId),
          where('status', 'in', ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'])
        )
      );
      const remainingOpenFaults = otherOpenFaults.docs.filter(d => d.id !== reportId);

      const deviceRef = doc(db, 'devices', targetDeviceId);
      if (remainingOpenFaults.length > 0) {
        const remainingFault = remainingOpenFaults[0].data();
        batch.update(deviceRef, {
          arizaDurumu: remainingFault.faultType || 'teknik_servis',
          arizaAciklamasi: remainingFault.description || '',
        });
      } else {
        batch.update(deviceRef, {
          arizaDurumu: 'yok',
          arizaAciklamasi: '',
        });
      }
    }
  } else if (deviceId) {
    const otherOpenFaults = await getDocsResilient(
      query(
        collection(db, 'deviceFaultReports'),
        where('deviceId', '==', deviceId),
        where('status', 'in', ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'])
      )
    );
    // Exclude the current report being closed
    const remainingOpenFaults = otherOpenFaults.docs.filter(d => d.id !== reportId);

    const deviceRef = doc(db, 'devices', deviceId);
    if (remainingOpenFaults.length > 0) {
      // There are other open faults - set arizaDurumu to the remaining fault's type
      const remainingFault = remainingOpenFaults[0].data();
      batch.update(deviceRef, {
        arizaDurumu: remainingFault.faultType || 'teknik_servis',
        arizaAciklamasi: remainingFault.description || '',
      });
    } else {
      batch.update(deviceRef, {
        arizaDurumu: 'yok',
        arizaAciklamasi: '',
      });
    }
  }

  // 3. Add the history event for closing
  const historyRef = doc(collection(db, 'deviceFaultReports', reportId, 'history'));
  const historyData: Record<string, any> = {
    type: 'closed' as DeviceFaultEventType,
    actorUid: closedByUid,
    actorName: closedByName,
    description: closeDescription ?? 'Arıza giderildi.',
    timestamp: serverTimestamp(),
  };

  if (primarySupportPersonnel) {
    historyData.supportPersonnelUid = primarySupportPersonnel.uid;
    historyData.supportPersonnelName = primarySupportPersonnel.name;
    historyData.description = `${closeDescription ?? 'Arıza giderildi.'} (Destek: ${supportPersonnels.map((p) => p.name).join(', ')})`;
  }
  historyData.supportPersonnelUids = supportPersonnels.map((p) => p.uid);
  historyData.supportPersonnelNames = supportPersonnels.map((p) => p.name);

  batch.set(historyRef, historyData);

  // Commit all writes
  await batch.commit();
}

// ============================================
// YENİ FONKSİYONLAR - ARIZA ATAMA SİSTEMİ
// ============================================

/**
 * Arızayı personele ata (üzerime al)
 * Status: atama_bekliyor → mudahale_bekliyor
 */


export async function transferFaultToOtherUnit(
  reportId: string,
  actor: { uid: string; name: string }
): Promise<void> {
  const reportRef = doc(db, 'deviceFaultReports', reportId);
  const reportSnap = await getDocResilient(reportRef);

  if (!reportSnap.exists()) {
    throw new Error('Arıza raporu bulunamadı.');
  }

  const reportData = reportSnap.data();

  if (reportData.status !== 'atama_bekliyor' && reportData.status !== 'open') {
    throw new Error('Sadece atama bekleyen arızalar başka birime aktarılabilir.');
  }

  const currentFaultType = reportData.faultType as 'teknik_servis' | 'aplikasyon';
  const targetFaultType: 'teknik_servis' | 'aplikasyon' =
    currentFaultType === 'teknik_servis' ? 'aplikasyon' : 'teknik_servis';

  const batch = writeBatch(db);

  batch.update(reportRef, {
    faultType: targetFaultType,
    assignedAt: null,
    assignedToUid: null,
    assignedToName: null,
    atamaBekmeSuresi: null,
  });

  // Update device arizaDurumu to reflect the new fault type
  if (reportData.deviceId) {
    const deviceRef = doc(db, 'devices', reportData.deviceId);
    batch.update(deviceRef, {
      arizaDurumu: targetFaultType,
    });
  }

  const historyRef = doc(collection(db, 'deviceFaultReports', reportId, 'history'));
  const targetLabel = targetFaultType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon';

  batch.set(historyRef, {
    type: 'status_change' as DeviceFaultEventType,
    actorUid: actor.uid,
    actorName: actor.name,
    description: `Arıza ${actor.name} tarafından ${targetLabel} birimine aktarıldı.`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  // Cihaz resmi URL'si için devices koleksiyonundan çek
  let deviceImageUrl: string | undefined;
  if (reportData?.deviceId) {
    const deviceRef = doc(db, 'devices', reportData.deviceId);
    const deviceSnap = await getDocResilient(deviceRef);
    if (deviceSnap.exists()) {
      deviceImageUrl = deviceSnap.data()?.imageUrl;
    }
  }

  await emitFaultTransferred({
    actor,
    faultReportId: reportId,
    assignedDeviceId: reportData?.deviceId,
    deviceName: reportData?.model || reportData?.title || 'Cihaz',
    toFaultType: targetFaultType,
    hospitalId: reportData?.hospitalId,
    hospitalName: reportData?.labName || reportData?.hospitalName,
    description: reportData?.description,
    deviceImageUrl,
  });
}
export async function assignFaultToSelf(
  reportId: string,
  actor: { uid: string; name: string }
): Promise<void> {
  const reportRef = doc(db, 'deviceFaultReports', reportId);
  const reportSnap = await getDocResilient(reportRef);

  if (!reportSnap.exists()) {
    throw new Error('Arıza raporu bulunamadı.');
  }

  const reportData = reportSnap.data();

  // Sadece atama_bekliyor durumundaki arızalar atanabilir
  if (reportData.status !== 'atama_bekliyor' && reportData.status !== 'open') {
    throw new Error('Bu arıza zaten atanmış.');
  }

  // Atama bekleme süresi hesaplama
  const now = Date.now();
  const openedAt = reportData?.openedAt?.toDate?.()?.getTime() || now;
  const atamaBekmeSuresi = now - openedAt;

  const batch = writeBatch(db);

  batch.update(reportRef, {
    status: 'mudahale_bekliyor' as DeviceFaultStatus,
    assignedAt: serverTimestamp(),
    assignedToUid: actor.uid,
    assignedToName: actor.name,
    atamaBekmeSuresi,
  });

  // History event
  const historyRef = doc(collection(db, 'deviceFaultReports', reportId, 'history'));
  batch.set(historyRef, {
    type: 'assigned' as DeviceFaultEventType,
    actorUid: actor.uid,
    actorName: actor.name,
    description: `Arıza ${actor.name} tarafından üzerine alındı.`,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Müdahaleyi başlat (telefon veya kurum ziyareti)
 * Status: mudahale_bekliyor → mudahale_ediliyor
 */
export async function startIntervention(
  reportId: string,
  actor: { uid: string; name: string },
  interventionType: InterventionType,
  relatedTests?: string[]
): Promise<void> {
  const reportRef = doc(db, 'deviceFaultReports', reportId);
  const reportSnap = await getDocResilient(reportRef);

  if (!reportSnap.exists()) {
    throw new Error('Arıza raporu bulunamadı.');
  }

  const reportData = reportSnap.data();

  // Sadece mudahale_bekliyor durumunda müdahale başlatılabilir
  if (reportData.status !== 'mudahale_bekliyor') {
    throw new Error('Bu arıza müdahale bekliyor durumunda değil.');
  }

  // Müdahale bekleme süresi hesaplama
  const now = Date.now();
  const assignedAt = reportData?.assignedAt?.toDate?.()?.getTime() || now;
  const mudahaleBekmeSuresi = now - assignedAt;

  const batch = writeBatch(db);

  const updateData: Record<string, any> = {
    status: 'mudahale_ediliyor' as DeviceFaultStatus,
    interventionType,
    interventionStartedAt: serverTimestamp(),
    mudahaleBekmeSuresi,
  };

  if (relatedTests && relatedTests.length > 0) {
    updateData.relatedTests = relatedTests;
  }

  batch.update(reportRef, updateData);

  // History event
  const historyRef = doc(collection(db, 'deviceFaultReports', reportId, 'history'));
  const interventionLabel = interventionType === 'telefon' ? 'Telefonla destek' : 'Kurumda müdahale';
  batch.set(historyRef, {
    type: 'intervention_started' as DeviceFaultEventType,
    actorUid: actor.uid,
    actorName: actor.name,
    description: `${interventionLabel} başlatıldı.${relatedTests && relatedTests.length > 0 ? ` İlişkili testler: ${relatedTests.join(', ')}` : ''}`,
    timestamp: serverTimestamp(),
    interventionType,
    relatedTests: relatedTests || [],
  });

  await batch.commit();
}

/**
 * Kurum ziyareti için konum doğrulama
 * Laboratuvarın koordinatları 100m içindeyse doğrular
 */
export async function verifyLocationForIntervention(
  reportId: string,
  actor: { uid: string; name: string },
  userLocation: { lat: number; lng: number }
): Promise<{ success: boolean; distance: number; message: string }> {
  const reportRef = doc(db, 'deviceFaultReports', reportId);
  const reportSnap = await getDocResilient(reportRef);

  if (!reportSnap.exists()) {
    throw new Error('Arıza raporu bulunamadı.');
  }

  const reportData = reportSnap.data();
  const hospitalId = reportData?.hospitalId;

  if (!hospitalId) {
    throw new Error('Arıza kaydında laboratuvar bilgisi bulunamadı.');
  }

  // Laboratuvar koordinatlarını al
  const hospitalRef = doc(db, 'hospitals', hospitalId);
  const hospitalSnap = await getDocResilient(hospitalRef);

  if (!hospitalSnap.exists()) {
    throw new Error('Laboratuvar bulunamadı.');
  }

  const hospitalData = hospitalSnap.data();
  const labLat = hospitalData?.lat;
  const labLng = hospitalData?.lng;

  if (!labLat || !labLng) {
    throw new Error('Laboratuvarın koordinat bilgisi tanımlı değil.');
  }

  // Haversine formülü ile mesafe hesapla
  const distance = calculateDistance(userLocation.lat, userLocation.lng, labLat, labLng);
  const GEOFENCE_RADIUS = 100; // 100 metre

  if (distance > GEOFENCE_RADIUS) {
    return {
      success: false,
      distance: Math.round(distance),
      message: `Laboratuvara ${Math.round(distance)} metre uzaklıktasınız. Konum doğrulaması için ${GEOFENCE_RADIUS} metre içinde olmanız gerekiyor.`,
    };
  }

  // Konum doğrulandı - history'ye kaydet
  const historyRef = doc(collection(db, 'deviceFaultReports', reportId, 'history'));
  await addDoc(collection(db, 'deviceFaultReports', reportId, 'history'), {
    type: 'location_verified' as DeviceFaultEventType,
    actorUid: actor.uid,
    actorName: actor.name,
    description: `Konum doğrulandı. Mesafe: ${Math.round(distance)}m`,
    timestamp: serverTimestamp(),
    locationLat: userLocation.lat,
    locationLng: userLocation.lng,
    labLat,
    labLng,
    distance: Math.round(distance),
  });

  // Ana dokümanı güncelle
  await updateDoc(reportRef, {
    locationVerifiedAt: serverTimestamp(),
    locationVerifiedLat: userLocation.lat,
    locationVerifiedLng: userLocation.lng,
  });

  return {
    success: true,
    distance: Math.round(distance),
    message: `Konum doğrulandı. Laboratuvara ${Math.round(distance)} metre uzaklıktasınız.`,
  };
}

/**
 * İlişkili testleri güncelle
 */
export async function updateRelatedTests(
  reportId: string,
  relatedTests: string[]
): Promise<void> {
  const reportRef = doc(db, 'deviceFaultReports', reportId);
  await updateDoc(reportRef, { relatedTests });
}

// Haversine formülü ile iki koordinat arasındaki mesafeyi hesapla (metre)
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Dünya yarıçapı (metre)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Ejected Kit Fault Types
export type OpenEjectedKitFaultInput = {
  hospitalId: string;
  labName: string;
  deviceId: string;
  model: string;
  serial: string;
  openedByUid: string;
  openedByName: string;
  openDescription: string;
  // Kit-specific fields
  stokKodu: string;
  stokAdi: string;
  cihazGrubu?: string;
  testCount: number;
  quantityType: 'kutu' | 'test';
  deviceImageUrl?: string; // Device model image URL for push notifications
  companyId?: string | null;
};

export async function openEjectedKitFaultReport(input: OpenEjectedKitFaultInput): Promise<string> {
  const {
    hospitalId, labName, deviceId, model, serial,
    openedByUid, openedByName, openDescription,
    stokKodu, stokAdi, cihazGrubu, testCount, quantityType, companyId
  } = input;

  const report = {
    // Fields for Google Sheets
    'cihaz adı': model,
    'laboratuvar': labName,
    'personel': openedByName,
    'saat': serverTimestamp(),
    'açıklama': openDescription,

    // Internal fields for the app
    hospitalId,
    labName,
    model,
    deviceId,
    serial,
    faultType: 'aplikasyon' as const,
    openedByUid,
    openedByName,
    description: openDescription,
    status: 'open' as DeviceFaultStatus,
    title: `${labName} • ${model} (${serial}) • Cihazdan Çıkan Kit`,
    openedAt: serverTimestamp(),

    // Ejected kit specific fields
    isEjectedKitFault: true,
    productStokKodu: stokKodu,
    productStokAdi: stokAdi,
    productCihazGrubu: cihazGrubu || null,
    testCount,
    quantityType,
    kitResolution: null,
  };

  const reportRef = await addDoc(collection(db, 'deviceFaultReports'), withCompanyScope(report, companyId));

  // Update device arizaDurumu
  if (deviceId) {
    const deviceRef = doc(db, 'devices', deviceId);
    await updateDoc(deviceRef, {
      arizaDurumu: 'aplikasyon',
      arizaAciklamasi: `Cihazdan çıkan kit: ${stokAdi} (${stokKodu})`,
    });
  }

  // First history event
  await addDoc(collection(db, 'deviceFaultReports', reportRef.id, 'history'), {
    type: 'opened' as DeviceFaultEventType,
    actorUid: openedByUid,
    actorName: openedByName,
    description: `Cihazdan çıkan kit: ${stokAdi} (${stokKodu}) - ${testCount} test. ${openDescription}`,
    timestamp: serverTimestamp(),
  });

  // Emit notification
  await emitFaultOpened({
    actor: { uid: openedByUid, name: openedByName },
    faultReportId: reportRef.id,
    assignedDeviceId: deviceId,
    deviceName: model,
    faultType: 'aplikasyon',
    hospitalId: hospitalId,
    hospitalName: labName,
    description: `Cihazdan çıkan kit: ${stokAdi} (${stokKodu}) - ${testCount} test. ${openDescription}`,
    deviceImageUrl: input.deviceImageUrl,
  });

  return reportRef.id;
}

export async function resolveEjectedKitFault(
  reportId: string,
  resolution: 'imha' | 'tekrar_kullanim',
  actor: { uid: string; name: string },
  closeDescription?: string
): Promise<void> {
  const reportRef = doc(db, 'deviceFaultReports', reportId);
  const reportSnap = await getDocResilient(reportRef);

  if (!reportSnap.exists()) {
    throw new Error('Arıza raporu bulunamadı.');
  }

  const reportData = reportSnap.data();
  const deviceId = reportData?.deviceId;

  const batch = writeBatch(db);

  // 1. Update the fault report with resolution
  batch.update(reportRef, {
    status: 'closed' as DeviceFaultStatus,
    closedByUid: actor.uid,
    closedByName: actor.name,
    closedAt: serverTimestamp(),
    closeDescription: closeDescription || (resolution === 'imha' ? 'Kit imhaya gönderildi.' : 'Kit tekrar kullanılabildi.'),
    kitResolution: resolution,
  });

  // 2. Update device if deviceId exists - check for remaining open faults
  if (deviceId) {
    const otherOpenFaults = await getDocsResilient(
      query(
        collection(db, 'deviceFaultReports'),
        where('deviceId', '==', deviceId),
        where('status', 'in', ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'])
      )
    );
    const remainingOpenFaults = otherOpenFaults.docs.filter(d => d.id !== reportId);

    const deviceRef = doc(db, 'devices', deviceId);
    if (remainingOpenFaults.length > 0) {
      const remainingFault = remainingOpenFaults[0].data();
      batch.update(deviceRef, {
        arizaDurumu: remainingFault.faultType || 'aplikasyon',
        arizaAciklamasi: remainingFault.description || '',
      });
    } else {
      batch.update(deviceRef, {
        arizaDurumu: 'yok',
        arizaAciklamasi: '',
      });
    }
  }

  // 3. Add history event
  const historyRef = doc(collection(db, 'deviceFaultReports', reportId, 'history'));
  batch.set(historyRef, {
    type: 'closed' as DeviceFaultEventType,
    actorUid: actor.uid,
    actorName: actor.name,
    description: resolution === 'imha' ? 'Kit imhaya gönderildi.' : 'Kit tekrar kullanılabildi.',
    timestamp: serverTimestamp(),
  });

  // If resolution is 'imha', create record in destroyedKitsReports
  if (resolution === 'imha') {
    const destroyedKitRef = doc(collection(db, 'destroyedKitsReports'));
    batch.set(destroyedKitRef, {
      id: destroyedKitRef.id,
      ejectedKitRecordId: reportData.ejectedKitRecordId || null,
      faultReportId: reportId,
      laboratoryId: reportData.hospitalId,
      laboratoryName: reportData.labName,
      depotId: null,
      depotName: '',
      deviceId: reportData.deviceId,
      deviceModel: reportData.model,
      stokKodu: reportData.productStokKodu,
      stokAdi: reportData.productStokAdi,
      lotNumarasi: '',
      miad: '',
      seriNumarasi: '',
      testCount: reportData.testCount,
      aciklama: reportData.description,
      resolvedAt: serverTimestamp(),
      resolvedByUid: actor.uid,
      resolvedByName: actor.name,
      sourceType: 'fault',
    });
  }

  await batch.commit();
}
