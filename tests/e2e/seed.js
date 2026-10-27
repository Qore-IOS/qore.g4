#!/usr/bin/env node
/**
 * E2E emülatörüne temel veriyi tohumlar.
 *
 * Uygulama açılabilmek için asgari bir veri kümesine ihtiyaç duyar: oturum
 * açabilen bir kullanıcı, o kullanıcının şirketi, bir kaynak deposu, bir hedef
 * laboratuvarı, ürün kodları ve barkod formatları. Bunlar olmadan paneller
 * "sistem hazırlanıyor" durumunda takılı kalır.
 *
 * ŞİRKET KAPSAMI KRİTİKTİR
 *
 * Firestore kuralları `request.auth.token.companyId` ile doküman
 * `companyId`sini karşılaştırır. Tohumlanan her doküman `E2E_COMPANY_ID`
 * taşır ve kullanıcıya AYNI değer özel talep (custom claim) olarak yazılır.
 * İkisi ayrışırsa uygulama açılır ama her sorgu `permission-denied` alır —
 * ve bu, testte "veri yok" gibi görünür. Bu yüzden ikisi tek yerden gelir.
 *
 * Admin SDK emülatörde kuralları BYPASS eder; tohumlama her hâlükârda yazar.
 * Kuralların gerçekten doğru olduğunu, uygulamanın istemci SDK'sıyla okuduğu
 * testin kendisi kanıtlar.
 */

const admin = require('../../scripts/db/script-store.cjs');

const PROJECT_ID = process.env.E2E_PROJECT_ID || 'qore-e2e';
const COMPANY_ID = '__legacy__';

const USER = {
  uid: 'e2e-user-0001',
  email: 'e2e@qore.test',
  password: 'e2e-parola-123',
  name: 'E2E Test Kullanıcısı',
};

const DEPOT = { id: 'e2e-depo', name: 'E2E Merkez Depo' };
const LAB = { id: 'e2e-lab', name: 'E2E Laboratuvar' };

/**
 * Ürün kodları — biri seri takipli, biri lot/adet takipli.
 * İkisi de gerekli: transfer paneli iki takip modunu farklı kod yollarıyla
 * işler ve tek moda bakan bir test ötekini regresyona açık bırakır.
 */
const PRODUCTS = [
  { stokKodu: 'E2E-KIT-001', stokAdi: 'E2E Test Kiti (seri takipli)', trackingMode: 'serial', ambalajDegeri: 1 },
  { stokKodu: 'E2E-LOT-002', stokAdi: 'E2E Sarf Malzemesi (lot takipli)', trackingMode: 'lot_manual', ambalajDegeri: 10 },
];

/**
 * Basit konumsal barkod formatı.
 *
 * Gerçek Roche/GS1 formatlarını kopyalamak yerine, alanları açıkça belli olan
 * sabit uzunlukta bir format tanımlanır: testin okuduğu barkodun neyi ifade
 * ettiği tek bakışta anlaşılır ve format değişse bile test kırılmaz.
 *
 *   pozisyon  0-10   referans (stok kodu)   11 hane
 *   pozisyon 11-16   lot                     6 hane
 *   pozisyon 17-22   miad (yyMMdd)           6 hane
 *   pozisyon 23-32   seri                   10 hane
 */
const BARCODE_FORMAT = {
  id: 'e2e-positional',
  name: 'E2E Konumsal Format',
  strategy: 'positional',
  active: true,
  priority: 1,
  totalLength: 33,
  reference: { start: 0, length: 11 },
  lot: { start: 11, length: 6 },
  expiry: { start: 17, length: 6, pattern: 'yyMMdd' },
  serial: { start: 23, length: 10 },
  trackSerial: true,
  trackLot: true,
  parseTarget: 'reference',
};

/** Yukarıdaki formata göre kurulmuş, testlerin okuttuğu barkodlar. */
const BARCODES = {
  seriliKit: 'E2E-KIT-001' + 'LOT001' + '271231' + 'SN00000001',
  lotluSarf: 'E2E-LOT-002' + 'LOT777' + '270630' + 'SN00000002',
};

/** Uygulamanın tanıdığı tüm panel anahtarları — kullanıcı her yeri görebilsin. */
const ACCESSIBLE_VIEWS = [
  'dashboard', 'mal-kabul', 'stok-yonetimi', 'siparisler', 'laboratuvar-yonetimi',
  'direkt-transfer', 'urun-kullanim', 'depo-sayim', 'yonetim', 'arama',
];

async function tohumla() {
  if (!['127.0.0.1','localhost'].includes(new URL(process.env.APP_BASE_URL || '').hostname)) throw new Error('E2E fixtures require a loopback API.');
  const db=admin.firestore();
  const scope = { companyId: COMPANY_ID };

  await db.collection('users').doc(USER.uid).set({
    ...scope,
    uid: USER.uid,
    email: USER.email,
    name: USER.name,
    role: 'admin',
    accessibleViews: ACCESSIBLE_VIEWS,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ── ana veri ───────────────────────────────────────────────────────────
  await db.collection('depots').doc(DEPOT.id).set({ ...scope, name: DEPOT.name });

  await db.collection('hospitals').doc(LAB.id).set({
    ...scope,
    name: LAB.name,
    consumptionTrackingEnabled: true,
    fefoEnabled: true,
  });

  for (const p of PRODUCTS) {
    await db.collection('productCodes').doc(p.stokKodu).set({ ...scope, ...p });
  }

  await db.collection('barcodeFormats').doc(BARCODE_FORMAT.id).set({ ...scope, ...BARCODE_FORMAT });

  console.log(`Tohumlandı: şirket=${COMPANY_ID} kullanıcı=${USER.email} depo=${DEPOT.name} lab=${LAB.name}`);
  console.log(`Barkodlar: ${BARCODES.seriliKit} | ${BARCODES.lotluSarf}`);
}

/** Test dosyalarının aynı sabitleri kullanabilmesi için dışa aktarılır. */
module.exports = { PROJECT_ID, COMPANY_ID, USER, DEPOT, LAB, PRODUCTS, BARCODES, tohumla };

if (require.main === module) {
  tohumla().then(() => process.exit(0)).catch(err => {
    console.error('Tohumlama başarısız:', err);
    process.exit(1);
  });
}
