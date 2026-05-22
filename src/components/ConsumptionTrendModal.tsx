
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


const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7f50', '#d0ed57', '#ff8042', '#a4de6c', '#d0ed57', '#ffc658'];

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
      <DialogContent className="max-w-7xl h-[90vh] flex flex-col p-0 glass-card">
        <DialogHeader className="p-6 pb-2 border-b border-white/10">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
            <DialogTitle className="text-2xl font-headline text-gradient-primary flex items-center gap-2">
              <TrendingUp/> Aylık Tüketim Analizi
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button onClick={() => setIsReportOptionsOpen(true)} variant="outline" size="sm">
                  <FileDown className="h-4 w-4 mr-2"/> PDF Olarak İndir
              </Button>
              <Tabs value={trendPeriod} onValueChange={(v) => setTrendPeriod(v as TrendPeriod)} className="w-full sm:w-auto">
                <TabsList>
                  <TabsTrigger value="daily">Günlük</TabsTrigger>
                  <TabsTrigger value="weekly">Haftalık</TabsTrigger>
                  <TabsTrigger value="monthly">Aylık</TabsTrigger>
                  <TabsTrigger value="yearly">Yıllık</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
           <div className="flex items-center justify-between mt-2">
             <DialogDescription>{trendTitle}</DialogDescription>
             <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => handleTrendNav('prev')}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => handleTrendNav('next')}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
             </div>
          </div>
        </DialogHeader>
        
        <div className="flex-grow grid grid-cols-1 lg:grid-cols-4 gap-6 px-6 pb-6 overflow-hidden">
          <Card className="lg:col-span-3 flex flex-col glass-card">
            <CardContent className="flex-grow p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--background)/0.8)', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)' }}
                    labelStyle={{ fontWeight: 'bold' }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="Tüketim" name="Toplam Tüketim" stroke="hsl(var(--primary))" strokeWidth={3} dot={false} />
                  {selectedLabIds.map((labId, index) => {
                    const lab = hospitals.find(h => h.id === labId);
                    return (
                      <Line
                        key={labId}
                        type="monotone"
                        dataKey={labId}
                        name={lab?.name || labId}
                        stroke={COLORS[index % COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="lg:col-span-1 glass-card">
            <CardHeader><CardTitle className="text-lg">Laboratuvarlar</CardTitle></CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </div>

        <DialogClose asChild className="absolute right-4 top-4">
            <Button variant="ghost" size="icon">
                <X className="h-5 w-5" />
            </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
    
    <Dialog open={isReportOptionsOpen} onOpenChange={setIsReportOptionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rapor için Laboratuvar Seçimi</DialogTitle>
            <DialogDescription>
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
            <Button variant="outline" onClick={() => setIsReportOptionsOpen(false)}>İptal</Button>
            <Button onClick={generateConsumptionReportPDF}>
                <FileDown className="h-4 w-4 mr-2"/> Rapor Oluştur
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
