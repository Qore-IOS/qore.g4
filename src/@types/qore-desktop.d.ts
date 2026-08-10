/**
 * Masaüstü kabuğunun (desktop/preload.js) renderer'a açtığı köprünün tipi.
 *
 * `window.qoreDesktop` YALNIZCA Electron kabuğunda tanımlıdır. Aynı sayfalar
 * tarayıcıda da çalıştığı için tip opsiyoneldir — çağırmadan önce her zaman
 * varlığını kontrol edin:
 *
 *     if (window.qoreDesktop?.isDesktop) await window.qoreDesktop.print();
 */

export {};

declare global {
  interface QoreDesktopPrinter {
    name: string;
    displayName?: string;
    description?: string;
    status?: number;
    isDefault?: boolean;
  }

  interface QoreDesktopBridge {
    /** Masaüstü kabuğunda çalışıldığını belirtir; her zaman `true`. */
    isDesktop: true;
    /** Kabuğun sürümü; okunamazsa `null`. */
    version: string | null;
    /** Aktif sayfayı yazıcıya basar. `silent` varsayılan olarak açıktır. */
    print(options?: {
      silent?: boolean;
      deviceName?: string;
    }): Promise<{ ok: boolean; error: string | null }>;
    /** Sistemde tanımlı yazıcıları listeler. */
    listPrinters(): Promise<QoreDesktopPrinter[]>;
  }

  interface Window {
    qoreDesktop?: QoreDesktopBridge;
  }
}
