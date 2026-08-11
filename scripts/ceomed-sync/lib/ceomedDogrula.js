/**
 * Ceomed'e YAZILAN irsaliyenin gerçekten oluştuğunu OKUMA API'siyle doğrular.
 *
 * NEDEN GEREKLİ: yazma tarafı ekran otomasyonu. "Gönderdim mi?" sorusunun
 * cevabı bugüne kadar ekrandan okunuyordu ve ekran yanılabiliyor. Zaman aşımı,
 * çözülemeyen çıktı ya da tıklama sonrası kopan bir bağlantı hep aynı sonuca
 * çıkıyordu: `retryable: false` + "ELLE MÜDAHALE GEREKİR". Çünkü körlemesine
 * tekrar denemek mükerrer muhasebe kaydı riski taşıyor.
 *
 * Okuma API'si bu belirsizliği kapatıyor: irsaliye numarası Ceomed'de var mı,
 * yok mu — ekrandan bağımsız, kesin cevap.
 *
 * TASARIM SINIRI — DOĞRULAMA YALNIZCA TEK YÖNDE KARAR DEĞİŞTİREBİLİR:
 *
 *   bulundu    → iş `sent` sayılabilir (mükerrer gönderimi ÖNLER)
 *   bulunamadı → hiçbir şey değişmez, iş yine `failed` kalır
 *
 * "Bulunamadı" sonucunu "o hâlde tekrar gönder" diye okumak tehlikeli olurdu:
 * yanlış BELGE_TIPI, kapalı ağ ya da gecikmeli indeksleme de "bulunamadı"
 * üretir ve mükerrer e-irsaliye kesilir. Doğrulama mükerrer riskini yalnızca
 * AZALTABİLİR, asla artıramaz.
 */
const { login, BASE_URL } = require('../login');
const { fetchIrsaliyeMaster } = require('../fetchIrsaliyeMaster');

/**
 * Çıkış irsaliyelerinin belge tipi. ÖLÇÜLMEDİ.
 *
 * `fetchIrsaliyeMaster` varsayılanı 0 ve okuma tarafı (watch.js) gelen
 * irsaliyeler için bunu kullanıyor. Bizim YAZDIĞIMIZ çıkış irsaliyesinin hangi
 * tipe düştüğü sahada `verify-irsaliye.bat --kesfet` ile bulunmalı ve buraya
 * ya da CEOMED_CIKIS_BELGE_TIPI'ye yazılmalıdır.
 */
const VARSAYILAN_BELGE_TIPI = Number(process.env.CEOMED_CIKIS_BELGE_TIPI || 0);

/** Keşif modunda taranacak tipler. Ceomed'in tip kümesi belgelenmemiş. */
const KESIF_TIPLERI = [0, 1, 2, 3, 4, 5];

/** ISO (YYYY-MM-DD) → Ceomed'in beklediği dd.MM.yyyy. */
function ceomedTarih(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Aynı gün içinde birkaç saat kayması olabilir; pencereyi bir gün genişletiriz. */
function gunEkle(iso, gun) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + gun);
  return d.toISOString().slice(0, 10);
}

let oturum = null;

/**
 * Oturumu bir kez açıp yeniden kullanır. Her doğrulama için login olmak hem
 * yavaş hem de uygulamanın oturum tablosunu şişirir.
 */
async function oturumAl(yenidenDene = true) {
  if (oturum) return oturum;
  const eposta = process.env.CEOMED_EPOSTA;
  const parola = process.env.CEOMED_PAROLA;
  if (!eposta || !parola) {
    throw new Error('CEOMED_EPOSTA / CEOMED_PAROLA tanımsız; doğrulama yapılamaz.');
  }
  try {
    const { token, user } = await login(eposta, parola);
    oturum = { token, idUser: user.ID_USER };
    return oturum;
  } catch (e) {
    oturum = null;
    if (yenidenDene) return oturumAl(false);
    throw e;
  }
}

/** Oturumu düşürür — token süresi dolduğunda çağrılır. */
function oturumuUnut() {
  oturum = null;
}

/**
 * Verilen irsaliye numarası Ceomed'de var mı?
 *
 * @returns {Promise<{durum:'bulundu'|'bulunamadi'|'yapilamadi', kayit?:object, hata?:string, taranan?:number}>}
 *
 * `yapilamadi` ile `bulunamadi` BİLİNÇLİ OLARAK AYRI: biri "Ceomed'e
 * soramadık", diğeri "sorduk, yok". İkisini birleştirmek, ağ kesintisini
 * "irsaliye oluşmamış" diye okumak olurdu.
 */
async function irsaliyeVarMi({ irsaliyeNo, tarih, belgeTipi = VARSAYILAN_BELGE_TIPI }) {
  const no = String(irsaliyeNo || '').trim().toUpperCase();
  if (!no) return { durum: 'yapilamadi', hata: 'irsaliyeNo boş.' };

  const baslangicIso = tarih ? gunEkle(tarih, -1) : null;
  const bitisIso = tarih ? gunEkle(tarih, 1) : null;
  const baslangic = ceomedTarih(baslangicIso);
  const bitis = ceomedTarih(bitisIso);
  if (!baslangic || !bitis) {
    return { durum: 'yapilamadi', hata: `tarih çözülemedi: "${tarih}".` };
  }

  let liste;
  try {
    const { token, idUser } = await oturumAl();
    liste = await fetchIrsaliyeMaster({ token, idUser, baslangic, bitis, belgeTipi });
  } catch (e) {
    // Token süresi dolmuş olabilir; bir kez daha dene.
    oturumuUnut();
    try {
      const { token, idUser } = await oturumAl();
      liste = await fetchIrsaliyeMaster({ token, idUser, baslangic, bitis, belgeTipi });
    } catch (e2) {
      return { durum: 'yapilamadi', hata: `${BASE_URL} sorgulanamadı: ${e2.message || e2}` };
    }
  }

  const kayit = (liste || []).find(
    (i) => String(i.IRSALIYE_NO || '').trim().toUpperCase() === no,
  );

  return kayit
    ? { durum: 'bulundu', kayit, taranan: (liste || []).length }
    : { durum: 'bulunamadi', taranan: (liste || []).length };
}

/**
 * Numaranın hangi BELGE_TIPI altında göründüğünü arar.
 *
 * Çıkış irsaliyelerinin tipi belgelenmemiş; tahmin etmek yerine sahada bir kez
 * ölçülmesi için. Bulunan değer CEOMED_CIKIS_BELGE_TIPI'ye yazılır.
 */
async function belgeTipiKesfet({ irsaliyeNo, tarih, tipler = KESIF_TIPLERI }) {
  const sonuclar = [];
  for (const tip of tipler) {
    const r = await irsaliyeVarMi({ irsaliyeNo, tarih, belgeTipi: tip });
    sonuclar.push({ belgeTipi: tip, ...r });
    if (r.durum === 'bulundu') break;
  }
  return sonuclar;
}

module.exports = {
  irsaliyeVarMi,
  belgeTipiKesfet,
  oturumuUnut,
  VARSAYILAN_BELGE_TIPI,
  KESIF_TIPLERI,
};
