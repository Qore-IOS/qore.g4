import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';

const db = admin.firestore();

export type RawOrderItem = {
  stokKodu?: string;
  stokAdi?: string;
  adet?: number;
  anaBirim?: string;
  ambalajDegeri?: number;
  laboratuvarGrubu?: string;
  [k: string]: any;
};

export type ProductInfo = {
  group: string;
  anaBirim?: string;
  ambalajDegeri?: number;
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
 * Build a map: stokKodu -> { group, anaBirim, ambalajDegeri } by reading productCodes.
 * Item-level fields (laboratuvarGrubu/anaBirim/ambalajDegeri), when present on the
 * order item, win over the productCodes lookup so callers can override per-order.
 */
export async function buildItemInfoMap(items: RawOrderItem[]): Promise<Map<string, ProductInfo>> {
  const infoMap = new Map<string, ProductInfo>();
  const codesToFetch = new Set<string>();
  for (const it of items) {
    const code = (it.stokKodu || '').trim();
    if (!code) continue;
    const seed: ProductInfo = {
      group: it.laboratuvarGrubu ? String(it.laboratuvarGrubu).trim() : '',
      anaBirim: it.anaBirim ? String(it.anaBirim).trim() : undefined,
      ambalajDegeri: typeof it.ambalajDegeri === 'number' ? it.ambalajDegeri : undefined,
    };
    infoMap.set(code, seed);
    if (!seed.group || seed.anaBirim === undefined || seed.ambalajDegeri === undefined) {
      codesToFetch.add(code);
    }
  }
  if (codesToFetch.size === 0) return infoMap;

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
        if (!code) return;
        const existing = infoMap.get(code) || { group: '' };
        if (!existing.group && data?.laboratuvarGrubu) {
          existing.group = String(data.laboratuvarGrubu).trim();
        }
        if (existing.anaBirim === undefined && data?.anaBirim) {
          existing.anaBirim = String(data.anaBirim).trim();
        }
        if (existing.ambalajDegeri === undefined && data?.ambalajDegeri !== undefined && data?.ambalajDegeri !== null) {
          const n = Number(data.ambalajDegeri);
          if (Number.isFinite(n) && n > 0) existing.ambalajDegeri = n;
        }
        infoMap.set(code, existing);
      });
    }
  } catch (e) {
    logger.warn('[peripheralRecipients] productCodes lookup failed:', e);
  }
  return infoMap;
}

export function groupMapFromInfo(info: Map<string, ProductInfo>): Map<string, string> {
  const out = new Map<string, string>();
  info.forEach((v, k) => { if (v.group) out.set(k, v.group); });
  return out;
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
