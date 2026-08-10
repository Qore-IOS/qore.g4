/**
 * Qore Terminal — preload köprüsü.
 *
 * Renderer'a açılan yüzey BİLEREK çok dar tutulur. İki ayrı köprü vardır:
 *
 *   - `window.qoreDesktop` → web uygulamasının kullandığı yetenekler
 *   - `window.qoreSetup`   → yalnızca ilk açılış formunun kullandığı kayıt
 *
 * Web uygulaması aynı kodla tarayıcıda da çalıştığı için, sayfalar
 * `qoreDesktop`'ın varlığını kontrol etmeli ve yoksa tarayıcı davranışına
 * düşmelidir.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qoreDesktop', {
  /** Sayfa masaüstü kabuğunda mı çalışıyor? */
  isDesktop: true,

  /** Uygulama sürümü — hata bildirimlerinde işe yarar. */
  version: process.env.npm_package_version || null,

  /**
   * Aktif sayfayı yazıcıya basar.
   * @param {{ silent?: boolean, deviceName?: string }} [options]
   * @returns {Promise<{ ok: boolean, error: string | null }>}
   */
  print: options => ipcRenderer.invoke('qore:print', options),

  /** Sistemdeki yazıcıları listeler. */
  listPrinters: () => ipcRenderer.invoke('qore:printers'),
});

contextBridge.exposeInMainWorld('qoreSetup', {
  /**
   * Terminal adresini kalıcı olarak kaydeder.
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  save: url => ipcRenderer.invoke('qore:set-url', url),
});
