'use client';

import React from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';
import useHidScanner from '@/hooks/useHidScanner';
import { parseAndResolveBarcode } from '@/lib/barcode';
import { playFeedback } from '@/lib/utils';
import type { ProductCode } from '@/lib/types';
import {
  AC, MLIco, MlBtn, MlIconBtn, MlPill, MlModal, MlModalHead, MlNum, MlBar, MlRing,
  type Accent, type Mode,
} from '@/components/maliyet/ml-primitives';
import { urunGrubuLabel } from '@/components/maliyet/ml-logic';
import {
  type LabGroup, type ProductGroup, type CountState, emptyCount,
  countedOf, isCountedRow, saveDepoCount, type SaveSummary,
} from './depo-logic';

interface Props {
  ac?: Accent; mode: Mode;
  depot: { id: string; name: string };
  groups: LabGroup[];
  productCodes: ProductCode[];
  onBack: () => void;
  fire: (t: any) => void;
}

export default function DepoCount({ ac = AC, mode, depot, groups, productCodes, onBack, fire }: Props) {
  const mobile = mode === 'mobile', tablet = mode === 'tablet';
  const { currentUserProfile, currentCompanyId } = useAuth() as any;

  const [states, setStates] = React.useState<Record<string, CountState>>({});
  const [activeLabId, setActiveLabId] = React.useState<string | null>(groups[0]?.labId ?? null);
  const [q, setQ] = React.useState('');
  const [onlyEmpty, setOnlyEmpty] = React.useState(false);
  const [railOpen, setRailOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [scannerActive, setScannerActive] = React.useState(true);
  const [voiceActive, setVoiceActive] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [completingRows, setCompletingRows] = React.useState<Set<string>>(() => new Set());
  const [focusTarget, setFocusTarget] = React.useState<string | null>(null);
  const recognitionRef = React.useRef<any>(null);
  const activeLabRef = React.useRef<string | null>(activeLabId);
  React.useEffect(() => { activeLabRef.current = activeLabId; }, [activeLabId]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const barcodeFormats = useSafeBarcodeFormats();

  const productByCode = React.useMemo(() => new Map(productCodes.map(p => [p.stokKodu, p])), [productCodes]);
  const groupByCode = React.useMemo(() => {
    const m = new Map<string, ProductGroup>();
    groups.forEach(lg => lg.products.forEach(p => m.set(p.stokKodu, p)));
    return m;
  }, [groups]);

  const st = (code: string) => states[code];
  const ensure = (code: string, prev: Record<string, CountState>) => prev[code] || emptyCount();

  const setManual = (code: string, val: string) => {
    const clean = val.replace(/[^0-9]/g, '');
    setStates(prev => ({ ...prev, [code]: { ...ensure(code, prev), countedAdet: clean, touched: true } }));
  };
  const toggleSerial = (code: string, serial: string) => {
    setStates(prev => {
      const base = ensure(code, prev);
      const next = new Set(base.scannedSerials);
      next.has(serial) ? next.delete(serial) : next.add(serial);
      return { ...prev, [code]: { ...base, scannedSerials: next, touched: true } };
    });
  };
  /* Enter-to-advance: slide the row out (green), then complete it and focus the next row's input */
  const autoCompleteRow = (p: ProductGroup, next?: ProductGroup) => {
    const s = states[p.stokKodu];
    if (String(s?.countedAdet ?? '').trim() === '') return;
    setCompletingRows(prev => new Set(prev).add(p.stokKodu));
    window.setTimeout(() => {
      setStates(prev => { const base = ensure(p.stokKodu, prev); return { ...prev, [p.stokKodu]: { ...base, counted: true, touched: true } }; });
      setCompletingRows(prev => { const n = new Set(prev); n.delete(p.stokKodu); return n; });
      if (next) setFocusTarget(next.stokKodu);
    }, 280);
  };
  const completeLab = () => {
    const lg = groups.find(g => g.labId === activeLabId);
    if (!lg) return;
    setStates(prev => {
      const next = { ...prev };
      lg.products.forEach(p => {
        const base = ensure(p.stokKodu, next);
        if (p.serial) next[p.stokKodu] = { ...base, scannedSerials: new Set(p.serials), counted: true, touched: true };
        else next[p.stokKodu] = { ...base, countedAdet: base.countedAdet === '' ? String(p.currentQty) : base.countedAdet, counted: true, touched: true };
      });
      return next;
    });
    fire({ tone: 'ok', title: `${lg.labName} tamamlandı`, sub: `${lg.products.length} ürün` });
    const idx = groups.findIndex(g => g.labId === activeLabId);
    const nextG = groups.slice(idx + 1)[0];
    if (nextG) { setActiveLabId(nextG.labId); if (mobile) setRailOpen(false); }
  };

  /* stats */
  const labStat = (lg: LabGroup) => {
    const c = lg.products.filter(p => isCountedRow(p, states[p.stokKodu])).length;
    const cur = lg.products.reduce((a, p) => a + p.currentQty, 0);
    const cnt = lg.products.reduce((a, p) => a + countedOf(p, states[p.stokKodu]), 0);
    return { c, total: lg.products.length, pct: lg.products.length ? Math.round((c / lg.products.length) * 100) : 0, cur, cnt };
  };
  const allProducts = React.useMemo(() => groups.flatMap(g => g.products), [groups]);
  const countedN = allProducts.filter(p => isCountedRow(p, states[p.stokKodu])).length;
  const totalN = allProducts.length;
  const globalPct = totalN ? Math.round((countedN / totalN) * 100) : 0;
  const labsDone = groups.filter(g => { const s = labStat(g); return s.total > 0 && s.c === s.total; }).length;
  const grandCurrent = allProducts.reduce((a, p) => a + p.currentQty, 0);
  const grandCounted = allProducts.reduce((a, p) => a + countedOf(p, states[p.stokKodu]), 0);

  const lab = groups.find(g => g.labId === activeLabId) || groups[0];
  const ls = lab ? labStat(lab) : { c: 0, total: 0, pct: 0, cur: 0, cnt: 0 };

  /* barcode */
  const handleScan = React.useCallback(({ raw }: { raw: string }) => {
    if (!raw) return;
    const res = parseAndResolveBarcode(raw.trim(), barcodeFormats as any, productCodes);
    const found = res?.product || productCodes.find(p => p.barcodeNumber === raw || p.stokKodu === raw);
    if (!found) { playFeedback(true); fire({ title: 'Ürün bulunamadı' }); return; }
    const g = groupByCode.get(found.stokKodu);
    if (!g) { playFeedback(true); fire({ title: 'Bu depoda stok yok', sub: found.stokAdi }); return; }
    if (g.labId && g.labId !== activeLabRef.current) setActiveLabId(g.labId);
    const serial = (res?.parsed as any)?.seriNumarasi?.trim();
    if (g.serial && serial) {
      if (!g.serials.includes(serial)) { playFeedback(true); fire({ title: 'Bu seri no depoda yok', sub: serial }); return; }
      setStates(prev => {
        const base = ensure(found.stokKodu, prev);
        if (base.scannedSerials.has(serial)) return prev;
        const next = new Set(base.scannedSerials); next.add(serial);
        return { ...prev, [found.stokKodu]: { ...base, scannedSerials: next, counted: true, touched: true } };
      });
      playFeedback(); fire({ tone: 'ok', title: `${found.stokAdi}`, sub: `Seri: ${serial}` });
    } else {
      setStates(prev => {
        const base = ensure(found.stokKodu, prev);
        const cur = parseInt(base.countedAdet || '0', 10) || 0;
        return { ...prev, [found.stokKodu]: { ...base, countedAdet: String(cur + 1), counted: true, touched: true } };
      });
      playFeedback(); fire({ tone: 'ok', title: `${found.stokAdi} +1` });
    }
  }, [barcodeFormats, productCodes, groupByCode]);
  useHidScanner({ enabled: scannerActive, allowDuringInputs: false, onScan: handleScan } as any);

  /* voice */
  const processVoice = React.useCallback(async (transcript: string) => {
    try {
      const products = allProducts.map(p => ({ stokKodu: p.stokKodu, stokAdi: p.stokAdi }));
      const resp = await fetch('/api/ai/voice-count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, products, brands: groups.map(g => g.labName) }) });
      if (!resp.ok) { fire({ title: 'Sesli sayım hatası' }); return; }
      const data = await resp.json();
      const commands: any[] = data.commands || [];
      if (!commands.length) { fire({ title: 'Ürün eşleşemedi' }); return; }
      setStates(prev => {
        const next = { ...prev };
        commands.forEach(cmd => {
          const g = groupByCode.get(cmd.stokKodu); if (!g) return;
          const base = next[cmd.stokKodu] || emptyCount();
          if (cmd.stokAdedi != null) next[cmd.stokKodu] = { ...base, countedAdet: String(cmd.stokAdedi), counted: true, touched: true };
        });
        return next;
      });
      fire({ tone: 'ok', title: 'Sesli sayım uygulandı' });
    } catch (e) { console.error(e); fire({ title: 'Sesli sayım hatası' }); }
  }, [allProducts, groupByCode, groups]);

  const toggleVoice = () => {
    if (voiceActive) { const r = recognitionRef.current; recognitionRef.current = null; try { r?.stop(); } catch {} setVoiceActive(false); return; }
    const SR = (typeof window !== 'undefined') ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
    if (!SR) { fire({ title: 'Tarayıcı sesli sayımı desteklemiyor' }); return; }
    const rec = new SR(); rec.lang = 'tr-TR'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e: any) => { let f = ''; for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) f += e.results[i][0].transcript; if (f.trim()) processVoice(f.trim()); };
    rec.onerror = (e: any) => { if (e.error !== 'no-speech' && e.error !== 'aborted') fire({ title: 'Mikrofon hatası' }); };
    rec.onend = () => { if (recognitionRef.current === rec) { try { rec.start(); } catch {} } else setVoiceActive(false); };
    recognitionRef.current = rec; try { rec.start(); } catch {} setVoiceActive(true);
  };
  React.useEffect(() => () => { const r = recognitionRef.current; recognitionRef.current = null; try { r?.stop(); } catch {} }, []);

  /* excel template + upload */
  const downloadTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const rows = allProducts.map(p => ({ 'Stok Kodu': p.stokKodu, 'Stok Adı': p.stokAdi, 'Laboratuvar': p.labName, 'Mevcut': p.currentQty, 'Sayılan': '' }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sayım');
      XLSX.writeFile(wb, `${depot.name}-sayim-sablonu.xlsx`);
      fire({ tone: 'ok', title: 'Şablon indirildi' });
    } catch (e) { console.error(e); fire({ title: 'Şablon oluşturulamadı' }); }
  };
  const onUpload = async (file: File) => {
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      let n = 0;
      setStates(prev => {
        const next = { ...prev };
        rows.forEach(r => {
          const code = String(r['Stok Kodu'] ?? r['stokKodu'] ?? '').trim();
          const val = r['Sayılan'] ?? r['sayilan'] ?? r['Sayilan'];
          if (!code || val === '' || val == null) return;
          if (!groupByCode.has(code)) return;
          next[code] = { ...(next[code] || emptyCount()), countedAdet: String(parseInt(val, 10) || 0), counted: true, touched: true };
          n++;
        });
        return next;
      });
      fire({ tone: 'ok', title: 'Excel yüklendi', sub: `${n} ürün güncellendi` });
    } catch (e) { console.error(e); fire({ title: 'Excel okunamadı' }); }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    fire({ tone: 'ok', title: 'Sayım kaydediliyor', sub: `${countedN}/${totalN} ürün` });
    try {
      const res: SaveSummary = await saveDepoCount({ groups, states, depot, companyId: currentCompanyId, user: { uid: currentUserProfile?.uid || '', name: currentUserProfile?.name || '' } });
      fire({ tone: 'ok', title: 'Sayım kaydedildi', sub: `${res.deleted} düşüldü · ${res.created} eklendi${res.skippedSerial ? ` · ${res.skippedSerial} seri korundu` : ''}` });
      onBack();
    } catch (e) { console.error(e); fire({ title: 'Kayıt hatası' }); }
    finally { setSaving(false); }
  };

  let shown = (lab?.products || []).filter(p => (p.stokAdi || '').toLowerCase().includes(q.toLowerCase()) || p.stokKodu.toLowerCase().includes(q.toLowerCase()));
  if (onlyEmpty) shown = shown.filter(p => !isCountedRow(p, states[p.stokKodu]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ''; }} />

      {/* top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, background: 'linear-gradient(180deg, var(--bg-0) 78%, transparent)', padding: mobile ? '12px 14px 10px' : '16px 24px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 10 : 14, padding: mobile ? '12px 14px' : '14px 20px', borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)' }}>
          <MlIconBtn onClick={onBack} ac={ac} size={mobile ? 40 : 44} ariaLabel="Geri"><MLIco.back s={18} /></MlIconBtn>
          <span style={{ width: mobile ? 40 : 44, height: mobile ? 40 : 44, flexShrink: 0, borderRadius: 12, display: 'grid', placeItems: 'center', color: '#fff', background: `radial-gradient(circle at 32% 28%, ${ac.accent}, ${ac.primary})`, boxShadow: `0 8px 16px -7px ${ac.glow}` }}><MLIco.building s={mobile ? 20 : 22} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: mobile ? 15 : 18, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{depot.name}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', marginTop: 1 }}>{labsDone}/{groups.length} lab · {countedN}/{totalN} ürün</div>
          </div>
          {!mobile && (
            <div style={{ display: 'flex', gap: 8 }}>
              <ToolChip ico="barcode" label={scannerActive ? 'Okuyucu Aktif' : 'Barkod'} live={scannerActive} onClick={() => setScannerActive(v => !v)} />
              <ToolChip ico="mic" label={voiceActive ? 'Mikrofon Aktif' : 'Sesli'} live={voiceActive} tone="red" onClick={toggleVoice} />
              <ToolChip ico="download" label="Şablon" onClick={downloadTemplate} />
              <ToolChip ico="excel" label="Excel" onClick={() => fileRef.current?.click()} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 10 : 16, paddingLeft: mobile ? 6 : 14, marginLeft: mobile ? 0 : 4, borderLeft: mobile ? 'none' : '1px solid var(--line)' }}>
            {!mobile && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sayılan / Mevcut</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.02em' }}>{grandCounted} / {grandCurrent}</div>
              </div>
            )}
            <MlRing pct={globalPct} size={mobile ? 40 : 48} thickness={mobile ? 5 : 6} />
          </div>
        </div>
        {mobile && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
            <ToolChip ico="barcode" label={scannerActive ? 'Aktif' : 'Barkod'} live={scannerActive} onClick={() => setScannerActive(v => !v)} />
            <ToolChip ico="mic" label={voiceActive ? 'Aktif' : 'Sesli'} live={voiceActive} tone="red" onClick={toggleVoice} />
            <ToolChip ico="download" label="Şablon" onClick={downloadTemplate} />
            <ToolChip ico="excel" label="Excel" onClick={() => fileRef.current?.click()} />
          </div>
        )}
      </div>

      {/* body */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: mobile ? '1fr' : (tablet ? '220px 1fr' : '260px 1fr'), gap: mobile ? 0 : 16, padding: mobile ? '0 14px 130px' : '4px 24px 120px' }}>
        {!mobile && <LabRail groups={groups} active={activeLabId} setActive={setActiveLabId} ac={ac} labStat={labStat} />}

        <div style={{ minWidth: 0 }}>
          {mobile && lab && (
            <div style={{ position: 'sticky', top: 122, zIndex: 20, padding: '8px 0 12px', background: 'var(--bg-0)' }}>
              <button onClick={() => setRailOpen(true)} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 'var(--radius)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: 'var(--clay)' }}>
                <MlRing pct={ls.pct} size={38} thickness={5} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lab.labName}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' }}>{ls.c}/{ls.total} ürün · lab değiştir</div>
                </div>
                <MLIco.chevD s={18} />
              </button>
            </div>
          )}

          {lab && (
            <div style={{ padding: mobile ? '4px 2px 12px' : '10px 2px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: mobile ? 21 : 25, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>{lab.labName}</h2>
                <MlPill tone={ls.pct === 100 ? 'ok' : 'accent'}>{ls.c}/{ls.total} sayıldı</MlPill>
                <MlPill tone="blue">{ls.cnt} / {ls.cur} adet</MlPill>
                <div style={{ flex: 1 }} />
                {!mobile && <MlBtn ico="check" variant="green" ac={ac} onClick={completeLab} size="sm">Grubu Tamamla</MlBtn>}
              </div>
              <div style={{ marginTop: 12 }}><MlBar pct={ls.pct} tone={ls.pct === 100 ? 'linear-gradient(90deg, #8FD3A6, var(--water-solid))' : undefined} height={8} /></div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
              <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', display: 'inline-flex' }}><MLIco.search s={17} /></span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün ara…" style={{ width: '100%', boxSizing: 'border-box', height: 46, padding: '0 16px 0 42px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-1)', fontSize: 14.5, fontWeight: 500, fontFamily: 'inherit', outline: 'none' }} />
            </div>
            <button onClick={() => setOnlyEmpty(v => !v)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 46, padding: '0 16px', borderRadius: 'var(--radius-pill)', background: onlyEmpty ? `${ac.primary}16` : 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: onlyEmpty ? `inset 0 0 0 1.5px ${ac.primary}66` : 'var(--clay)', color: onlyEmpty ? ac.primary : 'var(--ink-2)', fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap' }}><MLIco.filter s={15} /> Sadece Sayılmayanlar</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {shown.map((p, i) => {
              const nextProduct = shown.find(c => c.stokKodu !== p.stokKodu && !isCountedRow(c, states[c.stokKodu]));
              return (
                <ProductRow key={p.stokKodu} p={p} i={i} ac={ac} mobile={mobile} state={states[p.stokKodu]}
                  completing={completingRows.has(p.stokKodu)} focusActive={focusTarget === p.stokKodu}
                  expanded={expanded.has(p.stokKodu)} onToggleExpand={() => setExpanded(prev => { const n = new Set(prev); n.has(p.stokKodu) ? n.delete(p.stokKodu) : n.add(p.stokKodu); return n; })}
                  onManual={(v) => setManual(p.stokKodu, v)} onToggleSerial={(s) => toggleSerial(p.stokKodu, s)}
                  onEnter={() => autoCompleteRow(p, nextProduct)}
                  onComplete={() => setStates(prev => { const base = ensure(p.stokKodu, prev); return { ...prev, [p.stokKodu]: p.serial ? { ...base, scannedSerials: new Set(p.serials), counted: true, touched: true } : { ...base, countedAdet: base.countedAdet === '' ? String(p.currentQty) : base.countedAdet, counted: true, touched: true } }; })} />
              );
            })}
            {shown.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontWeight: 600, borderRadius: 'var(--radius)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}>{onlyEmpty ? 'Bu grupta sayılmayan ürün kalmadı 🎉' : 'Ürün bulunamadı'}</div>}
          </div>
        </div>
      </div>

      {/* bottom save bar */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, padding: mobile ? '10px 14px calc(10px + env(safe-area-inset-bottom))' : '12px 24px 16px', background: 'linear-gradient(0deg, var(--bg-0) 72%, transparent)' }}>
        <div style={{ maxWidth: 1480, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: mobile ? '10px 12px' : '12px 18px', borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: '0 -8px 24px -12px rgba(150,128,96,0.4), var(--clay)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 12 : 20, flex: 1, minWidth: 0, overflowX: 'auto' }}>
            <BigStat label="Mevcut" value={grandCurrent} />
            {!mobile && <div style={{ width: 1, height: 40, background: 'var(--line)', flexShrink: 0 }} />}
            <BigStat label="Sayılan" value={grandCounted} color="var(--accent)" />
            {!mobile && <div style={{ width: 1, height: 40, background: 'var(--line)', flexShrink: 0 }} />}
            {!mobile && <BigStat label="Ürün" value={countedN} suffix={`/${totalN}`} />}
          </div>
          {mobile && <MlBtn ico="check" variant="green" ac={ac} onClick={completeLab} size="sm" style={{ flexShrink: 0 }}>Grup</MlBtn>}
          <MlBtn ico="check" variant="primary" ac={ac} onClick={save} size="lg" style={{ flexShrink: 0, opacity: saving ? 0.6 : 1, pointerEvents: saving ? 'none' : 'auto' }}>Kaydet</MlBtn>
        </div>
      </div>

      {mobile && railOpen && (
        <MlModal open={railOpen} onClose={() => setRailOpen(false)} sheet>
          <MlModalHead ico="flask" title="Laboratuvar Seç" sub={`${labsDone}/${groups.length} tamamlandı`} onClose={() => setRailOpen(false)} ac={ac} />
          <div style={{ padding: 14, overflowY: 'auto' }}>
            <LabRail groups={groups} active={activeLabId} setActive={(id: string) => { setActiveLabId(id); setRailOpen(false); }} ac={ac} labStat={labStat} bare />
          </div>
        </MlModal>
      )}
    </div>
  );
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

const BigStat = ({ label, value, suffix, color }: any) => (
  <div style={{ flexShrink: 0 }}>
    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
      <MlNum value={value} size={24} color={color} />
      {suffix && <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-3)' }}>{suffix}</span>}
    </div>
  </div>
);

const LabRail = ({ groups, active, setActive, ac, labStat, bare }: any) => {
  const doneN = groups.filter((g: LabGroup) => { const s = labStat(g); return s.total > 0 && s.c === s.total; }).length;
  const inner = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {groups.map((g: LabGroup) => {
        const s = labStat(g), on = g.labId === active, full = s.pct === 100;
        return (
          <button key={g.labId} onClick={() => setActive(g.labId)} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 'var(--radius)', background: on ? `linear-gradient(180deg, ${ac.accent}22, ${ac.primary}18)` : 'transparent', boxShadow: on ? `inset 0 0 0 1.5px ${ac.primary}66` : 'none', transition: 'all 200ms var(--ease-fluid)' }}>
            <MlRing pct={s.pct} size={38} thickness={5} color={full ? 'var(--water-solid)' : (on ? ac.primary : undefined)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: on ? 'var(--ink-1)' : 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.labName}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', marginTop: 1 }}>{s.c}/{s.total} ürün · {s.cnt}/{s.cur} adet</div>
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
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Laboratuvarlar</span>
        <MlPill tone="ok">{doneN}/{groups.length}</MlPill>
      </div>
      {inner}
    </div>
  );
};

const ProductRow = ({ p, i, ac, mobile, state, expanded, onToggleExpand, onManual, onToggleSerial, onComplete, completing, focusActive, onEnter }: any) => {
  const [focB, setFocB] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const counted = countedOf(p, state);
  const isC = isCountedRow(p, state);
  const diff = counted - p.currentQty;
  const grup = urunGrubuLabel(p.urunGrubu);
  const scanned: Set<string> = state?.scannedSerials || new Set();

  React.useEffect(() => {
    if (focusActive) { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select(); }
  }, [focusActive]);

  return (
    <div style={{ position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden', transform: completing ? 'translateX(115%) scale(0.98)' : 'translateX(0) scale(1)', opacity: completing ? 0 : 1, willChange: completing ? 'transform, opacity' : undefined, background: completing ? 'linear-gradient(180deg, rgba(111,181,133,0.18), rgba(111,181,133,0.08))' : isC ? 'linear-gradient(180deg, rgba(111,181,133,0.08), rgba(111,181,133,0.03))' : 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: isC ? 'var(--clay), inset 0 0 0 1.5px rgba(111,181,133,0.35)' : 'var(--clay)', transition: 'transform 280ms var(--ease-fluid), opacity 220ms ease, box-shadow 300ms var(--ease-fluid), background 300ms', animation: `mlPopIn ${200 + Math.min(i, 10) * 45}ms var(--ease-fluid)` }}>
      <div style={{ padding: mobile ? 15 : 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: mobile ? 15 : 16.5, fontWeight: 800, color: 'var(--ink-1)', lineHeight: 1.25, letterSpacing: '-0.01em' }}>{p.stokAdi}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)', fontFamily: 'ui-monospace, monospace' }}>{p.stokKodu}</span>
              {grup && <span style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', fontSize: 11, fontWeight: 700, color: 'var(--ink-2)' }}>{grup}</span>}
              {p.serial && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: `${ac.primary}14`, color: ac.primary, fontSize: 11, fontWeight: 800 }}><MLIco.tag s={12} /> Seri No</span>}
            </div>
          </div>
          <button onClick={onComplete} aria-label="Satırı tamamla" style={{ all: 'unset', cursor: 'pointer', width: 40, height: 40, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', color: isC ? '#fff' : 'var(--ink-3)', background: isC ? 'radial-gradient(circle at 32% 28%, #8FD3A6, var(--water-solid))' : 'var(--surface-2)', boxShadow: isC ? '0 6px 13px -4px rgba(111,181,133,0.6)' : 'var(--clay-inset)', border: isC ? 'none' : '2px solid var(--ink-3)', boxSizing: 'border-box', transition: 'all 240ms var(--ease-fluid)' }}><MLIco.check s={19} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : '1fr 1fr 1.3fr', gap: 10, alignItems: 'stretch' }}>
          {/* mevcut (read-only) */}
          <div style={{ padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}>
            <label style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Mevcut Stok</label>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink-2)', marginTop: 2, letterSpacing: '-0.01em' }}>{p.currentQty}</div>
          </div>
          {/* sayılan (input) */}
          <div style={{ padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--surface-hi)', boxShadow: focB ? `var(--clay-inset), 0 0 0 2px ${ac.primary}, 0 0 0 8px rgba(111,181,133,0.16), 0 0 30px rgba(111,181,133,0.42)` : 'var(--clay-inset)', transition: 'box-shadow 220ms var(--ease-fluid)', animation: focB ? 'mlLivePulse 1.35s ease-in-out infinite' : undefined }}>
            <label style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Sayılan</label>
            <input ref={inputRef} value={p.serial && scanned.size > 0 ? String(scanned.size) : (state?.countedAdet ?? '')} onChange={(e) => onManual(e.target.value)} onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); e.stopPropagation(); if (String(state?.countedAdet ?? '').trim() !== '') onEnter?.(); }} onFocus={() => setFocB(true)} onBlur={() => setFocB(false)} inputMode="numeric" placeholder="0"
              readOnly={p.serial && scanned.size > 0}
              style={{ width: '100%', boxSizing: 'border-box', border: 'none', background: 'transparent', outline: 'none', fontSize: 26, fontWeight: 800, color: 'var(--ink-1)', fontFamily: 'inherit', marginTop: 2, letterSpacing: '-0.01em' }} />
          </div>
          {/* fark / result */}
          <div style={{ gridColumn: mobile ? '1 / -1' : 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 18px', borderRadius: 'var(--radius)', background: isC ? (diff === 0 ? 'linear-gradient(135deg, #8FD3A6, var(--water-solid))' : `linear-gradient(135deg, ${ac.accent}, ${ac.primary})`) : 'var(--surface-2)', boxShadow: isC ? `inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 18px -8px ${ac.glow}` : 'var(--clay-inset)', transition: 'all 300ms var(--ease-fluid)' }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: isC ? 'rgba(255,255,255,0.85)' : 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Fark</div>
              <div style={{ fontSize: mobile ? 26 : 30, fontWeight: 800, color: isC ? '#fff' : 'var(--ink-1)', letterSpacing: '-0.02em' }}>{diff > 0 ? '+' : ''}{diff}</div>
            </div>
            {p.serial && p.serials.length > 0 && (
              <button onClick={onToggleExpand} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 'var(--radius-pill)', background: isC ? 'rgba(255,255,255,0.22)' : 'var(--surface-hi)', boxShadow: isC ? 'none' : 'var(--clay-flat)', color: isC ? '#fff' : 'var(--ink-2)', fontSize: 12, fontWeight: 800 }}>
                <MLIco.tag s={12} /> {scanned.size}/{p.serials.length} <MLIco.chevD s={13} />
              </button>
            )}
          </div>
        </div>

        {/* serial accordion */}
        {p.serial && expanded && p.serials.length > 0 && (
          <div style={{ marginTop: 12, padding: 14, borderRadius: 'var(--radius)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', animation: 'mlPopIn 200ms var(--ease-fluid)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 10 }}>Depodaki Seri Numaraları · {p.serials.length}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {p.serials.map((sn: string) => {
                const on = scanned.has(sn);
                return (
                  <button key={sn} onClick={() => onToggleSerial(sn)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 'var(--radius-pill)', fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 700, color: on ? '#fff' : 'var(--ink-2)', background: on ? 'radial-gradient(circle at 32% 28%, #8FD3A6, var(--water-solid))' : 'var(--surface-hi)', boxShadow: on ? '0 4px 10px -4px rgba(111,181,133,0.6)' : 'var(--clay-flat)' }}>
                    {on && <MLIco.check s={12} />}{sn}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
