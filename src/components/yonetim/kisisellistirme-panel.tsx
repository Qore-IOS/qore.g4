'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Palette, Image, Layout, Settings2 } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import BackButton from '@/components/BackButton';

export default function KisisellistirmePanel() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <Card className="shadow-lg m-6">
        <CardHeader>
          <CardTitle className="text-xl font-headline">Yetkisiz Erişim</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Bu panele erişim yetkiniz bulunmamaktadır.</p>
        </CardContent>
      </Card>
    );
  }

  // Faz 1: Boş panel yapısı - gelecek fazlarda doldurulacak
  const upcomingFeatures = [
    {
      icon: Image,
      title: 'Logo Yönetimi',
      description: 'Sistem logosu ve favicon ayarları',
      phase: 'Faz 2',
    },
    {
      icon: Palette,
      title: 'Tema Renkleri',
      description: 'Ana renkler ve renk paleti özelleştirme',
      phase: 'Faz 3',
    },
    {
      icon: Layout,
      title: 'Arayüz Düzeni',
      description: 'Sayfa düzeni ve bileşen görünümleri',
      phase: 'Faz 4',
    },
    {
      icon: Settings2,
      title: 'Gelişmiş Ayarlar',
      description: 'Diğer görsel ve sistem ayarları',
      phase: 'Faz 5',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <BackButton />

      {/* Header */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-headline flex items-center gap-2">
            <Palette className="h-6 w-6 text-primary" />
            Kişiselleştirme Paneli
          </CardTitle>
          <CardDescription>
            Sistem görsellerini ve arayüz ayarlarını buradan yönetebilirsiniz.
            Bu panel faz faz geliştirilmektedir.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Upcoming Features Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {upcomingFeatures.map((feature) => (
          <Card
            key={feature.title}
            className="bg-card/60 border-dashed border-2 opacity-70"
          >
            <CardContent className="flex flex-col items-center justify-center p-6 text-center">
              <feature.icon className="h-10 w-10 mb-3 text-muted-foreground" />
              <CardTitle className="text-base font-headline mb-1">{feature.title}</CardTitle>
              <CardDescription className="text-sm mb-2">{feature.description}</CardDescription>
              <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                {feature.phase}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Info Card */}
      <Card className="bg-blue-500/10 border-blue-500/20">
        <CardContent className="p-4">
          <p className="text-sm text-blue-600 dark:text-blue-400">
            <strong>Bilgi:</strong> Kişiselleştirme özellikleri yakında aktif edilecektir.
            Bu panel üzerinden logo, tema renkleri ve arayüz düzenini özelleştirebileceksiniz.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
