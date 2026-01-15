
// components/AutoRedirectOnLogin.tsx
'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { hasOnlyProductUsagePermission } from '@/lib/permissions';
import type { AppView } from '@/lib/types';

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

    // Redirect teknik_servis and aplikasyon users to /cihaz-yonetimi-ana
    if ((userRole === 'teknik_servis' || userRole === 'aplikasyon') && pathname === '/dashboard') {
      router.replace('/cihaz-yonetimi-ana');
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
