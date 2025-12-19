
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, where, Timestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Trash2, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import type { DateRange } from 'react-day-picker';
import { addDays, format, startOfDay, endOfDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { DestroyedKitRecord, Hospital } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { exportDataToExcel } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function ImhaEdilenKitlerPanel() {
    const { toast } = useToast();
    const [records, setRecords] = useState<DestroyedKitRecord[]>([]);
    const [hospitals, setHospitals] = useState<Hospital[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: startOfDay(addDays(new Date(), -30)),
        to: endOfDay(new Date()),
    });
    const [labFilter, setLabFilter] = useState<string>('all');

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [recordsSnap, labsSnap] = await Promise.all([
                    getDocs(query(collection(db, 'destroyedKitsReports'), orderBy('resolvedAt', 'desc'))),
                    getDocs(collection(db, 'hospitals'))
                ]);

                const fetchedRecords = recordsSnap.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        ...data,
                        resolvedAt: (data.resolvedAt as Timestamp)?.toDate()
                    } as DestroyedKitRecord;
                });
                setRecords(fetchedRecords);
                setHospitals(labsSnap.docs.map(d => ({id: d.id, ...d.data()}) as Hospital));

            } catch (error) {
                console.error("Error fetching destroyed kits:", error);
                toast({ title: 'Hata', description: 'İmha edilen kit kayıtları yüklenemedi.', variant: 'destructive' });
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [toast]);

    const filteredRecords = useMemo(() => {
        return records.filter(record => {
            const isInDateRange = dateRange?.from && dateRange?.to && record.resolvedAt
                ? (record.resolvedAt >= dateRange.from && record.resolvedAt <= dateRange.to)
                : true;
            
            const matchesLab = labFilter === 'all' || record.laboratoryId === labFilter;

            return isInDateRange && matchesLab;
        });
    }, [records, dateRange, labFilter]);

    const handleExport = () => {
        if (filteredRecords.length === 0) {
            toast({ title: 'Veri Yok', description: 'Dışa aktarılacak kayıt bulunmuyor.', variant: 'default' });
            return;
        }
        const dataToExport = filteredRecords.map(r => ({
            'Laboratuvar': r.laboratoryName,
            'Cihaz': r.deviceModel,
            'Stok Kodu': r.stokKodu,
            'Stok Adı': r.stokAdi,
            'Test Adedi': r.testCount,
            'İmha Tarihi': r.resolvedAt ? format(r.resolvedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '',
            'Onaylayan': r.resolvedByName,
            'Açıklama': r.aciklama,
        }));
        exportDataToExcel(dataToExport, 'Imha_Edilen_Kitler_Raporu', 'İmha Listesi', toast);
    };

    return (
        <div className="p-4 space-y-4">
            <BackButton fallback="/raporlama" />
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Trash2 className="h-6 w-6 text-destructive" />
                        İmha Edilen Kitler Raporu
                    </CardTitle>
                    <CardDescription>
                        Cihazdan çıkan ve 'imha' olarak çözümlenen tüm kitlerin kaydı.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-4 items-end mb-4">
                        <div className="flex-grow">
                            <label className="text-sm font-medium">Tarih Aralığı</label>
                            <DatePickerWithRange date={dateRange} setDate={setDateRange} className="w-full" />
                        </div>
                        <div className="flex-grow">
                            <label className="text-sm font-medium">Laboratuvar</label>
                            <Select value={labFilter} onValueChange={setLabFilter}>
                                <SelectTrigger><SelectValue/></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Tüm Laboratuvarlar</SelectItem>
                                    {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button onClick={handleExport} variant="outline" disabled={filteredRecords.length === 0}>
                            <FileSpreadsheet className="mr-2 h-4 w-4"/> Excel'e Aktar
                        </Button>
                    </div>

                    <ScrollArea className="h-[60vh] border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>İmha Tarihi</TableHead>
                                    <TableHead>Laboratuvar</TableHead>
                                    <TableHead>Cihaz</TableHead>
                                    <TableHead>Ürün</TableHead>
                                    <TableHead>Test Adedi</TableHead>
                                    <TableHead>Onaylayan</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-8 w-8 animate-spin mx-auto"/></TableCell></TableRow>
                                ) : filteredRecords.length === 0 ? (
                                    <TableRow><TableCell colSpan={6} className="text-center py-8">Kayıt bulunamadı.</TableCell></TableRow>
                                ) : (
                                    filteredRecords.map(record => (
                                        <TableRow key={record.id}>
                                            <TableCell className="text-xs">{record.resolvedAt ? format(record.resolvedAt, 'dd.MM.yy HH:mm', {locale: tr}) : '-'}</TableCell>
                                            <TableCell>{record.laboratoryName}</TableCell>
                                            <TableCell>{record.deviceModel}</TableCell>
                                            <TableCell>
                                                <div>
                                                    <div className="font-medium">{record.stokAdi}</div>
                                                    <div className="text-xs text-muted-foreground">{record.stokKodu}</div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="secondary">{record.testCount}</Badge>
                                            </TableCell>
                                            <TableCell>{record.resolvedByName}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
