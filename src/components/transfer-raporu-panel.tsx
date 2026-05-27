'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { exportDataToExcel } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { LabSelector } from '@/components/common/LabSelector';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeftRight,
  Loader2,
  FileSpreadsheet,
  LineChart,
  Search,
  X,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface FilterOptions {
  depots: { id: string; name: string }[];
  laboratories: { id: string; name: string }[];
  brands: string[];
  productGroups: string[];
  products: { stokKodu: string; stokAdi: string }[];
}

interface ProductTransferSummary {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  urunGrubu: string;
  totalTransferred: number;
  monthlyAverage: number;
  last3MonthsAverage: number;
  monthlyData: { month: string; count: number }[];
}

interface ReportMeta {
  totalProducts: number;
  totalTransfers: number;
  sourceDepotId: string;
  targetLabIds: string[];
  dateRange: { start: string | null; end: string | null };
  filters: {
    marka: string | null;
    urunGrubu: string | null;
    stokKodu: string | null;
  };
}

const URUN_GRUBU_LABELS: Record<string, string> = {
  kit: 'Kit',
  sarf: 'Sarf',
  yedek_parca: 'Yedek Parca',
};

export default function TransferRaporuPanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  // Filter options from API
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);

  // Selected filters
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [selectedLabIds, setSelectedLabIds] = useState<string[]>([]);
  const [selectedMarka, setSelectedMarka] = useState<string>('__all__');
  const [selectedUrunGrubu, setSelectedUrunGrubu] = useState<string>('__all__');
  const [selectedStokKodu, setSelectedStokKodu] = useState<string>('__all__');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Report data
  const [reportData, setReportData] = useState<ProductTransferSummary[]>([]);
  const [reportMeta, setReportMeta] = useState<ReportMeta | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Chart modal
  const [chartModalOpen, setChartModalOpen] = useState(false);
  const [selectedProductForChart, setSelectedProductForChart] = useState<ProductTransferSummary | null>(null);

  // Product search for filter
  const [productSearchQuery, setProductSearchQuery] = useState('');

  // Fetch filter options on mount
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const response = await fetch('/api/raporlama/transfer-raporu');
        const result = await response.json();
        if (result.success) {
          setFilterOptions(result.data);
        } else {
          throw new Error(result.error);
        }
      } catch (error: any) {
        console.error('Filter options error:', error);
        toast({
          title: 'Hata',
          description: 'Filtre secenekleri yuklenirken bir hata olustu.',
          variant: 'destructive',
        });
      } finally {
        setIsLoadingOptions(false);
      }
    };
    fetchOptions();
  }, [toast]);

  // Filtered products for dropdown
  const filteredProducts = useMemo(() => {
    if (!filterOptions) return [];
    if (!productSearchQuery) return filterOptions.products.slice(0, 50);
    const query = productSearchQuery.toLowerCase();
    return filterOptions.products
      .filter(
        p => p.stokKodu.toLowerCase().includes(query) ||
          p.stokAdi.toLowerCase().includes(query)
      )
      .slice(0, 50);
  }, [filterOptions, productSearchQuery]);

  // Generate report
  const handleGenerateReport = async () => {
    if (!selectedDepotId) {
      toast({
        title: 'Depo Secin',
        description: 'Lutfen bir kaynak depo secin.',
        variant: 'destructive',
      });
      return;
    }

    if (selectedLabIds.length === 0) {
      toast({
        title: 'Laboratuvar Secin',
        description: 'Lutfen en az bir laboratuvar secin.',
        variant: 'destructive',
      });
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch('/api/raporlama/transfer-raporu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceDepotId: selectedDepotId,
          targetLabIds: selectedLabIds,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          marka: selectedMarka === '__all__' ? undefined : selectedMarka,
          urunGrubu: selectedUrunGrubu === '__all__' ? undefined : selectedUrunGrubu,
          stokKodu: selectedStokKodu === '__all__' ? undefined : selectedStokKodu,
          companyId: currentCompanyId,
          isSuperAdmin,
        }),
      });

      const result = await response.json();
      if (result.success) {
        setReportData(result.data);
        setReportMeta(result.meta);
        setHasGenerated(true);
        toast({
          title: 'Rapor Olusturuldu',
          description: `${result.data.length} urun icin transfer raporu olusturuldu.`,
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      console.error('Report generation error:', error);
      toast({
        title: 'Hata',
        description: error.message || 'Rapor olusturulurken bir hata olustu.',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Export to Excel
  const handleExport = () => {
    if (reportData.length === 0) {
      toast({
        title: 'Veri Yok',
        description: 'Disa aktarilacak veri bulunamadi.',
        variant: 'default',
      });
      return;
    }

    const dataToExport = reportData.map(r => ({
      'Stok Kodu': r.stokKodu,
      'Stok Adi': r.stokAdi,
      'Marka': r.marka,
      'Urun Grubu': URUN_GRUBU_LABELS[r.urunGrubu] || r.urunGrubu,
      'Toplam Transfer': r.totalTransferred,
      'Aylik Ortalama': r.monthlyAverage,
      'Son 3 Ay Ortalamasi': r.last3MonthsAverage,
    }));

    exportDataToExcel(dataToExport, 'Transfer_Raporu', 'TransferRaporu', toast);
  };

  // Open chart modal
  const openChartModal = (product: ProductTransferSummary) => {
    setSelectedProductForChart(product);
    setChartModalOpen(true);
  };

  // Format month label for chart
  const formatMonthLabel = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return format(date, 'MMM yy', { locale: tr });
  };

  // Get selected depot name
  const selectedDepotName = useMemo(() => {
    if (!filterOptions || !selectedDepotId) return '';
    return filterOptions.depots.find(d => d.id === selectedDepotId)?.name || '';
  }, [filterOptions, selectedDepotId]);

  if (isLoadingOptions) {
    return (
      <Card className="shadow-lg">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin mr-2" />
          <span>Filtre secenekleri yukleniyor...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-headline flex items-center">
            <ArrowLeftRight className="mr-2 h-6 w-6 text-primary" />
            Transfer Raporu
          </CardTitle>
          <CardDescription>
            Depodan laboratuvarlara yapilan transferlerin urun bazli analizini goruntuler.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters Section */}
          <div className="space-y-4 mb-6">
            {/* Row 1: Depo and Labs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Depo Selection */}
              <div className="space-y-2">
                <Label htmlFor="depot-select">Kaynak Depo *</Label>
                <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
                  <SelectTrigger id="depot-select">
                    <SelectValue placeholder="Depo secin..." />
                  </SelectTrigger>
                  <SelectContent>
                    {filterOptions?.depots.map(depot => (
                      <SelectItem key={depot.id} value={depot.id}>
                        {depot.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Lab Selection */}
              <LabSelector
                mode="multi"
                label="Hedef Laboratuvarlar *"
                labs={(filterOptions?.laboratories ?? []).map(l => ({ id: l.id, name: l.name }))}
                values={selectedLabIds}
                onValuesChange={setSelectedLabIds}
                placeholder="Laboratuvar secin..."
                showChips
              />
            </div>

            {/* Row 2: Date Range */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-date">Baslangic Tarihi (Opsiyonel)</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-date">Bitis Tarihi (Opsiyonel)</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                />
              </div>
            </div>

            {/* Row 3: Optional Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="marka-select">Marka (Opsiyonel)</Label>
                <Select value={selectedMarka} onValueChange={setSelectedMarka}>
                  <SelectTrigger id="marka-select">
                    <SelectValue placeholder="Tum markalar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Tum markalar</SelectItem>
                    {filterOptions?.brands.map(brand => (
                      <SelectItem key={brand} value={brand}>
                        {brand}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="urun-grubu-select">Urun Grubu (Opsiyonel)</Label>
                <Select value={selectedUrunGrubu} onValueChange={setSelectedUrunGrubu}>
                  <SelectTrigger id="urun-grubu-select">
                    <SelectValue placeholder="Tum gruplar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Tum gruplar</SelectItem>
                    {filterOptions?.productGroups.map(group => (
                      <SelectItem key={group} value={group}>
                        {URUN_GRUBU_LABELS[group] || group}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="product-select">Spesifik Urun (Opsiyonel)</Label>
                <Select value={selectedStokKodu} onValueChange={setSelectedStokKodu}>
                  <SelectTrigger id="product-select">
                    <SelectValue placeholder="Tum urunler" />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="p-2">
                      <Input
                        placeholder="Urun ara..."
                        value={productSearchQuery}
                        onChange={e => setProductSearchQuery(e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <SelectItem value="__all__">Tum urunler</SelectItem>
                    {filteredProducts.map(product => (
                      <SelectItem key={product.stokKodu} value={product.stokKodu}>
                        {product.stokKodu} - {product.stokAdi}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Generate Button */}
            <div className="flex justify-end gap-2">
              <Button
                onClick={handleGenerateReport}
                disabled={isGenerating || !selectedDepotId || selectedLabIds.length === 0}
              >
                {isGenerating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Raporu Goster
              </Button>
            </div>
          </div>

          {/* Report Summary */}
          {hasGenerated && reportMeta && (
            <div className="mb-4 p-4 bg-muted rounded-lg">
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Kaynak Depo:</span>{' '}
                  <strong>{selectedDepotName}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Hedef Lab:</span>{' '}
                  <strong>{reportMeta.targetLabIds.length} laboratuvar</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Toplam Urun:</span>{' '}
                  <strong>{reportMeta.totalProducts}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Toplam Transfer:</span>{' '}
                  <strong>{reportMeta.totalTransfers}</strong>
                </div>
                {reportMeta.dateRange.start && (
                  <div>
                    <span className="text-muted-foreground">Tarih Araligi:</span>{' '}
                    <strong>
                      {format(new Date(reportMeta.dateRange.start), 'dd.MM.yyyy')}
                      {reportMeta.dateRange.end && ` - ${format(new Date(reportMeta.dateRange.end), 'dd.MM.yyyy')}`}
                    </strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Export Button */}
          {hasGenerated && reportData.length > 0 && (
            <div className="flex justify-end mb-4">
              <Button onClick={handleExport} variant="outline" size="sm">
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel'e Disa Aktar
              </Button>
            </div>
          )}

          {/* Results Table */}
          {hasGenerated && (
            <ScrollArea className="h-[500px] border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stok Kodu</TableHead>
                    <TableHead>Stok Adi</TableHead>
                    <TableHead>Marka</TableHead>
                    <TableHead>Urun Grubu</TableHead>
                    <TableHead className="text-right">Toplam Transfer</TableHead>
                    <TableHead className="text-right">Aylik Ort.</TableHead>
                    <TableHead className="text-right">Son 3 Ay Ort.</TableHead>
                    <TableHead className="text-center">Grafik</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        Belirlenen kriterlere uygun transfer bulunamadi.
                      </TableCell>
                    </TableRow>
                  ) : (
                    reportData.map(row => (
                      <TableRow key={row.stokKodu}>
                        <TableCell className="font-mono text-sm">{row.stokKodu}</TableCell>
                        <TableCell>{row.stokAdi}</TableCell>
                        <TableCell>{row.marka}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {URUN_GRUBU_LABELS[row.urunGrubu] || row.urunGrubu}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {row.totalTransferred}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.monthlyAverage.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.last3MonthsAverage.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openChartModal(row)}
                          >
                            <LineChart className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Chart Modal */}
      <Dialog open={chartModalOpen} onOpenChange={setChartModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <LineChart className="mr-2 h-5 w-5" />
              Son 6 Ay Transfer Grafigi
            </DialogTitle>
            {selectedProductForChart && (
              <DialogDescription>
                {selectedProductForChart.stokKodu} - {selectedProductForChart.stokAdi}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="h-80 w-full">
            {selectedProductForChart && (
              <ResponsiveContainer width="100%" height="100%">
                <RechartsLineChart
                  data={selectedProductForChart.monthlyData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="month"
                    tickFormatter={formatMonthLabel}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    labelFormatter={formatMonthLabel}
                    formatter={(value: number) => [value, 'Transfer Adedi']}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </RechartsLineChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="text-sm text-muted-foreground text-center">
            {selectedProductForChart && (
              <>
                Toplam: <strong>{selectedProductForChart.totalTransferred}</strong> |
                Aylik Ortalama: <strong>{selectedProductForChart.monthlyAverage.toFixed(1)}</strong> |
                Son 3 Ay Ortalamasi: <strong>{selectedProductForChart.last3MonthsAverage.toFixed(1)}</strong>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
