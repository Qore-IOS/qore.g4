/**
 * API sürücüsü — TERCİH EDİLEN yol, henüz TAMAMLANMADI.
 *
 * Ceomed masaüstü uygulaması verisini bir yere yazıyor: ya okuma tarafındaki gibi
 * bir HTTP servisine (`fetchIrsaliyeMaster.js`'in kullandığı 8081 portu gibi) ya
 * da doğrudan Oracle'a. İlkiyse yazma işi tuş vuruşu taklidi değil, düz bir HTTP
 * çağrısı olur: uygulama sürümünden, pencere boyutundan, açılan uyarılardan
 * bağımsız — yani UI sürücüsünün bütün kırılganlığı ortadan kalkar.
 *
 * BU DOSYA BİLEREK BOŞ. Uç noktayı tahmin ederek yazmak, kuru çalışmada "çalışıyor"
 * görünüp gerçek modda muhasebeye bozuk kayıt göndermek demektir. Keşif adımları
 * `ORACLE-IRSALIYE.md` içindeki "API keşfi" bölümündedir; sonuçlar geldiğinde
 * `submit()` doldurulacak ve ORACLE_DRIVER=api ile devreye alınacaktır.
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
  'API sürücüsü henüz tanımlanmadı. Ceomed masaüstü uygulamasının yazma uç noktası ' +
  'tespit edilene kadar ORACLE_DRIVER=ui kullanın (ayrıntı: ORACLE-IRSALIYE.md).';

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
