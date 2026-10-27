'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '../../../../../lib/data/client';
import { collection, doc, getDoc, getDocs, orderBy, query } from '../../../../../lib/data/client';
import { MK_C, MkClayStyles } from '@/components/mal-kabul/clay-kit';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { formatTimestamp } from '@/lib/time';
import { exportDataToExcel } from '@/lib/utils';
import { ArrowLeft, FileSpreadsheet, History, Loader2, Package } from 'lucide-react';

type MalKabulHeader = {
  transactionId?: string;
  depotId?: string;
  depotName?: string;
  userId?: string;
  userName?: string;
  timestamp?: any;
  itemCount?: number;
  brands?: string[];
  mode?: string;
};

type MalKabulLine = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  adet: number;
  serials?: string[];
};

export default function MalKabulGecmisDetayPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId } = useAuth();

  const txId = params?.id;

  const [header, setHeader] = useState<MalKabulHeader | null>(null);
  const [lines, setLines] = useState<MalKabulLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!txId) return;
    let mounted = true;
    (async () => {
      try {
        const docRef = doc(db, 'malKabulTransactions', txId);
        const [headerSnap, linesSnap] = await Promise.all([
          getDoc(docRef),
          getDocs(query(collection(docRef, 'lines'), orderBy('stokKodu'))),
        ]);
        if (!mounted) return;
        if (!headerSnap.exists()) {
          toast({ title: 'Bulunamadı', description: 'İşlem kaydı mevcut değil.', variant: 'destructive' });
          router.back();
          return;
        }
        setHeader(headerSnap.data() as MalKabulHeader);
        setLines(linesSnap.docs.map(d => d.data() as MalKabulLine));
      } catch (e: any) {
        if (!mounted) return;
        toast({ title: 'Hata', description: e?.message || 'Detaylar yüklenemedi.', variant: 'destructive' });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [txId, router, toast]);

  const handleExport = () => {
    if (!header || lines.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak detay bulunamadı.' });
      return;
    }
    const summaryData = lines.map(l => ({
      'Stok Kodu': l.stokKodu,
      'Stok Adı': l.stokAdi,
      'Lot': l.lotNumarasi,
      'Miad': l.miad,
      'Adet': l.adet,
    }));
    const serialsData = lines.flatMap(l =>
      (l.serials || []).map(s => ({
        'Stok Kodu': l.stokKodu,
        'Stok Adı': l.stokAdi,
        'Lot': l.lotNumarasi,
        'Seri Numarası': s,
      }))
    );
    exportDataToExcel(
      { 'Özet': summaryData, 'Seri Numaraları': serialsData },
      `MalKabul_${header.transactionId || txId}`,
      toast,
    );
  };

  const lineCols = 'minmax(0,1.2fr) minmax(0,2fr) minmax(0,1fr) 140px 80px';

  if (loading) {
    return (
      <div className="mk-shell" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <MkClayStyles />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: MK_C.ink2 }}>
          <Loader2 className="h-7 w-7 animate-spin" />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Detaylar yükleniyor…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mk-shell" style={{ padding: '20px 28px 40px' }}>
      <MkClayStyles />
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>

        {/* Back button */}
        <div className="mb-4">
          <button onClick={() => router.push('/mal-kabul/gecmis')}
            style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 16px', borderRadius: MK_C.radiusSm, background: `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: MK_C.clay, color: MK_C.ink1, fontSize: 13.5, fontWeight: 700 }}>
            <ArrowLeft className="h-4 w-4" /> Geçmişe Dön
          </button>
        </div>

        <div style={{ borderRadius: MK_C.radiusLg, background: `linear-gradient(180deg, ${MK_C.surface} 0%, ${MK_C.surface2} 100%)`, boxShadow: MK_C.clay, overflow: 'hidden' }}>

          {/* Header */}
          <div className="flex flex-wrap items-start gap-4" style={{ padding: '24px 28px', borderBottom: `1px solid ${MK_C.line}` }}>
            <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: MK_C.accent, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: MK_C.clayFlat }}>
              <History className="h-5 w-5" />
            </span>
            <div className="flex-1" style={{ minWidth: 220 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: MK_C.ink1 }}>İşlem Detayı</h1>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: MK_C.ink3, fontFamily: 'ui-monospace, monospace', marginTop: 4 }}>{header?.transactionId || txId}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: MK_C.ink2 }}>📦 {header?.depotName || '-'}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: MK_C.ink2 }}>👤 {header?.userName || '-'}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: MK_C.ink2, fontFamily: 'ui-monospace, monospace' }}>🕐 {formatTimestamp(header?.timestamp, 'dd.MM.yyyy HH:mm')}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: MK_C.ink2 }}>🔢 {header?.itemCount ?? lines.length} kalem</span>
              </div>
              {(header?.brands || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5" style={{ marginTop: 8 }}>
                  {(header?.brands || []).map((b, i) => (
                    <span key={`${b}-${i}`} style={{ padding: '4px 10px', borderRadius: MK_C.radiusPill, background: `${MK_C.accentA08}`, color: MK_C.accent, fontSize: 12, fontWeight: 700 }}>{b}</span>
                  ))}
                </div>
              )}
            </div>
            <button onClick={handleExport}
              style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, height: 46, padding: '0 18px', borderRadius: MK_C.radiusSm, background: `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: MK_C.clay, color: MK_C.waterDeep, fontSize: 14, fontWeight: 700 }}>
              <FileSpreadsheet className="h-[18px] w-[18px]" /> Excel
            </button>
          </div>

          {/* Column headers */}
          <div className="hidden md:grid" style={{ gridTemplateColumns: lineCols, gap: 16, padding: '16px 28px', borderBottom: `1px solid ${MK_C.line}` }}>
            {(['Stok Kodu', 'Stok Adı', 'Lot', 'Miad', 'Adet'] as const).map((h, i) => (
              <div key={i} style={{ fontSize: 11.5, fontWeight: 700, color: MK_C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: i === 4 ? 'center' : 'left' }}>{h}</div>
            ))}
          </div>

          {/* Lines */}
          <div style={{ padding: '12px 18px', minHeight: '30vh' }}>
            {lines.length === 0 ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: MK_C.ink3, fontWeight: 600 }}>
                <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                Detay satırı bulunamadı.
              </div>
            ) : (
              <div className="flex flex-col" style={{ gap: 8 }}>
                {lines.map((l, idx) => (
                  <div key={idx} className="grid items-center"
                    style={{ gridTemplateColumns: lineCols, gap: 16, padding: '13px 16px', borderRadius: MK_C.radius, background: MK_C.surfaceHi, boxShadow: MK_C.clayFlat, animation: `mkPopIn ${200 + Math.min(idx, 12) * 25}ms ease` }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: MK_C.ink1, fontFamily: 'ui-monospace, monospace' }}>{l.stokKodu}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: MK_C.ink1, lineHeight: 1.35 }}>{l.stokAdi}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: MK_C.ink2, fontFamily: 'ui-monospace, monospace' }}>{l.lotNumarasi || '-'}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: MK_C.ink2, fontFamily: 'ui-monospace, monospace' }}>{l.miad || '-'}</div>
                    <div style={{ textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 40, height: 32, padding: '0 10px', borderRadius: MK_C.radiusPill, background: MK_C.surface2, boxShadow: MK_C.clayInset, fontSize: 15, fontWeight: 800, color: MK_C.ink1 }}>{l.adet}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Summary footer */}
          {lines.length > 0 && (
            <div style={{ padding: '14px 28px', borderTop: `1px solid ${MK_C.line}`, display: 'flex', alignItems: 'center', gap: 20 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: MK_C.ink3 }}>{lines.length} çeşit ürün</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: MK_C.ink3 }}>
                Toplam {lines.reduce((s, l) => s + (l.adet || 0), 0)} adet
              </span>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
