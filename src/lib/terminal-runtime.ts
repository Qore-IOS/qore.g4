/**
 * @fileoverview Terminalin hangi kabukta çalıştığını söyleyen yardımcılar.
 *
 * Ekranların büyük kısmı bu bilgiye ihtiyaç duymaz ve duymamalıdır — aynı
 * bileşenler web'de ve masaüstünde çalışsın diye. Yalnızca masaüstü paketinde
 * GERÇEKTEN var olmayan bir şeye bağlı olan yerler bunu sorar.
 */

/**
 * Sayfa, `.exe` içine gömülü statik paketten mi sunuluyor?
 *
 * Ayırt edici işaret protokoldür: gömülü paket `app://terminal` kaynağından
 * servis edilir (bkz. `desktop/renderer.js`). `window.qoreDesktop` YETMEZ —
 * o, uzak kipte (masaüstü penceresi yayındaki siteyi yüklerken) de tanımlıdır
 * ve o kipte web rotalarının hepsi erişilebilirdir.
 */
export function isEmbeddedTerminal(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'app:';
}
