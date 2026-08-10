/**
 * API sürücüsü — TERCİH EDİLEN yol, ama keşif sonucu HENÜZ KULLANILAMAZ.
 *
 * BU DOSYA BİLEREK BOŞ ve bu, eksik iş değil ölçülmüş bir sonuçtur.
 *
 * 2026-08-06 keşfi (tutanak: `ORACLE-IRSALIYE.md` → "API keşfi") şunu buldu:
 *
 *   1. Masaüstü uygulaması (`ifrun60`, Oracle Forms 6i çalışma zamanı) doğrudan
 *      Oracle'a bağlanıyor — 192.168.1.5:1521. Araya HTTP servisi yok, yani
 *      isteğini yakalayıp taklit etmek mümkün değil.
 *   2. Aynı sunucudaki web Ceomed'in (:8081) TÜM API yüzeyi çıkarıldı: 187 uç
 *      nokta. Hiçbiri cari kodu + tarih + işlem tipi + depo alıp serbest ürün
 *      satırlarıyla çıkış irsaliyesi oluşturmuyor.
 *   3. Katalogda e-irsaliye gönderen tek bir uç nokta yok. Belge oluşturulabilse
 *      bile akışın son adımı web tarafından tetiklenemez.
 *
 * Adı en umut verici olan `/sevk/insertIrsaliyeMaster` yanıltıcıdır: tek
 * parametre (`IRSALIYE_NO`) alır ve belge oluşturmaz, mevcut bir sevk kaydına
 * numara işler. Uç nokta adına bakıp burayı doldurmak, kuru çalışmada "çalışıyor"
 * görünüp gerçek modda muhasebeye çöp göndermek olurdu.
 *
 * Bu dosyanın dolması için gereken: Ceomed Yazılım'dan çıkış irsaliyesi oluşturan
 * + e-irsaliye gönderen bir uç nokta. Web arayüzünün kullanmadığı uç noktalar
 * sunucuda duruyor olabilir; katalogda görünmemesi yok demek değildir.
 *
 * Doldurulurken korunacak sözleşme:
 *   submit(job) -> { ok: true, ceomedIrsaliyeNo? }
 *               |  { ok: false, error, retryable }
 *   `retryable: false` yalnızca sonucu BELİRSİZ olmayan hatalar için (ör. 400
 *   doğrulama hatası). Ağ hatası gibi belirsiz durumlarda `retryable: true`
 *   verilebilir; çünkü istek karşı tarafa hiç ulaşmamıştır. Yanıt alındıktan
 *   sonraki hatalarda `false` verin — mükerrer irsaliye riski vardır.
 */
const { describeJob, toKeystrokePlan } = require('../lib/irsaliyeJob');

const NOT_IMPLEMENTED =
  'API sürücüsü kullanılamıyor: 2026-08-06 keşfinde Ceomed web API\'sinde (187 uç nokta) ' +
  'çıkış irsaliyesi oluşturan veya e-irsaliye gönderen bir uç nokta bulunamadı; masaüstü ' +
  'uygulaması da doğrudan Oracle\'a bağlanıyor. ORACLE_DRIVER=ui kullanın ' +
  '(ayrıntı: ORACLE-IRSALIYE.md → "API keşfi").';

async function init() {
  throw new Error(NOT_IMPLEMENTED);
}

function describePlan(job) {
  const plan = toKeystrokePlan(job);
  return `    (api sürücüsü tanımsız) ${describeJob(job)} — ${plan.rows.length} satır`;
}

async function submit() {
  return { ok: false, retryable: false, error: NOT_IMPLEMENTED };
}

module.exports = { name: 'api', init, submit, describePlan };
