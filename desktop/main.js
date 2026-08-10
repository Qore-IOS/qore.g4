/**
 * Qore Terminal — Electron ana süreci.
 *
 * Bu kabuk kendi arayüzünü ÇİZMEZ. Web uygulamasının `/terminal` rotasını
 * yükler ve ona masaüstünde gerçekten değerli olan şeyleri kazandırır:
 *
 *   1. Tam ekran, adres çubuğu ve sekmesi olmayan tek işlik bir pencere
 *   2. Aynı anda tek örnek çalışma garantisi
 *   3. Yazıcıya diyalogsuz basım
 *
 * Kimlik doğrulama, veri ve yetkiler tamamen web uygulamasından gelir; burada
 * saklanan bir kimlik bilgisi ya da ayrı bir Firebase yapılandırması YOKTUR.
 * Oturum, Electron'un kalıcı çerez/IndexedDB deposunda tutulur, dolayısıyla
 * uygulama her açılışta yeniden giriş istemez.
 */

'use strict';

const { app, BrowserWindow, shell, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('node:path');

const { getTerminalUrl, setTerminalUrl } = require('./config');

let mainWindow = null;

/** Sadece yapılandırılmış terminalin kaynağına gezinmeye izin verilir. */
function isAllowedNavigation(targetUrl) {
  const terminalUrl = getTerminalUrl();
  if (!terminalUrl) return false;
  try {
    return new URL(targetUrl).origin === new URL(terminalUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Pencereye ne yükleneceğine karar verir.
 *
 * Adres yapılandırılmamışsa kurulum formu gösterilir. Boş bir pencere ya da
 * sessizce yanlış bir adrese bağlanmak kabul edilebilir değil: yanlış ortama
 * bağlanan bir depo terminali, yanlış veritabanına yazmak demektir.
 */
function loadTerminalOrSetup() {
  if (!mainWindow) return;
  const terminalUrl = getTerminalUrl();

  if (terminalUrl) mainWindow.loadURL(terminalUrl);
  else mainWindow.loadFile(path.join(__dirname, 'setup.html'));
}

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

  loadTerminalOrSetup();

  // Dış bağlantılar sistem tarayıcısında açılır; terminal penceresi asla
  // uygulama dışına gezinmez.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return; // kurulum sayfası
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Ağ koptuğunda beyaz ekran yerine ne olduğunu ve nasıl döneceğini göster.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // kullanıcı iptali — normal
    dialog
      .showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Bağlantı kurulamadı',
        message: 'Terminal yüklenemedi.',
        detail:
          `${errorDescription} (${errorCode})\n${validatedURL}\n\n` +
          'Ağ bağlantısını kontrol edin. Adres yanlışsa "Adresi değiştir" ile düzeltebilirsiniz.',
        buttons: ['Yeniden dene', 'Adresi değiştir', 'Kapat'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) mainWindow.reload();
        else if (response === 1) mainWindow.loadFile(path.join(__dirname, 'setup.html'));
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

    // Adresi sonradan değiştirmenin yolu. Menü çubuğu gizli olduğu için
    // (depoda dikkat dağıtmasın diye) tek erişim noktası bu kısayol.
    globalShortcut.register('CommandOrControl+Shift+U', () => {
      if (mainWindow) mainWindow.loadFile(path.join(__dirname, 'setup.html'));
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/** Kurulum formundan gelen adresi kaydeder ve terminale geçer. */
ipcMain.handle('qore:set-url', async (_event, url) => {
  const result = setTerminalUrl(url);
  if (result.ok) loadTerminalOrSetup();
  return result;
});

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
