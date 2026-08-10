/**
 * @fileoverview Gömülü terminal paketinin sunulması.
 *
 * NEDEN `file://` DEĞİL: Chromium'da `file://` opak bir kaynaktır ve orada
 * IndexedDB güvenilir biçimde çalışmaz. Terminalin çevrimdışı çalışması ise
 * TAMAMEN IndexedDB'ye bağlıdır — hem Firestore'un kalıcı önbelleği hem de
 * Firebase Auth oturumu orada saklanır. `file://` ile açılan bir paket, her
 * açılışta oturumu ve önbelleği kaybederdi; yani çevrimdışı hiç çalışmazdı.
 *
 * Bu yüzden paket, gerçek bir kaynak (origin) üreten `app://` özel protokolü
 * üzerinden sunulur: `app://terminal/index.html`.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { protocol, net } = require('electron');

/** Vite çıktısının bulunduğu klasör. */
const RENDERER_DIR = path.join(__dirname, 'renderer-dist');

const SCHEME = 'app';
const HOST = 'terminal';

/** Gömülü paket bu kurulumda var mı? */
function hasEmbeddedRenderer() {
  return fs.existsSync(path.join(RENDERER_DIR, 'index.html'));
}

/**
 * Protokolü ayrıcalıklı olarak kaydeder.
 *
 * `app.whenReady()`'den ÖNCE çağrılmak ZORUNDA — Electron şema ayrıcalıklarını
 * ondan sonra kabul etmez.
 *
 *   standard        → gerçek bir origin üretir (depolama, CORS, çerezler)
 *   secure          → güvenli bağlam sayılır; IndexedDB ve crypto açılır
 *   supportFetchAPI → Firebase SDK'sı fetch kullanır
 */
function registerRendererScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/**
 * İstekleri `renderer-dist` içindeki dosyalara eşler.
 *
 * `app.whenReady()`'den SONRA çağrılır.
 */
function serveEmbeddedRenderer() {
  protocol.handle(SCHEME, async request => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';

    // Dizin dışına çıkma koruması: `app://terminal/../../etc/passwd` gibi bir
    // istek çözümlendikten sonra RENDERER_DIR dışına düşerse reddedilir.
    const resolved = path.resolve(RENDERER_DIR, relative);
    if (resolved !== RENDERER_DIR && !resolved.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Hash tabanlı router kullanıldığı için bilinmeyen yol pratikte oluşmaz;
    // yine de tek sayfalık uygulama alışkanlığıyla index.html'e düşülür.
    const target = fs.existsSync(resolved) ? resolved : path.join(RENDERER_DIR, 'index.html');
    return net.fetch(pathToFileURL(target).toString());
  });
}

/** Pencerenin yükleyeceği adres. */
function embeddedEntryUrl() {
  return `${SCHEME}://${HOST}/index.html`;
}

module.exports = {
  SCHEME,
  RENDERER_DIR,
  hasEmbeddedRenderer,
  registerRendererScheme,
  serveEmbeddedRenderer,
  embeddedEntryUrl,
};
