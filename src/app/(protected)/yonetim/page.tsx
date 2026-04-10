
'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Warehouse, Building, Pill, MapPin, Users, Barcode, LogOut, Beaker, QrCode, History, BookText, AlertTriangle, UserCog, Shield, Send } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { createNotification } from '@/lib/notifications';

export default function YonetimPanel() {
  const router = useRouter();

  const { logout, isAdmin, currentUserProfile } = useAuth();
  const { toast } = useToast();

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

  const handleSendTestNotification = async (channel: 'push' | 'sms') => {
    try {
      await createNotification({
        type: 'custom',
        channel: channel,
        title: `Test ${channel.toUpperCase()} Bildirimi`,
        message: `Bu, Qore Engine tarafından gönderilen bir test ${channel} bildirimidir.`,
        targets: ['role:admin'],
        actor: { uid: currentUserProfile?.uid || 'system', name: currentUserProfile?.name || 'Yönetim Paneli' },
      });
      toast({
        title: 'Başarılı',
        description: `Test ${channel.toUpperCase()} bildirimi gönderim kuyruğuna eklendi.`,
      });
    } catch (error) {
      console.error(`Failed to send test ${channel} notification:`, error);
      toast({
        title: 'Hata',
        description: `Test ${channel.toUpperCase()} bildirimi oluşturulamadı.`,
        variant: 'destructive',
      });
    }
  };

  const modules = [
    { name: 'Tanımlar', icon: BookText, path: '/yonetim/tanimlar' },
    { name: 'Personel Yönetimi', icon: UserCog, path: '/yonetim/personel-yonetimi' },
    { name: 'Envanter Yönetimi', icon: Warehouse, path: '/yonetim/envanter-yonetimi' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* System Controls */}
       <Card className="shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-xl font-headline flex items-center">Sistem Kontrolü</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/yonetim/lisans-ve-surum')}
            >
              <Shield className="mr-2 h-4 w-4" />
              Lisans ve Sürüm Bilgileri
            </Button>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <Button onClick={logout} variant="destructive">
              <LogOut className="mr-2 h-4 w-4"/>
              Çıkış Yap
            </Button>

            <Button onClick={() => router.push('/yonetim/istisna-urunler')} variant="destructive" className="bg-amber-600 hover:bg-amber-700">
                <AlertTriangle className="mr-2 h-4 w-4" />
                İstisna Ürünler
            </Button>
             <Button onClick={() => handleSendTestNotification('push')} variant="secondary">
              <Send className="mr-2 h-4 w-4" />
              Test Anlık Bildirim
            </Button>
            <Button onClick={() => handleSendTestNotification('sms')} variant="secondary">
              <Send className="mr-2 h-4 w-4" />
              Test SMS
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
    </div>
  );
}
