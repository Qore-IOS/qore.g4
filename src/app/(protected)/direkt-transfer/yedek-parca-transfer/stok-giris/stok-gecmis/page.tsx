'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ChevronLeft, History, Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';

interface DepoLogRow {
  id: string;
  action: string;
  stokKodu: string;
  stokAdi: string;
  serialNumber?: string;
  quantity?: number;
  address?: string;
  notes?: string;
  createdAt: Date;
  createdByName?: string;
}

export default function StokGecmisPage() {
  const router = useRouter();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DepoLogRow[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocsResilient(scopedQuery('yedekParcaDepoLog', currentCompanyId, isSuperAdmin));
        const logs = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          } as DepoLogRow;
        });
        logs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setRows(logs);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4" style={{ minHeight: '100dvh' }}>
      <button onClick={() => router.push('/direkt-transfer/yedek-parca-transfer/stok-giris')} className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium" style={{ color: 'var(--dashboard-muted)' }}>
        <ChevronLeft className="w-3.5 h-3.5" /> Stok Girişe Dön
      </button>

      <header className="cihaz-card-strong p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <History className="w-4.5 h-4.5" style={{ color: 'var(--dashboard-accent)' }} />
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--dashboard-text)' }}>Stok Geçmiş</h1>
            <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Yapılan tüm stok işlemleri</p>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="cihaz-card p-8 flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /><span className="text-xs">Yükleniyor…</span></div>
      ) : (
        <div className="cihaz-card overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
                <th className="px-3 py-2 text-left">Tarih</th>
                <th className="px-3 py-2 text-left">Ürün</th>
                <th className="px-3 py-2 text-left">Adres</th>
                <th className="px-3 py-2 text-right">Adet</th>
                <th className="px-3 py-2 text-left">Kullanıcı</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} onClick={() => router.push(`/direkt-transfer/yedek-parca-transfer/stok-giris/stok-gecmis/${row.id}`)} className="cursor-pointer hover:bg-black/[.02]" style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
                  <td className="px-3 py-2">{format(row.createdAt, 'dd.MM.yyyy HH:mm', { locale: tr })}</td>
                  <td className="px-3 py-2">{row.stokKodu} · {row.stokAdi} {row.serialNumber ? `· SN: ${row.serialNumber}` : ''}</td>
                  <td className="px-3 py-2">{row.address || '—'}</td>
                  <td className="px-3 py-2 text-right">{row.quantity || 0}</td>
                  <td className="px-3 py-2">{row.createdByName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
