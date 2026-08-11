/**
 * @fileoverview Terminalin hangi kabukta çalıştığını söyleyen yardımcılar.
 *
 * Ekranların büyük kısmı bu bilgiye ihtiyaç duymaz ve duymamalıdır — aynı
 * bileşenler web'de ve masaüstünde çalışsın diye. Yalnızca masaüstü paketinde
 * GERÇEKTEN var olmayan bir şeye bağlı olan yerler bunu sorar.
 */

/**
 * Sayfa, kabuğun İÇİNE gömülü statik paketten mi sunuluyor?
 *
 * İki kabuk için de doğrudur:
 *
 *   - Masaüstü (Electron): paket `app://terminal` kaynağından servis edilir
 *     (bkz. `desktop/renderer.js`).
 *   - Android (Capacitor): paket APK içinden `https://localhost` üzerinden
 *     servis edilir. Burada protokole bakmak İŞE YARAMAZ — yayındaki web
 *     uygulaması da `https:`tir; ayırt edici işaret Capacitor köprüsüdür.
 *
 * Ortak nokta: her ikisinde de yalnızca terminal ekranları paketlenmiştir,
 * web uygulamasının diğer rotaları yoktur.
 *
 * `window.qoreDesktop` tek başına YETMEZ — o, uzak kipte (masaüstü penceresi
 * yayındaki siteyi yüklerken) de tanımlıdır ve orada tüm web rotaları
 * erişilebilirdir.
 */
export function isEmbeddedTerminal(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol === 'app:') return true;
  return Boolean((window as any).Capacitor?.isNativePlatform?.());
}
