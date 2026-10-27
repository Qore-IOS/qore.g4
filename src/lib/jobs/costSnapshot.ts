import {workspaceIdentity} from '../workspace';
import type * as DocumentStore from '../data/admin';

/**
 * Anlık maliyet günlük snapshot işi.
 *
 * Her sabah 06:00 (Europe/Istanbul) çalışır; her firma için TÜM depo + lab
 * stoğunu (isShipped fark etmeksizin) birim maliyet × adet ile değerleyip TL'ye
 * çevirir ve `costSnapshots/{companyId}` dokümanına yazar. Dashboard "Anlık
 * Maliyet" kartı bu dokümanı okur.
 *
 * Ayrıca elle yeniden hesaplama için `recomputeCostSnapshot` callable'ı sunar.
 *
 * NOT: Buradaki maliyet matematiği src/lib/cost-snapshot.ts ile birebir aynıdır
 * (paketler ayrı olduğu için saf mantık kopyalanmıştır).
 */
import {adminDb,FieldValue,Timestamp} from '../data/admin';
import {resolveStorageBucket} from '@/lib/server/storage-bucket';
import { onSchedule } from '@/lib/jobs/runtime';
import { onCall, HttpsError } from '@/lib/jobs/runtime';
import { logger } from '@/lib/jobs/runtime';



const db = adminDb;

const LEGACY_COMPANY_ID = '__legacy__';
function normalizeCompanyId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  return s || LEGACY_COMPANY_ID;
}

type Currency = 'EUR' | 'USD' | 'TRY';
type Pools = Record<Currency, number>;
interface Rates { EUR: number; USD: number; TRY: number }

const emptyPools = (): Pools => ({ EUR: 0, USD: 0, TRY: 0 });
const normCur = (c: unknown): Currency => {
  const up = typeof c === 'string' ? c.toUpperCase() : 'TRY';
  return up === 'EUR' || up === 'USD' ? up : 'TRY';
};
const sumToTry = (p: Pools, r: Rates): number => {
  const eurToTry = r.TRY || 0;
  const usdToTry = r.USD > 0 ? (r.TRY || 0) / r.USD : 0;
  return p.TRY + p.EUR * eurToTry + p.USD * usdToTry;
};
function parseCost(data: any): { cost: number; currency: Currency } | null {
  const raw = data.cost ?? data.birimFiyat ?? data.unitPrice ?? data.price;
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!num || isNaN(num)) return null;
  return { cost: num, currency: normCur(data.currency) };
}
/** miad alanı string ('dd.MM.yyyy') ya da Timestamp/Date olabilir → 'dd.MM.yyyy'. */
function miadToStr(miad: unknown): string {
  if (typeof miad === 'string') return miad.trim();
  if (!miad || typeof miad !== 'object') return '';
  const anyM = miad as any;
  const d: Date | null = typeof anyM.toDate === 'function'
    ? anyM.toDate()
    : (typeof anyM.seconds === 'number' ? new Date(anyM.seconds * 1000) : (miad instanceof Date ? miad : null));
  if (!d || isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function miadDaysFrom(miad: string, now: Date): number | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((miad || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - now.getTime()) / 86400000);
}
function fmtDateKey(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** EUR-bazlı kurlar: Firestore exchangeRates/latest → Frankfurter → fallback. */
async function getRates(): Promise<Rates> {
  try {
    const d = await db.collection('exchangeRates').doc('latest').get();
    if (d.exists) {
      const r = d.data() as any;
      const USD = Number(r?.USD ?? r?.usd);
      const TRY = Number(r?.TRY ?? r?.try);
      if (USD > 0 && TRY > 0) return { EUR: 1, USD, TRY };
    }
  } catch (e) { logger.warn('[costSnapshot] rates firestore read failed', e as any); }
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD,TRY');
    if (res.ok) {
      const j: any = await res.json();
      const USD = Number(j?.rates?.USD);
      const TRY = Number(j?.rates?.TRY);
      if (USD > 0 && TRY > 0) return { EUR: 1, USD, TRY };
    }
  } catch (e) { logger.warn('[costSnapshot] rates fetch failed', e as any); }
  return { EUR: 1, USD: 1.08, TRY: 38.5 };
}

interface ProductRow { stokKodu: string; stokAdi: string; brand: string; urunGrubu: string; quantity: number; nativeTotals: Pools; tryTotal: number }
interface LocationRow { id: string; name: string; type: 'depo' | 'lab'; quantity: number; nativeTotals: Pools; tryTotal: number; products: ProductRow[] }

/** Bir firmanın snapshot'ını hesaplar ve costSnapshots/{companyId}'ye yazar. */
async function computeCompany(companyId: string, rates: Rates, now: Date): Promise<{ totalTRY: number; itemCount: number }> {
  const cid = normalizeCompanyId(companyId);

  // Şirket etiketli + '__legacy__' + etiketsiz eski kayıtları birlikte topla:
  // yalnızca companyId eşitliğiyle okumak etiketsiz depoStok kayıtlarını eler ve
  // toplam maliyeti olduğundan düşük gösterirdi.
  const scopedDocs = async (path: string) => {
    const [own, legacy] = await Promise.all([
      db.collection(path).where('companyId', '==', cid).get(),
      db.collection(path).where('companyId', '==', LEGACY_COMPANY_ID).get(),
    ]);
    const byId = new Map<string, DocumentStore.QueryDocumentSnapshot>();
    own.docs.forEach((d) => byId.set(d.id, d));
    legacy.docs.forEach((d) => { if (!byId.has(d.id)) byId.set(d.id, d); });
    try {
      const all = await db.collection(path).get();
      all.docs.forEach((d) => {
        const tag = String(d.data()?.companyId ?? '').trim();
        if (!tag && !byId.has(d.id)) byId.set(d.id, d); // etiketsiz eski kayıt
      });
    } catch { /* okunamazsa etiketli sonuçlar geçerli kalır */ }
    return Array.from(byId.values());
  };

  const [prodSnap, stockSnap, depotSnap, hospSnap] = await Promise.all([
    scopedDocs('productCodes'),
    scopedDocs('depoStok'),
    scopedDocs('depots'),
    scopedDocs('hospitals'),
  ]);

  const costMap = new Map<string, { cost: number; currency: Currency; brand: string; stokAdi: string; urunGrubu: string }>();
  prodSnap.forEach((d) => {
    const data = d.data();
    const parsed = parseCost(data);
    if (!parsed || !data.stokKodu) return;
    costMap.set(String(data.stokKodu), {
      cost: parsed.cost, currency: parsed.currency,
      brand: String(data.marka || 'Markasız'),
      stokAdi: String(data.stokAdi || data.stokKodu),
      urunGrubu: String(data.urunGrubu || ''),
    });
  });

  const depotNames = new Map<string, string>();
  depotSnap.forEach((d) => depotNames.set(d.id, String(d.data()?.name || d.id)));
  const hospitalNames = new Map<string, string>();
  hospSnap.forEach((d) => hospitalNames.set(d.id, String(d.data()?.name || d.id)));

  // min/max kuralları — hem depolar hem laboratuvarlar (saha geneli riskli stok)
  const minMaxRules = new Map<string, { max: number; maxGun: number }>();
  await Promise.all([...depotSnap, ...hospSnap].map(async (loc) => {
    try {
      const rs = await loc.ref.collection('minMaxRules').get();
      rs.docs.forEach((r) => {
        const rule = r.data();
        if (rule.stokKodu && rule.max && rule.maxGun) minMaxRules.set(`${loc.id}__${rule.stokKodu}`, { max: rule.max, maxGun: rule.maxGun });
      });
    } catch { /* ignore */ }
  }));

  const totalPools = emptyPools();
  const depotAcc = new Map<string, LocationRow>();
  const labAcc = new Map<string, LocationRow>();
  const activeItems: Array<{ stokKodu: string; lot: string; miad: string; locationId: string; qty: number }> = [];
  const groupedByLocationProduct = new Map<string, number>();
  let itemCount = 0;

  stockSnap.forEach((d) => {
    const data = d.data();
    const stokKodu = String(data.stokKodu || '');
    const qty = Number(data.quantity ?? 1) || 1;
    itemCount += qty;
    const pc = costMap.get(stokKodu);
    if (pc) {
      totalPools[pc.currency] += pc.cost * qty;
      const isLab = data.isShipped === true;
      const bucket = isLab ? labAcc : depotAcc;
      const locId = isLab
        ? String(data.hedefKurumId || data.labId || data.hedefKurum || 'bilinmeyen-lab')
        : String(data.depotId || 'bilinmeyen-depo');
      const locName = isLab
        ? (hospitalNames.get(locId) || String(data.hedefKurum || data.labName || 'Bilinmeyen Lab'))
        : (depotNames.get(locId) || String(data.depotName || 'Bilinmeyen Depo'));
      let loc = bucket.get(locId);
      if (!loc) { loc = { id: locId, name: locName, type: isLab ? 'lab' : 'depo', quantity: 0, nativeTotals: emptyPools(), tryTotal: 0, products: [] }; bucket.set(locId, loc); }
      loc.quantity += qty;
      loc.nativeTotals[pc.currency] += pc.cost * qty;
      let prod = loc.products.find((p) => p.stokKodu === stokKodu);
      if (!prod) { prod = { stokKodu, stokAdi: pc.stokAdi, brand: pc.brand, urunGrubu: pc.urunGrubu, quantity: 0, nativeTotals: emptyPools(), tryTotal: 0 }; loc.products.push(prod); }
      prod.quantity += qty;
      prod.nativeTotals[pc.currency] += pc.cost * qty;
    }
    {
      // riskli stok tüm sahada: depo için depotId, lab için hedefKurumId/labId
      const isLabItem = data.isShipped === true;
      const locationId = String(isLabItem ? (data.hedefKurumId || data.labId || '') : (data.depotId || ''));
      if (locationId) {
        activeItems.push({ stokKodu, lot: String(data.lotNumarasi || ''), miad: miadToStr(data.miad), locationId, qty });
        const gKey = `${locationId}__${stokKodu}`;
        groupedByLocationProduct.set(gKey, (groupedByLocationProduct.get(gKey) || 0) + qty);
      }
    }
  });

  const finalize = (loc: LocationRow): LocationRow => ({
    ...loc,
    tryTotal: sumToTry(loc.nativeTotals, rates),
    products: loc.products.map((p) => ({ ...p, tryTotal: sumToTry(p.nativeTotals, rates) })).sort((a, b) => b.tryTotal - a.tryTotal),
  });
  const byDepot = Array.from(depotAcc.values()).map(finalize).sort((a, b) => b.tryTotal - a.tryTotal);
  const byLab = Array.from(labAcc.values()).map(finalize).sort((a, b) => b.tryTotal - a.tryTotal);

  // riskli stok
  const lotGroups = new Map<string, { stokKodu: string; locationId: string; miad: string; qty: number }>();
  activeItems.forEach((it) => {
    const key = `${it.locationId}__${it.stokKodu}__${it.lot}__${it.miad}`;
    const ex = lotGroups.get(key);
    if (ex) ex.qty += it.qty;
    else lotGroups.set(key, { stokKodu: it.stokKodu, locationId: it.locationId, miad: it.miad, qty: it.qty });
  });
  const riskyPools = emptyPools();
  lotGroups.forEach((g) => {
    const rule = minMaxRules.get(`${g.locationId}__${g.stokKodu}`);
    if (!rule || !rule.max || !rule.maxGun) return;
    const miadDays = miadDaysFrom(g.miad, now);
    if (miadDays === null || miadDays <= 0) return;
    const periodDays = Math.floor(rule.maxGun);
    if (periodDays <= 0) return;
    const dailyNeed = rule.max / periodDays;
    if (dailyNeed <= 0) return;
    const totalStock = groupedByLocationProduct.get(`${g.locationId}__${g.stokKodu}`) || g.qty;
    const coverageDays = Math.floor(totalStock / dailyNeed);
    if (coverageDays <= miadDays) return;
    const riskyBoxes = Math.min(Math.max(0, Math.ceil((coverageDays - miadDays) * dailyNeed)), g.qty);
    const pc = costMap.get(g.stokKodu);
    if (!pc) return;
    riskyPools[pc.currency] += riskyBoxes * pc.cost;
  });

  const totalTRY = sumToTry(totalPools, rates);
  const snapshot = {
    schemaVersion: 2,
    source: 'scheduled' as const,
    companyId: cid,
    computedAt: now.toISOString(),
    forDate: fmtDateKey(now),
    rates,
    totalTRY,
    pools: totalPools,
    riskyTRY: sumToTry(riskyPools, rates),
    itemCount,
    byDepot,
    byLab,
    updatedAt: Timestamp.now(),
  };

  await db.collection('costSnapshots').doc(cid).set(snapshot);
  return { totalTRY, itemCount };
}

/** Tüm firmaları companyStats + users'tan toplar. */
async function listCompanyIds(): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const statsSnap = await db.collection('companyStats').get();
    statsSnap.docs.forEach((d) => ids.add(normalizeCompanyId(d.id)));
  } catch (e) { logger.warn('[costSnapshot] companyStats list failed', e as any); }
  try {
    const usersSnap = await db.collection('users').select('companyId').get();
    usersSnap.docs.forEach((d) => ids.add(normalizeCompanyId(d.data()?.companyId)));
  } catch (e) { logger.warn('[costSnapshot] users list failed', e as any); }
  return Array.from(ids);
}

export const dailyCostSnapshot = onSchedule(
  {
    schedule: 'every day 06:00',
    timeZone: 'Europe/Istanbul',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async () => {
    const now = new Date();
    const rates = await getRates();
    const companies = await listCompanyIds();
    logger.info('[costSnapshot] starting daily cost snapshot', { companies: companies.length, rates });
    let ok = 0, fail = 0;
    for (const cid of companies) {
      try {
        const res = await computeCompany(cid, rates, now);
        ok++;
        logger.info('[costSnapshot] company done', { cid, totalTRY: Math.round(res.totalTRY), itemCount: res.itemCount });
      } catch (e) {
        fail++;
        logger.error('[costSnapshot] company failed', { cid, error: (e as any)?.message });
      }
    }
    logger.info('[costSnapshot] daily cost snapshot complete', { ok, fail });
  },
);

/** Elle yeniden hesapla (dashboard "Yeniden hesapla" alternatifi / admin). */
export const recomputeCostSnapshot = onCall(
  { region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    const token = workspaceIdentity;
    const isSuper = token.role === 'super_admin';
    const requested = normalizeCompanyId(request.data?.companyId ?? token.companyId);
    if (!isSuper && requested !== normalizeCompanyId(token.companyId)) {
      throw new HttpsError('permission-denied', 'Bu firma için yetkiniz yok.');
    }
    const rates = await getRates();
    const res = await computeCompany(requested, rates, new Date());
    return { ok: true, companyId: requested, totalTRY: res.totalTRY, itemCount: res.itemCount };
  },
);
