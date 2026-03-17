import type { Depot, User } from '@/lib/types';

const PRIVILEGED_ROLES = new Set(['super_admin', 'admin', 'admin_developer']);

export const canBypassDepotAssignment = (user?: User | null): boolean => {
  if (!user?.role) return false;
  return PRIVILEGED_ROLES.has(user.role);
};

/**
 * Operational panels (/direkt-transfer, /siparisler, /mal-kabul, /depo-sayim, /stok-yonetimi)
 * should only show standard depots as source depots.
 * Non-admin users are further restricted to depots assigned from /yonetim/kullanicilar.
 */
export const filterOperationalSourceDepots = (
  depots: Depot[],
  user?: User | null
): Depot[] => {
  const standardDepots = depots.filter((depot) => !depot.isPoolWarehouse);

  if (canBypassDepotAssignment(user)) {
    return standardDepots;
  }

  const assignedDepotIds = new Set((user?.assignedDepots || []).filter(Boolean));
  if (assignedDepotIds.size === 0) {
    return [];
  }

  return standardDepots.filter((depot) => !!depot.id && assignedDepotIds.has(depot.id));
};
