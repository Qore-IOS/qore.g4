'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LojistikSiparisGecmisPanel from '@/components/LojistikSiparisGecmisPanel';
import { useAuth } from '@/contexts/auth-context';

/**
 * Sipariş geçmişi paneli kaldırıldı: yeni geçmiş, Siparişler sayfasındaki
 * "Tamamlanan" sekmesidir. Standart kullanıcılar oraya yönlendirilir; lojistik
 * sorumlusu kendi geçmiş akışını görmeye devam eder.
 */
export default function SiparisGecmisPage() {
  const { currentUserProfile } = useAuth();
  const router = useRouter();
  const isLojistik = currentUserProfile?.role === 'lojistik_sorumlusu';

  useEffect(() => {
    if (!isLojistik) router.replace('/siparisler?tab=tamamlanan');
  }, [isLojistik, router]);

  if (isLojistik) return <LojistikSiparisGecmisPanel />;
  return null;
}
