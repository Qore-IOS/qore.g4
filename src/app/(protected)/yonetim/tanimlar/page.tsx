'use client';
import React from 'react';
import { Warehouse, Building, Building2, Barcode, Database, MapPin, Users, Beaker, QrCode, Pill } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import {
  YonetimShell,
  YonetimHeader,
  YonetimTile,
  YonetimTileGrid,
  YonetimCard,
} from '@/components/yonetim-ui/YonetimHub';

export default function TanimlarPage() {
  const { isOrbAnimationEnabled, toggleOrbAnimation, navMode, toggleNavMode, isSuperAdmin } = useAuth();

  const modules = [
    { icon: Warehouse, label: 'Depo Yönetimi', description: 'Merkez ve uydu depolar', href: '/yonetim/depolar', color: '#fb923c' },
    { icon: Building, label: 'Borç Depo Tanımlama', description: 'Borç ve emanet depoları', href: '/yonetim/borc-depolar', color: '#fc7272' },
    { icon: Barcode, label: 'Ürün Kodu Yönetimi', description: 'Stok kodu, ambalaj, maliyet tanımları', href: '/yonetim/urun-kodlari', color: '#6ea8ff' },
    { icon: MapPin, label: 'Adres Tanımları', description: 'Raf, koridor, lokasyon adresleri', href: '/yonetim/adresler', color: '#42e46d' },
    { icon: Pill, label: 'Laboratuvar Yönetimi', description: 'Lab kayıtları, çalışma saatleri, acil statüsü', href: '/yonetim/laboratuvarlar', color: '#a78bfa' },
    { icon: Users, label: 'Kullanıcı Yönetimi', description: 'Rol, yetki ve atama yönetimi', href: '/yonetim/kullanicilar', color: '#fb923c' },
    { icon: Beaker, label: 'Test Yönetimi', description: 'SUT kodu, hak ediş ve test–ürün eşleşmesi', href: '/yonetim/test-yonetimi', color: '#42e46d' },
    { icon: QrCode, label: 'Barkod Formatları', description: 'GS1, DataMatrix ve özel format kuralları', href: '/yonetim/barkod-formatlari', color: '#6ea8ff' },
    { icon: Database, label: 'Lab-Dönem Aktarımı', description: 'Geçmiş sayım, kümülatif ve cihaz üstü verilerini tek kaynağa taşır', href: '/yonetim/lab-donem-aktarim', color: '#42e46d' },
    ...(isSuperAdmin
      ? [{ icon: Building2, label: 'Firma Yönetimi', description: 'Multi-tenant firma kayıtları', href: '/yonetim/firmalar', color: '#a78bfa' }]
      : []),
  ];

  return (
    <YonetimShell>
      <YonetimHeader
        title="Tanımlar"
        description="Sistem genel veri tanımlarını bu panel üzerinden yönetin."
        backHref="/yonetim"
      />

      <YonetimCard title="Görünüm & Davranış">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch id="animation-toggle" checked={isOrbAnimationEnabled} onCheckedChange={toggleOrbAnimation} />
            <Label htmlFor="animation-toggle" className="text-sm font-medium">
              Arka Plan Animasyonu
            </Label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch id="nav-mode-toggle" checked={navMode === 'sidebar'} onCheckedChange={toggleNavMode} />
            <Label htmlFor="nav-mode-toggle" className="text-sm font-medium">
              Kenar Çubuğu Navigasyon
            </Label>
          </div>
        </div>
      </YonetimCard>

      <YonetimTileGrid>
        {modules.map((m) => (
          <YonetimTile key={m.label} {...m} />
        ))}
      </YonetimTileGrid>
    </YonetimShell>
  );
}
