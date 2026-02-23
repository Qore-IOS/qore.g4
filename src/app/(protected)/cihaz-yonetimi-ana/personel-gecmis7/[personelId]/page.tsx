'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import BackButton from '@/components/BackButton';
import { toDateValue } from '@/lib/personnel-availability';

interface HistoryRecord {
  id: string;
  actionLabel: string;
  description: string;
  startAt?: Date | null;
  endAt?: Date | null;
  createdAt?: Date | null;
}

export default function PersonelGecmis7Page() {
  const params = useParams<{ personelId: string }>();
  const personelId = params?.personelId;

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('Personel');
  const [records, setRecords] = useState<HistoryRecord[]>([]);

  useEffect(() => {
    const run = async () => {
      if (!personelId) return;
      setLoading(true);
      try {
        const [userDoc, historySnap] = await Promise.all([
          getDoc(doc(db, 'users', personelId)),
          getDocs(query(collection(db, 'personnelHistoryLogs'), where('uid', '==', personelId))),
        ]);

        const user = userDoc.exists() ? userDoc.data() : null;
        setName(user?.name || user?.email || personelId);

        const rows = historySnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            actionLabel: data.actionLabel || data.action || 'Kayıt',
            description: data.description || '-',
            startAt: toDateValue(data.startAt),
            endAt: toDateValue(data.endAt),
            createdAt: toDateValue(data.createdAt),
          } as HistoryRecord;
        });
        setRecords(rows);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [personelId]);

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)),
    [records]
  );

  return (
    <div className="cihaz-shell min-h-screen px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-4xl cihaz-card-strong p-5 sm:p-8">
        <BackButton fallback="/cihaz-yonetimi-ana" />
        <h1 className="mt-4 text-2xl font-bold text-[var(--dashboard-text)]">{name} · Personel İşlem Geçmişi</h1>

        {loading ? (
          <p className="mt-4 text-sm text-[var(--dashboard-muted)]">Yükleniyor...</p>
        ) : (
          <div className="mt-6 space-y-3">
            {sortedRecords.length === 0 ? (
              <p className="text-sm text-[var(--dashboard-muted)]">Kayıt bulunamadı.</p>
            ) : (
              sortedRecords.map((item) => (
                <div key={item.id} className="rounded-xl border border-[var(--dashboard-stroke)] px-4 py-3 bg-[var(--dashboard-surface)]">
                  <p className="font-semibold text-[var(--dashboard-text)]">{item.actionLabel}</p>
                  <p className="text-sm text-[var(--dashboard-muted)]">{item.description}</p>
                  <p className="text-xs text-[var(--dashboard-muted)] mt-1">
                    Aralık: {item.startAt ? item.startAt.toLocaleString('tr-TR') : '-'} - {item.endAt ? item.endAt.toLocaleString('tr-TR') : '-'}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
