/**
 * Qore Terminal — Electron ana süreci.
 *
 * İKİ ÇALIŞMA KİPİ VAR:
 *
 *   1. GÖMÜLÜ (varsayılan) — arayüz `desktop/renderer-dist` içinde, uygulamayla
 *      birlikte kurulur ve `app://` protokolünden sunulur. İnternet olmadan
 *      açılır; Firestore'un kalıcı önbelleğinden okur, yazımları kuyruğa alır.
 *
 *   2. UZAK — arayüz yayındaki web uygulamasından (`/terminal`) yüklenir.
 *      Gömülü paket yoksa ya da `QORE_TERMINAL_URL` verilmişse bu kip
 *      çalışır. Geliştirmede ve arayüzü yeniden paketlemeden denemek için.
 *
 * Kimlik doğrulama, veri ve yetkiler her iki kipte de Firebase'den gelir;
 * burada saklanan bir kimlik bilgisi YOKTUR. Oturum, Electron'un kalıcı
 * IndexedDB deposunda tutulur — bu yüzden çevrimdışı açılışta korunur.
 */

'use strict';

const { app, BrowserWindow, shell, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('node:path');

const { getTerminalUrl, setTerminalUrl } = require('./config');
const {
  SCHEME,
  hasEmbeddedRenderer,
  registerRendererScheme,
  serveEmbeddedRenderer,
  embeddedEntryUrl,
} = require('./renderer');

let mainWindow = null;

/**
 * Gömülü paket mi kullanılacak?
 *
 * `QORE_TERMINAL_URL` verildiyse uzak kip kazanır — geliştirici bilerek
 * yayındaki sürüme bakmak istemiştir ve bunu sessizce yok saymak kafa
 * karıştırıcı olurdu.
 */
function useEmbedded() {
  return !process.env.QORE_TERMINAL_URL && hasEmbeddedRenderer();
}

// Şema kaydı `whenReady`'den ÖNCE olmak zorunda.
if (hasEmbeddedRenderer()) registerRendererScheme();

/** Gezinmeye izin verilen kaynaklar. */
function isAllowedNavigation(targetUrl) {
  if (targetUrl.startsWith(`${SCHEME}://`)) return true;
  if (targetUrl.startsWith('file://')) return true; // kurulum sayfası
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
 * Uzak kipte adres yapılandırılmamışsa kurulum formu gösterilir. Boş bir
 * pencere ya da sessizce yanlış bir adrese bağlanmak kabul edilebilir değil:
 * yanlış ortama bağlanan bir depo terminali, yanlış veritabanına yazmak
 * demektir.
 */
function loadTerminalOrSetup() {
  if (!mainWindow) return;

  if (useEmbedded()) {
    mainWindow.loadURL(embeddedEntryUrl());
    return;
  }

  const terminalUrl = process.env.QORE_TERMINAL_URL || getTerminalUrl();
  if (terminalUrl) mainWindow.loadURL(terminalUrl);
  else mainWindow.loadFile(path.join(__dirname, 'setup.html'));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#09090b', // terminal arka planı — açılışta beyaz flaş olmasın
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
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  /**
   * HTTP hata sayfalarını yakala (404, 403, 500 …).
   *
   * NEDEN AYRI BİR DİNLEYİCİ: `did-fail-load` YALNIZCA ağ seviyesindeki
   * hatalarda çalışır. Bir 404, Chromium açısından BAŞARILI bir yüklemedir —
   * sunucu gövde döndürmüştür. Yani yanlış adres girilmiş bir terminal,
   * sunucunun 404 sayfasını gösterip orada kalıyordu: ne uyarı çıkıyordu ne de
   * "Adresi değiştir" düğmesi, çünkü hiçbir hata olayı tetiklenmiyordu.
   *
   * Kullanıcının tek çıkışı `Ctrl+Shift+U` kısayolunu bilmekti; bilmiyorsa
   * uygulamayı kaldırıp yeniden kurmak bile işe yaramaz (adres, kaldırmada
   * silinmeyen kullanıcı verisinde saklanır).
   */
  mainWindow.webContents.on('did-navigate', (_event, url, httpResponseCode, httpStatusText) => {
    if (useEmbedded()) return;
    if (!httpResponseCode || httpResponseCode < 400) return;

    dialog
      .showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Terminal sayfası bulunamadı',
        message: `Sunucu ${httpResponseCode} döndürdü.`,
        detail:
          `${url}\n${httpStatusText || ''}\n\n` +
          'Bu genellikle iki şeyden biridir:\n' +
          '  • Adres yanlış (sonu /terminal ile bitmeli)\n' +
          '  • Uygulamanın yeni sürümü henüz yayınlanmadı\n\n' +
          'Adresi tarayıcıda açıp deneyebilirsiniz; orada da hata veriyorsa ' +
          'sorun adreste değil, yayında.',
        buttons: ['Adresi değiştir', 'Yeniden dene', 'Kapat'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) mainWindow.loadFile(path.join(__dirname, 'setup.html'));
        else if (response === 1) mainWindow.reload();
      });
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // kullanıcı iptali — normal

    // Gömülü kipte ağ hatası pencereyi ETKİLEMEZ: sayfa zaten diskten yüklenir,
    // başarısız olan yalnızca Firebase'e giden veri istekleridir ve onları
    // arayüzdeki bağlantı göstergesi anlatır. Buraya bir uyarı kutusu koymak
    // her çevrimdışı vardiyada kullanıcının önüne modal çıkarırdı.
    if (useEmbedded()) return;

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
    if (hasEmbeddedRenderer()) serveEmbeddedRenderer();
    createWindow();

    // Uzak kipte adresi sonradan değiştirmenin yolu. Menü çubuğu gizli olduğu
    // için (depoda dikkat dağıtmasın diye) tek erişim noktası bu kısayol.
    globalShortcut.register('CommandOrControl+Shift+U', () => {
      if (mainWindow) mainWindow.loadFile(path.join(__dirname, 'setup.html'));
    });

    /**
     * Geliştirici araçları — yerele İNEN VERİYİ CANLI GÖRMEK İÇİN.
     *
     * Terminalin tüm çalışma verisi Firestore'un kalıcı önbelleğinde, yani
     * IndexedDB'de duruyor. O dosyalar diskte LevelDB biçiminde ve uygulama
     * açıkken kilitli: dışarıdan bir araçla okunmaya çalışıldığında ya
     * okunamıyor ya da yarım yazılmış bir durum görünüyor.
     *
     * Veriyi güvenle ve CANLI izlemenin tek doğru yolu uygulamanın kendi
     * penceresinden bakmak: Application → Storage → IndexedDB. Kayıtlar
     * değiştikçe orada anında güncelleniyor.
     *
     * Menü çubuğu depoda dikkat dağıtmasın diye gizli, bu yüzden kısayol.
     */
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (mainWindow) mainWindow.webContents.toggleDevTools();
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

/**
 * Kayıtlı adresi döndürür — kurulum formu bunu alana önceden doldurur.
 *
 * Yanlış bir adres girildiğinde kullanıcının ilk ihtiyacı NE girdiğini
 * görmektir; boş bir forma yeniden yazmak, aynı hatayı tekrarlamayı kolaylaştırır.
 */
ipcMain.handle('qore:get-url', async () => getTerminalUrl() || '');

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
