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

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { subscribeToPendingWrites } from '@/lib/offline-write';

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

  const tone = !online ? 'offline' : pending > 0 ? 'syncing' : 'online';

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
    ? pending > 0
      ? `Çevrimdışı · ${pending} bekliyor`
      : 'Çevrimdışı'
    : pending > 0
      ? `${pending} kayıt gönderiliyor`
      : 'Bağlı';

  return (
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
  );
}
