
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
    if (isLoadingAuth || !currentUser || pathname === '/login' || pathname === '/urun-kullanim') {
        return;
    }

    if (hasOnlyProductUsagePermission(currentUserProfile?.accessibleViews)) {
      router.replace('/urun-kullanim');
    }
  }, [currentUser, isLoadingAuth, currentUserProfile, router, pathname]);

  return null;
}
