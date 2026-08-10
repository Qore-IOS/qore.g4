/**
 * @fileoverview Terminal düzeni — masaüstü depo uygulamasının kök kabuğu.
 *
 * `(protected)` düzeninin AKSİNE burada `AppLayout` (dock, başlangıç menüsü,
 * AI sohbeti, arka plan animasyonları) BİLEREK yüklenmez. Terminal tek işlik
 * bir ekrandır; o kabuğun getirdiği her şey depoda dikkat dağıtır ve düşük
 * donanımlı terminal makinelerinde ilk açılışı yavaşlatır.
 *
 * Kimlik doğrulama yine kök `AuthProvider` üzerinden gelir (src/app/layout.tsx),
 * dolayısıyla terminal web uygulamasıyla AYNI oturumu ve aynı özel talepleri
 * (companyId / isSuperAdmin) kullanır — Firestore kuralları değişmeden çalışır.
 */

'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useTerminalTheme } from '@/hooks/useTerminalTheme';
import { TerminalPrefetchProvider } from '@/components/terminal/prefetch-provider';

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  const { currentUser, isLoadingAuth } = useAuth();
  const router = useRouter();
  // Tema tercihini kök <html> üzerine uygular. Terminal, web uygulamasının
  // tema sağlayıcısını kullanmaz — tercih kullanıcıya değil MAKİNEYE aittir.
  useTerminalTheme();

  useEffect(() => {
    if (!isLoadingAuth && !currentUser) {
      router.replace('/login?next=/terminal');
    }
  }, [isLoadingAuth, currentUser, router]);

  if (isLoadingAuth || !currentUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <p className="text-lg">Oturum kontrol ediliyor…</p>
      </div>
    );
  }

  return <TerminalPrefetchProvider>{children}</TerminalPrefetchProvider>;
}
