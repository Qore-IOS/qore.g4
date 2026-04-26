'use client';
import SiparisGecmisPanel from '@/components/siparis-gecmis-panel';
import LojistikSiparisGecmisPanel from '@/components/LojistikSiparisGecmisPanel';
import { useAuth } from '@/contexts/auth-context';

export default function SiparisGecmisPage() {
  const { currentUserProfile } = useAuth();
  if (currentUserProfile?.role === 'lojistik_sorumlusu') {
    return <LojistikSiparisGecmisPanel />;
  }
  return <SiparisGecmisPanel />;
}
