'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

export default function Home() {
  const { currentUser, isLoadingAuth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoadingAuth) {
      if (currentUser) {
        const lastPath = localStorage.getItem('last_path');
        // Redirect to the last visited path, or fallback to /dashboard
        router.replace(lastPath || '/dashboard');
      } else {
        router.replace('/login');
      }
    }
  }, [currentUser, isLoadingAuth, router]);

  // The loading screen is handled globally by LoadingProvider,
  // so this component just needs to handle the redirect logic.
  return null;
}
