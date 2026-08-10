/**
 * Tema önyükleyici — React'ten ÖNCE çalışır.
 *
 * Ayrı bir dosya olmasının sebebi İçerik Güvenlik Politikası: `script-src
 * 'self'` satır içi betiğe izin vermez. Satır içi yazıp politikayı
 * `'unsafe-inline'` ile gevşetmek, tek bir tema sıçraması için tüm sayfayı
 * betik enjeksiyonuna açmak olurdu.
 *
 * Klasik (module olmayan) betik olduğu için `<head>` içinde bloke çalışır ve
 * ilk boyamadan önce sınıfı yerleştirir.
 */
(function () {
  try {
    var stored = localStorage.getItem('qore.terminal.theme');
    var dark = stored !== 'light';
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {
    /* gizli mod / kota — koyu varsayılanla devam */
  }
})();
