/**
 * Çıkış irsaliyesini HANGİ okuma uç noktası görüyor? — güvenli tarama.
 *
 * `selectIrsaliyeMaster` (sevk modülü) bizim yazdığımız Çıkış İrsaliyesi'ni
 * görmüyor: BK10138 altı belge tipinde de bulunamadı, ama sorgular çalışıp
 * kayıt döndürdü. Yani belge başka bir modülün kapsamında.
 *
 * Bu betik app.js'ten çıkarılan irsaliye uç noktalarını sırayla dener ve
 * YANITIN İÇİNDE aranan numarayı arar. Alan adlarını bilmeye gerek yok: ham
 * gövdede geçiyorsa o uç nokta belgeyi görüyor demektir.
 *
 * ══ YALNIZCA OKUMA ══
 *
 * Liste elle seçilmiş `select*` uç noktalarından oluşuyor ve ayrıca çalışma
 * anında da denetleniyor: son yol parçası `select` ile başlamıyorsa uç nokta
 * ATLANIR. `insert*` / `update*` uç noktaları muhasebede kayıt oluşturur ya da
 * değiştirir; bir keşif aracının bunlara dokunması kabul edilemez.
 *
 * Kullanım:
 *   probe-irsaliye-uclari.bat --no BK10138 --tarih 2026-08-11
 */
const { login, BASE_URL } = require('./login');

/** app.js'ten çıkarılan uç noktalar — YALNIZCA select* olanlar alındı. */
const UC_NOKTALAR = [
  { yol: '/irsaliye/selectIrsaliyeMasterListesi', yontem: 'GET' },
  { yol: '/irsaliye/selectKurumGirisIrsaliye', yontem: 'GET' },
  { yol: '/irsaliye/selectIrsaliyeImportListesi', yontem: 'GET' },
  { yol: '/sevk/selectCeomedIrsaliye', yontem: 'POST' },
  { yol: '/sevk/selectIrsaliyeMaster', yontem: 'POST' },
  { yol: '/dogrulama/selectIrsaliyeMaster', yontem: 'POST' },
  { yol: '/dogrulama/selectIrsaliyeListesi', yontem: 'POST' },
  { yol: '/dogrulama/selectMMSIrsaliyeListesi', yontem: 'GET' },
];

/** Son yol parçası `select` ile başlamalı. Yazma uç noktası asla çağrılmaz. */
function okumaMi(yol) {
  const son = String(yol || '').split('/').filter(Boolean).pop() || '';
  return /^select/i.test(son);
}

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

/**
 * Denenecek parametre şekilleri. Uç noktaların imzaları belgelenmemiş; her biri
 * için birkaç makul şekil denenip hangisinin yanıt verdiğine bakılıyor.
 */
function parametreSekilleri(gun, idUser) {
  return [
    { ad: 'tarih aralığı', p: { BASLANGIC: gun, BITIS: gun, ID_USER: String(idUser), IP_ADDRESS: '' } },
    { ad: 'tarih + belge tipi', p: { BASLANGIC: gun, BITIS: gun, BELGE_TIPI: '0', ID_USER: String(idUser), IP_ADDRESS: '' } },
    { ad: 'yalnızca kullanıcı', p: { ID_USER: String(idUser), IP_ADDRESS: '' } },
  ];
}

async function cagir({ yol, yontem, token, parametreler }) {
  const basliklar = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Access-Token': token,
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/`,
  };

  let url = `${BASE_URL}/api${yol}`;
  const secenekler = { method: yontem, headers: basliklar };

  if (yontem === 'GET') {
    url += `?${new URLSearchParams(parametreler).toString()}`;
  } else {
    basliklar['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    secenekler.body = new URLSearchParams(parametreler).toString();
  }

  const res = await fetch(url, secenekler);
  const metin = await res.text();
  return { durum: res.status, metin };
}

async function main() {
  const no = String(argOku('no', '')).trim().toUpperCase();
  const tarih = argOku('tarih', new Date().toISOString().slice(0, 10));
  const gun = ceomedTarih(tarih);

  if (!no) throw new Error('Aranacak irsaliye numarası zorunlu: --no BK10138');
  if (!gun) throw new Error(`Tarih ISO biçiminde olmalı (YYYY-MM-DD): "${tarih}"`);

  const { token, user } = await login(process.env.CEOMED_EPOSTA, process.env.CEOMED_PAROLA);
  yaz(`"${no}" (${tarih}) hangi uç noktada görünüyor?\n`);

  const bulunanlar = [];
  const ornekAdaylari = [];

  for (const uc of UC_NOKTALAR) {
    if (!okumaMi(uc.yol)) {
      yaz(`  ${uc.yol}  ATLANDI — okuma uç noktası değil`);
      continue;
    }

    let enIyi = null;
    for (const sekil of parametreSekilleri(gun, user.ID_USER)) {
      let r;
      try {
        r = await cagir({ ...uc, token, parametreler: sekil.p });
      } catch (e) {
        enIyi = enIyi || { etiket: sekil.ad, ozet: `çağrılamadı: ${e.message}` };
        continue;
      }

      // Numarayı ham gövdede ara — alan adlarını bilmeye gerek yok.
      const iceriyor = r.metin.toUpperCase().includes(no);
      // Kayıt sayısı için kaba bir ölçü; şema bilinmiyor.
      let adet = null;
      try {
        const j = JSON.parse(r.metin);
        if (Array.isArray(j)) adet = j.length;
        else if (Array.isArray(j.data)) adet = j.data.length;
      } catch { /* JSON değil */ }

      const ozet = `HTTP ${r.durum}` +
        (adet != null ? `, ${adet} kayıt` : `, ${r.metin.length} bayt`) +
        (iceriyor ? '  ← NUMARA BULUNDU' : '');

      if (iceriyor) {
        bulunanlar.push({ yol: uc.yol, yontem: uc.yontem, sekil: sekil.ad });
        enIyi = { etiket: sekil.ad, ozet };
        break;
      }
      // En bilgilendirici denemeyi sakla: veri döndüren, döndürmeyene yeğ.
      if (!enIyi || (adet || 0) > 0) {
        enIyi = { etiket: sekil.ad, ozet, adet: adet || 0, metin: r.metin };
      }
    }

    if (enIyi && enIyi.adet) {
      ornekAdaylari.push({ yol: uc.yol, adet: enIyi.adet, metin: enIyi.metin });
    }
    yaz(`  ${uc.yontem.padEnd(4)} ${uc.yol.padEnd(42)} ${enIyi ? `${enIyi.ozet}  [${enIyi.etiket}]` : 'sonuç yok'}`);
  }

  // ÖRNEK KAYIT: "hiçbiri görmüyor" sonucunu kapatmadan önce en çok kayıt
  // döndüren uç noktanın NE döndürdüğüne bakmak gerekiyor. Kayıtlar bizimkiyle
  // aynı aileden ama başka bir dönemdense sorun kapsam değil PARAMETRE olur —
  // ikisi çok farklı sonuçlar ve çok farklı çözümler.
  const zengin = ornekAdaylari.filter((a) => a.adet > 0).sort((a, b) => b.adet - a.adet)[0];
  if (zengin && bulunanlar.length === 0) {
    yaz('');
    yaz(`En çok kayıt döndüren: ${zengin.yol} (${zengin.adet} kayıt)`);
    yaz('İlk kayıt — bizim belgemizle aynı aile mi?\n');
    try {
      const j = JSON.parse(zengin.metin);
      const liste = Array.isArray(j) ? j : j.data;
      yaz(JSON.stringify(liste[0], null, 2).split('\n').slice(0, 26).join('\n'));
    } catch {
      yaz(zengin.metin.slice(0, 500));
    }
  }

  yaz('');
  if (bulunanlar.length === 0) {
    yaz('Hiçbir uç nokta bu numarayı görmüyor.');
    yaz('');
    yaz('Çıkış İrsaliyesi büyük olasılıkla web API\'sinin kapsamı dışında —');
    yaz('yazma tarafında da oluşturan uç nokta yoktu. Kalan yol Oracle');
    yaz('veritabanını (192.168.1.5:1521) salt-okunur sorgulamak.');
    return 1;
  }

  yaz('BULUNDU:');
  for (const b of bulunanlar) {
    yaz(`  ${b.yontem} ${b.yol}   (parametre şekli: ${b.sekil})`);
  }
  yaz('');
  yaz('Bu çıktıyı paylaşın; doğrulama katmanı bu uç noktaya bağlanacak.');
  return 0;
}

main()
  .then((k) => process.exit(k))
  .catch((e) => {
    console.error(`[HATA] ${e && e.message ? e.message : e}`);
    process.exit(1);
  });
