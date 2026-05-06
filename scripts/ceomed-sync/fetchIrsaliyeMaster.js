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

module.exports = { fetchIrsaliyeMaster };

if (require.main === module) {
  const [, , baslangic, bitis] = process.argv;
  if (!baslangic || !bitis) {
    console.error('Kullanım: node fetchIrsaliyeMaster.js <BASLANGIC dd.MM.yyyy> <BITIS dd.MM.yyyy>');
    process.exit(1);
  }
  (async () => {
    const { token, user } = await login(process.env.CEOMED_EPOSTA, process.env.CEOMED_PAROLA);
    const list = await fetchIrsaliyeMaster({
      token,
      idUser: user.ID_USER,
      baslangic,
      bitis,
    });
    console.log(`OK — ${list.length} irsaliye`);
    for (const i of list) {
      console.log(
        `  ${i.IRSALIYE_NO}  ${i.TARIH}  ${i.CARI_KODU}  ${i.CARI_UNVAN}  [${i.DURUM_ACIKLAMA}]  EVRAK_SEQ=${i.EVRAK_SEQ}`
      );
    }
  })().catch((e) => {
    console.error('HATA:', e.message);
    process.exit(1);
  });
}
