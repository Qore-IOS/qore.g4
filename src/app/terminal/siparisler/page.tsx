/**
 * @fileoverview Terminal — Siparişler (açık sipariş listesi).
 *
 * Açık siparişleri listeler; toplama `/terminal/toplama` ekranında yapılır.
 *
 * Toplama ekranı terminale özgü ve SADE bir sürümdür, ama yazma yolu ortaktır:
 * stok hareketi `applyTransferItemWrites`, siparişin kapanışı
 * `applyOrderCompletionWrite` ile yürür — yani web ekranıyla aynı belgeler ve
 * aynı kapanış kuralı üretilir.
 */

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/contexts/auth-context';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { useTerminalDepot } from '@/hooks/useTerminalDepot';
// Veri TEK KAYNAKTAN: önyükleme deposu. TanStack hook'ları (`useDepots` vb.)
// BİLEREK kullanılmaz — `getDocs` ile sorgu atarlar ve çevrimdışıyken panel
// geçişinde ağ beklenir (donmanın sebebi buydu). Bkz. terminal-prefetch.ts.
import { useTerminalData } from '@/components/terminal/prefetch-provider';
import {
  TerminalButton,
  TerminalSelect,
  TerminalShell,
  TerminalStat,
} from '@/components/terminal/shell';

/** Terminalde yalnızca toplanmayı bekleyen siparişler gösterilir. */
const OPEN_STATUSES = new Set(['pending', 'toplaniyor']);

export default function TerminalSiparislerPage() {
  const router = useRouter();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { depots, orders: allOrders } = useTerminalData();
  const [depotId, setDepotId] = useTerminalDepot();


  const sourceDepots = useMemo(
    () => filterOperationalSourceDepots(depots, currentUserProfile),
    [depots, currentUserProfile],
  );
  const depotName = sourceDepots.find(d => d.id === depotId)?.name || '';

  /**
   * Açık siparişler önyükleme deposundan süzülür.
   *
   * Burada AYRI bir `onSnapshot` YOK: depo zaten seçili deponun siparişlerini
   * canlı dinliyor. İkinci bir dinleyici hem gereksiz okuma üretir hem de
   * ekran her açıldığında yeniden kurulup çevrimdışıyken bekleme yaratırdı.
   */
  const orders = useMemo(
    () =>
      allOrders.filter(
        o =>
          // Perifer siparişler ofis lojistiğinden yürür; depo terminalinde
          // toplanmazlar.
          !o.isPeripheral && OPEN_STATUSES.has(String(o.status)),
      ),
    [allOrders],
  );

  return (
    <TerminalShell
      title="Siparişler"
      subtitle={depotName || 'Depo seçilmedi'}
      onBack={() => router.push('/terminal')}
      right={<TerminalStat label="Açık sipariş" value={orders.length} />}
    >
      <div className="flex h-full min-h-0 flex-col gap-4 p-6">
        <div className="w-full max-w-sm shrink-0">
          <TerminalSelect
            label="Depo"
            value={depotId}
            onChange={setDepotId}
            options={sourceDepots}
            placeholder="Depo seç"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
          {!depotId ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Önce depo seçin.
            </div>
          ) : orders.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Bu depoda toplanmayı bekleyen sipariş yok.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {orders.map(order => (
                <li
                  key={order.id}
                  className="flex flex-wrap items-center justify-between gap-4 px-6 py-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xl font-semibold text-foreground">
                      {order.kurumAdi}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {order.items?.length ?? 0} kalem ·{' '}
                      {order.status === 'toplaniyor' ? 'Toplanıyor' : 'Yeni'}
                    </p>
                  </div>
                  <TerminalButton
                    onClick={() => router.push(`/terminal/toplama?order=${encodeURIComponent(order.id)}`)}
                  >
                    Toplamaya başla
                  </TerminalButton>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="shrink-0 text-xs text-muted-foreground">
          Toplama ekranı çevrimdışı da çalışır. Karmaşık durumlar (gerekçeli FEFO
          aşımı, kurum bazlı özel ürün sıralaması) için web uygulamasındaki
          ayrıntılı toplama ekranı kullanılmalıdır.
        </p>
      </div>
    </TerminalShell>
  );
}
