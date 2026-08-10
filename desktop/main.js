/**
 * Qore Terminal — Electron ana süreci.
 *
 * Bu kabuk kendi arayüzünü ÇİZMEZ. Web uygulamasının `/terminal` rotasını
 * yükler ve ona masaüstünde gerçekten değerli olan üç şeyi kazandırır:
 *
 *   1. Tam ekran, adres çubuğu ve sekmesi olmayan tek işlik bir pencere
 *   2. Uygulamanın kapanmasını zorlaştıran koruma (F11/kısayol dışında)
 *   3. Yazıcıya doğrudan basım (tarayıcı yazdırma diyaloğu olmadan)
 *
 * Kimlik doğrulama, veri ve yetkiler tamamen web uygulamasından gelir; burada
 * saklanan bir kimlik bilgisi ya da ayrı bir Firebase yapılandırması YOKTUR.
 * Oturum, Electron'un kalıcı çerez/IndexedDB deposunda tutulur, dolayısıyla
 * uygulama her açılışta yeniden giriş istemez.
 */

'use strict';

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');

/**
 * Terminalin bağlanacağı adres.
 *
 * Üretimde bu, dağıtılmış web uygulamasının adresidir. Geliştirmede
 * `QORE_TERMINAL_URL=http://localhost:9002/terminal` verilerek yerel sunucuya
 * bağlanılır. Varsayılanı boş bırakmak yerine açık bir hata vermek bilinçli:
 * yanlış ortama sessizce bağlanan bir depo terminali, yanlış veritabanına
 * yazmak demektir.
 */
const TERMINAL_URL = process.env.QORE_TERMINAL_URL || '';

/** Sadece bu kaynaklara gezinmeye izin verilir. */
function isAllowedNavigation(targetUrl) {
  if (!TERMINAL_URL) return false;
  try {
    return new URL(targetUrl).origin === new URL(TERMINAL_URL).origin;
  } catch {
    return false;
  }
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#09090b', // /terminal arka planı — açılışta beyaz flaş olmasın
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Renderer web uygulamasıdır; Node erişimi olmamalıdır. Masaüstüne özel
      // yetenekler yalnızca preload'daki dar köprüden geçer.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (!TERMINAL_URL) {
    // Yapılandırma eksikse sessizce boş pencere göstermek yerine ne yapılması
    // gerektiğini söyle.
    mainWindow.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(`
          <body style="background:#09090b;color:#e4e4e7;font:16px/1.6 system-ui;padding:48px">
            <h1 style="font-size:24px">Terminal adresi tanımlı değil</h1>
            <p><code>QORE_TERMINAL_URL</code> ortam değişkeni ayarlanmalı.</p>
            <p style="color:#a1a1aa">Örnek: <code>QORE_TERMINAL_URL=https://app.example.com/terminal</code></p>
          </body>
        `),
    );
    return;
  }

  mainWindow.loadURL(TERMINAL_URL);

  // Dış bağlantılar sistem tarayıcısında açılır; terminal penceresi asla
  // uygulama dışına gezinmez.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Ağ koptuğunda beyaz ekran yerine ne olduğunu ve nasıl döneceğini göster.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // kullanıcı iptali — normal
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Bağlantı kurulamadı',
      message: 'Terminal yüklenemedi.',
      detail: `${errorDescription} (${errorCode})\n${validatedURL}\n\nAğ bağlantısını kontrol edip yeniden deneyin.`,
      buttons: ['Yeniden dene', 'Kapat'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) mainWindow.reload();
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Tek örnek kilidi.
 *
 * İki terminal penceresi aynı anda açık olursa aynı barkod iki kez işlenebilir
 * ve depo görevlisi hangisinin canlı olduğunu bilemez. İkinci başlatma
 * denemesi mevcut pencereyi öne getirir.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/**
 * Sessiz basım — etiket/irsaliye yazıcıları için.
 *
 * Varsayılan yazıcıya diyalog göstermeden basar. Depoda her sevkiyatta
 * "Yazdır" diyaloğunu onaylamak ölçülebilir bir zaman kaybıdır.
 */
ipcMain.handle('qore:print', async (_event, options = {}) => {
  if (!mainWindow) return { ok: false, error: 'Pencere yok' };
  return new Promise(resolve => {
    mainWindow.webContents.print(
      { silent: options.silent !== false, printBackground: true, deviceName: options.deviceName },
      (success, failureReason) => resolve({ ok: success, error: failureReason || null }),
    );
  });
});

/** Kullanılabilir yazıcıları döndürür — ayar ekranında listelemek için. */
ipcMain.handle('qore:printers', async () => {
  if (!mainWindow) return [];
  return mainWindow.webContents.getPrintersAsync();
});
