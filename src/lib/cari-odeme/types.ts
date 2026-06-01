/**
 * Cari Ödeme (vendor payments) data models.
 *
 * Ported from the standalone `cariodeme` app and adapted to INV-zen's
 * multi-tenancy model:
 *   - Every document carries an optional `companyId` *tenant* tag (injected by
 *     `withCompanyScope`). Do NOT confuse it with the vendor reference below.
 *   - The vendor/cari firm foreign key was renamed from the source's
 *     `companyId` to `cariFirmaId` to avoid clashing with the tenant tag.
 *   - The vendor collection is `cariFirmalar` (NOT `companies`, which is the
 *     tenant collection in this project).
 */

export type PaymentStatus = "pending" | "approved" | "paid" | "rejected";

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
  currency: "TRY";
  dueDate: Date;
  invoiceNo?: string;
  bankName?: string | null;
  status: PaymentStatus;
  createdAt: Date;
  updatedAt: Date;
  companyId?: string; // tenant tag (multi-tenancy)
};

export type PaymentTemplate = {
  id: string;
  templateName: string;
  cariFirmaId: string; // FK -> cariFirmalar (renamed from source `companyId`)
  companyName: string;
  description?: string;
  amount: number;
  currency: "TRY";
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
