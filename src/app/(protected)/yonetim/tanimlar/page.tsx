'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import BackButton from '@/components/BackButton';
import { Button } from '@/components/ui/button';
import { Warehouse, Building, Pill, MapPin, Users, Barcode, Beaker, QrCode, BookText } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';


export default function TanimlarPage() {
    const router = useRouter();
    const { isOrbAnimationEnabled, toggleOrbAnimation, navMode, toggleNavMode } = useAuth();

    const modules = [
        { name: 'Depo Yönetimi', icon: Warehouse, path: '/yonetim/depolar' },
        { name: 'Borç Depo Tanımlama', icon: Building, path: '/yonetim/borc-depolar' },
        { name: 'Ürün Kodu Yönetimi', icon: Barcode, path: '/yonetim/urun-kodlari' },
        { name: 'Adres Tanımları Yönetimi', icon: MapPin, path: '/yonetim/adresler' },
        { name: 'Laboratuvar Yönetimi', icon: Pill, path: '/yonetim/laboratuvarlar' },
        { name: 'Kullanıcı Yönetimi', icon: Users, path: '/yonetim/kullanicilar' },
        { name: 'Test Yönetimi', icon: Beaker, path: '/yonetim/test-yonetimi' },
        { name: 'Barkod Formatları', icon: QrCode, path: '/yonetim/barkod-formatlari' },
      ];

    return (
        <div className="p-6 space-y-6">
            <BackButton fallback="/yonetim" />
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle className="text-2xl font-headline">Tanımlar</CardTitle>
                    <CardDescription>Sistemdeki ana veri tanımlamalarını bu panel üzerinden yönetebilirsiniz.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-4 mb-4">
                        <div className="flex items-center space-x-2">
                          <Switch 
                            id="animation-toggle" 
                            checked={isOrbAnimationEnabled}
                            onCheckedChange={toggleOrbAnimation}
                          />
                          <Label htmlFor="animation-toggle">Arka Plan Animasyonu</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch 
                            id="nav-mode-toggle"
                            checked={navMode === 'sidebar'}
                            onCheckedChange={toggleNavMode}
                          />
                          <Label htmlFor="nav-mode-toggle">Kenar Çubuğu Navigasyon</Label>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {modules.map((mod) => (
                        <Card
                            key={mod.path}
                            className="cursor-pointer bg-card/60 hover:bg-accent/10 hover:shadow-xl transition-all duration-200 ease-in-out transform hover:-translate-y-1"
                            onClick={() => router.push(mod.path)}
                        >
                            <CardContent className="flex flex-col items-center justify-center p-6 text-center">
                            <mod.icon className="h-10 w-10 mb-3 text-primary" />
                            <CardTitle className="text-base font-semibold">{mod.name}</CardTitle>
                            </CardContent>
                        </Card>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
