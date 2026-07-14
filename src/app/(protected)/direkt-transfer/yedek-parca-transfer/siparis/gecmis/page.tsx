'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import { filterByCompanyScope } from '@/lib/company-scope';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { ArrowLeft, ClipboardList, History, Loader2, RefreshCw } from 'lucide-react';

interface SparePartOrderHistoryRow {
  id: string;
  orderNo?: string;
  orderName?: string;
  createdByName?: string;
  totalItems?: number;
  totalQuantity?: number;
  createdAt?: Date;
  status?: 'draft' | 'completed' | 'open';
}

const formatDate = (value?: Date) => {
  if (!value) return '—';
  return value.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function YedekParcaSiparisGecmisPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SparePartOrderHistoryRow[]>([]);

  const loadHistory = useCallback(async () => {
    if (!currentCompanyId) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const snap = await getDocs(scopedQuery('yedekParcaSiparisler', currentCompanyId, isSuperAdmin));
      const scoped = filterByCompanyScope(
        snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any)),
        currentCompanyId,
      );

      const parsed = scoped
        .map((row: any) => ({
          id: row.id,
          orderNo: row.orderNo,
          orderName: row.orderName,
          createdByName: row.createdByName,
          totalItems: Number(row.totalItems || 0),
          totalQuantity: Number(row.totalQuantity || 0),
          status: row.status,
          createdAt: row.createdAt instanceof Timestamp ? row.createdAt.toDate() : row.createdAt?.toDate?.() || undefined,
        }))
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));

      setRows(parsed);
    } catch (error) {
      console.error('Yedek parça sipariş geçmişi yüklenemedi:', error);
      toast({ title: 'Hata', description: 'Sipariş geçmişi yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, toast]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const totalOrders = useMemo(() => rows.length, [rows]);

  return (
    <div className="space-y-4">
      <div className="cihaz-card-strong p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <History className="w-4 h-4" style={{ color: 'var(--dashboard-accent)' }} />
            <h1 className="text-sm font-bold" style={{ color: 'var(--dashboard-text)' }}>Yedek Parça Sipariş Geçmişi</h1>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--dashboard-muted)' }}>
            Kaydedilen siparişler: sipariş adı, oluşturan kişi ve kalem sayısı.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => router.push('/direkt-transfer/yedek-parca-transfer/siparis')} className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>
            <ArrowLeft className="w-3.5 h-3.5" /> Sipariş Paneli
          </button>
          <button onClick={() => void loadHistory()} disabled={loading} className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium disabled:opacity-50" style={{ color: 'var(--dashboard-text)' }}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Yenile
          </button>
        </div>
      </div>

      <div className="cihaz-card p-3">
        <p className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>Toplam Sipariş</p>
        <p className="text-xl font-bold" style={{ color: 'var(--dashboard-text)' }}>{totalOrders}</p>
      </div>

      <div className="cihaz-card overflow-hidden">
        <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--dashboard-stroke)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--dashboard-text)' }}>Kayıtlar</p>
        </div>

        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2" style={{ color: 'var(--dashboard-muted)' }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Veriler hazırlanıyor...
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center" style={{ color: 'var(--dashboard-muted)' }}>
            <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium">Henüz kayıtlı sipariş yok.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ background: 'var(--dashboard-surface-2)' }}>
                  <th className="px-3 py-2 font-semibold">Sipariş Adı</th>
                  <th className="px-3 py-2 font-semibold">Sipariş No</th>
                  <th className="px-3 py-2 font-semibold">Oluşturan</th>
                  <th className="px-3 py-2 font-semibold text-right">Kalem Sayısı</th>
                  <th className="px-3 py-2 font-semibold text-right">Durum</th>
                  <th className="px-3 py-2 font-semibold text-right">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t cursor-pointer hover:bg-black/[.02]"
                    style={{ borderColor: 'var(--dashboard-stroke)' }}
                    onClick={() => router.push(`/direkt-transfer/yedek-parca-transfer/siparis/gecmis/${row.id}`)}
                  >
                    <td className="px-3 py-2 text-[13px] font-semibold">{row.orderName || 'Yedek Parça Sipariş'}</td>
                    <td className="px-3 py-2 font-mono">{row.orderNo || '—'}</td>
                    <td className="px-3 py-2">{row.createdByName || '—'}</td>
                    <td className="px-3 py-2 text-right">{row.totalItems || 0}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className="inline-flex px-2 py-1 rounded-lg text-[11px] font-semibold"
                        style={{
                          background: row.status === 'completed' ? 'rgba(22,163,74,.14)' : row.status === 'open' ? 'rgba(245,158,11,.14)' : 'rgba(59,130,246,.14)',
                          color: row.status === 'completed' ? '#166534' : row.status === 'open' ? '#92400E' : '#1E3A8A',
                        }}
                      >
                        {row.status === 'completed' ? 'Tamamlandı' : row.status === 'open' ? 'Açık (Eksik/Fazla)' : 'Taslak'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
