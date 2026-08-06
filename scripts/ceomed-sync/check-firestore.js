/**
 * Firestore bağlantı tanısı — worker "PERMISSION_DENIED" verdiğinde çalıştırın.
 *
 * NEDEN AYRI BİR BETİK: worker `admin.credential.applicationDefault()` kullanıyor.
 * Bu fonksiyon GOOGLE_APPLICATION_CREDENTIALS dosyasını bulamazsa HATA VERMEZ —
 * sessizce başka bir kimliğe düşer (gcloud kullanıcı hesabı, makine kimliği).
 * O kimliğin projeye erişimi yoksa hata en sonda, ilk sorguda ve yanıltıcı bir
 * biçimde çıkar: "Permission denied on resource project X". Sorunun kimlik
 * dosyasında mı, rolde mi, yoksa proje kimliğinde mi olduğu görünmez.
 *
 * Bu betik zinciri tek tek doğrular ve hangi halkanın koptuğunu söyler.
 *
 * Kullanım (Ceomed makinesinde):
 *   cd scripts\ceomed-sync
 *   check-firestore.bat
 *
 * GİZLİLİK: özel anahtar hiçbir zaman basılmaz. Yalnızca servis hesabının
 * e-postası ve dosyanın içindeki proje kimliği gösterilir — ikisi de sır değil
 * ve tam da karşılaştırmamız gereken şeyler.
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const COLLECTION = 'ceomedIrsaliyeGirisJobs';

const yaz = (durum, mesaj) => console.log(`[${durum}] ${mesaj}`);

/**
 * .env değerlerini saran tırnakları ayıklar ve tırnak bulunup bulunmadığını
 * bildirir.
 *
 * `.bat` dosyası .env'i `set "%A=%B"` ile okuduğu için tırnaklar DEĞERİN
 * PARÇASI olur. Sahada tam olarak bu oldu: FIREBASE_PROJECT_ID="invpilot"
 * yazılmıştı, worker projeyi `"invpilot"` diye aradı ve Google
 * "Permission denied on resource project" dedi — hata mesajındaki tırnaklar
 * Google'ın biçimlendirmesi sanıldığı için sebep uzun süre görünmedi.
 */
const tirnaksiz = (deger) => {
  if (typeof deger !== 'string') return { deger, tirnakli: false };
  const tirnakli = /^["'].*["']$/.test(deger.trim());
  return {
    deger: tirnakli ? deger.trim().slice(1, -1) : deger,
    tirnakli,
  };
};
const ok = (m) => yaz('  OK  ', m);
const hata = (m) => yaz(' HATA ', m);
const bilgi = (m) => yaz(' bilgi', m);

async function main() {
  let sorun = 0;

  // --- 1. Ortam değişkenleri --------------------------------------------------
  console.log('=== 1. Ortam değişkenleri ===');

  const okuAyikla = (ad, zorunlu, aciklama) => {
    const ham = process.env[ad];
    if (!ham) {
      if (zorunlu) { hata(`${ad} tanımsız${aciklama ? ' — ' + aciklama : ''}`); sorun++; }
      return null;
    }
    const { deger, tirnakli } = tirnaksiz(ham);
    if (tirnakli) {
      // Bu, worker'ın gördüğü değerin YANLIŞ olduğu anlamına gelir; tırnak
      // değerin parçasıdır ve hiçbir kaynakla eşleşmez.
      hata(`${ad} TIRNAK İÇİNDE: ${ham}`);
      hata(`  Worker bunu ${JSON.stringify(ham)} olarak görüyor, ${JSON.stringify(deger)} olarak değil.`);
      hata(`  .env dosyasında tırnakları kaldırın:  ${ad}=${deger}`);
      sorun++;
    } else {
      ok(`${ad} = ${deger}`);
    }
    return deger;
  };

  const projectId = okuAyikla('FIREBASE_PROJECT_ID', true);
  const companyId = okuAyikla('CEOMED_COMPANY_ID', true,
    'worker hangi firmanın işlerini alacağını bilemez');
  const credPath = okuAyikla('GOOGLE_APPLICATION_CREDENTIALS', true);

  // --- 2. Kimlik dosyası ------------------------------------------------------
  console.log('\n=== 2. Servis hesabı dosyası ===');
  let sa = null;
  if (credPath) {
    const temiz = credPath.trim();
    if (!fs.existsSync(temiz)) {
      hata(`Dosya YOK: ${temiz}`);
      hata('applicationDefault() bu durumda hata vermez, sessizce başka bir kimliğe düşer.');
      hata('PERMISSION_DENIED hatasının en sık sebebi budur.');
      sorun++;
    } else {
      ok(`Dosya var (${fs.statSync(temiz).size} bayt)`);
      try {
        sa = JSON.parse(fs.readFileSync(temiz, 'utf8'));
        ok(`Servis hesabı: ${sa.client_email || '(client_email yok)'}`);
        ok(`Dosyadaki proje : ${sa.project_id || '(project_id yok)'}`);
        if (projectId && sa.project_id && sa.project_id !== projectId) {
          hata(`UYUŞMAZLIK: FIREBASE_PROJECT_ID=${projectId} ama anahtar ${sa.project_id} projesine ait.`);
          hata('Bu tam olarak "Permission denied on resource project" hatasını üretir.');
          sorun++;
        }
      } catch (e) {
        hata(`JSON okunamadı: ${e.message}`);
        sorun++;
      }
    }
  }

  if (sorun > 0) {
    console.log(`\n${sorun} sorun bulundu; Firestore'a bağlanmayı denemeye gerek yok.`);
    return 1;
  }

  // --- 3. Gerçek bir okuma ----------------------------------------------------
  console.log('\n=== 3. Firestore okuma denemesi ===');
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  });
  const db = admin.firestore();

  try {
    const snap = await db.collection(COLLECTION).limit(1).get();
    ok(`Koleksiyon okundu: ${COLLECTION} (${snap.size} kayıt döndü)`);
  } catch (e) {
    hata(`Okuma başarısız: ${e.message}`);
    if (String(e.message).includes('PERMISSION_DENIED')) {
      hata('Kimlik geçerli ama bu projede yetkisi yok. Kontrol edin:');
      hata(`  * ${sa && sa.client_email} hesabına "Cloud Datastore User" rolü verilmiş mi?`);
      hata(`  * Rol ${projectId} projesinde mi verilmiş?`);
      hata('  * Firestore API projede etkin mi?');
    }
    return 1;
  }

  // --- 4. Kuyruk durumu -------------------------------------------------------
  console.log('\n=== 4. Kuyruk durumu ===');
  try {
    let q = db.collection(COLLECTION);
    if (companyId) q = q.where('companyId', '==', companyId);
    const snap = await q.get();
    if (snap.empty) {
      bilgi('Kuyrukta hiç iş yok. Qore\'da yedek parçalı bir form kapatın.');
    } else {
      const sayac = {};
      snap.forEach((d) => {
        const s = d.data().status || '(durumsuz)';
        sayac[s] = (sayac[s] || 0) + 1;
      });
      Object.entries(sayac).forEach(([s, n]) => bilgi(`${s}: ${n}`));
      if (sayac.awaiting_review) {
        bilgi('');
        bilgi('DİKKAT: "awaiting_review" durumunda iş var. FILL_ONLY modunda worker');
        bilgi('yeni işleri BEKLETİR. Panelden "Testi tamamla" ile serbest bırakın.');
      }
    }
  } catch (e) {
    hata(`Kuyruk okunamadı: ${e.message}`);
    return 1;
  }

  console.log('\nBağlantı sağlıklı.');
  return 0;
}

main()
  .then((kod) => process.exit(kod))
  .catch((e) => {
    console.error(`[ HATA ] Beklenmedik: ${e && e.message ? e.message : e}`);
    process.exit(1);
  });
