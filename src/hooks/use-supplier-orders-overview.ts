'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDocs } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope } from '@/lib/company-scope';
import type { SupplierOrder } from '@/lib/types';

export interface SupplierOrderSummary {
  id: string;
  markaAdi: string;
  donem: string;
  toplamKalem: number;
  toplamAdet: number;
  anaDepoAdi: string;
  createdAt: Date | null;
  completedAt: Date | null;
  status: 'bekliyor' | 'tamamlandi';
  mailStatus?: SupplierOrder['mailStatus'];
  autoCompleted?: boolean;
  /** Ceomed girişleriyle karşılanan adet (kısmi teslimat takibi) */
  alinanAdet: number;
}

export interface SupplierOrdersOverview {
  openOrders: SupplierOrderSummary[];
  recentOrders: SupplierOrderSummary[];
  openCount: number;
  openTotalAdet: number;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value !== null) {
    const ts = value as { toDate?: () => Date; seconds?: number };
    if (typeof ts.toDate === 'function') {
      const date = ts.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function toSummary(order: SupplierOrder & { id: string }): SupplierOrderSummary {
  const items = Array.isArray(order.items) ? order.items : [];
  return {
    id: order.id,
    markaAdi: String(order.markaAdi || '—'),
    donem: String(order.donem || ''),
    toplamKalem: Number(order.toplamKalem) || items.length,
    toplamAdet:
      Number(order.toplamAdet) ||
      items.reduce((sum, item) => sum + (Number(item?.siparisAdedi) || 0), 0),
    anaDepoAdi: String(order.anaDepoAdi || ''),
    createdAt: toDate(order.createdAt),
    completedAt: toDate(order.completedAt),
    status: order.status === 'tamamlandi' ? 'tamamlandi' : 'bekliyor',
    mailStatus: order.mailStatus,
    autoCompleted: order.autoCompleted === true,
    alinanAdet: items.reduce((sum, item) => sum + (Number(item?.alinanAdet) || 0), 0),
  };
}

/**
 * Lojistik ana sayfadaki Tedarikçi Sipariş kartını besleyen özet.
 * supplierOrders koleksiyonu küçüktür; tek sorguyla çekilip istemcide ayrılır.
 */
export function useSupplierOrdersOverview() {
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  const query = useQuery({
    queryKey: ['supplierOrders', 'overview', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('supplierOrders', currentCompanyId, isSuperAdmin));
      const orders = filterByCompanyScope(
        snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<SupplierOrder, 'id'>) })),
        currentCompanyId,
        isSuperAdmin,
      ) as Array<SupplierOrder & { id: string }>;
      return orders.map(toSummary);
    },
    enabled:
      currentUserProfile?.role === 'lojistik_sorumlusu' &&
      (!!currentCompanyId || isSuperAdmin === true),
    staleTime: 60_000,
  });

  const data = useMemo<SupplierOrdersOverview>(() => {
    const all = query.data || [];
    const byNewest = (a: SupplierOrderSummary, b: SupplierOrderSummary) =>
      (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0);

    const openOrders = all.filter(o => o.status === 'bekliyor').sort(byNewest);
    const recentOrders = all
      .filter(o => o.status === 'tamamlandi')
      .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0) || byNewest(a, b));

    return {
      openOrders,
      recentOrders,
      openCount: openOrders.length,
      openTotalAdet: openOrders.reduce((sum, o) => sum + o.toplamAdet, 0),
    };
  }, [query.data]);

  return { ...query, data };
}
