/**
 * @fileoverview Terminal ana ekranı — dört akışın giriş noktası.
 */

'use client';

import React, { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, CloudUpload, PackagePlus, Search, Truck } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { useTerminalDepot } from '@/hooks/useTerminalDepot';
// Veri TEK KAYNAKTAN: önyükleme deposu. TanStack hook'ları (`useDepots` vb.)
// BİLEREK kullanılmaz — `getDocs` ile sorgu atarlar ve çevrimdışıyken panel
// geçişinde ağ beklenir (donmanın sebebi buydu). Bkz. terminal-prefetch.ts.
import { useTerminalData } from '@/components/terminal/prefetch-provider';
import { TerminalSelect, TerminalShell, TerminalTile } from '@/components/terminal/shell';
import { getTerminalBuildInfo } from '@/lib/terminal-build';

const TILES = [
  {
    href: '/terminal/mal-kabul',
    title: 'Mal Kabul',
    description: 'Barkod okut, rafa yerleştir, stoğa al.',
    icon: <PackagePlus className="h-10 w-10" />,
  },
  {
    href: '/terminal/transfer',
    title: 'Direkt Transfer',
    description: 'Sipariş olmadan laboratuvara sevk et.',
    icon: <Truck className="h-10 w-10" />,
  },
  {
    href: '/terminal/siparisler',
    title: 'Siparişler',
    description: 'Açık siparişleri gör, toplamaya başla.',
    icon: <ClipboardList className="h-10 w-10" />,
  },
  {
    href: '/terminal/sorgu',
    title: 'Stok Sorgu',
    description: 'Okuttuğun ürün nerede, hangi durumda?',
    icon: <Search className="h-10 w-10" />,
  },
  {
    href: '/terminal/bekleyen',
    title: 'Bekleyen İşlemler',
    description: 'Gönderilmeyi bekleyenleri gör.',
    icon: <CloudUpload className="h-10 w-10" />,
  },
] as const;

export default function TerminalHomePage() {
  const router = useRouter();
  const { currentUserProfile, currentUser } = useAuth();
  const { depots } = useTerminalData();
  const [depotId, setDepotId] = useTerminalDepot();

  // Kullanıcı profili ŞART: bu yardımcı, yetkili roller dışındaki kullanıcıları
  // yalnızca kendilerine atanmış depolarla sınırlar. Profil geçilmezse herkese
  // boş liste döner ve terminal hiç açılmaz.
  const sourceDepots = useMemo(
    () => filterOperationalSourceDepots(depots, currentUserProfile),
    [depots, currentUserProfile],
  );
  const depotName = sourceDepots.find(d => d.id === depotId)?.name || '';
  const buildLabel = useMemo(() => getTerminalBuildInfo().label, []);

  // Rakam tuşları: fareye dokunmadan akış seçimi.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
        return;
      }
      const index = Number(e.key);
      if (!Number.isInteger(index) || index < 1 || index > TILES.length) return;
      e.preventDefault();
      router.push(TILES[index - 1].href);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);

  return (
    <TerminalShell
      title="Qore Terminal"
      subtitle={currentUserProfile?.name || currentUser?.email || ''}
      onBack={() => router.push('/dashboard')}
      right={
        <div className="w-72">
          <TerminalSelect
            label="Bulunduğun depo"
            value={depotId}
            onChange={setDepotId}
            options={sourceDepots}
            placeholder="Depo seç"
          />
        </div>
      }
    >
      <div className="mx-auto flex h-full max-w-5xl flex-col justify-center gap-6 px-8">
        {!depotId ? (
          <p className="rounded-xl border border-amber-600 bg-amber-500/10 px-6 py-4 text-amber-800 dark:text-amber-200">
            Başlamadan önce sağ üstten bulunduğun depoyu seç. Seçim bu makinede
            hatırlanır.
          </p>
        ) : (
          <p className="text-lg text-muted-foreground">
            Aktif depo: <span className="font-semibold text-foreground">{depotName}</span>
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {TILES.map((tile, i) => (
            <TerminalTile
              key={tile.href}
              index={i + 1}
              title={tile.title}
              description={tile.description}
              icon={tile.icon}
              onClick={() => router.push(tile.href)}
            />
          ))}
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Rakam tuşlarıyla aç · Esc ile geri dön
        </p>
        {/* Paket damgası: "yeni sürümü mü çalıştırıyorum?" sorusunu bakışta
            cevaplar. Arayüz paketi üretilmeden paketlenmiş bir kurulum bunu
            göstermez ve durum hemen anlaşılır. */}
        <p className="text-center text-xs text-muted-foreground/70">{buildLabel}</p>
      </div>
    </TerminalShell>
  );
}
