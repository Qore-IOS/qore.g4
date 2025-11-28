
'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { hasOnlyProductUsagePermission } from '@/lib/permissions';
import { useAuth } from '@/contexts/auth-context';

/**
 * This component, when rendered once in a protected layout,
 * will redirect users with only 'product usage' permission to their default lab.
 */
export default function OnlyUsageAutoRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentUser: user, isLoadingAuth: loading, currentUserProfile: profile, permissions } = useAuth();

  useEffect(() => {
    if (loading || !user) {
      return;
    }
    
    if (hasOnlyProductUsagePermission(permissions)) {
      // If user is already on a usage page, do nothing
      if (pathname?.startsWith('/urun-kullanim')) return;

      // Priority: defaultLabId from profile -> first assigned lab -> fallback
      const labId = profile?.assignedLaboratories?.[0];

      if (labId) {
        router.replace(`/urun-kullanim/${labId}`);
      } else {
        router.replace('/urun-kullanim');
      }
    }
  }, [loading, user, permissions, profile, pathname, router]);

  return null;
}
