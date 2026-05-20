import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateTestCost,
  calculateSystemTotal,
  deviceMonthlyCostTL,
  toTRY,
} from '../src/lib/test-cost-calculator';

// Test mock'larında augmentation/types.ts arası TimestampLike çakışmasını bypass etmek için any kullanılır.
// Hesap motoru testlerinin amacı sayısal doğrulamadır, tip uyumu değil.
type Any = any;
type Currency = 'EUR' | 'USD' | 'TRY';

/**
 * Kullanıcının verdiği senaryo:
 *
 * - x testi → a ürünü (kutu maliyeti 200 TL, ambalaj 200 test)
 * - 10 laboratuvar; her labda 5 kutu a ürünü = 50 kutu = 10.000 test
 * - Stok maliyeti = 50 × 200 = 10.000 TL
 * - Her labda 1 bilgisayar (1000 TL) + 1 barkod okuyucu (200 TL) = 1.200 TL × 10 = 12.000 TL envanter
 *   (Asset.alimFiyatiTl + planliKullanimOmruYil=1 → aylık karşılık tutarsız olur; test sadeleştirmesi:
 *    bakimMaliyetiTl alanında 100 TL aylık asset → 100 × 12 envanter = test için skip,
 *    BURADA EŞYALARI BİR DEFAYA MAHSUS amortismansız varsayıyoruz: bakimMaliyetiTl=alimFiyatiTl)
 * - Her labda 2 cihaz × 45.000 TL/ay kira = 90.000 × 10 = 900.000 TL/ay
 * - Her labda 2 personel × 60.000 TL/ay = 120.000 × 10 = 1.200.000 TL/ay
 * - Grand total = 10K + 12K + 900K + 1.200K = 2.122.000 TL
 * - Birim test maliyeti = 2.122.000 / 10.000 = 212,2 TL/test
 */

const rates: Record<Currency, number> = { EUR: 1, USD: 1.08, TRY: 38.5 };

// 10 laboratuvar
const labs: Any[] = Array.from({ length: 10 }, (_, i) => ({
  id: `lab${i + 1}`,
  name: `Lab ${i + 1}`,
}));

// A ürünü
const productA: Any = {
  id: 'pA',
  stokKodu: 'A',
  stokAdi: 'A Ürünü',
  ambalajDegeri: 200,
  cost: 200,
  currency: 'TRY',
};
const productMap: Any = new Map([['A', productA]]);

// 50 kutu DepoStokItem (her lab başına 5 kutu)
const depoStok: Any[] = [];
for (const lab of labs) {
  for (let k = 0; k < 5; k++) {
    depoStok.push({
      id: `${lab.id}-A-${k}`,
      stokKodu: 'A',
      stokAdi: 'A Ürünü',
      miad: '01.01.2030' as any,
      isShipped: true,
      hedefKurum: lab.name,
      hedefKurumId: lab.id,
      urunGrubu: 'kit',
      ambalajDegeri: 200,
    });
  }
}

// Her labda 1 bilgisayar + 1 barkod okuyucu
// Asset.bakimMaliyetiTl'i aylık 100 TL (= 1200/12) yapacağız ki test eski "12.000 TL toplam envanter" değerine geleceğiz.
// Daha doğru senaryo: 1 yıllık planliKullanimOmruYil ile bir defalık 1200 TL → 1200/12 = 100 TL/ay → 100 × 10 lab = 1000 TL/ay
// Ama bizim mevcut testimiz 12.000 TL'lik bir defalık değer gibi davranıyor. Bunu birebir karşılayan model:
//   alimFiyatiTl=1200, planliKullanimOmruYil=1/12 değil — kabul edilemez.
// Bunun yerine bakimMaliyetiTl=1200 (aylık) koyalım → toplam 12.000 TL/ay envanter olur (kullanıcının değerine eşit).
const assets: Any[] = [];
for (const lab of labs) {
  assets.push({
    id: `${lab.id}-bilg`,
    category: 'bilgisayar',
    demirbasNo: `${lab.id}-bilg`,
    urunKodu: '',
    urunAdi: 'Bilgisayar',
    marka: '',
    model: '',
    konum: lab.id,
    bakimMaliyetiTl: 1000,
    teslimEdilenPersonel: '',
    aciklama: '',
  });
  assets.push({
    id: `${lab.id}-bark`,
    category: 'barkod',
    demirbasNo: `${lab.id}-bark`,
    urunKodu: '',
    urunAdi: 'Barkod Okuyucu',
    marka: '',
    model: '',
    konum: lab.id,
    bakimMaliyetiTl: 200,
    teslimEdilenPersonel: '',
    aciklama: '',
  });
}

// Her labda 2 cihaz (q model, c markası) × 45.000 TL/ay kira
const deviceDefs: Any = new Map([
  [
    'dev1',
    {
      id: 'dev1',
      brand: 'c',
      model: 'q',
      imageUrl: '',
      mulkiyet: 'kira',
      aylikKira: 45000,
      maliyetCurrency: 'TRY',
    },
  ],
]);
const assignedDevices: Any[] = [];
for (const lab of labs) {
  for (let d = 0; d < 2; d++) {
    assignedDevices.push({
      cihazId: 'dev1',
      id: `${lab.id}-dev-${d}`,
      deviceId: 'dev1',
      name: 'c q',
      serial: `${lab.id}-${d}`,
      hastaneId: lab.id,
    });
  }
}

// Her labda 2 personel × 60.000 TL/ay
const personnel: Any[] = [];
for (const lab of labs) {
  for (let p = 0; p < 2; p++) {
    personnel.push({
      id: `${lab.id}-pers-${p}`,
      adSoyad: `Personel ${lab.id} ${p}`,
      assignedLabIds: [lab.id],
      aylikBrutMaas: 60000,
      currency: 'TRY',
      aktif: true,
    });
  }
}

// X testi tanımı
const testX: Any = {
  id: 'testX',
  sutKodu: '900.010',
  sutTestAdi: 'X Testi',
  linkedStokKodlari: ['A'],
  hakEdisMiktari: 0,
  aktif: true,
  createdAt: null,
};

const baseInputs: Any = {
  testDef: testX,
  allTestDefs: [testX],
  productMap,
  labs,
  assignedDevices,
  deviceDefs,
  assets,
  personnel,
  depoStok,
  rates,
};

test('toTRY: TRY tutarı aynen döner', () => {
  assert.equal(toTRY(100, 'TRY', rates), 100);
});

test('toTRY: EUR → TRY', () => {
  assert.equal(toTRY(10, 'EUR', rates), 385);
});

test('deviceMonthlyCostTL: kira mulkiyet aylık kirayı döner', () => {
  const dev: Any = {
    id: 'd',
    brand: 'c',
    model: 'q',
    imageUrl: '',
    mulkiyet: 'kira',
    aylikKira: 45000,
    maliyetCurrency: 'TRY',
  };
  assert.equal(deviceMonthlyCostTL(dev, rates), 45000);
});

test('deviceMonthlyCostTL: satin_alma amortismanlı aylık karşılık', () => {
  const dev: Any = {
    id: 'd',
    brand: 'c',
    model: 'q',
    imageUrl: '',
    mulkiyet: 'satin_alma',
    satinAlmaTutari: 600000,
    amortismanAyi: 60,
    maliyetCurrency: 'TRY',
  };
  assert.equal(deviceMonthlyCostTL(dev, rates), 10000);
});

test('Kullanıcı senaryosu: X testi maliyet kırılımı', () => {
  const r = calculateTestCost(baseInputs);

  // Toplam test adedi: 50 kutu × 200 ambalaj = 10.000
  assert.equal(r.totalTestUnits, 10000);
  // Stok maliyeti: 50 × 200 TL = 10.000 TL
  assert.equal(r.stockCostTL, 10000);
  // Envanter: 10 lab × (1000 + 200) = 12.000 TL/ay
  assert.equal(r.inventoryCostTL, 12000);
  // Cihaz: 10 lab × 2 × 45.000 = 900.000 TL/ay
  assert.equal(r.deviceCostMonthlyTL, 900000);
  // Personel: 10 lab × 2 × 60.000 = 1.200.000 TL/ay
  assert.equal(r.personnelCostMonthlyTL, 1200000);
  // Tek test olduğundan diğer testlerin stoğu = 0
  assert.equal(r.otherTestsStockCostTL, 0);

  // Full burden: total = grand total = stok + envanter + cihaz + personel
  // = 10.000 + 12.000 + 900.000 + 1.200.000 = 2.122.000
  assert.equal(r.testTotalCostTL, 2122000);
  assert.equal(r.ortakGiderlerTL, 2112000); // 2.122.000 - 10.000

  // Birim test maliyeti = 2.122.000 / 10.000 = 212,2 TL
  assert.equal(r.costPerTestTL, 212.2);

  // Her lab perLab'da olmalı
  assert.equal(r.perLab.length, 10);
});

test('Kullanıcı senaryosu: 2 test arasında full-burden mantığı', () => {
  // İkinci test B ürünü ile, lab1'de 2 kutu × 100 ambalaj = 200 test, 2 × 50 TL = 100 TL stok
  const productB: Any = {
    id: 'pB',
    stokKodu: 'B',
    stokAdi: 'B Ürünü',
    ambalajDegeri: 100,
    cost: 50,
    currency: 'TRY',
  };
  const productMap2 = new Map<string, Any>([
    ['A', productA],
    ['B', productB],
  ]);
  const depoStok2: Any[] = [...depoStok];
  // Sadece lab1'e 2 kutu B
  for (let k = 0; k < 2; k++) {
    depoStok2.push({
      id: `lab1-B-${k}`,
      stokKodu: 'B',
      stokAdi: 'B Ürünü',
      miad: '01.01.2030' as any,
      isShipped: true,
      hedefKurum: 'Lab 1',
      hedefKurumId: 'lab1',
      urunGrubu: 'kit',
      ambalajDegeri: 100,
    });
  }

  const testY: Any = {
    id: 'testY',
    sutKodu: '900.020',
    sutTestAdi: 'Y Testi',
    linkedStokKodlari: ['B'],
    hakEdisMiktari: 0,
    aktif: true,
    createdAt: null,
  };

  const inputsX: Any = {
    ...baseInputs,
    productMap: productMap2,
    depoStok: depoStok2,
    allTestDefs: [testX, testY],
  };
  const rX = calculateTestCost(inputsX);

  // X için stok = 10.000, diğer testin stoğu = 2 × 50 = 100 TL
  assert.equal(rX.stockCostTL, 10000);
  assert.equal(rX.otherTestsStockCostTL, 100);
  // Grand total = 10.000 + 100 + 12.000 + 900.000 + 1.200.000 = 2.122.100
  assert.equal(rX.testTotalCostTL, 2122100);
  // X'in birim maliyeti = 2.122.100 / 10.000 = 212,21
  assert.equal(rX.costPerTestTL, 212.21);

  // Şimdi Y testi için
  const inputsY: Any = {
    ...inputsX,
    testDef: testY,
  };
  const rY = calculateTestCost(inputsY);
  // Y için stok = 100 TL, diğer testin (X) stoğu = 10.000 TL
  assert.equal(rY.stockCostTL, 100);
  assert.equal(rY.otherTestsStockCostTL, 10000);
  // Grand total aynı: 2.122.100
  assert.equal(rY.testTotalCostTL, 2122100);
  // Y'nin test adedi: 2 × 100 = 200
  assert.equal(rY.totalTestUnits, 200);
  // Y'nin birim maliyeti = 2.122.100 / 200 = 10.610,5 TL
  assert.equal(rY.costPerTestTL, 10610.5);
});

test('Sistem geneli: ortak giderler TEK SEFER + tüm stoklar', () => {
  const productB: Any = {
    id: 'pB',
    stokKodu: 'B',
    stokAdi: 'B Ürünü',
    ambalajDegeri: 100,
    cost: 50,
    currency: 'TRY',
  };
  const productMap2 = new Map<string, Any>([
    ['A', productA],
    ['B', productB],
  ]);
  const depoStok2: Any[] = [...depoStok];
  for (let k = 0; k < 2; k++) {
    depoStok2.push({
      id: `lab1-B-${k}`,
      stokKodu: 'B',
      stokAdi: 'B Ürünü',
      miad: '01.01.2030' as any,
      isShipped: true,
      hedefKurum: 'Lab 1',
      hedefKurumId: 'lab1',
      urunGrubu: 'kit',
      ambalajDegeri: 100,
    });
  }
  const testY: Any = {
    id: 'testY',
    sutKodu: '900.020',
    sutTestAdi: 'Y Testi',
    linkedStokKodlari: ['B'],
    hakEdisMiktari: 0,
    aktif: true,
    createdAt: null,
  };

  const sys = calculateSystemTotal({
    allTestDefs: [testX, testY],
    productMap: productMap2,
    labs,
    assignedDevices,
    deviceDefs,
    assets,
    personnel,
    depoStok: depoStok2,
    rates,
  });

  // Cihaz + envanter + personel TEK SEFER:
  assert.equal(sys.inventoryCostTL, 12000);
  assert.equal(sys.deviceCostMonthlyTL, 900000);
  assert.equal(sys.personnelCostMonthlyTL, 1200000);
  // Tüm stoklar: 10.000 (A) + 100 (B) = 10.100
  assert.equal(sys.allStockCostTL, 10100);
  // Real total = 12.000 + 900.000 + 1.200.000 + 10.100 = 2.122.100
  assert.equal(sys.realTotalSpendTL, 2122100);
});

test('Periyot: yıllık → ortak giderler × 12, stok değişmez', () => {
  const r = calculateTestCost({ ...baseInputs, periot: { type: 'yillik' } });
  // Yıllık ortak giderler:
  //   envanter: 12.000 × 12 = 144.000
  //   cihaz: 900.000 × 12 = 10.800.000
  //   personel: 1.200.000 × 12 = 14.400.000
  //   stok (anlık): 10.000 (değişmez)
  // Grand: 10.000 + 144.000 + 10.800.000 + 14.400.000 = 25.354.000
  assert.equal(r.stockCostTL, 10000);
  assert.equal(r.inventoryCostTL, 144000);
  assert.equal(r.deviceCostMonthlyTL, 10800000);
  assert.equal(r.personnelCostMonthlyTL, 14400000);
  assert.equal(r.testTotalCostTL, 25354000);
  assert.equal(r.periotAy, 12);
});

test('Periyot: günlük → ortak giderler ÷ 30', () => {
  const r = calculateTestCost({ ...baseInputs, periot: { type: 'gunluk' } });
  // Günlük: envanter 12.000/30 = 400, cihaz 30.000, personel 40.000, stok 10.000
  // Grand: 10.000 + 400 + 30.000 + 40.000 = 80.400
  assert.equal(r.inventoryCostTL, 400);
  assert.equal(r.deviceCostMonthlyTL, 30000);
  assert.equal(r.personnelCostMonthlyTL, 40000);
  assert.equal(r.testTotalCostTL, 80400);
});

test('Lab filtresi: sadece lab1 → ortak giderler 1/10', () => {
  const r = calculateTestCost({ ...baseInputs, filterLabIds: ['lab1'] });
  // 1 lab: stok 5 kutu × 200 ambalaj = 1.000 test, 5 × 200 TL = 1.000 TL stok
  //         envanter 1.200, cihaz 90.000, personel 120.000
  //         Grand: 1.000 + 1.200 + 90.000 + 120.000 = 212.200
  assert.equal(r.totalTestUnits, 1000);
  assert.equal(r.stockCostTL, 1000);
  assert.equal(r.inventoryCostTL, 1200);
  assert.equal(r.deviceCostMonthlyTL, 90000);
  assert.equal(r.personnelCostMonthlyTL, 120000);
  assert.equal(r.testTotalCostTL, 212200);
  assert.equal(r.costPerTestTL, 212.2);
  assert.equal(r.perLab.length, 1);
});

test('Asset: satın alma + omur yıl → aylık amortisman', () => {
  // Bir asset: 1.200 TL alım, 5 yıl ömür → aylık 1.200/(5×12) = 20 TL
  const localAssets: Any[] = [{
    id: 'a1', category: 'bilgisayar', demirbasNo: 'A1', urunAdi: 'Bilgisayar',
    konum: 'lab1',
    alimFiyatiTl: 1200,
    planliKullanimOmruYil: 5,
    mulkiyet: 'satin_alma',
    teslimEdilenPersonel: '', aciklama: '',
  }];
  const r = calculateTestCost({
    ...baseInputs,
    assets: localAssets,
    filterLabIds: ['lab1'],
    assignedDevices: [],
    deviceDefs: new Map(),
    personnel: [],
  });
  // Stok lab1 için 1.000 TL (5 kutu × 200 TL), 1.000 test adedi
  // Envanter: 20 TL/ay
  // Grand: 1.000 + 20 = 1.020
  // Birim: 1.020 / 1.000 = 1,02 TL
  assert.equal(r.inventoryCostTL, 20);
  assert.equal(r.stockCostTL, 1000);
  assert.equal(r.totalTestUnits, 1000);
  assert.equal(r.testTotalCostTL, 1020);
  assert.equal(r.costPerTestTL, 1.02);
});

test('Asset: kira yıllık → aylık olarak ÷12', () => {
  const localAssets: Any[] = [{
    id: 'a1', category: 'bilgisayar', demirbasNo: 'A1', urunAdi: 'Bilgisayar',
    konum: 'lab1',
    mulkiyet: 'kira',
    kiraTutari: 12000,
    kiraDonemi: 'yillik',
    maliyetCurrency: 'TRY',
    teslimEdilenPersonel: '', aciklama: '',
  }];
  const r = calculateTestCost({
    ...baseInputs,
    assets: localAssets,
    filterLabIds: ['lab1'],
    assignedDevices: [],
    deviceDefs: new Map(),
    personnel: [],
  });
  // Asset aylık: 12.000/12 = 1.000 TL
  // Stok lab1: 1.000 TL, 1.000 test adedi
  // Grand: 1.000 + 1.000 = 2.000
  assert.equal(r.inventoryCostTL, 1000);
  assert.equal(r.testTotalCostTL, 2000);
});

test('Cihaz: kira yıllık → aylık olarak ÷12', () => {
  const localDevDefs: Any = new Map([['d1', {
    id: 'd1', brand: 'c', model: 'q', imageUrl: '',
    mulkiyet: 'kira', aylikKira: 540000, kiraDonemi: 'yillik', maliyetCurrency: 'TRY',
  }]]);
  const r = calculateTestCost({
    ...baseInputs,
    deviceDefs: localDevDefs,
    assignedDevices: [{ cihazId: 'd1', id: 'lab1-d1', deviceId: 'd1', name: 'c q', serial: 'x', hastaneId: 'lab1' }],
    assets: [],
    personnel: [],
    filterLabIds: ['lab1'],
  });
  // Cihaz aylık: 540.000/12 = 45.000 TL
  assert.equal(r.deviceCostMonthlyTL, 45000);
});

test('Kapasite: TPH ve lab çalışma saati varsa utilization & idle hesaplanır', () => {
  // 1 lab + 1 cihaz × 100 test/saat, 8 saat × 22 gün = ~174 saat → ~17.400 test/ay kapasite
  const localLabs: Any[] = [{ id: 'lab1', name: 'Lab 1', calismaSaatleri: { haftaIciStart: '08:00', haftaIciEnd: '16:00', haftaIciGunleri: ['pzt', 'sal', 'cars', 'pers', 'cum'] } }];
  const localDevDefs: Any = new Map([['d1', { id: 'd1', brand: 'c', model: 'q', imageUrl: '', mulkiyet: 'kira', aylikKira: 45000, maliyetCurrency: 'TRY', testKapasiteSaatBasi: 100 }]]);
  const localAssigned: Any[] = [{ cihazId: 'd1', id: 'lab1-d1', deviceId: 'd1', name: 'c q', serial: 'x', hastaneId: 'lab1' }];
  // 5 kutu × 200 ambalaj = 1.000 test stoğu
  const localStok: Any[] = [];
  for (let k = 0; k < 5; k++) {
    localStok.push({ id: `lab1-A-${k}`, stokKodu: 'A', stokAdi: 'A Ürünü', miad: '01.01.2030', isShipped: true, hedefKurum: 'Lab 1', hedefKurumId: 'lab1', urunGrubu: 'kit', ambalajDegeri: 200 });
  }
  const r = calculateTestCost({
    ...baseInputs,
    labs: localLabs,
    deviceDefs: localDevDefs,
    assignedDevices: localAssigned,
    depoStok: localStok,
    assets: [],
    personnel: [],
  });
  assert.ok(r.capacity, 'capacity tanımlı olmalı');
  // 8 saat × 5 gün × 4.34 hafta = ~173.6 saat
  assert.ok(Math.abs((r.capacity?.monthlyHours || 0) - 173.6) < 1, 'monthlyHours ≈ 174');
  // 100 × 173.6 = 17.360 test kapasitesi
  assert.ok(Math.abs((r.capacity?.monthlyTestCapacity || 0) - 17360) < 10, 'monthly capacity ≈ 17.360');
  // utilization = 1000/17360 ≈ 0.0576
  assert.ok(r.capacity!.utilization > 0.05 && r.capacity!.utilization < 0.07);
  // idle cost = ortakGiderler × (1 - 0.0576) ≈ %94.2'si
  assert.ok(r.capacity!.idleCostTL > r.ortakGiderlerTL * 0.9);
});

test('Acil lab: 7/24 → 720 saat/ay kapasite', () => {
  const localLabs: Any[] = [{ id: 'lab1', name: 'Lab 1', acilStatusu: true }];
  const localDevDefs: Any = new Map([['d1', { id: 'd1', brand: 'c', model: 'q', imageUrl: '', testKapasiteSaatBasi: 50 }]]);
  const localAssigned: Any[] = [{ cihazId: 'd1', id: 'lab1-d1', deviceId: 'd1', name: 'c q', serial: 'x', hastaneId: 'lab1' }];
  const r = calculateTestCost({
    ...baseInputs,
    labs: localLabs,
    deviceDefs: localDevDefs,
    assignedDevices: localAssigned,
    depoStok: [],
    assets: [],
    personnel: [],
  });
  assert.equal(r.capacity?.monthlyHours, 720);
  // 50 × 720 = 36.000 test kapasitesi
  assert.equal(r.capacity?.monthlyTestCapacity, 36000);
});

test('Hybrid mod: ürün maliyeti stoktan, ortak gider kapasiteden', () => {
  // 1 lab + cihaz TPH=200 + lab 174 saat → 34.800 kapasite
  // 5 kutu × 200 = 1.000 test stoğu, 5 × 200 = 1.000 TL stok
  const localLabs: Any[] = [{ id: 'lab1', name: 'Lab 1' }]; // varsayılan ~174 saat
  const localDevDefs: Any = new Map([['d1', { id: 'd1', brand: 'c', model: 'q', imageUrl: '', mulkiyet: 'kira', aylikKira: 45000, maliyetCurrency: 'TRY', testKapasiteSaatBasi: 200 }]]);
  const localAssigned: Any[] = [{ cihazId: 'd1', id: 'lab1-d1', deviceId: 'd1', hastaneId: 'lab1', name: 'c q', serial: 'x' }];
  const localStok: Any[] = [];
  for (let k = 0; k < 5; k++) {
    localStok.push({ id: `lab1-A-${k}`, stokKodu: 'A', stokAdi: 'A Ürünü', miad: '01.01.2030', isShipped: true, hedefKurum: 'Lab 1', hedefKurumId: 'lab1', urunGrubu: 'kit', ambalajDegeri: 200 });
  }
  const r = calculateTestCost({
    ...baseInputs,
    labs: localLabs,
    deviceDefs: localDevDefs,
    assignedDevices: localAssigned,
    depoStok: localStok,
    assets: [],
    personnel: [],
    costMode: 'hybrid',
  });
  // stok birim = 1.000 / 1.000 = 1 TL
  // ortak gider = 45.000 (cihaz aylık)
  // kapasite = 200 × 173.6 = 34.720
  // hybrid birim = 1 + 45.000/34.720 ≈ 2.296
  assert.ok(r.costPerTestTL > 2 && r.costPerTestTL < 3, `hybrid ≈ 2.3 TL, gerçek: ${r.costPerTestTL}`);
});
