/**
 * @fileoverview Önyükleme sağlayıcısı ve açılış ekranı.
 *
 * Terminal açıldığında tüm çalışma verisi yerele indirilir; bu bitene kadar
 * kısa bir açılış ekranı gösterilir. Amaç, beklemeyi İŞLEM ANINDAN alıp
 * açılışa taşımaktır: kullanıcı barkod okuturken bir daha beklemez.
 *
 * Açılış ekranı yalnızca İLK indirmede görünür. Uygulama daha önce açılmışsa
 * veri zaten diskte olduğu için anlık görüntüler anında gelir ve ekran göz
 * kırpar gibi geçer; çevrimdışıysa da öyle — dinleyiciler önbellekten cevap
 * verir.
 */

'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { useTerminalDepot } from '@/hooks/useTerminalDepot';
import {
  EMPTY_TERMINAL_DATA,
  startTerminalPrefetch,
  type PrefetchState,
  type TerminalData,
} from '@/lib/terminal-prefetch';

const EMPTY: PrefetchState = { stages: [], ready: false, total: 0, data: EMPTY_TERMINAL_DATA };

const PrefetchContext = createContext<PrefetchState>(EMPTY);

/** Önyükleme durumunu okur — ekranlar "veri hazır mı" diye sorabilir. */
export function useTerminalPrefetch(): PrefetchState {
  return useContext(PrefetchContext);
}

/**
 * Terminalin çalışma verisi — ekranların TEK veri kaynağı.
 *
 * Ekranlar BİLEREK `useDepots` / `useProductCodes` gibi TanStack hook'larını
 * kullanmaz: onlar `getDocs` ile sorgu atar ve çevrimdışıyken (ağ arayüzü
 * bağlı görünüp internet yokken) sunucu yanıtını zaman aşımına kadar bekler.
 * Panel geçişinde yaşanan donmanın sebebi buydu.
 *
 * Buradaki veri `onSnapshot` ile canlı tutulur; okumak bedavadır.
 */
export function useTerminalData(): TerminalData {
  return useContext(PrefetchContext).data;
}

export function TerminalPrefetchProvider({ children }: { children: React.ReactNode }) {
  const { currentUser, currentCompanyId, isSuperAdmin } = useAuth();
  const [depotId] = useTerminalDepot();
  const [state, setState] = useState<PrefetchState>(EMPTY);

  /**
   * Açılış ekranı yalnızca bir kez gösterilir.
   *
   * Depo değiştirildiğinde önyükleme yeniden başlar (yeni deponun stoğu
   * inmelidir) ama kullanıcıyı yeniden tam ekran bir bekleme ekranına
   * atmak gereksiz: o an zaten çalışılabilir veri var.
   */
  const [bootShown, setBootShown] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    const stop = startTerminalPrefetch({
      companyId: currentCompanyId,
      isSuperAdmin,
      depotId: depotId || null,
      onChange: setState,
    });
    return stop;
  }, [currentUser, currentCompanyId, isSuperAdmin, depotId]);

  useEffect(() => {
    if (state.ready) setBootShown(true);
  }, [state.ready]);

  const value = useMemo(() => state, [state]);

  if (currentUser && !state.ready && !bootShown) {
    return <BootScreen state={state} />;
  }

  return <PrefetchContext.Provider value={value}>{children}</PrefetchContext.Provider>;
}

function BootScreen({ state }: { state: PrefetchState }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-8 bg-background p-8 text-foreground">
      <div className="flex items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-xl font-semibold">Veriler cihaza indiriliyor…</p>
      </div>

      <ul className="w-full max-w-md space-y-2">
        {state.stages.map(stage => (
          <li
            key={stage.key}
            className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-3"
          >
            <span className="text-sm text-muted-foreground">{stage.label}</span>
            <span className="text-sm font-medium tabular-nums">
              {stage.error ? (
                <span className="text-red-700 dark:text-red-300">alınamadı</span>
              ) : stage.ready ? (
                `${stage.count} kayıt`
              ) : (
                '…'
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="max-w-md text-center text-sm text-muted-foreground">
        Bu yalnızca ilk açılışta sürer. Veriler indirildikten sonra terminal
        internet olmadan da çalışır ve işlemler beklemeden tamamlanır.
      </p>
    </div>
  );
}
