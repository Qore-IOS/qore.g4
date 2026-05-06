const { login, BASE_URL } = require('./login');

async function fetchIrsaliyeMaster({ token, idUser, baslangic, bitis, belgeTipi = 1 }) {
  const body = new URLSearchParams({
    BASLANGIC: baslangic,
    BITIS: bitis,
    BELGE_TIPI: String(belgeTipi),
    ID_USER: String(idUser),
    IP_ADDRESS: '',
  });

  const res = await fetch(`${BASE_URL}/api/sevk/selectIrsaliyeMaster`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Access-Token': token,
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`selectIrsaliyeMaster HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (!json.status) {
    throw new Error(`selectIrsaliyeMaster reddedildi: ${JSON.stringify(json)}`);
  }
  return json.data;
}

const SEVK_EDILDI_DURUM = 'KURUMA SEVK EDILDI';

function filterSevkEdildi(list) {
  return list.filter((i) => (i.DURUM_ACIKLAMA || '').toUpperCase() === SEVK_EDILDI_DURUM);
}

module.exports = { fetchIrsaliyeMaster, filterSevkEdildi, SEVK_EDILDI_DURUM };

if (require.main === module) {
  const [, , baslangic, bitis] = process.argv;
  if (!baslangic || !bitis) {
    console.error('Kullanım: node fetchIrsaliyeMaster.js <BASLANGIC dd.MM.yyyy> <BITIS dd.MM.yyyy>');
    process.exit(1);
  }
  (async () => {
    const { token, user } = await login(process.env.CEOMED_EPOSTA, process.env.CEOMED_PAROLA);
    const all = await fetchIrsaliyeMaster({
      token,
      idUser: user.ID_USER,
      baslangic,
      bitis,
    });
    const onlySevk = process.argv.includes('--sevk-edildi');
    const list = onlySevk ? filterSevkEdildi(all) : all;
    console.log(`OK — ${all.length} irsaliye${onlySevk ? ` (${list.length} adet "${SEVK_EDILDI_DURUM}")` : ''}`);
    for (const i of list) {
      console.log(
        `  ${i.IRSALIYE_NO}  ${i.TARIH}  ${i.CARI_KODU}  ${i.CARI_UNVAN}  [${i.DURUM_ACIKLAMA}]  ID=${i.ID}`
      );
    }
  })().catch((e) => {
    console.error('HATA:', e.message);
    process.exit(1);
  });
}
