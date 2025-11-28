
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, orderBy, query, Timestamp, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { DeviceFaultReport } from '@/lib/types';
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
import {
  Loader2,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  BarChart,
  Trash2,
  FileDown,
  FileSpreadsheet, // Added for Excel icon
} from 'lucide-react';
import BackButton from '@/components/BackButton';
import { format } from 'date-fns';
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
import { exportDataToExcel } from '@/lib/utils'; // Import the export utility

export default function ArizaYonetimiPage() {
  const [reports, setReports] = useState<DeviceFaultReport[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const router = useRouter();
  const { isAdmin } = useAuth();

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [labFilter, setLabFilter] = useState<string>('all');
  const [deviceFilter, setDeviceFilter] = useState<string>('all');
  const [openerFilter, setOpenerFilter] = useState<string>('all');

  useEffect(() => {
    const q = query(collection(db, 'deviceFaultReports'), orderBy('openedAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const reportList: DeviceFaultReport[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            openedAt: data.openedAt ? (data.openedAt as Timestamp).toDate() : null,
            closedAt: data.closedAt ? (data.closedAt as Timestamp).toDate() : null,
          } as DeviceFaultReport;
        });
        setReports(reportList);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching fault reports:', error);
        toast({
          title: 'Hata',
          description: 'Arıza geçmişi yüklenemedi.',
          variant: 'destructive',
        });
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [toast]);
  
  const uniqueLabs = useMemo(() => {
    const labs = new Set(reports.map(r => r.labName));
    return Array.from(labs).filter(Boolean) as string[];
  }, [reports]);

  const uniqueDevices = useMemo(() => {
    const devices = new Set(reports.map(r => r.serial));
    return Array.from(devices).filter(Boolean) as string[];
  }, [reports]);

  const uniqueOpeners = useMemo(() => {
    const openers = new Set(reports.map(r => r.openedByName));
    return Array.from(openers).filter(Boolean) as string[];
  }, [reports]);


  const filteredReports = useMemo(() => {
    return reports.filter(report => {
      const statusMatch = statusFilter === 'all' || report.status === statusFilter;
      const labMatch = labFilter === 'all' || report.labName === labFilter;
      const deviceMatch = deviceFilter === 'all' || report.serial === deviceFilter;
      const openerMatch = openerFilter === 'all' || report.openedByName === openerFilter;
      return statusMatch && labMatch && deviceMatch && openerMatch;
    });
  }, [reports, statusFilter, labFilter, deviceFilter, openerFilter]);

  const paginatedReports = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return filteredReports.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredReports, currentPage, rowsPerPage]);

  const totalPages = Math.ceil(filteredReports.length / rowsPerPage);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);
  
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, labFilter, deviceFilter, openerFilter, rowsPerPage]);

  const handleDeleteReport = async (reportId: string) => {
    try {
      await deleteDoc(doc(db, 'deviceFaultReports', reportId));
      toast({ title: 'Başarılı', description: `Arıza kaydı #${reportId.substring(0, 6)}... silindi.` });
    } catch (error) {
      console.error("Error deleting fault report:", error);
      toast({ title: 'Hata', description: 'Arıza kaydı silinemedi.', variant: 'destructive' });
    }
  };

  const handleOpenHtmlReport = () => {
    window.open('/ariza-yonetimi/html', '_blank');
  };

  const handleExportToExcel = () => {
    if (reports.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak arıza kaydı bulunmuyor.', variant: 'default' });
      return;
    }
    const dataToExport = reports.map(r => ({
      'Rapor ID': r.id,
      'Laboratuvar': r.labName || '',
      'Cihaz Adı': r.title || r.model || '',
      'Seri No': r.serial || '',
      'Arıza Tipi': r.faultType || '',
      'Açıklama': r.description || '',
      'Açan Personel': r.openedByName || '',
      'Açılış Tarihi': r.openedAt ? format(r.openedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '',
      'Durum': r.status === 'open' ? 'Açık' : 'Giderildi',
      'Kapanış Tarihi': r.closedAt ? format(r.closedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '',
      'Kapatan Personel': r.closedByName || '',
      'Kapanış Açıklaması': r.closeDescription || '',
    }));
    exportDataToExcel(dataToExport, 'Tum_Ariza_Kayitlari', 'Arızalar', toast);
  };

  return (
    <PageShell>
      <div className="space-y-4">
        <BackButton fallback="/cihaz-yonetimi-ana" />
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
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={handleExportToExcel}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel Dökümü Al
                </Button>
                <Button variant="secondary" onClick={handleOpenHtmlReport}>
                  <FileDown className="h-4 w-4 mr-2" /> HTML Raporu
                </Button>
                <Button variant="outline" onClick={() => router.push('/ariza-yonetimi/istatistikler')}>
                    <BarChart className="h-4 w-4 mr-2" /> Arıza İstatistikleri
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <div className='q-table' data-mobile-mode="stack">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                            <SelectTrigger className="border-none p-0 h-auto font-semibold [&>svg]:ml-1 w-full bg-transparent focus:ring-0 focus:ring-offset-0">
                              <SelectValue/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Durum (Tümü)</SelectItem>
                                <SelectItem value="open">Açık</SelectItem>
                                <SelectItem value="closed">Giderildi</SelectItem>
                            </SelectContent>
                        </Select>
                      </TableHead>
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
                      {isAdmin && <TableHead className="text-right">İşlemler</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedReports.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isAdmin ? 7 : 6} className="h-24 text-center">
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
                            {report.status === 'open' ? (
                              <Badge variant="destructive" className="flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" /> Açık
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="flex items-center gap-1 bg-green-600/10 text-green-700 dark:text-green-400 border border-green-600/20">
                                <CheckCircle className="h-3 w-3" /> Giderildi
                              </Badge>
                            )}
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
          {totalPages > 1 && (
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
                  Sayfa {currentPage} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Sonraki
                </Button>
              </div>
            </CardFooter>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
