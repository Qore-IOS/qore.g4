'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { getDocs, where } from 'firebase/firestore';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope } from '@/lib/company-scope';
import { isAvailableDepotStock } from '@/lib/stock-quantity';
import { useAuth } from '@/contexts/auth-context';
import { useDepots, useProductCodes, useHospitals, useLabPools, useDeviceLabPools, useAllMinMaxRules } from '@/hooks/useFirebaseQueries';
import type { DepoStokItem, Depot } from '@/lib/types';
import {
  AC, MlStyles, MlToast, MlPageHead, MLIco, useContainerMode, type Mode,
} from '@/components/maliyet/ml-primitives';
import { buildStokToHospitals, buildLabGroups, resolveDepotLabs } from './depo-logic';
import DepoCount from './DepoCount';

const nameOf = (x: any) => x?.name || x?.ad || '—';

export default function DepoSayimPanel() {
  const router = useRouter();
  const { currentCompanyId, isSuperAdmin } = useAuth() as any;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const mode: Mode = useContainerMode(rootRef);

  const depotsQ = useDepots();
  const productsQ = useProductCodes();
  const hospitalsQ = useHospitals();
  const labPoolsQ = useLabPools();
  const deviceLabPoolsQ = useDeviceLabPools();
  const depots = (depotsQ.data ?? []) as Depot[];
  const productCodes = productsQ.data ?? [];
  const hospitals = hospitalsQ.data ?? [];
  const labPools = labPoolsQ.data ?? [];
  const deviceLabPools = deviceLabPoolsQ.data ?? [];

  const [selectedDepot, setSelectedDepot] = React.useState<Depot | null>(null);
  const [depotStock, setDepotStock] = React.useState<DepoStokItem[]>([]);
  const [loadingStock, setLoadingStock] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [toast, setToast] = React.useState<any>(null);
  const toastRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fire = (t: any) => { if (toastRef.current) clearTimeout(toastRef.current); setToast({ ...t, id: Date.now() }); toastRef.current = setTimeout(() => setToast(null), 2400); };

  /* the depot's linked labs (perifer excluded) — the only labs to categorize by */
  const linkedLabs = React.useMemo(() => resolveDepotLabs(selectedDepot || undefined, deviceLabPools as any, hospitals as any), [selectedDepot, deviceLabPools, hospitals]);
  const linkedLabIds = React.useMemo(() => linkedLabs.map((h: any) => h.id), [linkedLabs]);
  const rulesQ = useAllMinMaxRules(linkedLabIds);

  /* load ONLY the selected depot's stock (nothing before a depot is chosen) */
  React.useEffect(() => {
    if (!selectedDepot) { setDepotStock([]); return; }
    let alive = true;
    setLoadingStock(true);
    getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('depotId', '==', selectedDepot.id)) as any)
      .then((snap) => {
        const docs = filterByCompanyScope(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })), currentCompanyId, isSuperAdmin) as DepoStokItem[];
        if (alive) setDepotStock(docs.filter(isAvailableDepotStock));
      })
      .catch((e) => { console.error('depoStok load', e); fire({ title: 'Stok yüklenemedi' }); })
      .finally(() => { if (alive) setLoadingStock(false); });
    return () => { alive = false; };
  }, [selectedDepot, currentCompanyId, isSuperAdmin]);

  const labGroups = React.useMemo(() => {
    if (!selectedDepot || depotStock.length === 0) return [];
    const stokToHospitals = buildStokToHospitals(rulesQ.data || {});
    return buildLabGroups(depotStock, productCodes, stokToHospitals, hospitals, labPools);
  }, [selectedDepot, depotStock, productCodes, rulesQ.data, hospitals, labPools]);

  // productCodes (slow server action) is only needed for barcode resolution, not for
  // grouping/display — depoStok carries stokAdi/urunGrubu/ambalaj + real serials.
  const countReady = !loadingStock && !rulesQ.isLoading && !hospitalsQ.isLoading;

  const shownDepots = (depots as any[]).filter((d) => nameOf(d).toLowerCase().includes(q.toLowerCase()));
  const pad = mode === 'mobile' ? '16px 14px 40px' : '24px 30px 48px';
  const loaderBox = (label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.4em', color: 'var(--ink-3)', textTransform: 'uppercase', animation: 'mlLivePulse 1.6s ease-in-out infinite' }}>{label}</span>
    </div>
  );

  return (
    <div ref={rootRef} className="ml-root" style={{ minHeight: '100vh', width: '100%' }}>
      <MlStyles />
      {selectedDepot ? (
        !countReady ? (
          loaderBox('Depo Stoğu Yükleniyor')
        ) : labGroups.length === 0 ? (
          <div style={{ padding: pad }}>
            <MlPageHead ico="building" title={nameOf(selectedDepot)} sub="Depo sayımı" ac={AC} onBack={() => setSelectedDepot(null)} mobile={mode === 'mobile'} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '50px 30px', textAlign: 'center' }}>
              <span style={{ width: 70, height: 70, borderRadius: '28%', display: 'grid', placeItems: 'center', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-3)' }}><MLIco.box s={32} /></span>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-1)' }}>Bu depoda sayılacak stok yok</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 500 }}>Depoya bağlı laboratuvarlarda kayıtlı (sevk edilmemiş) ürün bulunamadı.</div>
            </div>
          </div>
        ) : (
          <DepoCount ac={AC} mode={mode} depot={{ id: selectedDepot.id, name: nameOf(selectedDepot) }} groups={labGroups} productCodes={productCodes} onBack={() => setSelectedDepot(null)} fire={fire} />
        )
      ) : (
        <div style={{ padding: pad, maxWidth: 900, margin: '0 auto' }}>
          <MlPageHead ico="building" title="Depo Sayım" sub="Sayım yapılacak depoyu seçin" ac={AC} mobile={mode === 'mobile'} />
          <button
            type="button"
            onClick={() => router.push('/depo-sayim/gecmis')}
            style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', minHeight: 46, marginBottom: 14, borderRadius: 'var(--radius-pill)', background: `${AC.primary}16`, color: AC.primary, fontSize: 14, fontWeight: 800 }}
          >
            <MLIco.history s={18} /> Sayım Geçmişini Görüntüle
          </button>
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', display: 'inline-flex' }}><MLIco.search s={18} /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Depo ara…" style={{ width: '100%', boxSizing: 'border-box', height: 52, padding: '0 16px 0 46px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-1)', fontSize: 15, fontWeight: 500, fontFamily: 'inherit', outline: 'none' }} />
          </div>
          {depotsQ.isLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase', fontSize: 12 }}>Depolar Yükleniyor</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {shownDepots.map((d, i) => (
                <button key={d.id} onClick={() => setSelectedDepot(d)}
                  style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 14, padding: '15px 18px', borderRadius: 'var(--radius)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)', animation: `mlPopIn ${180 + Math.min(i, 12) * 40}ms var(--ease-fluid)`, transition: 'transform 160ms var(--ease-fluid)' }}
                  onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(0.99)')} onPointerUp={(e) => (e.currentTarget.style.transform = '')} onPointerLeave={(e) => (e.currentTarget.style.transform = '')}>
                  <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, display: 'grid', placeItems: 'center', color: AC.primary, background: `${AC.primary}16` }}><MLIco.building s={20} /></span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: 'var(--ink-1)' }}>{nameOf(d)}</span>
                  <MLIco.chevR s={18} />
                </button>
              ))}
              {shownDepots.length === 0 && (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontWeight: 600 }}>Depo bulunamadı</div>
              )}
            </div>
          )}
        </div>
      )}
      <MlToast toast={toast} ac={AC} />
    </div>
  );
}
