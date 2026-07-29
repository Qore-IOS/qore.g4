/**
 * Anlık maliyet (stok değeri) snapshot hesaplayıcısı.
 *
 * "Anlık maliyet" = sabah 06:00 itibarıyla TÜM depo VE lab stoğunun (sevk
 * edilmiş/edilmemiş fark etmeksizin) birim maliyet × adet ile bulunan ve TL'ye
 * çevrilen toplam değeri. Kırılım Depo ve Lab bazında verilir.
 *
 * Bu dosya SAF (Firestore/date-fns bağımsız) tutulur; hem istemci (web SDK ile
 * veri çekip çağırır) hem de Cloud Function (admin SDK ile çekip aynı mantığı
 * uygular) tarafından kullanılabilsin diye. Function port'u bunu birebir
 * kopyalayabilir.
 */

export type CostCurrency = 'EUR' | 'USD' | 'TRY';
export type CurrencyPools = Record<CostCurrency, number>;
/** EUR-bazlı kurlar: EUR=1, USD=EUR→USD, TRY=EUR→TRY (getExchangeRates ile aynı) */
export interface CostRates { EUR: number; USD: number; TRY: number }

export interface RawProductInput {
  stokKodu?: string;
  cost?: number | string; birimFiyat?: number | string; unitPrice?: number | string; price?: number | string;
  currency?: string;
  marka?: string; stokAdi?: string; urunGrubu?: string;
  [k: string]: any;
}

export interface RawStockInput {
  stokKodu?: string;
  quantity?: number;
  isShipped?: boolean;
  depotId?: string; depotName?: string;
  hedefKurumId?: string; labId?: string; hedefKurum?: string; labName?: string;
  lotNumarasi?: string; miad?: string;
  [k: string]: any;
}

export interface CostProductRow {
  stokKodu: string; stokAdi: string; brand: string; urunGrubu: string;
  quantity: number; nativeTotals: CurrencyPools; tryTotal: number;
}
export interface CostLocationRow {
  id: string; name: string; type: 'depo' | 'lab';
  quantity: number; nativeTotals: CurrencyPools; tryTotal: number;
  products: CostProductRow[];
}
export interface StockCostSnapshot {
  schemaVersion: number;
  source: 'scheduled' | 'manual' | 'client-fallback';
  computedAt: string;   // ISO
  forDate: string;      // YYYY-MM-DD (hesabın ait olduğu gün)
  rates: CostRates;
  totalTRY: number;
  pools: CurrencyPools;
  riskyTRY: number;
  itemCount: number;
  byDepot: CostLocationRow[];
  byLab: CostLocationRow[];
}

export const emptyPools = (): CurrencyPools => ({ EUR: 0, USD: 0, TRY: 0 });

export function normalizeCurrency(c: unknown): CostCurrency {
  const up = typeof c === 'string' ? c.toUpperCase() : 'TRY';
  return up === 'EUR' || up === 'USD' ? up : 'TRY';
}

export function sumPoolsToTry(pools: CurrencyPools, rates: CostRates): number {
  const eurToTry = rates.TRY || 0;
  const usdToTry = rates.USD > 0 ? (rates.TRY || 0) / rates.USD : 0;
  return pools.TRY + pools.EUR * eurToTry + pools.USD * usdToTry;
}

/** productCode dokümanından birim maliyet + para birimini çıkarır (legacy alan adları dahil). */
export function parseProductCost(data: RawProductInput): { cost: number; currency: CostCurrency } | null {
  const raw = data.cost ?? data.birimFiyat ?? data.unitPrice ?? data.price;
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!num || isNaN(num)) return null;
  return { cost: num, currency: normalizeCurrency(data.currency) };
}

/** miad alanı string ('dd.MM.yyyy') ya da Timestamp/Date olabilir → 'dd.MM.yyyy'. */
export function miadToStr(miad: unknown): string {
  if (typeof miad === 'string') return miad.trim();
  if (!miad || typeof miad !== 'object') return '';
  const anyM = miad as any;
  const d: Date | null = typeof anyM.toDate === 'function'
    ? anyM.toDate()
    : (typeof anyM.seconds === 'number' ? new Date(anyM.seconds * 1000) : (miad instanceof Date ? miad : null));
  if (!d || isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** 'dd.MM.yyyy' string → bugüne göre kalan gün sayısı (yoksa null). */
function miadDaysFrom(miad: string, now: Date): number | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((miad || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - now.getTime()) / 86400000);
}

function fmtDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface LocAcc {
  id: string; name: string; type: 'depo' | 'lab';
  quantity: number; nativeTotals: CurrencyPools;
  products: Map<string, CostProductRow>;
}

export interface ComputeInputs {
  products: RawProductInput[];
  stocks: RawStockInput[];
  depotNames: Record<string, string>;
  hospitalNames: Record<string, string>;
  /** key = `${locationId}__${stokKodu}` → { max, maxGun }. locationId depo VEYA
   *  laboratuvar id'si olabilir; riskli stok tüm sahada (depo + lab) hesaplanır. */
  minMaxRules: Record<string, { max: number; maxGun: number }>;
  rates: CostRates;
  source: StockCostSnapshot['source'];
  now: Date;
}

/**
 * Tüm depo + lab stoğunu birim maliyetle değerleyip TL toplamı, para birimi
 * havuzları, Depo/Lab kırılımları ve riskli (miadı geçebilecek fazla) stok
 * değerini hesaplar.
 */
export function computeStockCostSnapshot(inputs: ComputeInputs): StockCostSnapshot {
  const { products, stocks, depotNames, hospitalNames, minMaxRules, rates, source, now } = inputs;

  // stokKodu → maliyet + marka + ad + grup
  const costMap = new Map<string, { cost: number; currency: CostCurrency; brand: string; stokAdi: string; urunGrubu: string }>();
  products.forEach((data) => {
    const parsed = parseProductCost(data);
    if (!parsed || !data.stokKodu) return;
    costMap.set(String(data.stokKodu), {
      cost: parsed.cost,
      currency: parsed.currency,
      brand: String(data.marka || 'Markasız'),
      stokAdi: String(data.stokAdi || data.stokKodu),
      urunGrubu: String(data.urunGrubu || ''),
    });
  });

  const totalPools = emptyPools();
  const depotAcc = new Map<string, LocAcc>();
  const labAcc = new Map<string, LocAcc>();

  // riskli hesap için TÜM saha stoğu (depo + lab) toplanır
  const activeStockItems: Array<{ stokKodu: string; lotNumarasi: string; miad: string; locationId: string; quantity: number }> = [];
  const groupedByLocationAndProduct = new Map<string, number>();
  let itemCount = 0;

  stocks.forEach((data) => {
    const stokKodu = String(data.stokKodu || '');
    const qty = Number(data.quantity ?? 1) || 1;
    const pc = costMap.get(stokKodu);
    itemCount += qty;

    if (pc) {
      totalPools[pc.currency] += pc.cost * qty;

      const isLab = data.isShipped === true;
      const bucket = isLab ? labAcc : depotAcc;
      const locId = isLab
        ? String(data.hedefKurumId || data.labId || data.hedefKurum || 'bilinmeyen-lab')
        : String(data.depotId || 'bilinmeyen-depo');
      const locName = isLab
        ? (hospitalNames[locId] || String(data.hedefKurum || data.labName || 'Bilinmeyen Lab'))
        : (depotNames[locId] || String(data.depotName || 'Bilinmeyen Depo'));

      let loc = bucket.get(locId);
      if (!loc) {
        loc = { id: locId, name: locName, type: isLab ? 'lab' : 'depo', quantity: 0, nativeTotals: emptyPools(), products: new Map() };
        bucket.set(locId, loc);
      }
      loc.quantity += qty;
      loc.nativeTotals[pc.currency] += pc.cost * qty;

      let prod = loc.products.get(stokKodu);
      if (!prod) {
        prod = { stokKodu, stokAdi: pc.stokAdi, brand: pc.brand, urunGrubu: pc.urunGrubu, quantity: 0, nativeTotals: emptyPools(), tryTotal: 0 };
        loc.products.set(stokKodu, prod);
      }
      prod.quantity += qty;
      prod.nativeTotals[pc.currency] += pc.cost * qty;
    }

    // riskli — tüm saha stoğu: depo için depotId, lab için hedefKurumId/labId
    {
      const isLab = data.isShipped === true;
      const locationId = String(
        isLab ? (data.hedefKurumId || data.labId || '') : (data.depotId || ''),
      );
      if (locationId) {
        activeStockItems.push({ stokKodu, lotNumarasi: String(data.lotNumarasi || ''), miad: miadToStr(data.miad), locationId, quantity: qty });
        const gKey = `${locationId}__${stokKodu}`;
        groupedByLocationAndProduct.set(gKey, (groupedByLocationAndProduct.get(gKey) || 0) + qty);
      }
    }
  });

  const finalizeLoc = (loc: LocAcc): CostLocationRow => ({
    id: loc.id, name: loc.name, type: loc.type, quantity: loc.quantity,
    nativeTotals: loc.nativeTotals, tryTotal: sumPoolsToTry(loc.nativeTotals, rates),
    products: Array.from(loc.products.values())
      .map((p) => ({ ...p, tryTotal: sumPoolsToTry(p.nativeTotals, rates) }))
      .sort((a, b) => b.tryTotal - a.tryTotal),
  });
  const byDepot = Array.from(depotAcc.values()).map(finalizeLoc).sort((a, b) => b.tryTotal - a.tryTotal);
  const byLab = Array.from(labAcc.values()).map(finalizeLoc).sort((a, b) => b.tryTotal - a.tryTotal);

  // riskli stok değeri — depo + lab (saha) genelinde
  const lotGroups = new Map<string, { stokKodu: string; locationId: string; miad: string; quantity: number }>();
  activeStockItems.forEach((item) => {
    const key = `${item.locationId}__${item.stokKodu}__${item.lotNumarasi}__${item.miad}`;
    const ex = lotGroups.get(key);
    if (ex) ex.quantity += item.quantity;
    else lotGroups.set(key, { stokKodu: item.stokKodu, locationId: item.locationId, miad: item.miad, quantity: item.quantity });
  });

  const riskyPools = emptyPools();
  lotGroups.forEach((group) => {
    const rule = minMaxRules[`${group.locationId}__${group.stokKodu}`];
    if (!rule || !rule.max || !rule.maxGun) return;
    const miadDays = miadDaysFrom(group.miad, now);
    if (miadDays === null || miadDays <= 0) return;
    const periodDays = Math.floor(rule.maxGun);
    if (periodDays <= 0) return;
    const dailyNeed = rule.max / periodDays;
    if (dailyNeed <= 0) return;
    const totalStockForProduct = groupedByLocationAndProduct.get(`${group.locationId}__${group.stokKodu}`) || group.quantity;
    const coverageDays = Math.floor(totalStockForProduct / dailyNeed);
    if (coverageDays <= miadDays) return;
    const riskyBoxes = Math.min(Math.max(0, Math.ceil((coverageDays - miadDays) * dailyNeed)), group.quantity);
    const pc = costMap.get(group.stokKodu);
    if (!pc) return;
    riskyPools[pc.currency] += riskyBoxes * pc.cost;
  });

  return {
    schemaVersion: 2,
    source,
    computedAt: now.toISOString(),
    forDate: fmtDateKey(now),
    rates,
    totalTRY: sumPoolsToTry(totalPools, rates),
    pools: totalPools,
    riskyTRY: sumPoolsToTry(riskyPools, rates),
    itemCount,
    byDepot,
    byLab,
  };
}
