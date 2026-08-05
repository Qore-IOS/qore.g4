/**
 * Ay sonu (veya periyodik) test maliyet snapshot scripti.
 *
 * Tüm `testDefinitions` belgeleri için aylık maliyet hesabını çalıştırıp
 * sonuçları `testCostSnapshots/{YYYY-MM}` dokümanı altına yazar. Cron veya
 * Firebase Functions scheduled trigger olarak çağrılabilir (örn ayın 1'i,
 * 02:00).
 *
 * Kullanım:
 *   node scripts/snapshot-test-costs.js                  # geçerli ay
 *   node scripts/snapshot-test-costs.js --month=2026-05
 *   node scripts/snapshot-test-costs.js --dry-run
 *
 * Gerekli env:
 *   GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_PROJECT_ID
 */
const admin = require('firebase-admin');
const { initAdmin } = require('./lib/firebase-project');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const monthArg = args.find((a) => a.startsWith('--month='));
const targetMonth = monthArg ? monthArg.slice('--month='.length) : currentMonthKey();

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Kimlik bilgisi ve proje kimliği çözümü scripts/lib/firebase-project.js'te
// ortaklaştırıldı: eksik/yanlış GOOGLE_APPLICATION_CREDENTIALS durumunda ham
// ENOENT yerine ne yapılacağını söyleyen bir hata verir, proje kimliğini de
// env yoksa `.firebaserc`'den çözer.
function init() {
  return initAdmin(admin, { quiet: true }).db;
}

// ────────────────────────────────────────────────────────────────────────────
// Calculator (Node-vanilla port of test-cost-calculator.ts)
// Sade versiyon: aylik periyot varsayılır, full burden modu.
// ────────────────────────────────────────────────────────────────────────────

function toTRY(amount, src, rates) {
  if (!amount || !isFinite(amount)) return 0;
  const currency = src || 'TRY';
  if (currency === 'TRY') return amount;
  if (currency === 'EUR') return amount * (rates.TRY || 0);
  if (currency === 'USD') {
    const inEur = rates.USD && rates.USD > 0 ? amount / rates.USD : 0;
    return inEur * (rates.TRY || 0);
  }
  return amount;
}

function deviceMonthlyCostTL(device, rates) {
  if (!device) return 0;
  const cur = device.maliyetCurrency || 'TRY';
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
    if (tutar > 0 && ay > 0) return toTRY(tutar / ay, cur, rates);
  }
  return 0;
}

function assetMonthlyCostTL(asset, rates) {
  const cur = asset.maliyetCurrency || 'TRY';
  let m = 0;
  if (asset.mulkiyet === 'kira' && asset.kiraTutari) {
    const donem = asset.kiraDonemi || 'aylik';
    const monthly = donem === 'yillik' ? Number(asset.kiraTutari) / 12 : Number(asset.kiraTutari);
    m += toTRY(monthly, cur, rates);
  }
  const isSatinAlma = !asset.mulkiyet || asset.mulkiyet === 'satin_alma';
  if (isSatinAlma && asset.alimFiyatiTl && asset.planliKullanimOmruYil && asset.planliKullanimOmruYil > 0) {
    m += toTRY(Number(asset.alimFiyatiTl) / (asset.planliKullanimOmruYil * 12), cur, rates);
  }
  if (asset.bakimMaliyetiTl) m += toTRY(Number(asset.bakimMaliyetiTl), cur, rates);
  return m;
}

function personnelMonthlyCostTL(p, rates) {
  if (!p.aktif) return 0;
  const total = (Number(p.aylikBrutMaas) || 0) + (Number(p.aylikYanHaklar) || 0);
  return toTRY(total, p.currency, rates);
}

function computeLabSharedCosts(labId, labName, assignedDevices, deviceDefs, assets, personnel, rates) {
  let deviceCost = 0;
  for (const ad of assignedDevices.filter((d) => d.hastaneId === labId)) {
    const def = deviceDefs.get(ad.deviceId) || deviceDefs.get(ad.cihazId);
    deviceCost += deviceMonthlyCostTL(def, rates);
  }
  let inventoryCost = 0;
  for (const a of assets) {
    if (a.konum !== labId && a.konum !== labName) continue;
    inventoryCost += assetMonthlyCostTL(a, rates);
  }
  let personnelCost = 0;
  for (const p of personnel) {
    if (!p.assignedLabIds?.includes(labId)) continue;
    personnelCost += personnelMonthlyCostTL(p, rates);
  }
  return { inventoryCost, deviceCost, personnelCost };
}

function computeStockForLab(labId, stokKodlari, productMap, depoStok, rates) {
  let units = 0;
  let costTL = 0;
  for (const item of depoStok) {
    if (!item.isShipped) continue;
    if (item.hedefKurumId !== labId) continue;
    if (!stokKodlari.has(item.stokKodu)) continue;
    const product = productMap.get(item.stokKodu);
    if (!product) continue;
    const ambalaj = Number(product.ambalajDegeri) || 0;
    const birim = toTRY(Number(product.cost) || 0, product.currency, rates);
    units += ambalaj;
    costTL += birim;
  }
  return { units, costTL };
}

// ────────────────────────────────────────────────────────────────────────────

async function fetchAll(db) {
  const [
    productsSnap,
    labsSnap,
    devicesSnap,
    assignedSnap,
    assetsSnap,
    personnelSnap,
    stokSnap,
    testsSnap,
    ratesSnap,
  ] = await Promise.all([
    db.collection('productCodes').get(),
    db.collection('hospitals').get(),
    db.collection('devices').get(),
    db.collection('hospitalDeviceAssignments').get(),
    db.collection('assets').get(),
    db.collection('personnel').get(),
    db.collection('depoStok').where('isShipped', '==', true).get(),
    db.collection('testDefinitions').get(),
    db.collection('exchangeRates').doc('latest').get(),
  ]);

  const productMap = new Map();
  productsSnap.docs.forEach((d) => {
    const data = d.data();
    productMap.set(data.stokKodu, { id: d.id, ...data });
  });

  const labs = labsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const deviceDefs = new Map();
  devicesSnap.docs.forEach((d) => deviceDefs.set(d.id, { id: d.id, ...d.data() }));
  const assignedDevices = assignedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const assets = assetsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const personnel = personnelSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const depoStok = stokSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const testDefs = testsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const rates = ratesSnap.exists ? ratesSnap.data() : { EUR: 1, USD: 1.08, TRY: 38.5 };

  return { productMap, labs, deviceDefs, assignedDevices, assets, personnel, depoStok, testDefs, rates };
}

async function main() {
  const db = init();
  console.log(`[snapshot] target month: ${targetMonth}, mode: ${DRY_RUN ? 'DRY-RUN' : 'WRITE'}`);

  const data = await fetchAll(db);
  console.log(
    `[snapshot] data: ${data.testDefs.length} test, ${data.labs.length} lab, ${data.deviceDefs.size} cihaz, ${data.assets.length} envanter, ${data.personnel.length} personel, ${data.depoStok.length} stok satırı`,
  );

  // Lab başına ortak giderler (cache)
  const labShared = new Map();
  for (const lab of data.labs) {
    labShared.set(
      lab.id,
      computeLabSharedCosts(
        lab.id,
        lab.name,
        data.assignedDevices,
        data.deviceDefs,
        data.assets,
        data.personnel,
        data.rates,
      ),
    );
  }

  // Toplam (tüm test stokları)
  const allStokKodlari = new Set();
  for (const t of data.testDefs) for (const k of t.linkedStokKodlari || []) allStokKodlari.add(k);
  let allStockTL = 0;
  let totalInventoryTL = 0;
  let totalDeviceTL = 0;
  let totalPersonnelTL = 0;
  for (const lab of data.labs) {
    const sh = labShared.get(lab.id);
    totalInventoryTL += sh.inventoryCost;
    totalDeviceTL += sh.deviceCost;
    totalPersonnelTL += sh.personnelCost;
    const st = computeStockForLab(lab.id, allStokKodlari, data.productMap, data.depoStok, data.rates);
    allStockTL += st.costTL;
  }
  const realTotalSpend = totalInventoryTL + totalDeviceTL + totalPersonnelTL + allStockTL;

  // Test bazlı kırılım
  const testResults = [];
  for (const t of data.testDefs) {
    const stokKodlari = new Set(t.linkedStokKodlari || []);
    let testUnits = 0;
    let testStock = 0;
    for (const lab of data.labs) {
      const st = computeStockForLab(lab.id, stokKodlari, data.productMap, data.depoStok, data.rates);
      testUnits += st.units;
      testStock += st.costTL;
    }
    const ortakGiderler = totalInventoryTL + totalDeviceTL + totalPersonnelTL + (allStockTL - testStock);
    const testTotal = testStock + ortakGiderler;
    const costPerTest = testUnits > 0 ? testTotal / testUnits : 0;
    const hakEdis = toTRY(t.hakEdisMiktari || 0, t.currency || 'TRY', data.rates);

    testResults.push({
      testId: t.id,
      sutKodu: t.sutKodu,
      sutTestAdi: t.sutTestAdi,
      linkedStokKodlari: t.linkedStokKodlari || [],
      totalTestUnits: testUnits,
      stockCostTL: testStock,
      ortakGiderlerTL: ortakGiderler,
      testTotalCostTL: testTotal,
      costPerTestTL: costPerTest,
      hakEdisTL: hakEdis,
      marjTL: hakEdis - costPerTest,
    });
  }

  console.log(`[snapshot] ${testResults.length} test sonucu hesaplandı`);

  const snapshot = {
    monthKey: targetMonth,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    periotAy: 1,
    summary: {
      realTotalSpendTL: realTotalSpend,
      inventoryCostTL: totalInventoryTL,
      deviceCostMonthlyTL: totalDeviceTL,
      personnelCostMonthlyTL: totalPersonnelTL,
      allStockCostTL: allStockTL,
      counts: {
        labs: data.labs.length,
        devices: data.assignedDevices.length,
        assets: data.assets.length,
        personnel: data.personnel.length,
        tests: data.testDefs.length,
      },
    },
    rates: data.rates,
    tests: testResults,
  };

  if (DRY_RUN) {
    console.log(JSON.stringify(snapshot.summary, null, 2));
    console.log('[snapshot] DRY-RUN — write skipped');
    return;
  }

  await db.collection('testCostSnapshots').doc(targetMonth).set(snapshot);
  console.log(`[snapshot] testCostSnapshots/${targetMonth} yazıldı`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[snapshot] FAILED', e);
    process.exit(1);
  });
