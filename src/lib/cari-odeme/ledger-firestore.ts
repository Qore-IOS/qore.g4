import { db } from "../firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import type { LedgerEntry } from "./finance-types";
import { getScopedDocs, scopedQuery } from "../firestore-helpers";

const LEDGER_COLLECTION = "cariLedgerEntries";
const FIRMALAR_COLLECTION = "cariFirmalar";

/**
 * Belirli bir firmanın cari hareketlerini (ekstre) getirir.
 */
export async function listLedgerEntries(
  scope: { companyId?: string; isSuperAdmin?: boolean },
  cariFirmaId: string,
  startDate?: Date,
  endDate?: Date
): Promise<LedgerEntry[]> {
  const constraints = [
    where("cariFirmaId", "==", cariFirmaId),
    orderBy("entryDate", "desc"),
  ];

  if (startDate) {
    constraints.push(where("entryDate", ">=", startDate));
  }
  if (endDate) {
    constraints.push(where("entryDate", "<=", endDate));
  }

  const docs = await getScopedDocs(LEDGER_COLLECTION, scope.companyId, scope.isSuperAdmin, ...constraints);
  return docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      ...data,
      id: docSnap.id,
      entryDate: data.entryDate?.toDate?.() || new Date(data.entryDate),
      createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
    } as LedgerEntry;
  });
}

/**
 * Firmanın güncel bakiyesini hesaplar.
 * Transaction içinde çağrılabilir (opsiyonel).
 */
export async function recalculateAccountBalance(
  cariFirmaId: string,
  transaction?: any // firebase transaction
): Promise<number> {
  const q = query(
    collection(db, LEDGER_COLLECTION),
    where("cariFirmaId", "==", cariFirmaId)
  );
  
  const snapshot = transaction ? await transaction.get(q) : await getDocsResilient(q);
  let balance = 0;

  snapshot.forEach((doc: any) => {
    const data = doc.data() as LedgerEntry;
    // Bakiye = Toplam Borç - Toplam Alacak (veya tam tersi, hesap tipine göre değişir)
    // Standart cari hesap: Bakiye = Borç - Alacak
    balance += (data.debitAmount || 0) - (data.creditAmount || 0);
  });

  return balance;
}
