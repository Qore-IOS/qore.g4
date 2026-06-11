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
import { getDocResilient } from '@/lib/firestore-network-recovery';
import type { Invoice } from "./invoice-types";
import type { LedgerEntry } from "./finance-types";
import type { CariFirma } from "./types";
import { getScopedDocs, scopedQuery } from "../firestore-helpers";
import { withCompanyScope } from "../company-scope";
import { createAuditEvent, type Scope } from "./firestore";

const INVOICE_COLLECTION = "cariInvoices";
const FIRMALAR_COLLECTION = "cariFirmalar";
const LEDGER_COLLECTION = "cariLedgerEntries";

/**
 * Faz 1: Fatura işlemleri (Alış, Satış, İade vb.)
 */

export async function listInvoices(
  scope: Scope,
  limitCount = 10000
): Promise<Invoice[]> {
  const docs = await getScopedDocs(INVOICE_COLLECTION, scope.companyId, scope.isSuperAdmin, orderBy("issueDate", "desc"));
  return docs.slice(0, limitCount).map((docSnap) => {
    const data = docSnap.data();
    return {
      ...data,
      id: docSnap.id,
      issueDate: data.issueDate?.toDate?.() || new Date(data.issueDate),
      dueDate: data.dueDate?.toDate?.() || new Date(data.dueDate),
      createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
      updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
    } as Invoice;
  });
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const docRef = doc(db, INVOICE_COLLECTION, id);
  const snap = await getDocResilient(docRef);
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    ...data,
    id: snap.id,
    issueDate: data.issueDate?.toDate?.() || new Date(data.issueDate),
    dueDate: data.dueDate?.toDate?.() || new Date(data.dueDate),
    createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
    updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
  } as Invoice;
}

export async function createInvoice(
  scope: Scope,
  data: Omit<Invoice, "id" | "createdAt" | "updatedAt">,
  userId: string,
  userName: string
): Promise<string> {
  if (!scope.companyId) throw new Error("companyId eksik.");

  const invoiceRef = doc(collection(db, INVOICE_COLLECTION));
  const invoiceId = invoiceRef.id;

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

    // Fatura tipi borç mu alacak mı belirle
    let debit = 0;
    let credit = 0;
    
    // Satış: Cari borçlanır (biz alacaklıyız) -> debit
    // Alış: Cari alacaklanır (biz borçluyuz) -> credit
    if (data.type === "satis" || data.type === "alis_iade") {
      debit = data.grandTotal;
    } else {
      credit = data.grandTotal;
    }

    const newBalance = currentBalance + debit - credit;

    // 1. Fatura kaydı
    const invoicePayload = {
      ...data,
      companyId: scope.companyId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    transaction.set(invoiceRef, invoicePayload);

    // 2. Ledger (Hareket) kaydı
    const ledgerPayload: any = {
      cariFirmaId: data.cariFirmaId,
      cariFirmaName: data.cariFirmaName,
      entryDate: data.issueDate,
      entryType: debit > 0 ? "fatura_borc" : "fatura_alacak",
      description: `Fatura: ${data.invoiceNo} ${data.type}`,
      debitAmount: debit,
      creditAmount: credit,
      balance: newBalance,
      sourceDocType: "invoice",
      sourceDocId: invoiceId,
      sourceDocNo: data.invoiceNo,
      currency: data.currency,
      fxRate: data.fxRate,
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
    action: "invoice_created",
    entityType: "invoice",
    entityId: invoiceId,
    userId,
    userName,
    newValue: data,
  });

  return invoiceId;
}
