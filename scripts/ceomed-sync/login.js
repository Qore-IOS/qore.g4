const BASE_URL = process.env.CEOMED_BASE_URL || 'http://192.168.1.5:8081';

async function login(eposta, parola) {
  const body = new URLSearchParams({
    E_POSTA: eposta,
    PAROLA: parola,
    ID_USER: '',
    IP_ADDRESS: '',
  });

  const res = await fetch(`${BASE_URL}/login/doLogin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Login HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (!json.status) {
    throw new Error(`Login reddedildi: ${JSON.stringify(json)}`);
  }

  return {
    token: json.token.token,
    user: json.data,
  };
}

module.exports = { login, BASE_URL };

if (require.main === module) {
  const eposta = process.env.CEOMED_EPOSTA;
  const parola = process.env.CEOMED_PAROLA;
  if (!eposta || !parola) {
    console.error('CEOMED_EPOSTA ve CEOMED_PAROLA environment değişkenlerini ayarla.');
    process.exit(1);
  }
  login(eposta, parola)
    .then((r) => {
      console.log('OK — kullanıcı:', r.user.ADI_SOYADI, `(ID_USER=${r.user.ID_USER})`);
      console.log('Token:', r.token.slice(0, 40) + '...');
    })
    .catch((e) => {
      console.error('HATA:', e.message);
      process.exit(1);
    });
}
