import type { User } from '@/lib/types';
import type { PermissionContext } from './types';

const LEGACY_COMPANY_ID = '__legacy__';

const ADMIN_ROLES = new Set(['super_admin', 'admin', 'admin_developer']);

/**
 * Build a permission context from a User profile.
 * The engine uses this to bound every Firestore query.
 */
export function buildPermissionContext(user: Partial<User> & { uid: string }): PermissionContext {
  const role = (user.role ?? 'user') as PermissionContext['role'];
  const isSuperAdmin = role === 'super_admin' || role === 'admin_developer';
  const isAdmin = ADMIN_ROLES.has(role);

  const assignedLaboratories = unique(user.assignedLaboratories ?? []);
  const primaryLaboratories = unique(user.primaryLaboratories ?? []);
  const assignedDepots = unique(user.assignedDepots ?? []);
  const assignedBrands = unique(user.assignedBrands ?? []);
  const assignedLabGroups = unique(user.assignedLabGroups ?? []);

  const unrestrictedScope =
    isAdmin || (assignedLaboratories.length === 0 && role === 'satin_alma') || role === 'teknik_servis';

  return {
    uid: user.uid,
    email: user.email ?? null,
    name: user.name ?? null,
    role,
    companyId: user.companyId || LEGACY_COMPANY_ID,
    isSuperAdmin,
    isAdmin,
    assignedLaboratories,
    primaryLaboratories,
    assignedDepots,
    assignedBrands,
    assignedLabGroups,
    unrestrictedScope,
  };
}

/** Decide whether a hospital/lab id is visible for the given context. */
export function canSeeLab(ctx: PermissionContext, labId: string | undefined | null): boolean {
  if (!labId) return false;
  if (ctx.unrestrictedScope) return true;
  if (ctx.assignedLaboratories.length === 0) return true; // No restriction = company-wide
  return ctx.assignedLaboratories.includes(labId);
}

/** Decide whether a depot id is visible. */
export function canSeeDepot(ctx: PermissionContext, depotId: string | undefined | null): boolean {
  if (!depotId) return false;
  if (ctx.unrestrictedScope) return true;
  if (ctx.assignedDepots.length === 0) return true;
  return ctx.assignedDepots.includes(depotId);
}

/** Decide whether the user can view records for a brand. */
export function canSeeBrand(ctx: PermissionContext, brand: string | undefined | null): boolean {
  if (!brand) return true;
  if (ctx.unrestrictedScope) return true;
  if (ctx.assignedBrands.length === 0) return true;
  return ctx.assignedBrands.some((b) => normalise(b) === normalise(brand));
}

/** Human-readable summary of the user's data scope for the system prompt. */
export function describeScope(ctx: PermissionContext): string {
  if (ctx.isSuperAdmin) return 'Süper yönetici — tüm şirket verilerine erişim.';
  if (ctx.isAdmin) return 'Yönetici — şirket içi tüm laboratuvar ve depo verilerine erişim.';
  const parts: string[] = [`Rol: ${ctx.role}`];
  if (ctx.assignedLaboratories.length > 0) {
    parts.push(`Atanmış laboratuvar: ${ctx.assignedLaboratories.length} adet`);
  } else {
    parts.push('Lab kısıtı yok (şirket içi tüm laboratuvarlar)');
  }
  if (ctx.assignedDepots.length > 0) parts.push(`Atanmış depo: ${ctx.assignedDepots.length} adet`);
  if (ctx.assignedBrands.length > 0) parts.push(`Marka: ${ctx.assignedBrands.join(', ')}`);
  return parts.join(' • ');
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr.filter((v) => v !== undefined && v !== null && v !== ''))) as T[];
}

function normalise(s: string): string {
  return s.toLowerCase().trim();
}
