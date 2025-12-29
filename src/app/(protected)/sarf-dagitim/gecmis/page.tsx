
'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { collection, getDocs, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Order } from '@/lib/types';
import { Loader2, History, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';
import { Accordion, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

// Re-using Order type for simplicity, as the structure is similar
type ConsumableRequest = Order & { totalQuantity?: number };

export default function SarfTalepGecmisPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ConsumableRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRequests = async () => {
      setLoading(true);
      try {
        const q = query(collection(db, 'consumableRequests'), orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);
        const reqs = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          createdAt: (d.data().createdAt as Timestamp)?.toDate()
        } as ConsumableRequest));
        setRequests(reqs);
      } catch (error) {
        console.error("Error fetching consumable requests:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchRequests();
  }, []);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <BackButton fallback="/sarf-dagitim" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-6 w-6 text-primary" />
            Sarf Talep Geçmişi
          </CardTitle>
          <CardDescription>Oluşturulmuş tüm sarf malzeme taleplerini görüntüleyin.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : requests.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Geçmiş talep bulunamadı.</p>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {requests.filter(req => req.id).map(req => (
                <AccordionItem key={req.id} value={req.id!}>
                  <AccordionTrigger
                    className="flex justify-between items-center hover:no-underline p-4"
                    onClick={() => router.push(`/sarf-dagitim/gecmis/${req.id}`)}
                  >
                    <div className="text-left space-y-1">
                      <p className="font-semibold">{req.kurumAdi}</p>
                      <p className="text-xs text-muted-foreground">{req.createdAt ? format(req.createdAt as Date, 'dd MMM yyyy, HH:mm', { locale: tr }) : '-'}</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-xs text-muted-foreground">
                        Talebi Açan: {req.createdBy || '-'}
                        </div>
                        <div className="font-medium">
                        {(req.items || []).reduce((sum, i) => sum + (i.adet ?? 0), 0)} Adet
                        </div>
                        {req.status === 'completed' && (
                            <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-600">
                                <CheckCircle className="h-3 w-3"/>
                                Tamamlandı
                            </span>
                        )}
                    </div>
                  </AccordionTrigger>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
