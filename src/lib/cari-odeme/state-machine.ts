/**
 * Payment State Machine — Qore Finance Module.
 *
 * Enforces valid payment status transitions and role-based access control.
 * This is the single source of truth for what transitions are allowed and
 * who can perform them.
 *
 * Usage:
 *   import { canTransition, getNextStates, resolveFinanceRoles } from './state-machine';
 *
 *   const roles = resolveFinanceRoles(userProfile, isSuperAdmin);
 *   if (canTransition('pending', 'approved', roles)) { ... }
 *   const options = getNextStates('pending', roles); // ['approved', 'rejected']
 */

import type { PaymentStatus } from "./types";
import type { FinanceRole, PaymentStatusTransition } from "./finance-types";
import { VALID_TRANSITIONS } from "./finance-types";

// ---------------------------------------------------------------------------
// Core transition logic
// ---------------------------------------------------------------------------

/**
 * Check whether a status transition is allowed for the given roles.
 *
 * @param from    Current payment status
 * @param to      Target payment status
 * @param roles   The caller's finance roles (resolved via `resolveFinanceRoles`)
 * @returns       `true` if the transition is permitted
 */
export function canTransition(
  from: PaymentStatus,
  to: PaymentStatus,
  roles: FinanceRole[]
): boolean {
  if (from === to) return false; // no-op transition
  return VALID_TRANSITIONS.some(
    (t) =>
      t.from === from &&
      t.to === to &&
      t.requiredRoles.some((r) => roles.includes(r))
  );
}

/**
 * Return the list of statuses the caller is allowed to transition *to* from
 * the given `currentStatus`.
 *
 * @param currentStatus  The payment's current status
 * @param roles          The caller's finance roles
 * @returns              Array of reachable `PaymentStatus` values (may be empty)
 */
export function getNextStates(
  currentStatus: PaymentStatus,
  roles: FinanceRole[]
): PaymentStatus[] {
  return VALID_TRANSITIONS
    .filter(
      (t) =>
        t.from === currentStatus &&
        t.requiredRoles.some((r) => roles.includes(r))
    )
    .map((t) => t.to);
}

/**
 * Get the specific transition definition (for UI display or audit logging).
 */
export function getTransition(
  from: PaymentStatus,
  to: PaymentStatus
): PaymentStatusTransition | undefined {
  return VALID_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

/**
 * Resolve finance-specific roles from the user's profile.
 *
 * Mapping from `accessibleViews` to `FinanceRole`:
 *   - `isSuperAdmin`        → ['finance_admin', 'approver', 'requester']
 *   - `cari-odeme-onay`     → ['approver']
 *   - `cari-odeme`          → ['requester']
 *   - (none of the above)   → ['viewer'] if authenticated
 *
 * A user can hold multiple roles simultaneously.
 */
export function resolveFinanceRoles(
  accessibleViews: string[] | undefined,
  isSuperAdmin: boolean
): FinanceRole[] {
  if (isSuperAdmin) {
    return ["finance_admin", "approver", "requester", "viewer"];
  }

  const roles: FinanceRole[] = [];
  const views = accessibleViews ?? [];

  if (views.includes("cari-odeme-onay")) {
    roles.push("approver");
  }
  if (views.includes("cari-odeme")) {
    roles.push("requester");
  }

  // Everyone with any cari-odeme access can at least view
  if (roles.length > 0) {
    roles.push("viewer");
  } else if (views.length > 0) {
    // Authenticated user with some views but not cari-odeme
    roles.push("viewer");
  }

  return roles;
}

// ---------------------------------------------------------------------------
// Status display helpers
// ---------------------------------------------------------------------------

/** Human-readable Turkish labels for payment statuses. */
export const STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Beklemede",
  approved: "Onaylandı",
  paid: "Ödendi",
  rejected: "Reddedildi",
};

/** CSS-friendly color tokens for payment statuses. */
export const STATUS_COLORS: Record<PaymentStatus, string> = {
  pending: "yellow",
  approved: "blue",
  paid: "green",
  rejected: "red",
};

/** Action labels for transition buttons (from→to). */
export const TRANSITION_LABELS: Record<string, string> = {
  "pending→approved": "Onayla",
  "pending→rejected": "Reddet",
  "approved→paid": "Ödendi Olarak İşaretle",
  "approved→rejected": "Reddet",
};

/**
 * Get the human-readable label for a transition button.
 */
export function getTransitionLabel(from: PaymentStatus, to: PaymentStatus): string {
  return TRANSITION_LABELS[`${from}→${to}`] ?? `${STATUS_LABELS[to]}`;
}
