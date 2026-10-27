import { db } from "../data/client";
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  orderBy,
} from "../data/client";
import type { BankTransaction } from "./bank-types";
import type { BankAccount } from "./types";
import { getScopedDocs, scopedQuery } from "../document-helpers";
import { createAuditEvent, type Scope } from "./firestore";

const BANK_TX_COLLECTION = "cariBankTransactions";
const BANK_ACCOUNTS_COLLECTION = "cariBankAccounts";

export async function listBankTransactions(
  scope: Scope,
  bankAccountId?: string
): Promise<BankTransaction[]> {
  const constraints = [orderBy("transactionDate", "desc")];
  if (bankAccountId) {
    // Requires composite index: companyId, bankAccountId, transactionDate DESC
    // For now, if no composite index, we can just fetch all and filter in client if needed
    // But let's assume we will create the index
  }
  
  const docs = await getScopedDocs(BANK_TX_COLLECTION, scope.companyId, scope.isSuperAdmin, ...constraints);
  
  let results = docs.map(docSnap => {
    const data = docSnap.data();
    return {
      ...data,
      id: docSnap.id,
      transactionDate: data.transactionDate?.toDate?.() || new Date(data.transactionDate),
      valueDate: data.valueDate?.toDate?.() || new Date(data.valueDate),
      createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
    } as BankTransaction;
  });

  if (bankAccountId) {
    results = results.filter(tx => tx.bankAccountId === bankAccountId);
  }

  return results;
}

export async function createBankTransaction(
  scope: Scope,
  data: Omit<BankTransaction, "id" | "createdAt" | "balance">,
  userId: string,
  userName: string
): Promise<string> {
  if (!scope.companyId) throw new Error("companyId eksik.");

  const txRef = doc(collection(db, BANK_TX_COLLECTION));
  const txId = txRef.id;

  const accountRef = doc(db, BANK_ACCOUNTS_COLLECTION, data.bankAccountId);

  await runTransaction(db, async (transaction) => {
    const accountSnap = await transaction.get(accountRef);
    if (!accountSnap.exists()) {
      throw new Error("Banka hesabı bulunamadı.");
    }
    
    const account = accountSnap.data() as BankAccount;
    const currentBalance = account.currentBalance || 0;
    
    let amountChange = data.amount;
    if (data.type === "cikis") {
      amountChange = -data.amount;
    }

    const newBalance = currentBalance + amountChange;

    const payload = {
      ...data,
      balance: newBalance,
      companyId: scope.companyId,
      createdAt: serverTimestamp(),
    };

    transaction.set(txRef, payload);

    transaction.update(accountRef, {
      currentBalance: newBalance,
    });
  });

  await createAuditEvent(scope, {
    action: "bank_transaction_created",
    entityType: "bankTransaction",
    entityId: txId,
    userId,
    userName,
    newValue: data,
  });

  return txId;
}
