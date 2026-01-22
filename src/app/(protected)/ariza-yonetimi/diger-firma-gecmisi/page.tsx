'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, orderBy, query, Timestamp, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
import {
  Loader2,
  Building2,
  Trash2,
  FileSpreadsheet,
  FlaskConical,
  Wrench,
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
import { exportDataToExcel } from '@/lib/utils';

interface DigerFirmaArizaRecord {
  id: string;
  hospitalId: string;
  hospitalName: string;
  digerFirmaAdi: string;
  tespitEdilenAriza: string;
  yapilanIslem: string;
  createdAt: Date | null;
  createdByUid: string;
  createdByName: string;
  formType: 'teknik_servis' | 'aplikasyon';
}

export default function DigerFirmaGecmisiPage() {
  const [records, setRecords] = useState<DigerFirmaArizaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const [labFilter, setLabFilter] = useState<string>('all');
  const [firmaFilter, setFirmaFilter] = useState<string>('all');
  const [formTypeFilter, setFormTypeFilter] = useState<string>('all');
  const [creatorFilter, setCreatorFilter] = useState<string>('all');

  useEffect(() => {
    const q = query(collection(db, 'digerFirmaArizalar'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const recordList: DigerFirmaArizaRecord[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            hospitalId: data.hospitalId || '',
            hospitalName: data.hospitalName || '',
            digerFirmaAdi: data.digerFirmaAdi || '',
            tespitEdilenAriza: data.tespitEdilenAriza || '',
            yapilanIslem: data.yapilanIslem || '',
            createdAt: data.createdAt ? (data.createdAt as Timestamp).toDate() : null,
            createdByUid: data.createdByUid || '',
            createdByName: data.createdByName || '',
            formType: data.formType || 'teknik_servis',
          } as DigerFirmaArizaRecord;
        });
        setRecords(recordList);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching diğer firma records:', error);
        toast({
          title: 'Hata',
          description: 'Diğer firma arıza geçmişi yüklenemedi.',
          variant: 'destructive',
        });
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [toast]);

  const uniqueLabs = useMemo(() => {
    const labs = new Set(records.map(r => r.hospitalName));
    return Array.from(labs).filter(Boolean) as string[];
  }, [records]);

  const uniqueFirmalar = useMemo(() => {
    const firmalar = new Set(records.map(r => r.digerFirmaAdi));
    return Array.from(firmalar).filter(Boolean) as string[];
  }, [records]);

  const uniqueCreators = useMemo(() => {
    const creators = new Set(records.map(r => r.createdByName));
    return Array.from(creators).filter(Boolean) as string[];
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      const labMatch = labFilter === 'all' || record.hospitalName === labFilter;
      const firmaMatch = firmaFilter === 'all' || record.digerFirmaAdi === firmaFilter;
      const formTypeMatch = formTypeFilter === 'all' || record.formType === formTypeFilter;
      const creatorMatch = creatorFilter === 'all' || record.createdByName === creatorFilter;
      return labMatch && firmaMatch && formTypeMatch && creatorMatch;
    });
  }, [records, labFilter, firmaFilter, formTypeFilter, creatorFilter]);

  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return filteredRecords.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredRecords, currentPage, rowsPerPage]);

  const totalPages = Math.ceil(filteredRecords.length / rowsPerPage);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [labFilter, firmaFilter, formTypeFilter, creatorFilter, rowsPerPage]);

  const handleDeleteRecord = async (recordId: string) => {
    try {
      await deleteDoc(doc(db, 'digerFirmaArizalar', recordId));
      toast({ title: 'Başarılı', description: `Kayıt silindi.` });
    } catch (error) {
      console.error("Error deleting record:", error);
      toast({ title: 'Hata', description: 'Kayıt silinemedi.', variant: 'destructive' });
    }
  };

  const handleExportToExcel = () => {
    if (records.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak kayıt bulunmuyor.', variant: 'default' });
      return;
    }
    const dataToExport = filteredRecords.map(r => {
      return {
        'Kayıt ID': r.id,
        'Laboratuvar': r.hospitalName || '',
        'Diğer Firma Adı': r.digerFirmaAdi || '',
        'Tespit Edilen Arıza': r.tespitEdilenAriza || '',
        'Yapılan İşlem': r.yapilanIslem || '',
        'Form Türü': r.formType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon',
        'Kaydeden': r.createdByName || '',
        'Kayıt Tarihi': r.createdAt ? format(r.createdAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '',
      };
    });
    exportDataToExcel(dataToExport, 'Diger_Firma_Ariza_Kayitlari', 'Kayıtlar', toast);
  };

  return (
    <PageShell>
      <div className="space-y-4">
        <BackButton fallback="/ariza-yonetimi" />
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-6 w-6 text-primary" /> Diğer Firma Arıza Kayıtları
                </CardTitle>
                <CardDescription>
                  Diğer firmalara açılan arıza kayıtlarının geçmişi.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={handleExportToExcel}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel Dökümü Al
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Summary */}
            <div className="mb-4 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-6 text-sm">
                <span>Toplam Kayıt: <strong>{filteredRecords.length}</strong></span>
                <span className="flex items-center gap-1">
                  <Wrench className="h-4 w-4" /> Teknik Servis: <strong>{filteredRecords.filter(r => r.formType === 'teknik_servis').length}</strong>
                </span>
                <span className="flex items-center gap-1">
                  <FlaskConical className="h-4 w-4" /> Aplikasyon: <strong>{filteredRecords.filter(r => r.formType === 'aplikasyon').length}</strong>
                </span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <div className='q-table' data-mobile-mode="stack">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Form Türü</TableHead>
                      <TableHead>
                        <Select value={labFilter} onValueChange={setLabFilter}>
                          <SelectTrigger className="border-none p-0 h-auto font-semibold [&>svg]:ml-1 w-full bg-transparent focus:ring-0 focus:ring-offset-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Laboratuvar (Tümü)</SelectItem>
                            {uniqueLabs.map(lab => <SelectItem key={lab} value={lab}>{lab}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableHead>
                      <TableHead>
                        <Select value={firmaFilter} onValueChange={setFirmaFilter}>
                          <SelectTrigger className="border-none p-0 h-auto font-semibold [&>svg]:ml-1 w-full bg-transparent focus:ring-0 focus:ring-offset-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Diğer Firma (Tümü)</SelectItem>
                            {uniqueFirmalar.map(firma => <SelectItem key={firma} value={firma}>{firma}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableHead>
                      <TableHead>Tespit Edilen Arıza</TableHead>
                      <TableHead>Yapılan İşlem</TableHead>
                      <TableHead>
                        <Select value={creatorFilter} onValueChange={setCreatorFilter}>
                          <SelectTrigger className="border-none p-0 h-auto font-semibold [&>svg]:ml-1 w-full bg-transparent focus:ring-0 focus:ring-offset-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Kaydeden (Tümü)</SelectItem>
                            {uniqueCreators.map(creator => <SelectItem key={creator} value={creator}>{creator}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableHead>
                      <TableHead>Kayıt Tarihi</TableHead>
                      {isAdmin && <TableHead className="text-right">İşlemler</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRecords.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isAdmin ? 8 : 7} className="h-24 text-center">
                          Kayıt bulunamadı.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedRecords.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell data-label="Form Türü">
                            <Badge
                              variant="outline"
                              className={record.formType === 'teknik_servis'
                                ? 'bg-blue-600/10 text-blue-700 dark:text-blue-400 border-blue-600/20'
                                : 'bg-purple-600/10 text-purple-700 dark:text-purple-400 border-purple-600/20'}
                            >
                              {record.formType === 'teknik_servis' ? (
                                <><Wrench className="h-3 w-3 mr-1" /> Teknik Servis</>
                              ) : (
                                <><FlaskConical className="h-3 w-3 mr-1" /> Aplikasyon</>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell data-label="Laboratuvar">{record.hospitalName}</TableCell>
                          <TableCell data-label="Diğer Firma">
                            <div className="font-medium">{record.digerFirmaAdi}</div>
                          </TableCell>
                          <TableCell data-label="Tespit Edilen Arıza">
                            <div className="max-w-[200px] truncate" title={record.tespitEdilenAriza}>
                              {record.tespitEdilenAriza}
                            </div>
                          </TableCell>
                          <TableCell data-label="Yapılan İşlem">
                            <div className="max-w-[200px] truncate" title={record.yapilanIslem}>
                              {record.yapilanIslem}
                            </div>
                          </TableCell>
                          <TableCell data-label="Kaydeden">{record.createdByName}</TableCell>
                          <TableCell data-label="Kayıt Tarihi" className="text-xs">
                            {record.createdAt
                              ? format(record.createdAt, 'dd.MM.yy HH:mm', { locale: tr })
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
                                    title="Kaydı sil"
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Bu işlem geri alınamaz. Kayıt kalıcı olarak silinecektir.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>İptal</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive hover:bg-destructive/90"
                                      onClick={() => handleDeleteRecord(record.id)}
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
