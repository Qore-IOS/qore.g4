'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, Timestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FileSpreadsheet, Search, X, History, ShieldAlert, User } from 'lucide-react';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import type { DateRange } from 'react-day-picker';
import { addDays, format, startOfDay, endOfDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { DestroyedKitRecord, Hospital } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { exportDataToExcel, cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { VirtualizedList } from '@/components/ui/virtualized-list';

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
    const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('all');

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [recordsSnap, labsSnap] = await Promise.all([
                    getDocs(query(collection(db, 'destroyedKitsReports'), orderBy('resolvedAt', 'desc'))),
                    getDocs(collection(db, 'hospitals'))
                ]);

                setRecords(recordsSnap.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id, ...data,
                        resolvedAt: (data.resolvedAt as Timestamp)?.toDate()
                    } as DestroyedKitRecord;
                }));
                setHospitals(labsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Hospital));
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

    const totalCount = filteredRecords.reduce((sum, r) => sum + r.testCount, 0);

    const hasActiveFilters = labFilter !== 'all' || sourceTypeFilter !== 'all';

    const clearFilters = () => {
        setLabFilter('all');
        setSourceTypeFilter('all');
        setDateRange({
            from: startOfDay(addDays(new Date(), -30)),
            to: endOfDay(new Date()),
        });
    };

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
                'Giriş Kaynağı': r.sourceType === 'fault' ? 'Arıza Kaydı' : r.sourceType === 'excel' ? 'Excel' : 'Barkod',
                'Açıklama': r.aciklama,
            };
        });
        exportDataToExcel(dataToExport, 'Imha_Edilen_Kitler_Raporu', 'İmha Listesi', toast);
    };

    const getSourceBadge = (record: DestroyedKitRecord) => {
        if (record.sourceType === 'fault') {
            return { label: 'Arıza', className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' };
        }
        if (record.sourceType === 'excel') {
            return { label: 'Excel', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
        }
        return { label: 'Barkod', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
    };

    return (
        <div className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4 sm:space-y-5 min-h-screen">
            {/* ══════════════════════ HEADER ══════════════════════ */}
            <div className="flex items-center gap-3">
                <BackButton fallback="/raporlama/imha-edilen-kitler" aria-label="Geri dön" />
                <div className="flex-1 min-w-0">
                    <h1 className="text-lg sm:text-xl font-bold text-[var(--dashboard-text)] flex items-center gap-2">
                        <History className="h-5 w-5 text-[var(--dashboard-accent)]" />
                        İmha Geçmişi
                    </h1>
                    <p className="text-[11px] sm:text-xs text-[var(--dashboard-muted)] truncate">
                        Tüm kaynaklardan imha edilen kitlerin listesi
                    </p>
                </div>
                <button
                    onClick={handleExport}
                    disabled={filteredRecords.length === 0}
                    className="cihaz-tool-item flex items-center gap-1.5 px-3 py-2 text-xs font-medium disabled:opacity-40"
                >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Excel'e Aktar</span>
                </button>
            </div>

            {/* ══════════════════════ FILTER CARD ══════════════════════ */}
            <div className="cihaz-card p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                    <p className="cihaz-overline text-[10px] sm:text-xs">Filtreler</p>
                    {hasActiveFilters && (
                        <button onClick={clearFilters} className="text-[10px] text-[var(--dashboard-accent)] font-medium flex items-center gap-1 hover:underline">
                            <X className="h-3 w-3" /> Temizle
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Date Range */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Tarih Aralığı</label>
                        <DatePickerWithRange date={dateRange} setDate={setDateRange} className="w-full" />
                    </div>

                    {/* Laboratory */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Laboratuvar</label>
                        <Select value={labFilter} onValueChange={setLabFilter}>
                            <SelectTrigger className="cihaz-pressed border-none h-10">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Tümü</SelectItem>
                                {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Source Type */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Kaynak Tipi</label>
                        <Select value={sourceTypeFilter} onValueChange={setSourceTypeFilter}>
                            <SelectTrigger className="cihaz-pressed border-none h-10">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Tümü</SelectItem>
                                <SelectItem value="manual">Manuel (Barkod/Excel)</SelectItem>
                                <SelectItem value="fault">Arıza Kaydı</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Active filter chips */}
                <div className="flex flex-wrap gap-1.5">
                    {dateRange?.from && dateRange?.to && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]">
                            {format(dateRange.from, 'dd MMM', { locale: tr })} – {format(dateRange.to, 'dd MMM yyyy', { locale: tr })}
                        </span>
                    )}
                    {labFilter !== 'all' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                            {hospitals.find(h => h.id === labFilter)?.name || labFilter}
                        </span>
                    )}
                    {sourceTypeFilter !== 'all' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            {sourceTypeFilter === 'fault' ? 'Arıza Kaydı' : 'Manuel'}
                        </span>
                    )}
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--dashboard-accent)]/10 text-[var(--dashboard-accent)]">
                        {filteredRecords.length} kayıt · {totalCount} adet
                    </span>
                </div>
            </div>

            {/* ══════════════════════ DATA TABLE ══════════════════════ */}
            <div className="cihaz-card-strong flex-1 flex flex-col overflow-hidden">
                {/* Table header - desktop */}
                {filteredRecords.length > 0 && (
                    <div className="hidden sm:grid grid-cols-[100px_1fr_2fr_1fr_1fr_70px_70px_100px] gap-1 px-4 sm:px-5 py-2.5 text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)]">
                        <span>Tarih</span>
                        <span>Kaynak</span>
                        <span>Ürün</span>
                        <span>Lot / Seri</span>
                        <span>Giriş</span>
                        <span className="text-right">Adet</span>
                        <span className="text-right">Kalan Test</span>
                        <span>Onaylayan</span>
                    </div>
                )}

                {/* Loading */}
                {loading ? (
                    <div className="flex items-center justify-center h-[50vh]">
                        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
                    </div>
                ) : filteredRecords.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[40vh] text-center px-4">
                        <div className="w-16 h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
                            <Search className="h-6 w-6 text-[var(--dashboard-muted)]" />
                        </div>
                        <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Kayıt bulunamadı</p>
                        <p className="text-xs text-[var(--dashboard-muted)]">Filtreleri değiştirmeyi deneyin</p>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto" style={{ maxHeight: '65vh' }}>
                        {filteredRecords.map((record, idx) => {
                            const resolvedAtDate = record.resolvedAt instanceof Date ? record.resolvedAt : new Date(record.resolvedAt);
                            const badge = getSourceBadge(record);
                            const sourceName = record.laboratoryName || record.depotName || '-';
                            const sourceLabel = record.depotId ? 'Depo' : 'Lab';

                            return (
                                <div
                                    key={record.id || idx}
                                    className={cn(
                                        "border-b border-[var(--dashboard-stroke)] last:border-0 hover:bg-[var(--dashboard-surface-2)] transition-colors",
                                        idx % 2 === 0 && "bg-[var(--dashboard-surface)]/50"
                                    )}
                                >
                                    {/* Desktop row */}
                                    <div className="hidden sm:grid grid-cols-[100px_1fr_2fr_1fr_1fr_70px_70px_100px] gap-1 items-center px-4 sm:px-5 py-2.5">
                                        <span className="text-xs text-[var(--dashboard-muted)]">
                                            {resolvedAtDate ? format(resolvedAtDate, 'dd.MM.yy HH:mm', { locale: tr }) : '-'}
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-xs font-medium text-[var(--dashboard-text)] truncate">{sourceName}</p>
                                            <p className="text-[10px] text-[var(--dashboard-muted)]">{sourceLabel}</p>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-medium text-[var(--dashboard-text)] truncate">{record.stokAdi}</p>
                                            <p className="text-[10px] text-[var(--dashboard-muted)] font-mono">{record.stokKodu}</p>
                                        </div>
                                        <div className="min-w-0 space-y-0.5">
                                            {record.lotNumarasi && (
                                                <p className="text-[10px] text-[var(--dashboard-text)]">Lot: {record.lotNumarasi}</p>
                                            )}
                                            {record.seriNumarasi && (
                                                <p className="text-[10px] text-[var(--dashboard-muted)] font-mono truncate">SN: {record.seriNumarasi}</p>
                                            )}
                                            {!record.lotNumarasi && !record.seriNumarasi && (
                                                <span className="text-[10px] text-[var(--dashboard-muted)]">-</span>
                                            )}
                                        </div>
                                        <div>
                                            <span className={cn(
                                                "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium",
                                                badge.className
                                            )}>
                                                {badge.label}
                                            </span>
                                            {record.sourceType === 'fault' && record.deviceModel && (
                                                <p className="text-[10px] text-[var(--dashboard-muted)] mt-0.5 truncate">{record.deviceModel}</p>
                                            )}
                                        </div>
                                        <span className="text-sm font-bold text-right text-[var(--dashboard-accent)]">{record.testCount}</span>
                                        <span className="text-xs text-right text-[var(--dashboard-muted)]">
                                            {record.remainingTests !== undefined ? record.remainingTests : '-'}
                                        </span>
                                        <div className="flex items-center gap-1 min-w-0">
                                            <User className="h-3 w-3 text-[var(--dashboard-muted)] shrink-0" />
                                            <span className="text-[10px] text-[var(--dashboard-text)] truncate">{record.resolvedByName || '-'}</span>
                                        </div>
                                    </div>

                                    {/* Mobile row */}
                                    <div className="sm:hidden px-4 py-3 space-y-2">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-[var(--dashboard-text)] truncate">{record.stokAdi}</p>
                                                <p className="text-[10px] text-[var(--dashboard-muted)] font-mono">{record.stokKodu}</p>
                                            </div>
                                            <span className="text-lg font-bold text-[var(--dashboard-accent)] ml-2">{record.testCount}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium", badge.className)}>
                                                {badge.label}
                                            </span>
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]">
                                                {sourceName}
                                            </span>
                                            {record.lotNumarasi && (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-800">
                                                    Lot: {record.lotNumarasi}
                                                </span>
                                            )}
                                            {record.seriNumarasi && (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800">
                                                    SN: {record.seriNumarasi}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between text-[10px] text-[var(--dashboard-muted)]">
                                            <span>{resolvedAtDate ? format(resolvedAtDate, 'dd.MM.yy HH:mm', { locale: tr }) : '-'}</span>
                                            <span className="flex items-center gap-1">
                                                <User className="h-3 w-3" />
                                                {record.resolvedByName || '-'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
