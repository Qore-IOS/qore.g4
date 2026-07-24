
// components/AutoRedirectOnLogin.tsx
'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { hasOnlyProductUsagePermission } from '@/lib/permissions';
import type { AppView } from '@/lib/types';
import { LOJISTIK_HOME_PATH } from '@/lib/lojistik/navigation';

export default function AutoRedirectOnLogin() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentUser, isLoadingAuth, currentUserProfile } = useAuth();

  useEffect(() => {
    if (isLoadingAuth || !currentUser || pathname === '/login') {
        return;
    }

    // Check for specific role-based redirects first
    const userRole = currentUserProfile?.role;

    // Sarf dağıtım personeli yalnızca tek ekran görür: /sarf-teslimat
    if (userRole === 'sarf_dagitim_personeli' && !pathname?.startsWith('/sarf-teslimat')) {
      router.replace('/sarf-teslimat');
      return;
    }

    // Redirect teknik_lojistik users to /direkt-transfer/yedek-parca-transfer
    if (userRole === 'teknik_lojistik' && pathname === '/dashboard') {
      router.replace('/direkt-transfer/yedek-parca-transfer');
      return;
    }

    // Lojistik sorumlusu kendisine özel lojistik ana sayfasına iner.
    if (userRole === 'lojistik_sorumlusu' && pathname === '/dashboard') {
      router.replace(LOJISTIK_HOME_PATH);
      return;
    }

    // Redirect teknik_servis and aplikasyon users to /cihaz-yonetimi-ana
    if ((userRole === 'teknik_servis' || userRole === 'aplikasyon') && pathname === '/dashboard') {
      router.replace('/cihaz-yonetimi-ana');
      return;
    }

    // Redirect 'user' role to /urun-kullanim
    if (userRole === 'user' && pathname === '/dashboard') {
      router.replace('/urun-kullanim');
      return;
    }

    // Redirect users with only product usage permission
    if (pathname !== '/urun-kullanim' && hasOnlyProductUsagePermission(currentUserProfile?.accessibleViews)) {
      router.replace('/urun-kullanim');
      return;
    }
  }, [currentUser, isLoadingAuth, currentUserProfile, router, pathname]);

  return null;
}
