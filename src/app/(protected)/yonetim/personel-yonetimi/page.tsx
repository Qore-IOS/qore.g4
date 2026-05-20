'use client';
import React from 'react';
import { Clock, Wallet, CalendarCheck, LogOut, Coins } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import {
  YonetimShell,
  YonetimHeader,
  YonetimTile,
  YonetimTileGrid,
  YonetimCard,
} from '@/components/yonetim-ui/YonetimHub';

export default function PersonelYonetimiPage() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <YonetimShell>
        <YonetimCard title="Yetkisiz Erişim" description="Bu sayfaya erişim yetkiniz bulunmamaktadır.">
          <div />
        </YonetimCard>
      </YonetimShell>
    );
  }

  const modules = [
    {
      icon: Coins,
      label: 'Maaş Yönetimi',
      description: 'Personel maaşları ve lab atamaları — test maliyetinde kullanılır.',
      href: '/yonetim/personel-yonetimi/maaslar',
      color: '#42e46d',
    },
    {
      icon: LogOut,
      label: 'Oturum Yönetimi',
      description: 'Personel grupları ve oturum atamaları.',
      href: '/yonetim/personel-yonetimi/oturum-yonetimi',
      color: '#fb923c',
    },
    {
      icon: Clock,
      label: 'Ek Mesai Yönetimi',
      description: 'Mesai talepleri ve onay akışı.',
      href: '/yonetim/personel-yonetimi/ek-mesai-yonetimi',
      color: '#6ea8ff',
    },
    {
      icon: Wallet,
      label: 'Masraf Yönetimi',
      description: 'Personel masraf bildirimleri ve geri ödeme.',
      href: '/yonetim/personel-yonetimi/masraf-yonetimi',
      color: '#a78bfa',
    },
    {
      icon: CalendarCheck,
      label: 'İzin Yönetimi',
      description: 'Yıllık, mazeret ve diğer izin takvimi.',
      href: '/yonetim/personel-yonetimi/izin-yonetimi',
      color: '#fc7272',
    },
  ];

  return (
    <YonetimShell>
      <YonetimHeader
        title="Personel Yönetimi"
        description="Personel oturumları, izinler, mesai ve maaş işlemlerini yönetin."
        backHref="/yonetim"
      />

      <YonetimTileGrid>
        {modules.map((m) => (
          <YonetimTile key={m.label} {...m} />
        ))}
      </YonetimTileGrid>
    </YonetimShell>
  );
}
