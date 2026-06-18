import { db } from '@/lib/firebase';
import { withCompanyScope } from '@/lib/company-scope';
import { getScopedDocs } from '@/lib/firestore-helpers';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  Timestamp,
  updateDoc,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';

export type PendingCalculationKind = 'cihazUstu' | 'kumulatif';

export interface PendingCalculationFilePayload {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
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
const TTL_DAYS = 7;

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
  const response = await fetch(payload.dataUrl);
  const blob = await response.blob();
  return new File([blob], payload.name, { type: payload.type || blob.type });
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
  const files = await Promise.all(opts.files.map(fileToPendingPayload));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);
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
  const ref = await addDoc(collection(db, COLLECTION), payload);
  return ref.id;
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
  const now = Date.now();
  const docs = await getScopedDocs(COLLECTION, opts.currentCompanyId, opts.isSuperAdmin);
  return docs
    .map(mapPendingDoc)
    .filter((pending) => {
      const expiresAt = pending.expiresAt?.toDate ? pending.expiresAt.toDate().getTime() : null;
      return (
        pending.kind === opts.kind &&
        pending.hospitalId === opts.hospitalId &&
        pending.period === opts.period &&
        pending.status === 'pending' &&
        (!expiresAt || expiresAt > now)
      );
    });
}

export async function deletePendingCalculationFiles(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => deleteDoc(doc(db, COLLECTION, id))));
}

export async function markPendingCalculationFilesConsumed(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => updateDoc(doc(db, COLLECTION, id), { status: 'consumed', consumedAt: Timestamp.now() })));
}

export async function deleteExpiredPendingCalculationFiles(opts?: {
  currentCompanyId?: string | null;
  isSuperAdmin?: boolean;
}): Promise<number> {
  const now = Date.now();
  const docs = await getScopedDocs(COLLECTION, opts?.currentCompanyId, opts?.isSuperAdmin);
  const expired = docs
    .map(mapPendingDoc)
    .filter((pending) => {
      const expiresAt = pending.expiresAt?.toDate ? pending.expiresAt.toDate().getTime() : null;
      return pending.status === 'pending' && !!expiresAt && expiresAt <= now;
    });
  await Promise.all(expired.map((pending) => deleteDoc(doc(db, COLLECTION, pending.id))));
  return expired.length;
}
