import { db, storage } from '@/lib/firebase';
import { normalizeCompanyId, withCompanyScope } from '@/lib/company-scope';
import { getScopedDocs } from '@/lib/firestore-helpers';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import {
  deleteObject,
  getBytes,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage';

export type PendingCalculationKind = 'cihazUstu' | 'kumulatif';

export interface PendingCalculationFilePayload {
  name: string;
  type: string;
  size: number;
  /** Legacy Firestore-embedded payload; kept for existing pending records. */
  dataUrl?: string;
  /** Storage-backed payload used by new pending records. */
  storagePath?: string;
  /** Tokenized Firebase download URL avoids direct-byte CORS requirements. */
  downloadUrl?: string;
}

export interface PendingCalculationFileDoc {
  id: string;
  kind: PendingCalculationKind;
  hospitalId: string;
  hospitalName: string;
  period: string;
  month: number;
  year: number;
  source: 'lab-count' | string;
  stockCountSessionId?: string;
  status: 'pending' | 'consumed';
  files: PendingCalculationFilePayload[];
  createdAt?: any;
  expiresAt?: any;
  createdById?: string;
  createdByName?: string;
}

const COLLECTION = 'qoreCalculationPendingFiles';
const STORAGE_FOLDER = 'qore-calculation-pending-files';
const TTL_DAYS = 7;
export const MAX_PENDING_CALCULATION_FILE_BYTES = 20 * 1024 * 1024;

export function buildCalculationPeriod(month: number, year: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function periodToMonthYear(period?: string): { month: number; year: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period || '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (!Number.isFinite(year) || month < 0 || month > 11) return null;
  return { month, year };
}

export async function fileToPendingPayload(file: File): Promise<PendingCalculationFilePayload> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Dosya okunamadı'));
    reader.readAsDataURL(file);
  });
  return { name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl };
}

export async function pendingPayloadToFile(payload: PendingCalculationFilePayload): Promise<File> {
  if (payload.downloadUrl) {
    const response = await fetch(payload.downloadUrl);
    if (!response.ok) {
      throw new Error(`Bekleyen dosya indirilemedi: ${payload.name}`);
    }
    const blob = await response.blob();
    return new File([blob], payload.name, {
      type: payload.type || blob.type || 'application/octet-stream',
    });
  }

  if (payload.storagePath) {
    const bytes = await getBytes(storageRef(storage, payload.storagePath));
    return new File([bytes], payload.name, { type: payload.type || 'application/octet-stream' });
  }

  if (payload.dataUrl) {
    const response = await fetch(payload.dataUrl);
    if (!response.ok) {
      throw new Error(`Bekleyen dosya okunamadı: ${payload.name}`);
    }
    const blob = await response.blob();
    return new File([blob], payload.name, { type: payload.type || blob.type });
  }

  throw new Error(`Bekleyen dosyanın içeriği bulunamadı: ${payload.name}`);
}

function getStoragePaths(data: DocumentData | undefined): string[] {
  if (!Array.isArray(data?.files)) return [];
  return Array.from(new Set(
    data.files
      .map((file: unknown) => (
        typeof file === 'object' && file !== null && typeof (file as { storagePath?: unknown }).storagePath === 'string'
          ? (file as { storagePath: string }).storagePath.trim()
          : ''
      ))
      .filter(Boolean),
  ));
}

function isObjectNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'storage/object-not-found'
  );
}

async function deleteStoredObjects(storagePaths: string[], bestEffort = false): Promise<void> {
  if (storagePaths.length === 0) return;

  const results = await Promise.allSettled(
    storagePaths.map(async (path) => {
      try {
        await deleteObject(storageRef(storage, path));
      } catch (error) {
        if (!isObjectNotFoundError(error)) throw error;
      }
    }),
  );
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length === 0) return;

  if (bestEffort) {
    console.warn(`${failures.length} bekleyen hesaplama dosyası Storage'dan silinemedi.`);
    return;
  }
  throw failures[0].reason;
}

export async function savePendingCalculationFiles(opts: {
  kind: PendingCalculationKind;
  hospitalId: string;
  hospitalName: string;
  month: number;
  year: number;
  source?: string;
  stockCountSessionId?: string;
  files: File[];
  currentCompanyId?: string | null;
  user?: { id?: string; name?: string | null; email?: string | null } | null;
}): Promise<string> {
  if (!opts.files.length) throw new Error('Yüklenecek dosya bulunamadı.');
  const invalidFile = opts.files.find(
    (file) => !/\.(pdf|txt|csv)$/i.test(file.name),
  );
  if (invalidFile) {
    throw new Error(
      `${invalidFile.name} desteklenmiyor. Yalnızca PDF, TXT veya CSV yükleyin.`,
    );
  }
  const oversizedFile = opts.files.find(
    (file) => file.size > MAX_PENDING_CALCULATION_FILE_BYTES,
  );
  if (oversizedFile) {
    throw new Error(`${oversizedFile.name} 20 MB dosya sınırını aşıyor.`);
  }
  const pendingDocRef = doc(collection(db, COLLECTION));
  const companyId = normalizeCompanyId(opts.currentCompanyId);
  const uploadedPaths: string[] = [];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);

  try {
    const files: PendingCalculationFilePayload[] = [];
    for (const [index, file] of opts.files.entries()) {
      const type = file.type || 'application/octet-stream';
      const path = `${STORAGE_FOLDER}/${companyId}/${pendingDocRef.id}/${String(index).padStart(4, '0')}`;
      uploadedPaths.push(path);
      const uploadResult = await uploadBytes(storageRef(storage, path), file, {
        contentType: type,
        customMetadata: {
          companyId,
          pendingCalculationId: pendingDocRef.id,
          originalFileName: file.name,
        },
      });
      const downloadUrl = await getDownloadURL(uploadResult.ref);
      files.push({
        name: file.name,
        type,
        size: file.size,
        storagePath: path,
        downloadUrl,
      });
    }

    const payload = withCompanyScope({
      kind: opts.kind,
      hospitalId: opts.hospitalId,
      hospitalName: opts.hospitalName,
      period: buildCalculationPeriod(opts.month, opts.year),
      month: opts.month,
      year: opts.year,
      source: opts.source || 'lab-count',
      stockCountSessionId: opts.stockCountSessionId || null,
      status: 'pending',
      files,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresAt),
      createdById: opts.user?.id || '',
      createdByName: opts.user?.name || opts.user?.email || 'Bilinmeyen',
    }, opts.currentCompanyId);
    await setDoc(pendingDocRef, payload);
    return pendingDocRef.id;
  } catch (error) {
    await deleteStoredObjects(uploadedPaths, true);
    throw error;
  }
}

function mapPendingDoc(d: QueryDocumentSnapshot<DocumentData>): PendingCalculationFileDoc {
  return { id: d.id, ...(d.data() as any) };
}

export async function loadPendingCalculationFiles(opts: {
  kind: PendingCalculationKind;
  hospitalId: string;
  period: string;
  currentCompanyId?: string | null;
  isSuperAdmin?: boolean;
}): Promise<PendingCalculationFileDoc[]> {
  const docs = await getScopedDocs(
    COLLECTION,
    opts.currentCompanyId,
    opts.isSuperAdmin,
    where('kind', '==', opts.kind),
    where('hospitalId', '==', opts.hospitalId),
    where('period', '==', opts.period),
    where('status', '==', 'pending'),
    where('expiresAt', '>', Timestamp.now()),
  );
  return docs.map(mapPendingDoc);
}

export async function deletePendingCalculationFiles(ids: string[]): Promise<void> {
  await Promise.all(ids.map(async (id) => {
    const pendingDocRef = doc(db, COLLECTION, id);
    const snapshot = await getDoc(pendingDocRef);
    const storagePaths = snapshot.exists() ? getStoragePaths(snapshot.data()) : [];
    await deleteDoc(pendingDocRef);
    await deleteStoredObjects(storagePaths, true);
  }));
}

export async function markPendingCalculationFilesConsumed(ids: string[]): Promise<void> {
  await Promise.all(ids.map(async (id) => {
    const pendingDocRef = doc(db, COLLECTION, id);
    await updateDoc(pendingDocRef, { status: 'consumed', consumedAt: Timestamp.now() });
    try {
      const snapshot = await getDoc(pendingDocRef);
      await deleteStoredObjects(snapshot.exists() ? getStoragePaths(snapshot.data()) : [], true);
    } catch {
      // Consumption is already durable; Storage cleanup remains best-effort.
    }
  }));
}

export async function deleteExpiredPendingCalculationFiles(opts?: {
  currentCompanyId?: string | null;
  isSuperAdmin?: boolean;
}): Promise<number> {
  const docs = await getScopedDocs(
    COLLECTION,
    opts?.currentCompanyId,
    opts?.isSuperAdmin,
    where('status', '==', 'pending'),
    where('expiresAt', '<=', Timestamp.now()),
  );
  await Promise.all(docs.map(async (docSnap) => {
    const storagePaths = getStoragePaths(docSnap.data());
    await deleteDoc(doc(db, COLLECTION, docSnap.id));
    await deleteStoredObjects(storagePaths, true);
  }));
  return docs.length;
}
