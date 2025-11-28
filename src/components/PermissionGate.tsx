// components/PermissionGate.tsx
'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { hasOnlyProductUsagePermission } from '@/lib/permissions';

type Props = {
  children: React.ReactNode;
  allowDashboard?: boolean; // dashboard sayfasında false ise engeller
};

export default function PermissionGate({ children, allowDashboard }: Props) {
  const router = useRouter();
  const { currentUser, isLoadingAuth, currentUserProfile } = useAuth();

  useEffect(() => {
    if (isLoadingAuth) return;

    if (!currentUser) return;

    // Eğer kullanıcı sadece Ürün Kullanım iznine sahipse:
    if (hasOnlyProductUsagePermission(currentUserProfile?.accessibleViews)) {
      // Dashboard'ı asla görmesin:
      if (allowDashboard === false) {
        router.replace('/urun-kullanim'); // sizin panel path’iniz
        return;
      }
    }
  }, [isLoadingAuth, currentUser, currentUserProfile, allowDashboard, router]);

  return <>{children}</>;
}
