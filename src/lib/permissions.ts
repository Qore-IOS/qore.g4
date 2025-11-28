
// lib/permissions.ts
import type { AppView } from './types'; // Import the canonical type

export function hasOnlyProductUsagePermission(perms?: AppView[] | null): boolean {
  if (!perms || perms.length === 0) return false;
  const set = new Set(perms);
  // Check if it has 'urun-kullanim' and its size is exactly 1.
  return set.has('urun-kullanim') && set.size === 1;
}

export function canViewDashboard(perms?: AppView[] | null): boolean {
  return !!perms?.includes('dashboard');
}
