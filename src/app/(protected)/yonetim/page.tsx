'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import {
  Warehouse,
  LogOut,
  BookText,
  AlertTriangle,
  UserCog,
  Shield,
  Send,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { createNotification } from '@/lib/notifications';
import { YonetimShell, YonetimHeader, YonetimTile, YonetimTileGrid, YonetimCard } from '@/components/yonetim-ui/YonetimHub';

export default function YonetimPanel() {
  const router = useRouter();
  const { logout, isAdmin, currentUserProfile } = useAuth();
  const { toast } = useToast();

  if (!isAdmin) {
    return (
      <YonetimShell>
        <YonetimCard title="Yetkisiz Erişim" description="Bu panele erişim yetkiniz bulunmamaktadır.">
          <div />
        </YonetimCard>
      </YonetimShell>
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
      toast({ title: 'Başarılı', description: `Test ${channel.toUpperCase()} bildirimi gönderim kuyruğuna eklendi.` });
    } catch (error) {
      console.error(`Failed to send test ${channel} notification:`, error);
      toast({ title: 'Hata', description: `Test ${channel.toUpperCase()} bildirimi oluşturulamadı.`, variant: 'destructive' });
    }
  };

  const modules = [
    {
      icon: BookText,
      label: 'Tanımlar',
      description: 'Sistem genelindeki ana veri tanımları (depo, lab, ürün, vb.)',
      href: '/yonetim/tanimlar',
      color: '#fb923c',
    },
    {
      icon: UserCog,
      label: 'Personel Yönetimi',
      description: 'Oturum, izin, mesai ve maaş yönetimi',
      href: '/yonetim/personel-yonetimi',
      color: '#6ea8ff',
    },
    {
      icon: Warehouse,
      label: 'Envanter Yönetimi',
      description: 'Demirbaş kategori, lokasyon ve envanter kayıtları',
      href: '/yonetim/envanter-yonetimi',
      color: '#a78bfa',
    },
  ];

  return (
    <YonetimShell>
      <YonetimHeader
        title="Yönetim"
        description="Sistem genel ayarları, tanımlar ve operasyon merkezleri."
        backHref="/dashboard"
      />

      <YonetimCard>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'var(--mg-accent-soft)',
                color: 'var(--mg-accent)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(251,146,60,0.3)',
              }}
            >
              <Shield size={14} />
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mg-text)' }}>Sistem Kontrolü</div>
              <div style={{ fontSize: 11, color: 'var(--mg-muted)', marginTop: 2 }}>
                Lisans, bildirim testleri ve istisna ürün yönetimi
              </div>
            </div>
          </div>
          <button
            onClick={() => router.push('/yonetim/lisans-ve-surum')}
            style={{
              padding: '7px 12px',
              borderRadius: 9,
              background: 'var(--mg-surface-2)',
              border: '1px solid var(--mg-border)',
              color: 'var(--mg-text-2)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'inherit',
            }}
          >
            <Shield size={13} />
            Lisans & Sürüm
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <ActionPill icon={LogOut} label="Çıkış Yap" onClick={logout} variant="danger" />
          <ActionPill
            icon={AlertTriangle}
            label="İstisna Ürünler"
            onClick={() => router.push('/yonetim/istisna-urunler')}
            variant="warn"
          />
          <ActionPill icon={Send} label="Test Push" onClick={() => handleSendTestNotification('push')} />
          <ActionPill icon={Send} label="Test SMS" onClick={() => handleSendTestNotification('sms')} />
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

function ActionPill({
  icon: Icon,
  label,
  onClick,
  variant,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  variant?: 'danger' | 'warn';
}) {
  const styles = {
    danger: { bg: 'var(--mg-danger-soft)', border: 'var(--mg-danger-soft)', color: 'var(--mg-danger)' },
    warn: { bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.3)', color: 'var(--mg-accent)' },
    default: { bg: 'var(--mg-surface-2)', border: 'var(--mg-border)', color: 'var(--mg-text-2)' },
  };
  const s = styles[variant || 'default'];
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 13px',
        borderRadius: 9,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'inherit',
        transition: 'all 0.15s',
      }}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
