'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { getScopedDocs } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import { MK_C, MkClayStyles } from '@/components/mal-kabul/clay-kit';
import BackButton from '@/components/BackButton';
import { formatTimestamp } from '@/lib/time';
import { ChevronLeft, ChevronRight, Eye, History, Loader2, Tag } from 'lucide-react';
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
    </div>
  );
}
