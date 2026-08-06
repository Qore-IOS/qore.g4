/**
 * Kuyruğa TEST işi ekler — Qore'da gerçek form kapatmadan sürücüyü denemek için.
 *
 * NEDEN GEREKLİ: uçtan uca denemek için tek yol, Qore'da yedek parçalı bir
 * teknik/aplikasyon formu kapatmaktı. Bu hem yavaş hem de gerçek iş kaydı
 * üretiyor — sırf sürücüyü denemek için üretim verisi kirletmek doğru değil.
 * Bu betik aynı şekle sahip bir kuyruk kaydı yazar; worker onu normal iş gibi
 * alır.
 *
 * Kayıtlar `test: true` ile işaretlenir, böylece panelde ve sorguda ayırt
 * edilebilir.
 *
 * Kullanım (Ceomed makinesinde):
 *   enqueue-test-job.bat
 *   enqueue-test-job.bat --irsaliye-no BT10099 --stok-kodu 03753379001
 *   enqueue-test-job.bat --cari-kodu M51009 --miktar 2 --lot LOT123
 *
 * DİKKAT — İRSALİYE NUMARASI: uygulama mükerrer numarayı reddediyor. Her
 * denemede farklı numara verin; verilmezse zaman damgasından türetilir.
 *
 * Bu betik yalnızca kuyruğa YAZAR. Formu doldurmak ve göndermek worker'ın işi;
 * `ORACLE_FILL_ONLY=1` iken gönderim yapılmaz.
 */
const admin = require('firebase-admin');

const COLLECTION = 'ceomedIrsaliyeGirisJobs';

// Sabitler `lib/irsaliyeJob.js` ile aynı olmalı; worker aksi hâlde işi reddeder.
const ISLEM_TIPI = '35';
const DEPO = '10';

function tirnaksiz(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return /^(".*"|'.*')$/.test(t) ? t.slice(1, -1) : v;
}

function argOku(ad, varsayilan) {
  const i = process.argv.indexOf(`--${ad}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return varsayilan;
}

/** `BT10099` gibi: 2 harf + rakam, en fazla 8 karakter (Ceomed kuralı). */
function varsayilanIrsaliyeNo() {
  const d = new Date();
  const ss = String(d.getHours()).padStart(2, '0');
  const dd = String(d.getMinutes()).padStart(2, '0');
  const sn = String(d.getSeconds()).padStart(2, '0');
  return `TT${ss}${dd}${sn}`; // TT + 6 rakam = 8 karakter
}

async function main() {
  const projectId = tirnaksiz(process.env.FIREBASE_PROJECT_ID);
  const companyId = tirnaksiz(process.env.CEOMED_COMPANY_ID);

  if (!projectId) throw new Error('FIREBASE_PROJECT_ID tanımsız.');
  if (!companyId) throw new Error('CEOMED_COMPANY_ID tanımsız — worker işi bulamaz.');

  const irsaliyeNo = argOku('irsaliye-no', varsayilanIrsaliyeNo());
  const cariKodu = argOku('cari-kodu', 'M51009');
  const stokKodu = argOku('stok-kodu', '03753379001');
  const miktar = Number(argOku('miktar', '1'));
  const lot = argOku('lot', '');
  const miad = argOku('miad', '');
  const aciklama = argOku('aciklama', 'Test — Qore otomasyonu');

  if (!/^[A-Z]{2}\d{1,6}$/.test(irsaliyeNo)) {
    throw new Error(
      `İrsaliye no "${irsaliyeNo}" Ceomed biçimine uymuyor. ` +
      'Kural: 2 büyük harf + en fazla 6 rakam (toplam 8 karakter).'
    );
  }
  if (!Number.isFinite(miktar) || miktar <= 0) {
    throw new Error(`Miktar pozitif olmalı, "${argOku('miktar', '1')}" geldi.`);
  }
  if (/[^\x00-\x7F]/.test(stokKodu)) {
    // Sahada ölçüldü: 'İ' harfi veritabanına '?' olarak gidiyor ve stok kartı
    // bulunamıyor. Geri okuma bunu yakalayamıyor, o yüzden baştan engelliyoruz.
    throw new Error(
      `Stok kodu "${stokKodu}" ASCII dışı karakter içeriyor; Ceomed karakter ` +
      'kümesi bunları taşımıyor. Kodu Ceomed\'deki gerçek yazımıyla verin.'
    );
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  });
  const db = admin.firestore();

  const bugun = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const kayit = {
    // --- worker'ın doğruladığı alanlar ---
    irsaliyeNo,
    cariKodu,
    tarih: bugun,
    islemTipi: ISLEM_TIPI,
    depo: DEPO,
    aciklama,
    satirlar: [{ stokKodu, miktar, lot, miad }],

    // --- kuyruk yönetimi ---
    status: 'pending',
    companyId,
    attemptCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),

    // --- bu bir test kaydı ---
    test: true,
    formNo: `TEST-${irsaliyeNo}`,
    formId: null,
    formType: 'test',
    labName: 'TEST',
  };

  const ref = await db.collection(COLLECTION).add(kayit);

  console.log('Test işi kuyruğa eklendi.\n');
  console.log(`  Kuyruk kaydı : ${ref.id}`);
  console.log(`  İrsaliye No  : ${irsaliyeNo}`);
  console.log(`  Cari Kodu    : ${cariKodu}`);
  console.log(`  Tarih        : ${bugun}`);
  console.log(`  İşlem Tipi   : ${ISLEM_TIPI}`);
  console.log(`  Depo         : ${DEPO}`);
  console.log(`  Satır        : ${stokKodu} × ${miktar}${lot ? ` • lot ${lot}` : ''}${miad ? ` • miad ${miad}` : ''}`);
  console.log(`  Açıklama     : ${aciklama}`);
  console.log('\nWorker çalışıyorsa birkaç saniye içinde formu dolduracak.');
  console.log('Ceomed formunu sürücü F6 ile kendisi temizler; elle boş form açmanız gerekmez.');
  return 0;
}

main()
  .then((k) => process.exit(k))
  .catch((e) => {
    console.error(`[HATA] ${e && e.message ? e.message : e}`);
    process.exit(1);
  });
