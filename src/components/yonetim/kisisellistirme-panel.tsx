'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Palette, Image, Layout, Settings2, MousePointer2, Droplets, Check, Sun, Moon, X, ImageIcon } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import BackButton from '@/components/BackButton';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';

const PUBLIC_IMAGES = [
  '234724.png', '235016.png', '236209.png', '236609.png',
  '303.png', '303 nw.png', '503.png',
  '634404.png', '634503.png', '634602.png', '635305.png', '636800.png',
  '703.png', '703 kit.png', '703kit.png', '703nw.png',
  '801.png', '801 kit.png',
  'A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG',
  'Başlıksız-2.png', 'Başlıksız-3.png',
  'ChatGPT Image 6 Ağu 2025 09_10_30.png',
  'IFS.png', 'QORE-INV_LOGO.PNG',
  'alkim kartuş.png', 'blk.png', 'e411.png',
  'invitrolab_LOGO__-_Kopya__1_-removebg.png',
  'lab.png', 'lab_diorama.png', 'newlogoblk.png', 'newlogowh.png', 'wt.png',
];

export default function KisisellistirmePanel() {
  const { isAdmin, dockStyle, setDockStyle, wallpaper, setWallpaper } = useAuth();

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

      {/* Wallpaper Settings */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg font-headline flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            Ürün Kullanım Paneli Duvar Kağıdı
          </CardTitle>
          <CardDescription>
            Ürün kullanım panelinin arka planında gösterilecek görseli açık ve koyu mod için ayrı ayrı seçebilirsiniz.
            Görsel ekranın altından başlayıp yukarı doğru soluklaşarak kaybolur.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Light Mode Wallpaper */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sun className="h-4 w-4 text-amber-500" />
              <span className="font-medium text-sm">Açık Mod Duvar Kağıdı</span>
              {wallpaper.light && (
                <button
                  onClick={() => setWallpaper('light', null)}
                  className="ml-auto flex items-center gap-1 text-xs text-destructive hover:underline"
                >
                  <X className="h-3 w-3" /> Kaldır
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {PUBLIC_IMAGES.map((img) => (
                <button
                  key={`light-${img}`}
                  onClick={() => setWallpaper('light', `/${img}`)}
                  className={cn(
                    "relative aspect-square rounded-lg border-2 overflow-hidden transition-all duration-200 hover:scale-105",
                    wallpaper.light === `/${img}`
                      ? "border-amber-500 ring-2 ring-amber-500/30 shadow-md"
                      : "border-border hover:border-amber-500/50"
                  )}
                >
                  <NextImage
                    src={`/${img}`}
                    alt={img}
                    fill
                    className="object-cover"
                    sizes="100px"
                  />
                  {wallpaper.light === `/${img}` && (
                    <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                      <div className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Dark Mode Wallpaper */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Moon className="h-4 w-4 text-blue-400" />
              <span className="font-medium text-sm">Koyu Mod Duvar Kağıdı</span>
              {wallpaper.dark && (
                <button
                  onClick={() => setWallpaper('dark', null)}
                  className="ml-auto flex items-center gap-1 text-xs text-destructive hover:underline"
                >
                  <X className="h-3 w-3" /> Kaldır
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {PUBLIC_IMAGES.map((img) => (
                <button
                  key={`dark-${img}`}
                  onClick={() => setWallpaper('dark', `/${img}`)}
                  className={cn(
                    "relative aspect-square rounded-lg border-2 overflow-hidden transition-all duration-200 hover:scale-105",
                    wallpaper.dark === `/${img}`
                      ? "border-blue-500 ring-2 ring-blue-500/30 shadow-md"
                      : "border-border hover:border-blue-500/50"
                  )}
                >
                  <NextImage
                    src={`/${img}`}
                    alt={img}
                    fill
                    className="object-cover"
                    sizes="100px"
                  />
                  {wallpaper.dark === `/${img}` && (
                    <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                      <div className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          {(wallpaper.light || wallpaper.dark) && (
            <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-amber-500/10 to-blue-500/10 border border-primary/20">
              <p className="text-sm text-muted-foreground">
                <strong>Duvar kağıdı aktif:</strong> Seçilen görseller ürün kullanım panelinde
                ekranın altından başlayıp yukarı doğru soft bir geçişle soluklaşarak kaybolacaktır.
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
