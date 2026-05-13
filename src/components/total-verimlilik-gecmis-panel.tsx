/**
 * @fileoverview Total Verimlilik Geçmişi (Total Efficiency History) Panel
 * @description Displays saved total efficiency calculation history with pool-based
 * filtering, efficiency metrics visualization, and navigation to detail views.
 * @module components/total-verimlilik-gecmis-panel
 * @version 1.0.0
 *
 * @features
 * - List of saved total efficiency calculations
 * - Search by pool name, period, or user
 * - Efficiency score visualization with color coding
 * - Row count display
 * - Navigation to detail view
 *
 * @accessibility
 * - ARIA labels for search and navigation
 * - Screen reader compatible table
 * - Keyboard accessible buttons
 */

'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { totalVerimlilikLogger } from '@/lib/logger';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, History, Search, Calendar, Building2, ChevronRight } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { calculateEfficiencyMetrics } from '@/lib/verimlilik/validation';

interface EfficiencyMetrics {
  toplamKumulatif: number;
  toplamBeklenenTuketim: number;
  toplamHakEdis: number;
  stokSapmaYuzde: number;
  kitSapmaYuzde: number;
  stokDogrulukSkoru: number;
  kitVerimlilikSkoru: number;
  genelVerimlilik: number;
  toplamEtkiDegeri?: number;
  maliyetAgirlikli?: boolean;
  hesaplananSatirSayisi?: number;
  algoritma?: 'value-impact-efficiency-index';
}

interface TotalEfficiencyRecord {
  id: string;
  poolId: string;
  poolName: string;
  month: number;
  year: number;
  createdAt: { seconds: number; nanoseconds: number } | null;
  createdByName: string;
  rowCount: number;
  efficiencyMetrics?: EfficiencyMetrics;
  isAraKayit?: boolean;
}

const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

export default function TotalVerimlilikGecmisPanel() {
  const { toast } = useToast();
  const [records, setRecords] = useState<TotalEfficiencyRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchRecords = async () => {
      try {
        const recordsQuery = query(
          collection(db, 'totalEfficiencyRecords'),
          orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(recordsQuery);

        const fetchedRecords: TotalEfficiencyRecord[] = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            poolId: data.poolId || '',
            poolName: data.poolName || '',
            month: data.month ?? 0,
            year: data.year ?? 0,
            createdAt: data.createdAt || null,
            createdByName: data.createdByName || '',
            rowCount: data.rows?.length || 0,
            efficiencyMetrics: data.efficiencyMetrics || (data.rows?.length ? calculateEfficiencyMetrics(data.rows) : undefined),
            isAraKayit: data.isAraKayit === true,
          };
        });

        setRecords(fetchedRecords);
      } catch (error) {
        totalVerimlilikLogger.error('Total verimlilik geçmiş kayıtları yüklenemedi', error);
        toast({
          title: 'Hata',
          description: 'Geçmiş kayıtlar yüklenemedi.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecords();
  }, [toast]);

  const filteredRecords = records.filter(record => {
    if (!searchTerm) return true;
    const lowerSearch = searchTerm.toLowerCase();
    const monthName = MONTHS[record.month]?.toLowerCase() || '';
    return (
      record.poolName.toLowerCase().includes(lowerSearch) ||
      monthName.includes(lowerSearch) ||
      record.year.toString().includes(lowerSearch) ||
      record.createdByName.toLowerCase().includes(lowerSearch)
    );
  });

  return (
    <div className="p-4 space-y-6" role="main" aria-label="Total Verimlilik Geçmişi">
      <BackButton fallback="/total-verimlilik" />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <History className="h-6 w-6 text-primary" aria-hidden="true" />
            Total Verimlilik Geçmişi
          </CardTitle>
          <CardDescription>
            Kaydedilen total verimlilik hesaplamalarını görüntüleyin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-md mb-4">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Havuz adı, dönem veya kullanıcı ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
              aria-label="Geçmiş kayıtlarda ara"
            />
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-64" role="status" aria-label="Yükleniyor">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
              <span className="sr-only">Kayıtlar yükleniyor...</span>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" role="status" aria-live="polite">
              {searchTerm ? 'Arama kriterine uygun kayıt bulunamadı.' : 'Henüz kaydedilmiş verimlilik hesabı yok.'}
            </div>
          ) : (
            <ScrollArea className="h-[60vh]">
              <Table aria-label="Total verimlilik geçmiş kayıtları tablosu">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Havuz</TableHead>
                    <TableHead className="min-w-[150px]">Dönem</TableHead>
                    <TableHead className="min-w-[120px] text-center">Verimlilik</TableHead>
                    <TableHead className="min-w-[100px] text-center">Satır Sayısı</TableHead>
                    <TableHead className="min-w-[180px]">Kayıt Tarihi</TableHead>
                    <TableHead className="min-w-[150px]">Kaydeden</TableHead>
                    <TableHead className="min-w-[100px] text-center">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.map(record => (
                    <TableRow key={record.id} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{record.poolName}</span>
                          {record.isAraKayit && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                              Ara Kayıt
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span>{MONTHS[record.month]} {record.year}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {record.efficiencyMetrics ? (
                          <div className="flex items-center justify-center gap-2">
                            {/* Mini Circular Progress */}
                            <div className="relative w-10 h-10">
                              <svg className="w-10 h-10 transform -rotate-90">
                                <circle
                                  cx="20"
                                  cy="20"
                                  r="16"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                  fill="none"
                                  className="text-muted"
                                />
                                <circle
                                  cx="20"
                                  cy="20"
                                  r="16"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                  fill="none"
                                  strokeDasharray={`${(record.efficiencyMetrics.genelVerimlilik / 100) * 100.5} 100.5`}
                                  strokeLinecap="round"
                                  className={
                                    record.efficiencyMetrics.genelVerimlilik >= 90 ? 'text-green-500' :
                                    record.efficiencyMetrics.genelVerimlilik >= 70 ? 'text-yellow-500' :
                                    record.efficiencyMetrics.genelVerimlilik >= 50 ? 'text-orange-500' : 'text-red-500'
                                  }
                                />
                              </svg>
                            </div>
                            <span className={`text-sm font-semibold ${
                              record.efficiencyMetrics.genelVerimlilik >= 90 ? 'text-green-600' :
                              record.efficiencyMetrics.genelVerimlilik >= 70 ? 'text-yellow-600' :
                              record.efficiencyMetrics.genelVerimlilik >= 50 ? 'text-orange-600' : 'text-red-600'
                            }`}>
                              %{record.efficiencyMetrics.genelVerimlilik.toFixed(1)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="bg-muted px-2 py-1 rounded text-sm">
                          {record.rowCount} satır
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {record.createdAt
                          ? format(new Date(record.createdAt.seconds * 1000), 'dd MMM yyyy HH:mm', { locale: tr })
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {record.createdByName || '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Link href={`/total-verimlilik/gecmis/${record.id}`}>
                          <Button variant="outline" size="sm" aria-label={`${record.poolName} - ${MONTHS[record.month]} ${record.year} kaydını görüntüle`}>
                            <ChevronRight className="h-4 w-4 mr-1" aria-hidden="true" />
                            Görüntüle
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}

          {!isLoading && filteredRecords.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground text-center">
              Toplam {filteredRecords.length} kayıt
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
