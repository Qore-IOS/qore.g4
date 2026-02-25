
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { DeviceFaultReport, DeviceFaultStatus } from '@/lib/types';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  Trash2,
  FileDown,
  FileSpreadsheet,
  Clock,
  UserPlus,
  Phone,
  Wrench,
  Building2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import BackButton from '@/components/BackButton';
import { format, differenceInMinutes } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/auth-context';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import PageShell from '@/components/responsive/PageShell.server';
import { exportDataToExcel, exportDataToPdf } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';

type AiKnowledgeDoc = {
  id: string;
  name: string;
  type: 'txt' | 'pdf' | string;
  active: boolean;
  charCount: number;
  updatedAt: string | null;
};

// Status tab değerleri
type StatusTab = 'all' | 'atama_bekliyor' | 'mudahale_bekliyor' | 'mudahale_ediliyor' | 'cozuldu';

// Status etiketleri ve renkleri
const STATUS_CONFIG: Record<DeviceFaultStatus, { label: string; variant: 'destructive' | 'default' | 'secondary' | 'outline'; icon: React.ReactNode; className?: string }> = {
  'atama_bekliyor': {
    label: 'Atama Bekliyor',
    variant: 'destructive',
    icon: <UserPlus className="h-3 w-3" />,
    className: 'bg-red-600/15 text-red-700 dark:text-red-400 border-red-600/20',
  },
  'mudahale_bekliyor': {
    label: 'Müdahale Bekliyor',
    variant: 'default',
    icon: <Clock className="h-3 w-3" />,
    className: 'bg-amber-600/15 text-amber-700 dark:text-amber-400 border-amber-600/20',
  },
  'mudahale_ediliyor': {
    label: 'Müdahale Ediliyor',
    variant: 'default',
    icon: <Wrench className="h-3 w-3" />,
    className: 'bg-blue-600/15 text-blue-700 dark:text-blue-400 border-blue-600/20',
  },
  'cozuldu': {
    label: 'Çözüldü',
    variant: 'secondary',
    icon: <CheckCircle className="h-3 w-3" />,
    className: 'bg-green-600/10 text-green-700 dark:text-green-400 border border-green-600/20',
  },
  // Legacy status'lar
  'open': {
    label: 'Açık',
    variant: 'destructive',
    icon: <AlertTriangle className="h-3 w-3" />,
    className: '',
  },
  'closed': {
    label: 'Giderildi',
    variant: 'secondary',
    icon: <CheckCircle className="h-3 w-3" />,
    className: 'bg-green-600/10 text-green-700 dark:text-green-400 border border-green-600/20',
  },
};

// Normalleştirilmiş status - legacy değerler için
function normalizeStatus(status: string): DeviceFaultStatus {
  if (status === 'open') return 'atama_bekliyor';
  if (status === 'closed') return 'cozuldu';
  return status as DeviceFaultStatus;
}

export default function ArizaYonetimiPage() {
  const [reports, setReports] = useState<DeviceFaultReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const { isAdmin } = useAuth();

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  // Yeni 5 sekmeli filtre sistemi
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [labFilter, setLabFilter] = useState<string>('all');
  const [deviceFilter, setDeviceFilter] = useState<string>('all');
  const [openerFilter, setOpenerFilter] = useState<string>('all');

  // Server'dan gelen veriler
  const [statusCounts, setStatusCounts] = useState({
    all: 0,
    atama_bekliyor: 0,
    mudahale_bekliyor: 0,
    mudahale_ediliyor: 0,
    cozuldu: 0,
  });
  const [uniqueLabs, setUniqueLabs] = useState<string[]>([]);
  const [uniqueDevices, setUniqueDevices] = useState<string[]>([]);
  const [uniqueOpeners, setUniqueOpeners] = useState<string[]>([]);

  const [aiDocs, setAiDocs] = useState<AiKnowledgeDoc[]>([]);
  const [aiDocFile, setAiDocFile] = useState<File | null>(null);
  const [aiDocsLoading, setAiDocsLoading] = useState(false);
  const [aiDocUploading, setAiDocUploading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  // API'den veri çekme
  const fetchReports = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({
        status: statusTab,
        lab: labFilter,
        device: deviceFilter,
        opener: openerFilter,
        page: currentPage.toString(),
        limit: rowsPerPage.toString(),
      });

      const response = await fetch(`/api/ariza-yonetimi?${params}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Veri alınamadı');
      }

      // Tarihleri Date objelerine çevir
      const reportList: DeviceFaultReport[] = result.data.map((r: any) => ({
        ...r,
        openedAt: r.openedAt ? new Date(r.openedAt) : null,
        closedAt: r.closedAt ? new Date(r.closedAt) : null,
        assignedAt: r.assignedAt ? new Date(r.assignedAt) : null,
        interventionStartedAt: r.interventionStartedAt ? new Date(r.interventionStartedAt) : null,
      }));

      setReports(reportList);
      setStatusCounts(result.statusCounts);
      setTotalPages(result.pagination.totalPages);
      setUniqueLabs(result.filterOptions.labs);
      setUniqueDevices(result.filterOptions.devices);
      setUniqueOpeners(result.filterOptions.openers);
    } catch (error: any) {
      console.error('Error fetching fault reports:', error);
      toast({
        title: 'Hata',
        description: error.message || 'Arıza geçmişi yüklenemedi.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusTab, labFilter, deviceFilter, openerFilter, currentPage, rowsPerPage, toast]);

  // İlk yükleme ve filtre değişikliklerinde veri çek
  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    fetchAiDocs();
  }, [fetchAiDocs]);

  // Filtre değiştiğinde sayfa 1'e dön
  useEffect(() => {
    setCurrentPage(1);
  }, [statusTab, labFilter, deviceFilter, openerFilter, rowsPerPage]);

  // Artık client-side filtreleme yok, API zaten filtrelenmiş veri döndürüyor
  const paginatedReports = reports;

  const handleDeleteReport = async (reportId: string) => {
    try {
      const response = await fetch(`/api/ariza-yonetimi?id=${reportId}`, {
        method: 'DELETE',
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Silme işlemi başarısız');
      }

      toast({ title: 'Başarılı', description: `Arıza kaydı #${reportId.substring(0, 6)}... silindi.` });
      // Listeyi yenile
      fetchReports(true);
    } catch (error: any) {
      console.error("Error deleting fault report:", error);
      toast({ title: 'Hata', description: error.message || 'Arıza kaydı silinemedi.', variant: 'destructive' });
    }
  };

  const handleOpenHtmlReport = () => {
    window.open('/ariza-yonetimi/html', '_blank');
  };

  const getExportData = () => {
    return reports.map(r => {
      const normalized = normalizeStatus(r.status);
      const statusConfig = STATUS_CONFIG[normalized];

      // Süreleri dakika cinsine çevir
      const atamaSuresiDk = r.atamaBekmeSuresi ? Math.round(r.atamaBekmeSuresi / 60000) : null;
      const mudahaleSuresiDk = r.mudahaleBekmeSuresi ? Math.round(r.mudahaleBekmeSuresi / 60000) : null;
      const cozumSuresiDk = r.cozumSuresi ? Math.round(r.cozumSuresi / 60000) : null;
      const toplamSureDk = r.toplamCozumSuresi ? Math.round(r.toplamCozumSuresi / 60000) : null;

      // Müdahale tipi etiketleri
      const mudahaleTipiLabel = r.interventionType === 'telefon' ? 'Telefonla' :
                               r.interventionType === 'kurum_ziyaret' ? 'Konumda (Kurum Ziyareti)' : '';

      // Arıza tipi etiketleri
      const arizaTipiLabel = r.faultType === 'teknik_servis' ? 'Teknik Servis' :
                            r.faultType === 'aplikasyon' ? 'Aplikasyon' : r.faultType || '';

      return {
        'Rapor ID': r.id,
        'Durum': statusConfig?.label || r.status,
        'Laboratuvar': r.labName || '',
        'Cihaz Modeli': r.title || r.model || '',
        'Seri Numarası': r.serial || '',
        'Arıza Tipi': arizaTipiLabel,
        'Arıza Açıklaması': r.description || '',
        'Açan Personel': r.openedByName || '',
        'Açılış Tarihi': r.openedAt ? format(r.openedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '',
        'Atanan Personel': r.assignedToName || '',
        'Atanma Tarihi': r.assignedAt ? format(r.assignedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '',
        'Müdahale Türü': mudahaleTipiLabel,
        'Müdahale Başlangıç': r.interventionStartedAt ? format(r.interventionStartedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '',
        'Kapatan Personel': r.closedByName || '',
        'Kapanış Tarihi': r.closedAt ? format(r.closedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '',
        'Kapanış Açıklaması': r.closeDescription || '',
        'Atama Bekleme Süresi (dk)': atamaSuresiDk ?? '',
        'Müdahale Bekleme Süresi (dk)': mudahaleSuresiDk ?? '',
        'Çözüm Süresi (dk)': cozumSuresiDk ?? '',
        'Toplam Süre (dk)': toplamSureDk ?? '',
        'İlişkili Testler': r.relatedTests?.join(', ') || '',
      };
    });
  };

  const handleExportToExcel = () => {
    if (reports.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak arıza kaydı bulunmuyor.', variant: 'default' });
      return;
    }
    const dataToExport = getExportData();
    exportDataToExcel(dataToExport, 'Tum_Ariza_Kayitlari', 'Arızalar', toast);
    setExportModalOpen(false);
  };


  const fetchAiDocs = useCallback(async () => {
    setAiDocsLoading(true);
    try {
      const res = await fetch('/api/ariza-yonetimi/ai-dokumanlar');
      const payload = await res.json();
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'AI dokümanları alınamadı.');
      }
      setAiDocs(payload.data || []);
    } catch (error: any) {
      console.error(error);
      toast({ title: 'Hata', description: error?.message || 'AI dokümanları alınamadı.', variant: 'destructive' });
    } finally {
      setAiDocsLoading(false);
    }
  }, [toast]);

  const handleUploadAiDoc = useCallback(async () => {
    if (!aiDocFile) {
      toast({ title: 'Eksik Dosya', description: 'Lütfen .txt veya .pdf dosyası seçin.', variant: 'destructive' });
      return;
    }

    setAiDocUploading(true);
    try {
      const form = new FormData();
      form.append('file', aiDocFile);
      const res = await fetch('/api/ariza-yonetimi/ai-dokumanlar', {
        method: 'POST',
        body: form,
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Doküman yüklenemedi.');
      }
      toast({ title: 'Başarılı', description: 'AI dokümanı yüklendi.' });
      setAiDocFile(null);
      await fetchAiDocs();
    } catch (error: any) {
      toast({ title: 'Hata', description: error?.message || 'Doküman yüklenemedi.', variant: 'destructive' });
    } finally {
      setAiDocUploading(false);
    }
  }, [aiDocFile, fetchAiDocs, toast]);

  const handleDeleteAiDoc = useCallback(async (id: string) => {
    setDeletingDocId(id);
    try {
      const res = await fetch(`/api/ariza-yonetimi/ai-dokumanlar?id=${id}`, {
        method: 'DELETE',
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Doküman silinemedi.');
      }
      toast({ title: 'Başarılı', description: 'Doküman silindi.' });
      await fetchAiDocs();
    } catch (error: any) {
      toast({ title: 'Hata', description: error?.message || 'Doküman silinemedi.', variant: 'destructive' });
    } finally {
      setDeletingDocId(null);
    }
  }, [fetchAiDocs, toast]);

  useEffect(() => {
    fetchAiDocs();
  }, [fetchAiDocs]);

  const handleExportToPdf = async () => {
    if (reports.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak arıza kaydı bulunmuyor.', variant: 'default' });
      return;
    }
    setExportLoading(true);
    try {
      const dataToExport = getExportData();
      await exportDataToPdf(dataToExport, 'Tum_Ariza_Kayitlari', 'Tüm Arıza Kayıtları', toast);
      setExportModalOpen(false);
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <PageShell>
      <div className="device-module-page space-y-4">
        <BackButton fallback="/cihaz-yonetimi-ana" />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Öneri Bilgi Dokümanları</CardTitle>
            <CardDescription>
              AI öneri motoru bu panelden yüklenen dokümanları global bağlam olarak kullanır. Arıza ID ekranında tekrar yükleme gerekmez.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="file"
                accept=".txt,.pdf,text/plain,application/pdf"
                onChange={(e) => setAiDocFile(e.target.files?.[0] || null)}
              />
              <Button onClick={handleUploadAiDoc} disabled={aiDocUploading || !aiDocFile}>
                {aiDocUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Doküman Yükle
              </Button>
            </div>

            {aiDocsLoading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Dokümanlar yükleniyor...
              </div>
            ) : aiDocs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Henüz AI dokümanı yüklenmedi.</p>
            ) : (
              <div className="space-y-2">
                {aiDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <div>
                      <p className="font-medium">{doc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.type.toUpperCase()} • {doc.charCount.toLocaleString('tr-TR')} karakter
                        {doc.updatedAt ? ` • ${format(new Date(doc.updatedAt), 'dd.MM.yyyy HH:mm', { locale: tr })}` : ''}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteAiDoc(doc.id)} disabled={deletingDocId === doc.id}>
                      {deletingDocId === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
              <div>
                  <CardTitle className="flex items-center gap-2">
                      <ShieldAlert className="h-6 w-6 text-primary" /> Tüm Arıza Kayıtları
                  </CardTitle>
                  <CardDescription>
                      Sistemdeki tüm açık ve kapalı cihaz arıza kayıtlarının listesi.
                  </CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => fetchReports(true)}
                  disabled={refreshing}
                  title="Yenile"
                >
                  <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                </Button>
                <Button variant="outline" onClick={() => router.push('/ariza-yonetimi/diger-firma-gecmisi')}>
                  <Building2 className="h-4 w-4 mr-2" /> Diğer Firma Geçmişi
                </Button>
                <Button variant="secondary" onClick={() => setExportModalOpen(true)}>
                  <FileDown className="h-4 w-4 mr-2" /> Döküm Al
                </Button>
                <Button variant="secondary" onClick={handleOpenHtmlReport}>
                  <FileDown className="h-4 w-4 mr-2" /> HTML Raporu
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Yeni 5 Sekmeli Filtre */}
            <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as StatusTab)} className="mb-4">
              <TabsList className="grid w-full grid-cols-5 h-auto">
                <TabsTrigger value="all" className="flex flex-col gap-0.5 py-2">
                  <span className="text-xs">Tümü</span>
                  <span className="text-lg font-bold">{statusCounts.all}</span>
                </TabsTrigger>
                <TabsTrigger value="atama_bekliyor" className="flex flex-col gap-0.5 py-2 data-[state=active]:bg-red-600/10 data-[state=active]:text-red-700 dark:data-[state=active]:text-red-400">
                  <span className="text-xs flex items-center gap-1"><UserPlus className="h-3 w-3" /> Atama Bekleyen</span>
                  <span className="text-lg font-bold">{statusCounts.atama_bekliyor}</span>
                </TabsTrigger>
                <TabsTrigger value="mudahale_bekliyor" className="flex flex-col gap-0.5 py-2 data-[state=active]:bg-amber-600/10 data-[state=active]:text-amber-700 dark:data-[state=active]:text-amber-400">
                  <span className="text-xs flex items-center gap-1"><Clock className="h-3 w-3" /> Müd. Bekleyen</span>
                  <span className="text-lg font-bold">{statusCounts.mudahale_bekliyor}</span>
                </TabsTrigger>
                <TabsTrigger value="mudahale_ediliyor" className="flex flex-col gap-0.5 py-2 data-[state=active]:bg-blue-600/10 data-[state=active]:text-blue-700 dark:data-[state=active]:text-blue-400">
                  <span className="text-xs flex items-center gap-1"><Wrench className="h-3 w-3" /> Müd. Edilen</span>
                  <span className="text-lg font-bold">{statusCounts.mudahale_ediliyor}</span>
                </TabsTrigger>
                <TabsTrigger value="cozuldu" className="flex flex-col gap-0.5 py-2 data-[state=active]:bg-green-600/10 data-[state=active]:text-green-700 dark:data-[state=active]:text-green-400">
                  <span className="text-xs flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Çözülen</span>
                  <span className="text-lg font-bold">{statusCounts.cozuldu}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <div className='q-table' data-mobile-mode="stack">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Durum</TableHead>
                      <TableHead>
                        <Select value={labFilter} onValueChange={setLabFilter}>
                            <SelectTrigger className="border-none p-0 h-auto font-semibold [&>svg]:ml-1 w-full bg-transparent focus:ring-0 focus:ring-offset-0">
                              <SelectValue/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Laboratuvar (Tümü)</SelectItem>
                                {uniqueLabs.map(lab => <SelectItem key={lab} value={lab}>{lab}</SelectItem>)}
                            </SelectContent>
                        </Select>
                      </TableHead>
                      <TableHead>
                        <Select value={deviceFilter} onValueChange={setDeviceFilter}>
                            <SelectTrigger className="border-none p-0 h-auto font-semibold [&>svg]:ml-1 w-full bg-transparent focus:ring-0 focus:ring-offset-0">
                              <SelectValue/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Cihaz (Tümü)</SelectItem>
                                {uniqueDevices.map(deviceSerial => <SelectItem key={deviceSerial} value={deviceSerial}>{deviceSerial}</SelectItem>)}
                            </SelectContent>
                        </Select>
                      </TableHead>
                      <TableHead>
                        <Select value={openerFilter} onValueChange={setOpenerFilter}>
                            <SelectTrigger className="border-none p-0 h-auto font-semibold [&>svg]:ml-1 w-full bg-transparent focus:ring-0 focus:ring-offset-0">
                              <SelectValue/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Açan (Tümü)</SelectItem>
                                {uniqueOpeners.map(opener => <SelectItem key={opener} value={opener}>{opener}</SelectItem>)}
                            </SelectContent>
                        </Select>
                      </TableHead>
                      <TableHead>Açılış</TableHead>
                      <TableHead>Kapanış</TableHead>
                      <TableHead>Çözüm Süresi</TableHead>
                      {isAdmin && <TableHead className="text-right">İşlemler</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedReports.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isAdmin ? 8 : 7} className="h-24 text-center">
                          Arıza kaydı bulunamadı.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedReports.map((report) => (
                        <TableRow
                          key={report.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => router.push(`/ariza-yonetimi/${report.id}`)}
                        >
                          <TableCell data-label="Durum">
                            {(() => {
                              const normalized = normalizeStatus(report.status);
                              const config = STATUS_CONFIG[normalized];
                              return (
                                <Badge variant={config.variant} className={`flex items-center gap-1 ${config.className}`}>
                                  {config.icon} {config.label}
                                </Badge>
                              );
                            })()}
                          </TableCell>
                          <TableCell data-label="Laboratuvar">{report.labName}</TableCell>
                          <TableCell data-label="Cihaz">
                            <div className="font-medium">{report.model}</div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {report.serial}
                            </div>
                          </TableCell>
                          <TableCell data-label="Açan">{report.openedByName}</TableCell>
                          <TableCell data-label="Açılış" className="text-xs">
                            {report.openedAt
                              ? format(report.openedAt, 'dd.MM.yy HH:mm', { locale: tr })
                              : '-'}
                          </TableCell>
                          <TableCell data-label="Kapanış" className="text-xs">
                            {report.closedAt
                              ? format(report.closedAt, 'dd.MM.yy HH:mm', { locale: tr })
                              : '-'}
                          </TableCell>
                          <TableCell data-label="Çözüm Süresi" className="text-xs">
                            {(() => {
                              const normalized = normalizeStatus(report.status);
                              if (normalized === 'cozuldu' && report.toplamCozumSuresi) {
                                const minutes = Math.round(report.toplamCozumSuresi / 60000);
                                return `${minutes} dk`;
                              }
                              if (normalized === 'cozuldu' && report.openedAt && report.closedAt) {
                                return `${differenceInMinutes(report.closedAt, report.openedAt)} dk`;
                              }
                              return '-';
                            })()}
                          </TableCell>
                          {isAdmin && (
                            <TableCell className="text-right" data-label="İşlemler">
                              <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={(e) => e.stopPropagation()}
                                      title="Arıza kaydını sil"
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Bu işlem geri alınamaz. Arıza kaydı (#{report.id.substring(0, 6)}...) kalıcı olarak silinecektir.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>İptal</AlertDialogCancel>
                                      <AlertDialogAction
                                        className="bg-destructive hover:bg-destructive/90"
                                        onClick={() => handleDeleteReport(report.id)}
                                      >
                                        Evet, Sil
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
          {totalPages > 0 && (
            <CardFooter className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="flex items-center space-x-2 text-sm">
                <span>Satır/sayfa:</span>
                <Select
                  value={String(rowsPerPage)}
                  onValueChange={(val) => {
                    setRowsPerPage(Number(val));
                  }}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[20, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  Önceki
                </Button>
                <span className="text-sm">
                  Sayfa {currentPage} / {totalPages || 1}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages || 1, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Sonraki
                </Button>
              </div>
            </CardFooter>
          )}
        </Card>

        {/* Export Modal */}
        <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Döküm Formatı Seçin</DialogTitle>
              <DialogDescription>
                Arıza kayıtlarını hangi formatta dışa aktarmak istiyorsunuz?
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-4">
              <Button
                variant="outline"
                className="w-full justify-start h-14"
                onClick={handleExportToExcel}
              >
                <FileSpreadsheet className="h-5 w-5 mr-3 text-green-600" />
                <div className="flex flex-col items-start">
                  <span className="font-medium">Excel (.xlsx)</span>
                  <span className="text-xs text-muted-foreground">Tablo formatında veri</span>
                </div>
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start h-14"
                onClick={handleExportToPdf}
                disabled={exportLoading}
              >
                {exportLoading ? (
                  <Loader2 className="h-5 w-5 mr-3 animate-spin" />
                ) : (
                  <FileText className="h-5 w-5 mr-3 text-red-600" />
                )}
                <div className="flex flex-col items-start">
                  <span className="font-medium">PDF (.pdf)</span>
                  <span className="text-xs text-muted-foreground">Yatay sayfalarda tüm sütunlar</span>
                </div>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageShell>
  );
}
