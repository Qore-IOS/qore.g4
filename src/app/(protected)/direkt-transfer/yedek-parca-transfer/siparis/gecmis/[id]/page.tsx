'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { ArrowLeft, ClipboardList, Loader2 } from 'lucide-react';

interface ComparisonRow {
  stokKodu: string;
  stokAdi: string;
  expected: number;
  actual: number;
  diff: number;
  status: 'ok' | 'missing' | 'over';
}

export default function YedekParcaSiparisDetayPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const orderId = params?.id;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const run = async () => {
      if (!orderId) return;
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'yedekParcaSiparisler', orderId));
        if (snap.exists()) setData({ id: snap.id, ...snap.data() });
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [orderId]);

  const comparedRows: ComparisonRow[] = useMemo(() => {
    const detail = data?.stockEntrySummary?.detail;
    if (!Array.isArray(detail)) return [];
    return detail;
  }, [data]);

  const createdAtText = useMemo(() => {
    const ts = data?.createdAt;
    const dt = ts instanceof Timestamp ? ts.toDate() : ts?.toDate?.();
    if (!dt) return '—';
    return dt.toLocaleString('tr-TR');
  }, [data]);

  if (loading) {
    return <div className="p-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (!data) {
    return <div className="p-8 text-sm">Sipariş bulunamadı.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="cihaz-card-strong p-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold" style={{ color: 'var(--dashboard-text)' }}>{data.orderName || 'Yedek Parça Sipariş Detayı'}</h1>
          <p className="text-xs font-mono" style={{ color: 'var(--dashboard-muted)' }}>Sipariş ID: {data.id}</p>
          <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Tarih: {createdAtText}</p>
        </div>
        <button onClick={() => router.push('/direkt-transfer/yedek-parca-transfer/siparis/gecmis')} className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Geri
        </button>
      </div>

      <div className="cihaz-card p-3">
        <p className="text-xs font-semibold" style={{ color: 'var(--dashboard-text)' }}>İlişkili Stok Giriş ID'leri</p>
        <div className="mt-2 space-y-1 text-[11px] font-mono" style={{ color: 'var(--dashboard-muted)' }}>
          {(data.relatedStockEntryIds || []).length === 0 ? <p>—</p> : (data.relatedStockEntryIds || []).map((id: string) => <p key={id}>{id}</p>)}
        </div>
      </div>

      <div className="cihaz-card overflow-hidden">
        <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--dashboard-stroke)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--dashboard-text)' }}>Sipariş / Stok Girişi Karşılaştırması</p>
        </div>
        {comparedRows.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--dashboard-muted)' }}>
            <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-40" />
            Karşılaştırma verisi bulunamadı.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ background: 'var(--dashboard-surface-2)' }}>
                  <th className="px-3 py-2 font-semibold">Stok Kodu</th>
                  <th className="px-3 py-2 font-semibold">Stok Adı</th>
                  <th className="px-3 py-2 font-semibold text-right">Sipariş</th>
                  <th className="px-3 py-2 font-semibold text-right">Stoğa Girilen</th>
                  <th className="px-3 py-2 font-semibold text-right">Fark</th>
                </tr>
              </thead>
              <tbody>
                {comparedRows.map(row => (
                  <tr
                    key={row.stokKodu}
                    className="border-t"
                    style={{
                      borderColor: 'var(--dashboard-stroke)',
                      background: row.status === 'ok' ? 'transparent' : 'rgba(245,158,11,.12)',
                    }}
                  >
                    <td className="px-3 py-2 font-mono">{row.stokKodu}</td>
                    <td className="px-3 py-2">{row.stokAdi}</td>
                    <td className="px-3 py-2 text-right">{row.expected}</td>
                    <td className="px-3 py-2 text-right">{row.actual}</td>
                    <td className="px-3 py-2 text-right font-semibold">{row.diff > 0 ? `+${row.diff}` : row.diff}</td>
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
