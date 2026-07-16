'use client';

import React from 'react';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { scopedQuery } from '@/lib/firestore-helpers';
import { normalizeCompanyId } from '@/lib/company-scope';
import { useAuth } from '@/contexts/auth-context';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';
import useHidScanner from '@/hooks/useHidScanner';
import { parseAndResolveBarcode } from '@/lib/barcode';
import { subscribeToSession, updateSessionCountData, completeSession, type MaliyetSayimOturum } from '@/lib/maliyet-session';
import type { ProductCode, MinMaxRule } from '@/lib/types';
import {
  AC, MLIco, MlBtn, MlIconBtn, MlPill, MlModal, MlModalHead, MlNum, MlBar, MlRing,
  type Accent, type Mode,
} from './ml-primitives';
import {
  type ProductCountEntry, type LocationType, type CostByCurrency,
  calcProductCost, productTotalTests, formatCosts, currencySymbol, urunGrubuLabel,
  getBrandsFromRules, getProductsForBrandFromRules, normalizeText,
} from './ml-logic';

const money = (amount: number, currency?: string) =>
  amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + currencySymbol(currency);

interface CountProps {
  ac?: Accent; mode: Mode; loc: { id: string; name: string }; kind: LocationType;
  productCodes: ProductCode[]; onBack: () => void; fire: (t: any) => void;
  session?: MaliyetSayimOturum | null;
}

export default function MlCount({ ac = AC, mode, loc, kind, productCodes, onBack, fire, session }: CountProps) {
  const mobile = mode === 'mobile', tablet = mode === 'tablet';
  const { currentUser, currentUserProfile, currentCompanyId } = useAuth() as any;
  const collaborative = !!session;

  const [rules, setRules] = React.useState<MinMaxRule[]>([]);
  const [loadingRules, setLoadingRules] = React.useState(true);
  const [countData, setCountData] = React.useState<Record<string, ProductCountEntry>>({});
  const [activeBrand, setActiveBrand] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');
  const [onlyEmpty, setOnlyEmpty] = React.useState(false);
  const [railOpen, setRailOpen] = React.useState(false);
  const [scannerActive, setScannerActive] = React.useState(false);
  const [voiceActive, setVoiceActive] = React.useState(false);
  const [focusTarget, setFocusTarget] = React.useState<{ stokKodu: string; field: 'box' | 'test' } | null>(null);
  const [completingRows, setCompletingRows] = React.useState<Set<string>>(() => new Set());
  const [saving, setSaving] = React.useState(false);
  const recognitionRef = React.useRef<any>(null);
  const activeBrandRef = React.useRef<string | null>(null);
  React.useEffect(() => { activeBrandRef.current = activeBrand; }, [activeBrand]);

  const barcodeFormats = useSafeBarcodeFormats();

  /* fetch location min/max rules → drives the brand list */
  React.useEffect(() => {
    let alive = true;
    setLoadingRules(true);
    const path = kind === 'lab' ? `hospitals/${loc.id}/minMaxRules` : `depots/${loc.id}/minMaxRules`;
    getDocs(collection(db, path))
      .then(snap => { if (alive) setRules(snap.docs.map(d => ({ id: d.id, ...d.data() } as any))); })
      .catch(err => { console.error('minMaxRules', err); })
      .finally(() => { if (alive) setLoadingRules(false); });
    return () => { alive = false; };
  }, [kind, loc.id]);

  /* collaborative: merge remote countData */
  React.useEffect(() => {
    if (!collaborative || !session?.id) return;
    const unsub = subscribeToSession(session.id, (s) => {
      if (!s?.countData) return;
      setCountData(prev => {
        const next = { ...prev };
        Object.entries(s.countData!).forEach(([stokKodu, remote]: any) => {
          const base = next[stokKodu] || emptyEntry(stokKodu, remote.stokAdi, remote.marka);
          next[stokKodu] = { ...base, stokAdedi: String(remote.stokAdedi ?? base.stokAdedi ?? ''), cihazUstuAdedi: String(remote.cihazUstuAdedi ?? base.cihazUstuAdedi ?? ''), counted: !!remote.counted };
        });
        return next;
      });
    });
    return unsub;
  }, [collaborative, session?.id]);

  const brands = React.useMemo(() => getBrandsFromRules(rules, productCodes), [rules, productCodes]);
  React.useEffect(() => { if (!activeBrand && brands.length) setActiveBrand(brands[0]); }, [brands, activeBrand]);

  const productsByBrand = React.useMemo(() => {
    const map: Record<string, ProductCode[]> = {};
    brands.forEach(b => { map[b] = getProductsForBrandFromRules(b, rules, productCodes); });
    return map;
  }, [brands, rules, productCodes]);

  const entryFor = (p: ProductCode): ProductCountEntry => countData[p.stokKodu] || emptyEntry(p.stokKodu, p.stokAdi, p.marka || '');
  const hasValue = (value?: string | number | null) => String(value ?? '').trim() !== '';
  const isCounted = (p: ProductCode) => {
    const e = countData[p.stokKodu];
    if (!e) return false;
    return !!e.counted;
  };

  const brandStats = (b: string) => {
    const list = productsByBrand[b] || [];
    const c = list.filter(isCounted).length;
    const costs: CostByCurrency = { TRY: 0, EUR: 0, USD: 0 };
    list.forEach(p => { const { amount, currency } = calcProductCost(p, countData[p.stokKodu]); (costs as any)[currency] += amount; });
    return { c, total: list.length, pct: list.length ? Math.round((c / list.length) * 100) : 0, costs };
  };

  const allProducts = React.useMemo(() => brands.flatMap(b => productsByBrand[b] || []), [brands, productsByBrand]);
  const countedN = allProducts.filter(isCounted).length;
  const totalN = allProducts.length;
  const globalPct = totalN ? Math.round((countedN / totalN) * 100) : 0;
  const brandsDone = brands.filter(b => { const s = brandStats(b); return s.total > 0 && s.c === s.total; }).length;
  const grandTests = allProducts.reduce((a, p) => a + productTotalTests(p, countData[p.stokKodu]), 0);
  const grandCosts = React.useMemo(() => {
    const c: CostByCurrency = { TRY: 0, EUR: 0, USD: 0 };
    allProducts.forEach(p => { const { amount, currency } = calcProductCost(p, countData[p.stokKodu]); (c as any)[currency] += amount; });
    return c;
  }, [allProducts, countData]);
  const grandCostStr = formatCosts(grandCosts) || '0₺';

  const brand = activeBrand;
  const brandList = brand ? (productsByBrand[brand] || []) : [];
  const st = brand ? brandStats(brand) : { c: 0, total: 0, pct: 0, costs: { TRY: 0, EUR: 0, USD: 0 } };

  /* ── mutations ── */
  const syncRemote = (stokKodu: string, field: string, value: any, entry: ProductCountEntry) => {
    if (!collaborative || !session?.id || !currentUser) return;
    updateSessionCountData(session.id, stokKodu, field, value, { uid: currentUser.uid, name: currentUserProfile?.name || '' }, { stokKodu, stokAdi: entry.stokAdi, marka: entry.marka, stokAdedi: parseInt(entry.stokAdedi, 10) || 0, cihazUstuAdedi: parseInt(entry.cihazUstuAdedi, 10) || 0, counted: entry.counted }).catch(console.error);
  };
  const setField = (p: ProductCode, field: 'stokAdedi' | 'cihazUstuAdedi', val: string) => {
    const clean = val.replace(/[^0-9]/g, '');
    setCountData(prev => {
      const base = prev[p.stokKodu] || emptyEntry(p.stokKodu, p.stokAdi, p.marka || '');
      const next = { ...base, [field]: clean };
      syncRemote(p.stokKodu, field, parseInt(clean, 10) || 0, next);
      return { ...prev, [p.stokKodu]: next };
    });
  };
  const completeProduct = (p: ProductCode) => {
    setCountData(prev => {
      const base = prev[p.stokKodu] || emptyEntry(p.stokKodu, p.stokAdi, p.marka || '');
      const next = { ...base, counted: true, stokAdedi: base.stokAdedi === '' ? '0' : base.stokAdedi, cihazUstuAdedi: base.cihazUstuAdedi === '' ? '0' : base.cihazUstuAdedi };
      syncRemote(p.stokKodu, 'counted', true, next);
      return { ...prev, [p.stokKodu]: next };
    });
    fire({ tone: 'ok', title: 'Satır tamamlandı' });
  };

  const autoCompleteProduct = (p: ProductCode, cihazValue: string, nextProduct?: ProductCode) => {
    const cleanCihazValue = cihazValue.replace(/[^0-9]/g, '');
    const currentEntry = countData[p.stokKodu] || emptyEntry(p.stokKodu, p.stokAdi, p.marka || '');
    if (!hasValue(currentEntry.stokAdedi) || !hasValue(cleanCihazValue) || currentEntry.counted) return;

    setCompletingRows(prev => new Set(prev).add(p.stokKodu));

    window.setTimeout(() => {
      setCountData(prev => {
        const base = prev[p.stokKodu] || emptyEntry(p.stokKodu, p.stokAdi, p.marka || '');
        if (!hasValue(base.stokAdedi) || !hasValue(cleanCihazValue) || base.counted) return prev;
        const next = { ...base, cihazUstuAdedi: cleanCihazValue, counted: true };
        syncRemote(p.stokKodu, 'counted', true, next);
        return { ...prev, [p.stokKodu]: next };
      });
      setCompletingRows(prev => { const next = new Set(prev); next.delete(p.stokKodu); return next; });
      if (nextProduct) setFocusTarget({ stokKodu: nextProduct.stokKodu, field: 'box' });
    }, 280);
  };
  const completeBrand = () => {
    if (!brand) return;
    setCountData(prev => {
      const next = { ...prev };
      brandList.forEach(p => { const base = next[p.stokKodu] || emptyEntry(p.stokKodu, p.stokAdi, p.marka || ''); const upd = { ...base, counted: true, stokAdedi: base.stokAdedi === '' ? '0' : base.stokAdedi, cihazUstuAdedi: base.cihazUstuAdedi === '' ? '0' : base.cihazUstuAdedi }; next[p.stokKodu] = upd; syncRemote(p.stokKodu, 'counted', true, upd); });
      return next;
    });
    fire({ tone: 'ok', title: `${brand} tamamlandı`, sub: `${brandList.length} ürün sayıldı` });
    const idx = brands.indexOf(brand);
    const nextB = brands.slice(idx + 1).find(b => { const s = brandStats(b); return s.c < s.total; });
    if (nextB) { setActiveBrand(nextB); if (mobile) setRailOpen(false); }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const counted = allProducts.filter(isCounted);
    const items = counted.map(p => { const e = countData[p.stokKodu]; return { stokKodu: p.stokKodu, stokAdi: p.stokAdi, marka: p.marka || '', stokAdedi: parseInt(e?.stokAdedi || '0', 10) || 0, cihazUstuAdedi: parseInt(e?.cihazUstuAdedi || '0', 10) || 0 }; });
    fire({ tone: 'ok', title: 'Sayım kaydediliyor', sub: `${counted.length}/${totalN} ürün · ${grandCostStr}` });
    onBack();
    try {
      if (collaborative && session?.id) {
        const finalItems = counted.map(p => { const e = countData[p.stokKodu]; const si = session.countData?.[p.stokKodu] as any; return { stokKodu: p.stokKodu, stokAdi: p.stokAdi, marka: p.marka || '', stokAdedi: parseInt(e?.stokAdedi || '0', 10) || 0, cihazUstuAdedi: parseInt(e?.cihazUstuAdedi || '0', 10) || 0, countedByUid: si?.countedByUid || currentUser?.uid || '', countedByName: si?.countedByName || currentUserProfile?.name || '', updates: si?.updates || [] }; });
        await completeSession(session.id, finalItems as any, { locationType: kind, locationId: loc.id, locationName: loc.name, createdByUid: session.createdByUid, createdByName: session.createdByName, totalBrands: brands.length, participants: session.participants, companyId: currentCompanyId });
      } else {
        await addDoc(collection(db, 'maliyetSayimSessions'), {
          locationType: kind, locationId: loc.id, locationName: loc.name, createdAt: serverTimestamp(),
          createdByUid: currentUser?.uid ?? '', createdByName: currentUserProfile?.name ?? '',
          items, totalBrands: brands.length, totalProducts: items.length, companyId: normalizeCompanyId(currentCompanyId),
        });
      }
    } catch (e) { console.error(e); }
  };

  /* ── barcode ── */
  const handleScan = React.useCallback(({ raw }: { raw: string }) => {
    if (!raw) return;
    const res = parseAndResolveBarcode(raw.trim(), barcodeFormats as any, productCodes);
    let found = res?.product || productCodes.find(p => p.barcodeNumber === raw || p.stokKodu === raw);
    if (!found) { fire({ title: 'Ürün bulunamadı' }); return; }
    const ruleSet = new Set(rules.map(r => r.stokKodu));
    if (ruleSet.size && !ruleSet.has(found.stokKodu)) { fire({ title: 'Bu lokasyonda tanımlı değil' }); return; }
    if (found.marka && found.marka !== activeBrandRef.current) setActiveBrand(found.marka);
    setCountData(prev => {
      const base = prev[found!.stokKodu] || emptyEntry(found!.stokKodu, found!.stokAdi, found!.marka || '');
      const cur = parseInt(base.stokAdedi || '0', 10) || 0;
      const next = { ...base, stokAdedi: String(cur + 1), counted: true };
      syncRemote(found!.stokKodu, 'stokAdedi', cur + 1, next);
      return { ...prev, [found!.stokKodu]: next };
    });
    fire({ tone: 'ok', title: `${found.stokAdi} +1` });
  }, [barcodeFormats, productCodes, rules]);
  useHidScanner({ enabled: scannerActive, allowDuringInputs: false, onScan: handleScan } as any);

  /* ── voice ── */
  const processVoice = React.useCallback(async (transcript: string) => {
    try {
      const ruleSet = new Set(rules.map(r => r.stokKodu));
      const products = productCodes.filter(p => ruleSet.has(p.stokKodu)).map(p => ({ stokKodu: p.stokKodu, stokAdi: p.stokAdi }));
      const resp = await fetch('/api/ai/voice-count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, products, brands }) });
      if (!resp.ok) { fire({ title: 'Sesli sayım hatası' }); return; }
      const data = await resp.json();
      const commands: any[] = data.commands || [];
      const actions: any[] = data.actions || [];
      if (!commands.length && !actions.length) { fire({ title: 'Ürün eşleşemedi' }); return; }
      if (commands.length) {
        setCountData(prev => {
          const next = { ...prev };
          commands.forEach(cmd => {
            const p = productCodes.find(x => x.stokKodu === cmd.stokKodu); if (!p) return;
            const base = next[p.stokKodu] || emptyEntry(p.stokKodu, p.stokAdi, p.marka || '');
            const upd = { ...base, counted: true };
            if (cmd.stokAdedi != null) upd.stokAdedi = String(cmd.stokAdedi);
            if (cmd.cihazUstuAdedi != null) upd.cihazUstuAdedi = String(cmd.cihazUstuAdedi);
            next[p.stokKodu] = upd;
            if (p.marka && p.marka !== activeBrandRef.current) setActiveBrand(p.marka);
          });
          return next;
        });
      }
      actions.forEach(a => {
        if (a.type === 'complete_brand' && activeBrandRef.current) completeBrand();
        else if (a.type === 'next_brand') { const cur = activeBrandRef.current; const idx = cur ? brands.indexOf(cur) : -1; const nb = brands.slice(idx + 1).find(b => { const s = brandStats(b); return s.c < s.total; }); if (nb) setActiveBrand(nb); }
        else if (a.type === 'go_to_brand' && a.brand) { const target = brands.find(b => normalizeText(b) === normalizeText(a.brand)); if (target) setActiveBrand(target); }
      });
      fire({ tone: 'ok', title: 'Sesli sayım uygulandı' });
    } catch (e) { console.error(e); fire({ title: 'Sesli sayım hatası' }); }
  }, [rules, productCodes, brands]);

  const toggleVoice = () => {
    if (voiceActive) { const r = recognitionRef.current; recognitionRef.current = null; try { r?.stop(); } catch {} setVoiceActive(false); return; }
    const SR = (typeof window !== 'undefined') ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
    if (!SR) { fire({ title: 'Tarayıcı sesli sayımı desteklemiyor' }); return; }
    const rec = new SR(); rec.lang = 'tr-TR'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onresult = (e: any) => { let final = ''; for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) final += e.results[i][0].transcript; } if (final.trim()) processVoice(final.trim()); };
    rec.onerror = (e: any) => { if (e.error !== 'no-speech' && e.error !== 'aborted') fire({ title: 'Mikrofon hatası' }); };
    rec.onend = () => { if (recognitionRef.current === rec) { try { rec.start(); } catch {} } else setVoiceActive(false); };
    recognitionRef.current = rec; try { rec.start(); } catch {} setVoiceActive(true);
  };
  React.useEffect(() => () => { const r = recognitionRef.current; recognitionRef.current = null; try { r?.stop(); } catch {} }, []);

  let shown = brandList.filter(p => (p.stokAdi || '').toLowerCase().includes(q.toLowerCase()) || p.stokKodu.toLowerCase().includes(q.toLowerCase()));
  if (onlyEmpty) shown = shown.filter(p => !isCounted(p));
  shown = [...shown].sort((a, b) => Number(isCounted(a)) - Number(isCounted(b)));

  if (loadingRules) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.4em', color: 'var(--ink-3)', textTransform: 'uppercase', animation: 'mlLivePulse 1.6s ease-in-out infinite' }}>Yükleniyor</span></div>;
  }
  if (brands.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '60px 30px', textAlign: 'center' }}>
        <MlIconBtn onClick={onBack} ac={ac} ariaLabel="Geri"><MLIco.back s={18} /></MlIconBtn>
        <span style={{ width: 72, height: 72, borderRadius: '28%', display: 'grid', placeItems: 'center', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-3)' }}><MLIco.tag s={32} /></span>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-1)' }}>{loc.name} için tanımlı ürün yok</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 500 }}>Bu lokasyonda min/max kuralı bulunmuyor.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, background: 'linear-gradient(180deg, var(--bg-0) 78%, transparent)', padding: mobile ? '12px 14px 10px' : '16px 24px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 10 : 14, padding: mobile ? '12px 14px' : '14px 20px', borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)' }}>
          <MlIconBtn onClick={onBack} ac={ac} size={mobile ? 40 : 44} ariaLabel="Geri"><MLIco.back s={18} /></MlIconBtn>
          <span style={{ width: mobile ? 40 : 44, height: mobile ? 40 : 44, flexShrink: 0, borderRadius: 12, display: 'grid', placeItems: 'center', color: '#fff', background: `radial-gradient(circle at 32% 28%, ${ac.accent}, ${ac.primary})`, boxShadow: `0 8px 16px -7px ${ac.glow}` }}>{kind === 'depot' ? <MLIco.building s={mobile ? 20 : 22} /> : <MLIco.flask s={mobile ? 20 : 22} />}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: mobile ? 15 : 18, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc.name}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', marginTop: 1 }}>{brandsDone}/{brands.length} marka · {countedN}/{totalN} ürün</div>
          </div>
          {!mobile && (
            <div style={{ display: 'flex', gap: 8 }}>
              <ToolChip ico="barcode" label={scannerActive ? 'Okuyucu Aktif' : 'Barkod'} live={scannerActive} onClick={() => setScannerActive(v => !v)} />
              <ToolChip ico="mic" label={voiceActive ? 'Mikrofon Aktif' : 'Sesli'} live={voiceActive} tone="red" onClick={toggleVoice} />
              <ToolChip ico="download" label="Şablon" onClick={() => fire({ title: 'Şablon indiriliyor' })} />
              <ToolChip ico="excel" label="Excel" onClick={() => fire({ title: 'Excel içe aktar' })} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 10 : 16, paddingLeft: mobile ? 6 : 14, marginLeft: mobile ? 0 : 4, borderLeft: mobile ? 'none' : '1px solid var(--line)' }}>
            {!mobile && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Toplam</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.02em' }}>{grandCostStr}</div>
              </div>
            )}
            <MlRing pct={globalPct} size={mobile ? 40 : 48} thickness={mobile ? 5 : 6} />
          </div>
        </div>
        {mobile && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
            <ToolChip ico="barcode" label={scannerActive ? 'Aktif' : 'Barkod'} live={scannerActive} onClick={() => setScannerActive(v => !v)} />
            <ToolChip ico="mic" label={voiceActive ? 'Aktif' : 'Sesli'} live={voiceActive} tone="red" onClick={toggleVoice} />
            <ToolChip ico="download" label="Şablon" onClick={() => fire({ title: 'Şablon indiriliyor' })} />
            <ToolChip ico="excel" label="Excel" onClick={() => fire({ title: 'Excel içe aktar' })} />
          </div>
        )}
      </div>

      {/* body */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: mobile ? '1fr' : (tablet ? '210px 1fr' : '250px 1fr'), gap: mobile ? 0 : 16, padding: mobile ? '0 14px 130px' : '4px 24px 120px' }}>
        {!mobile && <BrandRail brands={brands} active={activeBrand} setActive={setActiveBrand} ac={ac} brandStats={brandStats} />}

        <div style={{ minWidth: 0 }}>
          {mobile && brand && (
            <div style={{ position: 'sticky', top: 122, zIndex: 20, padding: '8px 0 12px', background: 'var(--bg-0)' }}>
              <button onClick={() => setRailOpen(true)} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 'var(--radius)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: 'var(--clay)' }}>
                <MlRing pct={st.pct} size={38} thickness={5} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-1)' }}>{brand}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' }}>{st.c}/{st.total} ürün · marka değiştir</div>
                </div>
                <MLIco.chevD s={18} />
              </button>
            </div>
          )}

          <div style={{ padding: mobile ? '4px 2px 12px' : '10px 2px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: mobile ? 22 : 26, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>{brand}</h2>
              <MlPill tone={st.pct === 100 ? 'ok' : 'accent'}>{st.c}/{st.total} sayıldı</MlPill>
              {formatCosts(st.costs) && <MlPill tone="blue">{formatCosts(st.costs)}</MlPill>}
              <div style={{ flex: 1 }} />
              {!mobile && <MlBtn ico="check" variant="green" ac={ac} onClick={completeBrand} size="sm">Markayı Tamamla</MlBtn>}
            </div>
            <div style={{ marginTop: 12 }}><MlBar pct={st.pct} tone={st.pct === 100 ? 'linear-gradient(90deg, #8FD3A6, var(--water-solid))' : undefined} height={8} /></div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
              <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', display: 'inline-flex' }}><MLIco.search s={17} /></span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün ara…" style={{ width: '100%', boxSizing: 'border-box', height: 46, padding: '0 16px 0 42px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-1)', fontSize: 14.5, fontWeight: 500, fontFamily: 'inherit', outline: 'none' }} />
            </div>
            <button onClick={() => setOnlyEmpty(v => !v)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 46, padding: '0 16px', borderRadius: 'var(--radius-pill)', background: onlyEmpty ? `${ac.primary}16` : 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: onlyEmpty ? `inset 0 0 0 1.5px ${ac.primary}66` : 'var(--clay)', color: onlyEmpty ? ac.primary : 'var(--ink-2)', fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap' }}><MLIco.filter s={15} /> Sadece Sayılmayanlar</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {shown.map((p, i) => {
              const nextProduct = shown.find(candidate => candidate.stokKodu !== p.stokKodu && !isCounted(candidate));
              return (
                <ProductRow key={p.stokKodu} p={p} i={i} ac={ac} mobile={mobile} entry={entryFor(p)} counted={isCounted(p)}
                  focusField={focusTarget?.stokKodu === p.stokKodu ? focusTarget.field : null}
                  completing={completingRows.has(p.stokKodu)}
                  onBox={(v: string) => setField(p, 'stokAdedi', v)}
                  onTest={(v: string) => setField(p, 'cihazUstuAdedi', v)}
                  onComplete={() => completeProduct(p)}
                  onAutoComplete={(cihazValue: string) => autoCompleteProduct(p, cihazValue, nextProduct)} />
              );
            })}
            {shown.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontWeight: 600, borderRadius: 'var(--radius)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}>{onlyEmpty ? 'Bu markada sayılmayan ürün kalmadı 🎉' : 'Ürün bulunamadı'}</div>}
          </div>
        </div>
      </div>

      {/* bottom save bar — flush at the bottom, matching the demo */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, padding: mobile ? '10px 14px calc(10px + env(safe-area-inset-bottom))' : '12px 24px 16px', background: 'linear-gradient(0deg, var(--bg-0) 72%, transparent)' }}>
        <div style={{ maxWidth: 1480, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: mobile ? '10px 12px' : '12px 18px', borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: '0 -8px 24px -12px rgba(150,128,96,0.4), var(--clay)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 12 : 20, flex: 1, minWidth: 0, overflowX: 'auto' }}>
            <BigStat label="Toplam Test" value={grandTests} />
            {!mobile && <div style={{ width: 1, height: 40, background: 'var(--line)', flexShrink: 0 }} />}
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Toplam Maliyet</div>
              <div style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{grandCostStr}</div>
            </div>
            {!mobile && <div style={{ width: 1, height: 40, background: 'var(--line)', flexShrink: 0 }} />}
            {!mobile && <BigStat label="Sayılan" value={countedN} suffix={`/${totalN}`} />}
          </div>
          {mobile && <MlBtn ico="check" variant="green" ac={ac} onClick={completeBrand} size="sm" style={{ flexShrink: 0 }}>Marka</MlBtn>}
          <MlBtn ico="check" variant="primary" ac={ac} onClick={save} size="lg" style={{ flexShrink: 0 }}>Kaydet</MlBtn>
        </div>
      </div>

      {mobile && railOpen && (
        <MlModal open={railOpen} onClose={() => setRailOpen(false)} sheet>
          <MlModalHead ico="tag" title="Marka Seç" sub={`${brandsDone}/${brands.length} tamamlandı`} onClose={() => setRailOpen(false)} ac={ac} />
          <div style={{ padding: 14, overflowY: 'auto' }}>
            <BrandRail brands={brands} active={activeBrand} setActive={(id: string) => { setActiveBrand(id); setRailOpen(false); }} ac={ac} brandStats={brandStats} bare />
          </div>
        </MlModal>
      )}
    </div>
  );
}

function emptyEntry(stokKodu: string, stokAdi: string, marka: string): ProductCountEntry {
  return { stokKodu, stokAdi, marka, stokAdedi: '', cihazUstuAdedi: '', counted: false };
}

const ToolChip = ({ ico, label, onClick, live, tone }: any) => {
  const I = MLIco[ico];
  const c = tone === 'red' ? 'var(--danger)' : 'var(--water-deep)';
  const bg = tone === 'red' ? 'rgba(192,121,106,0.16)' : 'rgba(111,181,133,0.16)';
  return (
    <button onClick={onClick} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 13px', borderRadius: 'var(--radius-pill)', background: live ? bg : 'var(--surface-2)', boxShadow: live ? 'none' : 'var(--clay-inset)', color: live ? c : 'var(--ink-2)', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {live && <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone === 'red' ? 'var(--danger)' : 'var(--water-solid)', animation: 'mlLivePulse 1.8s ease-in-out infinite' }} />}<I s={15} /> {label}
    </button>
  );
};

const BigStat = ({ label, value, suffix }: any) => (
  <div style={{ flexShrink: 0 }}>
    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
      <MlNum value={value} size={24} />
      {suffix && <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-3)' }}>{suffix}</span>}
    </div>
  </div>
);

const BrandRail = ({ brands, active, setActive, ac, brandStats, bare }: any) => {
  const doneN = brands.filter((b: string) => { const s = brandStats(b); return s.total > 0 && s.c === s.total; }).length;
  const inner = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {brands.map((b: string) => {
        const s = brandStats(b), on = b === active, full = s.pct === 100;
        return (
          <button key={b} onClick={() => setActive(b)} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 'var(--radius)', background: on ? `linear-gradient(180deg, ${ac.accent}22, ${ac.primary}18)` : 'transparent', boxShadow: on ? `inset 0 0 0 1.5px ${ac.primary}66` : 'none', transition: 'all 200ms var(--ease-fluid)' }}>
            <MlRing pct={s.pct} size={38} thickness={5} color={full ? 'var(--water-solid)' : (on ? ac.primary : undefined)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: on ? 'var(--ink-1)' : 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', marginTop: 1 }}>{s.c}/{s.total} ürün{formatCosts(s.costs) ? ` · ${formatCosts(s.costs)}` : ''}</div>
            </div>
            {full && <span style={{ color: 'var(--water-deep)', flexShrink: 0, display: 'inline-flex' }}><MLIco.check s={17} /></span>}
          </button>
        );
      })}
    </div>
  );
  if (bare) return inner;
  return (
    <div style={{ alignSelf: 'start', position: 'sticky', top: 92, padding: 12, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)', maxHeight: 'calc(100vh - 190px)', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 12px' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Markalar</span>
        <MlPill tone="ok">{doneN}/{brands.length}</MlPill>
      </div>
      {inner}
    </div>
  );
};

const ProductRow = ({ p, i, ac, mobile, entry, counted, onBox, onTest, onComplete, focusField, completing, onAutoComplete }: any) => {
  const [focusedField, setFocusedField] = React.useState<'box' | 'test' | null>(null);
  const boxRef = React.useRef<HTMLInputElement | null>(null);
  const testRef = React.useRef<HTMLInputElement | null>(null);
  const boxAdvanceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (focusField === 'box') {
      boxRef.current?.focus({ preventScroll: true });
      boxRef.current?.select();
    } else if (focusField === 'test') {
      testRef.current?.focus({ preventScroll: true });
      testRef.current?.select();
    }
  }, [focusField]);

  React.useEffect(() => () => {
    if (boxAdvanceTimer.current) clearTimeout(boxAdvanceTimer.current);
  }, []);

  const focusBoxShadow = (field: 'box' | 'test') => focusedField === field
    ? `var(--clay-inset), 0 0 0 2px ${ac.primary}, 0 0 0 8px rgba(111,181,133,0.16), 0 0 30px rgba(111,181,133,0.42)`
    : 'var(--clay-inset)';

  const ambalaj = p.ambalajDegeri || 1;
  const boxN = parseInt(entry.stokAdedi || '0', 10) || 0;
  const total = productTotalTests(p, entry);
  const { amount, currency } = calcProductCost(p, entry);
  const grup = urunGrubuLabel(p.urunGrubu);

  return (
    <div style={{ position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden', transform: completing ? 'translateX(115%) scale(0.98)' : 'translateX(0) scale(1)', opacity: completing ? 0 : 1, background: completing ? 'linear-gradient(180deg, rgba(111,181,133,0.18), rgba(111,181,133,0.08))' : counted ? 'linear-gradient(180deg, rgba(111,181,133,0.08), rgba(111,181,133,0.03))' : 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: counted ? 'var(--clay), inset 0 0 0 1.5px rgba(111,181,133,0.35)' : 'var(--clay)', transition: 'transform 280ms var(--ease-fluid), opacity 220ms ease, box-shadow 300ms var(--ease-fluid), background 300ms', willChange: completing ? 'transform, opacity' : undefined, animation: `mlPopIn ${200 + Math.min(i, 10) * 45}ms var(--ease-fluid)` }}>
      <div style={{ padding: mobile ? 15 : 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: mobile ? 15 : 16.5, fontWeight: 800, color: 'var(--ink-1)', lineHeight: 1.25, letterSpacing: '-0.01em' }}>{p.stokAdi}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)', fontFamily: 'ui-monospace, monospace' }}>{p.stokKodu}</span>
              {grup && <span style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', fontSize: 11, fontWeight: 700, color: 'var(--ink-2)' }}>{grup}</span>}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: `${ac.primary}14`, color: ac.primary, fontSize: 11, fontWeight: 800 }}><MLIco.box s={12} /> Kutu ×{ambalaj}</span>
            </div>
          </div>
          <button onClick={onComplete} aria-label="Satırı tamamla" style={{ all: 'unset', cursor: 'pointer', width: 40, height: 40, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', color: counted ? '#fff' : 'var(--ink-3)', background: counted ? 'radial-gradient(circle at 32% 28%, #8FD3A6, var(--water-solid))' : 'var(--surface-2)', boxShadow: counted ? '0 6px 13px -4px rgba(111,181,133,0.6)' : 'var(--clay-inset)', border: counted ? 'none' : '2px solid var(--ink-3)', boxSizing: 'border-box', transition: 'all 240ms var(--ease-fluid)' }}><MLIco.check s={19} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : '1fr 1fr 1.3fr', gap: 10, alignItems: 'stretch' }}>
          <div style={{ padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--surface-hi)', boxShadow: focusBoxShadow('box'), transition: 'box-shadow 220ms var(--ease-fluid)', animation: focusedField === 'box' ? 'mlLivePulse 1.35s ease-in-out infinite' : undefined }}>
            <label style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Kutu Adedi</label>
            <input ref={boxRef} value={entry.stokAdedi} onChange={(e) => { const v = e.target.value; onBox(v); if (boxAdvanceTimer.current) clearTimeout(boxAdvanceTimer.current); if (String(v).trim() !== '') boxAdvanceTimer.current = setTimeout(() => { testRef.current?.focus({ preventScroll: true }); testRef.current?.select(); }, 300); }} onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); e.stopPropagation(); testRef.current?.focus({ preventScroll: true }); testRef.current?.select(); }} onFocus={() => setFocusedField('box')} onBlur={() => setFocusedField(cur => cur === 'box' ? null : cur)} inputMode="numeric" placeholder="0"
              style={{ width: '100%', boxSizing: 'border-box', border: 'none', background: 'transparent', outline: 'none', fontSize: 26, fontWeight: 800, color: 'var(--ink-1)', fontFamily: 'inherit', marginTop: 2, letterSpacing: '-0.01em' }} />
          </div>
          <div style={{ padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--surface-hi)', boxShadow: focusBoxShadow('test'), transition: 'box-shadow 220ms var(--ease-fluid)', animation: focusedField === 'test' ? 'mlLivePulse 1.35s ease-in-out infinite' : undefined }}>
            <label style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Açık / Ek Test</label>
            <input ref={testRef} value={entry.cihazUstuAdedi} onChange={(e) => onTest(e.target.value)} onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); e.stopPropagation(); if (String(entry.stokAdedi ?? '').trim() !== '' && String(entry.cihazUstuAdedi ?? '').trim() !== '') onAutoComplete?.(entry.cihazUstuAdedi); }} onFocus={() => setFocusedField('test')} onBlur={() => setFocusedField(cur => cur === 'test' ? null : cur)} inputMode="numeric" placeholder="0"
              style={{ width: '100%', boxSizing: 'border-box', border: 'none', background: 'transparent', outline: 'none', fontSize: 26, fontWeight: 800, color: 'var(--ink-2)', fontFamily: 'inherit', marginTop: 2, letterSpacing: '-0.01em' }} />
          </div>
          <div style={{ gridColumn: mobile ? '1 / -1' : 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 18px', borderRadius: 'var(--radius)', background: counted ? `linear-gradient(135deg, ${ac.accent}, ${ac.primary})` : 'var(--surface-2)', boxShadow: counted ? `inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 18px -8px ${ac.glow}` : 'var(--clay-inset)', transition: 'all 300ms var(--ease-fluid)' }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: counted ? 'rgba(255,255,255,0.85)' : 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Toplam Test</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <MlNum value={total} size={mobile ? 30 : 34} color={counted ? '#fff' : 'var(--ink-1)'} />
                {boxN > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: counted ? 'rgba(255,255,255,0.8)' : 'var(--ink-3)' }}>{boxN}×{ambalaj}{entry.cihazUstuAdedi ? `+${entry.cihazUstuAdedi}` : ''}</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: counted ? 'rgba(255,255,255,0.85)' : 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Maliyet</div>
              <div style={{ fontSize: mobile ? 20 : 23, fontWeight: 800, color: counted ? '#fff' : 'var(--accent)', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{money(amount, currency)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
