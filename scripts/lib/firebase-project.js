/**
 * Firebase Admin SDK için proje kimliğini güvenilir biçimde çözer.
 *
 * NEDEN GEREKLİ: `admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })`
 * çağrısında env değişkeni tanımsızsa `projectId: undefined` geçilir. Firestore
 * bunu Application Default Credentials'tan telafi edebiliyor, fakat
 * `admin.auth()` edemiyor ve HER çağrıda şu hatayı veriyor:
 *
 *   Failed to determine project ID for Auth. Initialize the SDK with service
 *   account credentials or set project ID as an app option.
 *
 * Bu, üretimde gerçek bir kilitlenmeye yol açtı: `sync-claims.js` 112
 * kullanıcının hepsinde bu hatayı verdi, hiçbir custom claim yazılmadı, ama
 * kurallar yine de yayınlandı. Token'ında `companyId` olmayan kullanıcı için
 * `inCompany()` daima false döner — yani kimse hiçbir veriyi okuyamaz/yazamaz.
 *
 * Çözüm: proje kimliği birden çok kaynaktan sırayla aranır ve hiçbiri yoksa
 * script TEK ve NET bir hatayla durur (112 kez aynı hatayı basmak yerine).
 */
const fs = require('fs');
const path = require('path');

/** `.firebaserc` içindeki varsayılan projeyi okur. */
function readFirebaseRc() {
  const candidates = [
    path.join(process.cwd(), '.firebaserc'),
    path.join(__dirname, '..', '..', '.firebaserc'),
  ];
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const value = parsed && parsed.projects && parsed.projects.default;
      if (typeof value === 'string' && value.trim()) return value.trim();
    } catch {
      // dosya yok / bozuk → sıradaki adaya geç
    }
  }
  return null;
}

/**
 * Proje kimliğini çözer.
 * Sıra: FIREBASE_PROJECT_ID → GOOGLE_CLOUD_PROJECT → GCLOUD_PROJECT → .firebaserc
 * @returns {{ projectId: string, source: string }}
 * @throws {Error} hiçbir kaynakta bulunamazsa
 */
function resolveProjectId() {
  const envCandidates = [
    ['FIREBASE_PROJECT_ID', process.env.FIREBASE_PROJECT_ID],
    ['GOOGLE_CLOUD_PROJECT', process.env.GOOGLE_CLOUD_PROJECT],
    ['GCLOUD_PROJECT', process.env.GCLOUD_PROJECT],
  ];
  for (const [name, value] of envCandidates) {
    if (typeof value === 'string' && value.trim()) {
      return { projectId: value.trim(), source: name };
    }
  }

  const fromRc = readFirebaseRc();
  if (fromRc) return { projectId: fromRc, source: '.firebaserc (projects.default)' };

  throw new Error(
    'Firebase proje kimliği çözülemedi.\n' +
      '  Denenen kaynaklar: FIREBASE_PROJECT_ID, GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT, .firebaserc\n' +
      '  Çözüm:  export FIREBASE_PROJECT_ID=<proje-id>\n' +
      '  Proje kimliğini .firebaserc dosyasında veya Firebase Console → Project settings\n' +
      "  ekranında bulabilirsiniz."
  );
}

/**
 * Admin SDK'yı çözülmüş proje kimliğiyle başlatır ve Firestore döndürür.
 * Kimlik bilgisi (`GOOGLE_APPLICATION_CREDENTIALS` veya ortamın varsayılanı)
 * ayrıca gereklidir; eksikse ilk çağrıda anlaşılır bir hata alınır.
 */
function initAdmin(admin, { quiet = false } = {}) {
  const { projectId, source } = resolveProjectId();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
  }
  if (!quiet) console.log(`Proje  : ${projectId}  (kaynak: ${source})`);
  return { db: admin.firestore(), projectId };
}

/**
 * `admin.auth()` gerçekten kullanılabilir mi diye tek seferlik ön kontrol.
 *
 * Toplu işlemlerde kullanıcı başına aynı yetkilendirme hatasını yüzlerce kez
 * basmak yerine, işleme başlamadan önce tek bir net hata üretir.
 */
async function assertAuthUsable(admin) {
  try {
    await admin.auth().listUsers(1);
  } catch (err) {
    throw new Error(
      `Firebase Auth erişilemiyor: ${err && err.message ? err.message : err}\n` +
        '  Kontrol edin:\n' +
        '    - GOOGLE_APPLICATION_CREDENTIALS geçerli bir service account JSON yolunu gösteriyor mu?\n' +
        '    - Service account "Firebase Authentication Admin" yetkisine sahip mi?\n' +
        '    - FIREBASE_PROJECT_ID doğru projeyi mi gösteriyor?'
    );
  }
}

module.exports = { resolveProjectId, initAdmin, assertAuthUsable, readFirebaseRc };
