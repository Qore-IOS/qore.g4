/**
 * @fileoverview Android kabuğunun (Capacitor) yapılandırması.
 *
 * TEK KOPYA İLKESİ, masaüstündeki gibi: burada arayüz yok. `webDir`,
 * `vite.config.terminal.ts` ile üretilen AYNI paketi gösterir; ekranlar,
 * yazma mantığı ve çevrimdışı davranış web/masaüstü ile birebir aynıdır.
 *
 * Paket nasıl üretilir:
 *
 *     npm run build:terminal:android   → android-app/www
 *     npx cap sync android             → android/app/src/main/assets/public
 */

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.qore.terminal',
  appName: 'Qore Terminal',
  webDir: 'android-app/www',

  server: {
    /**
     * `https` ŞART.
     *
     * Varsayılan `http://localhost` güvenli olmayan bir kaynaktır; orada
     * IndexedDB ve dolayısıyla Firestore'un kalıcı önbelleği ile Firebase
     * Auth'un oturum saklaması güvenilmez çalışır. Terminalin tamamı
     * çevrimdışı açılabilmeye dayanıyor — bu satır masaüstündeki `app://`
     * özel protokolünün Android'deki karşılığıdır.
     */
    androidScheme: 'https',
  },

  android: {
    /**
     * Donanım klavyesinden gelen girdiyi WebView yakalasın.
     *
     * El terminallerindeki (Zebra, Honeywell, Urovo…) barkod okuyucular
     * "keyboard wedge" kipinde tuş vuruşu üretir; `useHidScanner` tam olarak
     * bunu dinler. Bu bayrak olmadan bazı cihazlarda vuruşlar WebView'a
     * ulaşmadan yutulur ve okutma hiç çalışmaz.
     */
    captureInput: true,

    /**
     * Karışık içerik kapalı: paket kendi içinden `https://localhost`
     * üzerinden sunulur, düz HTTP'ye çıkması gereken hiçbir yer yok.
     */
    allowMixedContent: false,

    /** Açılışta beyaz sıçrama olmasın; koyu tema varsayılan. */
    backgroundColor: '#09090b',

    /**
     * Güvenli alan boşluğu EKLENMEZ — çünkü sistem çubukları hiç yok.
     *
     * `MainActivity` durum ve gezinme çubuklarını gizliyor (tam ekran kip).
     * Bu ayar `auto` kalsaydı Capacitor, olmayan çubuklar için üstte ve altta
     * boşluk bırakacak ve ekranın bir kısmı boşuna harcanacaktı.
     */
    adjustMarginsForEdgeToEdge: 'disable',
  },

  plugins: {
    /**
     * Firestore/Auth ağ isteklerini Capacitor'ın yerel HTTP köprüsüne
     * ÇEVİRME. Firebase Web SDK kendi taşıma katmanını (fetch + WebChannel)
     * kullanır; araya girmek uzun ömürlü dinleyicileri bozar.
     */
    CapacitorHttp: { enabled: false },
    CapacitorCookies: { enabled: false },
  },
};

export default config;
