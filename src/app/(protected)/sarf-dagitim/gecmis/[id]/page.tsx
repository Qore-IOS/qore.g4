'use client';
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Order } from '@/lib/types';
import { Loader2, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';
import { Button } from '@/components/ui/button';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type ConsumableRequest = Order & { totalQuantity?: number };

function generateTutanak(req: ConsumableRequest) {
    const doc = new jsPDF();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(`Sarf Talep Tutanağı`, 14, 22);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`Laboratuvar: ${req.kurumAdi}`, 14, 40);
    doc.text(`Talep Tarihi: ${req.createdAt ? format(req.createdAt as Date, 'dd.MM.yyyy HH:mm', { locale: tr }) : ''}`, 14, 50);
    doc.text(`Talebi Oluşturan: ${req.createdBy || ''}`, 14, 60);

    const tableColumn = ["Stok Kodu", "Ürün Adı", "Talep Adeti"];
    const tableRows: (string | number)[][] = [];

    (req.items || []).forEach(item => {
        const row: (string | number)[] = [
            item.stokKodu || '',
            item.stokAdi || '',
            item.adet ?? 0
        ];
        tableRows.push(row);
    });

    autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 70,
        theme: 'grid',
        styles: { font: "helvetica", halign: 'left' },
        headStyles: { fillColor: [22, 160, 133] },
    });
    
    doc.save(`Sarf_Talep_${req.kurumAdi}_${(req.id || 'unknown').substring(0,6)}.pdf`);
}


export default function SarfGecmisDetayPage() {
    const params = useParams();
    const id = (params?.id as string) ?? '';
    const [request, setRequest] = useState<ConsumableRequest | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) return;
        const fetchRequest = async () => {
            setLoading(true);
            try {
                const snap = await getDoc(doc(db, 'consumableRequests', id));
                if (snap.exists()) {
                    const data = snap.data();
                    setRequest({ 
                        id: snap.id, 
                        ...data,
                        createdAt: (data.createdAt as Timestamp)?.toDate()
                    } as ConsumableRequest);
                }
            } catch (error) {
                console.error("Error fetching request detail:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchRequest();
    }, [id]);

    if (loading) {
        return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (!request) {
        return <div className="p-8 text-center">Talep detayı bulunamadı.</div>;
    }

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex justify-between items-center">
                <BackButton fallback="/sarf-dagitim/gecmis" />
                 <Button variant="outline" onClick={() => generateTutanak(request)}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" /> Tutanak (PDF)
                </Button>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>{request.kurumAdi} - Talep Detayı</CardTitle>
                    <CardDescription>
                        {request.createdAt ? format(request.createdAt as Date, 'dd MMMM yyyy, HH:mm', { locale: tr }) : ''} tarihinde {request.createdBy} tarafından oluşturuldu.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[60vh] border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Stok Kodu</TableHead>
                                    <TableHead>Ürün Adı</TableHead>
                                    <TableHead className="text-right">Talep Adeti</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {(request.items || []).filter(item => item.id).map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-mono">{item.stokKodu}</TableCell>
                                        <TableCell>{item.stokAdi}</TableCell>
                                        <TableCell className="text-right font-semibold">{item.adet}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
