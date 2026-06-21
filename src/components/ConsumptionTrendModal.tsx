
'use client';
import React, { useState, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Checkbox } from '@/components/ui/checkbox';
import { LabSelector } from '@/components/common/LabSelector';
import { format, subMonths, eachMonthOfInterval, startOfMonth, endOfMonth, isValid, startOfWeek, endOfWeek, eachDayOfInterval, startOfDay, endOfDay, subDays, addDays, subWeeks, addWeeks, subYears, addYears } from 'date-fns';
import { tr } from 'date-fns/locale';
import { X, TrendingUp, ChevronLeft, ChevronRight, FileDown } from 'lucide-react';
import type { ConsumptionRecord, Hospital } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { toDateFromAny } from '@/lib/time';
import { HOME_C, Segmented, ClayIconBtn } from '@/components/dashboard-v2/clay-home';


const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7f50', '#d0ed57', '#ff8042', '#a4de6c', '#d0ed57', '#ffc658'];
// Clay palette for on-screen lab comparison lines (cream-clay tones)
const LAB_COLORS = [HOME_C.accent, HOME_C.sky, HOME_C.waterSolid, HOME_C.violet, HOME_C.amber, HOME_C.skyDeep, HOME_C.violetDeep];

type TrendPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface ConsumptionTrendModalProps {
  isOpen: boolean;
  onClose: () => void;
  consumptionRecords: ConsumptionRecord[];
  hospitals: Hospital[];
  chartData: any[];
  trendPeriod: TrendPeriod;
  setTrendPeriod: (period: TrendPeriod) => void;
  handleTrendNav: (direction: 'prev' | 'next') => void;
  trendTitle: string;
}

function sanitizeForPdfFont(str: string | null | undefined): string {
    if (!str) return '';
    return str
        .replace(/İ/g, 'I').replace(/ı/g, 'i')
        .replace(/Ş/g, 'S').replace(/ş/g, 's')
        .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
        .replace(/Ü/g, 'U').replace(/ü/g, 'u')
        .replace(/Ö/g, 'O').replace(/ö/g, 'o')
        .replace(/Ç/g, 'C').replace(/ç/g, 'c');
}


export default function ConsumptionTrendModal({
  isOpen,
  onClose,
  consumptionRecords,
  hospitals,
  chartData,
  trendPeriod,
  setTrendPeriod,
  handleTrendNav,
  trendTitle,
}: ConsumptionTrendModalProps) {
  const [selectedLabIds, setSelectedLabIds] = useState<string[]>([]);
  const [isReportOptionsOpen, setIsReportOptionsOpen] = useState(false);
  const [reportLabSelection, setReportLabSelection] = useState<string[]>([]);


  const generateConsumptionReportPDF = useCallback(() => {
    const doc = new jsPDF();
    const now = new Date();
    const fourWeeksAgo = subWeeks(now, 4);
    
    const includedLabs = hospitals.filter(h =>
      reportLabSelection.length > 0
        ? reportLabSelection.includes(h.id)
        : h.consumptionTrackingEnabled !== false
    );
      
    const includedLabNames = includedLabs.map(h => h.name);

    const filteredConsumptionRecords = consumptionRecords.filter(record => 
        record.laboratoryName && includedLabNames.includes(record.laboratoryName)
    );

    doc.setFont('helvetica', 'normal');

    // Page 1: Lab-based weekly trend chart
    doc.setFontSize(18);
    doc.text(sanitizeForPdfFont("Laboratuvar Bazlı Haftalık Tüketim Trendi"), 14, 22);
    doc.setFontSize(10);
    doc.text(sanitizeForPdfFont(`(Son 4 Hafta: ${format(startOfWeek(fourWeeksAgo, { weekStartsOn: 1 }), 'dd.MM.yy')} - ${format(now, 'dd.MM.yy')})`), 14, 32);

    const weekRanges = Array.from({ length: 4 }).map((_, i) => {
        const weekStart = startOfWeek(subWeeks(now, 3 - i), { weekStartsOn: 1 });
        return { start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) };
    });

    const weeklyDataByLab: { [labName: string]: number[] } = {};
    filteredConsumptionRecords.forEach(record => {
        const consumptionDate = toDateFromAny(record.consumptionTimestamp);
        if (!consumptionDate || !record.laboratoryName) return;

        if (consumptionDate >= fourWeeksAgo && consumptionDate <= now) {
            if (!weeklyDataByLab[record.laboratoryName]) {
                weeklyDataByLab[record.laboratoryName] = [0, 0, 0, 0];
            }
            const weekIndex = weekRanges.findIndex(range => consumptionDate >= range.start && consumptionDate <= range.end);
            if (weekIndex !== -1) {
                weeklyDataByLab[record.laboratoryName][weekIndex]++;
            }
        }
    });

    const pdfChartData = Object.entries(weeklyDataByLab).filter(([, counts]) => counts.some(c => c > 0));
    const maxVal = Math.max(...pdfChartData.flatMap(([, counts]) => counts), 0);

    const chartX = 20, chartY = 150, chartWidth = 170, chartHeight = 100;
    
    // Draw chart axes
    doc.setDrawColor(200, 200, 200);
    doc.line(chartX, chartY, chartX, chartY - chartHeight); // Y axis
    doc.line(chartX, chartY, chartX + chartWidth, chartY); // X axis
    
    // Draw Y-axis labels and grid lines
    doc.setFontSize(8);
    for (let i = 0; i <= 5; i++) {
        const val = Math.round((maxVal / 5) * i);
        const yPos = chartY - (i / 5) * chartHeight;
        doc.text(String(val), chartX - 5, yPos + 3, { align: 'right' });
        doc.setDrawColor(230, 230, 230);
        doc.line(chartX, yPos, chartX + chartWidth, yPos);
    }
    
    // Draw X-axis labels
    const weekLabels = weekRanges.map(r => format(r.start, 'dd MMM', { locale: tr }));
    weekLabels.forEach((label, i) => {
        doc.text(sanitizeForPdfFont(label), chartX + (i * chartWidth / 3.5), chartY + 10);
    });

    // Draw lines
    pdfChartData.forEach(([labName, counts], labIndex) => {
        const color = COLORS[labIndex % COLORS.length];
        const [r, g, b] = color.match(/\w\w/g)!.map(x => parseInt(x, 16));
        doc.setDrawColor(r,g,b);
        doc.setLineWidth(0.5);

        for (let i = 0; i < counts.length - 1; i++) {
            const x1 = chartX + (i * chartWidth / 3.5);
            const y1 = chartY - (counts[i] / (maxVal > 0 ? maxVal : 1)) * chartHeight;
            const x2 = chartX + ((i + 1) * chartWidth / 3.5);
            const y2 = chartY - (counts[i+1] / (maxVal > 0 ? maxVal : 1)) * chartHeight;
            doc.line(x1, y1, x2, y2);
        }
        
        // Legend
        const legendX = 20;
        const legendY = chartY + 30 + (labIndex * 10);
        doc.setFillColor(r,g,b);
        doc.rect(legendX, legendY, 5, 5, 'F');
        doc.text(sanitizeForPdfFont(labName), legendX + 10, legendY + 4);
    });


    // Page 2: Aggregate trends with line chart
    doc.addPage();
    doc.setFontSize(18);
    doc.text(sanitizeForPdfFont("Toplam Tüketim Trendleri"), 14, 22);

    const totalWeeklyConsumptions = weekRanges.map((_, i) =>
        Object.values(weeklyDataByLab).reduce((sum, counts) => sum + counts[i], 0)
    );
    
    const totalMaxVal = Math.max(...totalWeeklyConsumptions, 0);
    const totalChartY = 130;
    
    // Draw total consumption chart axes and labels
    doc.setDrawColor(200, 200, 200);
    doc.line(chartX, totalChartY, chartX, totalChartY - chartHeight); // Y axis
    doc.line(chartX, totalChartY, chartX + chartWidth, totalChartY); // X axis
    
    doc.setFontSize(8);
    for (let i = 0; i <= 5; i++) {
        const val = Math.round((totalMaxVal / 5) * i);
        const yPos = totalChartY - (i / 5) * chartHeight;
        doc.text(String(val), chartX - 5, yPos + 3, { align: 'right' });
        doc.setDrawColor(230, 230, 230);
        doc.line(chartX, yPos, chartX + chartWidth, yPos);
    }
    
    weekLabels.forEach((label, i) => {
        doc.text(sanitizeForPdfFont(label), chartX + (i * chartWidth / 3.5), totalChartY + 10);
    });
    
    // Draw total consumption line
    const totalColor = COLORS[0];
    const [r, g, b] = totalColor.match(/\w\w/g)!.map(x => parseInt(x, 16));
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.8);
    for (let i = 0; i < totalWeeklyConsumptions.length - 1; i++) {
        const x1 = chartX + (i * chartWidth / 3.5);
        const y1 = totalChartY - (totalWeeklyConsumptions[i] / (totalMaxVal > 0 ? totalMaxVal : 1)) * chartHeight;
        const x2 = chartX + ((i + 1) * chartWidth / 3.5);
        const y2 = totalChartY - (totalWeeklyConsumptions[i + 1] / (totalMaxVal > 0 ? totalMaxVal : 1)) * chartHeight;
        doc.line(x1, y1, x2, y2);
    }
    
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));
    const lastMonthTotal = filteredConsumptionRecords.filter(record => {
        const d = toDateFromAny(record.consumptionTimestamp);
        return d && d >= lastMonthStart && d <= lastMonthEnd;
    }).length;

    (doc as any).autoTable({
        head: [['Dönem', 'Toplam Tüketim']],
        body: [[format(lastMonthStart, 'MMMM yyyy', { locale: tr }), lastMonthTotal.toString()]],
        startY: totalChartY + 20,
        styles: { font: 'helvetica', fontStyle: 'normal' },
    });

    doc.save("tuketim_raporu.pdf");
    setIsReportOptionsOpen(false);
  }, [consumptionRecords, hospitals, reportLabSelection]);

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl h-[90vh] flex flex-col p-0 border-0 gap-0" style={{ background: `linear-gradient(180deg, ${HOME_C.surface} 0%, ${HOME_C.surface2} 100%)`, boxShadow: HOME_C.clay, borderRadius: HOME_C.radiusLg, overflow: 'hidden' }}>
        <DialogHeader className="space-y-0" style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${HOME_C.line}` }}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3" style={{ flexWrap: 'wrap' }}>
            <DialogTitle className="flex items-center gap-3" style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', color: HOME_C.ink1, margin: 0 }}>
              <span style={{ width: 42, height: 42, borderRadius: 13, display: 'grid', placeItems: 'center', color: HOME_C.accent, background: `${HOME_C.accent}16`, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}><TrendingUp size={21} /></span>
              Tüketim Analizi
            </DialogTitle>
            <div className="flex items-center gap-2 sm:ml-auto" style={{ flexWrap: 'wrap' }}>
              <button onClick={() => setIsReportOptionsOpen(true)}
                style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, height: 44, padding: '0 16px', borderRadius: HOME_C.radiusSm, background: `linear-gradient(180deg, ${HOME_C.surfaceHi}, ${HOME_C.surface2})`, boxShadow: HOME_C.clay, color: HOME_C.danger, fontSize: 13.5, fontWeight: 700 }}>
                <FileDown className="h-[17px] w-[17px]" /> PDF Olarak İndir
              </button>
              <Segmented value={trendPeriod} onChange={(v) => setTrendPeriod(v as TrendPeriod)}
                options={[{ v: 'daily', l: 'Günlük' }, { v: 'weekly', l: 'Haftalık' }, { v: 'monthly', l: 'Aylık' }, { v: 'yearly', l: 'Yıllık' }]} />
            </div>
          </div>
          <div className="flex items-center justify-between" style={{ marginTop: 12 }}>
            <DialogDescription style={{ fontSize: 13.5, fontWeight: 600, color: HOME_C.ink2, margin: 0 }}>{trendTitle}</DialogDescription>
            <div className="flex items-center gap-2">
              <ClayIconBtn round onClick={() => handleTrendNav('prev')}><ChevronLeft size={16} /></ClayIconBtn>
              <ClayIconBtn round onClick={() => handleTrendNav('next')}><ChevronRight size={16} /></ClayIconBtn>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-grow grid grid-cols-1 lg:grid-cols-4 gap-4 overflow-hidden" style={{ padding: 20 }}>
          <div className="lg:col-span-3 flex flex-col" style={{ padding: 18, borderRadius: HOME_C.radius, background: HOME_C.surfaceHi, boxShadow: HOME_C.clayFlat, minHeight: 0 }}>
            <div className="flex-grow" style={{ minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="2 6" stroke={HOME_C.line} vertical={false} />
                  <XAxis dataKey="date" stroke={HOME_C.ink3} fontSize={12} fontWeight={600} tickLine={false} axisLine={{ stroke: HOME_C.line }} />
                  <YAxis stroke={HOME_C.ink3} fontSize={12} fontWeight={600} tickLine={false} axisLine={false} width={36} />
                  <Tooltip
                    contentStyle={{ background: `linear-gradient(180deg, ${HOME_C.surfaceHi}, ${HOME_C.surface2})`, border: 'none', borderRadius: HOME_C.radiusSm, boxShadow: HOME_C.clay, fontWeight: 600, color: HOME_C.ink1 }}
                    labelStyle={{ fontWeight: 800, color: HOME_C.accent }}
                    cursor={{ stroke: HOME_C.accent, strokeWidth: 1.2, strokeDasharray: '3 4' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12.5, fontWeight: 700, color: HOME_C.ink2 }} />
                  <Line type="monotone" dataKey="Tüketim" name="Toplam Tüketim" stroke={HOME_C.accent} strokeWidth={3.5} dot={false} activeDot={{ r: 6, fill: HOME_C.accent, stroke: HOME_C.surfaceHi, strokeWidth: 3 }} />
                  {selectedLabIds.map((labId, index) => {
                    const lab = hospitals.find(h => h.id === labId);
                    return (
                      <Line
                        key={labId}
                        type="monotone"
                        dataKey={labId}
                        name={lab?.name || labId}
                        stroke={LAB_COLORS[index % LAB_COLORS.length]}
                        strokeWidth={2.5}
                        dot={false}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-1 flex flex-col" style={{ padding: 18, borderRadius: HOME_C.radius, background: HOME_C.surfaceHi, boxShadow: HOME_C.clayFlat, minHeight: 0, overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 800, color: HOME_C.ink1 }}>Laboratuvarlar</h3>
            <LabSelector
              mode="multi"
              labs={hospitals
                .filter(h => h.consumptionTrackingEnabled !== false)
                .map(l => ({ id: l.id, name: l.name, kod: l.kod }))}
              values={selectedLabIds}
              onValuesChange={setSelectedLabIds}
              placeholder="Karşılaştırılacak laboratuvarları seçin"
              showChips
            />
          </div>
        </div>

        <DialogClose asChild className="absolute right-4 top-4">
          <button style={{ all: 'unset', cursor: 'pointer', width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', color: HOME_C.ink2, background: `linear-gradient(180deg, ${HOME_C.surfaceHi}, ${HOME_C.surface2})`, boxShadow: HOME_C.clayFlat }}>
            <X className="h-[18px] w-[18px]" />
          </button>
        </DialogClose>
      </DialogContent>
    </Dialog>
    
    <Dialog open={isReportOptionsOpen} onOpenChange={setIsReportOptionsOpen}>
        <DialogContent className="border-0" style={{ background: `linear-gradient(180deg, ${HOME_C.surface} 0%, ${HOME_C.surface2} 100%)`, boxShadow: HOME_C.clay, borderRadius: HOME_C.radiusLg }}>
          <DialogHeader>
            <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 11, fontSize: 18, fontWeight: 800, color: HOME_C.ink1 }}>
              <span style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', color: HOME_C.danger, background: 'rgba(192,121,106,0.12)', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}><FileDown size={18} /></span>
              Rapor için Laboratuvar Seçimi
            </DialogTitle>
            <DialogDescription style={{ fontSize: 13, color: HOME_C.ink2, fontWeight: 500, marginTop: 4 }}>
              PDF raporuna dahil edilecek laboratuvarları seçin. Hiçbir seçim yapılmazsa, otomatik tüketim takibi kapalı olan tüm laboratuvarlar dahil edilir.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <LabSelector
              mode="multi"
              labs={hospitals
                .filter(h => h.consumptionTrackingEnabled !== false)
                .map(l => ({ id: l.id, name: l.name, kod: l.kod }))}
              values={reportLabSelection}
              onValuesChange={setReportLabSelection}
              placeholder="Tüm laboratuvarlar dahil"
              showChips
            />
          </div>
          <DialogFooter>
            <button onClick={() => setIsReportOptionsOpen(false)}
              style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', height: 44, padding: '0 18px', borderRadius: HOME_C.radiusSm, background: HOME_C.surface2, boxShadow: HOME_C.clayInset, color: HOME_C.ink2, fontSize: 14, fontWeight: 700 }}>İptal</button>
            <button onClick={generateConsumptionReportPDF}
              style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, height: 44, padding: '0 20px', borderRadius: HOME_C.radiusSm, background: `linear-gradient(180deg, ${HOME_C.accent2}, ${HOME_C.accent})`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 20px -9px ${HOME_C.accentGlow}`, color: '#fff', fontSize: 14, fontWeight: 800 }}>
              <FileDown className="h-4 w-4" /> Rapor Oluştur
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
