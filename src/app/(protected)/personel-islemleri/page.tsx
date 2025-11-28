'use client';
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Clock, Wallet, CalendarCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';

const modules = [
  {
    name: 'Ek Mesai Yönetimi',
    icon: Clock,
    description: 'Personel ek mesai taleplerini ve onay süreçlerini yönetin.',
    path: '/personel-islemleri/ek-mesai',
  },
  {
    name: 'Masraf Yönetimi',
    icon: Wallet,
    description: 'Personel masraf bildirimlerini ve geri ödeme işlemlerini takip edin.',
    path: '/masraf-yonetimi',
  },
  {
    name: 'İzin Yönetimi',
    icon: CalendarCheck,
    description: 'Yıllık, mazeret ve diğer izin taleplerini ve takvimini yönetin.',
    path: '#', // Placeholder
  },
];

export default function PersonelIslemleriPage() {
  const router = useRouter();

  return (
    <div className="p-6 space-y-6">
       <Card>
        <CardHeader>
          <CardTitle>Personel İşlemleri</CardTitle>
          <CardDescription>İnsan kaynakları ve personel yönetimi modülleri.</CardDescription>
        </CardHeader>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {modules.map((mod) => (
          <Card 
            key={mod.name} 
            className="hover:shadow-lg transition-shadow cursor-pointer"
            onClick={() => mod.path !== '#' && router.push(mod.path)}
          >
            <CardHeader className="flex flex-row items-center gap-4">
              <mod.icon className="h-8 w-8 text-primary" />
              <CardTitle>{mod.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{mod.description}</p>
              {mod.path === '#' && <p className="text-xs text-amber-500 mt-4">Daha sonra güncellemeler eklenecektir.</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
