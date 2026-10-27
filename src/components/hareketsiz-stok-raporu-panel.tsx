
'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../lib/data/client';
import { collection, getDocs, Timestamp, query, where, writeBatch, doc, orderBy } from '../lib/data/client';
import { format, subMonths, isValid } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { tr } from 'date-fns/locale';
import { exportDataToExcel } from '@/lib/utils';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { CalendarClock, Loader2, FileSpreadsheet, Trash2 } from 'lucide-react';
import type { DepoStokItem, Shipment, ConsumptionRecord, ProductCode } from '@/lib/types';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/document-helpers';
import { matchesCompanyScope } from '@/lib/company-scope';

interface ReportRow {
  stokKodu: string;
  stokAdi: string;
  lastMovementDate?: Date;
  lastMovementLocation?: string;
}

/**
 * Hareketsiz stok raporu — son N aydır hareket görmemiş ürünler.
 *
 * Optimizasyon (Faz 1): Tüm geçmişi indirmek yerine sadece eşik tarihinden
 * SONRAKİ hareketleri çekiyoruz. Eşikten sonra herhangi bir hareketi olan
 * ürünler "aktif" sayılıp listeden çıkarılıyor; geri kalanlar hareketsiz.
 *
 * Önceki yaklaşım: depoStok + shipments + tuketimKayitlari → milyon kayıt
 * Yeni yaklaşım: sadece son N aylık hareket → genelde <%5'i
 *
 * Composite index: (companyId ASC, <timestampField> DESC) — mevcut.
 */
export default function HareketsizStokRaporuPanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStockCodes, setSelectedStockCodes] = useState<Set<string>>(new Set());
  const [inactivityMonths, setInactivityMonths] = useState<number>(3);

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const thresholdDate = subMonths(new Date(), inactivityMonths);
      const thresholdTs = Timestamp.fromDate(thresholdDate);

      // Sadece eşikten SONRA hareket olanları çek — büyük optimizasyon.
      const [depSnap, shipSnap, consSnap, prodSnap] = await Promise.all([
        getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin,
          where('eklenmeTarihi', '>=', thresholdTs))),
        getDocs(scopedQuery('shipments', currentCompanyId, isSuperAdmin,
          where('timestamp', '>=', thresholdTs))),
        getDocs(scopedQuery('tuketimKayitlari', currentCompanyId, isSuperAdmin,
          where('consumptionTimestamp', '>=', thresholdTs))),
        getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
      ]);

      const productCodes = prodSnap.docs.map(doc => doc.data() as ProductCode);

      // Eşikten sonra hareketi olan stokKodu'ları topla (set membership).
      const activeStokKodu = new Map<string, { date: Date; location: string }>();

      const upsertActive = (stokKodu: string | undefined, date: Date, location: string) => {
        if (!stokKodu || !isValid(date)) return;
        const existing = activeStokKodu.get(stokKodu);
        if (!existing || date > existing.date) {
          activeStokKodu.set(stokKodu, { date, location });
        }
      };

      depSnap.docs.forEach(doc => {
        const d = doc.data() as DepoStokItem;
        const date = (d.eklenmeTarihi as any)?.toDate?.() ?? new Date();
        upsertActive(d.stokKodu, date, d.depotName || 'Depo');
      });

      shipSnap.docs.forEach(doc => {
        const d = doc.data() as Shipment;
        const date = (d.timestamp as any)?.toDate?.() ?? new Date();
        (d.items || []).forEach((it) => {
          upsertActive(it.stokKodu, date, `Sevk: ${d.recipientHospital}`);
        });
      });

      consSnap.docs.forEach(doc => {
        const d = doc.data() as ConsumptionRecord;
        const date = (d.consumptionTimestamp as any)?.toDate?.() ?? new Date();
        upsertActive(d.stokKodu, date, `Tüketim: ${d.laboratoryName}`);
      });

      // Eşikten sonra hareketi OLMAYAN ürünler hareketsiz.
      const report: ReportRow[] = productCodes
        .filter(p => p.stokKodu && !activeStokKodu.has(p.stokKodu))
        .map(p => ({
          stokKodu: p.stokKodu,
          stokAdi: p.stokAdi,
          // lastMovementDate yok — eşikten önce kalmış (≥N ay önce).
          lastMovementDate: undefined,
          lastMovementLocation: undefined,
        }));

      setRows(report.sort((a, b) => a.stokAdi.localeCompare(b.stokAdi, 'tr')));
      setSelectedStockCodes(new Set());
    } catch (err: any) {
      console.error("Inactive stock report error:", err);
      toast({ title: 'Hata', description: 'Rapor yüklenirken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin, inactivityMonths]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExport = () => {
    if (rows.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak veri bulunamadı.', variant: 'default' });
      return;
    }
    const dataToExport = rows.map(r => ({
      'Stok Kodu': r.stokKodu,
      'Stok Adı': r.stokAdi,
      'Durum': `Son ${inactivityMonths} aydır hareket yok`,
    }));
    exportDataToExcel(dataToExport, 'Hareketsiz_Stok_Raporu', 'HareketsizStok', toast);
  };
  
  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedStockCodes(new Set(rows.map(r => r.stokKodu)));
    } else {
      setSelectedStockCodes(new Set());
    }
  };

  const handleRowSelect = (stokKodu: string, checked: boolean) => {
    setSelectedStockCodes(prev => {
      const newSet = new Set(prev);
      if (checked) newSet.add(stokKodu);
      else newSet.delete(stokKodu);
      return newSet;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedStockCodes.size === 0) return;
    setIsLoading(true);
    try {
        const chunk = (arr: string[], size: number) => {
            const res = [];
            for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
            return res;
        };

        const codeChunks = chunk(Array.from(selectedStockCodes), 30); // Firestore `in` query limit
        const docsToDelete: string[] = [];

        for (const chunk of codeChunks) {
            const q = scopedQuery('productCodes', currentCompanyId, isSuperAdmin, where('stokKodu', 'in', chunk));
            const snap = await getDocs(q);
            snap.forEach(doc => docsToDelete.push(doc.id));
        }
        
        if (docsToDelete.length > 0) {
            const batch = writeBatch(db);
            docsToDelete.forEach(id => {
                batch.delete(doc(db, 'productCodes', id));
            });
            await batch.commit();
        }

        toast({ title: 'Başarılı', description: `${docsToDelete.length} hareketsiz ürün kalıcı olarak silindi.` });
        fetchReport(); // Refresh list
    } catch(e: any) {
        console.error('Toplu silme hatası:', e);
        toast({ title: 'Hata', description: 'Ürünler silinirken bir sorun oluştu.', variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  };

  const allSelected = rows.length > 0 && selectedStockCodes.size === rows.length;
  const someSelected = selectedStockCodes.size > 0 && selectedStockCodes.size < rows.length;


  return (
    <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-headline flex items-center">
            <CalendarClock className="mr-2 h-6 w-6 text-primary" />
            Hareketsiz Stok Raporu
          </CardTitle>
          <CardDescription>
            Seçilen süre içinde mal kabulü, sevkiyat veya tüketim işlemi görmemiş tüm stok kartlarını listeler.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="min-w-[180px]">
              <Label htmlFor="inactivity-window" className="text-xs">Hareketsizlik eşiği</Label>
              <Select
                value={String(inactivityMonths)}
                onValueChange={(v) => setInactivityMonths(Number(v))}
              >
                <SelectTrigger id="inactivity-window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Son 1 aydır hareketsiz</SelectItem>
                  <SelectItem value="3">Son 3 aydır hareketsiz</SelectItem>
                  <SelectItem value="6">Son 6 aydır hareketsiz</SelectItem>
                  <SelectItem value="12">Son 12 aydır hareketsiz</SelectItem>
                  <SelectItem value="24">Son 24 aydır hareketsiz</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end items-center gap-2 mb-4">
            {selectedStockCodes.size > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={isLoading}>
                      <Trash2 className="mr-2 h-4 w-4"/> Seçili ({selectedStockCodes.size}) ürünü sil
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                      <AlertDialogHeader>
                          <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
                          <AlertDialogDescription>
                              Seçilen {selectedStockCodes.size} ürün kalıcı olarak sistemden silinecektir. Bu işlem geri alınamaz.
                          </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                          <AlertDialogCancel>İptal</AlertDialogCancel>
                          <AlertDialogAction onClick={handleDeleteSelected}>Evet, Sil</AlertDialogAction>
                      </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
            )}
            <Button onClick={handleExport} disabled={isLoading || rows.length === 0} variant="outline" size="sm">
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel'e Dışa Aktar
            </Button>
          </div>
          <ScrollArea className="h-[500px] border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                      <Checkbox 
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={handleSelectAll}
                        aria-label="Tümünü seç"
                      />
                  </TableHead>
                  <TableHead>Stok Kodu</TableHead>
                  <TableHead>Stok Adı</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                       <Loader2 className="mx-auto h-8 w-8 animate-spin" />
                       <p className="mt-2">Rapor oluşturuluyor...</p>
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Hareketsiz stok bulunamadı.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map(r => (
                    <TableRow key={r.stokKodu} data-state={selectedStockCodes.has(r.stokKodu) ? "selected" : ""}>
                      <TableCell>
                          <Checkbox 
                            checked={selectedStockCodes.has(r.stokKodu)}
                            onCheckedChange={(checked) => handleRowSelect(r.stokKodu, !!checked)}
                            aria-label={`Select ${r.stokAdi}`}
                          />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{r.stokKodu}</TableCell>
                      <TableCell>{r.stokAdi}</TableCell>
                      <TableCell>
                        <span className="text-muted-foreground text-sm">
                          {`Son ${inactivityMonths} aydır hareket yok`}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
  );
}

