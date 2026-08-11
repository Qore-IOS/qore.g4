/**
 * @fileoverview Masaüstü terminal paketinin kök bileşeni.
 *
 * TEK KOPYA İLKESİ: Buradaki ekranlar yeniden yazılmadı — `src/app/terminal/**`
 * altındaki AYNI bileşenler import edilip render ediliyor. Web'de Next router
 * ile, masaüstünde `next/navigation` shim'i ile çalışıyorlar; ekranların
 * kendisi bu farkı görmüyor.
 *
 * Giriş ekranı da aynı şekilde web uygulamasının `/login` sayfasıdır.
 */

import React, { useEffect } from 'react';
// `next/navigation` Vite tarafında shim'e yönlendirilir (vite.config.terminal.ts).
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/contexts/auth-context';
import { exitNativeApp, pushBackHandler } from '@/lib/native-shell';

import TerminalHomePage from '@/app/terminal/page';
import TerminalMalKabulPage from '@/app/terminal/mal-kabul/page';
import TerminalTransferPage from '@/app/terminal/transfer/page';
import TerminalSiparislerPage from '@/app/terminal/siparisler/page';
import TerminalSorguPage from '@/app/terminal/sorgu/page';
import TerminalToplamaPage from '@/app/terminal/toplama/page';
import TerminalBekleyenPage from '@/app/terminal/bekleyen/page';
import LoginPage from '@/app/login/page';

/** Hash yolundan ekrana eşleme. */
const ROUTES: Record<string, React.ComponentType> = {
  '/terminal': TerminalHomePage,
  '/terminal/mal-kabul': TerminalMalKabulPage,
  '/terminal/transfer': TerminalTransferPage,
  '/terminal/siparisler': TerminalSiparislerPage,
  '/terminal/sorgu': TerminalSorguPage,
  '/terminal/toplama': TerminalToplamaPage,
  '/terminal/bekleyen': TerminalBekleyenPage,
};

function FullScreenMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2 bg-background text-muted-foreground">
      <p className="text-lg font-medium">{title}</p>
      {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export default function App() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, isLoadingAuth } = useAuth();

  const isKnownRoute = Object.prototype.hasOwnProperty.call(ROUTES, pathname);

  /**
   * Bu pakette olmayan bir yola düşüldüğünde terminale dön.
   *
   * Asıl tetikleyici giriş ekranıdır: `/login` başarılı girişten sonra
   * kullanıcının rolüne göre `/dashboard` gibi bir web rotasına yönlendirir.
   * O ekranlar masaüstü paketine dâhil değil, dolayısıyla "bulunamadı"da
   * takılmak yerine terminale çıkmak doğru davranış.
   */
  useEffect(() => {
    if (currentUser && !isLoadingAuth && !isKnownRoute) router.replace('/terminal');
  }, [currentUser, isLoadingAuth, isKnownRoute, router]);

  /**
   * Android donanım geri tuşu.
   *
   * En alttaki (varsayılan) işleyici budur; kamera örtüsü gibi geçici
   * katmanlar kendi işleyicisini yığının üstüne koyar ve önce onlar çalışır.
   *
   * Ana ekranda geri = uygulamadan çık. WebView geçmişinde geri gitmek
   * yerine bunu yapıyoruz; hash router'da geçmiş bir vardiya boyunca birikir
   * ve kullanıcı geri tuşuyla saatler önceki ekranlarda dolaşırdı.
   */
  useEffect(
    () =>
      pushBackHandler(() => {
        if (pathname === '/terminal') void exitNativeApp();
        else router.push('/terminal');
      }),
    [pathname, router],
  );

  if (isLoadingAuth) {
    return (
      <FullScreenMessage
        title="Oturum kontrol ediliyor…"
        detail="Bu adım internet olmadan da çalışır; oturum cihazda saklanır."
      />
    );
  }

  // Oturum yoksa giriş ekranı. İLK giriş internet gerektirir — Firebase Auth
  // parolayı doğrulamak için sunucuya gitmek zorundadır. Bir kez giriş
  // yapıldıktan sonra oturum cihazda saklanır ve çevrimdışı açılışlarda
  // korunur.
  if (!currentUser) return <LoginPage />;

  const Screen = ROUTES[pathname];
  if (!Screen) return <FullScreenMessage title="Terminale dönülüyor…" />;

  return <Screen />;
}
