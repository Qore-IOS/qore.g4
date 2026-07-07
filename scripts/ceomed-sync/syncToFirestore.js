/**
 * Ceomed ERP'den irsaliye + barkod çekip Firestore'a "pendingCeomedIrsaliye" koleksiyonuna yazar.
 *
 * Kullanım:
 *   node syncToFirestore.js                                            (otomatik tarih aralığı)
 *   node syncToFirestore.js <BASLANGIC dd.MM.yyyy> <BITIS dd.MM.yyyy> [--status="KURUMA SEVK EDILDI"]
 *
 * Otomatik mod: tarih verilmezse aralık, son başarılı sync'ten (".sync-state.json")
 * bugüne kadar geriye bakarak hesaplanır. Böylece makine günlerce kapalı kalsa bile
 * bir sonraki çalışmada aradaki günlerin irsaliyeleri atlanmaz. Ayarlar (env, opsiyonel):
 *   CEOMED_SYNC_MIN_LOOKBACK_DAYS  -> en az kaç gün geriye bakılsın (varsayılan 7;
 *                                     eski kayıtların durum değişimleri de tazelensin diye)
 *   CEOMED_SYNC_MAX_LOOKBACK_DAYS  -> en fazla kaç gün geriye bakılsın (varsayılan 90)
 *
 * Gerekli env:
 *   CEOMED_BASE_URL, CEOMED_EPOSTA, CEOMED_PAROLA
 *   GOOGLE_APPLICATION_CREDENTIALS  -> service account JSON path
 *   FIREBASE_PROJECT_ID             -> Firebase project id
 *   CEOMED_COMPANY_ID               -> bu Ceomed kurulumunun ait olduğu firma id'si
 *                                      (multi-tenancy: yazılan tüm dokümanlar bu firmaya tag'lenir;
 *                                      yoksa scopedQuery panellerden veriyi göstermez)
 */
const fs = require('fs');
const path = require('path');
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

const STATE_FILE = path.join(__dirname, '.sync-state.json');

function formatDdMmYyyy(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function readLastSuccess() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const t = Date.parse(state.lastSuccessAt);
    return Number.isFinite(t) ? new Date(t) : null;
  } catch {
    return null; // dosya yok/bozuk -> watermark yok say
  }
}

function writeLastSuccess(date) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSuccessAt: date.toISOString() }, null, 2));
}

/**
 * Otomatik tarih aralığı: son başarılı sync'ten bugüne. Watermark yoksa veya
 * çok eskiyse min/max lookback sınırları uygulanır. Haftalık sabit pencere
 * KULLANILMAZ — makine kapalı kaldığında önceki haftanın irsaliyeleri bir
 * sonraki çalışmada bu sayede yine yakalanır.
 */
function computeAutoRange(now = new Date()) {
  const minLookback = parseInt(process.env.CEOMED_SYNC_MIN_LOOKBACK_DAYS, 10) || 7;
  const maxLookback = parseInt(process.env.CEOMED_SYNC_MAX_LOOKBACK_DAYS, 10) || 90;

  const last = readLastSuccess();
  let lookbackDays;
  if (last) {
    const daysSince = Math.ceil((now - last) / (24 * 60 * 60 * 1000));
    // +1 gün tampon: watermark günü yarım kalmış olabilir
    lookbackDays = Math.min(Math.max(daysSince + 1, minLookback), maxLookback);
  } else {
    lookbackDays = Math.max(minLookback, 14); // ilk çalıştırma: 2 hafta geriye bak
  }

  const start = new Date(now);
  start.setDate(start.getDate() - lookbackDays);
  return {
    baslangic: formatDdMmYyyy(start),
    bitis: formatDdMmYyyy(now),
    auto: true,
    lastSuccess: last,
  };
}

function parseArgs(argv) {
  const [, , ...rest] = argv;
  const statusArg = rest.find((a) => a.startsWith('--status='));
  const statusFilter = statusArg ? statusArg.slice('--status='.length).replace(/^"|"$/g, '') : null;
  const positional = rest.filter((a) => !a.startsWith('--'));

  if (positional.length === 0) {
    return { ...computeAutoRange(), statusFilter };
  }
  const [baslangic, bitis] = positional;
  if (!baslangic || !bitis) {
    console.error(
      'Kullanım: node syncToFirestore.js [<BASLANGIC dd.MM.yyyy> <BITIS dd.MM.yyyy>] [--status="KURUMA SEVK EDILDI"]\n' +
        'Tarih verilmezse aralık son başarılı sync\'e göre otomatik hesaplanır.'
    );
    process.exit(1);
  }
  return { baslangic, bitis, statusFilter, auto: false };
}

async function syncOnce({ baslangic, bitis, statusFilter, auto = false, lastSuccess = null }) {
  const companyId = (process.env.CEOMED_COMPANY_ID || '').trim();
  if (!companyId) {
    throw new Error(
      'CEOMED_COMPANY_ID env değişkeni zorunlu — yazılan dokümanlar multi-tenancy ' +
        'kapsamında bu firmaya tag\'lenir. .env dosyana ekle (örn: CEOMED_COMPANY_ID=acme-corp).'
    );
  }

  const db = initFirestore();
  const { token, user } = await login(process.env.CEOMED_EPOSTA, process.env.CEOMED_PAROLA);
  console.log(`Login OK (ID_USER=${user.ID_USER}, companyId=${companyId})`);
  if (auto) {
    console.log(
      `Tarih aralığı (otomatik): ${baslangic} - ${bitis}` +
        (lastSuccess ? ` (son başarılı sync: ${lastSuccess.toISOString()})` : ' (ilk çalıştırma)')
    );
  } else {
    console.log(`Tarih aralığı: ${baslangic} - ${bitis}`);
  }

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
  let updatedOnly = 0;
  let failed = 0;
  for (const irs of filtered) {
    try {
      const docRef = db.collection('pendingCeomedIrsaliye').doc(String(irs.ID));
      const existing = await docRef.get();
      const existingStatus = existing.exists ? existing.get('status') : null;

      // Onaylanmis / reddedilmis / silinmis kayitlara dokunma — sadece ERP durumunu (durumAciklama) tazele.
      if (existingStatus === 'approved' || existingStatus === 'rejected' || existingStatus === 'deleted') {
        await docRef.set(
          {
            durumAciklama: irs.DURUM_ACIKLAMA,
            durumTipi: irs.DURUM_TIPI,
            companyId, // multi-tenancy: eski tag'siz kayıtlar bu refresh sırasında da tag'lensin
            syncedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        updatedOnly++;
        console.log(`  SKIP ${irs.IRSALIYE_NO} (${existingStatus}) - durum guncellendi`);
        continue;
      }

      // Yeni veya hala pending → barkodlari cek, full set
      const items = await fetchOkutulanBarkod({
        token,
        idSevkMaster: irs.ID,
        idUser: user.ID_USER,
      });

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
          items,
          status: 'pending',
          companyId, // multi-tenancy: panel scopedQuery'leri bu tag'e göre filtreliyor
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

  console.log(`\nÖzet: ${written} yazıldı, ${updatedOnly} sadece-durum, ${failed} başarısız.`);

  // Watermark yalnızca otomatik modda ve hatasız biten çalışmada ilerletilir.
  // Kısmi hata varsa eski watermark kalır; bir sonraki çalışma aynı aralığı yeniden kapsar.
  if (auto && failed === 0) {
    writeLastSuccess(new Date());
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  syncOnce(args).catch((e) => {
    console.error('FATAL:', e.message);
    process.exit(1);
  });
}

module.exports = { syncOnce, computeAutoRange };
