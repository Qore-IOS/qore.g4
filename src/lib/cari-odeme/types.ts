/**
 * Cari Ödeme / Qore Finance Module — data models.
 *
 * Ported from the standalone `cariodeme` app and adapted to INV-zen's
 * multi-tenancy model:
 *   - Every document carries an optional `companyId` *tenant* tag (injected by
 *     `withCompanyScope`). Do NOT confuse it with the vendor reference below.
 *   - The vendor/cari firm foreign key was renamed from the source's
 *     `companyId` to `cariFirmaId` to avoid clashing with the tenant tag.
 *   - The vendor collection is `cariFirmalar` (NOT `companies`, which is the
 *     tenant collection in this project).
 *
 * Faz 0 extensions:
 *   - Payment: multi-currency fields, approval/rejection audit trail
 *   - CariFirma: party type, balance fields (Faz 1 ready)
 *   - BankAccount: balance, currency
 *   - All new fields are optional for backward compatibility.
 */

export type PaymentStatus = "pending" | "approved" | "paid" | "rejected";

/** Supported currencies for financial transactions. */
export type FinanceCurrency = "TRY" | "EUR" | "USD" | "GBP";

/** Cari firma party type — tedarikçi, müşteri, hastane veya diğer. */
export type AccountPartyType = "tedarikci" | "musteri" | "hastane" | "diger";

/** A vendor / cari firm we make payments to. Stored in `cariFirmalar`. */
export type CariFirma = {
  id: string;
  code: string;
  name: string;
  taxId?: string;
  taxOffice?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  dueDay?: number;
  address?: string;
  budget?: number;
  createdAt: Date;
  updatedAt: Date;
  companyId?: string; // tenant tag (multi-tenancy)
  // --- Faz 0+ extensions ---
  /** Party type: tedarikci, musteri, hastane, diger. Defaults to 'tedarikci' for legacy records. */
  partyType?: AccountPartyType;
  /** Credit/risk limit for this party (TRY) */
  riskLimit?: number;
  /** Default transaction currency */
  defaultCurrency?: FinanceCurrency;
  /** Opening balance for ledger initialization (Faz 1) */
  openingBalance?: number;
  /** Opening balance date (Faz 1) */
  openingBalanceDate?: Date;
  /** Current running balance — denormalized, updated by ledger entries (Faz 1) */
  currentBalance?: number;
};

/** Bank account / IBAN belonging to a cari firm. Subcollection of `cariFirmalar`. */
export type Iban = {
  id: string;
  cariFirmaId: string; // parent vendor id (renamed from source `companyId`)
  bankName: string;
  iban: string;
  accountNumber?: string;
  branch?: string;
  isDefault?: boolean;
  createdAt: Date;
  companyId?: string; // tenant tag
};

export type Payment = {
  id: string;
  requesterId?: string;
  requesterName: string;
  department?: string;
  cariFirmaId?: string; // FK -> cariFirmalar (renamed from source `companyId`)
  companyName: string; // denormalized vendor name for display
  description?: string;
  amount: number;
  currency: FinanceCurrency;
  dueDate: Date;
  invoiceNo?: string;
  bankName?: string | null;
  status: PaymentStatus;
  createdAt: Date;
  updatedAt: Date;
  companyId?: string; // tenant tag (multi-tenancy)
  // --- Faz 0: Approval / rejection audit trail ---
  /** UID of the user who approved the payment */
  approvedBy?: string;
  /** Display name of the approver */
  approvedByName?: string;
  /** When the payment was approved */
  approvedAt?: Date;
  /** UID of the user who marked the payment as paid */
  paidBy?: string;
  /** Display name of the payer */
  paidByName?: string;
  /** When the payment was marked as paid */
  paidAt?: Date;
  /** UID of the user who rejected the payment */
  rejectedBy?: string;
  /** Display name of the rejector */
  rejectedByName?: string;
  /** When the payment was rejected */
  rejectedAt?: Date;
  /** Reason for rejection */
  rejectionReason?: string;
  // --- Faz 0: Multi-currency support ---
  /** The currency in which the transaction is denominated (defaults to `currency`) */
  transactionCurrency?: FinanceCurrency;
  /** The base/reporting currency (always TRY) */
  baseCurrency?: "TRY";
  /** Exchange rate at time of transaction (transactionCurrency → baseCurrency) */
  fxRate?: number;
  /** Date the exchange rate was set */
  fxRateDate?: Date;
  /** Amount in base currency (amount × fxRate) */
  baseCurrencyAmount?: number;
  // --- Faz 1: Invoice linkage ---
  /** FK -> cariInvoices (linked invoice for payment allocation) */
  invoiceId?: string;
};

export type PaymentTemplate = {
  id: string;
  templateName: string;
  cariFirmaId: string; // FK -> cariFirmalar (renamed from source `companyId`)
  companyName: string;
  description?: string;
  amount: number;
  currency: FinanceCurrency;
  invoiceNo?: string;
  department?: string;
  creatorId: string;
  createdAt: Date;
  reminderPeriod?: "monthly" | "weekly" | "none";
  reminderDayOfMonth?: number; // 1-31
  reminderDayOfWeek?: number; // 0-6 (Sun-Sat)
  companyId?: string; // tenant tag
};

/** Company-wide bank account used to settle payments. Stored in `cariBankAccounts`. */
export type BankAccount = {
  id: string;
  bankName: string;
  iban: string;
  accountNumber?: string;
  branch?: string;
  createdAt: Date;
  companyId?: string; // tenant tag
  // --- Faz 0+ extensions ---
  /** Account currency */
  currency?: FinanceCurrency;
  /** Current account balance (denormalized, updated by bank transactions) */
  currentBalance?: number;
  /** Date of last reconciliation */
  lastReconciliationDate?: Date;
};

export type Department = {
  id: string;
  name: string;
  budget: number;
  createdAt: Date;
  companyId?: string; // tenant tag
};

export type BudgetHistory = {
  id: string;
  changedAt: Date;
  oldBudget: number;
  newBudget: number;
  changedBy: string; // user uid
  companyId?: string; // tenant tag
};
