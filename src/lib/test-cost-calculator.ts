/**
 * Test bazlı maliyet hesaplama motoru.
 *
 * Hesap modeli (kullanıcı onaylı):
 *
 * Bireysel test bakışı (Full Burden):
 *   - X testinin stok maliyeti: yalnızca X'e bağlı ürünlerin lab'larındaki stoğunun maliyeti
 *   - Ortak giderler = grandTotal − X'in stok maliyeti
 *     (yani diğer testlerin stoğu + envanter + cihaz + personel)
 *   - X testinin toplam maliyeti = grandTotal (her test için sayısal olarak aynı)
 *   - X için BİRİM test maliyeti = grandTotal / X'in toplam test adedi
 *
 * Lab/Sistem geneli (Real Spend):
 *   - Cihaz + envanter + personel TEK SEFER alınır
 *   - Üzerine tüm testlerin stoğu eklenir
 *
 * Para birimi: tüm hesaplar TL üzerinden yapılır; ürün/cihaz/personel için
 *  girilmiş para birimleri exchange-rate ile TL'ye çevrilir.
 */

import type {
  ProductCode,
  Hospital,
  Device,
  AssignedDevice,
  Asset,
  Personnel,
  TestDefinitionGlobal,
  DepoStokItem,
  Currency,
  DeviceMulkiyetTipi,
} from './types';

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export type AllocationMode = 'full_burden' | 'equal_alloc' | 'volume_weighted';

/**
 * Hesap periyodu.
 * - 'aylik'  → ortak gider çarpanı = 1 ay
 * - 'yillik' → çarpan = 12 ay
 * - 'gunluk' → çarpan = 1/30 ay
 * - 'ozel'   → çarpan = customDays/30 ay
 *
 * Stok değeri periyot bağımsız anlık değerdir (kapasite modu). Üzerine ortak
 * giderler (cihaz/envanter/personel) × periyot_ay_sayisi eklenir.
 */
export type PeriotTipi = 'aylik' | 'yillik' | 'gunluk' | 'ozel';
export interface PeriotConfig {
  type: PeriotTipi;
  /** type='ozel' ise gün sayısı */
  customDays?: number;
}

export function periotInMonths(p?: PeriotConfig): number {
  if (!p) return 1;
  if (p.type === 'aylik') return 1;
  if (p.type === 'yillik') return 12;
  if (p.type === 'gunluk') return 1 / 30;
  if (p.type === 'ozel') return Math.max(0.001, (p.customDays || 30) / 30);
  return 1;
}

export interface TestCostInputs {
  testDef: TestDefinitionGlobal;
  /** Tüm testler — diğer testlerin stoğu da grandTotal'a girer */
  allTestDefs: TestDefinitionGlobal[];
  productMap: Map<string, ProductCode>;
  labs: Hospital[];
  assignedDevices: AssignedDevice[];
  deviceDefs: Map<string, Device>;
  assets: Asset[];
  personnel: Personnel[];
  depoStok: DepoStokItem[];
  /** EUR base'e göre kurlar (rates.TRY = 1 EUR kaç TL) */
  rates: Record<Currency, number>;
  mode?: AllocationMode;
  /** Hesap periyodu — varsayılan aylık. Ortak giderler bu periyotla çarpılır. */
  periot?: PeriotConfig;
  /** Sadece bu lab'ları içerir; boş/undefined → tümü */
  filterLabIds?: string[];
}

export interface LabBreakdown {
  labId: string;
  labName: string;
  /** Bu labda bu testin toplam test adedi (kutu×ambalaj + cihazUstu) */
  testUnits: number;
  /** Bu labda bu testin stok maliyeti (TL) */
  stockCostTL: number;
  inventoryCostTL: number;
  deviceCostMonthlyTL: number;
  personnelCostMonthlyTL: number;
}

export interface TestCostBreakdown {
  testId: string;
  sutKodu: string;
  sutTestAdi: string;
  linkedStokKodlari: string[];

  /** Bu testin stoğundaki toplam test adedi (tüm labslar) */
  totalTestUnits: number;
  /** Bu testin stok maliyeti (TL) */
  stockCostTL: number;
  /** Diğer testlerin stoğu (TL) */
  otherTestsStockCostTL: number;
  /** Toplam envanter (asset) maliyeti (TL) */
  inventoryCostTL: number;
  /** Toplam cihaz aylık maliyeti (TL/ay) */
  deviceCostMonthlyTL: number;
  /** Toplam personel aylık gideri (TL/ay) */
  personnelCostMonthlyTL: number;
  /** Bireysel teste yüklenen ortak giderler = grandTotal - bu testin stok maliyeti */
  ortakGiderlerTL: number;
  /** Full Burden test maliyeti (= grandTotal) */
  testTotalCostTL: number;
  /** Birim test maliyeti = testTotalCostTL / totalTestUnits */
  costPerTestTL: number;

  /** Hak ediş (SUT karşılığı) — TL */
  hakEdisTL: number;
  /** Marj = hakEdis - costPerTest (negatif zarar) */
  marjTL: number;

  perLab: LabBreakdown[];
  warnings: string[];
  /** Hesabın periyodu (ay olarak). 1=aylık, 12=yıllık, 1/30=günlük */
  periotAy?: number;
}

export interface SystemCostSummary {
  /** Cihaz + envanter + personel + tüm test stokları (tek sefer) */
  realTotalSpendTL: number;
  inventoryCostTL: number;
  deviceCostMonthlyTL: number;
  personnelCostMonthlyTL: number;
  /** Tüm testlerin stoklarının toplam maliyeti */
  allStockCostTL: number;
  /** Hesabın periyodu (ay olarak) */
  periotAy?: number;
  /** İlgilenilen labslara dahil envanter, cihaz, personel sayıları */
  counts: {
    labs: number;
    devices: number;
    assets: number;
    personnel: number;
  };
}

// ============================================================================
// PARA BİRİMİ DÖNÜŞÜMÜ
// ============================================================================

/**
 * Verilen tutarı kaynak para biriminden TL'ye çevirir.
 * `rates` exchange-rates.ts modülünden gelir (EUR-base):
 *   rates.EUR = 1
 *   rates.USD = 1 EUR kaç USD
 *   rates.TRY = 1 EUR kaç TL
 */
export function toTRY(amount: number, src: Currency | undefined, rates: Record<Currency, number>): number {
  if (!amount || !isFinite(amount)) return 0;
  const currency = (src || 'TRY') as Currency;
  if (currency === 'TRY') return amount;
  if (currency === 'EUR') return amount * (rates.TRY || 0);
  if (currency === 'USD') {
    // amount USD → EUR → TRY
    const inEur = (rates.USD && rates.USD > 0) ? amount / rates.USD : 0;
    return inEur * (rates.TRY || 0);
  }
  return amount;
}

// ============================================================================
// ALT HESAPLAR
// ============================================================================

/**
 * Bir lab'da verilen stok kodları için toplam test adedini ve TL maliyetini hesaplar.
 * Test adedi = adet × ambalajDegeri (cihazUstu desteklenmiyor — gerçek stok bazlı).
 */
function computeStockForLab(
  labId: string,
  stokKodlari: Set<string>,
  productMap: Map<string, ProductCode>,
  depoStok: DepoStokItem[],
  rates: Record<Currency, number>,
  warnings: string[],
): { units: number; costTL: number } {
  let units = 0;
  let costTL = 0;

  for (const item of depoStok) {
    if (!item.isShipped) continue;
    if (item.hedefKurumId !== labId) continue;
    if (!stokKodlari.has(item.stokKodu)) continue;

    const product = productMap.get(item.stokKodu);
    if (!product) {
      warnings.push(`Ürün tanımı bulunamadı: ${item.stokKodu}`);
      continue;
    }
    const ambalaj = Number(product.ambalajDegeri) || 0;
    const birimFiyatTRY = toTRY(Number(product.cost) || 0, product.currency as Currency, rates);
    // DepoStokItem her bir kutu/seri için 1 satır → adet = 1
    // ConsumptionRecord ile birlikte aggregation yapılacaksa burada miktar alanı eklenir.
    units += ambalaj;
    costTL += birimFiyatTRY;
  }

  return { units, costTL };
}

/**
 * Asset'in aylık maliyeti.
 * - `bakimMaliyetiTl` aylık bakım gideri olarak değerlendirilir.
 * - `alimFiyatiTl` + `planliKullanimOmruYil` varsa aylık amortisman türetilir.
 * - İkisi de yoksa 0.
 */
function assetMonthlyCostTL(asset: Asset, rates: Record<Currency, number>): number {
  const cur = (asset.maliyetCurrency || 'TRY') as Currency;
  let m = 0;

  // Mülkiyet kira ise: kiraTutari + kiraDonemi normalize
  if (asset.mulkiyet === 'kira' && asset.kiraTutari) {
    const donem = asset.kiraDonemi || 'aylik';
    const monthly = donem === 'yillik' ? Number(asset.kiraTutari) / 12 : Number(asset.kiraTutari);
    m += toTRY(monthly, cur, rates);
  }

  // Mülkiyet satın alma (varsayılan): alimFiyatiTl / (omurYil × 12)
  // mulkiyet alanı 'satin_alma' veya tanımsız sayılır.
  const isSatinAlma = !asset.mulkiyet || asset.mulkiyet === 'satin_alma';
  if (isSatinAlma && asset.alimFiyatiTl && asset.planliKullanimOmruYil && asset.planliKullanimOmruYil > 0) {
    const monthly = (Number(asset.alimFiyatiTl) || 0) / (asset.planliKullanimOmruYil * 12);
    m += toTRY(monthly, cur, rates);
  }

  // Bakım maliyeti aylık gider olarak kabul edilir (mülkiyetten bağımsız)
  if (asset.bakimMaliyetiTl) {
    m += toTRY(Number(asset.bakimMaliyetiTl) || 0, cur, rates);
  }

  return m;
}

/**
 * Bir cihazın aylık maliyetini TL cinsinden döndürür.
 * Mülkiyet değerleri için hem yeni ('kira', 'satin_alma', 'demobaz') hem de
 * sistemde halen kullanılan eski isimler ('kiralik', 'kurum', 'demirbas')
 * desteklenir:
 *   - kira / kiralik          → aylikKira
 *   - satin_alma / kurum      → satinAlmaTutari / amortismanAyi
 *   - demobaz / demirbas / diğer → 0
 */
export function deviceMonthlyCostTL(device: Device | undefined, rates: Record<Currency, number>): number {
  if (!device) return 0;
  const cur = (device.maliyetCurrency || 'TRY') as Currency;
  const m = String(device.mulkiyet || '').toLowerCase();
  if (m === 'kira' || m === 'kiralik' || m === 'kiralık') {
    const tutar = Number(device.aylikKira) || 0;
    if (tutar <= 0) return 0;
    const donem = device.kiraDonemi || 'aylik';
    const monthly = donem === 'yillik' ? tutar / 12 : tutar;
    return toTRY(monthly, cur, rates);
  }
  if (m === 'satin_alma' || m === 'satinalma' || m === 'kurum') {
    const tutar = Number(device.satinAlmaTutari) || 0;
    const ay = Number(device.amortismanAyi) || 0;
    if (tutar > 0 && ay > 0) {
      return toTRY(tutar / ay, cur, rates);
    }
  }
  return 0;
}

function personnelMonthlyCostTL(p: Personnel, rates: Record<Currency, number>): number {
  if (!p.aktif) return 0;
  const total = (Number(p.aylikBrutMaas) || 0) + (Number(p.aylikYanHaklar) || 0);
  return toTRY(total, p.currency, rates);
}

// ============================================================================
// LAB BAŞINA AGREGASYON
// ============================================================================

/**
 * Tek bir laba ait stok-DIŞI ortak giderleri (envanter+cihaz+personel) hesaplar.
 * Test bazından bağımsız — laba düşen sabit ortak yük.
 */
export function computeLabSharedMonthlyCosts(
  labId: string,
  labName: string,
  assignedDevices: AssignedDevice[],
  deviceDefs: Map<string, Device>,
  assets: Asset[],
  personnel: Personnel[],
  rates: Record<Currency, number>,
  warnings: string[],
): {
  inventoryCostTL: number;
  deviceCostMonthlyTL: number;
  personnelCostMonthlyTL: number;
} {
  // Cihaz: laba atanmış AssignedDevice'lar üzerinden
  let deviceCost = 0;
  const labDevices = assignedDevices.filter((d) => d.hastaneId === labId);
  for (const ad of labDevices) {
    const def = deviceDefs.get(ad.deviceId) || deviceDefs.get(ad.cihazId);
    const c = deviceMonthlyCostTL(def, rates);
    if (def && !c) warnings.push(`Cihaz "${def.brand} ${def.model}" maliyeti tanımlanmamış (${labName})`);
    deviceCost += c;
  }

  // Envanter: konum alanı lab id veya lab adıyla eşleşen asset'ler
  // (Asset.konum mevcut sistemde lab adı/ID karışık olabilir — ikisini de destekle)
  let inventoryCost = 0;
  for (const a of assets) {
    if (a.konum !== labId && a.konum !== labName) continue;
    inventoryCost += assetMonthlyCostTL(a, rates);
  }

  // Personel: assignedLabIds içinde bu lab varsa
  let personnelCost = 0;
  for (const p of personnel) {
    if (!p.assignedLabIds?.includes(labId)) continue;
    personnelCost += personnelMonthlyCostTL(p, rates);
  }

  return {
    inventoryCostTL: inventoryCost,
    deviceCostMonthlyTL: deviceCost,
    personnelCostMonthlyTL: personnelCost,
  };
}

// ============================================================================
// ANA HESAP: TEST BAZLI MALİYET
// ============================================================================

/**
 * Bir testin tüm laboratuvarlardaki maliyet kırılımını hesaplar.
 */
export function calculateTestCost(inputs: TestCostInputs): TestCostBreakdown {
  const {
    testDef,
    allTestDefs,
    productMap,
    labs: allLabs,
    assignedDevices,
    deviceDefs,
    assets,
    personnel,
    depoStok,
    rates,
    periot,
    filterLabIds,
  } = inputs;

  // Lab filtresi
  const labs = filterLabIds && filterLabIds.length > 0
    ? allLabs.filter((l) => filterLabIds.includes(l.id))
    : allLabs;

  const periotAy = periotInMonths(periot);

  const warnings: string[] = [];
  const stokKodlari = new Set(testDef.linkedStokKodlari || []);
  if (stokKodlari.size === 0) {
    warnings.push('Bu teste bağlı ürün tanımlanmamış');
  }

  const perLab: LabBreakdown[] = [];
  let totalStockUnits = 0;
  let totalStockCostTL = 0;
  let totalInventoryMonthlyTL = 0;
  let totalDeviceMonthlyTL = 0;
  let totalPersonnelMonthlyTL = 0;

  for (const lab of labs) {
    const stockRes = computeStockForLab(lab.id, stokKodlari, productMap, depoStok, rates, warnings);
    const shared = computeLabSharedMonthlyCosts(
      lab.id,
      lab.name,
      assignedDevices,
      deviceDefs,
      assets,
      personnel,
      rates,
      warnings,
    );

    const hasStock = stockRes.units > 0 || stockRes.costTL > 0;
    const hasShared =
      shared.inventoryCostTL > 0 || shared.deviceCostMonthlyTL > 0 || shared.personnelCostMonthlyTL > 0;
    if (!hasStock && !hasShared) continue;

    perLab.push({
      labId: lab.id,
      labName: lab.name,
      testUnits: stockRes.units,
      stockCostTL: stockRes.costTL,
      inventoryCostTL: shared.inventoryCostTL * periotAy,
      deviceCostMonthlyTL: shared.deviceCostMonthlyTL * periotAy,
      personnelCostMonthlyTL: shared.personnelCostMonthlyTL * periotAy,
    });

    totalStockUnits += stockRes.units;
    totalStockCostTL += stockRes.costTL;
    totalInventoryMonthlyTL += shared.inventoryCostTL;
    totalDeviceMonthlyTL += shared.deviceCostMonthlyTL;
    totalPersonnelMonthlyTL += shared.personnelCostMonthlyTL;
  }

  // Diğer testlerin stok maliyeti (filtrelenmiş labs üzerinde)
  let otherStockTL = 0;
  for (const t of allTestDefs) {
    if (t.id === testDef.id) continue;
    const otherSet = new Set(t.linkedStokKodlari || []);
    for (const lab of labs) {
      const res = computeStockForLab(lab.id, otherSet, productMap, depoStok, rates, warnings);
      otherStockTL += res.costTL;
    }
  }

  // Periyot uygulanan ortak gider tutarları
  const inventoryPeriotTL = totalInventoryMonthlyTL * periotAy;
  const devicePeriotTL = totalDeviceMonthlyTL * periotAy;
  const personnelPeriotTL = totalPersonnelMonthlyTL * periotAy;

  // Grand total: stok (anlık değer) + diğer testlerin stoğu + ortak giderler × periyot
  const grandTotal = totalStockCostTL + otherStockTL + inventoryPeriotTL + devicePeriotTL + personnelPeriotTL;
  const ortakGiderler = grandTotal - totalStockCostTL;
  const testTotalCost = totalStockCostTL + ortakGiderler; // = grandTotal
  const costPerTest = totalStockUnits > 0 ? testTotalCost / totalStockUnits : 0;

  if (totalStockUnits === 0) {
    warnings.push('Bu testin stoğunda hiç test adedi yok — birim maliyet hesaplanamadı');
  }

  const hakEdisTL = toTRY(testDef.hakEdisMiktari || 0, (testDef.currency || 'TRY') as Currency, rates);
  const marj = hakEdisTL - costPerTest;

  return {
    testId: testDef.id,
    sutKodu: testDef.sutKodu,
    sutTestAdi: testDef.sutTestAdi,
    linkedStokKodlari: testDef.linkedStokKodlari || [],
    totalTestUnits: totalStockUnits,
    stockCostTL: totalStockCostTL,
    otherTestsStockCostTL: otherStockTL,
    inventoryCostTL: inventoryPeriotTL,
    deviceCostMonthlyTL: devicePeriotTL,
    personnelCostMonthlyTL: personnelPeriotTL,
    ortakGiderlerTL: ortakGiderler,
    testTotalCostTL: testTotalCost,
    costPerTestTL: costPerTest,
    hakEdisTL,
    marjTL: marj,
    perLab,
    warnings,
    periotAy,
  };
}

// ============================================================================
// SİSTEM/LAB GENELİ TOPLAM (gerçek harcama)
// ============================================================================

/**
 * Tüm labslar ve tüm testler için gerçek harcamayı (tek sefer) hesaplar.
 * Bu hesap test bazlı full-burden yaklaşımının aksine ortak giderleri
 * tek sefer sayar, üzerine TÜM test stoklarını ekler.
 */
export function calculateSystemTotal(inputs: Omit<TestCostInputs, 'testDef'>): SystemCostSummary {
  const {
    allTestDefs,
    productMap,
    labs: allLabs,
    assignedDevices,
    deviceDefs,
    assets,
    personnel,
    depoStok,
    rates,
    periot,
    filterLabIds,
  } = inputs;

  const labs = filterLabIds && filterLabIds.length > 0
    ? allLabs.filter((l) => filterLabIds.includes(l.id))
    : allLabs;

  const periotAy = periotInMonths(periot);
  const warnings: string[] = [];

  let inventoryMonthlyTL = 0;
  let deviceMonthlyTL = 0;
  let personnelMonthlyTL = 0;
  let deviceCount = 0;
  let assetCount = 0;
  let personnelCount = 0;

  for (const lab of labs) {
    const shared = computeLabSharedMonthlyCosts(
      lab.id,
      lab.name,
      assignedDevices,
      deviceDefs,
      assets,
      personnel,
      rates,
      warnings,
    );
    inventoryMonthlyTL += shared.inventoryCostTL;
    deviceMonthlyTL += shared.deviceCostMonthlyTL;
    personnelMonthlyTL += shared.personnelCostMonthlyTL;
    deviceCount += assignedDevices.filter((d) => d.hastaneId === lab.id).length;
    assetCount += assets.filter((a) => a.konum === lab.id || a.konum === lab.name).length;
    personnelCount += personnel.filter((p) => p.assignedLabIds?.includes(lab.id)).length;
  }

  const allStokKodlari = new Set<string>();
  for (const t of allTestDefs) {
    for (const k of t.linkedStokKodlari || []) allStokKodlari.add(k);
  }

  let allStockTL = 0;
  for (const lab of labs) {
    const res = computeStockForLab(lab.id, allStokKodlari, productMap, depoStok, rates, warnings);
    allStockTL += res.costTL;
  }

  // Periyot uygulanır
  const inventoryTL = inventoryMonthlyTL * periotAy;
  const deviceTL = deviceMonthlyTL * periotAy;
  const personnelTL = personnelMonthlyTL * periotAy;

  return {
    realTotalSpendTL: inventoryTL + deviceTL + personnelTL + allStockTL,
    inventoryCostTL: inventoryTL,
    deviceCostMonthlyTL: deviceTL,
    personnelCostMonthlyTL: personnelTL,
    allStockCostTL: allStockTL,
    periotAy,
    counts: {
      labs: labs.length,
      devices: deviceCount,
      assets: assetCount,
      personnel: personnelCount,
    },
  };
}
