'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Palette, Image, Layout, Settings2, MousePointer2, Droplets, Check } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import BackButton from '@/components/BackButton';
import { cn } from '@/lib/utils';

export default function KisisellistirmePanel() {
  const { isAdmin, dockStyle, setDockStyle } = useAuth();

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

  const dockStyles = [
    {
      key: 'hover' as const,
      icon: MousePointer2,
      title: 'Hover Görünümü',
      description: 'Mouse ile üzerine gelindiğinde ikonlar büyür ve yukarı kalkar',
    },
    {
      key: 'liquid' as const,
      icon: Droplets,
      title: 'Liquid Glass',
      description: 'Cam efektli seçici mouse ile akışkan şekilde ikonlar arasında kayar',
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
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Dock Style Selection - Active Feature */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg font-headline flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            Dock Görünümü
          </CardTitle>
          <CardDescription>
            Alt navigasyon çubuğunun (dock) görünüm stilini seçin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {dockStyles.map((style) => (
              <button
                key={style.key}
                onClick={() => setDockStyle(style.key)}
                className={cn(
                  "relative flex flex-col items-start p-4 rounded-lg border-2 transition-all duration-200 text-left",
                  dockStyle === style.key
                    ? "border-primary bg-primary/5 shadow-md"
                    : "border-border hover:border-primary/50 hover:bg-accent/50"
                )}
              >
                {/* Selected indicator */}
                {dockStyle === style.key && (
                  <div className="absolute top-3 right-3">
                    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground">
                      <Check className="w-3 h-3" />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 mb-2">
                  <div className={cn(
                    "p-2 rounded-lg",
                    dockStyle === style.key ? "bg-primary/10" : "bg-muted"
                  )}>
                    <style.icon className={cn(
                      "h-5 w-5",
                      dockStyle === style.key ? "text-primary" : "text-muted-foreground"
                    )} />
                  </div>
                  <span className="font-medium">{style.title}</span>
                </div>
                <p className="text-sm text-muted-foreground pl-12">
                  {style.description}
                </p>

                {/* Preview hint for Liquid */}
                {style.key === 'liquid' && (
                  <div className="mt-3 pl-12">
                    <span className="text-xs px-2 py-1 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                      Apple Liquid Glass
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Liquid Glass Info */}
          {dockStyle === 'liquid' && (
            <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20">
              <p className="text-sm text-blue-600 dark:text-blue-400">
                <strong>Liquid Glass Aktif:</strong> Dock&apos;un üzerine geldiğinizde cam efektli seçici görünecek
                ve ikonlar arasında akışkan bir şekilde hareket edecektir.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upcoming Features Grid */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg font-headline">Yakında Gelecek Özellikler</CardTitle>
          <CardDescription>
            Bu özellikler gelecek güncellemelerle eklenecektir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {upcomingFeatures.map((feature) => (
              <div
                key={feature.title}
                className="flex flex-col items-center justify-center p-4 rounded-lg border-2 border-dashed border-muted opacity-60 text-center"
              >
                <feature.icon className="h-8 w-8 mb-2 text-muted-foreground" />
                <span className="font-medium text-sm mb-1">{feature.title}</span>
                <span className="text-xs text-muted-foreground mb-2">{feature.description}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {feature.phase}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
