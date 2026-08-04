/**
 * Ceomed irsaliyesindeki kurumu Qore laboratuvarıyla eşleştirir.
 *
 * Eşleşme `hospitals.ceomedCariKodu` üzerinden yapılır. Bir cari kodu birden
 * çok laboratuvara tanımlıysa (ana laboratuvar + ek hizmet laboratuvarları
 * aynı kurumun cari kodunu paylaşabilir) ayrım `hospitals.sevkAdresi` ile
 * irsaliyenin `ADRES` alanı karşılaştırılarak yapılır.
 *
 * Belirsizlik ASLA tahminle kapatılmaz: sıfır ya da birden çok aday kalırsa
 * eşleşme başarısız sayılır ve irsaliye onay kuyruğunda bekler. Yanlış
 * laboratuvara sessizce stok yazmak, elle aktarımdan çok daha pahalı bir
 * hatadır — düzeltmek için lab stoğundan tek tek silmek gerekir.
 *
 * Saf fonksiyon: Firestore/ağ bağımlılığı yoktur, doğrudan test edilebilir.
 */

/** Karşılaştırma için metni normalize eder (boşluk, kasa, Türkçe karakter). */
function normalize(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLocaleUpperCase('tr-TR')
    .replace(/\s+/g, ' ');
}

/**
 * @param {{ cariKodu?: string, sevkAdresi?: string }} irsaliye
 * @param {Array<{ id: string, name?: string, ceomedCariKodu?: string, sevkAdresi?: string }>} hospitals
 * @returns {{ matched: true, lab: object } | { matched: false, reason: string, detail: string, candidates: string[] }}
 */
function matchLab(irsaliye, hospitals) {
  const cari = normalize(irsaliye && irsaliye.cariKodu);
  if (!cari) {
    return {
      matched: false,
      reason: 'irsaliyede_cari_kodu_yok',
      detail: 'İrsaliyede CARI_KODU alanı boş.',
      candidates: [],
    };
  }

  const byCari = (hospitals || []).filter((h) => normalize(h.ceomedCariKodu) === cari);

  if (byCari.length === 0) {
    return {
      matched: false,
      reason: 'cari_kodu_eslesmedi',
      detail: `"${irsaliye.cariKodu}" cari koduna sahip laboratuvar yok. Laboratuvar yönetiminden ilgili laboratuvara Ceomed cari kodunu tanımlayın.`,
      candidates: [],
    };
  }

  if (byCari.length === 1) {
    return { matched: true, lab: byCari[0] };
  }

  // Aynı cari koduna birden çok laboratuvar bağlı → sevk adresiyle ayrıştır.
  const adres = normalize(irsaliye.sevkAdresi);
  if (!adres) {
    return {
      matched: false,
      reason: 'sevk_adresi_yok',
      detail: `"${irsaliye.cariKodu}" cari kodu ${byCari.length} laboratuvara tanımlı ama irsaliyede sevk adresi yok; hangisi olduğu belirlenemedi.`,
      candidates: byCari.map((h) => h.id),
    };
  }

  const byAdres = byCari.filter((h) => normalize(h.sevkAdresi) === adres);
  if (byAdres.length === 1) {
    return { matched: true, lab: byAdres[0] };
  }

  return {
    matched: false,
    reason: byAdres.length === 0 ? 'sevk_adresi_eslesmedi' : 'birden_cok_aday',
    detail:
      byAdres.length === 0
        ? `"${irsaliye.cariKodu}" için ${byCari.length} laboratuvar var; hiçbirinin sevk adresi "${irsaliye.sevkAdresi}" ile eşleşmedi.`
        : `"${irsaliye.cariKodu}" + "${irsaliye.sevkAdresi}" için ${byAdres.length} laboratuvar eşleşti; ayrım yapılamadı.`,
    candidates: (byAdres.length === 0 ? byCari : byAdres).map((h) => h.id),
  };
}

module.exports = { matchLab, normalize };
