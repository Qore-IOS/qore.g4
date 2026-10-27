/**
 * "Stok düşmüş ama form yok" tanısı — zinciri uçtan uca okur.
 *
 * NEDEN GEREKLİ: sahada bir yedek parça "Kullanıldı" göründü, ama ne işlem
 * formları listesinde ne de Ceomed kuyruğunda karşılığı çıktı. Üç ihtimal var
 * ve panellere bakarak ayırt edilemiyorlar:
 *
 *   1. Form VAR, liste ekranı göstermiyor (tarih alanı, companyId, filtre).
 *   2. Stok formdan DEĞİL, başka bir yoldan tüketildi (ör. yedek parça transfer
 *      ekranındaki "Cihazda Kullanıldı"). O yol form üretmez, dolayısıyla Ceomed
 *      kuyruğuna da düşmez — beklenen davranış, hata değil.
 *   3. Form gerçekten kayıp.
 *
 * Ayırt edici alan `usedOnFormId`. Bu betik onu okur, işaret ettiği form
 * dokümanını GERÇEKTEN AÇAR ve son olarak Ceomed kuyruğunda o forma ait iş var
 * mı diye bakar. Böylece zincirin hangi halkasında koptuğu görünür.
 *
 * Not: form kaydında stok "used" işaretlemesi ile form yazımı AYNI batch'te.
 * Batch atomik olduğu için 3. ihtimal ancak çok sıra dışı bir durumda mümkün;
 * yine de varsayım yerine ölçüm yapıyoruz.
 *
 * Kullanım (Ceomed makinesinde):
 *   check-stock-usage.bat --stok-kodu 03753379001
 *   check-stock-usage.bat --stok-kodu 03753379001 --gun 2026-08-11
 */
const admin = require('../db/script-store.cjs');

const STOK_KOLEKSIYONLARI = ['personalStock', 'poolWarehouseStock'];
const FORM_KOLEKSIYONLARI = {
  teknik_servis: 'teknikServisActionForms',
  aplikasyon: 'aplikasyonActionForms',
};
const KUYRUK = 'ceomedIrsaliyeGirisJobs';

const tirnaksiz = (v) => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return /^(".*"|'.*')$/.test(t) ? t.slice(1, -1) : v;
};

function argOku(ad, varsayilan) {
  const i = process.argv.indexOf(`--${ad}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return varsayilan;
}

const yaz = (m) => console.log(m);
const tarihMetni = (t) => {
  if (t && typeof t.toDate === 'function') return t.toDate().toISOString().slice(0, 16).replace('T', ' ');
  return '(yok)';
};

async function main() {
  const projectId = tirnaksiz(process.env.APP_BASE_URL);
  if (!projectId) throw new Error('APP_BASE_URL tanımsız.');

  const stokKodu = argOku('stok-kodu', null);
  if (!stokKodu) {
    throw new Error(
      'Stok kodu zorunlu.  Örnek: check-stock-usage.bat --stok-kodu 03753379001'
    );
  }
  const gun = argOku('gun', new Date().toISOString().slice(0, 10));

  admin.initializeApp();
  const db = admin.firestore();

  yaz(`Stok kodu : ${stokKodu}`);
  yaz(`Gün       : ${gun}\n`);

  let bulunan = 0;

  for (const koleksiyon of STOK_KOLEKSIYONLARI) {
    // Tek alanlı eşitlik sorgusu: bileşik indeks gerektirmez. Tarih süzmesi
    // BELLEKTE yapılıyor — indeksi olmayan bir sorgu, tanı aracının tam da
    // ihtiyaç duyulduğu anda patlaması demek olurdu.
    const snap = await db.collection(koleksiyon).where('stokKodu', '==', stokKodu).get();

    for (const d of snap.docs) {
      const v = d.data();
      const kullanimGunu = v.usedAt && typeof v.usedAt.toDate === 'function'
        ? v.usedAt.toDate().toISOString().slice(0, 10)
        : null;
      if (kullanimGunu !== gun) continue;

      bulunan += 1;
      yaz('─'.repeat(70));
      yaz(`${koleksiyon}/${d.id}`);
      yaz(`  durum        : ${v.status || '(yok)'}`);
      yaz(`  kullanıldı   : ${tarihMetni(v.usedAt)}`);
      yaz(`  cihaz        : ${v.usedOnDeviceName || v.usedOnDeviceId || '(yok)'}`);
      yaz(`  usedOnFormId : ${v.usedOnFormId || '(YOK)'}`);
      yaz(`  formType     : ${v.usedOnFormType || '(yok)'}`);

      if (!v.usedOnFormId) {
        // Bu, 2. ihtimalin imzası: stok bir işlem formundan değil, başka bir
        // ekrandan tüketilmiş. Ceomed köprüsü yalnızca form kaydetme yolunda,
        // dolayısıyla kuyrukta iş olmaması BEKLENEN durumdur.
        yaz('  → TEŞHİS: bu stok bir işlem formundan tüketilmemiş.');
        yaz('           Yedek parça transfer ekranındaki "Cihazda Kullanıldı"');
        yaz('           gibi bir yol kullanılmış olabilir. O yol form üretmez,');
        yaz('           form üretmediği için Ceomed kuyruğuna da düşmez.');
        continue;
      }

      const formKoleksiyonu = FORM_KOLEKSIYONLARI[v.usedOnFormType] || null;
      if (!formKoleksiyonu) {
        yaz(`  → formType tanınmadı; form kontrol edilemedi.`);
        continue;
      }

      const formSnap = await db.collection(formKoleksiyonu).doc(v.usedOnFormId).get();
      if (!formSnap.exists) {
        yaz(`  → TEŞHİS: ${formKoleksiyonu}/${v.usedOnFormId} YOK.`);
        yaz('           Form gerçekten kayıp. Stok işaretlemesi ile form yazımı');
        yaz('           aynı batch\'te olduğu için bu beklenmedik bir durum;');
        yaz('           bu çıktıyı saklayın.');
        continue;
      }

      const f = formSnap.data();
      yaz(`  → form VAR: ${formKoleksiyonu}/${v.usedOnFormId}`);
      yaz(`       formNo     : ${f.formNo || '(yok)'}`);
      yaz(`       tarih      : ${f.baslangicTarihi || f.tarih || tarihMetni(f.createdAt)}`);
      yaz(`       companyId  : ${f.companyId || '(YOK — liste ekranı şirket süzmesi yüzünden gizleyebilir)'}`);
      yaz(`       personel   : ${f.islemiYapanKullaniciAdi || f.personnelName || '(yok)'}`);

      // Zincirin son halkası: Ceomed kuyruğunda bu forma ait iş var mı?
      const isSnap = await db.collection(KUYRUK).doc(v.usedOnFormId).get();
      if (isSnap.exists) {
        const j = isSnap.data();
        yaz(`       Ceomed işi : ${j.status}${j.blockedDetail ? ` — ${j.blockedDetail}` : ''}`);
      } else {
        yaz('       Ceomed işi : YOK.');
        yaz('           Form var ama kuyruğa yazılmamış. Sebep, form kaydedildiği');
        yaz('           anda uygulamanın köprüsüz bir sürümü olması ya da kuyruk');
        yaz('           yazımının reddedilmesi olabilir.');
      }
    }
  }

  yaz('─'.repeat(70));
  if (bulunan === 0) {
    yaz(`${gun} gününde "${stokKodu}" için kullanım kaydı bulunamadı.`);
    yaz('Farklı bir gün için --gun YYYY-MM-DD verin.');
  } else {
    yaz(`${bulunan} kullanım kaydı incelendi.`);
  }
  return 0;
}

main()
  .then((k) => process.exit(k))
  .catch((e) => {
    console.error(`[HATA] ${e && e.message ? e.message : e}`);
    process.exit(1);
  });
