'use client';
import {
  collection,
  query,
  where,
  getDocs,
  limit,
  orderBy,
  runTransaction,
  doc,
  serverTimestamp,
  addDoc,
  setDoc
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Rack } from '@/lib/types';
import { todayYmd } from './rack-utils';

/**
 * Finds the current day's rack count for a specific lab and fridge.
 * This is used to determine the next sequential number (e.g., R1, R2, R3).
 */
export async function getTodaysRackCount(labId: string, fridgeCode: string): Promise<number> {
    const today = todayYmd();
    const rackCollection = collection(db, 'archiveRacks');
    const q = query(
        rackCollection,
        where('labId', '==', labId),
        where('fridgeCode', '==', fridgeCode),
        where('date', '==', today)
    );
    const snapshot = await getDocs(q);
    return snapshot.size;
}

/**
 * Creates and saves a new rack record to Firestore.
 * It determines the next sequence number for the day and constructs the unique ID.
 */
export async function sealRack(rackData: Partial<Rack>): Promise<string> {
    if (!rackData.labId || !rackData.fridgeCode || !rackData.labCode) {
        throw new Error("Missing labId, fridgeCode, or labCode to seal the rack.");
    }
    
    const today = todayYmd();
    const nextCount = (await getTodaysRackCount(rackData.labId, rackData.fridgeCode)) + 1;
    
    const rackId = `${rackData.labCode}-${rackData.fridgeCode}-${today.replace(/\./g, '')}-R${nextCount}`;
    
    const finalRackData: Rack = {
        ...rackData,
        id: rackId,
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
