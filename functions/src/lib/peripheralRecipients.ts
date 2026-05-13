import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';

const db = admin.firestore();

export type RawOrderItem = {
  stokKodu?: string;
  stokAdi?: string;
  adet?: number;
  anaBirim?: string;
  laboratuvarGrubu?: string;
  [k: string]: any;
};

export type LojistikUser = {
  uid: string;
  name: string | null;
  email: string | null;
  phoneNumber: string | null;
  assignedLabGroups: string[];
};

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * Build a map: stokKodu -> laboratuvarGrubu (group name) by reading productCodes.
 * Items that already carry a laboratuvarGrubu are used as-is.
 */
export async function buildItemGroupMap(items: RawOrderItem[]): Promise<Map<string, string>> {
  const groupMap = new Map<string, string>();
  const codesToFetch = new Set<string>();
  for (const it of items) {
    const code = (it.stokKodu || '').trim();
    if (!code) continue;
    if (it.laboratuvarGrubu) {
      groupMap.set(code, String(it.laboratuvarGrubu).trim());
    } else {
      codesToFetch.add(code);
    }
  }
  if (codesToFetch.size === 0) return groupMap;

  try {
    const batches = chunk(Array.from(codesToFetch), 10);
    for (const batch of batches) {
      const snap = await db
        .collection('productCodes')
        .where('stokKodu', 'in', batch)
        .get();
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        const code = (data?.stokKodu || '').trim();
        const group = (data?.laboratuvarGrubu || '').trim();
        if (code && group) groupMap.set(code, group);
      });
    }
  } catch (e) {
    logger.warn('[peripheralRecipients] productCodes lookup failed:', e);
  }
  return groupMap;
}

/** Load def_labGroups → Map<docId, name>. */
export async function loadLabGroupNamesByDocId(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const snap = await db.collection('def_labGroups').get();
    snap.docs.forEach((d) => {
      const name = (d.data() as any)?.name;
      if (name) map.set(d.id, String(name).trim());
    });
  } catch (e) {
    logger.warn('[peripheralRecipients] def_labGroups load failed:', e);
  }
  return map;
}

/** Fetch all users with role=lojistik_sorumlusu, normalized. */
export async function loadLojistikUsers(): Promise<LojistikUser[]> {
  const out: LojistikUser[] = [];
  try {
    const snap = await db
      .collection('users')
      .where('role', '==', 'lojistik_sorumlusu')
      .get();
    snap.docs.forEach((d) => {
      const data = d.data() as any;
      const groups: string[] = Array.isArray(data?.assignedLabGroups) ? data.assignedLabGroups.filter(Boolean) : [];
      out.push({
        uid: d.id,
        name: (data?.name || '').trim() || null,
        email: (data?.email || '').trim() || null,
        phoneNumber: (data?.phoneNumber || '').trim() || null,
        assignedLabGroups: groups,
      });
    });
  } catch (e) {
    logger.warn('[peripheralRecipients] users load failed:', e);
  }
  return out;
}

/** Return items whose resolved laboratuvarGrubu is in the user's assigned group name set. */
export function filterItemsForUserGroups(
  items: RawOrderItem[],
  itemGroupMap: Map<string, string>,
  userGroupNames: Set<string>,
): RawOrderItem[] {
  if (userGroupNames.size === 0) return [];
  return items.filter((it) => {
    const code = (it.stokKodu || '').trim();
    if (!code) return false;
    const group = itemGroupMap.get(code);
    if (!group) return false;
    return userGroupNames.has(group);
  });
}

/** Resolve a lojistik user's assigned group IDs to group names via def_labGroups. */
export function resolveUserGroupNames(
  user: LojistikUser,
  labGroupNamesById: Map<string, string>,
): Set<string> {
  const out = new Set<string>();
  for (const id of user.assignedLabGroups) {
    const name = labGroupNamesById.get(id);
    if (name) out.add(name);
  }
  return out;
}
