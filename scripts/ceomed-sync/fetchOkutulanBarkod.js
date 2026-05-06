const { login, BASE_URL } = require('./login');

async function fetchOkutulanBarkod({ token, evrakSeq, idUser }) {
  const body = new URLSearchParams({
    EVRAK_SEQ: String(evrakSeq),
    ID_USER: String(idUser),
    IP_ADDRESS: '',
  });

  const res = await fetch(`${BASE_URL}/api/sevk/selectOkutulanBarkod`, {
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
    throw new Error(`selectOkutulanBarkod HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (!json.status) {
    throw new Error(`selectOkutulanBarkod reddedildi: ${JSON.stringify(json)}`);
  }

  return json.data.map((b) => ({
    BARKOD_SERI: b.BARKOD_SERI,
    BARKOD: b.BARKOD,
    STOK_KODU: b.STOK_KODU,
    LOT: b.LOT,
    MIYAT: b.MIYAT,
    MIKTAR: b.MIKTAR,
  }));
}

module.exports = { fetchOkutulanBarkod };

if (require.main === module) {
  const [, , evrakSeq] = process.argv;
  if (!evrakSeq) {
    console.error('Kullanım: node fetchOkutulanBarkod.js <EVRAK_SEQ>');
    process.exit(1);
  }
  (async () => {
    const { token, user } = await login(process.env.CEOMED_EPOSTA, process.env.CEOMED_PAROLA);
    const items = await fetchOkutulanBarkod({ token, evrakSeq, idUser: user.ID_USER });
    console.log(`OK — ${items.length} barkod kaydı`);
    console.table(items);
  })().catch((e) => {
    console.error('HATA:', e.message);
    process.exit(1);
  });
}
