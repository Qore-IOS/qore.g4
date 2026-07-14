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
 * Maliyet hesap modu (yeni — kapasite verisi geldiğinde anlamlı):
 * - 'stock': ortak gider / stoktaki test adedine bölünür (full burden, mevcut davranış)
 * - 'capacity': ortak gider / cihazların aylık maks. kapasitesine bölünür (atıl-maliyet hesabı için)
 * - 'hybrid': ürün maliyeti stoktan, ortak gider kapasiteden — en gerçekçi
 */
export type CostMode = 'stock' | 'capacity' | 'hybrid';

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

/**
 * Sunucu tarafında özetlenmiş sevk edilmiş stok: lab + stok kodu başına
 * kutu/seri (satır) sayısı. Ham `DepoStokItem[]` listesinin on binlerce
 * belge indirmesini önlemek için `/api/maliyet-gozlem/depo-stok-ozet`
 * route'u bu şekli döndürür.
 */
export interface DepoStokCount {
  hedefKurumId: string;
  stokKodu: string;
  /** Bu lab + stok kodu için sevk edilmiş kutu/seri sayısı */
  count: number;
  /**
   * Cihaz üstü test adedi (maliyet sayım oturumlarından). Test hacmine doğrudan
   * eklenir; maliyeti test başına birim fiyat (cost/ambalaj) üzerinden hesaplanır.
   */
  cihazUstuAdedi?: number;
}

/** Basitleştirilmiş personel gider konfigürasyonu (personnelCostConfig dokümanı). */
export interface PersonnelCostConfigInput {
  /** Personel başına aylık gider (TL) */
  costPerPersonTL: number;
  /** labId → personel sayısı (havuzlarda yalnızca ana laba girilir) */
  labCounts: Record<string, number>;
}

/** Ortak stok havuzu — personel giderinin üye lablara dağıtımı için. */
export interface LabPoolLite {
  mainLabId?: string;
  memberIds: string[];
  active?: boolean;
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
  /**
   * Verilirse personel gideri Personnel kayıtları yerine bu konfigürasyondan
   * hesaplanır: lab gideri = kişi sayısı × kişi başı gider. Havuzlarda ana
   * laba girilen toplam, üye lablara test hacmi payıyla dağıtılır.
   */
  personnelConfig?: PersonnelCostConfigInput;
  /** Havuz tanımları — personnelConfig ile birlikte kullanılır. */
  labPools?: LabPoolLite[];
  /**
   * labId → dönem içi yedek parça değişim toplamı (TL). Dönem sabit tutar;
   * lab içi test hacmi payıyla testlere dağıtılır. Test maliyetine KATILMAZ.
   */
  sparePartByLab?: Record<string, number>;
  /**
   * labId → dönem içi envanter (satın alma) kaydı toplamı (TL). Dönem sabit
   * tutar; lab içi test hacmi payıyla testlere dağıtılır. Maliyete KATILMAZ.
   */
  inventoryEntryByLab?: Record<string, number>;
  /** Ham sevk edilmiş stok satırları — `depoStokCounts` verilmişse gerekmez */
  depoStok?: DepoStokItem[];
  /** Sunucuda özetlenmiş stok sayıları — verilirse `depoStok` yerine kullanılır */
  depoStokCounts?: DepoStokCount[];
  /** EUR base'e göre kurlar (rates.TRY = 1 EUR kaç TL) */
  rates: Record<Currency, number>;
  mode?: AllocationMode;
  /** Hesap periyodu — varsayılan aylık. Ortak giderler bu periyotla çarpılır. */
  periot?: PeriotConfig;
  /** Sadece bu lab'ları içerir; boş/undefined → tümü */
  filterLabIds?: string[];
  /** Hesap modu (varsayılan 'stock' — geriye uyumlu) */
  costMode?: CostMode;
}

export interface CapacityBreakdown {
  /** Lab'ların toplam aylık çalışma saati (saat/ay) */
  monthlyHours: number;
  /** Tüm cihazların aylık test kapasitesi (test/ay) */
  monthlyTestCapacity: number;
  /** Bu testin aktüel test adedi (stok bazlı) */
  actualTestVolume: number;
  /** Kullanım oranı (0-1) — actualTestVolume / monthlyTestCapacity */
  utilization: number;
  /** Atıl maliyet = ortak gider × (1 − utilization) */
  idleCostTL: number;
  /** Saatlik birim maliyet = ortak gider / monthlyHours */
  costPerHourTL: number;
  /** Kapasite bazlı birim test maliyeti = ortak gider / monthlyTestCapacity (yalnızca ortak gider — stok eklenmemiş) */
  capacityBasedCostPerTestTL: number;

  // CAWC + Yedeklilik metrikleri
  /** Testi çalıştırabilen cihaz sayısı (assignedStokKodlari kesişimi) */
  eligibleDeviceCount: number;
  /** Lab(lar)daki toplam cihaz sayısı (TPH > 0 olan) */
  totalDeviceCount: number;
  /** Yedeklilik skoru: eligible / total (0..1) — yüksek = yedekli, düşük = tek noktaya bağımlı */
  redundancyScore: number;
  /** Risk primi katsayısı (1.0 = yedekli, 1.1 = tek cihaza bağımlı) */
  reliabilityPremium: number;
  /** CAWC ile bu teste düşen cihaz maliyet payı (TL) */
  deviceShareToTestTL: number;
}

export interface LabBreakdown {
  labId: string;
  labName: string;
  /** Bu labda bu testin toplam test adedi (kutu×ambalaj + cihazUstu) */
  testUnits: number;
  /** Bu labda bu testin stok maliyeti (TL) */
  stockCostTL: number;
  /** volume_weighted modda bu teste düşen pay; diğer modlarda labın tamamı (× periyot) */
  inventoryCostTL: number;
  deviceCostMonthlyTL: number;
  personnelCostMonthlyTL: number;
  /** Bu labdaki toplam test-bağlantılı hacim (tüm testler) — pay = testUnits/labVolume */
  labVolume?: number;
  /** Bu teste, bu labın dönem yedek parça giderinden düşen pay (TL) */
  sparePartCostTL?: number;
  /** Bu teste, bu labın dönem envanter kaydından düşen pay (TL) */
  inventoryEntryCostTL?: number;
  /** Lab başına birim test maliyeti = stok / adet (personel/envanter dahil edilmez) */
  unitCostTL?: number;
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
  /** Bu teste hacim ağırlığıyla dağıtılan personel gideri (seçili periyot, TL) */
  personnelCostMonthlyTL: number;
  /** Bu teste lab hacim payıyla dağıtılan dönem yedek parça gideri (TL) — maliyete dahil değil */
  sparePartAllocTL?: number;
  /** Yedek parça biriminin teste etkisi (TL/test) — bilgi amaçlı */
  sparePartUnitTL?: number;
  /** Bu teste lab hacim payıyla dağıtılan dönem envanter kaydı (TL) — maliyete dahil değil */
  inventoryEntryAllocTL?: number;
  /** Bu testin stoktan gelen birim maliyeti (TL/test) */
  stockUnitCostTL?: number;
  /** Bu testin personelden gelen birim maliyeti (TL/test) */
  personnelUnitCostTL?: number;
  /** Birim maliyetin stoktan gelen yüzdesi */
  stockSharePct?: number;
  /** Birim maliyetin personelden gelen yüzdesi */
  personnelSharePct?: number;
  /** Bireysel teste yüklenen ortak giderler = grandTotal - bu testin stok maliyeti */
  ortakGiderlerTL: number;
  /** Full Burden test maliyeti (= grandTotal) */
  testTotalCostTL: number;
  /** Birim test maliyeti = testTotalCostTL / totalTestUnits */
  costPerTestTL: number;

  /** Hak ediş (SUT karşılığı) — TL */
  hakEdisTL: number;
  /** Hak ediş verisi girilmiş mi? false ise marj hesaplanamaz (0 ≠ veri yok) */
  hakEdisTanimli?: boolean;
  /** Marj = hakEdis - costPerTest (negatif zarar). hakEdisTanimli=false ise anlamsız */
  marjTL: number;

  perLab: LabBreakdown[];
  warnings: string[];
  /** Hesabın periyodu (ay olarak). 1=aylık, 12=yıllık, 1/30=günlük */
  periotAy?: number;
  /** Kapasite bazlı metrikler — cihaz TPH ve lab çalışma saati varsa anlamlı */
  capacity?: CapacityBreakdown;
  /** Aktif hesap modu */
  costMode?: CostMode;
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
// KAPASITE HESABI
// ============================================================================

/**
 * "HH:MM" formatlı saat string'inin gün içindeki ondalık saat karşılığı.
 * Boş veya geçersiz değer → 0.
 */
function parseHour(hhmm?: string): number {
  if (!hhmm || typeof hhmm !== 'string') return 0;
  const [h, m] = hhmm.split(':').map((s) => Number(s) || 0);
  return (h || 0) + ((m || 0) / 60);
}

/**
 * Bir laboratuvarın aylık çalışma saati (saat/ay).
 * - acilStatusu=true → 24 × 30 = 720 saat (7/24)
 * - calismaSaatleri tanımlı değilse → varsayılan: hafta içi 5 gün × 8 saat × 4.34 hafta ≈ 174 saat
 * - Tanımlı ise: (haftaIciSaat × haftaIciGunSayısı × 4.34) + (haftaSonuSaat × haftaSonuGunSayısı × 4.34)
 */
export function getLabMonthlyHours(lab: Hospital): number {
  if (lab.acilStatusu) return 24 * 30;
  const cs = lab.calismaSaatleri;
  if (!cs) return 5 * 8 * 4.34; // varsayılan 174 saat
  const hiSaat = Math.max(0, parseHour(cs.haftaIciEnd) - parseHour(cs.haftaIciStart));
  const hsSaat = Math.max(0, parseHour(cs.haftaSonuEnd) - parseHour(cs.haftaSonuStart));
  const hiGun = cs.haftaIciGunleri?.length ?? 5;
  const hsGun = cs.haftaSonuGunleri?.length ?? 0;
  return (hiSaat * hiGun + hsSaat * hsGun) * 4.34; // ortalama 4.34 hafta/ay
}

/**
 * Bir cihazın aylık test kapasitesi: TPH × lab çalışma saati.
 * TPH veya saat 0 ise 0 döner.
 */
export function getDeviceMonthlyCapacity(device: Device | undefined, lab: Hospital): number {
  if (!device) return 0;
  const tph = Number(device.testKapasiteSaatBasi) || 0;
  if (tph <= 0) return 0;
  return tph * getLabMonthlyHours(lab);
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
// PAYLAŞILAN HESAP BAĞLAMI (performans)
// ============================================================================
//
// Eski uygulama her test için tüm depoStok satırlarını (lab × diğer testler
// kadar kez) yeniden tarıyordu → O(test² × lab × stokSatırı). Gerçek veri
// hacminde bu ana thread'i dakikalarca kilitleyip sekmeyi çökertiyordu.
// Bağlam (context) yaklaşımı stok satırlarını ve lab ortak giderlerini TEK
// SEFER indeksler; test başına hesap yalnızca küçük map lookuplarına düşer.

interface LabStockAgg {
  units: number;
  costTL: number;
  /** Bu stok koduna ait ürün tanımı productMap'te yok */
  missingProduct: boolean;
}

interface LabSharedCosts {
  inventoryCostTL: number;
  deviceCostMonthlyTL: number;
  personnelCostMonthlyTL: number;
  warnings: string[];
}

export interface TestCostContext {
  /** Lab filtresi uygulanmış liste */
  labs: Hospital[];
  periotAy: number;
  /** labId → stokKodu → toplam {units, costTL} */
  stockIndex: Map<string, Map<string, LabStockAgg>>;
  /** labId → aylık ortak giderler (envanter/cihaz/personel) */
  labShared: Map<string, LabSharedCosts>;
  /** labId → o laba atanmış cihazlar */
  labDevices: Map<string, AssignedDevice[]>;
  /** testId → testin filtrelenmiş lablardaki toplam stok maliyeti (TL) */
  perTestStockTL: Map<string, number>;
  /** testId → testin filtrelenmiş lablardaki toplam stok hacmi (test adedi) */
  perTestStockUnits: Map<string, number>;
  /** Tüm testlerin stok maliyetleri toplamı (TL) */
  allTestsStockTL: number;
  /** Tüm testlerin stoktan gelen toplam test hacmi */
  allTestsStockUnits: number;
  /**
   * labId → o labdaki test-bağlantılı toplam hacim (tüm testlerin o labdaki
   * adetleri). Lab içi hacim payı = units(lab, test) / labTestVolume(lab).
   */
  labTestVolume: Map<string, number>;
  inputs: Omit<TestCostInputs, 'testDef'>;
}

/**
 * Verilen girdiler için paylaşılan hesap bağlamını kurar. `calculateAllTestCosts`
 * tüm testleri tek bağlam üzerinden hesaplar; tek test için `calculateTestCost`
 * da aynı yolu kullanır.
 */
export function buildTestCostContext(inputs: Omit<TestCostInputs, 'testDef'>): TestCostContext {
  const {
    allTestDefs,
    productMap,
    labs: allLabs,
    assignedDevices,
    deviceDefs,
    assets,
    personnel,
    depoStok,
    depoStokCounts,
    rates,
    filterLabIds,
  } = inputs;

  const labs = filterLabIds && filterLabIds.length > 0
    ? allLabs.filter((l) => filterLabIds.includes(l.id))
    : allLabs;
  const labIdSet = new Set(labs.map((l) => l.id));

  // 1) Stok indeksi: labId → stokKodu → {units, costTL} (tek geçiş)
  const stockIndex = new Map<string, Map<string, LabStockAgg>>();
  const getAgg = (labId: string, stokKodu: string): LabStockAgg => {
    let inner = stockIndex.get(labId);
    if (!inner) {
      inner = new Map<string, LabStockAgg>();
      stockIndex.set(labId, inner);
    }
    let agg = inner.get(stokKodu);
    if (!agg) {
      agg = { units: 0, costTL: 0, missingProduct: false };
      inner.set(stokKodu, agg);
    }
    return agg;
  };

  if (depoStokCounts) {
    // Sunucuda özetlenmiş sayılar — satır başına ürün fiyatı/ambalaj çarpılır
    for (const row of depoStokCounts) {
      if (!labIdSet.has(row.hedefKurumId)) continue;
      const n = Number(row.count) || 0;
      const cihazUstu = Number(row.cihazUstuAdedi) || 0;
      if (n <= 0 && cihazUstu <= 0) continue;

      const agg = getAgg(row.hedefKurumId, row.stokKodu);
      const product = productMap.get(row.stokKodu);
      if (!product) {
        agg.missingProduct = true;
        continue;
      }
      const ambalaj = Number(product.ambalajDegeri) || 0;
      const costTL = toTRY(Number(product.cost) || 0, product.currency as Currency, rates);
      agg.units += n * ambalaj + cihazUstu;
      agg.costTL += n * costTL;
      // Cihaz üstü testler açılmış kutudan gelir — test başına birim maliyetle eklenir
      if (cihazUstu > 0 && ambalaj > 0) {
        agg.costTL += (costTL / ambalaj) * cihazUstu;
      }
    }
  } else {
    for (const item of depoStok || []) {
      if (!item.isShipped) continue;
      if (!labIdSet.has(item.hedefKurumId)) continue;

      const agg = getAgg(item.hedefKurumId, item.stokKodu);
      const product = productMap.get(item.stokKodu);
      if (!product) {
        agg.missingProduct = true;
        continue;
      }
      // DepoStokItem her bir kutu/seri için 1 satır → adet = 1
      agg.units += Number(product.ambalajDegeri) || 0;
      agg.costTL += toTRY(Number(product.cost) || 0, product.currency as Currency, rates);
    }
  }

  // 2) Lab başına ortak giderler (tek sefer — test bazından bağımsız)
  const labDevices = new Map<string, AssignedDevice[]>();
  for (const ad of assignedDevices) {
    const list = labDevices.get(ad.hastaneId);
    if (list) list.push(ad);
    else labDevices.set(ad.hastaneId, [ad]);
  }

  const labShared = new Map<string, LabSharedCosts>();
  for (const lab of labs) {
    const warnings: string[] = [];
    const shared = computeLabSharedMonthlyCosts(
      lab.id,
      lab.name,
      labDevices.get(lab.id) || [],
      deviceDefs,
      assets,
      personnel,
      rates,
      warnings,
    );
    labShared.set(lab.id, { ...shared, warnings });
  }

  // ── Personel gideri (basitleştirilmiş model) ─────────────────────────────
  // personnelConfig verildiyse Personnel kayıtları yerine kullanılır:
  //   lab gideri = kişi sayısı × kişi başı aylık gider (TL)
  // Havuz kuralı: ortak stok havuzlarında personel sayısı yalnızca ANA laba
  // girilir; ana labın toplam gideri havuzun üye lablarına o labların TEST
  // HACMİ payıyla dağıtılır (hacim yoksa eşit bölünür). Böylece havuzdan
  // beslenen her lab, ürettiği test kadar personel yükü taşır.
  const personnelCfg = inputs.personnelConfig;
  if (personnelCfg && personnelCfg.costPerPersonTL > 0) {
    // Lab başına toplam test hacmi (stok indeksinden)
    const labVolume = new Map<string, number>();
    for (const lab of labs) {
      let vol = 0;
      const inner = stockIndex.get(lab.id);
      if (inner) for (const agg of inner.values()) vol += agg.units;
      labVolume.set(lab.id, vol);
    }

    const perLabPersonnelTL = new Map<string, number>();
    const pooledLabIds = new Set<string>();

    for (const pool of inputs.labPools || []) {
      if (pool.active === false || !pool.mainLabId) continue;
      const memberIdSet = new Set<string>([...(pool.memberIds || []), pool.mainLabId]);
      const members = labs.filter((l) => memberIdSet.has(l.id));
      if (members.length === 0) continue;

      const headcount = Number(personnelCfg.labCounts[pool.mainLabId]) || 0;
      const poolTotalTL = headcount * personnelCfg.costPerPersonTL;
      const poolVolume = members.reduce((s, l) => s + (labVolume.get(l.id) || 0), 0);

      for (const m of members) {
        const share = poolVolume > 0 ? (labVolume.get(m.id) || 0) / poolVolume : 1 / members.length;
        perLabPersonnelTL.set(m.id, (perLabPersonnelTL.get(m.id) || 0) + poolTotalTL * share);
        pooledLabIds.add(m.id);
      }
    }

    for (const lab of labs) {
      if (pooledLabIds.has(lab.id)) continue;
      perLabPersonnelTL.set(lab.id, (Number(personnelCfg.labCounts[lab.id]) || 0) * personnelCfg.costPerPersonTL);
    }

    for (const lab of labs) {
      const shared = labShared.get(lab.id);
      if (shared) shared.personnelCostMonthlyTL = perLabPersonnelTL.get(lab.id) || 0;
    }
  }

  // 3) Test başına stok maliyeti + adedi (otherTestsStock ve volume_weighted için)
  //    + lab başına test-bağlantılı toplam hacim (lab içi hacim payı dağıtımı için)
  const perTestStockTL = new Map<string, number>();
  const perTestStockUnits = new Map<string, number>();
  const labTestVolume = new Map<string, number>();
  let allTestsStockTL = 0;
  let allTestsStockUnits = 0;
  for (const t of allTestDefs) {
    let costTL = 0;
    let units = 0;
    const kodSet = new Set(t.linkedStokKodlari || []);
    for (const lab of labs) {
      const inner = stockIndex.get(lab.id);
      if (!inner) continue;
      let labUnits = 0;
      for (const kod of kodSet) {
        const agg = inner.get(kod);
        if (agg) {
          costTL += agg.costTL;
          labUnits += agg.units;
        }
      }
      if (labUnits > 0) {
        units += labUnits;
        labTestVolume.set(lab.id, (labTestVolume.get(lab.id) || 0) + labUnits);
      }
    }
    perTestStockTL.set(t.id, costTL);
    perTestStockUnits.set(t.id, units);
    allTestsStockTL += costTL;
    allTestsStockUnits += units;
  }

  return {
    labs,
    periotAy: periotInMonths(inputs.periot),
    stockIndex,
    labShared,
    labDevices,
    perTestStockTL,
    perTestStockUnits,
    allTestsStockTL,
    allTestsStockUnits,
    labTestVolume,
    inputs,
  };
}

// ============================================================================
// ANA HESAP: TEST BAZLI MALİYET
// ============================================================================

/**
 * Bir testin tüm laboratuvarlardaki maliyet kırılımını hesaplar.
 * Tek test için kullanılır; birden çok test hesaplanacaksa
 * `calculateAllTestCosts` (paylaşılan bağlam) çok daha hızlıdır.
 */
export function calculateTestCost(inputs: TestCostInputs): TestCostBreakdown {
  const { testDef, ...rest } = inputs;
  return calculateTestCostWithContext(buildTestCostContext(rest), testDef);
}

/**
 * Tüm testlerin maliyet kırılımını TEK paylaşılan bağlam üzerinden hesaplar.
 * TestTab gibi toplu ekranlar için ana giriş noktası.
 */
export function calculateAllTestCosts(inputs: Omit<TestCostInputs, 'testDef'>): TestCostBreakdown[] {
  const ctx = buildTestCostContext(inputs);
  return inputs.allTestDefs.map((t) => calculateTestCostWithContext(ctx, t));
}

export function calculateTestCostWithContext(ctx: TestCostContext, testDef: TestDefinitionGlobal): TestCostBreakdown {
  const { deviceDefs, rates, periot } = ctx.inputs;
  const labs = ctx.labs;
  const periotAy = periotInMonths(periot);

  const warningSet = new Set<string>();
  const stokKodlari = new Set(testDef.linkedStokKodlari || []);
  if (stokKodlari.size === 0) {
    warningSet.add('Bu teste bağlı ürün tanımlanmamış');
  }

  // Dağıtım modu:
  //  - full_burden (varsayılan, geriye uyumlu): her testin toplamı grandTotal'a
  //    eşittir — testler arasında AYNI toplam görünür.
  //  - volume_weighted (TestTab): TEST MALİYETİ = YALNIZCA STOK. Personel devlet
  //    tarafından geri ödendiğinden hiçbir ortak gider (personel/cihaz/envanter)
  //    test toplamına ve birim maliyete KATILMAZ; yine de lab lab, lab içi hacim
  //    payıyla hesaplanır ve AYRI bilgi kalemleri olarak raporlanır:
  //    pay(test, lab) = adet(test, lab) / toplam test-bağlantılı adet(lab).
  //  - equal_alloc: bilgi payı test sayısına eşit bölünür (toplama katılmaz).
  const allocationMode: AllocationMode = ctx.inputs.mode || 'full_burden';

  // Dönem sabit tutarlar (yedek parça / envanter kaydı) — periyotla çarpılmaz,
  // lab içi test hacmi payıyla testlere dağıtılır (aylık gider değil).
  const sparePartByLab = ctx.inputs.sparePartByLab || {};
  const inventoryEntryByLab = ctx.inputs.inventoryEntryByLab || {};

  const perLab: LabBreakdown[] = [];
  let totalStockUnits = 0;
  let totalStockCostTL = 0;
  // Bu teste düşen BİLGİ payları (lab içi hacim payıyla — toplama katılmaz)
  let allocInventoryPeriotTL = 0;
  let allocDevicePeriotTL = 0;
  let allocPersonnelPeriotTL = 0;
  let allocSparePartTL = 0;
  let allocInventoryEntryTL = 0;

  // Tam lab toplamları (full_burden/grandTotal referansı) — testin hacmi
  // olmayan lablar da dahil, tüm filtreli lablar üzerinden.
  let totalInventoryMonthlyTL = 0;
  let totalDeviceMonthlyTL = 0;
  let totalPersonnelMonthlyTL = 0;
  for (const lab of labs) {
    const shared = ctx.labShared.get(lab.id);
    if (!shared) continue;
    totalInventoryMonthlyTL += shared.inventoryCostTL;
    totalDeviceMonthlyTL += shared.deviceCostMonthlyTL;
    totalPersonnelMonthlyTL += shared.personnelCostMonthlyTL;
  }

  for (const lab of labs) {
    let units = 0;
    let costTL = 0;
    const inner = ctx.stockIndex.get(lab.id);
    if (inner) {
      for (const kod of stokKodlari) {
        const agg = inner.get(kod);
        if (!agg) continue;
        if (agg.missingProduct) warningSet.add(`Ürün tanımı bulunamadı: ${kod}`);
        units += agg.units;
        costTL += agg.costTL;
      }
    }

    const shared = ctx.labShared.get(lab.id) || {
      inventoryCostTL: 0,
      deviceCostMonthlyTL: 0,
      personnelCostMonthlyTL: 0,
      warnings: [],
    };
    for (const w of shared.warnings) warningSet.add(w);

    // Testin bu labda hacmi yoksa satır da pay da yok — her test her labın
    // personel/gider satırını sıfır payla miras almasın.
    const hasStock = units > 0 || costTL > 0;
    if (!hasStock) continue;

    // Lab içi hacim payı: adet(test, lab) / toplam test-bağlantılı adet(lab)
    const labVolume = ctx.labTestVolume.get(lab.id) || 0;
    const labShare = labVolume > 0 ? units / labVolume : 0;

    const labInvAllocTL = shared.inventoryCostTL * labShare * periotAy;
    const labDevAllocTL = shared.deviceCostMonthlyTL * labShare * periotAy;
    const labPerAllocTL = shared.personnelCostMonthlyTL * labShare * periotAy;
    // Dönem sabit kalemler — periyotla çarpılmaz, yalnız hacim payı uygulanır
    const labSpareAllocTL = (sparePartByLab[lab.id] || 0) * labShare;
    const labInvEntryAllocTL = (inventoryEntryByLab[lab.id] || 0) * labShare;

    perLab.push({
      labId: lab.id,
      labName: lab.name,
      testUnits: units,
      stockCostTL: costTL,
      inventoryCostTL: labInvAllocTL,
      deviceCostMonthlyTL: labDevAllocTL,
      personnelCostMonthlyTL: labPerAllocTL,
      labVolume,
      sparePartCostTL: labSpareAllocTL,
      inventoryEntryCostTL: labInvEntryAllocTL,
      // Birim = yalnızca stok — personel/envanter teste katılmaz (ayrı bilgi)
      unitCostTL: units > 0 ? costTL / units : 0,
    });

    totalStockUnits += units;
    totalStockCostTL += costTL;
    allocInventoryPeriotTL += labInvAllocTL;
    allocDevicePeriotTL += labDevAllocTL;
    allocPersonnelPeriotTL += labPerAllocTL;
    allocSparePartTL += labSpareAllocTL;
    allocInventoryEntryTL += labInvEntryAllocTL;
  }

  // Diğer testlerin stok maliyeti (filtrelenmiş labs üzerinde) — indeksle O(1)
  const ownStockTL = ctx.perTestStockTL.get(testDef.id) ?? 0;
  const otherStockTL = ctx.allTestsStockTL - ownStockTL;
  const warnings = Array.from(warningSet);
  const inputs = { ...ctx.inputs, testDef } as TestCostInputs;

  // Bilgi kalemleri — volume_weighted'da testin lab lab hesaplanan payı,
  // diğer modlarda tam lab toplamları (geriye uyumlu raporlama).
  const useAlloc = allocationMode === 'volume_weighted';
  const inventoryPeriotTL = useAlloc ? allocInventoryPeriotTL : totalInventoryMonthlyTL * periotAy;
  const devicePeriotTL = useAlloc ? allocDevicePeriotTL : totalDeviceMonthlyTL * periotAy;
  const personnelPeriotTL = useAlloc ? allocPersonnelPeriotTL : totalPersonnelMonthlyTL * periotAy;

  // Grand total (full burden referansı): stok + diğer testlerin stoğu + TAM ortak giderler × periyot
  const fullSharedPeriotTL = (totalInventoryMonthlyTL + totalDeviceMonthlyTL + totalPersonnelMonthlyTL) * periotAy;
  const grandTotal = totalStockCostTL + otherStockTL + fullSharedPeriotTL;

  // Bilgi amaçlı "ortak gider" tutarı (test toplamına DAHİL DEĞİL)
  let ortakGiderler: number;
  if (allocationMode === 'volume_weighted') {
    ortakGiderler = inventoryPeriotTL + devicePeriotTL + personnelPeriotTL;
  } else if (allocationMode === 'equal_alloc') {
    const testCount = Math.max(ctx.inputs.allTestDefs.length, 1);
    ortakGiderler = fullSharedPeriotTL / testCount;
  } else {
    ortakGiderler = grandTotal - totalStockCostTL;
  }

  // TEST MALİYETİ: full_burden geriye uyumlu (grandTotal); diğer modlarda
  // YALNIZCA STOK — personel/envanter/cihaz ayrı kalem olarak raporlanır.
  const testTotalCost = allocationMode === 'full_burden'
    ? totalStockCostTL + ortakGiderler // = grandTotal
    : totalStockCostTL;
  const costPerTest = totalStockUnits > 0 ? testTotalCost / totalStockUnits : 0;
  const stockUnitCostTL = totalStockUnits > 0 ? totalStockCostTL / totalStockUnits : 0;
  const personnelUnitCostTL = totalStockUnits > 0 ? personnelPeriotTL / totalStockUnits : 0;

  if (totalStockUnits === 0) {
    warnings.push('Bu testin stoğunda hiç test adedi yok — birim maliyet hesaplanamadı');
  }

  // ────────────────────────────────────────────────────────────────────────
  // Kapasite hesabı — cihaz TPH ve lab çalışma saati varsa anlamlı.
  // Cihaz-test atama varsa (assignedStokKodlari), yalnızca testi çalıştıran
  // cihazların kapasitesi sayılır → CAWC algoritmasının temel girdisi.
  // ────────────────────────────────────────────────────────────────────────
  let monthlyHours = 0;
  let monthlyTestCapacity = 0;
  let labsWithCapacity = 0;
  let eligibleDeviceCount = 0;
  let totalDeviceCount = 0;
  let deviceShareToTestTL = 0;
  const testStokSet = new Set(testDef.linkedStokKodlari || []);

  for (const lab of labs) {
    const labHours = getLabMonthlyHours(lab);
    const labDevices = ctx.labDevices.get(lab.id) || [];
    let hasCapacity = false;

    for (const ad of labDevices) {
      const def = deviceDefs.get(ad.deviceId) || deviceDefs.get(ad.cihazId);
      const tph = Number(def?.testKapasiteSaatBasi) || 0;
      if (tph <= 0) continue;

      totalDeviceCount++;

      const assignedKodlar = ad.assignedStokKodlari || [];
      const hasAssignment = assignedKodlar.length > 0;
      // Cihaz testi çalıştırabilir mi? (atanmış stok kodu testin ürünleriyle kesişiyorsa)
      const isEligible = !hasAssignment
        ? false // atama yoksa muhafazakar: yalnızca atanmış cihaz kapasiteye sayılır
        : assignedKodlar.some((k) => testStokSet.has(k));

      if (isEligible) {
        monthlyTestCapacity += tph * labHours;
        eligibleDeviceCount++;
        hasCapacity = true;

        // CAWC: cihaz maliyetinden bu teste düşen pay
        // assignmentWeight = bu testin payı / cihaza atanan tüm testlerin payı
        // Burada basitleştirme: cihaza atanan stok kodları arasında testin
        // payı = (testin atanan stok kodu sayısı) / (cihaza atanan toplam stok kodu sayısı)
        const testCodesOnDevice = assignedKodlar.filter((k) => testStokSet.has(k)).length;
        const weight = assignedKodlar.length > 0 ? testCodesOnDevice / assignedKodlar.length : 0;
        const deviceMonthly = deviceMonthlyCostTL(def, rates);
        deviceShareToTestTL += deviceMonthly * weight * periotAy;
      }
    }

    // Cihaz-test ataması hiç yapılmamışsa eski davranışa düş — tüm cihazlar uygun
    // kabul edilir ve cihaz maliyeti tamamen bu teste atfedilir (CAWC fallback).
    const labHasAnyAssignment = labDevices.some((d) => (d.assignedStokKodlari || []).length > 0);
    if (!labHasAnyAssignment && !hasCapacity) {
      for (const ad of labDevices) {
        const def = deviceDefs.get(ad.deviceId) || deviceDefs.get(ad.cihazId);
        const tph = Number(def?.testKapasiteSaatBasi) || 0;
        if (tph > 0) {
          monthlyTestCapacity += tph * labHours;
          eligibleDeviceCount++;
          hasCapacity = true;
          // Atama yoksa cihazın tüm aylık maliyeti bu teste düşer
          // (geriye uyumlu — fallback davranış)
          deviceShareToTestTL += deviceMonthlyCostTL(def, rates) * periotAy;
        }
      }
    }

    if (hasCapacity) {
      monthlyHours += labHours;
      labsWithCapacity++;
    }
  }

  // Yedeklilik (Redundancy) skoru — 0..1
  const redundancyScore = totalDeviceCount > 0 ? Math.min(1, eligibleDeviceCount / totalDeviceCount) : 0;
  // Reliability premium — yalnız 1 cihaz uygunsa %10 daha pahalı
  const reliabilityPremium = totalDeviceCount > 0 ? 1 + (1 - redundancyScore) * 0.1 : 1;
  // Periyot çarpanı kapasiteye de uygulanır
  const periodCapacity = monthlyTestCapacity * periotAy;
  const utilization = periodCapacity > 0 ? Math.min(1, totalStockUnits / periodCapacity) : 0;
  const idleCostTL = ortakGiderler * (1 - utilization);
  const periotHours = monthlyHours * periotAy;
  const costPerHourTL = periotHours > 0 ? ortakGiderler / periotHours : 0;
  const capacityBasedCostPerTestTL = periodCapacity > 0 ? ortakGiderler / periodCapacity : 0;

  // costMode'a göre nihai birim test maliyeti
  const costModeResolved: CostMode = inputs.costMode || 'stock';
  let finalCostPerTest = costPerTest; // stock (default)
  if (costModeResolved === 'capacity' && periodCapacity > 0) {
    finalCostPerTest = testTotalCost / periodCapacity;
  } else if (costModeResolved === 'hybrid' && periodCapacity > 0 && totalStockUnits > 0) {
    // Ürün birim maliyeti stoktan, ortak gider kapasiteden — optimistik (cihaz tam dolu çalışıyor varsayımı)
    const stockUnitCost = totalStockCostTL / totalStockUnits;
    finalCostPerTest = stockUnitCost + ortakGiderler / periodCapacity;
  }

  // CAWC modu: cihaz maliyeti atanmış testler arasında paylaşılır, kullanım dahil
  // (atama yoksa cihaz maliyetinin tamamı teste yazılır — gerçek tüketim odaklı)
  if (inputs.costMode === 'capacity' || inputs.costMode === 'hybrid') {
    // CAWC = stok birim + (deviceShareToTest + nonDeviceOrtak) / stockUnits
    if (totalStockUnits > 0) {
      const stockUnitCost = totalStockCostTL / totalStockUnits;
      // volume_weighted/equal_alloc dağıtımında pay cihaz maliyetinin altına
      // düşebilir — negatif ortak gider hesaba karışmasın.
      const nonDeviceOrtak = Math.max(0, ortakGiderler - devicePeriotTL);
      const cawcCost = stockUnitCost + (deviceShareToTestTL + nonDeviceOrtak) / totalStockUnits;
      // capacity modu CAWC kullansın (en gerçekçi), hybrid optimistik kalsın
      if (costModeResolved === 'capacity') {
        finalCostPerTest = cawcCost;
      }
    }
  }

  // Yedeklilik primi her modda uygulanır — risk-adjusted final maliyet
  finalCostPerTest = finalCostPerTest * reliabilityPremium;

  const capacity: CapacityBreakdown | undefined =
    labsWithCapacity > 0
      ? {
          monthlyHours,
          monthlyTestCapacity: periodCapacity,
          actualTestVolume: totalStockUnits,
          utilization,
          idleCostTL,
          costPerHourTL,
          capacityBasedCostPerTestTL,
          eligibleDeviceCount,
          totalDeviceCount,
          redundancyScore,
          reliabilityPremium,
          deviceShareToTestTL,
        }
      : undefined;

  if (labsWithCapacity === 0 && (costModeResolved === 'capacity' || costModeResolved === 'hybrid')) {
    warnings.push('Kapasite verisi yok (cihaz TPH veya lab çalışma saati tanımlı değil) — stok moduna düşüldü');
  }

  // Hak ediş: 0 ile "veri girilmemiş" ayrı — eksikse marj hesaplanmaz.
  const hakEdisTanimli = typeof testDef.hakEdisMiktari === 'number' && testDef.hakEdisMiktari > 0;
  const hakEdisTL = toTRY(testDef.hakEdisMiktari || 0, (testDef.currency || 'TRY') as Currency, rates);
  const marj = hakEdisTL - finalCostPerTest;
  const sparePartUnitTL = totalStockUnits > 0 ? allocSparePartTL / totalStockUnits : 0;

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
    sparePartAllocTL: allocSparePartTL,
    sparePartUnitTL,
    inventoryEntryAllocTL: allocInventoryEntryTL,
    ortakGiderlerTL: ortakGiderler,
    testTotalCostTL: testTotalCost,
    costPerTestTL: finalCostPerTest,
    hakEdisTL,
    hakEdisTanimli,
    marjTL: marj,
    perLab,
    warnings,
    periotAy,
    stockUnitCostTL,
    personnelUnitCostTL,
    // Bilgi amaçlı oran: stok + personel birim tabanına göre (personel test maliyetine DAHİL DEĞİL)
    stockSharePct:
      stockUnitCostTL + personnelUnitCostTL > 0
        ? (stockUnitCostTL / (stockUnitCostTL + personnelUnitCostTL)) * 100
        : 0,
    personnelSharePct:
      stockUnitCostTL + personnelUnitCostTL > 0
        ? (personnelUnitCostTL / (stockUnitCostTL + personnelUnitCostTL)) * 100
        : 0,
    capacity,
    costMode: costModeResolved,
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
  const { allTestDefs, assets, personnel, periot } = inputs;
  const ctx = buildTestCostContext(inputs);
  const labs = ctx.labs;

  const periotAy = periotInMonths(periot);

  let inventoryMonthlyTL = 0;
  let deviceMonthlyTL = 0;
  let personnelMonthlyTL = 0;
  let deviceCount = 0;
  let assetCount = 0;
  let personnelCount = 0;

  for (const lab of labs) {
    const shared = ctx.labShared.get(lab.id);
    if (shared) {
      inventoryMonthlyTL += shared.inventoryCostTL;
      deviceMonthlyTL += shared.deviceCostMonthlyTL;
      personnelMonthlyTL += shared.personnelCostMonthlyTL;
    }
    deviceCount += (ctx.labDevices.get(lab.id) || []).length;
    assetCount += assets.filter((a) => a.konum === lab.id || a.konum === lab.name).length;
    personnelCount += personnel.filter((p) => p.assignedLabIds?.includes(lab.id)).length;
  }

  // Basitleştirilmiş personel modeli: kişi sayısı konfigürasyondan gelir
  // (havuzlarda ana labın sayısı havuzun tamamını temsil eder — bir kez sayılır).
  if (inputs.personnelConfig) {
    const cfg = inputs.personnelConfig;
    const labIdSet = new Set(labs.map((l) => l.id));
    const countedViaPool = new Set<string>();
    personnelCount = 0;
    for (const pool of inputs.labPools || []) {
      if (pool.active === false || !pool.mainLabId) continue;
      const memberIds = [...(pool.memberIds || []), pool.mainLabId];
      if (memberIds.some((id) => labIdSet.has(id))) {
        personnelCount += Number(cfg.labCounts[pool.mainLabId]) || 0;
        memberIds.forEach((id) => countedViaPool.add(id));
      }
    }
    for (const lab of labs) {
      if (countedViaPool.has(lab.id)) continue;
      personnelCount += Number(cfg.labCounts[lab.id]) || 0;
    }
  }

  const allStokKodlari = new Set<string>();
  for (const t of allTestDefs) {
    for (const k of t.linkedStokKodlari || []) allStokKodlari.add(k);
  }

  let allStockTL = 0;
  for (const lab of labs) {
    const inner = ctx.stockIndex.get(lab.id);
    if (!inner) continue;
    for (const kod of allStokKodlari) {
      const agg = inner.get(kod);
      if (agg) allStockTL += agg.costTL;
    }
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
