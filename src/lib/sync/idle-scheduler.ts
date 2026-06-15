/**
 * @fileoverview Tarama (barkod) hot-path'ini etkilemeden arka planda iş çalıştırmak
 * için küçük, çerçeveden bağımsız bir idle zamanlayıcı. `requestIdleCallback`
 * varsa onu kullanır; yoksa `setTimeout`'a düşer. Amaç: kullanıcı hızlı okutma
 * yaparken (sürekli re-render) drenajı ertelemek, okutma duraklayınca devreye
 * sokmak. `timeout` sayesinde yoğun yük altında bile garanti tetiklenir.
 *
 * Hem Mal Kabul (oto kabul) hem de ileride Direkt Transfer arka plan işleyicisi
 * tarafından paylaşılır.
 */

export type IdleHandle = number;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Bir geri çağrımı tarayıcı boştayken çalıştırır.
 * @param cb Çalıştırılacak fonksiyon
 * @param timeoutMs En geç bu süre içinde garanti çalışsın (yoğun yük emniyeti)
 */
export function scheduleIdle(cb: () => void, timeoutMs = 400): IdleHandle {
  if (typeof window === 'undefined') {
    // SSR / test ortamı: hemen mikro-görev olarak çalıştır.
    return setTimeout(cb, 0) as unknown as IdleHandle;
  }
  const w = window as IdleWindow;
  if (typeof w.requestIdleCallback === 'function') {
    return w.requestIdleCallback(cb, { timeout: timeoutMs });
  }
  // Safari/eski tarayıcı fallback: kısa gecikmeli makro-görev.
  return window.setTimeout(cb, 80) as unknown as IdleHandle;
}

/** scheduleIdle ile planlanmış bir görevi iptal eder. */
export function cancelIdle(handle: IdleHandle | null | undefined): void {
  if (handle == null) return;
  if (typeof window === 'undefined') {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    return;
  }
  const w = window as IdleWindow;
  if (typeof w.cancelIdleCallback === 'function') {
    w.cancelIdleCallback(handle);
  } else {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  }
}

/**
 * Bir değeri Firestore belge kimliği olarak güvenli hale getirir.
 * İzin verilen karakterler dışındakileri '_' ile değiştirir, rezerve desenlerden
 * (`.`, `..`, `__...__`) kaçınmak için çağıran tarafın bir önek koyması beklenir.
 */
export function sanitizeFsId(value: string): string {
  return (value || '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 1400);
}
