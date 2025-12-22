


'use client';
import { db } from '@/lib/firebase';
import {
  addDoc, collection, doc, serverTimestamp, Timestamp, updateDoc, getDoc, writeBatch
} from 'firebase/firestore';
import { emitFaultOpened } from '@/lib/notifications';

export type DeviceFaultStatus = 'open' | 'closed';
export type DeviceFaultEventType = 'opened' | 'note' | 'status_change' | 'closed';

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
};

export async function openDeviceFaultReport(input: OpenFaultInput): Promise<string> {
  const {
    hospitalId, labName, deviceId, model, serial,
    faultType, openedByUid, openedByName, openDescription, title
  } = input;

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
    status: 'open' as DeviceFaultStatus,
    title: title ?? `${labName} • ${model} (${serial}) • ${faultType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}`,
    openedAt: serverTimestamp(),
  };

  const reportRef = await addDoc(collection(db, 'deviceFaultReports'), report);

  // first history event (no change here)
  await addDoc(collection(db, 'deviceFaultReports', reportRef.id, 'history'), {
    type: 'opened' as DeviceFaultEventType,
    actorUid: openedByUid,
    actorName: openedByName,
    description: openDescription ?? '',
    timestamp: serverTimestamp(),
  });

  // Emit notification after fault is successfully opened (no change here)
  await emitFaultOpened({
    actor: { uid: openedByUid, name: openedByName },
    assignedDeviceId: deviceId,
    deviceName: model,
    faultType: faultType,
    hospitalId: hospitalId,
    hospitalName: labName,
  });

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
  }
) {
  const { closedByUid, closedByName, closeDescription } = params;
  const reportRef = doc(db, 'deviceFaultReports', reportId);
  
  const reportSnap = await getDoc(reportRef);
  if (!reportSnap.exists()) {
    throw new Error('Arıza raporu bulunamadı.');
  }
  const reportData = reportSnap.data();
  const deviceId = reportData?.deviceId; // Safely get deviceId

  const batch = writeBatch(db);

  // 1. Update the fault report
  batch.update(reportRef, {
    status: 'closed' as DeviceFaultStatus,
    closedByUid,
    closedByName,
    closedAt: serverTimestamp(),
    closeDescription: closeDescription ?? '',
  });

  // 2. Update the main device document ONLY if a deviceId exists
  if (deviceId) {
    const deviceRef = doc(db, 'devices', deviceId);
    batch.update(deviceRef, {
      arizaDurumu: 'yok',
      arizaAciklamasi: '',
    });
  }

  // 3. Add the history event for closing
  const historyRef = doc(collection(db, 'deviceFaultReports', reportId, 'history'));
  batch.set(historyRef, {
    type: 'closed' as DeviceFaultEventType,
    actorUid: closedByUid,
    actorName: closedByName,
    description: closeDescription ?? 'Arıza giderildi.', // Provide a default if empty
    timestamp: serverTimestamp(),
  });

  // Commit all writes
  await batch.commit();
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
};

export async function openEjectedKitFaultReport(input: OpenEjectedKitFaultInput): Promise<string> {
  const {
    hospitalId, labName, deviceId, model, serial,
    openedByUid, openedByName, openDescription,
    stokKodu, stokAdi, cihazGrubu, testCount, quantityType
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

  const reportRef = await addDoc(collection(db, 'deviceFaultReports'), report);

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
    assignedDeviceId: deviceId,
    deviceName: model,
    faultType: 'aplikasyon',
    hospitalId: hospitalId,
    hospitalName: labName,
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
  const reportSnap = await getDoc(reportRef);

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

  // 2. Update device if deviceId exists
  if (deviceId) {
    const deviceRef = doc(db, 'devices', deviceId);
    batch.update(deviceRef, {
      arizaDurumu: 'yok',
      arizaAciklamasi: '',
    });
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
