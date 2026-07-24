'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { LOJISTIK_HOME_PATH } from '@/lib/lojistik/navigation';

export default function Home() {
  const { currentUser, isLoadingAuth, currentUserProfile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoadingAuth) {
      if (currentUser) {
        const lastPath = localStorage.getItem('last_path');
        router.replace(
          currentUserProfile?.role === 'lojistik_sorumlusu'
            ? LOJISTIK_HOME_PATH
            : lastPath || '/dashboard',
        );
      } else {
        router.replace('/login');
      }
    }
  }, [currentUser, currentUserProfile?.role, isLoadingAuth, router]);

  // The loading screen is handled globally by LoadingProvider,
  // so this component just needs to handle the redirect logic.
  return null;
}
