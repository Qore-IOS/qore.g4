/**
 * @fileoverview Bağlantı ve senkron durumu göstergesi.
 *
 * NEDEN GEREKLİ: Çevrimdışı çalışabilen bir uygulamada en tehlikeli şey,
 * kullanıcının çevrimdışı olduğunu BİLMEMESİDİR. Depo görevlisi kaydın gittiğini
 * sanır, akşam kimse senkronu tetiklemez, ertesi gün sayım tutmaz.
 *
 * Bu yüzden durum her ekranın üst şeridinde, kalıcı olarak durur:
 *
 *   - Çevrimiçi + kuyruk boş → sessiz (yeşil nokta)
 *   - Kuyrukta yazım var     → sayı ile birlikte "N bekliyor"
 *   - Çevrimdışı             → açık uyarı
 *
 * Renk tek başına anlam taşımaz; metin de durumu söyler.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { subscribeToPendingWrites } from '@/lib/offline-write';
import { countPendingOperations, subscribeToPendingOperations } from '@/lib/pending-operations';
import { forceResync, reconcilePendingWrites } from '@/lib/terminal-sync';

/** Tarayıcının çevrimiçi durumunu izler. */
function useOnlineStatus(): boolean {
  // Başlangıç değeri `true`: sunucuda `navigator` yoktur ve ilk boyamada
  // gereksiz yere "çevrimdışı" göstermek, bağlantı varken bile kullanıcıyı
  // tedirgin ederdi.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

export function ConnectionBadge() {
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);

  useEffect(() => subscribeToPendingWrites(setPending), []);

  /**
   * Defterdeki bekleyen kayıtlar da sayılır.
   *
   * `subscribeToPendingWrites` yalnızca BU OTURUMDA başlatılan yazımları
   * bilir. Uygulama kapanıp açıldığında Firestore kuyruğu dolu olabilir ve o
   * sayaç sıfır görünürdü — kullanıcı da her şeyin gittiğini sanırdı.
   */
  const [pendingOps, setPendingOps] = useState(0);
  useEffect(
    () => subscribeToPendingOperations(ops => setPendingOps(countPendingOperations(ops))),
    [],
  );

  const waiting = Math.max(pending, pendingOps);
  const tone = !online ? 'offline' : waiting > 0 ? 'syncing' : 'online';

  const styles = {
    online: 'border-border text-muted-foreground',
    syncing: 'border-amber-600 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    offline: 'border-red-600 bg-red-500/10 text-red-700 dark:text-red-200',
  } as const;

  const dot = {
    online: 'bg-emerald-500',
    syncing: 'bg-amber-400',
    offline: 'bg-red-500',
  } as const;

  const label = !online
    ? waiting > 0
      ? `Çevrimdışı · ${waiting} bekliyor`
      : 'Çevrimdışı'
    : waiting > 0
      ? `${waiting} kayıt gönderiliyor`
      : 'Bağlı';

  return (
    <div className="flex items-center gap-2">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium',
          styles[tone],
        )}
      >
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dot[tone])} aria-hidden="true" />
        {label}
      </div>
      <SyncButton />
    </div>
  );
}

/**
 * Elle eşitleme düğmesi.
 *
 * Firestore kuyruğu normalde kendi boşalır; bu düğme iki gerçek durum için
 * var (ayrıntı: `src/lib/terminal-sync.ts`):
 *
 *   - Ağ geri geldi ama açık kalan soket ölü → bağlantı tazelenir
 *   - Uygulama kapanıp açıldığı için defter "bekliyor"da takılı kaldı →
 *     yazımların gerçekten gittiği doğrulandıktan sonra düzeltilir
 *
 * Sonuç düğmenin ÜSTÜNDE gösterilir. Bir toast yeterli olmazdı: kullanıcı
 * çoğu zaman elinde kutuyla, ekrana yan gözle bakıyor.
 */
function SyncButton() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'timeout'>('idle');

  /**
   * Açılışta SESSİZ mutabakat.
   *
   * Uygulama kapalıyken gönderilen işlemler defterde "bekliyor" görünüyordu.
   * Burada ağ zaten varsa kuyruk birkaç saniyede boşalır ve sayaç kendiliğinden
   * doğruya döner; yoksa hiçbir şey değişmez.
   */
  useEffect(() => {
    void reconcilePendingWrites().catch(() => {});
  }, []);

  const run = useCallback(async () => {
    setState('busy');
    try {
      const result = await forceResync();
      setState(result.timedOut ? 'timeout' : 'done');
    } catch {
      setState('timeout');
    }
    // Sonucu bir süre gösterip sessizleş.
    setTimeout(() => setState('idle'), 4000);
  }, []);

  const title =
    state === 'busy'
      ? 'Eşitleniyor…'
      : state === 'done'
        ? 'Her şey gönderildi'
        : state === 'timeout'
          ? 'Eşitlenemedi — bağlantı yok ya da çok yavaş'
          : 'Şimdi eşitle';

  return (
    <button
      type="button"
      onClick={run}
      disabled={state === 'busy'}
      title={title}
      aria-label={title}
      className={cn(
        'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border text-foreground/80',
        state === 'done'
          ? 'border-emerald-600 text-emerald-600'
          : state === 'timeout'
            ? 'border-red-600 text-red-600'
            : 'border-border hover:bg-muted',
      )}
    >
      {state === 'busy' ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : state === 'done' ? (
        <Check className="h-4 w-4" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
    </button>
  );
}
