/**
 * UI sürücüsü — Ceomed masaüstü uygulamasının "Çıkış İrsaliyesi" formunu
 * Win32/Oracle Forms odak sürücüsüyle doldurur.
 *
 * Node tarafı işi hazırlar ve Python'a JSON olarak verir; tuş vuruşlarını
 * `oracle-ui/fill_irsaliye.py` atar. Neden Python: Win32/UIA erişimi için
 * saf Win32 API erişimi Python'un standart `ctypes` modülüyle sağlanır;
 * Ceomed makinesine ek UI otomasyon paketi kurulması gerekmez.
 *
 * DÜRÜST SINIR: ekran otomasyonu kırılgandır. Uygulama sürümü, pencere boyutu,
 * sekme sırası ya da bir açılır uyarı değişirse bozulur. Bu yüzden:
 *   - Her koşuda ekran görüntüsü alınır (kanıt + hata teşhisi).
 *   - Python tarafı her alanı YAZDIKTAN SONRA geri okuyup doğrular; uyuşmazlıkta
 *     e-irsaliye gönderilmeden çıkar.
 *   - Alan konumları sahada ölçülmüş MDI/pencere koordinatlarıyla tanınır;
 *     her yazım aktif Edit kontrolünden geri okunarak doğrulanır.
 *
 * Bu sürücü kalıcı çözüm değil, API keşfi sonuçsuz kalırsa kullanılacak yoldur.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const { toKeystrokePlan, describeJob } = require('../lib/irsaliyeJob');

const PYTHON = process.env.ORACLE_PYTHON || 'python';
const SCRIPT = path.join(__dirname, '..', 'oracle-ui', 'fill_irsaliye.py');
const TIMEOUT_MS = (parseInt(process.env.ORACLE_UI_TIMEOUT_SEC, 10) || 180) * 1000;

/**
 * Python `--gercek` almadıkça E-İRSALİYE GÖNDER'e BASMAZ; formu doldurup
 * `{ok: true, kuru: true}` döner. Bu bayrak bir süre hiç geçilmiyordu: gerçek
 * modda worker `ok: true` görüp işi `sent` işaretliyor, "gönderildi" bildirimi
 * yazıyordu — hiçbir şey gönderilmemişken. Sessiz başarı, başarısızlıktan
 * beterdir: iş bir daha denenmez.
 *
 * Env semantiği worker ile AYNI ve güvenli tarafa düşer: `ORACLE_DRY_RUN`
 * varsayılanı kurudur, açıkça '0' yazılmadıkça gönderim yok.
 */
const GERCEK_GONDERIM =
  process.env.ORACLE_INTEGRATION_ENABLED === '1' &&
  process.env.ORACLE_DRY_RUN === '0' &&
  process.env.ORACLE_FILL_ONLY !== '1';

async function init() {
  if (!fs.existsSync(SCRIPT)) {
    throw new Error(`UI sürücü betiği bulunamadı: ${SCRIPT}`);
  }
}

/** Kuru çalışmada log'a basılacak insan-okunur plan. */
function describePlan(job) {
  const plan = toKeystrokePlan(job);
  const satirlar = plan.rows
    .map((r, i) => `      ${i + 1}. ${r.stokKodu} × ${r.miktar}${r.lot ? ` • lot/seri: ${r.lot}` : ''}${r.miad ? ` • miad: ${r.miad}` : ''}`)
    .join('\n');
  return [
    '    Doldurulacak alanlar:',
    `      İrsaliye No : ${plan.header.irsaliyeNo}`,
    `      Cari Kodu   : ${plan.header.cariKodu}`,
    `      Tarih       : ${plan.header.tarih}`,
    `      İşlem Tipi  : ${plan.header.islemTipi}`,
    `      Depo        : ${plan.header.depo}`,
    `      Açıklama    : ${plan.aciklama}`,
    '    Grid satırları:',
    satirlar,
    '    Kapanış: E-İRSALİYE GÖNDER',
  ].join('\n');
}

/**
 * @returns {Promise<{ok: true, ceomedIrsaliyeNo?: string, screenshotPath?: string}
 *                  | {ok: false, error: string, retryable: boolean}>}
 */
function submit(job) {
  const plan = toKeystrokePlan(job, { dateSeparator: process.env.ORACLE_DATE_SEP || '/' });

  return new Promise((resolve) => {
    // Oracle Forms alanları Windows kontrolleri olarak sunmadığı için eski
    // controls.json/pywinauto haritası kullanılmıyor. Python sürücüsü sahada
    // ölçülmüş MDI/pencere konumlarını ve geri okumayı kullanıyor.
    const args = [SCRIPT];
    if (process.env.ORACLE_ALLOW_POST_QUANTITY_WARNING === '1') {
      args.push('--miktar-uyarisini-onayla');
    }
    if (GERCEK_GONDERIM) {
      args.push('--gercek');
    }
    // SEVK ADRESİ VARSAYILAN OLARAK YAZILMIYOR.
    //
    // Sahada ölçüldü: Çekmeköy'ün adresi yazıldığı hâlde formda cariye kayıtlı
    // adres (Sancaktepe) göründü — Ceomed alanı cari kodundan kendisi
    // dolduruyor ve bizim yazdığımızı eziyor. Yazmak hem sonuç değiştirmiyor
    // hem de bir başarısızlık kaynağı (ilk denemede işi düşürdü, BK10133).
    //
    // Anahtar duruyor: Ceomed tarafında ek hizmet adresi ayrı tanımlanabilir
    // hâle gelirse ORACLE_SEVK_ADRESI=1 ile açılır.
    if (process.env.ORACLE_SEVK_ADRESI !== '1') {
      args.push('--sevk-adresi-yok');
    }
    const child = spawn(PYTHON, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: false,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        // Zaman aşımı yeniden denenebilir DEĞİLDİR: form yarı dolu kalmış ya da
        // e-irsaliye gönderilmiş olabilir. Körlemesine tekrar denemek mükerrer
        // muhasebe kaydı riski taşır — insan baksın.
        retryable: false,
        error: `UI otomasyonu ${TIMEOUT_MS / 1000} sn içinde bitmedi. Ceomed ekranını elle kontrol edin: ${describeJob(job)}`,
      });
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (e) => {
      clearTimeout(timer);
      finish({ ok: false, retryable: true, error: `Python başlatılamadı (${PYTHON}): ${e.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      // Python son satırda tek satırlık JSON sonuç basar.
      const lastLine = stdout.trim().split('\n').filter(Boolean).pop();
      let parsed = null;
      try {
        parsed = lastLine ? JSON.parse(lastLine) : null;
      } catch {
        parsed = null;
      }

      if (parsed && typeof parsed.ok === 'boolean') {
        if (parsed.ok && GERCEK_GONDERIM && parsed.kuru === true) {
          // Gönderim bekleniyordu ama Python kuru döndü. Bunu başarı saymak
          // işi gönderilmemişken 'sent' yapardı. Yeniden denenebilir DEĞİL:
          // sebebi bilinmeden tekrar denemek mükerrer riski taşır.
          finish({
            ok: false,
            retryable: false,
            error: 'Sürücü gerçek modda çalıştı ama Python E-İRSALİYE GÖNDER\'e '
                 + 'basmadan döndü (kuru sonuç). İş GÖNDERİLMEDİ; Ceomed ekranını '
                 + `elle kontrol edin: ${describeJob(job)}`,
            screenshotPath: parsed.screenshotPath,
          });
          return;
        }
        // `adimlar` HER İKİ YOLDA da taşınıyor. Python her alan yazımını, F6
        // sonucunu ve atlanan adımları bu diziye yazıyordu ama Node tarafı onu
        // atıyordu; worker log'unda yalnızca tek satırlık özet görünüyordu.
        // Sahada "F6 yapılmadı ama logda bir şey yok" tam olarak buydu —
        // otomasyonun ne yaptığı hiçbir yerde kayıtlı değildi.
        finish(parsed.ok
          ? {
              ok: true,
              kuru: parsed.kuru === true,
              ceomedIrsaliyeNo: parsed.ceomedIrsaliyeNo,
              screenshotPath: parsed.screenshotPath,
              adimlar: parsed.log || [],
              // `uyari`: gönderim başarılı ama F6 yenilemesi tutmadı. `not`:
              // kuru koşu açıklaması. İkisi de tek satırlık özette görünmüyordu;
              // F6 uyarısı özellikle önemli, çünkü sıradaki iş DOLU forma yazar.
              not: parsed.uyari || parsed.not || null,
            }
          : {
              ok: false,
              retryable: parsed.retryable !== false,
              error: parsed.error || 'UI otomasyonu başarısız.',
              screenshotPath: parsed.screenshotPath,
              adimlar: parsed.log || [],
            });
        return;
      }

      finish({
        ok: false,
        // Çıktı çözülemedi: formun hangi aşamada kaldığı bilinmiyor.
        retryable: false,
        error: `UI otomasyonu çözülemeyen çıktı verdi (exit ${code}). stderr: ${stderr.slice(0, 500)}`,
      });
    });

    child.stdin.write(JSON.stringify({ job: plan, jobId: job.id }));
    child.stdin.end();
  });
}

module.exports = { name: 'ui', init, submit, describePlan };
