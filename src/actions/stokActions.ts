
'use server';

import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '@/lib/firebase';
import type { DepoStokItem } from '@/lib/types';
import {
  collection,
  query,
  where,
  getDocs,
  getCountFromServer,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
  doc,
  updateDoc,
  setDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { safeCompareByMiad, toDateSafe } from "@/lib/date";
import { differenceInDays, parse, isValid, compareAsc } from 'date-fns';
import { filterByCompanyScope, matchesCompanyScope, normalizeCompanyId } from '@/lib/company-scope';
import fs from 'fs/promises';
import path from 'path';

// ─── Admin SDK scoping helper ────────────────────────────────────────────────
// Mirrors getScopedDocs queries 1+2 (company + legacy) but skips the unscoped
// fallback which reads entire collections through IndexedDB on the client.
type AdminDocSnap = FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

/**
 * Deep-convert Admin SDK Firestore values (Timestamp, GeoPoint, DocumentRef)
 * into plain JSON-serializable values so they can cross the Next.js server
 * action boundary. Admin `Timestamp` is a class instance — returning it raw
 * throws "Only plain objects … can be passed to Client Components".
 */
function serializeFirestoreValue(value: any): any {
  if (value === null || value === undefined) return value;
  // Firestore Timestamp (admin or web): has toDate()
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (typeof value === 'object') {
    // Skip non-plain objects we don't expect (e.g. DocumentReference) by
    // converting them to a path string when possible, otherwise dropping.
    if (typeof value.path === 'string' && typeof value.id === 'string' && typeof value.collection === 'function') {
      return value.path; // DocumentReference → path string
    }
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      out[key] = serializeFirestoreValue(value[key]);
    }
    return out;
  }
  return value;
}

/** Map an Admin doc snapshot to a plain serializable object. */
function serializeDoc(d: AdminDocSnap): Record<string, any> {
  return serializeFirestoreValue({ id: d.id, ...d.data() });
}

async function adminScopedDocs(
  collectionPath: string,
  companyId: string | null | undefined,
  isSuperAdmin: boolean | undefined,
): Promise<AdminDocSnap[]> {
  const normalized = normalizeCompanyId(companyId);
  const coll = adminDb.collection(collectionPath);
  if (isSuperAdmin || normalized === '__legacy__') {
    return (await coll.get()).docs as AdminDocSnap[];
  }
  // A `where('companyId', '==', x)` query CANNOT match documents that lack a
  // companyId field. Pre‑multi‑tenancy master data (barkod formatları, ürün
  // kodları) is untagged, and dropping it silently breaks barcode parsing for
  // every panel. So we read the full collection and keep anything visible to
  // this company via matchesCompanyScope — untagged/legacy records included.
  // This mirrors the web‑SDK getScopedDocs backward‑compat path. Safe here
  // because these are small master‑data collections and the Admin SDK read
  // bypasses security rules.
  const all = await coll.get();
  return (all.docs as AdminDocSnap[]).filter(d =>
    matchesCompanyScope(d.data(), companyId, isSuperAdmin),
  );
}


// Helper: convert Firestore Timestamps → JS Dates
function processDoc(doc: QueryDocumentSnapshot<DocumentData>): DepoStokItem {
  const data = doc.data();
  // Firestore'dan gelen Timestamp'ları Date objesine çevir
  Object.keys(data).forEach(key => {
    if (data[key] instanceof Timestamp) {
      data[key] = data[key].toDate();
    }
  });
  return { id: doc.id, ...data } as DepoStokItem;
}

/**
 * Fetch _all_ items for a depot.
 * We will filter for un-shipped items on the client-side to avoid needing a composite index.
 * This is intended for panels that need the full list, like DepoSayim.
 */
export async function getFullDepotStock(
  depotId: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<{ items: DepoStokItem[] }> {
  try {
    const ref = collection(db, 'depoStok');
    const q = query(ref, where('depotId', '==', depotId));
    const snap = await getDocs(q);
    const items = filterByCompanyScope(snap.docs.map(processDoc), companyId, isSuperAdmin);
    return { items };
  } catch (err) {
    console.error('Error fetching full depot stock:', err);
    throw new Error('Failed to fetch full depot stock.');
  }
}

/**
 * Compact serial index for a depot — used by Mal Kabul duplicate detection.
 *
 * Mal Kabul only needs the SET of serial numbers already present in a depot to
 * reject duplicate scans; it does not need the full DepoStokItem documents.
 * Previously the panel downloaded the entire `depoStok` collection for the
 * selected depot (via the `useDepoStokByDepot` client hook) just to build this
 * set. Running thousands of docs through the Firestore web SDK + IndexedDB
 * persistence layer was the main cause of the panel's slow open and per-scan
 * main-thread contention.
 *
 * This server action instead:
 *   1. Reads `depoStok` with the Admin SDK (no client persistence layer), and
 *   2. Projects ONLY `stokKodu` / `seriNumarasi` / `companyId` via `.select()`,
 *      so Firestore returns a fraction of each document, and
 *   3. Returns a de-duplicated `Record<stokKodu, string[]>` map — a tiny
 *      payload compared to the full dataset.
 *
 * Behaviour matches the old client query (all stock for the depot, regardless
 * of `isShipped`) so duplicate detection is unchanged.
 */
export type DepotSerialIndex = Record<string, string[]>;

export async function getDepotSerialIndex(
  depotId: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<DepotSerialIndex> {
  if (!depotId) return {};
  try {
    const snap = await adminDb
      .collection('depoStok')
      .where('depotId', '==', depotId)
      .select('stokKodu', 'seriNumarasi', 'companyId')
      .get();

    const serialsByProduct = new Map<string, Set<string>>();
    snap.forEach((docSnap) => {
      const data = docSnap.data() as {
        stokKodu?: string;
        seriNumarasi?: string;
        companyId?: string | null;
      };
      // Defense-in-depth company scoping (mirrors filterByCompanyScope, but
      // per-item so we never materialize an intermediate array).
      if (!matchesCompanyScope(data, companyId, isSuperAdmin)) return;
      const stokKodu = data.stokKodu;
      const serial = data.seriNumarasi;
      if (!stokKodu || !serial) return;
      let set = serialsByProduct.get(stokKodu);
      if (!set) {
        set = new Set<string>();
        serialsByProduct.set(stokKodu, set);
      }
      set.add(serial);
    });

    const index: DepotSerialIndex = {};
    for (const [stokKodu, serials] of serialsByProduct) {
      index[stokKodu] = Array.from(serials);
    }
    return index;
  } catch (err) {
    console.error('[getDepotSerialIndex] Error for depot', depotId, ':', err);
    return {};
  }
}

/**
 * Fetch depot stock for the Direkt Transfer panel using a single Admin SDK query
 * with field projection. Replaces the 3-query `getScopedDocs` web SDK approach
 * that was downloading full documents through IndexedDB, causing 10–15s load times.
 *
 * Only the 9 fields needed for scan lookup + transfer creation are fetched.
 * `isShipped == true` items are filtered server-side to further cut payload.
 */
export async function getDepotStockForTransfer(
  depotId: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<DepoStokItem[]> {
  if (!depotId) return [];
  try {
    const snap = await adminDb
      .collection('depoStok')
      .where('depotId', '==', depotId)
      .select('stokKodu', 'stokAdi', 'seriNumarasi', 'lotNumarasi', 'adet', 'isShipped', 'companyId', 'miad')
      .get();

    const items: DepoStokItem[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, any>;
      if (!matchesCompanyScope(data, companyId, isSuperAdmin)) return;
      if (data.isShipped === true) return;
      let miad = data.miad;
      if (miad && typeof miad.toDate === 'function') miad = miad.toDate();
      items.push({
        id: docSnap.id,
        stokKodu: data.stokKodu ?? '',
        stokAdi: data.stokAdi ?? '',
        seriNumarasi: data.seriNumarasi,
        lotNumarasi: data.lotNumarasi,
        adet: data.adet,
        isShipped: data.isShipped,
        companyId: data.companyId,
        miad: miad ?? '',
      } as DepoStokItem);
    });
    return items;
  } catch (err) {
    console.error('[getDepotStockForTransfer] Error for depot', depotId, ':', err);
    return [];
  }
}

/**
 * All depot stock with field projection for the Siparişler panel min/max qty maps.
 * Uses two parallel Admin SDK queries (company + legacy) instead of the full-doc
 * web SDK fetch through IndexedDB. Fetches only the 7 fields needed for quantity
 * aggregation — no miad/stokAdi/seriNumarasi etc.
 */
export async function getDepoStokForOrders(
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<DepoStokItem[]> {
  try {
    const normalized = normalizeCompanyId(companyId);
    const selectFields = ['stokKodu', 'adet', 'isShipped', 'depotId', 'hedefKurumId', 'hedefKurum', 'companyId'] as const;
    let docs: AdminDocSnap[];

    if (isSuperAdmin || normalized === '__legacy__') {
      docs = (await adminDb.collection('depoStok').select(...selectFields).get()).docs as AdminDocSnap[];
    } else {
      const [cs, ls] = await Promise.all([
        adminDb.collection('depoStok').where('companyId', '==', normalized).select(...selectFields).get(),
        adminDb.collection('depoStok').where('companyId', '==', '__legacy__').select(...selectFields).get(),
      ]);
      const seen = new Set<string>();
      docs = [];
      for (const snap of [cs, ls]) {
        for (const d of snap.docs as AdminDocSnap[]) {
          if (!seen.has(d.id)) { seen.add(d.id); docs.push(d); }
        }
      }
    }

    return docs.map(d => {
      const data = d.data() as Record<string, any>;
      return {
        id: d.id,
        stokKodu: data.stokKodu ?? '',
        stokAdi: '',
        miad: '',
        adet: data.adet,
        isShipped: data.isShipped,
        depotId: data.depotId,
        hedefKurumId: data.hedefKurumId,
        hedefKurum: data.hedefKurum,
        companyId: data.companyId,
      } as DepoStokItem;
    });
  } catch (err) {
    console.error('[getDepoStokForOrders] Error:', err);
    return [];
  }
}

/**
 * Seçili dönemin laboratuvar sayımlarından saha stoğunu (stokKodu -> sayılan adet)
 * döndürür. Tedarikçi sipariş hesabında "anlık" saha stoğu yerine, siparişin
 * verildiği döneme ait sayım fotoğrafı kullanılır.
 *
 * Sayımlar `hospitals/{labId}/stockCounts` altında dönem bazlı tutulur; bir labda
 * aynı dönemde birden fazla oturum olabilir, bu yüzden stok kodu başına **en son**
 * oturumun değeri esas alınır (count-overview ile aynı semantik).
 *
 * Sayım yapmamış lablar `uncountedLabIds` ile geri bildirilir; çağıran taraf
 * kapsama oranını kullanıcıya gösterebilsin diye stok 0 kabul edilir.
 */
export async function getLabCountStockForPeriod(
  labIds: string[],
  year: number,
  monthIndex: number,
): Promise<{
  byCode: Record<string, number>;
  /** labId -> stokKodu -> sayılan adet */
  byLab: Record<string, Record<string, number>>;
  countedLabIds: string[];
  uncountedLabIds: string[];
}> {
  const uniqueLabIds = Array.from(new Set((labIds || []).map(id => String(id || '').trim()).filter(Boolean)));
  const empty = {
    byCode: {} as Record<string, number>,
    byLab: {} as Record<string, Record<string, number>>,
    countedLabIds: [] as string[],
    uncountedLabIds: uniqueLabIds,
  };
  if (uniqueLabIds.length === 0 || !Number.isFinite(year) || !Number.isFinite(monthIndex)) return empty;

  const periodKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const byCode: Record<string, number> = {};
  const byLab: Record<string, Record<string, number>> = {};
  const countedLabIds: string[] = [];
  const uncountedLabIds: string[] = [];

  try {
    await Promise.all(uniqueLabIds.map(async (labId) => {
      const ref = adminDb.collection('hospitals').doc(labId).collection('stockCounts');
      // period alanı yeni kayıtlarda; year+month (0-indeksli) eski kayıtlarda bulunur.
      const [byPeriod, byYearMonth] = await Promise.all([
        ref.where('period', '==', periodKey).get(),
        ref.where('year', '==', year).where('month', '==', monthIndex).get(),
      ]);

      const sessions = new Map<string, FirebaseFirestore.DocumentData>();
      for (const snap of [byPeriod, byYearMonth]) {
        snap.docs.forEach(d => sessions.set(d.id, d.data()));
      }
      if (sessions.size === 0) {
        uncountedLabIds.push(labId);
        return;
      }
      countedLabIds.push(labId);

      const toMillis = (value: any): number => {
        if (!value) return 0;
        if (typeof value?.toMillis === 'function') return value.toMillis();
        if (typeof value?.seconds === 'number') return value.seconds * 1000;
        const parsed = new Date(value).getTime();
        return Number.isNaN(parsed) ? 0 : parsed;
      };

      // En yeni oturum önce; bir stok kodu ilk görüldüğü (en güncel) oturumdan alınır.
      const ordered = Array.from(sessions.values()).sort(
        (a, b) => toMillis(b?.finishedAt) - toMillis(a?.finishedAt),
      );
      const seen = new Set<string>();
      for (const session of ordered) {
        const items = Array.isArray(session?.items) ? session.items : [];
        for (const item of items) {
          const code = String(item?.stokKodu ?? '').trim();
          if (!code || seen.has(code)) continue;
          seen.add(code);
          const counted = Number(item?.counted) || 0;
          byCode[code] = (byCode[code] || 0) + counted;
          if (!byLab[labId]) byLab[labId] = {};
          byLab[labId][code] = (byLab[labId][code] || 0) + counted;
        }
      }
    }));

    return { byCode, byLab, countedLabIds, uncountedLabIds };
  } catch (err) {
    console.error('[getLabCountStockForPeriod] Error:', err);
    return empty;
  }
}

/**
 * Verilen dönemler için Ceomed sevkiyat sorgusu kuyruğa alır.
 *
 * `watchSevkiyatRequests.js` işçisi (sürekli çalışır) `ceomedSevkiyatRequests`
 * koleksiyonundaki `pending` kayıtları işleyip sonucu `ceomedSevkiyatResults`'a
 * yazar. Sorgu ilgili ayın tüm irsaliyelerini tarayıp barkod kırılımını çektiği
 * için birkaç dakika sürebilir.
 *
 * Aynı dönem için hâlihazırda bekleyen/işlenen bir istek varsa yenisi açılmaz.
 * Bu koleksiyonlar client güvenlik kurallarında tanımlı olmadığından yazma
 * Admin SDK üzerinden yapılır.
 */
export async function requestCeomedSevkiyat(
  periods: Array<{ year: number; month: number }>,
  requestedByUid?: string | null,
): Promise<{ queued: number; skipped: number }> {
  const valid = (periods || []).filter(
    p => p && Number.isFinite(p.year) && Number.isFinite(p.month),
  );
  if (valid.length === 0) return { queued: 0, skipped: 0 };

  let queued = 0;
  let skipped = 0;
  try {
    for (const p of valid) {
      const existing = await adminDb
        .collection('ceomedSevkiyatRequests')
        .where('year', '==', p.year)
        .where('month', '==', p.month)
        .where('status', 'in', ['pending', 'processing'])
        .limit(1)
        .get();
      if (!existing.empty) {
        skipped += 1;
        continue;
      }
      await adminDb.collection('ceomedSevkiyatRequests').add({
        year: p.year,
        month: p.month,
        status: 'pending',
        requestedAt: FieldValue.serverTimestamp(),
        requestedByUid: requestedByUid || '',
        requestedFrom: 'tedarikci-siparis',
      });
      queued += 1;
    }
    return { queued, skipped };
  } catch (err) {
    console.error('[requestCeomedSevkiyat] Error:', err);
    return { queued, skipped };
  }
}

/**
 * Seçili dönemde sahadaki cihazlarda açık duran test adetlerini
 * (`stokKodu -> test`) döndürür.
 *
 * Cihaz üstü testler fiziksel bir varlıktır: açılmış kitin kalan testleri
 * sahada duruyordur ve o kadar sipariş edilmesine gerek yoktur. Kayıtlar
 * `cihazUstuGecmisi` koleksiyonunda hastane + dönem başına tutulur; aynı
 * dönemde birden çok kayıt olabileceğinden **en son** kayıt esas alınır
 * (çift sayımı önler).
 *
 * Dönem alanı `MM-YYYY` biçimindedir; eski kayıtlar için year+month (1-indeksli)
 * ile de sorgulanır.
 */
export async function getCihazUstuForPeriod(
  labIds: string[],
  year: number,
  month: number,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<{ byCode: Record<string, number>; byLab: Record<string, Record<string, number>> }> {
  const wanted = new Set((labIds || []).map(id => String(id || '').trim()).filter(Boolean));
  const bos = { byCode: {} as Record<string, number>, byLab: {} as Record<string, Record<string, number>> };
  if (wanted.size === 0 || !Number.isFinite(year) || !Number.isFinite(month)) return bos;

  const period = `${String(month).padStart(2, '0')}-${year}`;
  try {
    const base = adminDb.collection('cihazUstuGecmisi');
    const runScoped = async (
      build: (q: FirebaseFirestore.Query) => FirebaseFirestore.Query,
    ): Promise<AdminDocSnap[]> => {
      if (isSuperAdmin) return (await build(base).get()).docs as AdminDocSnap[];
      const normalized = normalizeCompanyId(companyId);
      const [cs, ls] = await Promise.all([
        build(base.where('companyId', '==', normalized)).get(),
        build(base.where('companyId', '==', '__legacy__')).get(),
      ]);
      return [...cs.docs, ...ls.docs] as AdminDocSnap[];
    };

    const [byPeriod, byYearMonth] = await Promise.all([
      runScoped(q => q.where('period', '==', period)),
      runScoped(q => q.where('year', '==', year).where('month', '==', month)),
    ]);

    const docsById = new Map<string, AdminDocSnap>();
    [...byPeriod, ...byYearMonth].forEach(d => docsById.set(d.id, d));
    if (docsById.size === 0) return bos;

    const toMillis = (value: any): number => {
      if (!value) return 0;
      if (typeof value?.toMillis === 'function') return value.toMillis();
      if (typeof value?.seconds === 'number') return value.seconds * 1000;
      return 0;
    };

    // Hastane başına yalnızca en güncel kayıt sayılır.
    const latestByHospital = new Map<string, AdminDocSnap>();
    Array.from(docsById.values())
      .sort((a, b) => toMillis(b.data()?.createdAt) - toMillis(a.data()?.createdAt))
      .forEach(d => {
        const hospitalId = String((d.data() as any)?.hospitalId || '').trim();
        if (!hospitalId || !wanted.has(hospitalId)) return;
        if (!latestByHospital.has(hospitalId)) latestByHospital.set(hospitalId, d);
      });

    const totals: Record<string, number> = {};
    const byLab: Record<string, Record<string, number>> = {};
    latestByHospital.forEach((d, hospitalId) => {
      const items = ((d.data() as any)?.items || []) as Array<{ productId?: string; value?: number | string }>;
      items.forEach(item => {
        const code = String(item?.productId ?? '').trim();
        if (!code) return;
        const value = Number(item?.value) || 0;
        if (value <= 0) return;
        totals[code] = (totals[code] || 0) + value;
        if (!byLab[hospitalId]) byLab[hospitalId] = {};
        byLab[hospitalId][code] = (byLab[hospitalId][code] || 0) + value;
      });
    });
    return { byCode: totals, byLab };
  } catch (err) {
    console.error('[getCihazUstuForPeriod] Error:', err);
    return bos;
  }
}

/** Ana depodaki bir lotun sevkiyat riski için gereken asgari bilgisi. */
export interface DepoLotu {
  lot: string;
  /** "dd.MM.yyyy" biçiminde miad; yoksa boş string */
  miad: string;
  adet: number;
}

/**
 * Ana deponun stoğunu **lot/miad kırılımıyla** döndürür (stokKodu -> lotlar).
 *
 * Hastane sevkiyatında sevk edilecek adedin miad riskini hesaplayabilmek için
 * toplam adet yetmez; hangi lotun ne zaman dolduğu gerekir. Ceomed depolarında
 * lotlar `ceomedDepoStok/{depotId}.items[]` içinde (`lot`/`miyat`), standart
 * depolarda her `depoStok` dokümanı 1 adet olacak şekilde `lotNumarasi`/`miad`
 * alanlarında durur; ikisi de aynı şekle normalize edilir.
 *
 * Çapraz-tenant erişimi önlemek için depo dokümanının companyId'si doğrulanır.
 */
export async function getDepotLotsByCode(
  depotId: string,
  isCeomed: boolean,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<Record<string, DepoLotu[]>> {
  if (!depotId) return {};
  try {
    const depotSnap = await adminDb.collection('depots').doc(depotId).get();
    if (!depotSnap.exists) return {};
    if (!isSuperAdmin) {
      const normalized = normalizeCompanyId(companyId);
      const depotCompany = normalizeCompanyId((depotSnap.data() as any)?.companyId);
      if (depotCompany !== '__legacy__' && depotCompany !== normalized) return {};
    }

    // (stokKodu, lot, miad) üçlüsünde topla — aynı lot birden çok kayıtta olabilir.
    const acc = new Map<string, Map<string, DepoLotu>>();
    const ekle = (stokKodu: string, lot: string, miad: string, adet: number) => {
      const code = String(stokKodu ?? '').trim();
      if (!code || !(adet > 0)) return;
      const inner = acc.get(code) ?? new Map<string, DepoLotu>();
      const key = `${lot}|${miad}`;
      const mevcut = inner.get(key);
      if (mevcut) mevcut.adet += adet;
      else inner.set(key, { lot, miad, adet });
      acc.set(code, inner);
    };

    if (isCeomed) {
      const ceomedSnap = await adminDb.collection('ceomedDepoStok').doc(depotId).get();
      if (!ceomedSnap.exists) return {};
      const items = ((ceomedSnap.data() as any)?.items || []) as Array<{
        stokKodu?: string; lot?: string; miyat?: string; adet?: number | string;
      }>;
      for (const it of items) {
        ekle(
          String(it?.stokKodu ?? ''),
          String(it?.lot ?? '').trim(),
          String(it?.miyat ?? '').trim(),
          Number(it?.adet) || 0,
        );
      }
    } else {
      const snap = await adminDb
        .collection('depoStok')
        .where('depotId', '==', depotId)
        .where('isShipped', '==', false)
        .select('stokKodu', 'lotNumarasi', 'miad')
        .get();
      for (const d of snap.docs as AdminDocSnap[]) {
        const data = d.data() as any;
        // Admin SDK miad'ı Timestamp olarak döndürebilir — panelin beklediği
        // dd.MM.yyyy biçimine normalize et.
        const rawMiad = data?.miad;
        let miad = '';
        if (typeof rawMiad === 'string') {
          miad = rawMiad.trim();
        } else if (rawMiad?.toDate) {
          const dt = rawMiad.toDate() as Date;
          miad = `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
        }
        ekle(String(data?.stokKodu ?? ''), String(data?.lotNumarasi ?? '').trim(), miad, 1);
      }
    }

    const out: Record<string, DepoLotu[]> = {};
    acc.forEach((inner, code) => {
      out[code] = Array.from(inner.values());
    });
    return out;
  } catch (err) {
    console.error('[getDepotLotsByCode] Error for depot', depotId, ':', err);
    return {};
  }
}

/**
 * Ceomed entegre bir deponun anlık stoğunu (stokKodu -> toplam adet) döndürür.
 *
 * Ceomed depolarında stok yerel `depoStok` yerine harici senkronla yazılan
 * `ceomedDepoStok/{depotId}` dokümanında `items[]` olarak tutulur ve bu koleksiyon
 * client güvenlik kurallarında kapalıdır — bu yüzden Admin SDK üzerinden okunur.
 * Çapraz-tenant erişimi önlemek için depo dokümanının companyId'si doğrulanır.
 */
export async function getCeomedDepoStockByCode(
  depotId: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<Record<string, number>> {
  if (!depotId) return {};
  try {
    const depotSnap = await adminDb.collection('depots').doc(depotId).get();
    if (!depotSnap.exists) return {};

    if (!isSuperAdmin) {
      const normalized = normalizeCompanyId(companyId);
      const depotCompany = normalizeCompanyId((depotSnap.data() as any)?.companyId);
      // __legacy__ (companyId'siz) depolar tüm tenant'larda görünür kalır (mevcut davranış).
      if (depotCompany !== '__legacy__' && depotCompany !== normalized) {
        return {};
      }
    }

    const ceomedSnap = await adminDb.collection('ceomedDepoStok').doc(depotId).get();
    if (!ceomedSnap.exists) return {};

    const items = ((ceomedSnap.data() as any)?.items || []) as Array<{
      stokKodu?: string;
      adet?: number | string;
    }>;
    const map: Record<string, number> = {};
    for (const it of items) {
      const code = String(it?.stokKodu ?? '').trim();
      if (!code) continue;
      map[code] = (map[code] || 0) + (Number(it?.adet) || 0);
    }
    return map;
  } catch (err) {
    console.error('[getCeomedDepoStockByCode] Error for depot', depotId, ':', err);
    return {};
  }
}

/**
 * Standart (Ceomed dışı) bir deponun sevk edilmemiş stoğunu `stokKodu -> adet`
 * haritası olarak döndürür (her doc = 1 adet). Tüm depoStok'u indiren `useDepoStok`
 * yerine yalnızca ilgili depoyu, projeksiyonla (Admin SDK) çeker. Çapraz-tenant
 * erişimi önlemek için depo dokümanının companyId'si doğrulanır.
 */
export async function getDepotStockByCode(
  depotId: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<Record<string, number>> {
  if (!depotId) return {};
  try {
    const depotSnap = await adminDb.collection('depots').doc(depotId).get();
    if (!depotSnap.exists) return {};
    if (!isSuperAdmin) {
      const normalized = normalizeCompanyId(companyId);
      const depotCompany = normalizeCompanyId((depotSnap.data() as any)?.companyId);
      if (depotCompany !== '__legacy__' && depotCompany !== normalized) {
        return {};
      }
    }

    const snap = await adminDb
      .collection('depoStok')
      .where('depotId', '==', depotId)
      .where('isShipped', '==', false)
      .select('stokKodu')
      .get();

    const map: Record<string, number> = {};
    for (const d of snap.docs as AdminDocSnap[]) {
      const code = String((d.data() as any)?.stokKodu ?? '').trim();
      if (!code) continue;
      map[code] = (map[code] || 0) + 1;
    }
    return map;
  } catch (err) {
    console.error('[getDepotStockByCode] Error for depot', depotId, ':', err);
    return {};
  }
}

/**
 * Seçili dönem için tüm hastanelerin Total Verimlilik kümülatif total (Sütun 15)
 * değerlerini stok koduna göre toplayıp `stokKodu -> toplam kümülatif test` haritası
 * döndürür.
 *
 * Veri `totalEfficiencyRecords` koleksiyonunda havuz + dönem başına tutulur:
 *   - Final kayıt:  `${poolId}-${year}-${month}`      (isAraKayit tanımsız)
 *   - Ara kayıt:    `araKayit-${poolId}-${year}-${month}` (isAraKayit === true)
 * Her havuz için final kayıt varsa o, yoksa ara kayıt kullanılır (çift sayım önlenir).
 * `month` 0-indekslidir (total verimlilik paneli getMonth() kullanır). Satırlar
 * inline (`rows`) veya `rowChunks` alt koleksiyonunda parçalı olabilir.
 */
async function loadKumulatifForPeriod(
  year: number,
  monthIndex: number,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<{
  byCode: Record<string, number>;
  /** labId -> stokKodu -> kümülatif test (hastane sevkiyatı için kırılım) */
  byLab: Record<string, Record<string, number>>;
  hasData: boolean;
}> {
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return { byCode: {}, byLab: {}, hasData: false };
  }
  try {
    const base = adminDb
      .collection('totalEfficiencyRecords')
      .where('year', '==', year)
      .where('month', '==', monthIndex);

    let docs: AdminDocSnap[];
    if (isSuperAdmin) {
      docs = (await base.get()).docs as AdminDocSnap[];
    } else {
      const normalized = normalizeCompanyId(companyId);
      const [cs, ls] = await Promise.all([
        base.where('companyId', '==', normalized).get(),
        base.where('companyId', '==', '__legacy__').get(),
      ]);
      const seen = new Set<string>();
      docs = [];
      for (const snap of [cs, ls]) {
        for (const d of snap.docs as AdminDocSnap[]) {
          if (!seen.has(d.id)) { seen.add(d.id); docs.push(d); }
        }
      }
    }

    // Havuz başına final kaydı ara kayda tercih et (çift sayımı önle).
    const chosenByPool = new Map<string, { doc: AdminDocSnap; isFinal: boolean }>();
    for (const d of docs) {
      const data = d.data() as Record<string, any>;
      const poolId = String(data.poolId || d.id);
      const isFinal = data.isAraKayit !== true;
      const existing = chosenByPool.get(poolId);
      if (!existing || (isFinal && !existing.isFinal)) {
        chosenByPool.set(poolId, { doc: d, isFinal });
      }
    }

    const totals: Record<string, number> = {};
    const byLab: Record<string, Record<string, number>> = {};
    for (const { doc: d } of chosenByPool.values()) {
      const data = d.data() as Record<string, any>;
      let rows: Array<{ stokKodu?: string; kumulatifTotal?: number }> = [];
      if (data.rowsChunked === true) {
        const chunksSnap = await d.ref.collection('rowChunks').orderBy('index', 'asc').get();
        rows = chunksSnap.docs.flatMap((c) => ((c.data().rows || []) as typeof rows));
      } else {
        rows = (data.rows || []) as typeof rows;
      }
      for (const r of rows) {
        const code = String(r?.stokKodu ?? '').trim();
        if (!code) continue;
        const value = Number(r?.kumulatifTotal) || 0;
        if (!value) continue;
        totals[code] = (totals[code] || 0) + value;
        // Hastane sevkiyatı lab kırılımı ister; satırlar zaten labId taşıyor.
        const labId = String((r as any)?.labId ?? '').trim();
        if (labId) {
          if (!byLab[labId]) byLab[labId] = {};
          byLab[labId][code] = (byLab[labId][code] || 0) + value;
        }
      }
    }
    // hasData: o dönem için hiç kayıt var mı — ortalama alınırken veri girilmemiş
    // dönemleri 0 sayıp ortalamayı aşağı çekmemek için gerekli.
    return { byCode: totals, byLab, hasData: chosenByPool.size > 0 };
  } catch (err) {
    console.error('[loadKumulatifForPeriod] Error:', err);
    return { byCode: {}, byLab: {}, hasData: false };
  }
}

export async function getTotalEfficiencyKumulatifByStok(
  year: number,
  monthIndex: number,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<Record<string, number>> {
  return (await loadKumulatifForPeriod(year, monthIndex, companyId, isSuperAdmin)).byCode;
}

/**
 * Birden fazla dönemin kümülatif total'ini tek çağrıda döndürür.
 * Anahtar `YYYY-MM` (1-indeksli ay) formatındadır. `hasData`, o dönemde hiç
 * total verimlilik kaydı bulunup bulunmadığını belirtir; ortalama hesaplarken
 * veri girilmemiş dönemler paydadan çıkarılabilsin diye taşınır.
 */
export async function getTotalEfficiencyKumulatifForPeriods(
  periods: Array<{ year: number; monthIndex: number }>,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<Record<string, { byCode: Record<string, number>; byLab: Record<string, Record<string, number>>; hasData: boolean }>> {
  const unique = new Map<string, { year: number; monthIndex: number }>();
  (periods || []).forEach((p) => {
    if (!p || !Number.isFinite(p.year) || !Number.isFinite(p.monthIndex)) return;
    unique.set(`${p.year}-${String(p.monthIndex + 1).padStart(2, '0')}`, p);
  });
  if (unique.size === 0) return {};

  const entries = await Promise.all(
    Array.from(unique.entries()).map(async ([key, p]) => {
      const result = await loadKumulatifForPeriod(p.year, p.monthIndex, companyId, isSuperAdmin);
      return [key, result] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Bootstrap data for the Sipariş Toplama page.
 *
 * Replaces 4× getScopedDocs calls (≈10 Firestore reads through IndexedDB) with
 * 4–6 parallel Admin SDK queries — no IndexedDB, ~1–2 s instead of 10–15 s.
 * depoStok uses field projection (10 fields); other collections are full-doc but
 * fetched server-side so IndexedDB is never involved.
 */
export async function getToplamaBootstrapData(
  depotId: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
  // Toplama ekranı yalnızca siparişteki stok kodlarına ait depo stoğunu kullanır
  // (bkz. availableWarehouseStock kullanımları). Tüm depo stoğunu (binlerce kayıt)
  // RSC sınırından serialize edip taşımak açılışı 20 sn+ yavaşlatıyordu; sipariş
  // kalemlerinin kodlarını verip stoğu sunucu tarafında daraltmak payload'ı
  // küçültür ve açılışı saniyeler seviyesine indirir.
  orderStokKodlari?: string[] | null,
): Promise<{
  depoStok: DepoStokItem[];
  productCodes: Record<string, any>[];
  deviceGroups: Record<string, any>[];
  hospitals: Record<string, any>[];
}> {
  if (!depotId) throw new Error('depotId required');
  try {
    const codeSet = orderStokKodlari && orderStokKodlari.length > 0
      ? new Set(orderStokKodlari.filter(Boolean))
      : null;
    const normalized = normalizeCompanyId(companyId);
    const depoStokSelectFields = [
      'stokKodu', 'stokAdi', 'lotNumarasi', 'miad', 'seriNumarasi',
      'rafAdresi', 'adet', 'isShipped', 'companyId', 'depotId',
    ] as const;

    // Build depoStok queries (depot filter + field projection)
    const makeDepoStokQuery = (extraWhere?: [string, FirebaseFirestore.WhereFilterOp, string]) => {
      let q = adminDb.collection('depoStok').where('depotId', '==', depotId);
      if (extraWhere) q = q.where(extraWhere[0], extraWhere[1], extraWhere[2]);
      return q.select(...depoStokSelectFields);
    };

    const [depoStokDocs, productCodeDocs, deviceGroupDocs, hospitalDocs] = await Promise.all([
      // depoStok: depot-filtered, company/legacy scoped, with field projection
      (async (): Promise<AdminDocSnap[]> => {
        if (isSuperAdmin || normalized === '__legacy__') {
          return (await makeDepoStokQuery().get()).docs as AdminDocSnap[];
        }
        const [cs, ls] = await Promise.all([
          makeDepoStokQuery(['companyId', '==', normalized]).get(),
          makeDepoStokQuery(['companyId', '==', '__legacy__']).get(),
        ]);
        const seen = new Set<string>();
        const out: AdminDocSnap[] = [];
        for (const snap of [cs, ls]) {
          for (const d of snap.docs as AdminDocSnap[]) {
            if (!seen.has(d.id)) { seen.add(d.id); out.push(d); }
          }
        }
        return out;
      })(),
      adminScopedDocs('productCodes', companyId, isSuperAdmin),
      // def_deviceGroups is a global collection — no company scoping
      adminDb.collection('def_deviceGroups').get().then(s => s.docs as AdminDocSnap[]),
      adminScopedDocs('hospitals', companyId, isSuperAdmin),
    ]);

    const depoStok: DepoStokItem[] = [];
    depoStokDocs.forEach(d => {
      const data = d.data() as Record<string, any>;
      if (!matchesCompanyScope(data, companyId, isSuperAdmin)) return;
      if (data.isShipped === true) return;
      // Yalnızca siparişteki kalemlerin stoğunu döndür (payload'ı küçült).
      if (codeSet && !codeSet.has(data.stokKodu)) return;
      let miad = data.miad;
      if (miad && typeof miad.toDate === 'function') miad = miad.toDate();
      depoStok.push({
        id: d.id,
        stokKodu: data.stokKodu ?? '',
        stokAdi: data.stokAdi ?? '',
        lotNumarasi: data.lotNumarasi,
        miad: miad ?? '',
        seriNumarasi: data.seriNumarasi,
        rafAdresi: data.rafAdresi,
        adet: data.adet,
        isShipped: data.isShipped,
        companyId: data.companyId,
        depotId: data.depotId,
      } as DepoStokItem);
    });

    return {
      depoStok,
      // serializeDoc deep-converts Admin Timestamp/GeoPoint/Ref instances into
      // plain values so the payload can cross the server-action boundary.
      productCodes: productCodeDocs
        .filter(d => matchesCompanyScope(d.data(), companyId, isSuperAdmin))
        .map(serializeDoc),
      deviceGroups: deviceGroupDocs.map(serializeDoc),
      hospitals: hospitalDocs
        .filter(d => matchesCompanyScope(d.data(), companyId, isSuperAdmin))
        .map(serializeDoc),
    };
  } catch (err) {
    console.error('[getToplamaBootstrapData] Error for depot', depotId, ':', err);
    throw err;
  }
}

export async function getExpiringItems(
  depotId: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<DepoStokItem[]> {
    const depoStokRef = collection(db, 'depoStok');
    const q = query(
        depoStokRef,
        where('depotId', '==', depotId),
        where('isShipped', '==', false)
    );

    const snapshot = await getDocs(q);
    const allItems = filterByCompanyScope(snapshot.docs.map(processDoc), companyId, isSuperAdmin);

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to the start of the day

    const expiringItems = allItems.filter(item => {
        const miadDate = toDateSafe(item.miad);
        if (!miadDate) {
            console.warn(`Could not parse date for item ${item.id}: ${item.miad}`);
            return false;
        }

        const diffDays = Math.ceil((miadDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
        return diffDays <= 90; // Warning for items expiring in 90 days or less
    }).sort((a, b) => safeCompareByMiad(a.miad, b.miad));

    return expiringItems;
}

export async function getExpiringProductsCountServer(
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<number> {
  try {
    // Tüm saha stoğu: depo (isShipped=false) + laboratuvar (isShipped=true).
    // Önceki sürüm yalnızca depoyu sayıyordu, bu yüzden kart boş kalabiliyordu.
    const depoStokRef = collection(db, 'depoStok');
    const snapshot = await getDocs(query(depoStokRef));
    const allItems = filterByCompanyScope(
      snapshot.docs.map(d => ({ stokKodu: d.data().stokKodu, lotNumarasi: d.data().lotNumarasi, miad: d.data().miad, companyId: d.data().companyId })),
      companyId,
      isSuperAdmin
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const seenKeys = new Set<string>();
    let count = 0;

    // miad string ('dd.MM.yyyy') veya Firestore Timestamp/Date olabilir.
    const toMiadDate = (raw: unknown): Date | null => {
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        const d = parse(trimmed, 'dd.MM.yyyy', new Date());
        return isValid(d) ? d : null;
      }
      if (raw && typeof raw === 'object') {
        const anyRaw = raw as any;
        const d: Date | null = typeof anyRaw.toDate === 'function'
          ? anyRaw.toDate()
          : (typeof anyRaw.seconds === 'number' ? new Date(anyRaw.seconds * 1000) : (raw instanceof Date ? raw : null));
        return d && isValid(d) ? d : null;
      }
      return null;
    };

    allItems.forEach(data => {
      const miadDate = toMiadDate(data.miad);
      if (!miadDate) return;
      const days = differenceInDays(miadDate, today);
      if (days <= 45) {
        const key = `${data.stokKodu}-${data.lotNumarasi || ''}-${miadDate.getTime()}`;
        if (!seenKeys.has(key)) { seenKeys.add(key); count++; }
      }
    });

    return count;
  } catch (err) {
    console.error('Error getting expiring products count:', err);
    return 0;
  }
}

export async function getDeviceImages(): Promise<string[]> {
  try {
    const publicPath = path.join(process.cwd(), 'public');
    const allFiles = await fs.readdir(publicPath, { recursive: true });
    
    // Filter for common image extensions and format the path for URL usage
    const imageFiles = allFiles
      .filter(file => /\.(png|jpg|jpeg|webp|svg)$/i.test(String(file)))
      .map(file => String(file).replace(/\\/g, '/')); // Ensure forward slashes

    return imageFiles;
  } catch (error) {
    console.error("Could not read device images from /public directory:", error);
    // Return an empty array if reading fails.
    return [];
  }
}

/**
 * Updates the 'lastProductTransfers' map in the Hospital document.
 * Uses dot notation (e.g., 'lastProductTransfers.STK001') to partial update.
 * @deprecated Use updateLabTransferDates instead
 */
export async function updateHospitalLastTransferDates(
  hospitalId: string,
  items: Array<{ stokKodu: string }>
) {
  if (!hospitalId || !items || items.length === 0) return;

  try {
    const hospitalRef = doc(db, 'hospitals', hospitalId);
    const updatePayload: Record<string, Date> = {};
    const now = new Date();

    items.forEach((item) => {
      if (item.stokKodu) {
        // "Dot notation" allows updating a nested field without overwriting the whole map
        updatePayload[`lastProductTransfers.${item.stokKodu}`] = now;
      }
    });

    if (Object.keys(updatePayload).length > 0) {
      await updateDoc(hospitalRef, updatePayload);
    }
  } catch (error) {
    // This is an auxiliary update, so it shouldn't crash the main flow.
    console.error('Error updating hospital last transfer dates:', error);
  }
}

/**
 * Updates the labTransferDates collection with last transfer dates.
 * Document ID format: {labId}_{depotId}
 * Uses dot notation to partial update individual product transfer dates.
 */
export async function updateLabTransferDates(
  labId: string,
  depotId: string,
  labName: string,
  depotName: string,
  items: Array<{ stokKodu: string }>,
  transferredBy?: string
) {
  if (!labId || !depotId || !items || items.length === 0) return;

  try {
    const docId = `${labId}_${depotId}`;
    const docRef = doc(db, 'labTransferDates', docId);
    const now = new Date();

    // Check if document exists
    const existingDoc = await getDoc(docRef);

    if (existingDoc.exists()) {
      // Update existing document with dot notation
      const updatePayload: Record<string, any> = {
        updatedAt: serverTimestamp(),
      };

      items.forEach((item) => {
        if (item.stokKodu) {
          updatePayload[`transfers.${item.stokKodu}`] = {
            lastTransferDate: Timestamp.fromDate(now),
            lastTransferBy: transferredBy || undefined,
          };
        }
      });

      await updateDoc(docRef, updatePayload);
    } else {
      // Create new document
      const transfers: Record<string, { lastTransferDate: any; lastTransferBy?: string }> = {};

      items.forEach((item) => {
        if (item.stokKodu) {
          transfers[item.stokKodu] = {
            lastTransferDate: Timestamp.fromDate(now),
            lastTransferBy: transferredBy || undefined,
          };
        }
      });

      await setDoc(docRef, {
        labId,
        depotId,
        labName,
        depotName,
        transfers,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.error('Error updating lab transfer dates:', error);
  }
}

/* ================================================================
   Grouped Stock Row – returned from server-side pagination
   ================================================================ */
export interface GroupedStockRow {
  key: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  anaBirim: string;
  rafAdresi: string;
  quantity: number;
  itemIds: string[];
  /** itemId → its counted qty (a depoStok doc's `adet` field can be >1 for bulk-received
      stock; defaults to 1 when the doc has no numeric adet). Lets quantity corrections
      reduce/keep-in-sync at the same granularity `quantity` was summed at. */
  itemAdets: Record<string, number>;
  /** Brand from productCodes — used by the marka column filter. */
  marka?: string;
  // Server-computed risk metadata (populated when minMaxRules are available).
  miadDays?: number;
  miadSeverity?: 'normal' | 'notice' | 'caution' | 'warning' | 'critical' | 'expired';
  coverageDays?: number;
  coverageSeverity?: 'good' | 'warning' | 'critical' | 'unknown';
  coverageLabel?: string;
  dailyNeed?: number;
  riskyBoxes?: number;
  /** True when an active minMax rule says quantity is at or below the minimum. */
  belowMin?: boolean;
}

export interface PaginatedStockResult {
  rows: GroupedStockRow[];
  totalRows: number;
  totalPages: number;
  currentPage: number;
  /** Total grouped rows that have riskyBoxes > 0 (for the unfiltered set). */
  riskyRowsCount: number;
  /** Sum of riskyBoxes across all rows (used by the rescue banner). */
  riskyBoxesTotal: number;
  /** Unique values per column – used for Excel-like column filters */
  columnValues: {
    /** Stok Adı options carry the matching stokKodu so the filter UI can show
     *  the product code and search by it. The `value` field is what the server
     *  matches against `r.stokAdi` when the filter is applied. */
    stokAdi: Array<{ value: string; code: string }>;
    lotNumarasi: string[];
    miad: string[];
    rafAdresi: string[];
    /** Distinct brands present in the depot, used by the marka filter. */
    marka: string[];
  };
}

/**
 * Server-side paginated + grouped depot stock.
 * Groups individual DepoStokItem docs by (stokKodu, lotNumarasi, miad).
 * Only the requested page of grouped rows is returned to the client.
 *
 * Risk metadata (miadDays, coverageDays, riskyBoxes, severities) is computed
 * server-side using the depot's minMaxRules and the global productCodes catalog.
 * The client therefore only ships paint-ready data per page.
 */
export async function getPaginatedDepotStock(params: {
  depotId: string;
  page: number;
  pageSize: number;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  columnFilters?: Record<string, string[]>;
  /** When true, only rows with riskyBoxes > 0 are returned. */
  riskyOnly?: boolean;
  companyId?: string | null;
  isSuperAdmin?: boolean;
}): Promise<PaginatedStockResult> {
  const {
    depotId, page, pageSize, sortField, sortDirection,
    columnFilters, riskyOnly, companyId, isSuperAdmin,
  } = params;

  const emptyResult: PaginatedStockResult = {
    rows: [], totalRows: 0, totalPages: 0, currentPage: 1,
    riskyRowsCount: 0, riskyBoxesTotal: 0,
    columnValues: { stokAdi: [], lotNumarasi: [], miad: [], rafAdresi: [], marka: [] },
  };

  if (!depotId) {
    return emptyResult;
  }

  try {

  // Önce depo dokümanını oku — ceomedEnabled ise akış değişir (ceomedDepoStok'tan oku)
  const depotDoc = await adminDb.collection('depots').doc(depotId).get();
  const isCeomedDepot = !!(depotDoc.exists && (depotDoc.data() as any)?.ceomedEnabled);

  let allItems: DepoStokItem[] = [];
  let rulesSnap: FirebaseFirestore.QuerySnapshot;
  let productsSnap: FirebaseFirestore.QuerySnapshot;

  if (isCeomedDepot) {
    // Ceomed entegre depo: ceomedDepoStok/{depotId} dokümanından oku
    const [ceomedDoc, rules, products] = await Promise.all([
      adminDb.collection('ceomedDepoStok').doc(depotId).get(),
      adminDb.collection('depots').doc(depotId).collection('minMaxRules').get(),
      adminDb.collection('productCodes').get(),
    ]);
    rulesSnap = rules;
    productsSnap = products;

    if (ceomedDoc.exists) {
      const data = ceomedDoc.data() as any;
      const items = (data.items || []) as Array<{
        stokKodu: string; stokAdi: string; lot: string; miyat: string; adet: number;
      }>;
      // Ceomed itemleri DepoStokItem şekline normalize et
      allItems = items.map((it, idx) => ({
        id: `ceomed-${depotId}-${idx}`,
        depotId,
        stokKodu: it.stokKodu || '',
        stokAdi: it.stokAdi || '',
        lotNumarasi: it.lot || '',
        miad: it.miyat || '',
        adet: Number(it.adet) || 0,
        rafAdresi: '',
        isShipped: false,
      } as unknown as DepoStokItem));
    }
  } else {
    // Fetch stock + depot rules + product catalog in parallel using Admin SDK
    const [snapshot, rules, products] = await Promise.all([
      adminDb.collection('depoStok')
        .where('depotId', '==', depotId)
        .where('isShipped', '==', false)
        .get(),
      adminDb.collection('depots').doc(depotId).collection('minMaxRules').get(),
      adminDb.collection('productCodes').get(),
    ]);
    rulesSnap = rules;
    productsSnap = products;
    allItems = filterByCompanyScope(
      snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
      companyId,
      isSuperAdmin,
    );
  }

  // Build helper maps from the side-loaded master data
  const minMaxRules: Record<string, { max?: number; maxGun?: number; min?: number }> = {};
  rulesSnap.forEach((d) => {
    const rule = d.data() as { stokKodu?: string; max?: number; maxGun?: number; min?: number };
    if (rule.stokKodu) minMaxRules[rule.stokKodu] = rule;
  });

  const productByCode = new Map<string, { anaBirim?: string; trackingMode?: string; defaultTrackingMode?: string; marka?: string }>();
  const lotTrackedStokCodes = new Set<string>();
  productsSnap.forEach((d) => {
    const data = d.data() as Record<string, any>;
    const stokKodu: string | undefined = data.stokKodu;
    if (!stokKodu) return;
    productByCode.set(stokKodu, data);
    // Mirror resolveDefaultTrackingMode without importing client-only utilities.
    const trackingMode = data.defaultTrackingMode || data.trackingMode || data.takipModu;
    if (trackingMode === 'serial' || trackingMode === 'lot_barcode' || trackingMode === 'lot_manual') {
      lotTrackedStokCodes.add(stokKodu);
    }
  });

  // Group by (stokKodu, lotNumarasi, miad)
  const grouped: Record<string, GroupedStockRow> = {};
  for (const item of allItems) {
    const lot = item.lotNumarasi || '';
    const rawMiad = item.miad;
    // Admin SDK may return miad as a Firestore Timestamp or a string — normalize.
    let miad = '';
    if (typeof rawMiad === 'string') {
      miad = rawMiad;
    } else if (rawMiad && typeof rawMiad === 'object' && typeof (rawMiad as any).toDate === 'function') {
      const d = (rawMiad as any).toDate() as Date;
      miad = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    }
    const key = `${item.stokKodu}-${lot}-${miad}`;
    if (!grouped[key]) {
      const product = productByCode.get(item.stokKodu || '');
      grouped[key] = {
        key,
        stokKodu: item.stokKodu || '',
        stokAdi: item.stokAdi || '',
        lotNumarasi: lot,
        miad,
        anaBirim: product?.anaBirim || 'Adet',
        rafAdresi: item.rafAdresi || '',
        quantity: 0,
        itemIds: [],
        itemAdets: {},
        marka: product?.marka || '',
      };
    }
    const qty = (item.adet && typeof item.adet === 'number') ? item.adet : 1;
    grouped[key].quantity += qty;
    if (item.id) {
      grouped[key].itemIds.push(item.id);
      grouped[key].itemAdets[item.id] = qty;
    }
  }

  let rows = Object.values(grouped);

  // ─── Risk metadata: miad + coverage + riskyBoxes ───
  // Mirrors getMiadInfoFromString / getCoverageInfoForRow / getRiskyBoxes from the panel.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Pre-aggregate "total quantity by stokKodu" so non-lot-tracked coverage uses
  // the depot-wide stock for the same stok code (matches client behaviour).
  const totalByStokKodu = new Map<string, number>();
  rows.forEach((r) => {
    totalByStokKodu.set(r.stokKodu, (totalByStokKodu.get(r.stokKodu) ?? 0) + r.quantity);
  });

  rows = rows.map((row) => {
    // Miad info
    let miadDays = Number.POSITIVE_INFINITY;
    let miadSeverity: GroupedStockRow['miadSeverity'] = 'normal';
    if (row.miad) {
      const miadDate = parse(row.miad, 'dd.MM.yyyy', new Date());
      if (isValid(miadDate)) {
        miadDays = differenceInDays(miadDate, today);
        if (miadDays < 0) miadSeverity = 'expired';
        else if (miadDays <= 3) miadSeverity = 'critical';
        else if (miadDays <= 10) miadSeverity = 'warning';
        else if (miadDays < 45) miadSeverity = 'caution';
        else if (miadDays < 60) miadSeverity = 'notice';
      }
    }

    // Coverage info
    let coverageSeverity: GroupedStockRow['coverageSeverity'] = 'unknown';
    let coverageLabel = 'Min/Max tanımsız';
    let coverageDays = 0;
    let dailyNeed = 0;
    const rule = minMaxRules[row.stokKodu];
    if (rule && rule.max && rule.maxGun) {
      const stockForCoverage = lotTrackedStokCodes.has(row.stokKodu)
        ? row.quantity
        : (totalByStokKodu.get(row.stokKodu) ?? row.quantity);
      const periodDays = Math.floor(rule.maxGun);
      if (periodDays > 0) {
        dailyNeed = rule.max / periodDays;
        if (dailyNeed > 0) {
          coverageDays = Math.floor(stockForCoverage / dailyNeed);
          if (coverageDays <= 3) { coverageSeverity = 'critical'; coverageLabel = `${coverageDays} gün`; }
          else if (coverageDays <= 10) { coverageSeverity = 'warning'; coverageLabel = `${coverageDays} gün`; }
          else { coverageSeverity = 'good'; coverageLabel = `${coverageDays} gün yeter`; }
        } else {
          coverageLabel = 'Hesaplanamadı';
        }
      } else {
        coverageLabel = 'Hesaplanamadı';
      }
    }

    // Risky boxes (only meaningful when coverage outruns expiry)
    let riskyBoxes = 0;
    if (
      coverageSeverity !== 'unknown' &&
      Number.isFinite(miadDays) &&
      miadDays > 0 &&
      coverageDays > miadDays
    ) {
      const riskyDays = coverageDays - miadDays;
      riskyBoxes = Math.max(0, Math.ceil(riskyDays * dailyNeed));
    }

    // Below-min flag — drives the "Min. Stok" legend chip and slate row stripe.
    const belowMin = !!(rule && rule.min !== undefined && row.quantity <= rule.min);

    return {
      ...row,
      miadDays: Number.isFinite(miadDays) ? miadDays : undefined,
      miadSeverity,
      coverageDays,
      coverageSeverity,
      coverageLabel,
      dailyNeed,
      riskyBoxes,
      belowMin,
    };
  });

  // Risky aggregates over the unfiltered, ungrouped-by-page rows.
  const riskyRowsCount = rows.reduce((acc, r) => acc + ((r.riskyBoxes ?? 0) > 0 ? 1 : 0), 0);
  const riskyBoxesTotal = rows.reduce((acc, r) => acc + (r.riskyBoxes ?? 0), 0);

  // Collect unique column values BEFORE filtering (so filter dropdowns show all options).
  // For stokAdi we also collect the matching stokKodu(s) so the filter dropdown can
  // show the product code beside the name and let users search by either.
  const stokAdiToCodes = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.stokAdi) continue;
    if (!stokAdiToCodes.has(r.stokAdi)) stokAdiToCodes.set(r.stokAdi, new Set());
    if (r.stokKodu) stokAdiToCodes.get(r.stokAdi)!.add(r.stokKodu);
  }
  const stokAdiOptions = Array.from(stokAdiToCodes.entries())
    .map(([stokAdi, codes]) => ({
      value: stokAdi,
      code: Array.from(codes).sort().join(', '),
    }))
    .sort((a, b) => a.value.localeCompare(b.value, 'tr'));

  const columnValues: PaginatedStockResult['columnValues'] = {
    stokAdi: stokAdiOptions,
    lotNumarasi: [...new Set(rows.map(r => r.lotNumarasi).filter(Boolean))].sort(),
    miad: [...new Set(rows.map(r => r.miad).filter(Boolean))].sort(),
    rafAdresi: [...new Set(rows.map(r => r.rafAdresi).filter(Boolean))].sort(),
    marka: [...new Set(rows.map(r => r.marka).filter((m): m is string => !!m))].sort((a, b) => a.localeCompare(b, 'tr')),
  };

  // Apply column filters
  if (columnFilters) {
    for (const [col, values] of Object.entries(columnFilters)) {
      if (values.length === 0) continue;
      rows = rows.filter(r => {
        const fieldVal = (r as any)[col];
        return values.includes(String(fieldVal ?? ''));
      });
    }
  }

  // Risky-only filter (applied after column filters, before sort+paginate)
  if (riskyOnly) {
    rows = rows.filter((r) => (r.riskyBoxes ?? 0) > 0);
  }

  // Sort
  rows.sort((a, b) => {
    const aVal = (a as any)[sortField] ?? '';
    const bVal = (b as any)[sortField] ?? '';

    if (sortField === 'miad') {
      const aStr = String(aVal).trim();
      const bStr = String(bVal).trim();
      const dateA = aStr ? parse(aStr, 'dd.MM.yyyy', new Date()) : null;
      const dateB = bStr ? parse(bStr, 'dd.MM.yyyy', new Date()) : null;
      const validA = !!dateA && isValid(dateA);
      const validB = !!dateB && isValid(dateB);
      // "Blanks last": rows with no parseable miad sink to the bottom
      // regardless of sort direction, so the nearest expiries always lead.
      if (!validA && !validB) return 0;
      if (!validA) return 1;
      if (!validB) return -1;
      return sortDirection === 'asc' ? compareAsc(dateA!, dateB!) : compareAsc(dateB!, dateA!);
    }

    if (sortField === 'quantity') {
      return sortDirection === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    }

    return sortDirection === 'asc'
      ? String(aVal).localeCompare(String(bVal), 'tr')
      : String(bVal).localeCompare(String(aVal), 'tr');
  });

  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return {
    rows: pageRows,
    totalRows,
    totalPages,
    currentPage: safePage,
    riskyRowsCount,
    riskyBoxesTotal,
    columnValues,
  };

  } catch (err) {
    console.error('[getPaginatedDepotStock] Error for depot', depotId, ':', err);
    return emptyResult;
  }
}

/**
 * Returns the count of unique product groups (stokKodu+lot+miad)
 * whose miad is within the next `thresholdDays` days,
 * across ALL depots. Server-side computation – only the count is returned.
 */
export async function getExpiringProductsCount(
  thresholdDays: number = 45,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<number> {
  try {
    // Composite query: isShipped (requires Firestore index)
    const stockQuery = query(
      collection(db, 'depoStok'),
      where('isShipped', '==', false)
    );
    const snapshot = await getDocs(stockQuery);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const seenKeys = new Set<string>();
    let count = 0;

    const scopedDocs = isSuperAdmin
      ? snapshot.docs
      : snapshot.docs.filter((d) => {
          const data = d.data();
          return filterByCompanyScope([data], companyId, isSuperAdmin).length > 0;
        });

    for (const docSnap of scopedDocs) {
      const data = docSnap.data();
      const miadStr = typeof data.miad === 'string' ? data.miad : '';
      if (!miadStr) continue;
      const miadDate = parse(miadStr, 'dd.MM.yyyy', new Date());
      if (!isValid(miadDate)) continue;

      const days = differenceInDays(miadDate, today);
      if (days <= thresholdDays && days >= 0) {
        const key = `${data.stokKodu}-${data.lotNumarasi || ''}-${miadStr}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          count += 1;
        }
      }
    }

    return count;
  } catch (error) {
    console.error('Error counting expiring products:', error);
    return 0;
  }
}

// ─── Static master-data fetchers (Admin SDK — bypasses IndexedDB) ────────────

/**
 * Returns all active productCodes visible to the given user.
 * Uses Admin SDK to bypass the Firestore web SDK's IndexedDB persistence layer,
 * cutting first-load time from 5–15 s to ~1 s.
 */
export async function getProductCodesAction(
  companyId: string | null | undefined,
  isSuperAdmin: boolean,
): Promise<Record<string, any>[]> {
  const docs = await adminScopedDocs('productCodes', companyId, isSuperAdmin);
  return docs
    .filter(d => matchesCompanyScope(d.data(), companyId, isSuperAdmin))
    .map(serializeDoc);
}

/**
 * Returns all active barcodeFormats visible to the given user.
 * Uses Admin SDK to bypass IndexedDB, same as getProductCodesAction.
 */
export async function getBarcodeFormatsAction(
  companyId: string | null | undefined,
  isSuperAdmin: boolean,
): Promise<Record<string, any>[]> {
  const docs = await adminScopedDocs('barcodeFormats', companyId, isSuperAdmin);
  return docs
    .filter(d => {
      const data = d.data();
      return (data.active !== false) && matchesCompanyScope(data, companyId, isSuperAdmin);
    })
    .map(serializeDoc);
}

/** Cursor for archived-order pagination — a single time boundary (millis). */
/** Cursor for archived-order pagination — a single time boundary (millis). */
export type ArchivedOrdersCursor = { ms: number } | null;

/** Filters for getArchivedOrders */
export interface ArchivedOrdersFilters {
  searchTerm?: string | null;
  /** JS Date or ISO string — orders AT OR AFTER this date (archivedAt). */
  dateFrom?: Date | string | null;
  /** JS Date or ISO string — orders AT OR BEFORE this date (archivedAt). End of day is assumed. */
  dateTo?: Date | string | null;
  /** Substring match on kurumAdi (laboratory name). */
  kurumAdi?: string | null;
}

/** Best-available completion timestamp (millis) for an order/archive doc. */
function archivedDocMillis(data: Record<string, any>): number {
  const pick = (v: any) => (v && typeof v.toMillis === 'function' ? v.toMillis() : (v instanceof Date ? v.getTime() : 0));
  return pick(data?.archivedAt) || pick(data?.transferredAt) || pick(data?.completedAt) || pick(data?.createdAt) || pick(data?.timestamp) || 0;
}

/**
 * Project an order/archive doc to a lightweight LIST summary.
 *
 * The heavy `items` array (the order detail) is NOT shipped to the client — the
 * list only needs counts. Kalem/adet are computed server-side, then `items` is
 * dropped. The detail screen re-reads the full doc by id when the user opens a
 * specific order, so detail data is never downloaded until then.
 */
function summarizeArchivedDoc(d: FirebaseFirestore.QueryDocumentSnapshot): Record<string, any> {
  const data = d.data();
  const items = Array.isArray(data.items) ? data.items : [];
  const kalemCount = items.length;
  const adetCount = items.reduce(
    (s: number, i: any) => s + (Number(i?.adet ?? i?.quantity ?? 0) || 0),
    0,
  );
  const { items: _omitItems, ...rest } = data;
  return serializeFirestoreValue({ id: d.id, ...rest, kalemCount, adetCount });
}

/**
 * Completed-order history for a depot, with TRUE server-side cursor pagination.
 *
 * Source of truth = `ordersArchive` (completed orders are moved here, newest
 * first via `archivedAt`). Pre-archive completed orders that still live in
 * `orders` (status == 'completed') are unioned in as a bounded supplement, so
 * the full history shows even before a backfill. Because archived orders are
 * strictly newer than those leftovers, the archive is paged first (indexed,
 * only `pageSize` docs fetched) and the leftovers are read only once the
 * archive is exhausted — keeping reads proportional to what is displayed.
 *
 * Supports date-range filters on archivedAt (applied server-side for the
 * archive, in-memory for leftovers) and optional lab-name (kurumAdi) substring
 * filter combined with the text search.
 *
 * Returns lightweight summaries (no `items`); the cursor is a single time
 * boundary so "Daha Fazla Yükle" just passes back `nextCursor`.
 */
export async function getArchivedOrders(
  depotId: string,
  companyId: string | null | undefined,
  isSuperAdmin: boolean,
  pageSize: number = 20,
  cursor?: ArchivedOrdersCursor,
  filters?: ArchivedOrdersFilters | null,
): Promise<{ orders: Record<string, any>[]; nextCursor: ArchivedOrdersCursor; hasMore: boolean }> {
  if (!depotId) return { orders: [], nextCursor: null, hasMore: false };
  const boundaryMs = cursor && Number.isFinite(cursor.ms) ? cursor.ms : Number.POSITIVE_INFINITY;
  const isComplete = (data: Record<string, any>) => data?.status !== 'eksik';

  const term = (filters?.searchTerm ?? '').trim().toLocaleLowerCase('tr');
  const labTerm = (filters?.kurumAdi ?? '').trim().toLocaleLowerCase('tr');

  // Resolve date boundaries (start-of-day from, end-of-day to).
  const resolveDate = (v: Date | string | null | undefined): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };
  const fromDate = resolveDate(filters?.dateFrom ?? null);
  const toDate = resolveDate(filters?.dateTo ?? null);
  if (toDate) {
    // Treat dateTo as inclusive end-of-day in local time.
    toDate.setHours(23, 59, 59, 999);
  }
  const fromMs = fromDate ? fromDate.getTime() : 0;
  const toMs = toDate ? toDate.getTime() : Number.POSITIVE_INFINITY;

  type Cand = { doc: FirebaseFirestore.QueryDocumentSnapshot; ms: number };

  const passesDateFilter = (ms: number) =>
    (fromMs === 0 || ms >= fromMs) && (toMs === Number.POSITIVE_INFINITY || ms <= toMs);

  const passesTextFilters = (data: Record<string, any>) => {
    if (!isComplete(data)) return false;
    if (term) {
      const hay = `${data.kurumAdi ?? ''} ${data.createdBy ?? ''} ${data.transferredBy ?? ''}`.toLocaleLowerCase('tr');
      if (!hay.includes(term)) return false;
    }
    if (labTerm) {
      const labHay = (data.kurumAdi ?? '').toLocaleLowerCase('tr');
      if (!labHay.includes(labTerm)) return false;
    }
    return true;
  };

  // Leftover completed orders still living in `orders` (pre-archive). Bounded
  // read: filter status server-side when the composite index exists, else fall
  // back to a depot-only read + in-memory status filter.
  const fetchLeftoverCompleted = async (): Promise<Cand[]> => {
    const base = adminDb.collection('orders').where('depotId', '==', depotId);
    let docs: FirebaseFirestore.QueryDocumentSnapshot[];
    try {
      docs = (await base.where('status', '==', 'completed').limit(1000).get())
        .docs as FirebaseFirestore.QueryDocumentSnapshot[];
    } catch {
      docs = ((await base.limit(1000).get()).docs as FirebaseFirestore.QueryDocumentSnapshot[])
        .filter(d => d.data().status === 'completed');
    }
    return docs
      .map(d => ({ doc: d, ms: archivedDocMillis(d.data()) }))
      .filter(c => passesDateFilter(c.ms));
  };

  const hasFilters = !!(term || labTerm || fromDate || toDate);

  try {
    let archiveColl: FirebaseFirestore.Query = adminDb.collection('ordersArchive').where('depotId', '==', depotId);

    // Apply Firestore-side date range to the archive query when filters are set.
    // This keeps the scanned set small before the in-memory text filter runs.
    if (fromDate) archiveColl = archiveColl.where('archivedAt', '>=', fromDate);
    if (toDate) archiveColl = archiveColl.where('archivedAt', '<=', toDate);

    // When any filter is active (text, lab, or date), scan a capped window of
    // BOTH sources, filter in memory, then page by cursor. This is the same
    // approach as the text-search path — avoids the Firestore offset restriction
    // while keeping the fetch bounded (SCAN_CAP docs max).
    if (hasFilters) {
      const SCAN_CAP = 1000;
      let archiveDocs: FirebaseFirestore.QueryDocumentSnapshot[];
      try {
        archiveDocs = (await archiveColl.orderBy('archivedAt', 'desc').limit(SCAN_CAP).get()).docs as any;
      } catch {
        archiveDocs = (await archiveColl.limit(SCAN_CAP).get()).docs as any;
      }
      const leftover = await fetchLeftoverCompleted();
      const seen = new Set<string>();
      const all: Cand[] = [];
      for (const d of archiveDocs) {
        if (!seen.has(d.id)) { seen.add(d.id); all.push({ doc: d, ms: archivedDocMillis(d.data()) }); }
      }
      for (const c of leftover) {
        if (!seen.has(c.doc.id)) { seen.add(c.doc.id); all.push(c); }
      }
      const matched = all
        .filter(c => passesTextFilters(c.doc.data()))
        .sort((a, b) => b.ms - a.ms);
      const after = matched.filter(c => c.ms < boundaryMs);
      const page = after.slice(0, pageSize);
      return {
        orders: page.map(c => summarizeArchivedDoc(c.doc)),
        nextCursor: page.length ? { ms: page[page.length - 1].ms } : null,
        hasMore: after.length > pageSize,
      };
    }

    // No filters: cursor pagination over archive first, then leftovers.
    let archivePage: FirebaseFirestore.QueryDocumentSnapshot[];
    try {
      let q = archiveColl.orderBy('archivedAt', 'desc');
      // Admin SDK, Timestamp alani icin JS Date'i kabul eder.
      if (Number.isFinite(boundaryMs)) q = q.startAfter(new Date(boundaryMs));
      archivePage = (await q.limit(pageSize + 1).get()).docs as any;
    } catch {
      // Composite index missing — read a capped window and page in memory.
      const all = ((await archiveColl.limit(2000).get()).docs as FirebaseFirestore.QueryDocumentSnapshot[])
        .map(d => ({ doc: d, ms: archivedDocMillis(d.data()) }))
        .filter(c => c.ms < boundaryMs)
        .sort((a, b) => b.ms - a.ms);
      archivePage = all.slice(0, pageSize + 1).map(c => c.doc);
    }

    const candidates: Cand[] = archivePage
      .filter(d => isComplete(d.data()))
      .map(d => ({ doc: d, ms: archivedDocMillis(d.data()) }));
    const archiveHasMore = archivePage.length > pageSize;

    // Only reach for the (older) leftover orders once the archive page is not
    // full — i.e. at the tail of the archive — so mid-archive pages stay a
    // single indexed read of `pageSize` docs.
    if (!archiveHasMore) {
      const seen = new Set(candidates.map(c => c.doc.id));
      const leftover = await fetchLeftoverCompleted();
      for (const c of leftover) {
        if (c.ms < boundaryMs && !seen.has(c.doc.id)) { seen.add(c.doc.id); candidates.push(c); }
      }
    }

    candidates.sort((a, b) => b.ms - a.ms);
    const page = candidates.slice(0, pageSize);
    const hasMore = archiveHasMore || candidates.length > pageSize;
    return {
      orders: page.map(c => summarizeArchivedDoc(c.doc)),
      nextCursor: page.length ? { ms: page[page.length - 1].ms } : null,
      hasMore,
    };
  } catch (err) {
    console.error('getArchivedOrders error:', err);
    return { orders: [], nextCursor: null, hasMore: false };
  }
}


// ─── Tamamlanan sipariş geçmişi: SHIPMENTS tabanlı (tam geçmiş) ───────────────
// `ordersArchive` yalnızca arşiv özelliği sonrası tamamlananları tutar (seyrek).
// Her tamamlama bir `shipments` kaydı oluşturur; tam geçmiş buradadır. Eski
// "Sipariş Geçmişi" paneli de bu koleksiyonu okurdu.

export interface CompletedShipmentFilters {
  /** JS Date or ISO string — AT OR AFTER (timestamp). */
  dateFrom?: Date | string | null;
  /** JS Date or ISO string — AT OR BEFORE (timestamp), gün sonuna tamamlanır. */
  dateTo?: Date | string | null;
  /** Laboratuvar (recipientHospital) tam eşleşme — seçici için. */
  recipientHospital?: string | null;
  /** recipientHospital / userName üzerinde substring araması. */
  searchTerm?: string | null;
}

/** Bir shipment dokümanını hafif kart özetine indirger (items detayı taşınmaz). */
function summarizeShipmentDoc(d: FirebaseFirestore.QueryDocumentSnapshot): Record<string, any> {
  const data = d.data();
  const items = Array.isArray(data.items) ? data.items : [];
  const kalemCount = items.length;
  const adetCount = items.reduce(
    (s: number, i: any) => s + (Number(i?.quantity ?? i?.adet ?? 0) || 0),
    0,
  );
  const ts = data.timestamp;
  const tsDate = ts && typeof ts.toDate === 'function' ? ts.toDate() : (ts instanceof Date ? ts : null);
  return serializeFirestoreValue({
    id: d.id,
    kurumAdi: data.recipientHospital ?? '',
    createdBy: data.userName ?? '',
    transferredBy: data.userName ?? '',
    createdAt: tsDate,
    transferredAt: tsDate,
    status: 'completed',
    depotId: data.depotId ?? '',
    orderId: data.orderId ?? '',
    kalemCount,
    adetCount,
    __shipment: true,
  });
}

function shipmentMillis(data: Record<string, any>): number {
  const ts = data?.timestamp;
  if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return 0;
}

/**
 * Tamamlanan sipariş geçmişi — `shipments` koleksiyonundan, gerçek server-side
 * cursor sayfalama ile. Tarih aralığı (timestamp) ve laboratuvar (recipientHospital)
 * filtreleri sunucu tarafında uygulanır; yalnızca `pageSize` kayıt çekilir ve
 * items detayı istemciye taşınmaz.
 */
export async function getCompletedShipments(
  depotId: string,
  companyId: string | null | undefined,
  isSuperAdmin: boolean,
  pageSize: number = 20,
  cursor?: { ms: number } | null,
  filters?: CompletedShipmentFilters | null,
): Promise<{ shipments: Record<string, any>[]; nextCursor: { ms: number } | null; hasMore: boolean }> {
  if (!depotId) return { shipments: [], nextCursor: null, hasMore: false };
  const boundaryMs = cursor && Number.isFinite(cursor.ms) ? cursor.ms : Number.POSITIVE_INFINITY;

  const resolveDate = (v: Date | string | null | undefined): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };
  const fromDate = resolveDate(filters?.dateFrom ?? null);
  const toDate = resolveDate(filters?.dateTo ?? null);
  if (toDate) toDate.setHours(23, 59, 59, 999);
  const fromMs = fromDate ? fromDate.getTime() : 0;
  const toMs = toDate ? toDate.getTime() : Number.POSITIVE_INFINITY;

  const lab = (filters?.recipientHospital ?? '').trim();
  const term = (filters?.searchTerm ?? '').trim().toLocaleLowerCase('tr');

  const passesDate = (ms: number) =>
    (fromMs === 0 || ms >= fromMs) && (toMs === Number.POSITIVE_INFINITY || ms <= toMs);
  const passesSearch = (data: Record<string, any>) => {
    if (!term) return true;
    const hay = `${data.recipientHospital ?? ''} ${data.userName ?? ''}`.toLocaleLowerCase('tr');
    return hay.includes(term);
  };

  // Serbest-metin arama Firestore'da substring desteklemediği için TEK tarama
  // gerektiren filtredir. Lab (eşitlik) ve tarih (aralık) filtreleri gerçek
  // cursor sayfalamayla yapılabilir → her sayfada yalnızca pageSize kayıt çekilir
  // ve "tüm geçmiş" 1500'lük bir cap'e takılmaz.
  const needsScan = !!term;

  try {
    if (needsScan) {
      // Arama: eşitlik filtreleriyle (depotId + lab) sınırlı geniş pencere tara,
      // tarih/arama/cursor'ı bellekte uygula.
      let scanBase: FirebaseFirestore.Query = adminDb.collection('shipments').where('depotId', '==', depotId);
      if (lab) scanBase = scanBase.where('recipientHospital', '==', lab);
      const SCAN_CAP = 1500;
      let docs: FirebaseFirestore.QueryDocumentSnapshot[];
      try {
        docs = (await scanBase.orderBy('timestamp', 'desc').limit(SCAN_CAP).get()).docs as any;
      } catch {
        docs = (await scanBase.limit(SCAN_CAP).get()).docs as any;
      }
      const all = (docs as FirebaseFirestore.QueryDocumentSnapshot[])
        .map(d => ({ doc: d, ms: shipmentMillis(d.data()) }))
        .filter(c => passesDate(c.ms) && passesSearch(c.doc.data()))
        .sort((a, b) => b.ms - a.ms);
      const after = all.filter(c => c.ms < boundaryMs);
      const page = after.slice(0, pageSize);
      return {
        shipments: page.map(c => summarizeShipmentDoc(c.doc)),
        nextCursor: page.length ? { ms: page[page.length - 1].ms } : null,
        hasMore: after.length > pageSize,
      };
    }

    // Filtresiz VEYA yalnızca lab/tarih: gerçek cursor sayfalama.
    // base = depotId [+ recipientHospital==lab] [+ timestamp aralığı]
    let base: FirebaseFirestore.Query = adminDb.collection('shipments').where('depotId', '==', depotId);
    if (lab) base = base.where('recipientHospital', '==', lab);
    if (fromDate) base = base.where('timestamp', '>=', fromDate);
    if (toDate) base = base.where('timestamp', '<=', toDate);

    let pageDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    try {
      let q = base.orderBy('timestamp', 'desc');
      if (Number.isFinite(boundaryMs)) q = q.startAfter(new Date(boundaryMs));
      pageDocs = (await q.limit(pageSize + 1).get()).docs as any;
    } catch {
      // Bileşik indeks yoksa: yalnızca eşitlik filtreleriyle pencere çekip
      // tarih + cursor'ı bellekte uygula (range+orderBy indeksi gerektirmez).
      let eqBase: FirebaseFirestore.Query = adminDb.collection('shipments').where('depotId', '==', depotId);
      if (lab) eqBase = eqBase.where('recipientHospital', '==', lab);
      const all = ((await eqBase.limit(2000).get()).docs as FirebaseFirestore.QueryDocumentSnapshot[])
        .map(d => ({ doc: d, ms: shipmentMillis(d.data()) }))
        .filter(c => passesDate(c.ms) && c.ms < boundaryMs)
        .sort((a, b) => b.ms - a.ms);
      pageDocs = all.slice(0, pageSize + 1).map(c => c.doc);
    }

    const hasMore = pageDocs.length > pageSize;
    const page = pageDocs.slice(0, pageSize);
    const lastMs = page.length ? shipmentMillis(page[page.length - 1].data()) : null;
    return {
      shipments: page.map(d => summarizeShipmentDoc(d)),
      nextCursor: lastMs != null ? { ms: lastMs } : null,
      hasMore,
    };
  } catch (err) {
    console.error('getCompletedShipments error:', err);
    return { shipments: [], nextCursor: null, hasMore: false };
  }
}

/**
 * Bir deponun sevkiyat geçmişindeki ayrık laboratuvar (recipientHospital)
 * adlarını döndürür — Tamamlanan sekmesindeki laboratuvar seçici için.
 */
export async function getShipmentLabs(
  depotId: string,
  companyId: string | null | undefined,
  isSuperAdmin: boolean,
): Promise<string[]> {
  if (!depotId) return [];
  try {
    const snap = await adminDb
      .collection('shipments')
      .where('depotId', '==', depotId)
      .select('recipientHospital')
      .limit(5000)
      .get();
    const set = new Set<string>();
    snap.forEach(d => {
      const name = (d.data() as any)?.recipientHospital;
      if (name && typeof name === 'string') set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
  } catch (err) {
    console.error('getShipmentLabs error:', err);
    return [];
  }
}
