/**
 * @fileoverview Terminalin "bulunduğu depo" hafızası.
 *
 * Bir depo terminali fiziksel olarak tek bir depoda durur. Kullanıcının her
 * ekran açılışında aynı depoyu yeniden seçmesi anlamsız bir sürtünmedir, bu
 * yüzden seçim cihaz bazında (localStorage) hatırlanır.
 *
 * Değerin kendisi React'te DEĞİL, `terminal-depot-store.ts` içindeki
 * paylaşılan kutuda durur; bu hook yalnızca o kutuyu React'e bağlar.
 * Gerekçesi (ve düzelttiği sessiz arıza) o dosyanın başında yazılı.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/contexts/auth-context';
import {
  depotStorageKey,
  getDepot,
  hasDepot,
  setDepot,
  subscribeToDepot,
} from '@/lib/terminal-depot-store';

function readStored(storageKey: string): string {
  try {
    return window.localStorage.getItem(storageKey) || '';
  } catch {
    return '';
  }
}

export function useTerminalDepot(): [string, (depotId: string) => void] {
  const { currentCompanyId } = useAuth();
  const storageKey = depotStorageKey(currentCompanyId);

  const [depotId, setLocal] = useState(() => getDepot(storageKey));

  useEffect(() => {
    // İlk okuma effect içinde: `localStorage` sunucuda yoktur ve `useState`
    // başlangıç değerinde okunursa hidrasyon uyuşmazlığı olur.
    if (hasDepot(storageKey)) setLocal(getDepot(storageKey));
    else setDepot(storageKey, readStored(storageKey));

    return subscribeToDepot(storageKey, setLocal);
  }, [storageKey]);

  /**
   * Başka bir pencere/sekme seçimi değiştirirse buraya da yansısın.
   * Masaüstünde tek pencere var ama Firestore `persistentMultipleTabManager`
   * ile çalıştığı için birden çok sekme mümkün.
   */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      setDepot(storageKey, event.newValue || '');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const select = useCallback(
    (next: string) => {
      setDepot(storageKey, next);
      try {
        if (next) window.localStorage.setItem(storageKey, next);
        else window.localStorage.removeItem(storageKey);
      } catch {
        /* gizli mod / kota — seçim yine oturum boyunca geçerli */
      }
    },
    [storageKey],
  );

  return [depotId, select];
}
