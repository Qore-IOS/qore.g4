/**
 * Qore Finance Module — Core finance types.
 *
 * Contains:
 *   - AuditEvent: Immutable audit log entries for every financial action
 *   - FinanceRole: Role-based access control for finance operations
 *   - PaymentStatusTransition: State-machine transition rules
 *   - LedgerEntry types (Faz 1 placeholder — defined here for forward reference)
 */

import type { PaymentStatus } from "./types";

// ---------------------------------------------------------------------------
// Finance Roles
// ---------------------------------------------------------------------------

/**
 * Finance-specific roles. These are checked at runtime against the user's
 * `accessibleViews` array in their profile:
 *   - `finance_admin` → full finance access, can mark as paid
 *   - `approver`      → can approve/reject payments
 *   - `requester`     → can create payment requests
 *   - `viewer`        → read-only access to finance data
 */
export type FinanceRole = "finance_admin" | "approver" | "requester" | "viewer";

// ---------------------------------------------------------------------------
// Audit Events
// ---------------------------------------------------------------------------

export type AuditEventAction =
  | "payment_created"
  | "payment_status_changed"
  | "payment_updated"
  | "payment_deleted"
  | "payment_bank_assigned"
  | "firma_created"
  | "firma_updated"
  | "firma_deleted"
  | "firma_budget_changed"
  | "invoice_created"
  | "invoice_updated"
  | "invoice_cancelled"
  | "receipt_created"
  | "ledger_entry_created"
  | "bank_transaction_created"
  | "budget_revised";

export type AuditEntityType =
  | "payment"
  | "cariFirma"
  | "invoice"
  | "receipt"
  | "ledgerEntry"
  | "bankTransaction"
  | "budget"
  | "department"
  | "bankAccount";

/**
 * Immutable audit log entry. Once created, these documents must never be
 * updated or deleted — Firestore rules enforce `allow update, delete: if false`.
 */
export interface AuditEvent {
  id: string;
  /** The action that was performed */
  action: AuditEventAction;
  /** The type of entity affected */
  entityType: AuditEntityType;
  /** The Firestore document ID of the affected entity */
  entityId: string;
  /** UID of the user who performed the action */
  userId: string;
  /** Display name of the user */
  userName: string;
  /** When the action occurred */
  timestamp: Date;
  /** Snapshot of relevant fields before the change (for updates) */
  previousValue?: Record<string, any>;
  /** Snapshot of relevant fields after the change */
  newValue?: Record<string, any>;
  /** Optional free-text reason (e.g. rejection reason) */
  reason?: string;
  /** Tenant isolation tag */
  companyId?: string;
}

// ---------------------------------------------------------------------------
// Payment State Machine
// ---------------------------------------------------------------------------

/**
 * Defines a valid status transition for payments.
 *   - `from` → current status
 *   - `to`   → target status
 *   - `requiredRoles` → at least one of these roles is needed
 */
export interface PaymentStatusTransition {
  from: PaymentStatus;
  to: PaymentStatus;
  requiredRoles: FinanceRole[];
}

/**
 * All valid payment status transitions. Any transition not listed here is
 * forbidden.
 *
 * Flow:
 *   pending ──→ approved  (approver, finance_admin)
 *   pending ──→ rejected  (approver, finance_admin)
 *   approved ──→ paid     (finance_admin)
 *   approved ──→ rejected (approver, finance_admin)
 *
 * Terminal states: paid, rejected (no outgoing transitions)
 */
export const VALID_TRANSITIONS: PaymentStatusTransition[] = [
  { from: "pending", to: "approved", requiredRoles: ["approver", "finance_admin"] },
  { from: "pending", to: "rejected", requiredRoles: ["approver", "finance_admin"] },
  { from: "approved", to: "paid", requiredRoles: ["finance_admin"] },
  { from: "approved", to: "rejected", requiredRoles: ["approver", "finance_admin"] },
];

// ---------------------------------------------------------------------------
// Ledger Entry (Faz 1 forward declaration — kept minimal for type references)
// ---------------------------------------------------------------------------

export type LedgerEntryType =
  | "fatura_borc"
  | "fatura_alacak"
  | "odeme"
  | "tahsilat"
  | "mahsup"
  | "virman"
  | "acilis_bakiye";

export interface LedgerEntry {
  id: string;
  cariFirmaId: string;
  cariFirmaName: string;
  entryDate: Date;
  entryType: LedgerEntryType;
  description: string;
  /** Borç tutarı */
  debitAmount: number;
  /** Alacak tutarı */
  creditAmount: number;
  /** Running balance (denormalized for fast reads) */
  balance: number;
  sourceDocType?: "invoice" | "payment" | "receipt";
  sourceDocId?: string;
  sourceDocNo?: string;
  currency: string;
  fxRate?: number;
  createdAt: Date;
  companyId?: string;
}
