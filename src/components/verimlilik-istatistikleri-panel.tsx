/**
 * @fileoverview Verimlilik İstatistikleri (Efficiency Statistics) Panel
 * @description Provides comprehensive efficiency statistics and analytics for
 * laboratory kit usage. Displays top performers, underperformers, waste analysis,
 * and trend visualization.
 * @module components/verimlilik-istatistikleri-panel
 * @version 1.0.0
 *
 * @features
 * - Period-based efficiency filtering
 * - Top 5 most efficient laboratories
 * - Top 5 least efficient laboratories
 * - Top 5 waste-generating products
 * - Control/Calibration ratio analysis
 * - Laboratory efficiency trend charts
 * - Deviation analysis over 6 months
 *
 * @accessibility
 * - ARIA labels for charts and tables
 * - Screen reader compatible statistics
 * - Keyboard navigable filters
 */

'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { verimlilikIstatistikLogger } from '@/lib/logger';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Award, TrendingDown, PackageX, Activity } from 'lucide-react';
import { format, subMonths, eachMonthOfInterval, startOfMonth } from 'date-fns';
import { tr } from 'date-fns/locale';

interface Row {
    productId: string;
    productName: string;
    kitEffPct: number;
    anaTuketimTestAdeti?: number;
    unknownLoss?: number;
    control?: number;
    calib?: number;
    total?: number;
}
interface HistoryRecord {
    id: string;
    hospitalId: string;
    hospitalName: string;
    month: number;
    year: number;
    rows: Row[];
}
interface Hospital {
    id: string;
    name: string;
}

interface Props {
    hospitals: Hospital[];
    efficiencyHistoryRecords: HistoryRecord[];
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(2000, i).toLocaleString('tr-TR', { month: 'long' }),
}));

function calculateWeightedEfficiency(rows: Row[]): number {
    if (!rows || rows.length === 0) return 0;
    const { totalWeightedEfficiency, totalConsumption } = rows.reduce(
        (acc, row) => {
            const anaTuketim = (row.anaTuketimTestAdeti ?? 0);
            if (anaTuketim > 0) {
               acc.totalWeightedEfficiency += (row.kitEffPct || 0) * anaTuketim;
               acc.totalConsumption += anaTuketim;
            }
            return acc;
        },
        { totalWeightedEfficiency: 0, totalConsumption: 0 }
    );
    const efficiency = totalConsumption > 0 ? totalWeightedEfficiency / totalConsumption : 0;
    return Math.max(0, efficiency);
}


export default function VerimlilikIstatistikleriPanel({ hospitals, efficiencyHistoryRecords }: Props) {
    const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
    const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);
    const [selectedLabId, setSelectedLabId] = useState<string>('all');

    const periodData = useMemo(() => {
        return efficiencyHistoryRecords
            .filter(r => r.month === selectedMonth && r.year === selectedYear)
            .map(record => ({
                labId: record.hospitalId,
                labName: record.hospitalName,
                efficiency: calculateWeightedEfficiency(record.rows),
                totalWaste: record.rows.reduce((sum, row) => sum + (row.unknownLoss || 0), 0),
                totalCalibControl: record.rows.reduce((sum, row) => sum + (row.calib || 0) + (row.control || 0), 0),
                totalTestHacmi: record.rows.reduce((sum, row) => sum + (row.total || 0), 0),
                products: record.rows,
            }));
    }, [efficiencyHistoryRecords, selectedMonth, selectedYear]);

    const top5Efficient = useMemo(() => [...periodData].sort((a, b) => b.efficiency - a.efficiency).slice(0, 5), [periodData]);
    const top5Inefficient = useMemo(() => [...periodData].sort((a, b) => a.efficiency - b.efficiency).slice(0, 5), [periodData]);
    
    const top5WasteProducts = useMemo(() => {
        const productWaste: Record<string, { name: string; waste: number; labName: string; }> = {};
        periodData.forEach(labData => {
            labData.products.forEach(p => {
                if(!productWaste[p.productId] || (p.unknownLoss || 0) > productWaste[p.productId].waste) {
                    productWaste[p.productId] = {
                        name: p.productName,
                        waste: p.unknownLoss || 0,
                        labName: labData.labName
                    };
                }
            });
        });
        return Object.values(productWaste).sort((a, b) => b.waste - a.waste).slice(0, 5);
    }, [periodData]);

    const top5ControlCalibRatio = useMemo(() => {
        const testRatios: { name: string; ratio: number }[] = [];
        periodData.forEach(labData => {
            labData.products.forEach(p => {
                if (p.total && p.total > 0) {
                    const ratio = ((p.control || 0) + (p.calib || 0)) / p.total;
                    testRatios.push({ name: p.productName, ratio });
                }
            });
        });
        return testRatios.sort((a, b) => b.ratio - a.ratio).slice(0, 5);
    }, [periodData]);

    const labTrendData = useMemo(() => {
        if (selectedLabId === 'all') return [];
        const now = new Date();
        const intervals = eachMonthOfInterval({ start: subMonths(now, 11), end: now });
        return intervals.map(monthStart => {
            const month = monthStart.getMonth();
            const year = monthStart.getFullYear();
            const record = efficiencyHistoryRecords.find(r => r.hospitalId === selectedLabId && r.month === month && r.year === year);
            return {
                name: format(monthStart, 'MMM yy', { locale: tr }),
                Verimlilik: record ? calculateWeightedEfficiency(record.rows) : null,
            };
        });
    }, [efficiencyHistoryRecords, selectedLabId]);
    
    const labDeviationData = useMemo(() => {
        const last6MonthsStart = startOfMonth(subMonths(new Date(), 5));
        const labStats: Record<string, { efficiencies: number[], name: string }> = {};

        efficiencyHistoryRecords.forEach(record => {
            const recordDate = new Date(record.year, record.month);
            if (recordDate >= last6MonthsStart) {
                if (!labStats[record.hospitalId]) {
                    labStats[record.hospitalId] = { efficiencies: [], name: record.hospitalName };
                }
                labStats[record.hospitalId].efficiencies.push(calculateWeightedEfficiency(record.rows));
            }
        });

        return Object.values(labStats)
            .map(stats => {
                if (stats.efficiencies.length < 2) return null;
                const avg = stats.efficiencies.reduce((a, b) => a + b, 0) / stats.efficiencies.length;
                const stdDev = Math.sqrt(stats.efficiencies.map(x => Math.pow(x - avg, 2)).reduce((a, b) => a + b, 0) / stats.efficiencies.length);
                return { name: stats.name, stdDev };
            })
            .filter(Boolean)
            .sort((a, b) => b!.stdDev - a!.stdDev)
            .slice(0, 5);
    }, [efficiencyHistoryRecords]);

    return (
        <div className="space-y-6" role="main" aria-label="Verimlilik istatistikleri paneli">
            <Card role="region" aria-label="Dönem seçimi">
                <CardHeader>
                    <CardTitle id="stats-title">Verimlilik İstatistikleri</CardTitle>
                    <CardDescription>Dönem ve laboratuvar bazında verimlilik analizleri.</CardDescription>
                </CardHeader>
                <CardContent className="flex gap-4">
                    <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(Number(v))}>
                        <SelectTrigger className="w-[180px]" aria-label="Ay seçin"><SelectValue /></SelectTrigger>
                        <SelectContent role="listbox">{MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)} role="option">{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
                        <SelectTrigger className="w-[120px]" aria-label="Yıl seçin"><SelectValue /></SelectTrigger>
                        <SelectContent role="listbox">{YEARS.map(y => <SelectItem key={y} value={String(y)} role="option">{y}</SelectItem>)}</SelectContent>
                    </Select>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" role="region" aria-label="Verimlilik sıralamaları">
                <Card role="region" aria-label="En verimli laboratuvarlar"><CardHeader><CardTitle className="flex items-center gap-2"><Award aria-hidden="true" />En Verimli 5 Laboratuvar</CardTitle></CardHeader><CardContent><StatTable data={top5Efficient} valueKey="efficiency" valueSuffix="%" /></CardContent></Card>
                <Card role="region" aria-label="En verimsiz laboratuvarlar"><CardHeader><CardTitle className="flex items-center gap-2"><TrendingDown aria-hidden="true" />En Verimsiz 5 Laboratuvar</CardTitle></CardHeader><CardContent><StatTable data={top5Inefficient.reverse()} valueKey="efficiency" valueSuffix="%" /></CardContent></Card>
                <Card role="region" aria-label="En çok fire veren ürünler"><CardHeader><CardTitle className="flex items-center gap-2"><PackageX aria-hidden="true" />En Çok Fire Veren 5 Ürün</CardTitle></CardHeader><CardContent><StatTable data={top5WasteProducts} valueKey="waste" subLabelKey="labName" /></CardContent></Card>
                <Card role="region" aria-label="Kontrol kalibrasyon oranları"><CardHeader><CardTitle className="flex items-center gap-2"><Activity aria-hidden="true" />En Çok Kontrol/Kalibrasyon Harcayan Testler</CardTitle></CardHeader><CardContent><StatTable data={top5ControlCalibRatio} valueKey="ratio" valueFormatter={v => `${(v * 100).toFixed(1)}%`} /></CardContent></Card>
            </div>

            <Card role="region" aria-label="Verimlilik trend grafiği">
                <CardHeader>
                    <CardTitle id="trend-title">Laboratuvar Verimlilik Trendi</CardTitle>
                    <Select value={selectedLabId} onValueChange={setSelectedLabId}>
                        <SelectTrigger className="w-[280px] mt-2" aria-label="Trend için laboratuvar seçin"><SelectValue placeholder="Laboratuvar Seç..." /></SelectTrigger>
                        <SelectContent role="listbox"><SelectItem value="all" role="option">Tüm Laboratuvarlar</SelectItem>{hospitals.map(h => <SelectItem key={h.id} value={h.id} role="option">{h.name}</SelectItem>)}</SelectContent>
                    </Select>
                </CardHeader>
                <CardContent className="h-72" aria-label="12 aylık verimlilik trend grafiği">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={labTrendData} aria-label="Verimlilik trend çizgi grafiği">
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis domain={[0, 100]} />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="Verimlilik" stroke="#8884d8" activeDot={{ r: 8 }} connectNulls />
                        </LineChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            <Card role="region" aria-label="Sapma analizi">
                <CardHeader><CardTitle id="deviation-title">Son 6 Ayda En Çok Sapma Gösteren Laboratuvarlar</CardTitle></CardHeader>
                <CardContent>
                    <StatTable data={labDeviationData} valueKey="stdDev" valueFormatter={v => `±${v.toFixed(2)}`} />
                </CardContent>
            </Card>
        </div>
    );
}

const StatTable: React.FC<{data: any[], valueKey: string, subLabelKey?: string, valueSuffix?: string, valueFormatter?: (v: number) => string}> = ({data, valueKey, subLabelKey, valueSuffix, valueFormatter}) => (
    <Table>
        <TableBody>
            {data.map((item, index) => (
                <TableRow key={index}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    {subLabelKey && <TableCell className="text-muted-foreground">{item[subLabelKey]}</TableCell>}
                    <TableCell className="text-right font-semibold">
                        {valueFormatter ? valueFormatter(item[valueKey]) : `${item[valueKey]?.toFixed(1)}${valueSuffix || ''}`}
                    </TableCell>
                </TableRow>
            ))}
        </TableBody>
    </Table>
);

    