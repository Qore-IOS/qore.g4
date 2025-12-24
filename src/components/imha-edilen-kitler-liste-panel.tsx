'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, onSnapshot, Timestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import type { DateRange } from 'react-day-picker';
import { addDays, format, startOfDay, endOfDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { DestroyedKitRecord, Hospital } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { exportDataToExcel } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface GroupedDestroyedRecord {
    key: string;
    sourceId: string; // depotId or laboratoryId
    sourceName: string;
    sourceType: 'depot' | 'laboratory';
    stokKodu: string;
    stokAdi: string;
    lotNumarasi: string;
    miad: string;
    totalCount: number;
    records: DestroyedKitRecord[];
}

export default function ImhaEdilenKitlerListePanel() {
    const { toast } = useToast();
    const [records, setRecords] = useState<DestroyedKitRecord[]>([]);
    const [hospitals, setHospitals] = useState<Hospital[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: startOfDay(addDays(new Date(), -30)),
        to: endOfDay(new Date()),
    });
    const [labFilter, setLabFilter] = useState<string>('all');
    const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('all'); // all, fault, manual

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

    // Filter records
    const filteredRecords = useMemo(() => {
        return records.filter(record => {
            const resolvedAtDate = record.resolvedAt instanceof Date ? record.resolvedAt : new Date(record.resolvedAt);
            const isInDateRange = dateRange?.from && dateRange?.to && resolvedAtDate
                ? (resolvedAtDate >= dateRange.from && resolvedAtDate <= dateRange.to)
                : true;

            const matchesLab = labFilter === 'all' || record.laboratoryId === labFilter;

            const matchesSourceType = sourceTypeFilter === 'all'
                || (sourceTypeFilter === 'fault' && record.sourceType === 'fault')
                || (sourceTypeFilter === 'manual' && (record.sourceType === 'barcode' || record.sourceType === 'excel'));

            return isInDateRange && matchesLab && matchesSourceType;
        });
    }, [records, dateRange, labFilter, sourceTypeFilter]);

    // Separate fault records and manual records
    const { faultRecords, manualRecords } = useMemo(() => {
        const fault = filteredRecords.filter(r => r.sourceType === 'fault');
        const manual = filteredRecords.filter(r => r.sourceType === 'barcode' || r.sourceType === 'excel');
        return { faultRecords: fault, manualRecords: manual };
    }, [filteredRecords]);

    // Group manual records by source + product + lot
    const groupedManualRecords = useMemo(() => {
        const groups: Record<string, GroupedDestroyedRecord> = {};

        manualRecords.forEach(record => {
            const sourceId = record.depotId || record.laboratoryId || '';
            const sourceName = record.depotName || record.laboratoryName || '';
            const sourceType = record.depotId ? 'depot' : 'laboratory';
            const groupKey = `${sourceId}-${record.stokKodu}-${record.lotNumarasi || 'none'}-${record.miad || 'none'}`;

            if (!groups[groupKey]) {
                groups[groupKey] = {
                    key: groupKey,
                    sourceId,
                    sourceName,
                    sourceType,
                    stokKodu: record.stokKodu,
                    stokAdi: record.stokAdi,
                    lotNumarasi: record.lotNumarasi || '',
                    miad: record.miad || '',
                    totalCount: 0,
                    records: [],
                };
            }

            groups[groupKey].totalCount += record.testCount;
            groups[groupKey].records.push(record);
        });

        return Object.values(groups).sort((a, b) => {
            // Sort by source name, then product name
            const sourceCompare = a.sourceName.localeCompare(b.sourceName, 'tr');
            if (sourceCompare !== 0) return sourceCompare;
            return a.stokAdi.localeCompare(b.stokAdi, 'tr');
        });
    }, [manualRecords]);

    const handleExport = () => {
        if (filteredRecords.length === 0) {
            toast({ title: 'Veri Yok', description: 'Dışa aktarılacak kayıt bulunmuyor.', variant: 'default' });
            return;
        }
        const dataToExport = filteredRecords.map(r => {
            const resolvedAtDate = r.resolvedAt instanceof Date ? r.resolvedAt : new Date(r.resolvedAt);
            return {
                'Kaynak Tipi': r.depotId ? 'Depo' : 'Laboratuvar',
                'Kaynak': r.laboratoryName || r.depotName || '-',
                'Cihaz': r.deviceModel || '-',
                'Stok Kodu': r.stokKodu,
                'Stok Adı': r.stokAdi,
                'Lot': r.lotNumarasi || '-',
                'Miad': r.miad || '-',
                'Seri No': r.seriNumarasi || '-',
                'Test Adedi': r.testCount,
                'Kalan Test': r.remainingTests !== undefined ? r.remainingTests : '-',
                'İmha Tarihi': resolvedAtDate ? format(resolvedAtDate, 'dd.MM.yyyy HH:mm', { locale: tr }) : '',
                'Onaylayan': r.resolvedByName,
                'Kaynak': r.sourceType === 'fault' ? 'Arıza Kaydı' : 'Manuel',
                'Açıklama': r.aciklama,
            }
        });
        exportDataToExcel(dataToExport, 'Imha_Edilen_Kitler_Raporu', 'İmha Listesi', toast);
    };

    return (
        <div className="p-4 space-y-4">
            <BackButton fallback="/raporlama/imha-edilen-kitler" />
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertCircle className="h-6 w-6 text-destructive" />
                        İmha Edilen Kitler - Liste
                    </CardTitle>
                    <CardDescription>
                        Tüm kaynaklardan (manuel, barkod, excel, arıza kaydı) imha edilen kitlerin listesi.
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
                                    <SelectItem value="all">Tümü</SelectItem>
                                    {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex-grow">
                            <label className="text-sm font-medium">Kaynak Tipi</label>
                            <Select value={sourceTypeFilter} onValueChange={setSourceTypeFilter}>
                                <SelectTrigger><SelectValue/></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Tümü</SelectItem>
                                    <SelectItem value="manual">Manuel (Barkod/Excel)</SelectItem>
                                    <SelectItem value="fault">Arıza Kaydı</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <Button onClick={handleExport} variant="outline" disabled={filteredRecords.length === 0}>
                            <FileSpreadsheet className="mr-2 h-4 w-4"/> Excel'e Aktar
                        </Button>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <Loader2 className="h-8 w-8 animate-spin" />
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Grouped Manual Records (Barcode/Excel) */}
                            {groupedManualRecords.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                                        <Badge variant="outline">Manuel Girişler</Badge>
                                        <span className="text-sm text-muted-foreground">
                                            ({groupedManualRecords.reduce((sum, g) => sum + g.totalCount, 0)} adet)
                                        </span>
                                    </h3>
                                    <ScrollArea className="h-[40vh] border rounded-md p-2">
                                        <Accordion type="multiple" className="w-full">
                                            {groupedManualRecords.map(group => (
                                                <AccordionItem value={group.key} key={group.key}>
                                                    <AccordionTrigger>
                                                        <div className="flex-1 text-left">
                                                            <div className="font-medium">{group.stokAdi}</div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {group.stokKodu} • {group.sourceName} ({group.sourceType === 'depot' ? 'Depo' : 'Lab'})
                                                            </div>
                                                        </div>
                                                        <div className="flex-1 text-left text-sm">
                                                            Lot: {group.lotNumarasi || '-'}
                                                        </div>
                                                        <div className="flex-1 text-left text-sm">
                                                            Miad: {group.miad || '-'}
                                                        </div>
                                                        <div className="font-bold">
                                                            <Badge variant="secondary">{group.totalCount} Adet</Badge>
                                                        </div>
                                                    </AccordionTrigger>
                                                    <AccordionContent className="p-4 bg-muted/50">
                                                        <div className="space-y-2">
                                                            <div className="text-sm font-medium">Seri Numaraları:</div>
                                                            {group.records.filter(r => r.seriNumarasi).length > 0 ? (
                                                                <ul className="space-y-1">
                                                                    {group.records
                                                                        .filter(r => r.seriNumarasi)
                                                                        .map((record, idx) => (
                                                                            <li key={idx} className="text-xs font-mono flex justify-between items-center py-1 px-2 bg-background rounded">
                                                                                <span>
                                                                                    {record.seriNumarasi}
                                                                                    {record.remainingTests !== undefined && (
                                                                                        <span className="ml-2 text-muted-foreground">
                                                                                            (Kalan Test: {record.remainingTests})
                                                                                        </span>
                                                                                    )}
                                                                                </span>
                                                                                <span className="text-muted-foreground">
                                                                                    {record.resolvedAt ? format(record.resolvedAt instanceof Date ? record.resolvedAt : new Date(record.resolvedAt), 'dd.MM.yy HH:mm', { locale: tr }) : '-'}
                                                                                </span>
                                                                            </li>
                                                                        ))}
                                                                </ul>
                                                            ) : (
                                                                <p className="text-xs text-muted-foreground">Seri numarası olmayan lot bazlı imha</p>
                                                            )}
                                                            <div className="text-xs text-muted-foreground pt-2 border-t">
                                                                Toplam: {group.totalCount} adet • İmha Eden: {group.records[0]?.resolvedByName}
                                                            </div>
                                                        </div>
                                                    </AccordionContent>
                                                </AccordionItem>
                                            ))}
                                        </Accordion>
                                    </ScrollArea>
                                </div>
                            )}

                            {/* Fault Records (Individual) */}
                            {faultRecords.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                                        <Badge variant="destructive">Arıza Kayıtları</Badge>
                                        <span className="text-sm text-muted-foreground">
                                            ({faultRecords.reduce((sum, r) => sum + r.testCount, 0)} adet)
                                        </span>
                                    </h3>
                                    <ScrollArea className="h-[40vh] border rounded-md">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>İmha Tarihi</TableHead>
                                                    <TableHead>Laboratuvar</TableHead>
                                                    <TableHead>Cihaz</TableHead>
                                                    <TableHead>Ürün</TableHead>
                                                    <TableHead>Adet</TableHead>
                                                    <TableHead>Kalan Test</TableHead>
                                                    <TableHead>Onaylayan</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {faultRecords.map(record => (
                                                    <TableRow key={record.id}>
                                                        <TableCell className="text-xs">
                                                            {record.resolvedAt
                                                                ? format(record.resolvedAt instanceof Date ? record.resolvedAt : new Date(record.resolvedAt), 'dd.MM.yy HH:mm', { locale: tr })
                                                                : '-'}
                                                        </TableCell>
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
                                                        <TableCell>
                                                            {record.remainingTests !== undefined ? record.remainingTests : '-'}
                                                        </TableCell>
                                                        <TableCell>{record.resolvedByName}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </ScrollArea>
                                </div>
                            )}

                            {filteredRecords.length === 0 && (
                                <div className="text-center py-12 text-muted-foreground">
                                    <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                    <p>Kayıt bulunamadı.</p>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
