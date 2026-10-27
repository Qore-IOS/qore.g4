
'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Check, X, User, Calendar, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '../../../../../lib/data/client';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp, Timestamp } from '../../../../../lib/data/client';
import BackButton from '@/components/BackButton';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/document-helpers';

type ExpenseCategory =
  | 'Ulaşım'
  | 'Yakıt'
  | 'Yemek'
  | 'Temsil'
  | 'Otel'
  | 'Diğerleri';

type ExpenseRow = {
  id: string;
  tarih: string;
  fisNo: string;
  kdv: number;
  aciklama: string;
  kategori: ExpenseCategory | '';
  fiyat: number;
};

type ExpenseRequest = {
  id: string;
  ownerUid: string;
  ownerName: string;
  year: number;
  month: number;
  receipts: ExpenseRow[];
  total: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Timestamp;
  updatedAt?: Timestamp;
};

export default function MasrafYonetimiOnayPage() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const q = scopedQuery('expensePeriods', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const data = filterByCompanyScope(
          snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseRequest)),
          currentCompanyId,
          isSuperAdmin
        );
        setRequests(data);
        setLoading(false);
      }, 
      (error) => {
        console.error("Error fetching expense requests:", error);
        toast({ title: 'Hata', description: 'Masraf talepleri yüklenemedi.', variant: 'destructive' });
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [toast, currentCompanyId, isSuperAdmin]);

  const filteredRequests = useMemo(() => {
    return requests.filter(req => req.status === activeTab);
  }, [requests, activeTab]);

  const handleUpdateRequestStatus = async (requestId: string, newStatus: 'approved' | 'rejected') => {
    setProcessingId(requestId);
    try {
      const requestRef = doc(db, 'expensePeriods', requestId);
      await updateDoc(requestRef, {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      toast({
        title: 'Başarılı',
        description: `Talep ${newStatus === 'approved' ? 'onaylandı' : 'reddedildi'}.`,
      });
    } catch (error) {
      console.error("Error updating request status:", error);
      toast({ title: 'Hata', description: 'Talep durumu güncellenirken bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setProcessingId(null);
    }
  };

  const getStatusBadge = (status: ExpenseRequest['status']) => {
    switch (status) {
      case 'approved':
        return <Badge variant="default" className="bg-green-600">Onaylandı</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Reddedildi</Badge>;
      case 'pending':
      default:
        return <Badge variant="secondary">Beklemede</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <BackButton fallback="/yonetim/personel-yonetimi" />
      <Card>
        <CardHeader>
          <CardTitle>Masraf Yönetimi - Onay Paneli</CardTitle>
          <CardDescription>Personel tarafından gönderilen masraf taleplerini inceleyin ve yönetin.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
            <TabsList>
              <TabsTrigger value="pending">Bekleyen Talepler</TabsTrigger>
              <TabsTrigger value="approved">Onaylananlar</TabsTrigger>
              <TabsTrigger value="rejected">Reddedilenler</TabsTrigger>
            </TabsList>
            <div className="mt-4">
              {loading ? (
                <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : filteredRequests.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Bu kategoride talep bulunmuyor.</p>
              ) : (
                <ScrollArea className="h-[60vh] border rounded-md">
                  <Accordion type="single" collapsible>
                    {filteredRequests.map(req => {
                      const periodLabel = format(new Date(req.year, req.month), 'MMMM yyyy', { locale: tr });
                      return (
                        <AccordionItem value={req.id} key={req.id}>
                          <AccordionTrigger className="p-4 hover:no-underline">
                            <div className="grid grid-cols-4 w-full text-left">
                              <div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" />{req.ownerName}</div>
                              <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" />{periodLabel}</div>
                              <div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-muted-foreground" />{req.total.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}</div>
                              <div>{getStatusBadge(req.status)}</div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="p-4 bg-muted/50">
                            <Table>
                              <TableHeader><TableRow><TableHead>Tarih</TableHead><TableHead>Fiş No</TableHead><TableHead>Açıklama</TableHead><TableHead>Kategori</TableHead><TableHead className="text-right">Fiyat</TableHead></TableRow></TableHeader>
                              <TableBody>
                                {req.receipts.map(entry => (
                                  <TableRow key={entry.id}>
                                    <TableCell>{entry.tarih}</TableCell>
                                    <TableCell>{entry.fisNo}</TableCell>
                                    <TableCell>{entry.aciklama}</TableCell>
                                    <TableCell>{entry.kategori}</TableCell>
                                    <TableCell className="text-right">{entry.fiyat.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            {req.status === 'pending' && (
                              <div className="flex justify-end gap-2 mt-4">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleUpdateRequestStatus(req.id, 'rejected')}
                                  disabled={processingId === req.id}
                                >
                                  {processingId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                  <span className="ml-2">Reddet</span>
                                </Button>
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="bg-green-600 hover:bg-green-700"
                                  onClick={() => handleUpdateRequestStatus(req.id, 'approved')}
                                  disabled={processingId === req.id}
                                >
                                  {processingId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  <span className="ml-2">Onayla</span>
                                </Button>
                              </div>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </ScrollArea>
              )}
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
