'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, orderBy, query } from 'firebase/firestore';
import { getScopedDocs } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import { exportDataToExcel } from '@/lib/utils';
import { MK_C, MkClayStyles } from '@/components/mal-kabul/clay-kit';
import BackButton from '@/components/BackButton';
import { formatTimestamp } from '@/lib/time';
import { CheckSquare, ChevronLeft, ChevronRight, Download, Eye, FileSpreadsheet, History, Loader2, Tag } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const COLLECTION_NAME = 'malKabulTransactions';
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

type MalKabulRow = {
  id: string;
  transactionId?: string;
  depotId?: string;
  depotName?: string;
  userId?: string;
  userName?: string;
  timestamp?: any;
  itemCount?: number;
  brands?: string[];
};

type MalKabulLine = {
  stokKodu?: string;
  lotNumarasi?: string;
  miad?: string;
  adet?: number;
  serials?: string[];
};

function tsMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

export default function MalKabulGecmisPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [allRows, setAllRows] = useState<MalKabulRow[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  // Fetch ALL records via getScopedDocs which handles three cases:
  //   1) companyId == normalized  (current records)
  //   2) companyId == '__legacy__' (legacy-tagged records)
  //   3) unscoped + matchesCompanyScope (very old records without companyId field)
  // Using scopedQuery with a single where() clause silently excludes case 2 & 3,
  // which is why only the most recent (properly-tagged) records were showing.
  useEffect(() => {
    if (!currentCompanyId) return;
    let cancelled = false;
    setLoading(true);

    getScopedDocs(COLLECTION_NAME, currentCompanyId, isSuperAdmin)
      .then(docs => {
        if (cancelled) return;
        const rows = docs
          .map(d => ({ id: d.id, ...d.data() } as MalKabulRow))
          .sort((a, b) => tsMillis(b.timestamp) - tsMillis(a.timestamp));
        setAllRows(rows);
      })
      .catch((e: any) => {
        if (cancelled) return;
        toast({ title: 'Hata', description: e?.message || 'Kayıtlar yüklenemedi.', variant: 'destructive' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [currentCompanyId, isSuperAdmin, toast]);

  // Reset to page 1 when filter or page size changes
  useEffect(() => { setPage(1); }, [selectedBrand, pageSize]);

  // Brand list derived from fetched data — no separate Firestore round-trip needed
  const brands = useMemo(() => {
    const seen = new Set<string>();
    allRows.forEach(r => (r.brands || []).forEach(b => seen.add(b)));
    return [...seen].sort((a, b) => a.localeCompare(b, 'tr'));
  }, [allRows]);

  const filtered = useMemo(() => {
    if (!selectedBrand || selectedBrand === 'all') return allRows;
    return allRows.filter(r => (r.brands || []).includes(selectedBrand));
  }, [allRows, selectedBrand]);

  const rows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const cols = 'minmax(0,2.3fr) 130px minmax(0,1.1fr) 150px 70px minmax(0,1fr) 96px';

  const toggleTransaction = (id: string) => {
    setSelectedTransactions(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkExport = async () => {
    const selected = allRows.filter(row => selectedTransactions.has(row.id));
    if (selected.length === 0) {
      toast({ title: 'İşlem seçilmedi', description: 'Excel indirmek için en az bir işlem seçin.' });
      return;
    }

    setExporting(true);
    try {
      const transactionsWithLines = await Promise.all(selected.map(async transaction => {
        const transactionRef = doc(db, COLLECTION_NAME, transaction.id);
        const linesSnapshot = await getDocs(query(collection(transactionRef, 'lines'), orderBy('stokKodu')));
        return {
          transaction,
          lines: linesSnapshot.docs.map(line => line.data() as MalKabulLine),
        };
      }));

      const excelRows = transactionsWithLines.flatMap(({ transaction, lines }) =>
        lines.flatMap(line => {
          const serials = (line.serials || []).filter(Boolean);
          const common = {
            'İşlem No': transaction.transactionId || transaction.id,
            'İşlem Tarihi': formatTimestamp(transaction.timestamp, 'dd.MM.yyyy HH:mm'),
            'Markalar': (transaction.brands || []).join(', ') || '-',
            'Stok Kodu': line.stokKodu || '-',
            'Lot': line.lotNumarasi || '-',
            'Miad': line.miad || '-',
          };

          if (serials.length === 0) {
            return [{ ...common, 'Adet': line.adet ?? 0, 'Seri No': '' }];
          }

          const serialRows = serials.map(serial => ({ ...common, 'Adet': 1, 'Seri No': serial }));
          const unserializedQuantity = Math.max(0, (line.adet ?? serials.length) - serials.length);
          return unserializedQuantity > 0
            ? [...serialRows, { ...common, 'Adet': unserializedQuantity, 'Seri No': '' }]
            : serialRows;
        })
      );

      if (excelRows.length === 0) {
        toast({ title: 'Veri Yok', description: 'Seçilen işlemlerde dışa aktarılacak ürün bulunamadı.' });
        return;
      }

      exportDataToExcel(excelRows, `Mal_Kabul_Toplu_${new Date().toISOString().slice(0, 10)}`, 'Mal Kabul', toast);
      setBulkDialogOpen(false);
      setSelectedTransactions(new Set());
    } catch (error: any) {
      toast({ title: 'Excel oluşturulamadı', description: error?.message || 'İşlem detayları alınırken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mk-shell" style={{ padding: '20px 28px 40px' }}>
      <MkClayStyles />
      <div style={{ maxWidth: 1680, margin: '0 auto' }}>
        <div className="mb-4"><BackButton fallback="/mal-kabul" /></div>

        <div style={{ borderRadius: MK_C.radiusLg, background: `linear-gradient(180deg, ${MK_C.surface} 0%, ${MK_C.surface2} 100%)`, boxShadow: MK_C.clay, overflow: 'hidden' }}>

          {/* Header */}
          <div className="flex flex-wrap items-start gap-4" style={{ padding: '24px 28px', borderBottom: `1px solid ${MK_C.line}` }}>
            <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: MK_C.accent, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: MK_C.clayFlat }}>
              <History className="h-5 w-5" />
            </span>
            <div className="flex-1" style={{ minWidth: 220 }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: MK_C.ink1 }}>Mal Kabul İşlem Geçmişi</h1>
              <p style={{ margin: '5px 0 0', fontSize: 14, color: MK_C.ink2, fontWeight: 500 }}>Tüm mal kabul işlemleri. Marka ve sayfa boyutuna göre filtreleyin.</p>
              <div style={{ fontSize: 13, color: MK_C.ink3, fontWeight: 600, marginTop: 8 }}>
                {loading
                  ? 'Yükleniyor…'
                  : `Toplam ${totalCount} işlem · Sayfa ${page} / ${totalPages}`}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={loading || allRows.length === 0}
                onClick={() => setBulkDialogOpen(true)}
                className="cursor-pointer transition-opacity duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ height: 46, padding: '0 18px', display: 'inline-flex', alignItems: 'center', gap: 8, border: 0, borderRadius: MK_C.radiusSm, background: `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: MK_C.clay, color: MK_C.waterDeep, fontSize: 14, fontWeight: 700 }}
              >
                <FileSpreadsheet className="h-[18px] w-[18px]" /> Toplu İndir
              </button>
              {brands.length > 0 && (
                <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                  <SelectTrigger className="border-0" style={{ width: 180, height: 46, background: MK_C.surface2, boxShadow: MK_C.clayInset, borderRadius: MK_C.radiusSm }}>
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 flex-shrink-0" style={{ color: MK_C.accent }} />
                      <SelectValue placeholder="Tüm Markalar" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tüm Markalar</SelectItem>
                    {brands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
                <SelectTrigger className="border-0" style={{ width: 140, height: 46, background: MK_C.surface2, boxShadow: MK_C.clayInset, borderRadius: MK_C.radiusSm }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map(s => <SelectItem key={s} value={String(s)}>{s} / sayfa</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Column headers */}
          <div className="hidden md:grid" style={{ gridTemplateColumns: cols, gap: 16, padding: '16px 28px', borderBottom: `1px solid ${MK_C.line}` }}>
            {(['İşlem No', 'Depo', 'Kullanıcı', 'İşlem Zamanı', 'Kalem', 'Markalar', ''] as const).map((h, i) => (
              <div key={i} style={{ fontSize: 11.5, fontWeight: 700, color: MK_C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: i === 4 ? 'center' : 'left' }}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          <div style={{ padding: '12px 18px', minHeight: '40vh' }}>
            {loading ? (
              <div className="flex flex-col items-center justify-center" style={{ padding: '60px 0', color: MK_C.ink2 }}>
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="mt-2 text-sm font-semibold">Tüm geçmiş yükleniyor…</span>
              </div>
            ) : rows.length === 0 ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: MK_C.ink3, fontWeight: 600 }}>Kayıt bulunamadı.</div>
            ) : (
              <div className="flex flex-col" style={{ gap: 9 }}>
                {rows.map((r, idx) => (
                  <div key={r.id} className="grid items-center"
                    style={{ gridTemplateColumns: cols, gap: 16, padding: '14px 16px', borderRadius: MK_C.radius, background: MK_C.surfaceHi, boxShadow: MK_C.clayFlat, animation: `mkPopIn ${240 + Math.min(idx, 8) * 30}ms ease` }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: MK_C.ink1, fontFamily: 'ui-monospace, monospace', lineHeight: 1.4, wordBreak: 'break-all' }}>{r.transactionId || r.id}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: MK_C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.depotName || '-'}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: MK_C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.userName || '-'}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: MK_C.ink2, fontFamily: 'ui-monospace, monospace' }}>{formatTimestamp(r.timestamp, 'dd.MM.yyyy HH:mm')}</div>
                    <div style={{ textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 36, height: 30, padding: '0 10px', borderRadius: MK_C.radiusPill, background: MK_C.surface2, boxShadow: MK_C.clayInset, fontSize: 14, fontWeight: 800, color: MK_C.ink1 }}>{r.itemCount ?? 0}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(r.brands || []).map((b, i) => (
                        <span key={`${b}-${i}`} style={{ padding: '4px 10px', borderRadius: MK_C.radiusPill, background: `${MK_C.accent}14`, color: MK_C.accent, fontSize: 12, fontWeight: 700 }}>{b}</span>
                      ))}
                    </div>
                    <button onClick={() => router.push(`/mal-kabul/gecmis/${r.id}`)}
                      style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, padding: '0 16px', justifySelf: 'end', borderRadius: MK_C.radiusSm, background: `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: MK_C.clay, color: MK_C.accent, fontSize: 13.5, fontWeight: 700 }}>
                      <Eye className="h-[15px] w-[15px]" /> Detay
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!loading && totalCount > 0 && (
            <div className="flex items-center" style={{ padding: '16px 28px', borderTop: `1px solid ${MK_C.line}` }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                style={{ all: 'unset', cursor: page <= 1 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 18px', borderRadius: MK_C.radiusSm, background: page <= 1 ? MK_C.surface2 : `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: page <= 1 ? MK_C.clayInset : MK_C.clay, color: page <= 1 ? MK_C.ink3 : MK_C.ink1, fontSize: 14, fontWeight: 700, opacity: page <= 1 ? 0.6 : 1 }}>
                <ChevronLeft className="h-[15px] w-[15px]" /> Önceki
              </button>
              <div className="flex-1" style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: MK_C.ink2 }}>
                Sayfa {page} / {totalPages} &nbsp;·&nbsp; {totalCount} kayıt
              </div>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                style={{ all: 'unset', cursor: page >= totalPages ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 18px', borderRadius: MK_C.radiusSm, background: page >= totalPages ? MK_C.surface2 : `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: page >= totalPages ? MK_C.clayInset : MK_C.clay, color: page >= totalPages ? MK_C.ink3 : MK_C.ink1, fontSize: 14, fontWeight: 700, opacity: page >= totalPages ? 0.6 : 1 }}>
                Sonraki <ChevronRight className="h-[15px] w-[15px]" />
              </button>
            </div>
          )}

        </div>
      </div>

      <Dialog open={bulkDialogOpen} onOpenChange={open => !exporting && setBulkDialogOpen(open)}>
        <DialogContent className="max-w-3xl border-0 p-0" style={{ borderRadius: MK_C.radiusLg, background: MK_C.surface, boxShadow: MK_C.clay }}>
          <DialogHeader style={{ padding: '24px 28px 16px', borderBottom: `1px solid ${MK_C.line}` }}>
            <DialogTitle className="flex items-center gap-3" style={{ color: MK_C.ink1 }}>
              <CheckSquare className="h-5 w-5" style={{ color: MK_C.accent }} /> İşlemleri Seçin
            </DialogTitle>
            <DialogDescription style={{ color: MK_C.ink2 }}>
              İndirmek istediğiniz mal kabul işlemlerini marka ve işlem tarihine göre seçin.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3 px-7">
            <span className="text-sm font-semibold" style={{ color: MK_C.ink2 }}>{selectedTransactions.size} işlem seçildi</span>
            <button
              type="button"
              className="min-h-11 cursor-pointer rounded-lg px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2"
              style={{ color: MK_C.accent }}
              onClick={() => setSelectedTransactions(current => current.size === allRows.length ? new Set() : new Set(allRows.map(row => row.id)))}
            >
              {selectedTransactions.size === allRows.length && allRows.length > 0 ? 'Seçimi Temizle' : 'Tümünü Seç'}
            </button>
          </div>

          <div className="mx-7 max-h-[48vh] space-y-2 overflow-y-auto pr-1" role="group" aria-label="Mal kabul işlemleri">
            {allRows.map(row => {
              const checked = selectedTransactions.has(row.id);
              return (
                <label key={row.id} className="flex min-h-[60px] cursor-pointer items-center gap-4 rounded-xl px-4 py-3 transition-colors duration-200" style={{ background: checked ? `${MK_C.accent}12` : MK_C.surface2, boxShadow: checked ? `inset 0 0 0 2px ${MK_C.accent}55` : MK_C.clayFlat }}>
                  <Checkbox checked={checked} onCheckedChange={() => toggleTransaction(row.id)} aria-label={`${row.transactionId || row.id} işlemini seç`} className="h-5 w-5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold" style={{ color: MK_C.ink1 }}>{(row.brands || []).join(', ') || 'Marka belirtilmemiş'}</span>
                    <span className="mt-1 block text-xs font-semibold" style={{ color: MK_C.ink3 }}>{row.transactionId || row.id}</span>
                  </span>
                  <span className="shrink-0 text-right text-sm font-semibold" style={{ color: MK_C.ink2 }}>{formatTimestamp(row.timestamp, 'dd.MM.yyyy HH:mm')}</span>
                </label>
              );
            })}
          </div>

          <DialogFooter className="gap-2 px-7 pb-6 pt-2" style={{ borderTop: `1px solid ${MK_C.line}` }}>
            <button type="button" disabled={exporting} onClick={() => setBulkDialogOpen(false)} className="min-h-11 cursor-pointer rounded-xl px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50" style={{ color: MK_C.ink2, background: MK_C.surface2, boxShadow: MK_C.clayFlat }}>Vazgeç</button>
            <button type="button" disabled={exporting || selectedTransactions.size === 0} onClick={handleBulkExport} className="min-h-11 cursor-pointer rounded-xl px-5 text-sm font-bold text-white transition-opacity duration-200 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: MK_C.waterDeep, boxShadow: MK_C.clay }}>
              {exporting ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Hazırlanıyor…</> : <><Download className="mr-2 inline h-4 w-4" />Seçilenleri Excel'e İndir</>}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
