
'use client';
import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { DepotStockCountSession } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { toDateSafe } from '@/lib/date';
import BackButton from '@/components/BackButton';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export default function DepoSayimDetayPage() {
  const params = useParams();
  const sessionId = Array.isArray(params?.sessionId) ? params.sessionId[0] : params?.sessionId;
  const { toast } = useToast();
  const router = useRouter();

  const [session, setSession] = useState<DepotStockCountSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    const fetchSession = async () => {
      setLoading(true);
      try {
        const sessionRef = doc(db, 'depotBrandCountSessions', sessionId);
        const sessionSnap = await getDoc(sessionRef);
        if (sessionSnap.exists()) {
          const data = sessionSnap.data();
          setSession({
            id: sessionSnap.id,
            ...data,
            closedAt: data.closedAt?.toDate ? data.closedAt.toDate() : null,
          } as DepotStockCountSession);
        } else {
          toast({ title: 'Hata', description: 'Sayım oturumu bulunamadı.', variant: 'destructive' });
          router.push('/depo-sayim/gecmis');
        }
      } catch (error) {
        console.error("Error fetching session details:", error);
        toast({ title: 'Hata', description: 'Oturum detayları yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    fetchSession();
  }, [sessionId, router, toast]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <div className="p-4">Sayım detayı bulunamadı.</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/depo-sayim/gecmis" />
      <Card>
        <CardHeader>
          <CardTitle>Depo Sayım Detayı: {session.brand}</CardTitle>
          <CardDescription>
            {session.createdByName} tarafından {session.closedAt && toDateSafe(session.closedAt) ? format(toDateSafe(session.closedAt)!, 'dd.MM.yyyy HH:mm', { locale: tr }) : ''} tarihinde tamamlandı.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-4 text-center">
            <Card><CardHeader><CardTitle>{session.itemCount}</CardTitle><CardDescription>Beklenen</CardDescription></CardHeader></Card>
            <Card><CardHeader><CardTitle>{session.scannedCount}</CardTitle><CardDescription>Sayılan</CardDescription></CardHeader></Card>
            <Card className="border-destructive"><CardHeader><CardTitle className="text-destructive">{session.missingCount}</CardTitle><CardDescription>Eksik</CardDescription></CardHeader></Card>
          </div>

          <h3 className="text-lg font-semibold mt-6 mb-2">Seri Numarası Detayları</h3>
          <ScrollArea className="h-[50vh]">
            <Accordion type="multiple" defaultValue={(Array.isArray(session.scannedItems) ? session.scannedItems : []).map((item: any) => item.id)}>
              {(Array.isArray(session.scannedItems) ? session.scannedItems : []).map((group: any) => {
                const allSerialsInGroup = new Set(group.items.map((i: any) => i.seriNumarasi));
                const scannedForGroup = new Set(group.scannedSerials || []);
                return (
                  <AccordionItem key={group.id} value={group.id}>
                    <AccordionTrigger>
                      <div className="flex-1 text-left">{group.stokAdi} - Lot: {group.lotNumarasi}</div>
                      <div className="text-right font-bold pr-4">{scannedForGroup.size} / {allSerialsInGroup.size}</div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 p-2 font-mono text-xs">
                        {Array.from(allSerialsInGroup).map((serial: any) => (
                          <li key={serial} className={cn("p-1 rounded flex items-center gap-1 truncate", scannedForGroup.has(serial) ? 'bg-green-200' : 'bg-red-200')}>
                            {scannedForGroup.has(serial) ? <Check className="h-4 w-4 flex-shrink-0" /> : <X className="h-4 w-4 flex-shrink-0" />}
                            <span className="truncate">{serial}</span>
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
