import { db } from "../firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import type { Receipt } from "./invoice-types";
import type { LedgerEntry } from "./finance-types";
import type { CariFirma } from "./types";
import { getScopedDocs, scopedQuery } from "../firestore-helpers";
import { createAuditEvent } from "./firestore";

const RECEIPT_COLLECTION = "cariReceipts";
const FIRMALAR_COLLECTION = "cariFirmalar";
const LEDGER_COLLECTION = "cariLedgerEntries";

export async function listReceipts(
  scope: { companyId?: string; isSuperAdmin?: boolean },
  limitCount = 10000
): Promise<Receipt[]> {
  const docs = await getScopedDocs(RECEIPT_COLLECTION, scope.companyId, scope.isSuperAdmin, orderBy("receiptDate", "desc"));
  return docs.slice(0, limitCount).map((docSnap) => {
    const data = docSnap.data();
    return {
      ...data,
      id: docSnap.id,
      receiptDate: data.receiptDate?.toDate?.() || new Date(data.receiptDate),
      createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
    } as Receipt;
  });
}

export async function createReceipt(
  scope: { companyId?: string; isSuperAdmin?: boolean },
  data: Omit<Receipt, "id" | "createdAt">,
  userId: string,
  userName: string
): Promise<string> {
  if (!scope.companyId) throw new Error("companyId eksik.");

  const receiptRef = doc(collection(db, RECEIPT_COLLECTION));
  const receiptId = receiptRef.id;

  const ledgerRef = doc(collection(db, LEDGER_COLLECTION));
  const ledgerId = ledgerRef.id;

  const firmaRef = doc(db, FIRMALAR_COLLECTION, data.cariFirmaId);

  await runTransaction(db, async (transaction) => {
    const firmaSnap = await transaction.get(firmaRef);
    if (!firmaSnap.exists()) {
      throw new Error("Cari firma bulunamadı.");
    }
    const firma = firmaSnap.data() as CariFirma;
    const currentBalance = firma.currentBalance || 0;

    // Tahsilat (biz para alıyoruz): Cari alacaklanır (borcu azalır) -> credit
    // Eğer firma bize borçluysa (bakiye > 0), tahsilat yapınca bakiye düşer.
    const debit = 0;
    const credit = data.amount;

    const newBalance = currentBalance + debit - credit;

    // 1. Receipt kaydı
    const receiptPayload = {
      ...data,
      companyId: scope.companyId,
      createdAt: serverTimestamp(),
    };
    transaction.set(receiptRef, receiptPayload);

    // 2. Ledger (Hareket) kaydı
    const ledgerPayload: any = {
      cariFirmaId: data.cariFirmaId,
      cariFirmaName: data.cariFirmaName,
      entryDate: data.receiptDate,
      entryType: "tahsilat",
      description: `Tahsilat: ${data.receiptNo} (${data.type})`,
      debitAmount: debit,
      creditAmount: credit,
      balance: newBalance,
      sourceDocType: "receipt",
      sourceDocId: receiptId,
      sourceDocNo: data.receiptNo,
      currency: data.currency,
      companyId: scope.companyId,
      createdAt: serverTimestamp(),
    };
    transaction.set(ledgerRef, ledgerPayload);

    // 3. Firma bakiye güncellemesi
    transaction.update(firmaRef, {
      currentBalance: newBalance,
      updatedAt: serverTimestamp(),
    });
  });

  // Transaction dışı: Audit Log yazımı
  await createAuditEvent(scope, {
    action: "receipt_created",
    entityType: "receipt",
    entityId: receiptId,
    userId,
    userName,
    newValue: data,
  });

  return receiptId;
}
