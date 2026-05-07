const { login, BASE_URL } = require('./login');

/**
 * Ceomed merkez depo stok listesini çeker (selectMerkezDepoListesi).
 * GET ile çağrılır, query params: ID_USER, IP_ADDRESS.
 */
async function fetchMerkezDepoListesi({ token, idUser }) {
  const url = `${BASE_URL}/api/sayim/selectMerkezDepoListesi?ID_USER=${encodeURIComponent(
    idUser
  )}&IP_ADDRESS=`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Access-Token': token,
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/`,
    },
  });

  if (!res.ok) {
    throw new Error(`selectMerkezDepoListesi HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (!json.status) {
    throw new Error(`selectMerkezDepoListesi reddedildi: ${JSON.stringify(json)}`);
  }
  return json.data;
}

/**
 * Belirli bir depo kodu için ham yanıttan stoğu çıkarır.
 * row[`DEPO{kodu}`] miktarı verir; > 0 olanları döner.
 */
function extractDepoStock(rawList, depoKodu) {
  const key = `DEPO${depoKodu}`;
  return rawList
    .filter((r) => Number(r[key]) > 0)
    .map((r) => ({
      stokKodu: r.STOK_KODU,
      stokAdi: r.STOK_ADI,
      lot: r.LOT || '',
      miyat: r.MIYAT || '',
      kod: r.KOD || '',
      aciklama: r.ACIKLAMA || '',
      adet: Number(r[key]) || 0,
    }));
}

module.exports = { fetchMerkezDepoListesi, extractDepoStock };

if (require.main === module) {
  const [, , depoKodu] = process.argv;
  if (!depoKodu) {
    console.error('Kullanım: node fetchMerkezDepoListesi.js <DEPO_KODU>');
    process.exit(1);
  }
  (async () => {
    const { token, user } = await login(process.env.CEOMED_EPOSTA, process.env.CEOMED_PAROLA);
    const raw = await fetchMerkezDepoListesi({ token, idUser: user.ID_USER });
    const items = extractDepoStock(raw, depoKodu);
    console.log(`OK — ${items.length} stok kalemi (DEPO${depoKodu})`);
    console.table(items.slice(0, 20));
  })().catch((e) => {
    console.error('HATA:', e.message);
    process.exit(1);
  });
}
