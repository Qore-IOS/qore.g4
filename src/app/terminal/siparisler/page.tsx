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
import { limit, onSnapshot, where } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { useDepots } from '@/hooks/useFirebaseQueries';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { useTerminalDepot } from '@/hooks/useTerminalDepot';
import { scopedQuery } from '@/lib/firestore-helpers';
import { siparislerLogger } from '@/lib/logger';
import type { Order } from '@/lib/types';
import {
  TerminalButton,
  TerminalSelect,
  TerminalShell,
  TerminalStat,
} from '@/components/terminal/shell';

/** Terminalde yalnızca toplanmayı bekleyen siparişler gösterilir. */
const OPEN_STATUSES = new Set(['pending', 'toplaniyor']);
const ORDER_LISTEN_LIMIT = 200;

export default function TerminalSiparislerPage() {
  const router = useRouter();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { data: depots = [] } = useDepots();
  const [depotId, setDepotId] = useTerminalDepot();

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceDepots = useMemo(
    () => filterOperationalSourceDepots(depots, currentUserProfile),
    [depots, currentUserProfile],
  );
  const depotName = sourceDepots.find(d => d.id === depotId)?.name || '';

  useEffect(() => {
    if (!depotId) {
      setOrders([]);
      return;
    }
    setIsLoading(true);
    setError(null);

    const unsubscribe = onSnapshot(
      scopedQuery(
        'orders',
        currentCompanyId,
        isSuperAdmin,
        where('depotId', '==', depotId),
        limit(ORDER_LISTEN_LIMIT),
      ),
      snap => {
        const rows = snap.docs
          .map(d => ({ id: d.id, ...d.data() }) as Order)
          // Perifer siparişler ofis lojistiğinden yürür; depo terminalinde
          // toplanmazlar, bu yüzden listeye alınmazlar.
          .filter(o => !o.isPeripheral && OPEN_STATUSES.has(String(o.status)));
        setOrders(rows);
        setIsLoading(false);
      },
      err => {
        siparislerLogger.error('Terminal sipariş dinleyicisi düştü', err, { depotId });
        setError('Siparişler yüklenemedi. Bağlantıyı kontrol edip tekrar deneyin.');
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [depotId, currentCompanyId, isSuperAdmin]);

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

        {error ? (
          <p className="shrink-0 rounded-xl border border-red-600 bg-red-500/10 px-6 py-4 text-red-700 dark:text-red-200">
            {error}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Siparişler yükleniyor…
            </div>
          ) : !depotId ? (
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
