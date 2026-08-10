/**
 * Qore Terminal — preload köprüsü.
 *
 * Renderer'a açılan yüzey BİLEREK çok dar tutulur: yalnızca yazıcı işlemleri
 * ve "masaüstünde miyiz" bilgisi. Web uygulaması aynı kodla tarayıcıda da
 * çalıştığı için, sayfalar bu köprünün varlığını kontrol etmeli ve yoksa
 * tarayıcı davranışına düşmelidir.
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
