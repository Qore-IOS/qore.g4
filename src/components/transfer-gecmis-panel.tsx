'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Building2, CalendarClock, ChevronLeft, ChevronRight, Eye, History, Loader2, Package2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  onSnapshot,
  orderBy,
  where,
  limit,
  startAfter,
  getDocsFromServer,
  getCountFromServer,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { Transfer, Depot, Hospital } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import BackButton from '@/components/BackButton';
import { transferGecmisLogger } from '@/lib/logger';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { LabSelector } from '@/components/common/LabSelector';
import { MK_C, MkClayStyles } from '@/components/mal-kabul/clay-kit';
import { useRowFocus } from '@/hooks/useRowFocus';

export default function TransferGecmisPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const depotIdFromUrl = searchParams.get('depotId') || '';
  const labIdFromUrl = searchParams.get('labId') || 'all';
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [depots, setDepots] = useState<Depot[]>([]);
  const [labs, setLabs] = useState<Hospital[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>(depotIdFromUrl);
  const [selectedLabId, setSelectedLabId] = useState<string>(labIdFromUrl);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState<number>(0);

  const [rowsPerPage, setRowsPerPage] = useState<number>(20);
  const [page, setPage] = useState<number>(1);

  const cursorStackRef = useRef<QueryDocumentSnapshot[]>([]);

  useRowFocus('focus');

  useEffect(() => {
    const unsub = onSnapshot(scopedQuery('depots', currentCompanyId, isSuperAdmin), snap => {
      const depotList = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setDepots(depotList);
      if (!selectedDepotId && depotList.length > 0) {
        setSelectedDepotId(depotList[0].id);
      }
    });
    return () => unsub();
  }, [selectedDepotId, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    const unsub = onSnapshot(scopedQuery('hospitals', currentCompanyId, isSuperAdmin), snap => {
      setLabs(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [currentCompanyId, isSuperAdmin]);

  const fetchTotalCount = useCallback(async (depotId: string, labId: string) => {
    if (!depotId) { setTotalCount(0); return; }
    try {
      const filters = [where('sourceDepotId', '==', depotId)];
      if (labId && labId !== 'all') filters.push(where('targetHospitalId', '==', labId));
      const snap = await getCountFromServer(scopedQuery('transfers', currentCompanyId, isSuperAdmin, ...filters));
      setTotalCount(snap.data().count);
    } catch (error) {
      transferGecmisLogger.error('Transfer sayısı alınamadı', error as Error, { depotId, labId });
      setTotalCount(0);
    }
  }, [currentCompanyId, isSuperAdmin]);

  const fetchTransfers = useCallback(async (
    depotId: string,
    labId: string,
    pageNum: number,
    pageSize: number,
    cursors: QueryDocumentSnapshot[],
  ) => {
    if (!depotId) { setTransfers([]); setLoading(false); return; }
    setLoading(true);
    try {
      const filters = [where('sourceDepotId', '==', depotId)];
      if (labId && labId !== 'all') filters.push(where('targetHospitalId', '==', labId));
      const cursor = pageNum > 1 ? cursors[pageNum - 2] : undefined;
      const q = cursor
        ? scopedQuery('transfers', currentCompanyId, isSuperAdmin, ...filters, orderBy('timestamp', 'desc'), startAfter(cursor), limit(pageSize))
        : scopedQuery('transfers', currentCompanyId, isSuperAdmin, ...filters, orderBy('timestamp', 'desc'), limit(pageSize));

      const snapshot = await getDocsFromServer(q);
      const data = snapshot.docs.map(d => {
        const docData = d.data();
        return {
          id: d.id,
          ...docData,
          timestamp: docData.timestamp?.toDate ? docData.timestamp.toDate() : new Date(),
        } as Transfer;
      });

      if (snapshot.docs.length > 0) {
        const nc = [...cursors];
        nc[pageNum - 1] = snapshot.docs[snapshot.docs.length - 1];
        cursorStackRef.current = nc;
      }
      setTransfers(data);
      transferGecmisLogger.info('Transfer geçmişi yüklendi', { depotId, labId, page: pageNum, count: data.length });
    } catch (error) {
      transferGecmisLogger.error('Transfer geçmişi yüklenemedi', error as Error, { depotId, labId });
      toast({ title: 'Hata', description: 'Transfer geçmişi yüklenirken bir hata oluştu.', variant: 'destructive' });
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, isSuperAdmin, toast]);

  useEffect(() => {
    setPage(1);
    cursorStackRef.current = [];
    if (selectedDepotId) void fetchTotalCount(selectedDepotId, selectedLabId);
  }, [selectedDepotId, selectedLabId, rowsPerPage, fetchTotalCount]);

  useEffect(() => {
    void fetchTransfers(selectedDepotId, selectedLabId, page, rowsPerPage, cursorStackRef.current);
  }, [selectedDepotId, selectedLabId, page, rowsPerPage, fetchTransfers]);

  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));

  const cols = '150px minmax(0,2fr) minmax(0,1.2fr) minmax(0,1fr) 80px 96px';

  return (
    <div className="mk-shell" style={{ padding: '20px 28px 40px' }}>
      <MkClayStyles />
      <div style={{ maxWidth: 1680, margin: '0 auto' }}>
        <div className="mb-4"><BackButton fallback="/direkt-transfer" /></div>

        <div style={{ borderRadius: MK_C.radiusLg, background: `linear-gradient(180deg, ${MK_C.surface} 0%, ${MK_C.surface2} 100%)`, boxShadow: MK_C.clay, overflow: 'hidden' }}>

          {/* Header */}
          <div className="flex flex-wrap items-start gap-4" style={{ padding: '24px 28px', borderBottom: `1px solid ${MK_C.line}` }}>
            <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: MK_C.accent, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: MK_C.clayFlat }}>
              <Package2 className="h-5 w-5" />
            </span>
            <div className="flex-1" style={{ minWidth: 220 }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: MK_C.ink1 }}>Transfer Geçmişi</h1>
              <p style={{ margin: '5px 0 0', fontSize: 14, color: MK_C.ink2, fontWeight: 500 }}>Depodan yapılan tüm direkt transfer işlemleri.</p>
              <div style={{ fontSize: 13, color: MK_C.ink3, fontWeight: 600, marginTop: 8 }}>
                {loading ? 'Yükleniyor…' : `Toplam ${totalCount} transfer · Sayfa ${page} / ${totalPages}`}
              </div>
            </div>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Building2 className="h-4 w-4 flex-shrink-0" style={{ color: MK_C.accent }} />
                <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
                  <SelectTrigger className="border-0" style={{ width: 180, height: 46, background: MK_C.surface2, boxShadow: MK_C.clayInset, borderRadius: MK_C.radiusSm }}>
                    <SelectValue placeholder="Depo Seçin…" />
                  </SelectTrigger>
                  <SelectContent>
                    {depots.map(d => <SelectItem key={d.id} value={d.id}>{d.name || d.id}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CalendarClock className="h-4 w-4 flex-shrink-0" style={{ color: MK_C.accent }} />
                <div style={{ width: 200 }}>
                  <LabSelector
                    labs={labs.map(l => ({ id: l.id, name: l.name || l.id, kod: l.kod }))}
                    value={selectedLabId}
                    onChange={setSelectedLabId}
                    placeholder="Tüm Laboratuvarlar"
                    allOption={{ value: 'all', label: 'Tüm Laboratuvarlar' }}
                    icon={false}
                  />
                </div>
              </div>
              <Select value={String(rowsPerPage)} onValueChange={v => setRowsPerPage(Number(v))}>
                <SelectTrigger className="border-0" style={{ width: 140, height: 46, background: MK_C.surface2, boxShadow: MK_C.clayInset, borderRadius: MK_C.radiusSm }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[20, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n} / sayfa</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Column headers */}
          <div className="hidden md:grid" style={{ gridTemplateColumns: cols, gap: 16, padding: '16px 28px', borderBottom: `1px solid ${MK_C.line}` }}>
            {(['İşlem Zamanı', 'Hedef', 'Kaynak Depo', 'Personel', 'Adet', ''] as const).map((h, i) => (
              <div key={i} style={{ fontSize: 11.5, fontWeight: 700, color: MK_C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: i === 4 ? 'center' : 'left' }}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          <div style={{ padding: '12px 18px', minHeight: '40vh' }}>
            {loading ? (
              <div className="flex flex-col items-center justify-center" style={{ padding: '60px 0', color: MK_C.ink2 }}>
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="mt-2 text-sm">Yükleniyor...</span>
              </div>
            ) : !selectedDepotId ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: MK_C.ink3, fontWeight: 600 }}>Depo seçin.</div>
            ) : transfers.length === 0 ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: MK_C.ink3, fontWeight: 600 }}>Bu depo için transfer kaydı bulunamadı.</div>
            ) : (
              <div className="flex flex-col" style={{ gap: 9 }}>
                {transfers.map((t, idx) => {
                  const personName = t.userName || (t as any).createdByName || (t as any).createdBy || '-';
                  const ts = t.timestamp instanceof Date ? t.timestamp : (t.timestamp as any)?.toDate?.();
                  const dateStr = ts ? formatDate(ts, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-';
                  return (
                    <div key={t.id} data-row-id={t.id} className="grid items-center"
                      style={{ gridTemplateColumns: cols, gap: 16, padding: '14px 16px', borderRadius: MK_C.radius, background: MK_C.surfaceHi, boxShadow: MK_C.clayFlat, animation: `mkPopIn ${240 + Math.min(idx, 8) * 30}ms ease` }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: MK_C.ink2, fontFamily: 'ui-monospace, monospace' }}>{dateStr}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: MK_C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.targetName || '-'}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: MK_C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.sourceDepotName || '-'}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: MK_C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{personName}</div>
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 36, height: 30, padding: '0 10px', borderRadius: MK_C.radiusPill, background: MK_C.surface2, boxShadow: MK_C.clayInset, fontSize: 14, fontWeight: 800, color: MK_C.ink1 }}>{t.itemCount ?? 0}</span>
                      </div>
                      <button onClick={() => router.push(`/transfer-gecmis/${t.id}?depotId=${selectedDepotId}&labId=${selectedLabId}`)}
                        style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, padding: '0 16px', justifySelf: 'end', borderRadius: MK_C.radiusSm, background: `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: MK_C.clay, color: MK_C.accent, fontSize: 13.5, fontWeight: 700 }}>
                        <Eye className="h-[15px] w-[15px]" /> Detay
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pagination */}
          <div className="flex items-center" style={{ padding: '16px 28px', borderTop: `1px solid ${MK_C.line}` }}>
            <button disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}
              style={{ all: 'unset', cursor: (page <= 1 || loading) ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 18px', borderRadius: MK_C.radiusSm, background: page <= 1 ? MK_C.surface2 : `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: page <= 1 ? MK_C.clayInset : MK_C.clay, color: page <= 1 ? MK_C.ink3 : MK_C.ink1, fontSize: 14, fontWeight: 700, opacity: page <= 1 ? 0.6 : 1 }}>
              <ChevronLeft className="h-[15px] w-[15px]" /> Önceki
            </button>
            <div className="flex-1" style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: MK_C.ink2 }}>Sayfa {page} / {totalPages}</div>
            <button disabled={page >= totalPages || loading} onClick={() => setPage(p => p + 1)}
              style={{ all: 'unset', cursor: (page >= totalPages || loading) ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 18px', borderRadius: MK_C.radiusSm, background: page >= totalPages ? MK_C.surface2 : `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: page >= totalPages ? MK_C.clayInset : MK_C.clay, color: page >= totalPages ? MK_C.ink3 : MK_C.ink1, fontSize: 14, fontWeight: 700, opacity: page >= totalPages ? 0.6 : 1 }}>
              Sonraki <ChevronRight className="h-[15px] w-[15px]" />
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
