/**
 * @fileoverview Terminalin "bulunduğu depo" hafızası.
 *
 * Bir depo terminali fiziksel olarak tek bir depoda durur. Kullanıcının her
 * ekran açılışında aynı depoyu yeniden seçmesi anlamsız bir sürtünmedir, bu
 * yüzden seçim cihaz bazında (localStorage) hatırlanır.
 *
 * Şirket kimliği anahtara katılır: aynı makinede farklı bir kiracının
 * kullanıcısı oturum açtığında, önceki kiracının depo kimliği geri gelmez.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';

const STORAGE_PREFIX = 'qore.terminal.depotId';

export function useTerminalDepot(): [string, (depotId: string) => void] {
  const { currentCompanyId } = useAuth();
  const storageKey = `${STORAGE_PREFIX}.${currentCompanyId || 'nc'}`;
  const [depotId, setDepotId] = useState('');

  // İlk okuma effect içinde yapılır: localStorage sunucuda yoktur ve
  // useState başlangıç değerinde okunursa hidrasyon uyuşmazlığı olur.
  useEffect(() => {
    try {
      setDepotId(window.localStorage.getItem(storageKey) || '');
    } catch {
      setDepotId('');
    }
  }, [storageKey]);

  const select = useCallback(
    (next: string) => {
      setDepotId(next);
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
