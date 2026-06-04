/**
 * Qore Finance Module — Bank and Reconciliation types (Faz 2)
 */

import type { FinanceCurrency } from "./types";

export type BankTransactionType = "giris" | "cikis";
export type ReconciliationStatus = "eslesmemis" | "eslesmis" | "manuel_eslesmis";

export interface BankTransaction {
  id: string;
  bankAccountId: string;
  bankName: string;
  /** İşlemin banka kayıtlarındaki asıl tarihi */
  transactionDate: Date;
  /** Valör tarihi */
  valueDate?: Date;
  type: BankTransactionType;
  amount: number;
  currency: FinanceCurrency;
  description: string;
  reference?: string;
  reconciliationStatus: ReconciliationStatus;
  
  /** Eğer mutabakat yapıldıysa, hangi belgeyle eşleştiği */
  matchedDocType?: "payment" | "receipt" | "invoice";
  matchedDocId?: string;
  
  /** İşlem sonrasındaki hesap bakiyesi (banka ekstresinden gelir) */
  balance: number;
  
  createdAt: Date;
  companyId?: string;
}
