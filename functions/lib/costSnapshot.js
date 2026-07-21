'use server';
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recomputeCostSnapshot = exports.dailyCostSnapshot = void 0;
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
const admin = __importStar(require("firebase-admin"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const node_fetch_1 = __importDefault(require("node-fetch"));
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
const LEGACY_COMPANY_ID = '__legacy__';
function normalizeCompanyId(raw) {
    const s = String(raw !== null && raw !== void 0 ? raw : '').trim();
    return s || LEGACY_COMPANY_ID;
}
const emptyPools = () => ({ EUR: 0, USD: 0, TRY: 0 });
const normCur = (c) => {
    const up = typeof c === 'string' ? c.toUpperCase() : 'TRY';
    return up === 'EUR' || up === 'USD' ? up : 'TRY';
};
const sumToTry = (p, r) => {
    const eurToTry = r.TRY || 0;
    const usdToTry = r.USD > 0 ? (r.TRY || 0) / r.USD : 0;
    return p.TRY + p.EUR * eurToTry + p.USD * usdToTry;
};
function parseCost(data) {
    var _a, _b, _c;
    const raw = (_c = (_b = (_a = data.cost) !== null && _a !== void 0 ? _a : data.birimFiyat) !== null && _b !== void 0 ? _b : data.unitPrice) !== null && _c !== void 0 ? _c : data.price;
    const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (!num || isNaN(num))
        return null;
    return { cost: num, currency: normCur(data.currency) };
}
function miadDaysFrom(miad, now) {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((miad || '').trim());
    if (!m)
        return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (isNaN(d.getTime()))
        return null;
    return Math.floor((d.getTime() - now.getTime()) / 86400000);
}
function fmtDateKey(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
}
/** EUR-bazlı kurlar: Firestore exchangeRates/latest → Frankfurter → fallback. */
async function getRates() {
    var _a, _b, _c, _d;
    try {
        const d = await db.collection('exchangeRates').doc('latest').get();
        if (d.exists) {
            const r = d.data();
            const USD = Number((_a = r === null || r === void 0 ? void 0 : r.USD) !== null && _a !== void 0 ? _a : r === null || r === void 0 ? void 0 : r.usd);
            const TRY = Number((_b = r === null || r === void 0 ? void 0 : r.TRY) !== null && _b !== void 0 ? _b : r === null || r === void 0 ? void 0 : r.try);
            if (USD > 0 && TRY > 0)
                return { EUR: 1, USD, TRY };
        }
    }
    catch (e) {
        firebase_functions_1.logger.warn('[costSnapshot] rates firestore read failed', e);
    }
    try {
        const res = await (0, node_fetch_1.default)('https://api.frankfurter.app/latest?from=EUR&to=USD,TRY');
        if (res.ok) {
            const j = await res.json();
            const USD = Number((_c = j === null || j === void 0 ? void 0 : j.rates) === null || _c === void 0 ? void 0 : _c.USD);
            const TRY = Number((_d = j === null || j === void 0 ? void 0 : j.rates) === null || _d === void 0 ? void 0 : _d.TRY);
            if (USD > 0 && TRY > 0)
                return { EUR: 1, USD, TRY };
        }
    }
    catch (e) {
        firebase_functions_1.logger.warn('[costSnapshot] rates fetch failed', e);
    }
    return { EUR: 1, USD: 1.08, TRY: 38.5 };
}
/** Bir firmanın snapshot'ını hesaplar ve costSnapshots/{companyId}'ye yazar. */
async function computeCompany(companyId, rates, now) {
    const cid = normalizeCompanyId(companyId);
    const [prodSnap, stockSnap, depotSnap, hospSnap] = await Promise.all([
        db.collection('productCodes').where('companyId', '==', cid).get(),
        db.collection('depoStok').where('companyId', '==', cid).get(),
        db.collection('depots').where('companyId', '==', cid).get(),
        db.collection('hospitals').where('companyId', '==', cid).get(),
    ]);
    const costMap = new Map();
    prodSnap.docs.forEach((d) => {
        const data = d.data();
        const parsed = parseCost(data);
        if (!parsed || !data.stokKodu)
            return;
        costMap.set(String(data.stokKodu), {
            cost: parsed.cost, currency: parsed.currency,
            brand: String(data.marka || 'Markasız'),
            stokAdi: String(data.stokAdi || data.stokKodu),
            urunGrubu: String(data.urunGrubu || ''),
        });
    });
    const depotNames = new Map();
    depotSnap.docs.forEach((d) => { var _a; return depotNames.set(d.id, String(((_a = d.data()) === null || _a === void 0 ? void 0 : _a.name) || d.id)); });
    const hospitalNames = new Map();
    hospSnap.docs.forEach((d) => { var _a; return hospitalNames.set(d.id, String(((_a = d.data()) === null || _a === void 0 ? void 0 : _a.name) || d.id)); });
    // depo bazlı minMaxRules (riskli hesabı)
    const minMaxRules = new Map();
    await Promise.all(depotSnap.docs.map(async (dep) => {
        try {
            const rs = await dep.ref.collection('minMaxRules').get();
            rs.docs.forEach((r) => {
                const rule = r.data();
                if (rule.stokKodu && rule.max && rule.maxGun)
                    minMaxRules.set(`${dep.id}__${rule.stokKodu}`, { max: rule.max, maxGun: rule.maxGun });
            });
        }
        catch ( /* ignore */_a) { /* ignore */ }
    }));
    const totalPools = emptyPools();
    const depotAcc = new Map();
    const labAcc = new Map();
    const activeItems = [];
    const groupedByDepotProduct = new Map();
    let itemCount = 0;
    stockSnap.docs.forEach((d) => {
        var _a;
        const data = d.data();
        const stokKodu = String(data.stokKodu || '');
        const qty = Number((_a = data.quantity) !== null && _a !== void 0 ? _a : 1) || 1;
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
            if (!loc) {
                loc = { id: locId, name: locName, type: isLab ? 'lab' : 'depo', quantity: 0, nativeTotals: emptyPools(), tryTotal: 0, products: [] };
                bucket.set(locId, loc);
            }
            loc.quantity += qty;
            loc.nativeTotals[pc.currency] += pc.cost * qty;
            let prod = loc.products.find((p) => p.stokKodu === stokKodu);
            if (!prod) {
                prod = { stokKodu, stokAdi: pc.stokAdi, brand: pc.brand, urunGrubu: pc.urunGrubu, quantity: 0, nativeTotals: emptyPools(), tryTotal: 0 };
                loc.products.push(prod);
            }
            prod.quantity += qty;
            prod.nativeTotals[pc.currency] += pc.cost * qty;
        }
        if (data.isShipped !== true) {
            const depotId = String(data.depotId || '');
            activeItems.push({ stokKodu, lot: String(data.lotNumarasi || ''), miad: typeof data.miad === 'string' ? data.miad : '', depotId, qty });
            const gKey = `${depotId}__${stokKodu}`;
            groupedByDepotProduct.set(gKey, (groupedByDepotProduct.get(gKey) || 0) + qty);
        }
    });
    const finalize = (loc) => (Object.assign(Object.assign({}, loc), { tryTotal: sumToTry(loc.nativeTotals, rates), products: loc.products.map((p) => (Object.assign(Object.assign({}, p), { tryTotal: sumToTry(p.nativeTotals, rates) }))).sort((a, b) => b.tryTotal - a.tryTotal) }));
    const byDepot = Array.from(depotAcc.values()).map(finalize).sort((a, b) => b.tryTotal - a.tryTotal);
    const byLab = Array.from(labAcc.values()).map(finalize).sort((a, b) => b.tryTotal - a.tryTotal);
    // riskli stok
    const lotGroups = new Map();
    activeItems.forEach((it) => {
        const key = `${it.depotId}__${it.stokKodu}__${it.lot}__${it.miad}`;
        const ex = lotGroups.get(key);
        if (ex)
            ex.qty += it.qty;
        else
            lotGroups.set(key, { stokKodu: it.stokKodu, depotId: it.depotId, miad: it.miad, qty: it.qty });
    });
    const riskyPools = emptyPools();
    lotGroups.forEach((g) => {
        const rule = minMaxRules.get(`${g.depotId}__${g.stokKodu}`);
        if (!rule || !rule.max || !rule.maxGun)
            return;
        const miadDays = miadDaysFrom(g.miad, now);
        if (miadDays === null || miadDays <= 0)
            return;
        const periodDays = Math.floor(rule.maxGun);
        if (periodDays <= 0)
            return;
        const dailyNeed = rule.max / periodDays;
        if (dailyNeed <= 0)
            return;
        const totalStock = groupedByDepotProduct.get(`${g.depotId}__${g.stokKodu}`) || g.qty;
        const coverageDays = Math.floor(totalStock / dailyNeed);
        if (coverageDays <= miadDays)
            return;
        const riskyBoxes = Math.min(Math.max(0, Math.ceil((coverageDays - miadDays) * dailyNeed)), g.qty);
        const pc = costMap.get(g.stokKodu);
        if (!pc)
            return;
        riskyPools[pc.currency] += riskyBoxes * pc.cost;
    });
    const totalTRY = sumToTry(totalPools, rates);
    const snapshot = {
        schemaVersion: 2,
        source: 'scheduled',
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
        updatedAt: admin.firestore.Timestamp.now(),
    };
    await db.collection('costSnapshots').doc(cid).set(snapshot);
    return { totalTRY, itemCount };
}
/** Tüm firmaları companyStats + users'tan toplar. */
async function listCompanyIds() {
    const ids = new Set();
    try {
        const statsSnap = await db.collection('companyStats').get();
        statsSnap.docs.forEach((d) => ids.add(normalizeCompanyId(d.id)));
    }
    catch (e) {
        firebase_functions_1.logger.warn('[costSnapshot] companyStats list failed', e);
    }
    try {
        const usersSnap = await db.collection('users').select('companyId').get();
        usersSnap.docs.forEach((d) => { var _a; return ids.add(normalizeCompanyId((_a = d.data()) === null || _a === void 0 ? void 0 : _a.companyId)); });
    }
    catch (e) {
        firebase_functions_1.logger.warn('[costSnapshot] users list failed', e);
    }
    return Array.from(ids);
}
exports.dailyCostSnapshot = (0, scheduler_1.onSchedule)({
    schedule: 'every day 06:00',
    timeZone: 'Europe/Istanbul',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
}, async () => {
    const now = new Date();
    const rates = await getRates();
    const companies = await listCompanyIds();
    firebase_functions_1.logger.info('[costSnapshot] starting daily cost snapshot', { companies: companies.length, rates });
    let ok = 0, fail = 0;
    for (const cid of companies) {
        try {
            const res = await computeCompany(cid, rates, now);
            ok++;
            firebase_functions_1.logger.info('[costSnapshot] company done', { cid, totalTRY: Math.round(res.totalTRY), itemCount: res.itemCount });
        }
        catch (e) {
            fail++;
            firebase_functions_1.logger.error('[costSnapshot] company failed', { cid, error: e === null || e === void 0 ? void 0 : e.message });
        }
    }
    firebase_functions_1.logger.info('[costSnapshot] daily cost snapshot complete', { ok, fail });
});
/** Elle yeniden hesapla (dashboard "Yeniden hesapla" alternatifi / admin). */
exports.recomputeCostSnapshot = (0, https_1.onCall)({ region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
    var _a, _b, _c;
    const token = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.token;
    if (!token)
        throw new https_1.HttpsError('unauthenticated', 'Giriş gerekli.');
    const isSuper = token.isSuperAdmin === true || token.role === 'super_admin';
    const requested = normalizeCompanyId((_c = (_b = request.data) === null || _b === void 0 ? void 0 : _b.companyId) !== null && _c !== void 0 ? _c : token.companyId);
    if (!isSuper && requested !== normalizeCompanyId(token.companyId)) {
        throw new https_1.HttpsError('permission-denied', 'Bu firma için yetkiniz yok.');
    }
    const rates = await getRates();
    const res = await computeCompany(requested, rates, new Date());
    return { ok: true, companyId: requested, totalTRY: res.totalTRY, itemCount: res.itemCount };
});
//# sourceMappingURL=costSnapshot.js.map