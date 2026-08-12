/**
 * Bir irsaliyenin Ceomed'de GERÇEKTEN oluştuğunu okuma API'siyle doğrular.
 *
 * Yazma tarafı ekran otomasyonu; "gönderildi" bilgisi ekrandan geliyor. Bu araç
 * aynı soruyu ekrandan bağımsız, Ceomed'in kendi verisinden cevaplar.
 *
 * Kullanım:
 *   verify-irsaliye.bat --no BK10134 --tarih 2026-08-11
 *   verify-irsaliye.bat --no BK10134 --tarih 2026-08-11 --kesfet
 *   verify-irsaliye.bat --tarih 2026-08-11 --listele
 *
 * --kesfet: numarayı hangi BELGE_TIPI altında bulacağını arar. Çıkış
 *   irsaliyelerinin tipi belgelenmemiş; bir kez ölçülüp .env'e
 *   CEOMED_CIKIS_BELGE_TIPI olarak yazılmalı. Bu yapılana kadar worker'ın
 *   otomatik doğrulaması yanlış tipe bakıp her işi "bulunamadı" sayabilir.
 */
const { login } = require('./login');
const { fetchIrsaliyeMaster } = require('./fetchIrsaliyeMaster');
const {
  irsaliyeVarMi,
  belgeTipiKesfet,
  VARSAYILAN_BELGE_TIPI,
  KESIF_TIPLERI,
} = require('./lib/ceomedDogrula');

function argOku(ad, varsayilan) {
  const i = process.argv.indexOf(`--${ad}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return varsayilan;
}

const yaz = (m) => console.log(m);

function ceomedTarih(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

async function listele(tarih, belgeTipi) {
  const g = ceomedTarih(tarih);
  if (!g) throw new Error(`Tarih ISO biçiminde olmalı (YYYY-MM-DD): "${tarih}"`);
  const { token, user } = await login(process.env.CEOMED_EPOSTA, process.env.CEOMED_PAROLA);
  const liste = await fetchIrsaliyeMaster({
    token, idUser: user.ID_USER, baslangic: g, bitis: g, belgeTipi,
  });
  yaz(`${tarih} — BELGE_TIPI=${belgeTipi} • ${liste.length} kayıt\n`);
  for (const i of liste) {
    yaz(`  ${String(i.IRSALIYE_NO || '').padEnd(10)} ${i.TARIH}  ${String(i.CARI_KODU || '').padEnd(8)} ${i.CARI_UNVAN || ''}  [${i.DURUM_ACIKLAMA || ''}]`);
  }
  return 0;
}

async function main() {
  const no = argOku('no', null);
  const tarih = argOku('tarih', new Date().toISOString().slice(0, 10));
  const belgeTipi = Number(argOku('belge-tipi', VARSAYILAN_BELGE_TIPI));

  if (process.argv.includes('--listele')) {
    return listele(tarih, belgeTipi);
  }

  if (!no) {
    throw new Error(
      'İrsaliye numarası zorunlu.\n' +
      '  verify-irsaliye.bat --no BK10134 --tarih 2026-08-11\n' +
      '  verify-irsaliye.bat --tarih 2026-08-11 --listele',
    );
  }

  if (process.argv.includes('--kesfet')) {
    yaz(`"${no}" (${tarih}) hangi BELGE_TIPI altında görünüyor, aranıyor...\n`);
    const sonuclar = await belgeTipiKesfet({ irsaliyeNo: no, tarih, tipler: KESIF_TIPLERI });
    for (const s of sonuclar) {
      const etiket = s.durum === 'bulundu' ? 'BULUNDU'
        : s.durum === 'bulunamadi' ? 'yok'
          : 'sorgulanamadı';
      yaz(`  BELGE_TIPI=${s.belgeTipi}  ${etiket}` +
          (s.taranan != null ? `  (${s.taranan} kayıt tarandı)` : '') +
          (s.hata ? `  — ${s.hata}` : ''));
    }
    const bulunan = sonuclar.find((s) => s.durum === 'bulundu');
    if (bulunan) {
      yaz(`\nBulundu. .env dosyanıza şunu ekleyin:\n  CEOMED_CIKIS_BELGE_TIPI=${bulunan.belgeTipi}`);
      yaz('\nKayıt:');
      yaz(`  ${bulunan.kayit.IRSALIYE_NO}  ${bulunan.kayit.TARIH}  ${bulunan.kayit.CARI_KODU}  ${bulunan.kayit.CARI_UNVAN || ''}  [${bulunan.kayit.DURUM_ACIKLAMA || ''}]`);
      return 0;
    }
    // SAHADA ÖLÇÜLDÜ (2026-08-11, BK10138): hiçbir tipte bulunamadı ama
    // sorgular çalıştı ve az sayıda kayıt döndü (2/1/1). Yani API erişilebilir,
    // aradığımız belge bu uç noktanın kapsamında değil.
    const dolu = sonuclar.filter((s) => (s.taranan || 0) > 0).length;
    yaz('\nHiçbir tipte bulunamadı.');
    if (dolu > 0) {
      yaz('\nAMA sorgular çalıştı ve kayıt döndü — yani API erişilebilir,');
      yaz('aradığımız belge bu uç noktanın KAPSAMINDA DEĞİL.');
      yaz('');
      yaz('selectIrsaliyeMaster bir SEVK modülü uç noktası; kuruma sevk edilen');
      yaz('irsaliyeleri listeliyor. Çıkış İrsaliyesi ayrı bir belge ailesi.');
      yaz('');
      yaz('Ne döndüğünü görmek için:');
      yaz(`  verify-irsaliye.bat --tarih ${tarih} --listele`);
      yaz('');
      yaz('Doğru uç noktayı aramak için (ORACLE-IRSALIYE.md#uç-nokta-keşfi):');
      yaz('  $js = (Invoke-WebRequest -Uri "http://192.168.1.5:8081/build/app.js?v=1.30" -UseBasicParsing).Content');
      yaz('  [regex]::Matches($js, \'a\\.api\\("(?:GET|POST)","[^"]*(?:irsaliye|Irsaliye|IRSALIYE)[^"]*"\') | %{ $_.Value } | Sort-Object -Unique');
    } else {
      yaz('\nHiçbir sorgu kayıt döndürmedi — tarih yanlış olabilir ya da API');
      yaz('bu kullanıcıya veri vermiyor. Önce şunu deneyin:');
      yaz(`  verify-irsaliye.bat --tarih ${tarih} --listele`);
    }
    return 1;
  }

  const r = await irsaliyeVarMi({ irsaliyeNo: no, tarih, belgeTipi });
  if (r.durum === 'bulundu') {
    const k = r.kayit;
    yaz(`BULUNDU — "${no}" Ceomed'de var.\n`);
    yaz(`  Tarih   : ${k.TARIH}`);
    yaz(`  Cari    : ${k.CARI_KODU}  ${k.CARI_UNVAN || ''}`);
    yaz(`  Durum   : ${k.DURUM_ACIKLAMA || '(yok)'}`);
    yaz(`  Ceomed ID: ${k.ID}`);
    return 0;
  }
  if (r.durum === 'bulunamadi') {
    yaz(`BULUNAMADI — "${no}" BELGE_TIPI=${belgeTipi} altında yok (${r.taranan} kayıt tarandı).`);
    yaz('\nBu, irsaliyenin oluşmadığı ANLAMINA GELMEZ; yanlış belge tipine');
    yaz('bakıyor olabiliriz. Önce şunu çalıştırın:');
    yaz(`  verify-irsaliye.bat --no ${no} --tarih ${tarih} --kesfet`);
    return 1;
  }
  yaz(`SORGULANAMADI — ${r.hata}`);
  yaz('\nCeomed API\'sine ulaşılamadı. İrsaliyenin durumu hakkında bir şey söylenemez.');
  return 2;
}

main()
  .then((k) => process.exit(k))
  .catch((e) => {
    console.error(`[HATA] ${e && e.message ? e.message : e}`);
    process.exit(1);
  });
