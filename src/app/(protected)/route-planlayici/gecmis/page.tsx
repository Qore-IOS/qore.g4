// app/(protected)/route-planlayici/gecmis/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';

type Row = {
  id: string;
  sequence: number;
  dateISO: string;
  driverName: string;
  status: 'open'|'in_progress'|'completed';
  completedAt?: any;
  stops?: any[];
};

export default function RouteHistoryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    (async () => {
      setLoading(true);
      const qy = query(collection(db, 'routes'), orderBy('completedAt', 'desc'), limit(1000));
      try {
        const snap = await getDocs(qy);
        const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Row[];
        // Client-side filter ensures we don't need a composite index on status + completedAt
        setRows(all.filter(r => r.status === 'completed' && r.completedAt));
      } catch (e) {
        console.error("History fetch error:", e);
        // Fallback or error message could be here
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  
  return (
    <div className="p-4">
      <Card className="shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Tamamlanan Rotalar</CardTitle>
          <BackButton fallback="/route-planlayici" />
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[70vh] rounded-md border">
            <div className="p-3 space-y-2">
              {loading ? (
                  <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin"/></div>
              ) : rows.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-4 text-center">Geçmiş rota kaydı bulunamadı.</div>
              ) : (
                rows.map(r => (
                <button
                    key={r.id}
                    className="w-full text-left rounded-md border px-3 py-2 hover:bg-accent/40 transition"
                >
                    <div className="text-sm font-medium">{r.driverName} • {format(new Date(r.dateISO), 'dd.MM.yyyy', { locale: tr })} • #{r.sequence} • {r.stops?.length || 0} durak</div>
                    <div className="text-xs text-muted-foreground">{r.id}</div>
                </button>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
