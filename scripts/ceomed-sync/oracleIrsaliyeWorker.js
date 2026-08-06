/**
 * Ceomed muhasebe irsaliyesi YAZMA worker'ı (on-prem).
 *
 * Okuma tarafı (`watch.js`) Ceomed'den Qore'a veri çeker. Bu worker ters yönde
 * çalışır: bir teknik/aplikasyon formunda yedek parça kullanıldığında Qore'un
 * `ceomedIrsaliyeGirisJobs` kuyruğuna düşen işi alır ve Ceomed masaüstü
 * uygulamasındaki "Çıkış İrsaliyesi" formunu doldurup e-irsaliyeyi gönderir.
 *
 * NEDEN AYRI BİR SÜREÇ: Ceomed masaüstü uygulamasına yalnızca şirket ağından /
 * VPN'den erişilebilir. Qore bulutta çalıştığı için oradan yazamaz.
 *
 * NEDEN TEK İŞ, SIRAYLA: hedef tek bir masaüstü penceresidir. İki iş aynı anda
 * yazmaya kalkarsa tuş vuruşları birbirine karışır ve muhasebeye bozuk irsaliye
 * düşer. Eşzamanlılık burada bir optimizasyon değil, bir hata kaynağıdır.
 *
 * GÜVENLİK AĞLARI (e-irsaliye gönderimi GERİ ALINAMAZ):
 *   1. Varsayılan KURU ÇALIŞMA (ORACLE_DRY_RUN=1). Gerçek yazma bilinçli olarak
 *      açılmalıdır.
 *   2. İş, yazmadan hemen önce ikinci kez doğrulanır (`lib/irsaliyeJob.js`).
 *   3. Doküman kimliği = form kimliği; aynı form iki kez irsaliye üretemez.
 *   4. `processing` durumu atomik transaction ile alınır; ikinci bir worker aynı
 *      işi alamaz.
 *   5. Günlük gönderim tavanı (ORACLE_MAX_PER_DAY) — otomasyon çıldırırsa
 *      muhasebeye sınırsız kayıt yağmaz.
 *
 * Çalıştırma:
 *   node oracleIrsaliyeWorker.js            (kuru çalışma — hiçbir şey gönderilmez)
 *   ORACLE_DRY_RUN=0 node oracleIrsaliyeWorker.js
 *
 * Env (.env):
 *   GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_PROJECT_ID, CEOMED_COMPANY_ID
 *   ORACLE_DRY_RUN            (varsayılan 1)  0 = gerçekten gönder
 *   ORACLE_FILL_ONLY          (varsayılan 0)  1 = formu doldur, gönderme;
 *                              operatör onayına kadar sıradakini beklet
 *   ORACLE_DRIVER             (varsayılan ui) ui | api
 *   ORACLE_MAX_ATTEMPTS       (varsayılan 3)  bir işin en fazla deneme sayısı
 *   ORACLE_MAX_PER_DAY        (varsayılan 200) günlük gönderim tavanı
 *   ORACLE_STALE_CLAIM_MIN    (varsayılan 15) takılı kalan processing işi geri al
 *   ORACLE_POLL_SEC           (varsayılan 30) listener'a ek emniyet yoklaması
 */
const admin = require('firebase-admin');
const os = require('os');

const { COLLECTION, validateJob, describeJob } = require('./lib/irsaliyeJob');

const num = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

const DRY_RUN = process.env.ORACLE_DRY_RUN !== '0';
const FILL_ONLY = process.env.ORACLE_FILL_ONLY === '1';
const DRIVER_NAME = (process.env.ORACLE_DRIVER || 'ui').toLowerCase();
const MAX_ATTEMPTS = num(process.env.ORACLE_MAX_ATTEMPTS, 3);
const MAX_PER_DAY = num(process.env.ORACLE_MAX_PER_DAY, 200);
const STALE_CLAIM_MIN = num(process.env.ORACLE_STALE_CLAIM_MIN, 15);
const POLL_SEC = num(process.env.ORACLE_POLL_SEC, 30);
const COMPANY_ID = (process.env.CEOMED_COMPANY_ID || '').trim();

const WORKER_ID = `${os.hostname()}#${process.pid}`;

const ts = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = (tag, msg) => console.log(`[${ts()}] [${tag}] ${msg}`);
const errLog = (tag, msg) => console.error(`[${ts()}] [${tag}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = true;
/** Aynı anda tek iş — kuyruk tetiklemesi işlemin ortasına giremesin. */
let draining = false;
/** Gün içi gönderim sayacı: { gun: 'YYYY-MM-DD', adet: n } */
let dailyCounter = { gun: '', adet: 0 };

function initFirestore() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
  return admin.firestore();
}

function loadDriver() {
  if (DRIVER_NAME === 'api') return require('./drivers/apiDriver');
  if (DRIVER_NAME === 'ui') return require('./drivers/uiDriver');
  throw new Error(`Bilinmeyen ORACLE_DRIVER: "${DRIVER_NAME}" (ui | api)`);
}

function bugun() {
  return new Date().toISOString().slice(0, 10);
}

/** Günlük tavanı kontrol eder; gün değiştiyse sayacı sıfırlar. */
function gunlukTavanAsildiMi() {
  const g = bugun();
  if (dailyCounter.gun !== g) dailyCounter = { gun: g, adet: 0 };
  return dailyCounter.adet >= MAX_PER_DAY;
}

/**
 * İşi atomik olarak sahiplenir. İki worker aynı anda çalışsa bile yalnızca biri
 * `true` alır — transaction, `pending` durumunu tek seferlik bir bilete çevirir.
 */
async function claimJob(db, jobId) {
  const ref = db.collection(COLLECTION).doc(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data();
    if (data.status !== 'pending') return null;

    const attemptCount = Number(data.attemptCount || 0) + 1;
    tx.update(ref, {
      status: 'processing',
      attemptCount,
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      claimedBy: WORKER_ID,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { id: jobId, ...data, attemptCount };
  });
}

async function markSent(db, job, result) {
  await db.collection(COLLECTION).doc(job.id).update({
    status: 'sent',
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastError: null,
    ceomedIrsaliyeNo: result.ceomedIrsaliyeNo || null,
    screenshotPath: result.screenshotPath || null,
    driver: DRIVER_NAME,
  });
}

async function markAwaitingReview(db, job, result) {
  await db.collection(COLLECTION).doc(job.id).update({
    status: 'awaiting_review',
    previewedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastError: null,
    screenshotPath: result.screenshotPath || null,
    driver: DRIVER_NAME,
  });
}

async function hasAwaitingReview(db) {
  let q = db.collection(COLLECTION).where('status', '==', 'awaiting_review');
  if (COMPANY_ID) q = q.where('companyId', '==', COMPANY_ID);
  const snap = await q.limit(1).get();
  return !snap.empty;
}

/**
 * Hatayı kaydeder. Yeniden denenebilir ve deneme hakkı kaldıysa iş `pending`'e
 * döner; aksi hâlde `failed` olur ve elle müdahale bekler.
 *
 * `failed` sessiz bir çöp kutusu DEĞİLDİR: panel bu işleri gerekçesiyle listeler.
 */
async function markFailure(db, job, message, retryable) {
  const tekrarHakkiVar = retryable && job.attemptCount < MAX_ATTEMPTS;
  await db.collection(COLLECTION).doc(job.id).update({
    status: tekrarHakkiVar ? 'pending' : 'failed',
    lastError: String(message).slice(0, 1500),
    lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    driver: DRIVER_NAME,
  });
  return tekrarHakkiVar;
}

async function processJob(db, driver, jobId) {
  const job = await claimJob(db, jobId);
  if (!job) return; // başka worker aldı ya da durum değişti

  const ozet = describeJob(job);

  // İkinci savunma hattı: yazmadan hemen önce doğrula.
  const v = validateJob(job);
  if (!v.ok) {
    await db.collection(COLLECTION).doc(job.id).update({
      status: 'blocked',
      blockedReason: 'worker_dogrulama',
      blockedDetail: v.errors.join(' '),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    errLog('blok', `${ozet}: ${v.errors.join(' ')}`);
    return;
  }

  if (gunlukTavanAsildiMi()) {
    await markFailure(db, job, `Günlük gönderim tavanı (${MAX_PER_DAY}) aşıldı; iş yarın denenecek.`, true);
    errLog('tavan', `${ozet}: günlük tavan doldu, iş kuyrukta bekliyor.`);
    return;
  }

  if (FILL_ONLY) {
    log('test', `${ozet} — Oracle formu dolduruluyor; GÖNDER butonuna basılmayacak.`);
    let result;
    try {
      result = await driver.submit(job);
    } catch (e) {
      const tekrar = await markFailure(db, job, e.message || String(e), true);
      errLog('hata', `${ozet}: ${e.message || e}${tekrar ? ' — yeniden denenecek' : ' — DENEME HAKKI BİTTİ'}`);
      return;
    }
    if (!result || !result.ok) {
      const mesaj = (result && result.error) || 'Sürücü sebep belirtmeden başarısız döndü.';
      const retryable = !result || result.retryable !== false;
      const tekrar = await markFailure(db, job, mesaj, retryable);
      errLog('hata', `${ozet}: ${mesaj}${tekrar ? ' — yeniden denenecek' : ' — ELLE MÜDAHALE GEREKİR'}`);
      return;
    }
    await markAwaitingReview(db, job, result);
    log('bekliyor', `${ozet} — form dolduruldu, gönderilmedi. Panelden test tamamlanana kadar sıradaki iş bekleyecek.`);
    return;
  }

  if (DRY_RUN) {
    // Kuru çalışmada iş TÜKETİLMEZ: pending'e geri döner ki gerçek moda
    // geçildiğinde aynı iş normal akışta gönderilsin.
    const plan = driver.describePlan ? driver.describePlan(job) : ozet;
    log('kuru', `${ozet} — GÖNDERİLMEDİ (ORACLE_DRY_RUN=1)`);
    log('kuru', plan);
    await db.collection(COLLECTION).doc(job.id).update({
      status: 'pending',
      attemptCount: Math.max(0, job.attemptCount - 1),
      dryRunPreviewAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return;
  }

  log('yaz', `${ozet} — ${DRIVER_NAME} sürücüsüyle yazılıyor (deneme ${job.attemptCount}/${MAX_ATTEMPTS})`);

  let result;
  try {
    result = await driver.submit(job);
  } catch (e) {
    const tekrar = await markFailure(db, job, e.message || String(e), true);
    errLog('hata', `${ozet}: ${e.message || e}${tekrar ? ' — yeniden denenecek' : ' — DENEME HAKKI BİTTİ'}`);
    return;
  }

  if (!result || !result.ok) {
    const mesaj = (result && result.error) || 'Sürücü sebep belirtmeden başarısız döndü.';
    const retryable = !result || result.retryable !== false;
    const tekrar = await markFailure(db, job, mesaj, retryable);
    errLog('hata', `${ozet}: ${mesaj}${tekrar ? ' — yeniden denenecek' : ' — ELLE MÜDAHALE GEREKİR'}`);
    return;
  }

  dailyCounter.adet += 1;
  await markSent(db, job, result);
  log('ok', `${ozet} — e-irsaliye gönderildi${result.ceomedIrsaliyeNo ? ` (Ceomed no: ${result.ceomedIrsaliyeNo})` : ''}`);
}

/** Kuyruktaki tüm pending işleri sırayla tüketir. */
async function drain(db, driver) {
  if (draining || !running) return;
  draining = true;
  try {
    if (FILL_ONLY && await hasAwaitingReview(db)) {
      log('bekliyor', 'Oracle ekranında incelenen bir form var; kuyruktaki yeni işler sırada tutuluyor.');
      return;
    }
    while (running) {
      let q = db.collection(COLLECTION).where('status', '==', 'pending');
      if (COMPANY_ID) q = q.where('companyId', '==', COMPANY_ID);
      const snap = await q.orderBy('createdAt', 'asc').limit(20).get();
      if (snap.empty) break;

      for (const doc of snap.docs) {
        if (!running) break;
        await processJob(db, driver, doc.id);
        if (FILL_ONLY) break;
      }

      // Kuru çalışmada işler pending kalır — sonsuz döngüye girmemek için tek tur.
      if (DRY_RUN || FILL_ONLY) break;
    }
  } catch (e) {
    errLog('kuyruk', `Tüketim hatası: ${e.message || e}`);
  } finally {
    draining = false;
  }
}

/**
 * Takılı kalan işleri kurtarır: worker `processing` durumundayken çökerse iş
 * sonsuza kadar orada kalır. Belirli bir süre sonra `pending`'e döndürülür.
 */
async function recoverStaleClaims(db) {
  const esik = new Date(Date.now() - STALE_CLAIM_MIN * 60 * 1000);
  let q = db.collection(COLLECTION).where('status', '==', 'processing');
  if (COMPANY_ID) q = q.where('companyId', '==', COMPANY_ID);

  const snap = await q.limit(50).get();
  for (const doc of snap.docs) {
    const claimedAt = doc.data().claimedAt;
    const t = claimedAt && claimedAt.toDate ? claimedAt.toDate() : null;
    if (t && t > esik) continue;
    await doc.ref.update({
      status: 'pending',
      lastError: `Takılı kalan iş kurtarıldı (${STALE_CLAIM_MIN} dk boyunca processing kaldı).`,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    log('kurtar', `${doc.id} takılı kalmıştı, kuyruğa geri alındı.`);
  }
}

async function main() {
  if (!process.env.FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID env değişkeni zorunlu.');
  }

  const db = initFirestore();
  const driver = loadDriver();

  log('başlat', `worker=${WORKER_ID} sürücü=${DRIVER_NAME} mod=${FILL_ONLY ? 'FORM_DOLDUR_TEST' : DRY_RUN ? 'PLAN_KURU' : 'GERÇEK'}`);
  if (FILL_ONLY) {
    log('başlat', 'FORM DOLDUR TESTİ: Oracle formu doldurulacak, E-İRSALİYE GÖNDER butonuna basılmayacak.');
  } else if (DRY_RUN) {
    log('başlat', 'KURU ÇALIŞMA: hiçbir e-irsaliye gönderilmeyecek. Gerçek gönderim için ORACLE_DRY_RUN=0.');
  } else {
    log('başlat', `GERÇEK GÖNDERİM AÇIK. Günlük tavan: ${MAX_PER_DAY}. E-irsaliye gönderimi geri alınamaz.`);
  }
  if (driver.init) await driver.init();

  await recoverStaleClaims(db);

  let q = db.collection(COLLECTION).where('status', '==', 'pending');
  if (COMPANY_ID) q = q.where('companyId', '==', COMPANY_ID);

  const unsubscribe = q.onSnapshot(
    () => { drain(db, driver).catch((e) => errLog('kuyruk', e.message || e)); },
    (e) => errLog('listener', `Kuyruk dinleyicisi hatası: ${e.message || e}`),
  );

  // Listener yeter ama tek dayanak olmamalı: bağlantı sessizce koparsa yoklama
  // işleri yine de alır. Takılı iş kurtarma da bu turda çalışır.
  while (running) {
    await sleep(POLL_SEC * 1000);
    if (!running) break;
    try {
      await recoverStaleClaims(db);
      await drain(db, driver);
    } catch (e) {
      errLog('yoklama', e.message || e);
    }
  }

  unsubscribe();
  if (driver.close) await driver.close();
}

function shutdown(sinyal) {
  if (!running) return;
  running = false;
  log('kapat', `${sinyal} alındı, süren iş bitince çıkılacak.`);
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) {
  main().catch((e) => {
    errLog('fatal', e.message || e);
    process.exit(1);
  });
}

module.exports = { claimJob, drain, recoverStaleClaims };
