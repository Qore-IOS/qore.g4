/**
 * @fileoverview Android (Capacitor) kabuğuyla konuşan İNCE katman.
 *
 * TASARIM KURALI: Ekranlar bu dosyayı bilmez. Terminal ekranları web'de,
 * masaüstünde ve Android'de AYNI koddur; kabuk farkı yalnızca burada ve
 * `terminal-app/main.tsx` gibi giriş noktalarında görünür.
 *
 * Capacitor eklentileri DİNAMİK import edilir. İki sebebi var:
 *
 *   1. Web (Next) derlemesi ve masaüstü paketi bu kodu asla çalıştırmaz;
 *      statik import olsaydı eklentiler o paketlere de girerdi.
 *   2. Eklentiler yerel platform yokken çağrıldığında "not implemented"
 *      fırlatır. Önce `isNativeApp()` sorulur, sonra import edilir.
 *
 * Her fonksiyon yerel platform dışında SESSİZCE hiçbir şey yapmaz — çağıran
 * tarafta `if (android)` dallanması gerekmesin diye.
 */

'use client';

/** Uygulama gerçek bir Android/iOS kabuğunun içinde mi çalışıyor? */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/** Yerel platformun adı — günlüklerde ve derleme damgasında işe yarar. */
export function getNativePlatform(): string {
  if (typeof window === 'undefined') return 'server';
  return (window as any).Capacitor?.getPlatform?.() || 'web';
}

/**
 * Durum çubuğunu temayla eşitler.
 *
 * Yapılmazsa açık temada beyaz zemin üstünde beyaz saat yazısı çıkar ve
 * saat/pil okunmaz olur. Küçük görünen ama depoda vardiya boyunca ekrana
 * bakan biri için can sıkıcı bir ayrıntı.
 */
export async function syncStatusBarTheme(theme: 'light' | 'dark'): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // `Style.Dark` = koyu zemin için AÇIK yazı; isimlendirme tersine
    // okunuyor, bu yüzden eşleme burada açıkça yazıldı.
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: theme === 'dark' ? '#09090b' : '#efeae0' });
  } catch {
    /* Eklenti yoksa ya da cihaz desteklemiyorsa tema yine de çalışır. */
  }
}

/**
 * Donanım geri tuşu — YIĞIN mantığıyla.
 *
 * Capacitor'ın varsayılanı WebView geçmişinde geri gitmektir. Terminalde bu
 * YANLIŞ davranış üretir: hash tabanlı router'da bir vardiya boyunca onlarca
 * geçmiş kaydı birikir ve geri tuşu kullanıcıyı dakikalarca önceki ekranlara
 * gezdirir. Beklenen davranış tek ve basittir — bir üst seviyeye çık,
 * terminal ana ekranındaysan uygulamadan çık.
 *
 * Neden yığın: kamera tarama örtüsü açıkken geri tuşu ÖRTÜYÜ kapatmalı,
 * ekranı değiştirmemeli. Tek bir dinleyici olsaydı iki davranış aynı anda
 * çalışır, kullanıcı hem örtüyü kaybeder hem ana ekrana atılırdı. Bu yüzden
 * yalnızca EN ÜSTTEKİ işleyici çağrılır.
 */
const backHandlers: Array<() => void> = [];
let backListenerRemove: (() => void) | null = null;

function ensureBackListener(): void {
  if (backListenerRemove || !isNativeApp()) return;
  // Yer tutucu: import beklerken ikinci bir dinleyici kurulmasın.
  backListenerRemove = () => {};

  import('@capacitor/app')
    .then(async ({ App }) => {
      const listener = await App.addListener('backButton', () => {
        const top = backHandlers[backHandlers.length - 1];
        if (top) top();
      });
      backListenerRemove = () => listener.remove();
    })
    .catch(() => {
      // Eklenti yüklenemedi: varsayılan (geçmişte geri) davranış geçerli kalır.
      backListenerRemove = null;
    });
}

/**
 * Geri tuşu işleyicisini yığına ekler.
 *
 * @returns İşleyiciyi yığından çıkaran fonksiyon.
 */
export function pushBackHandler(handler: () => void): () => void {
  if (!isNativeApp()) return () => {};
  ensureBackListener();
  backHandlers.push(handler);
  return () => {
    const index = backHandlers.lastIndexOf(handler);
    if (index !== -1) backHandlers.splice(index, 1);
  };
}

/** Uygulamayı arka plana alır (Android'de "çıkış" beklentisinin karşılığı). */
export async function exitNativeApp(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { App } = await import('@capacitor/app');
    await App.exitApp();
  } catch {
    /* yoksayılır — kullanıcı ana ekrana kendi çıkar */
  }
}
