'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Warehouse, Building, Pill, MapPin, Users, Barcode, LogOut, Beaker, QrCode, History, Palette } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import AdminBackfillHedefKurumId from '@/components/AdminBackfillHedefKurumId';
import AdminBackfillDepoSayimSeriStok from '@/components/AdminBackfillDepoSayimSeriStok';
import AdminBackfillSerialLedger from '@/components/AdminBackfillSerialLedger';

export default function YonetimPanel() {
  const router = useRouter();

  const { logout, isAdmin } = useAuth();

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


  const modules = [
    { name: 'Depo Yönetimi', icon: Warehouse, path: '/yonetim/depolar' },
    { name: 'Borç Depo Tanımlama', icon: Building, path: '/yonetim/borc-depolar' },
    { name: 'Ürün Kodu Yönetimi', icon: Barcode, path: '/yonetim/urun-kodlari' },
    { name: 'Adres Tanımları Yönetimi', icon: MapPin, path: '/yonetim/adresler' },
    { name: 'Laboratuvar Yönetimi', icon: Pill, path: '/yonetim/laboratuvarlar' },
    { name: 'Kullanıcı Yönetimi', icon: Users, path: '/yonetim/kullanicilar' },
    { name: 'Test Yönetimi', icon: Beaker, path: '/yonetim/test-yonetimi' },
    { name: 'Barkod Formatları', icon: QrCode, path: '/yonetim/barkod-formatlari' },
    { name: 'Kişiselleştirme', icon: Palette, path: '/yonetim/kisisellistirme' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* System Controls */}
       <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl font-headline flex items-center">Sistem Kontrolü</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <Button onClick={logout} variant="destructive">
              <LogOut className="mr-2 h-4 w-4"/>
              Çıkış Yap
            </Button>

            <Button variant="outline" onClick={() => router.push('/yonetim/personel-hareket-ekstresi')}>
                <History className="h-4 w-4 mr-2" />
                Personel Hareket Ekstresi
            </Button>
          </CardContent>
        </Card>


      {/* Dashboard Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {modules.map((mod) => (
          <Card
            key={mod.path}
            className="cursor-pointer bg-card/60 hover:bg-accent/10 hover:shadow-lg transition-all duration-200"
            onClick={() => router.push(mod.path)}
          >
            <CardContent className="flex flex-col items-center justify-center p-8">
              <mod.icon className="h-12 w-12 mb-4 text-primary" />
              <CardTitle className="text-lg text-center font-headline">{mod.name}</CardTitle>
            </CardContent>
          </Card>
        ))}
      </div>
      <AdminBackfillHedefKurumId />
      <AdminBackfillDepoSayimSeriStok />
      <AdminBackfillSerialLedger />
    </div>
  );
}
