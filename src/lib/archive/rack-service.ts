'use client';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import { db } from '@/lib/firebase';
import { normalizeCompanyId } from '@/lib/company-scope';
import type { Rack } from '@/lib/types';
import { todayYmd } from './rack-utils';

/**
 * Finds the current day's rack count for a specific lab and fridge,
 * scoped to the caller's company.
 */
export async function getTodaysRackCount(
  labId: string,
  fridgeCode: string,
  companyId: string | null | undefined,
): Promise<number> {
  const today = todayYmd();
  const q = query(
    collection(db, 'archiveRacks'),
    where('companyId', '==', normalizeCompanyId(companyId)),
    where('labId', '==', labId),
    where('fridgeCode', '==', fridgeCode),
    where('date', '==', today),
  );
  const snapshot = await getDocsResilient(q);
  return snapshot.size;
}

/**
 * Creates and saves a new rack record to Firestore under the caller's tenant.
 */
export async function sealRack(
  rackData: Partial<Rack>,
  companyId: string | null | undefined,
): Promise<string> {
  if (!rackData.labId || !rackData.fridgeCode || !rackData.labCode) {
    throw new Error('Missing labId, fridgeCode, or labCode to seal the rack.');
  }

  const today = todayYmd();
  const nextCount = (await getTodaysRackCount(rackData.labId, rackData.fridgeCode, companyId)) + 1;

  const rackId = `${rackData.labCode}-${rackData.fridgeCode}-${today.replace(/\./g, '')}-R${nextCount}`;

  const finalRackData = {
    ...rackData,
    id: rackId,
    companyId: normalizeCompanyId(companyId),
    date: today,
    sequence: nextCount,
    sealedAt: serverTimestamp(),
    status: 'sealed',
    specimenCount: rackData.specimens?.length || 0,
  } as Rack;

  const rackDocRef = doc(db, 'archiveRacks', rackId);
  await setDoc(rackDocRef, finalRackData);
  return rackId;
}
