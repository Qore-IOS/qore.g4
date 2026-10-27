'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../lib/data/client';
import { collection, getDocs, orderBy, query, Timestamp } from '../lib/data/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/document-helpers';
import { Loader2, FileSpreadsheet, FileText, Search, X, History, User, ArrowUpDown, ArrowUp, ArrowDown, Filter, Check } from 'lucide-react';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import type { DateRange } from 'react-day-picker';
import { addDays, format, startOfDay, endOfDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { DestroyedKitRecord, Hospital } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { exportDataToExcel, cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LabSelector } from '@/components/common/LabSelector';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

/* ─── Sorting types ─── */
type SortKey = 'tarih' | 'kaynak' | 'urun' | 'lot' | 'giris' | 'adet' | 'kalan' | 'onaylayan';
type SortDir = 'asc' | 'desc';

/* ─── Column filter state: Set of selected values (empty = all selected) ─── */
type ColumnFilterKey = 'kaynak' | 'urun' | 'giris' | 'onaylayan';
type ColumnFiltersState = Record<ColumnFilterKey, Set<string>>;

export default function ImhaEdilenKitlerListePanel() {
    const { toast } = useToast();
    const { currentCompanyId, isSuperAdmin } = useAuth();
    const [records, setRecords] = useState<DestroyedKitRecord[]>([]);
    const [hospitals, setHospitals] = useState<Hospital[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: startOfDay(addDays(new Date(), -30)),
        to: endOfDay(new Date()),
    });
    const [labFilter, setLabFilter] = useState<string>('all');
    const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('all');

    /* ─── Sorting state ─── */
    const [sortKey, setSortKey] = useState<SortKey>('tarih');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    /* ─── Column filters (empty Set = no filter / all shown) ─── */
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>({
        kaynak: new Set(), urun: new Set(), giris: new Set(), onaylayan: new Set(),
    });

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [recordsSnap, labsSnap] = await Promise.all([
                    getDocs(scopedQuery('destroyedKitsReports', currentCompanyId, isSuperAdmin, orderBy('resolvedAt', 'desc'))),
                    getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin))
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

    /* ─── Helper: extract column value for a record ─── */
    const getColValue = useCallback((r: DestroyedKitRecord, key: ColumnFilterKey): string => {
        switch (key) {
            case 'kaynak': return r.laboratoryName || r.depotName || '-';
            case 'urun': return r.stokAdi || '-';
            case 'giris': return r.sourceType === 'fault' ? 'Arıza' : r.sourceType === 'excel' ? 'Excel' : 'Barkod';
            case 'onaylayan': return r.resolvedByName || '-';
        }
    }, []);

    /* ─── Pre-filter records (date + lab + sourceType only) for unique value extraction ─── */
    const preFilteredRecords = useMemo(() => {
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

    /* ─── Unique values per column (for Excel-style checkbox list) ─── */
    const uniqueValues = useMemo(() => {
        const result: Record<ColumnFilterKey, string[]> = { kaynak: [], urun: [], giris: [], onaylayan: [] };
        const sets: Record<ColumnFilterKey, Set<string>> = { kaynak: new Set(), urun: new Set(), giris: new Set(), onaylayan: new Set() };
        for (const r of preFilteredRecords) {
            for (const key of ['kaynak', 'urun', 'giris', 'onaylayan'] as ColumnFilterKey[]) {
                sets[key].add(getColValue(r, key));
            }
        }
        for (const key of ['kaynak', 'urun', 'giris', 'onaylayan'] as ColumnFilterKey[]) {
            result[key] = Array.from(sets[key]).sort((a, b) => a.localeCompare(b, 'tr'));
        }
        return result;
    }, [preFilteredRecords, getColValue]);

    const filteredAndSortedRecords = useMemo(() => {
        // Step 1: start from pre-filtered (date + lab + sourceType)
        let result = [...preFilteredRecords];

        // Step 2: column checkbox filters (empty set = all)
        const cf = columnFilters;
        for (const key of ['kaynak', 'urun', 'giris', 'onaylayan'] as ColumnFilterKey[]) {
            if (cf[key].size > 0) {
                result = result.filter(r => cf[key].has(getColValue(r, key)));
            }
        }

        // Step 3: sort
        const dir = sortDir === 'asc' ? 1 : -1;
        result.sort((a, b) => {
            switch (sortKey) {
                case 'tarih': {
                    const da = a.resolvedAt instanceof Date ? a.resolvedAt.getTime() : new Date(a.resolvedAt).getTime();
                    const db2 = b.resolvedAt instanceof Date ? b.resolvedAt.getTime() : new Date(b.resolvedAt).getTime();
                    return (da - db2) * dir;
                }
                case 'kaynak':
                    return ((a.laboratoryName || a.depotName || '').localeCompare(b.laboratoryName || b.depotName || '', 'tr')) * dir;
                case 'urun':
                    return (a.stokAdi.localeCompare(b.stokAdi, 'tr')) * dir;
                case 'lot':
                    return ((a.lotNumarasi || '').localeCompare(b.lotNumarasi || '', 'tr')) * dir;
                case 'giris': {
                    const sa = a.sourceType || '';
                    const sb = b.sourceType || '';
                    return sa.localeCompare(sb, 'tr') * dir;
                }
                case 'adet':
                    return (a.testCount - b.testCount) * dir;
                case 'kalan':
                    return ((a.remainingTests ?? 0) - (b.remainingTests ?? 0)) * dir;
                case 'onaylayan':
                    return ((a.resolvedByName || '').localeCompare(b.resolvedByName || '', 'tr')) * dir;
                default:
                    return 0;
            }
        });

        return result;
    }, [preFilteredRecords, columnFilters, sortKey, sortDir, getColValue]);

    const totalCount = filteredAndSortedRecords.reduce((sum, r) => sum + r.testCount, 0);

    const hasActiveFilters = labFilter !== 'all' || sourceTypeFilter !== 'all';
    const hasColumnFilters = Object.values(columnFilters).some(s => s.size > 0);

    const clearFilters = () => {
        setLabFilter('all');
        setSourceTypeFilter('all');
        setDateRange({
            from: startOfDay(addDays(new Date(), -30)),
            to: endOfDay(new Date()),
        });
        setColumnFilters({ kaynak: new Set(), urun: new Set(), giris: new Set(), onaylayan: new Set() });
    };

    /* ─── Toggle sort ─── */
    const toggleSort = useCallback((key: SortKey) => {
        if (key === sortKey) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir(key === 'tarih' ? 'desc' : 'asc');
        }
    }, [sortKey]);

    /* ─── Sort icon ─── */
    const SortIcon = ({ col }: { col: SortKey }) => {
        if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
        return sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
    };

    /* ─── Excel-style column filter popover with checkbox list ─── */
    const ColumnFilterPopover = ({ colKey, label }: { colKey: ColumnFilterKey; label: string }) => {
        const selected = columnFilters[colKey];
        const allValues = uniqueValues[colKey];
        const [search, setSearch] = useState('');
        const isActive = selected.size > 0;

        const filtered = search
            ? allValues.filter(v => v.toLowerCase().includes(search.toLowerCase()))
            : allValues;

        const toggleValue = (val: string) => {
            setColumnFilters(prev => {
                const next = new Set(prev[colKey]);
                if (next.has(val)) {
                    next.delete(val);
                } else {
                    next.add(val);
                }
                return { ...prev, [colKey]: next };
            });
        };

        const selectAll = () => {
            setColumnFilters(prev => ({ ...prev, [colKey]: new Set() }));
        };

        const selectNone = () => {
            // When "none" is pressed, keep only filtered items as selected (invert logic)
            setColumnFilters(prev => ({ ...prev, [colKey]: new Set(allValues) }));
        };

        const selectOnlyFiltered = () => {
            setColumnFilters(prev => ({ ...prev, [colKey]: new Set(filtered) }));
        };

        return (
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        className={cn(
                            "p-1 rounded-md hover:bg-[var(--dashboard-surface)] transition-colors",
                            isActive ? "text-[var(--dashboard-accent)] bg-[var(--dashboard-accent)]/10" : "text-[var(--dashboard-muted)]"
                        )}
                        onClick={e => e.stopPropagation()}
                    >
                        <Filter className="h-3 w-3" />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0" align="start" side="bottom" sideOffset={4}>
                    {/* Header */}
                    <div className="px-3 pt-3 pb-2 border-b border-[var(--dashboard-stroke)]">
                        <p className="text-[10px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wide mb-2">{label}</p>
                        <Input
                            placeholder="Ara..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="h-7 text-xs"
                            autoFocus
                        />
                    </div>

                    {/* Select all / clear */}
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--dashboard-stroke)]">
                        <button onClick={selectAll} className="text-[10px] font-medium text-[var(--dashboard-accent)] hover:underline">
                            Tümünü Seç
                        </button>
                        <span className="text-[var(--dashboard-stroke)]">|</span>
                        <button onClick={selectOnlyFiltered} className="text-[10px] font-medium text-[var(--dashboard-accent)] hover:underline">
                            Sadece Bunları
                        </button>
                        <span className="text-[var(--dashboard-stroke)]">|</span>
                        <button onClick={selectNone} className="text-[10px] font-medium text-[var(--dashboard-muted)] hover:underline">
                            Temizle
                        </button>
                    </div>

                    {/* Checkbox list */}
                    <div className="max-h-48 overflow-y-auto py-1">
                        {filtered.length === 0 ? (
                            <p className="text-xs text-[var(--dashboard-muted)] px-3 py-2 text-center">Sonuç yok</p>
                        ) : (
                            filtered.map(val => {
                                // If no filter active (empty set) → all are checked
                                // If filter active → only items IN the set are checked
                                const isChecked = selected.size === 0 || selected.has(val);
                                return (
                                    <button
                                        key={val}
                                        onClick={() => {
                                            if (selected.size === 0) {
                                                // First click when "all selected": select only this one
                                                setColumnFilters(prev => ({ ...prev, [colKey]: new Set([val]) }));
                                            } else {
                                                toggleValue(val);
                                            }
                                        }}
                                        className={cn(
                                            "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--dashboard-surface-2)] transition-colors",
                                            isChecked && "font-medium"
                                        )}
                                    >
                                        <span className={cn(
                                            "flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                                            isChecked
                                                ? "bg-[var(--dashboard-accent)] border-[var(--dashboard-accent)]"
                                                : "border-[var(--dashboard-stroke)] bg-transparent"
                                        )}>
                                            {isChecked && <Check className="h-3 w-3 text-white" />}
                                        </span>
                                        <span className="truncate text-[var(--dashboard-text)]">{val}</span>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {/* Footer: count */}
                    {isActive && (
                        <div className="px-3 py-1.5 border-t border-[var(--dashboard-stroke)] text-[10px] text-[var(--dashboard-muted)]">
                            {selected.size} / {allValues.length} seçili
                        </div>
                    )}
                </PopoverContent>
            </Popover>
        );
    };

    /* ─── Sortable header cell ─── */
    const SortableHeader = ({ col, label, align, filterKey }: {
        col: SortKey; label: string; align?: string;
        filterKey?: ColumnFilterKey;
    }) => (
        <span className={cn("flex items-center gap-1.5 select-none", align)}>
            <button
                onClick={() => toggleSort(col)}
                className={cn(
                    "flex items-center gap-1 px-1 py-0.5 rounded hover:bg-[var(--dashboard-surface)] transition-colors cursor-pointer",
                    sortKey === col && "text-[var(--dashboard-text)] font-bold"
                )}
            >
                {label}
                <SortIcon col={col} />
            </button>
            {filterKey && (
                <ColumnFilterPopover colKey={filterKey} label={label} />
            )}
        </span>
    );

    const handleExport = () => {
        if (filteredAndSortedRecords.length === 0) {
            toast({ title: 'Veri Yok', description: 'Dışa aktarılacak kayıt bulunmuyor.', variant: 'default' });
            return;
        }
        const dataToExport = filteredAndSortedRecords.map(r => {
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

    /* ─── PDF Export (same template as Riskli Stok Raporu) ─── */
    const handlePdfExport = async () => {
        if (filteredAndSortedRecords.length === 0) {
            toast({ title: 'Veri Yok', description: 'PDF oluşturulacak kayıt bulunmuyor.', variant: 'default' });
            return;
        }

        try {
            const [jsPDFModule, autoTableModule] = await Promise.all([
                import('jspdf'),
                import('jspdf-autotable')
            ]);
            const jsPDF = jsPDFModule.default;
            const autoTable = autoTableModule.default;
            const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
            const pageW = doc.internal.pageSize.getWidth();
            const pageH = doc.internal.pageSize.getHeight();
            const padX = 40;
            const ORANGE: [number, number, number] = [199, 137, 65];
            const FONT = 'helvetica';

            const san = (str: string | null | undefined): string => {
                if (!str) return '';
                return str
                    .replace(/İ/g, 'I').replace(/ı/g, 'i')
                    .replace(/Ş/g, 'S').replace(/ş/g, 's')
                    .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
                    .replace(/Ü/g, 'U').replace(/ü/g, 'u')
                    .replace(/Ö/g, 'O').replace(/ö/g, 'o')
                    .replace(/Ç/g, 'C').replace(/ç/g, 'c');
            };

            const loadImageAsDataUrl = async (candidates: string[]): Promise<string | null> => {
                for (const path of candidates) {
                    try {
                        const response = await fetch(path);
                        if (!response.ok) continue;
                        const blob = await response.blob();
                        const reader = new FileReader();
                        const dataUrl = await new Promise<string | null>((resolve) => {
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.onerror = () => resolve(null);
                            reader.readAsDataURL(blob);
                        });
                        if (dataUrl) return dataUrl;
                    } catch {
                        // try next
                    }
                }
                return null;
            };

            const [logoLeft, logoRight] = await Promise.all([
                loadImageAsDataUrl(['/blk.png']),
                loadImageAsDataUrl(['/invlogo.png', '/QORE-INV_LOGO.PNG', '/invitrolab_LOGO__-_Kopya__1_-removebg.png']),
            ]);

            const totalTestCount = filteredAndSortedRecords.reduce((sum, r) => sum + r.testCount, 0);
            const headerH = 78;

            // Date range label for subtitle
            const dateLabel = dateRange?.from && dateRange?.to
                ? `${format(dateRange.from, 'dd.MM.yyyy', { locale: tr })} - ${format(dateRange.to, 'dd.MM.yyyy', { locale: tr })}`
                : san('Tum Zamanlar');

            const drawFrameAndHeader = () => {
                // Orange border
                doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2]);
                doc.setLineWidth(2);
                doc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);

                // Title
                doc.setFont(FONT, 'bold');
                doc.setFontSize(26);
                doc.setTextColor(17, 24, 39);
                doc.text(san('IMHA EDILEN KITLER RAPORU'), pageW / 2, padX / 2 + 28, { align: 'center' });

                // Subtitle (date range)
                doc.setFontSize(14);
                doc.setFont(FONT, 'bold');
                doc.setTextColor(71, 85, 105);
                doc.text(dateLabel, pageW / 2, padX / 2 + 48, { align: 'center' });

                // Total count badge
                const summaryY = padX / 2 + 66;
                doc.setFillColor(254, 243, 199);
                const summaryText = san(`Toplam: ${filteredAndSortedRecords.length} kayit / ${totalTestCount} adet`);
                const tw = doc.getTextWidth(summaryText);
                const badgePadH = 14;
                const badgePadV = 5;
                doc.roundedRect(pageW / 2 - tw / 2 - badgePadH, summaryY - 9, tw + badgePadH * 2, 14 + badgePadV, 4, 4, 'F');
                doc.setFont(FONT, 'bold');
                doc.setFontSize(10);
                doc.setTextColor(146, 64, 14);
                doc.text(summaryText, pageW / 2, summaryY, { align: 'center' });

                // Timestamp
                doc.setFont(FONT, 'normal');
                doc.setFontSize(8);
                doc.setTextColor(148, 163, 184);
                doc.text(new Date().toLocaleString('tr-TR'), pageW - padX / 2 - 6, padX / 2 + 14, { align: 'right' });
            };

            autoTable(doc, {
                head: [[
                    san('TARIH'),
                    san('KAYNAK'),
                    san('URUN'),
                    san('LOT / SERI'),
                    san('GIRIS'),
                    san('ADET'),
                    san('KALAN'),
                    san('ONAYLAYAN'),
                ]],
                body: filteredAndSortedRecords.map((r) => {
                    const resolvedAtDate = r.resolvedAt instanceof Date ? r.resolvedAt : new Date(r.resolvedAt);
                    const sourceLabel = r.sourceType === 'fault' ? 'Ariza' : r.sourceType === 'excel' ? 'Excel' : 'Barkod';
                    return [
                        resolvedAtDate ? format(resolvedAtDate, 'dd.MM.yy HH:mm', { locale: tr }) : '-',
                        `${san(r.laboratoryName || r.depotName || '-')}\n${san(r.depotId ? 'Depo' : 'Lab')}`,
                        `${san(r.stokAdi)}\n(${san(r.stokKodu)})`,
                        `${san(r.lotNumarasi || '-')}\n${san(r.seriNumarasi ? `SN: ${r.seriNumarasi}` : '')}`,
                        san(sourceLabel),
                        `${r.testCount}`,
                        r.remainingTests !== undefined ? `${r.remainingTests}` : '-',
                        san(r.resolvedByName || '-'),
                    ];
                }),
                startY: padX / 2 + headerH,
                theme: 'grid',
                styles: {
                    font: FONT,
                    fontSize: 8,
                    cellPadding: { top: 4, right: 5, bottom: 4, left: 5 },
                    textColor: [15, 23, 42],
                    valign: 'middle',
                    lineColor: [226, 232, 240],
                    lineWidth: 0.5,
                },
                headStyles: {
                    fillColor: [241, 245, 249],
                    textColor: [71, 85, 105],
                    fontStyle: 'bold',
                    fontSize: 8,
                    cellPadding: { top: 4, right: 5, bottom: 4, left: 5 },
                },
                margin: { top: padX / 2 + headerH, left: padX / 2 + 8, right: padX / 2 + 8, bottom: 72 },
                columnStyles: {
                    0: { cellWidth: 80 },                      // Tarih
                    1: { cellWidth: 110 },                     // Kaynak
                    2: { cellWidth: 200 },                     // Ürün
                    3: { cellWidth: 120 },                     // Lot / Seri
                    4: { cellWidth: 60, halign: 'center' },    // Giriş
                    5: { cellWidth: 50, halign: 'center' },    // Adet
                    6: { cellWidth: 50, halign: 'center' },    // Kalan
                    7: { cellWidth: 110 },                     // Onaylayan
                },
                didParseCell: (hookData) => {
                    if (hookData.section !== 'body') return;

                    // Alternating row background
                    const rowBg: [number, number, number] = hookData.row.index % 2 === 0
                        ? [255, 255, 255] : [248, 250, 252];
                    hookData.cell.styles.fillColor = rowBg;

                    // Col 5: ADET — accent style
                    if (hookData.column.index === 5) {
                        hookData.cell.styles.textColor = [194, 65, 12]; // orange-700
                        hookData.cell.styles.fontStyle = 'bold';
                    }

                    // Col 4: Giriş — badge-like coloring
                    if (hookData.column.index === 4) {
                        const r = filteredAndSortedRecords[hookData.row.index];
                        if (r?.sourceType === 'fault') {
                            hookData.cell.styles.fillColor = [254, 226, 226]; // red-100
                            hookData.cell.styles.textColor = [153, 27, 27];   // red-800
                        } else if (r?.sourceType === 'excel') {
                            hookData.cell.styles.fillColor = [254, 243, 199]; // amber-100
                            hookData.cell.styles.textColor = [146, 64, 14];   // amber-800
                        } else {
                            hookData.cell.styles.fillColor = [219, 234, 254]; // blue-100
                            hookData.cell.styles.textColor = [30, 64, 175];   // blue-800
                        }
                        hookData.cell.styles.fontStyle = 'bold';
                    }
                },
                didDrawPage: () => {
                    drawFrameAndHeader();
                },
            });

            // Footer logos on last page
            const totalPages = doc.getNumberOfPages();
            doc.setPage(totalPages);

            const logoH = 30;
            const blkW = 30;
            const invW = 80;
            const dividerGap = 16;
            const centerX = pageW / 2;
            const logoY = pageH - padX / 2 - logoH - 10;

            const leftLogoX = centerX - dividerGap / 2 - blkW;
            const rightLogoX = centerX + dividerGap / 2;

            doc.setDrawColor(148, 163, 184);
            doc.setLineWidth(1);
            doc.line(centerX, logoY - 4, centerX, logoY + logoH + 4);

            if (logoLeft) doc.addImage(logoLeft, 'PNG', leftLogoX, logoY, blkW, logoH, undefined, 'FAST');
            if (logoRight) doc.addImage(logoRight, 'PNG', rightLogoX, logoY, invW, logoH, undefined, 'FAST');

            doc.save('Imha_Edilen_Kitler_Raporu.pdf');
            toast({ title: 'Başarılı', description: 'İmha edilen kitler PDF raporu oluşturuldu.' });
        } catch {
            toast({ title: 'Hata', description: 'PDF raporu oluşturulamadı.', variant: 'destructive' });
        }
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
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={handlePdfExport}
                        disabled={filteredAndSortedRecords.length === 0}
                        className="cihaz-tool-item flex items-center gap-1.5 px-3 py-2 text-xs font-medium disabled:opacity-40"
                        title="PDF olarak indir"
                    >
                        <FileText className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">PDF</span>
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={filteredAndSortedRecords.length === 0}
                        className="cihaz-tool-item flex items-center gap-1.5 px-3 py-2 text-xs font-medium disabled:opacity-40"
                    >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Excel&apos;e Aktar</span>
                    </button>
                </div>
            </div>

            {/* ══════════════════════ FILTER CARD ══════════════════════ */}
            <div className="cihaz-card p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                    <p className="cihaz-overline text-[10px] sm:text-xs">Filtreler</p>
                    {(hasActiveFilters || hasColumnFilters) && (
                        <button onClick={clearFilters} className="text-[10px] text-[var(--dashboard-accent)] font-medium flex items-center gap-1 hover:underline">
                            <X className="h-3 w-3" /> Temizle
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Date Range */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Tarih Aralığı</label>
                        <DatePickerWithRange date={dateRange} setDate={setDateRange} className="w-full" showAllOption />
                    </div>

                    {/* Laboratory */}
                    <LabSelector
                        label="Laboratuvar"
                        labs={hospitals.map(h => ({ id: h.id, name: h.name, kod: h.kod }))}
                        value={labFilter}
                        onChange={setLabFilter}
                        placeholder="Laboratuvar"
                        allOption={{ value: 'all', label: 'Tümü' }}
                    />

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
                    {dateRange?.from && dateRange?.to ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]">
                            {format(dateRange.from, 'dd MMM', { locale: tr })} – {format(dateRange.to, 'dd MMM yyyy', { locale: tr })}
                        </span>
                    ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            Tüm Zamanlar
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
                    {hasColumnFilters && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                            Sütun Filtresi Aktif
                        </span>
                    )}
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--dashboard-accent)]/10 text-[var(--dashboard-accent)]">
                        {filteredAndSortedRecords.length} kayıt · {totalCount} adet
                    </span>
                </div>
            </div>

            {/* ══════════════════════ DATA TABLE ══════════════════════ */}
            <div className="cihaz-card-strong flex-1 flex flex-col overflow-hidden">
                {/* Table header - desktop with sort & filter */}
                {filteredAndSortedRecords.length > 0 && (
                    <div className="hidden sm:grid grid-cols-[100px_1fr_2fr_1fr_1fr_70px_70px_100px] gap-1 px-4 sm:px-5 py-2.5 text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)]">
                        <SortableHeader col="tarih" label="Tarih" />
                        <SortableHeader col="kaynak" label="Kaynak" filterKey="kaynak" />
                        <SortableHeader col="urun" label="Ürün" filterKey="urun" />
                        <SortableHeader col="lot" label="Lot / Seri" />
                        <SortableHeader col="giris" label="Giriş" filterKey="giris" />
                        <SortableHeader col="adet" label="Adet" align="justify-end" />
                        <SortableHeader col="kalan" label="Kalan" align="justify-end" />
                        <SortableHeader col="onaylayan" label="Onaylayan" filterKey="onaylayan" />
                    </div>
                )}

                {/* Loading */}
                {loading ? (
                    <div className="flex items-center justify-center h-[50vh]">
                        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
                    </div>
                ) : filteredAndSortedRecords.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[40vh] text-center px-4">
                        <div className="w-16 h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
                            <Search className="h-6 w-6 text-[var(--dashboard-muted)]" />
                        </div>
                        <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Kayıt bulunamadı</p>
                        <p className="text-xs text-[var(--dashboard-muted)]">Filtreleri değiştirmeyi deneyin</p>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto" style={{ maxHeight: '65vh' }}>
                        {filteredAndSortedRecords.map((record, idx) => {
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
