'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, Clock, Wallet, CalendarCheck, LogOut, Coins } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { useAuth } from '@/contexts/auth-context';

export default function PersonelYonetimiPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();

  const modules = [
    {
      name: 'Maaş Yönetimi',
      icon: Coins,
      description: 'Personel maaşlarını ve laboratuvar atamalarını yönetin. Test bazlı maliyet hesabında kullanılır.',
      path: '/yonetim/personel-yonetimi/maaslar',
    },
    {
      name: 'Oturum Yönetimi',
      icon: LogOut,
      description: 'Personel gruplarını oluşturun ve kullanıcı oturumlarını yönetin.',
      path: '/yonetim/personel-yonetimi/oturum-yonetimi',
    },
    {
      name: 'Ek Mesai Yönetimi',
      icon: Clock,
      description: 'Personel ek mesai taleplerini ve onay süreçlerini yönetin.',
      path: '/yonetim/personel-yonetimi/ek-mesai-yonetimi', 
    },
    {
      name: 'Masraf Yönetimi',
      icon: Wallet,
      description: 'Personel masraf bildirimlerini ve geri ödeme işlemlerini takip edin.',
      path: '/yonetim/personel-yonetimi/ek-mesai-yonetimi', // Reusing the same page for now
    },
    {
      name: 'İzin Yönetimi',
      icon: CalendarCheck,
      description: 'Yıllık, mazeret ve diğer izin taleplerini ve takvimini yönetin.',
      path: '/yonetim/personel-yonetimi/izin-yonetimi',
    },
  ];
  
  if (!isAdmin) {
    return (
      <Card className="m-6">
        <CardHeader><CardTitle className="text-xl font-headline">Yetkisiz Erişim</CardTitle></CardHeader>
        <CardContent><p>Bu sayfaya erişim yetkiniz bulunmamaktadır.</p></CardContent>
      </Card>
    );
  }

  return (
    <div className="p-6 space-y-6">
        <BackButton fallback="/yonetim" />
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-2xl font-headline">
                    <Users className="h-6 w-6" /> Personel Yönetimi
                </CardTitle>
                <CardDescription>Personel oturumları, grupları ve diğer insan kaynakları işlemlerini yönetin.</CardDescription>
            </CardHeader>
        </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {modules.map((mod) => (
            <Card
                key={mod.name}
                className="hover:shadow-lg transition-shadow cursor-pointer flex flex-col"
                onClick={() => mod.path !== '#' ? router.push(mod.path) : null}
            >
                <CardHeader className="flex-grow">
                    <div className="flex flex-row items-start gap-4">
                        <div className="bg-primary/10 p-3 rounded-lg">
                            <mod.icon className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <CardTitle>{mod.name}</CardTitle>
                            <CardDescription className="mt-1 text-xs">{mod.description}</CardDescription>
                        </div>
                    </div>
                </CardHeader>
            </Card>
        ))}
      </div>
    </div>
  );
}
