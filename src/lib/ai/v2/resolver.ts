/**
 * Entity resolver v2 — multi-strategy fuzzy matching.
 *
 * Goal: never return wrong matches confidently. The previous version returned
 * unrelated labs / products when only a short abbreviation was given.
 *
 * Strategy stack (per candidate):
 *  1. Normalized exact         → 1.00
 *  2. Acronym/initials match   → 0.96 (zkm → "Zeynep Kamil Mehmet")
 *  3. Tokenized substring      → 0.88 (most query tokens are in target name)
 *  4. Levenshtein on best tok  → 0.55–0.85 (cobas → cobas)
 *  5. Alias/test-name match    → 0.85 (tsh → "TSH ELECSYS 300")
 *  6. Numeric model match      → 0.92 (501 → any device/product with 501 token)
 *
 * Only candidates >= 0.55 are returned. Top-N is configurable.
 */

import { adminDb } from '@/lib/firebase-admin';
import { aiLogger } from '@/lib/logger';
import type { PermissionContext, ResolvedDevice, ResolvedHospital, ResolvedProduct } from './types';
import { canSeeBrand, canSeeLab } from './permissions';

/* ----------------------------------------------------------------------- */
/*  TEXT NORMALISATION                                                     */
/* ----------------------------------------------------------------------- */

const TR_MAP: Record<string, string> = {
  'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g',
  'ı': 'i', 'I': 'i', 'İ': 'i',
  'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u',
};

export function normalise(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .split('')
    .map((c) => TR_MAP[c] ?? c)
    .join('')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalise(text).split(' ').filter((t) => t.length > 0);
}

const STOPWORDS = new Set([
  've', 'ile', 'icin', 'de', 'da', 'mi', 'mu', 'mı', 'mü', 'bir',
  'hastane', 'hastanesi', 'hastanasi', 'hast', 'lab', 'laboratuvar',
  'laboratuvari', 'merkezi', 'medikal',
]);

function meaningfulTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function acronymOf(target: string): string {
  return tokenize(target)
    .filter((t) => !STOPWORDS.has(t))
    .map((t) => t[0])
    .join('');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m: number[][] = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
    }
  }
  return m[b.length][a.length];
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/* ----------------------------------------------------------------------- */
/*  SCORING                                                                */
/* ----------------------------------------------------------------------- */

interface Candidate {
  score: number;
  reason: string;
}

/**
 * Score how well `query` matches `target` (a single name). Returns 0 if no
 * meaningful match.
 */
function scoreText(query: string, target: string, opts: { extraAliases?: string[] } = {}): Candidate {
  if (!query || !target) return { score: 0, reason: 'empty' };

  const nq = normalise(query);
  const nt = normalise(target);
  if (!nq || !nt) return { score: 0, reason: 'empty' };

  // 1. exact
  if (nq === nt) return { score: 1.0, reason: 'tam eşleşme' };

  // 2. acronym
  const acr = acronymOf(target);
  const qTokens = meaningfulTokens(query);
  if (qTokens.length === 1 && qTokens[0].length >= 2 && qTokens[0].length <= 5) {
    if (acr === qTokens[0]) return { score: 0.96, reason: `baş harfler eşleşti (${acr})` };
    // also handle partial acronyms like "zk" → first two of "zeynep kamil"
    if (acr.startsWith(qTokens[0])) return { score: 0.9, reason: `kısaltma (${acr})` };
  }

  // 3. all-query-tokens-in-target
  const qMeaning = meaningfulTokens(query);
  const tTokens = tokenize(target);
  if (qMeaning.length > 0) {
    const hits = qMeaning.filter((q) => tTokens.some((t) => t.includes(q) || q.includes(t)));
    const hitRatio = hits.length / qMeaning.length;
    if (hitRatio === 1 && qMeaning.length >= 2) return { score: 0.92, reason: 'tüm kelimeler bulundu' };
    if (hitRatio === 1) return { score: 0.84, reason: 'kelime bulundu' };
    if (hitRatio >= 0.6) return { score: 0.7 + hitRatio * 0.15, reason: `${hits.length}/${qMeaning.length} kelime` };
  }

  // 4. fuzzy on the closest token pair
  let bestTok = 0;
  for (const q of qMeaning.length ? qMeaning : [nq]) {
    for (const t of tTokens) {
      if (Math.abs(q.length - t.length) > 4) continue;
      const sim = similarity(q, t);
      if (sim > bestTok) bestTok = sim;
    }
  }
  if (bestTok >= 0.85) return { score: 0.78, reason: 'benzer yazım' };
  if (bestTok >= 0.7) return { score: 0.6, reason: 'yakın yazım' };

  // 5. extra aliases
  for (const alias of opts.extraAliases ?? []) {
    const na = normalise(alias);
    if (!na) continue;
    if (na === nq) return { score: 0.96, reason: `alias: ${alias}` };
    if (na.includes(nq) || nq.includes(na)) return { score: 0.85, reason: `alias: ${alias}` };
  }

  // 6. numeric model match (e.g. "501" → "Cobas 501")
  const numMatch = nq.match(/^\d{2,4}$/);
  if (numMatch) {
    if (tTokens.includes(nq)) return { score: 0.93, reason: `model no eşleşti (${nq})` };
  }

  return { score: 0, reason: 'eşleşme yok' };
}

/* ----------------------------------------------------------------------- */
/*  CACHING                                                                */
/* ----------------------------------------------------------------------- */

interface HospitalRecord {
  id: string;
  name: string;
  kod?: string;
  aliases: string[];
  companyId?: string;
}

interface ProductRecord {
  stokKodu: string;
  stokAdi: string;
  testAdi?: string;
  marka?: string;
  cihazGrubu?: string;
  urunGrubu?: string;
  ambalajDegeri?: number;
  aliases: string[];
}

interface DeviceRecord {
  id: string;
  brand?: string;
  model: string;
  serial?: string;
  hospitalId?: string;
  hospitalName?: string;
  testDistribution?: Record<string, number>;
  aliases: string[];
}

interface Caches {
  hospitals: HospitalRecord[];
  products: ProductRecord[];
  devices: DeviceRecord[];
  loadedAt: number;
}

let cache: Caches | null = null;
let cachePromise: Promise<Caches> | null = null;
const CACHE_TTL_MS = 90 * 1000; // 90s — short enough to feel real-time

/**
 * Common product alias map. We do NOT use this as the primary signal — it just
 * adds a small extra alias bank so abbreviations still resolve when product
 * names in Firestore don't include the abbreviation.
 */
const PRODUCT_ALIAS_HINTS: Record<string, string[]> = {
  tsh: ['tsh', 'tiroid'],
  ft3: ['ft3', 'serbest t3'],
  ft4: ['ft4', 'serbest t4'],
  crp: ['crp', 'c reaktif protein'],
  pct: ['pct', 'prokalsitonin'],
  hba1c: ['hba1c', 'a1c'],
  troponin: ['troponin', 'trop t'],
  ddimer: ['d dimer', 'd-dimer'],
  psa: ['psa'],
  cea: ['cea'],
  afp: ['afp'],
  ca125: ['ca125', 'ca 125'],
  ca199: ['ca19 9', 'ca199'],
  glukoz: ['glukoz', 'glucose', 'kan sekeri'],
  kreatinin: ['kreatinin', 'creatinine'],
  hbsag: ['hbsag', 'hepatit b'],
  antihcv: ['anti hcv', 'hcv'],
  inr: ['inr', 'pt', 'protrombin'],
  aptt: ['aptt', 'ptt'],
  potasyum: ['potasyum', 'k+'],
  sodyum: ['sodyum', 'na+'],
  kalsiyum: ['kalsiyum', 'ca'],
};

async function loadCaches(): Promise<Caches> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    const [hospitalsSnap, productsSnap, devicesSnap] = await Promise.allSettled([
      adminDb.collection('hospitals').get(),
      adminDb.collection('productCodes').limit(5000).get(),
      adminDb.collection('devices').limit(2000).get(),
    ]);

    const hospitals: HospitalRecord[] = [];
    if (hospitalsSnap.status === 'fulfilled') {
      for (const doc of hospitalsSnap.value.docs) {
        const d = doc.data();
        const name = d.name || d.ad || '';
        if (!name) continue;
        hospitals.push({
          id: doc.id,
          name,
          kod: d.kod ?? undefined,
          companyId: d.companyId,
          aliases: [name, d.kod, d.ad].filter(Boolean) as string[],
        });
      }
    } else {
      aiLogger.warn('hospital cache load failed', hospitalsSnap.reason);
    }

    const products: ProductRecord[] = [];
    if (productsSnap.status === 'fulfilled') {
      for (const doc of productsSnap.value.docs) {
        const d = doc.data();
        const stokKodu = d.stokKodu || doc.id;
        const stokAdi = d.stokAdi || '';
        if (!stokKodu && !stokAdi) continue;
        const aliases: string[] = [stokKodu, stokAdi, d.testAdi, d.marka, d.cihazGrubu].filter(Boolean) as string[];
        // attach hint aliases based on normalized test/product name
        const normTest = normalise(d.testAdi || stokAdi);
        for (const [hint, alts] of Object.entries(PRODUCT_ALIAS_HINTS)) {
          if (normTest.includes(hint)) aliases.push(...alts);
        }
        products.push({
          stokKodu,
          stokAdi,
          testAdi: d.testAdi,
          marka: d.marka,
          cihazGrubu: d.cihazGrubu,
          urunGrubu: d.urunGrubu,
          ambalajDegeri: typeof d.ambalajDegeri === 'number' ? d.ambalajDegeri : undefined,
          aliases,
        });
      }
    } else {
      aiLogger.warn('product cache load failed', productsSnap.reason);
    }

    const devices: DeviceRecord[] = [];
    if (devicesSnap.status === 'fulfilled') {
      for (const doc of devicesSnap.value.docs) {
        const d = doc.data();
        const model = d.model || '';
        if (!model) continue;
        devices.push({
          id: doc.id,
          brand: d.brand || d.marka,
          model,
          serial: d.seriNumarasi || d.serial,
          hospitalId: d.hospitalId || d.labId,
          hospitalName: d.hospitalName || d.labName,
          testDistribution: d.testDagilimi || d.testDistribution,
          aliases: [model, d.brand, d.marka, d.seriNumarasi, d.serial].filter(Boolean) as string[],
        });
      }
    } else {
      aiLogger.warn('device cache load failed', devicesSnap.reason);
    }

    cache = { hospitals, products, devices, loadedAt: Date.now() };
    return cache;
  })();

  try {
    const result = await cachePromise;
    return result;
  } finally {
    cachePromise = null;
  }
}

/** Force a cache refresh (used after writes). */
export function invalidateResolverCache(): void {
  cache = null;
}

/* ----------------------------------------------------------------------- */
/*  PUBLIC API                                                             */
/* ----------------------------------------------------------------------- */

export interface ResolveOptions {
  limit?: number;
  minConfidence?: number;
}

export async function resolveHospitals(
  query: string,
  ctx: PermissionContext,
  opts: ResolveOptions = {},
): Promise<ResolvedHospital[]> {
  const { hospitals } = await loadCaches();
  const limit = opts.limit ?? 5;
  const minConf = opts.minConfidence ?? 0.55;

  const scored: ResolvedHospital[] = [];
  for (const h of hospitals) {
    if (ctx.companyId && h.companyId && h.companyId !== ctx.companyId && !ctx.isSuperAdmin) continue;
    if (!canSeeLab(ctx, h.id)) continue;

    let best: Candidate = { score: 0, reason: '' };
    for (const candidate of [h.name, h.kod, ...h.aliases].filter(Boolean) as string[]) {
      const s = scoreText(query, candidate, { extraAliases: h.aliases });
      if (s.score > best.score) best = s;
    }
    if (best.score >= minConf) {
      scored.push({
        id: h.id,
        name: h.name,
        kod: h.kod,
        confidence: round(best.score),
        reason: best.reason,
      });
    }
  }
  return scored.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

export async function resolveProducts(
  query: string,
  ctx: PermissionContext,
  opts: ResolveOptions = {},
): Promise<ResolvedProduct[]> {
  const { products } = await loadCaches();
  const limit = opts.limit ?? 8;
  const minConf = opts.minConfidence ?? 0.55;

  const scored: ResolvedProduct[] = [];
  for (const p of products) {
    if (!canSeeBrand(ctx, p.marka)) continue;
    let best: Candidate = { score: 0, reason: '' };
    const candidates: string[] = [p.stokKodu, p.stokAdi, p.testAdi, p.marka, p.cihazGrubu]
      .filter(Boolean) as string[];
    for (const c of candidates) {
      const s = scoreText(query, c, { extraAliases: p.aliases });
      if (s.score > best.score) best = s;
    }
    if (best.score >= minConf) {
      scored.push({
        stokKodu: p.stokKodu,
        stokAdi: p.stokAdi,
        marka: p.marka,
        urunGrubu: p.urunGrubu,
        testAdi: p.testAdi,
        cihazGrubu: p.cihazGrubu,
        ambalajDegeri: p.ambalajDegeri,
        confidence: round(best.score),
        reason: best.reason,
      });
    }
  }
  return scored.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

export async function resolveDevices(
  query: string,
  ctx: PermissionContext,
  opts: ResolveOptions = {},
): Promise<ResolvedDevice[]> {
  const { devices } = await loadCaches();
  const limit = opts.limit ?? 8;
  const minConf = opts.minConfidence ?? 0.55;

  const scored: ResolvedDevice[] = [];
  for (const d of devices) {
    if (d.hospitalId && !canSeeLab(ctx, d.hospitalId)) continue;
    if (!canSeeBrand(ctx, d.brand)) continue;
    let best: Candidate = { score: 0, reason: '' };
    const candidates: string[] = [d.model, d.brand, d.serial, d.hospitalName]
      .filter(Boolean) as string[];
    for (const c of candidates) {
      const s = scoreText(query, c, { extraAliases: d.aliases });
      if (s.score > best.score) best = s;
    }
    if (best.score >= minConf) {
      scored.push({
        id: d.id,
        brand: d.brand,
        model: d.model,
        serial: d.serial,
        hospitalId: d.hospitalId,
        hospitalName: d.hospitalName,
        confidence: round(best.score),
        reason: best.reason,
      });
    }
  }
  return scored.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Quick getters that don't need full resolution (used by tool handlers). */
export async function getHospitalById(id: string): Promise<HospitalRecord | null> {
  const { hospitals } = await loadCaches();
  return hospitals.find((h) => h.id === id) ?? null;
}

export async function getProductByCode(stokKodu: string): Promise<ProductRecord | null> {
  const { products } = await loadCaches();
  return products.find((p) => p.stokKodu === stokKodu) ?? null;
}

export async function getDeviceById(id: string): Promise<DeviceRecord | null> {
  const { devices } = await loadCaches();
  return devices.find((d) => d.id === id) ?? null;
}

export async function listHospitalsForContext(ctx: PermissionContext): Promise<HospitalRecord[]> {
  const { hospitals } = await loadCaches();
  return hospitals.filter((h) => {
    if (ctx.companyId && h.companyId && h.companyId !== ctx.companyId && !ctx.isSuperAdmin) return false;
    return canSeeLab(ctx, h.id);
  });
}
