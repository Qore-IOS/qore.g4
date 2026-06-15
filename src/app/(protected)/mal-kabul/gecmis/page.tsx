/**
 * @fileoverview Mal Kabul Transaction History Page
 * @description Displays historical goods receiving transactions with pagination,
 * filtering, and detailed view capabilities.
 * @module app/(protected)/mal-kabul/gecmis/page
 * @version 2.0.0
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Firebase
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  where,
  onSnapshot,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';

// UI Components
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MK_C, MkClayStyles } from '@/components/mal-kabul/clay-kit';

// Icons
import { Loader2, History, ChevronLeft, ChevronRight, FileSpreadsheet, Eye } from 'lucide-react';

// Hooks & Utils
import { useToast } from '@/hooks/use-toast';
import { exportDataToExcel } from '@/lib/utils';
import BackButton from '@/components/BackButton';
import { toDateFromAny, formatTimestamp } from '@/lib/time';
import { useRowFocus } from '@/hooks/useRowFocus';

// Logging
import { malKabulLogger } from '@/lib/logger';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Mal Kabul transaction header (from Firestore)
 */
type MalKabulHeader = {
  transactionId: string;
  depotId: string;
  depotName: string;
  userId: string;
  userName: string;
  timestamp?: Date | { seconds: number; nanoseconds: number } | null;
  itemCount: number;
  brands?: string[];
  mode: 'verified' | 'unverified';
};

/**
 * Mal Kabul transaction line item
 */
type MalKabulLine = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  adet: number;
  serials?: string[];
};

// =============================================================================
// CONSTANTS
// =============================================================================

/** Available page size options */
const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;

/** Firestore collection name */
const COLLECTION_NAME = 'malKabulTransactions';

/** Field to order by */
const ORDER_FIELD = 'timestamp';

/** Maximum records to fetch */
const MAX_RECORDS = 1000;

export default function MalKabulGecmisPage() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const sp = useSearchParams();
  const openId = sp?.get('open') ?? null;
  const depotId = sp?.get('depotId') ?? null;

  const [pageSize, setPageSize] = useState<number>(50);
  const [isLoading, setIsLoading] = useState(true);
  const [allRows, setAllRows] = useState<(MalKabulHeader & { id: string })[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const { focusRef } = useRowFocus('open');

  // line modal
  const [selectedTx, setSelectedTx] = useState<(MalKabulHeader & { id: string }) | null>(null);
  const [linesLoading, setLinesLoading] = useState(false);
  const [lines, setLines] = useState<MalKabulLine[]>([]);

  // Real-time listener for transaction history
  useEffect(() => {
    setIsLoading(true);
    malKabulLogger.debug('Initializing transaction history listener', { depotId });

    const q = scopedQuery(
      COLLECTION_NAME,
      currentCompanyId,
      isSuperAdmin,
      ...(depotId ? [where('depotId', '==', depotId)] : []),
      orderBy(ORDER_FIELD, 'desc'),
      limit(MAX_RECORDS)
    );

    const unsubscribe = onSnapshot(
      q,
      (snap: { docs: QueryDocumentSnapshot<DocumentData>[] }) => {
        const data = snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({
          id: d.id,
          ...(d.data() as MalKabulHeader)
        }));

        // Client-side sort to guarantee order
        data.sort((a, b) => {
          const aTime = toDateFromAny(a.timestamp as Parameters<typeof toDateFromAny>[0])?.getTime() ?? 0;
          const bTime = toDateFromAny(b.timestamp as Parameters<typeof toDateFromAny>[0])?.getTime() ?? 0;
          return bTime - aTime;
        });

        setAllRows(data);
        setIsLoading(false);
        malKabulLogger.info('Transaction history loaded', { count: data.length, depotId });
      },
      (error: Error) => {
        malKabulLogger.error('Failed to listen to transaction history', error);
        toast({
          title: 'Hata',
          description: 'Geçmiş verileri dinlenirken bir hata oluştu.',
          variant: 'destructive'
        });
        setIsLoading(false);
      }
    );

    return () => {
      malKabulLogger.debug('Cleaning up transaction history listener');
      unsubscribe();
    };
  }, [toast, currentCompanyId, isSuperAdmin, depotId]);

  /**
   * Open transaction details modal
   * @param txId - Transaction ID to open
   */
  const openTransaction = useCallback(async (txId: string) => {
    setLines([]);
    setLinesLoading(true);
    malKabulLogger.debug('Opening transaction details', { transactionId: txId });

    const txHeader = allRows.find((r) => r.id === txId);
    if (!txHeader) {
      malKabulLogger.warn('Transaction not found', { transactionId: txId });
      toast({ title: 'Bulunamadı', description: 'İşlem mevcut değil veya silinmiş.' });
      return;
    }
    setSelectedTx(txHeader);

    try {
      const txRef = doc(db, COLLECTION_NAME, txId);
      const linesSnap = await getDocsFromServer(
        query(collection(txRef, 'lines'), orderBy('stokKodu'))
      );
      const lineData = linesSnap.docs.map((d) => d.data() as MalKabulLine);
      setLines(lineData);
      malKabulLogger.info('Transaction details loaded', {
        transactionId: txId,
        lineCount: lineData.length
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      malKabulLogger.error('Failed to load transaction details', error, { transactionId: txId });
      toast({ title: 'Hata', description: error.message || 'Detaylar yüklenemedi', variant: 'destructive' });
    } finally {
      setLinesLoading(false);
    }
  }, [toast, allRows]);
  
  useEffect(() => {
    if (openId && allRows.length > 0) openTransaction(openId);
  }, [openId, allRows, openTransaction]);

  const paginatedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return allRows.slice(startIndex, startIndex + pageSize);
  }, [allRows, currentPage, pageSize]);

  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const exportCurrentPage = () => {
    const rowsForExcel = paginatedRows.map((r: MalKabulHeader & { id: string }) => {
      return {
        'İşlem No': r.transactionId || r.id,
        'Depo': r.depotName,
        'Kullanıcı': r.userName,
        'İşlem Zamanı': formatTimestamp(r.timestamp, 'dd.MM.yyyy HH:mm') || '-',
        'Kalem Sayısı': r.itemCount,
        'Markalar': (r.brands || []).join(', ')
      };
    });
    exportDataToExcel(rowsForExcel, 'Mal_Kabul_Gecmis', 'Sayfa', toast);
  };

  const exportDetails = () => {
    if (!selectedTx || lines.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak detay bulunamadı.' });
      return;
    }
    const summaryData = lines.map((l: MalKabulLine) => ({
      'Stok Kodu': l.stokKodu,
      'Stok Adı': l.stokAdi,
      'Lot': l.lotNumarasi,
      'Miad': l.miad,
      'Adet': l.adet,
    }));
    const serialsData = lines.flatMap((l: MalKabulLine) =>
      (l.serials || []).map((s: string) => ({
        'Stok Kodu': l.stokKodu,
        'Stok Adı': l.stokAdi,
        'Lot': l.lotNumarasi,
        'Seri Numarası': s,
      }))
    );
    exportDataToExcel({
      'Özet': summaryData,
      'Seri Numaraları': serialsData
    }, `MalKabul_${selectedTx.transactionId || selectedTx.id}`, toast);
  };


  const cols = 'minmax(0,2.3fr) 130px minmax(0,1.1fr) 150px 70px minmax(0,1fr) 96px';

  return (
    <div className="mk-shell" style={{ padding: '20px 28px 40px' }}>
      <MkClayStyles />
      <div style={{ maxWidth: 1680, margin: '0 auto' }}>
        <div className="mb-4"><BackButton fallback="/mal-kabul" /></div>

        <div style={{ borderRadius: MK_C.radiusLg, background: `linear-gradient(180deg, ${MK_C.surface} 0%, ${MK_C.surface2} 100%)`, boxShadow: MK_C.clay, overflow: 'hidden' }}>
          {/* head */}
          <div className="flex flex-wrap items-start gap-4" style={{ padding: '24px 28px', borderBottom: `1px solid ${MK_C.line}` }}>
            <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: MK_C.accent, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: MK_C.clayFlat }}><History className="h-5 w-5" /></span>
            <div className="flex-1" style={{ minWidth: 220 }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: MK_C.ink1 }}>Mal Kabul İşlem Geçmişi</h1>
              <p style={{ margin: '5px 0 0', fontSize: 14, color: MK_C.ink2, fontWeight: 500 }}>
                {depotId ? 'Seçili deponun mal kabul işlemleri listelenir.' : 'Tüm işlemler listelenir.'} Sayfa başına kayıt sayısını seçebilirsiniz.
              </p>
              <div style={{ fontSize: 13, color: MK_C.ink3, fontWeight: 600, marginTop: 8 }}>Toplam işlem: {allRows.length} · Sayfa {currentPage} / {totalPages}</div>
            </div>
            <Select value={String(pageSize)} onValueChange={(v: string) => { setPageSize(Number(v)); setCurrentPage(1); }}>
              <SelectTrigger className="border-0" style={{ width: 140, height: 46, background: MK_C.surface2, boxShadow: MK_C.clayInset, borderRadius: MK_C.radiusSm }}><SelectValue placeholder="Sayfa boyutu" /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map(s => <SelectItem key={s} value={String(s)}>{s} / sayfa</SelectItem>)}
              </SelectContent>
            </Select>
            <button onClick={exportCurrentPage} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, height: 46, padding: '0 18px', borderRadius: MK_C.radiusSm, background: `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: MK_C.clay, color: MK_C.waterDeep, fontSize: 14, fontWeight: 700 }}>
              <FileSpreadsheet className="h-[18px] w-[18px]" /> Excel
            </button>
          </div>

          {/* column header */}
          <div className="hidden md:grid" style={{ gridTemplateColumns: cols, gap: 16, padding: '16px 28px', borderBottom: `1px solid ${MK_C.line}` }}>
            {['İşlem No', 'Depo', 'Kullanıcı', 'İşlem Zamanı', 'Kalem', 'Markalar', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 11.5, fontWeight: 700, color: MK_C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: i === 4 ? 'center' : 'left' }}>{h}</div>
            ))}
          </div>

          {/* rows */}
          <div style={{ padding: '12px 18px', minHeight: '40vh' }}>
            {isLoading ? (
              <div className="flex flex-col items-center justify-center" style={{ padding: '60px 0', color: MK_C.ink2 }}>
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="mt-2 text-sm">Yükleniyor...</span>
              </div>
            ) : paginatedRows.length === 0 ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: MK_C.ink3, fontWeight: 600 }}>Kayıt bulunamadı.</div>
            ) : (
              <div className="flex flex-col" style={{ gap: 9 }}>
                {paginatedRows.map((r: MalKabulHeader & { id: string }, idx: number) => (
                  <div key={r.id} data-row-id={r.id} ref={r.id === openId ? focusRef : null}
                    className="grid items-center"
                    style={{ gridTemplateColumns: cols, gap: 16, padding: '14px 16px', borderRadius: MK_C.radius, background: MK_C.surfaceHi, boxShadow: r.id === openId ? `${MK_C.clayFlat}, 0 0 0 1.5px ${MK_C.accent}66` : MK_C.clayFlat, animation: `mkPopIn ${240 + Math.min(idx, 8) * 30}ms ease` }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: MK_C.ink1, fontFamily: 'ui-monospace, monospace', lineHeight: 1.4, wordBreak: 'break-all' }}>{r.transactionId || r.id}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: MK_C.ink2 }}>{r.depotName || '-'}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: MK_C.ink1 }}>{r.userName || '-'}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: MK_C.ink2, fontFamily: 'ui-monospace, monospace' }}>{formatTimestamp(r.timestamp, 'dd.MM.yyyy HH:mm')}</div>
                    <div style={{ textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 36, height: 30, padding: '0 10px', borderRadius: MK_C.radiusPill, background: MK_C.surface2, boxShadow: MK_C.clayInset, fontSize: 14, fontWeight: 800, color: MK_C.ink1 }}>{r.itemCount ?? 0}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(r.brands || []).map((b, i) => (
                        <span key={`${b}-${i}`} style={{ padding: '4px 10px', borderRadius: MK_C.radiusPill, background: `${MK_C.accent}14`, color: MK_C.accent, fontSize: 12, fontWeight: 700 }}>{b}</span>
                      ))}
                    </div>
                    <button onClick={() => openTransaction(r.id)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, padding: '0 16px', justifySelf: 'end', borderRadius: MK_C.radiusSm, background: `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: MK_C.clay, color: MK_C.accent, fontSize: 13.5, fontWeight: 700 }}>
                      <Eye className="h-[15px] w-[15px]" /> Detay
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* pagination */}
          <div className="flex items-center" style={{ padding: '16px 28px', borderTop: `1px solid ${MK_C.line}` }}>
            <button disabled={currentPage <= 1 || isLoading} onClick={() => setCurrentPage((p: number) => p - 1)} style={{ all: 'unset', cursor: (currentPage <= 1 || isLoading) ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 18px', borderRadius: MK_C.radiusSm, background: (currentPage <= 1) ? MK_C.surface2 : `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: (currentPage <= 1) ? MK_C.clayInset : MK_C.clay, color: (currentPage <= 1) ? MK_C.ink3 : MK_C.ink1, fontSize: 14, fontWeight: 700, opacity: (currentPage <= 1) ? 0.6 : 1 }}>
              <ChevronLeft className="h-[15px] w-[15px]" /> Önceki
            </button>
            <div className="flex-1" style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: MK_C.ink2 }}>Sayfa {currentPage} / {totalPages}</div>
            <button disabled={currentPage >= totalPages || isLoading} onClick={() => setCurrentPage((p: number) => p + 1)} style={{ all: 'unset', cursor: (currentPage >= totalPages || isLoading) ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 18px', borderRadius: MK_C.radiusSm, background: (currentPage >= totalPages) ? MK_C.surface2 : `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: (currentPage >= totalPages) ? MK_C.clayInset : MK_C.clay, color: (currentPage >= totalPages) ? MK_C.ink3 : MK_C.ink1, fontSize: 14, fontWeight: 700, opacity: (currentPage >= totalPages) ? 0.6 : 1 }}>
              Sonraki <ChevronRight className="h-[15px] w-[15px]" />
            </button>
          </div>
        </div>
      </div>

      <Dialog open={!!selectedTx} onOpenChange={(o: boolean) => !o && setSelectedTx(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
             <div className="flex justify-between items-start">
              <div>
                <DialogTitle>İşlem Detayı</DialogTitle>
                <DialogDescription>
                  {selectedTx ? `${selectedTx.depotName ?? '-'} • ${selectedTx.userName ?? '-'} • ${formatTimestamp(selectedTx.timestamp, 'dd.MM.yyyy HH:mm')}` : ''}
                </DialogDescription>
              </div>
              <Button variant="outline" size="sm" onClick={exportDetails}>
                  <FileSpreadsheet className="mr-2 h-4 w-4"/> Detaylı Excel
              </Button>
            </div>
          </DialogHeader>
          <div className="border rounded-lg">
            <ScrollArea className="max-h-[60vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stok Kodu</TableHead>
                    <TableHead>Adı</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Miad</TableHead>
                    <TableHead className="text-right">Adet</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linesLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin inline-block mr-2" />
                        Detaylar yükleniyor...
                      </TableCell>
                    </TableRow>
                  ) : lines.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-10">Detay yok.</TableCell></TableRow>
                  ) : (
                    lines.map((l: MalKabulLine, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{l.stokKodu}</TableCell>
                        <TableCell>{l.stokAdi}</TableCell>
                        <TableCell>{l.lotNumarasi || '-'}</TableCell>
                        <TableCell>{l.miad || '-'}</TableCell>
                        <TableCell className="text-right">{l.adet}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTx(null)}>Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
