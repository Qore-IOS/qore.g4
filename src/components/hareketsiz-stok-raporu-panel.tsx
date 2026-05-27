
'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, Timestamp, query, where, writeBatch, doc } from 'firebase/firestore';
import { format, subMonths, isValid } from 'date-fns';
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
import { scopedQuery } from '@/lib/firestore-helpers';
import { matchesCompanyScope } from '@/lib/company-scope';

interface ReportRow {
  stokKodu: string;
  stokAdi: string;
  lastMovementDate?: Date;
  lastMovementLocation?: string;
}

export default function HareketsizStokRaporuPanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStockCodes, setSelectedStockCodes] = useState<Set<string>>(new Set());

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1) Fetch all transaction data and product master data
      const [depSnap, shipSnap, consSnap, prodSnap] = await Promise.all([
        getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('shipments', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('tuketimKayitlari', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
      ]);

      type Tx = { stokKodu: string; date: Date; location: string };
      const transactions: Tx[] = [];
      const productCodes = prodSnap.docs.map(doc => doc.data() as ProductCode);

      // a) Process Receipts from depoStok
      depSnap.docs.forEach(doc => {
        const d = doc.data() as DepoStokItem;
        if (!matchesCompanyScope(d as any, currentCompanyId, isSuperAdmin)) return;
        const date = (d.eklenmeTarihi as any)?.toDate ? (d.eklenmeTarihi as any).toDate() : new Date();
        if(isValid(date)) {
            transactions.push({ stokKodu: d.stokKodu, date, location: d.depotName || 'Depo' });
        }
      });

      // b) Process Shipments
      shipSnap.docs.forEach(doc => {
        const d = doc.data() as Shipment;
        const date = (d.timestamp as any)?.toDate ? (d.timestamp as any).toDate() : new Date();
         if(isValid(date)) {
            (d.items || []).forEach((it) => {
              transactions.push({ stokKodu: it.stokKodu, date, location: `Sevk: ${d.recipientHospital}` });
            });
         }
      });

      // c) Process Consumptions
      consSnap.docs.forEach(doc => {
        const d = doc.data() as ConsumptionRecord;
        const date = (d.consumptionTimestamp as any)?.toDate ? (d.consumptionTimestamp as any).toDate() : new Date();
        if(isValid(date)) {
            transactions.push({ stokKodu: d.stokKodu, date, location: `Tüketim: ${d.laboratoryName}` });
        }
      });

      // 2) Determine last movement for each product
      const lastMovementMap = new Map<string, Tx>();
      transactions.forEach(tx => {
        if (!tx.stokKodu) return;
        const existing = lastMovementMap.get(tx.stokKodu);
        if (!existing || tx.date > existing.date) {
          lastMovementMap.set(tx.stokKodu, tx);
        }
      });

      // 3) Define inactivity threshold
      const thresholdDate = subMonths(new Date(), 3);

      // 4) Build the final report
      const report: ReportRow[] = productCodes.map(p => {
        const lastMovement = lastMovementMap.get(p.stokKodu);
        return {
          stokKodu: p.stokKodu,
          stokAdi: p.stokAdi,
          lastMovementDate: lastMovement?.date,
          lastMovementLocation: lastMovement?.location,
        };
      }).filter(r => r.stokKodu && (!r.lastMovementDate || r.lastMovementDate < thresholdDate));

      setRows(report.sort((a,b) => (a.lastMovementDate?.getTime() || 0) - (b.lastMovementDate?.getTime() || 0)));
      setSelectedStockCodes(new Set());
    } catch (err: any) {
      console.error("Inactive stock report error:", err);
      toast({ title: 'Hata', description: 'Rapor yüklenirken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin]);

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
      'Son Hareket Tarihi': r.lastMovementDate
        ? format(r.lastMovementDate, 'dd.MM.yyyy HH:mm', { locale: tr })
        : 'Hareket Yok',
      'Son Hareket Yeri': r.lastMovementLocation || '-',
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
            Son 3 ay içinde mal kabulü, sevkiyat veya tüketim işlemi görmemiş tüm stok kartlarını listeler.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                  <TableHead>Son Hareket Tarihi</TableHead>
                  <TableHead>Son Hareket Yeri</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                       <Loader2 className="mx-auto h-8 w-8 animate-spin" />
                       <p className="mt-2">Rapor oluşturuluyor...</p>
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
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
                        {r.lastMovementDate
                          ? format(r.lastMovementDate, 'dd.MM.yyyy HH:mm', { locale: tr })
                          : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell>{r.lastMovementLocation || <span className="text-muted-foreground">-</span>}</TableCell>
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

