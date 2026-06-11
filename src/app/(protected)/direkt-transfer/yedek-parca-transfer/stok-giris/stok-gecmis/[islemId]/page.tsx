'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { ChevronLeft } from 'lucide-react';
import { db } from '@/lib/firebase';

export default function StokGecmisDetayPage() {
  const router = useRouter();
  const params = useParams<{ islemId: string }>();
  const [data, setData] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!params?.islemId) return;
      const snap = await getDoc(doc(db, 'yedekParcaDepoLog', params.islemId));
      if (snap.exists()) {
        setData({ id: snap.id, ...snap.data() });
      }
    };
    load();
  }, [params?.islemId]);

  return (
    <div className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4" style={{ minHeight: '100dvh' }}>
      <button onClick={() => router.push('/direkt-transfer/yedek-parca-transfer/stok-giris/stok-gecmis')} className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium" style={{ color: 'var(--dashboard-muted)' }}>
        <ChevronLeft className="w-3.5 h-3.5" /> Geçmişe Dön
      </button>
      <div className="cihaz-card-strong p-4 space-y-2">
        <h1 className="text-lg font-bold" style={{ color: 'var(--dashboard-text)' }}>İşlem Detayı</h1>
        <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>/stok-gecmis/{params?.islemId}</p>
        <pre className="text-xs p-3 rounded-xl overflow-auto" style={{ background: 'var(--dashboard-surface-2)' }}>{JSON.stringify(data, null, 2)}</pre>
      </div>
    </div>
  );
}
