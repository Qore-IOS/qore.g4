
'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Warehouse, Building, Pill, MapPin, Users, Barcode, Moon, Sun, LogOut, Beaker, QrCode, History, BookText, AlertTriangle, UserCog, Shield, Send, Star, Building2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { createNotification } from '@/lib/notifications';
import { useCompany } from '@/contexts/company-context';
import { CompanySwitcher } from '@/components/company-switcher';

export default function YonetimPanel() {
  const router = useRouter();
  const { setTheme } = useTheme();
  const { logout, isAdmin, currentUserProfile, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const { activeCompanyId, activeCompany } = useCompany();

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
    { name: 'Şirket Yönetimi', icon: Building2, path: '/yonetim/sirketler' },
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
            <Button onClick={() => setTheme('light')} variant="outline">
              <Sun className="mr-2 h-4 w-4"/>
              Aydınlık Tema
            </Button>
            <Button onClick={() => setTheme('dark')} variant="outline">
              <Moon className="mr-2 h-4 w-4"/>
              Karanlık Tema
            </Button>
            <Button onClick={() => setTheme('qore-dark')} variant="outline">
              <Star className="mr-2 h-4 w-4"/>
              Qore Dark
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


      {/* Active Company Info */}
      <Card className="shadow-lg border-primary/20 bg-primary/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">
                  Aktif Şirket: <span className="font-mono text-primary">{activeCompanyId}</span>
                  {activeCompany?.displayName && (
                    <span className="text-muted-foreground font-normal ml-1">— {activeCompany.displayName}</span>
                  )}
                </p>
                {isSuperAdmin && (
                  <p className="text-xs text-amber-400">Süper Admin modunda — şirketler arası geçiş yapabilirsiniz</p>
                )}
              </div>
            </div>
            <CompanySwitcher />
          </div>
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
