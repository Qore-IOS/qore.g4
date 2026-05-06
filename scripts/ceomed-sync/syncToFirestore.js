/**
 * Ceomed ERP'den irsaliye + barkod çekip Firestore'a "pendingCeomedIrsaliye" koleksiyonuna yazar.
 *
 * Kullanım:
 *   node syncToFirestore.js <BASLANGIC dd.MM.yyyy> <BITIS dd.MM.yyyy> [--status="KURUMA SEVK EDILDI"]
 *
 * Gerekli env:
 *   CEOMED_BASE_URL, CEOMED_EPOSTA, CEOMED_PAROLA
 *   GOOGLE_APPLICATION_CREDENTIALS  -> service account JSON path
 *   FIREBASE_PROJECT_ID             -> Firebase project id
 */
const admin = require('firebase-admin');
const { login } = require('./login');
const { fetchIrsaliyeMaster } = require('./fetchIrsaliyeMaster');
const { fetchOkutulanBarkod } = require('./fetchOkutulanBarkod');

const ALLOWED_STATUSES = [
  'KURUMA SEVK EDILDI',
  'MALZEME TOPLANABILIR',
  'MALZEME HAZIRLAMA DEVAM EDIYOR',
  'IRSALIYE YAZDIRILABILIR',
  'IRSALIYE YAZDIRILDI',
];

function initFirestore() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
  return admin.firestore();
}

function parseArgs(argv) {
  const [, , baslangic, bitis, ...rest] = argv;
  if (!baslangic || !bitis) {
    console.error(
      'Kullanım: node syncToFirestore.js <BASLANGIC dd.MM.yyyy> <BITIS dd.MM.yyyy> [--status="KURUMA SEVK EDILDI"]'
    );
    process.exit(1);
  }
  const statusArg = rest.find((a) => a.startsWith('--status='));
  const statusFilter = statusArg ? statusArg.slice('--status='.length).replace(/^"|"$/g, '') : null;
  return { baslangic, bitis, statusFilter };
}

async function syncOnce({ baslangic, bitis, statusFilter }) {
  const db = initFirestore();
  const { token, user } = await login(process.env.CEOMED_EPOSTA, process.env.CEOMED_PAROLA);
  console.log(`Login OK (ID_USER=${user.ID_USER})`);

  const all = await fetchIrsaliyeMaster({
    token,
    idUser: user.ID_USER,
    baslangic,
    bitis,
  });
  console.log(`Master liste: ${all.length} kayıt`);

  const filtered = statusFilter
    ? all.filter((i) => (i.DURUM_ACIKLAMA || '').toUpperCase() === statusFilter.toUpperCase())
    : all.filter((i) => ALLOWED_STATUSES.includes((i.DURUM_ACIKLAMA || '').toUpperCase()));
  console.log(`Filtre sonrası: ${filtered.length} kayıt`);

  let written = 0;
  let failed = 0;
  for (const irs of filtered) {
    try {
      const items = await fetchOkutulanBarkod({
        token,
        idSevkMaster: irs.ID,
        idUser: user.ID_USER,
      });

      const docRef = db.collection('pendingCeomedIrsaliye').doc(String(irs.ID));
      await docRef.set(
        {
          ceomedId: irs.ID,
          irsaliyeNo: irs.IRSALIYE_NO,
          tarih: irs.TARIH,
          cariKodu: irs.CARI_KODU,
          cariUnvan: irs.CARI_UNVAN,
          evrakSeq: irs.EVRAK_SEQ,
          depo: irs.DEPO,
          durumAciklama: irs.DURUM_ACIKLAMA,
          durumTipi: irs.DURUM_TIPI,
          belgeTipi: irs.BELGE_TIPI,
          itemCount: items.length,
          items, // BARKOD_SERI, BARKOD, STOK_KODU, LOT, MIYAT, MIKTAR
          status: 'pending', // pending | approved | rejected
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      written++;
      console.log(`  OK ${irs.IRSALIYE_NO} (${irs.CARI_KODU}) - ${items.length} barkod`);
    } catch (e) {
      failed++;
      console.error(`  HATA ${irs.IRSALIYE_NO}: ${e.message}`);
    }
  }

  console.log(`\nÖzet: ${written} yazıldı, ${failed} başarısız.`);
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  syncOnce(args).catch((e) => {
    console.error('FATAL:', e.message);
    process.exit(1);
  });
}

module.exports = { syncOnce };
