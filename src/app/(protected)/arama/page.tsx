'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { exportDataToExcel } from '@/lib/utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  Search, RefreshCw, X, Box, ArrowRight, ChevronRight, ChevronDown, Check,
  FileSpreadsheet, Warehouse, Building2, Hash,
} from 'lucide-react';
import { searchProductLedger, type LedgerRow, type StockSummary, type SearchResult, type ProductMatch } from '@/actions/searchActions';
import { useAuth } from '@/contexts/auth-context';
import { MK_C, MkClayStyles } from '@/components/mal-kabul/clay-kit';

// ── Extra tones for transaction-type badges (cream-clay palette) ──────────────
const C = MK_C;
const SKY = '#7CA8DE', SKY_DEEP = '#5582C0';
const VIOLET = '#9B86D6', VIOLET_DEEP = '#7A66C0';

type BadgeKind = 'amber' | 'sky' | 'neutral' | 'danger' | 'violet';
const BADGE_TONE: Record<string, BadgeKind> = {
  'Mal Kabul': 'amber',
  'Karşılanan Sipariş': 'sky',
  'Direkt Transfer': 'neutral',
  'Laboratuvardan İade': 'sky',
  'Kullanım': 'danger',
  'İmha': 'danger',
  'Sayımdan Düşüm': 'violet',
};

function TypeBadge({ type }: { type: string }) {
  const kind = BADGE_TONE[type] || 'neutral';
  const map: Record<BadgeKind, { bg: string; fg: string; sh: string }> = {
    amber: { bg: `linear-gradient(180deg, #EBB45B, ${C.amber})`, fg: '#fff', sh: '0 5px 11px -5px rgba(224,163,62,0.6)' },
    danger: { bg: `linear-gradient(180deg, #CE8978, ${C.danger})`, fg: '#fff', sh: '0 5px 11px -5px rgba(192,121,106,0.6)' },
    neutral: { bg: C.surface2, fg: C.ink2, sh: C.clayInset },
    sky: { bg: 'rgba(124,168,222,0.18)', fg: SKY_DEEP, sh: 'none' },
    violet: { bg: 'rgba(155,134,214,0.18)', fg: VIOLET_DEEP, sh: 'none' },
  };
  const m = map[kind];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '7px 13px', borderRadius: C.radiusPill, background: m.bg, color: m.fg, boxShadow: m.sh, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.15 }}>
      {type}
    </span>
  );
}

// ── Sticky cream-clay search bar ──────────────────────────────────────────────
function SearchBar({ value, onChange, onSubmit, onClear, busy }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; onClear: () => void; busy: boolean;
}) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 40, display: 'flex', justifyContent: 'center', padding: '18px 24px 12px', background: 'linear-gradient(180deg, #EFEAE0 62%, transparent)' }}>
      <form onSubmit={e => { e.preventDefault(); onSubmit(); }} style={{ width: 'min(720px, 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 60, padding: '0 8px 0 20px', borderRadius: C.radiusPill, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: `${C.clay}, ${C.clayInset}` }}>
          <span style={{ color: busy ? C.accent : C.ink3, display: 'inline-flex', animation: busy ? 'mkSpin 1s linear infinite' : 'none' }}>
            {busy ? <RefreshCw size={20} /> : <Search size={21} />}
          </span>
          <input value={value} onChange={e => onChange(e.target.value)} placeholder="Stok kodu, stok adı, lot veya seri numarası…" autoFocus
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 16.5, fontWeight: 600, color: C.ink1, fontFamily: 'inherit', outline: 'none' }} />
          {value && (
            <button type="button" onClick={onClear} aria-label="Temizle" style={{ all: 'unset', cursor: 'pointer', width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', color: C.ink3, background: C.surface2, boxShadow: C.clayInset }}><X size={15} /></button>
          )}
          <button type="submit" aria-label="Ara" style={{ all: 'unset', cursor: 'pointer', height: 46, padding: '0 22px', borderRadius: C.radiusPill, display: 'inline-flex', alignItems: 'center', gap: 8, background: `linear-gradient(180deg, ${C.accent2}, ${C.accent})`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4), 0 8px 16px -7px ${C.accentGlow}`, color: '#fff', fontWeight: 800, fontSize: 14.5 }}>
            Ara
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Cell / Flow helpers ───────────────────────────────────────────────────────
function Cell({ children, mono, strong }: { children: React.ReactNode; mono?: boolean; strong?: boolean }) {
  return <div style={{ fontSize: 13.5, fontWeight: strong ? 700 : 600, color: strong ? C.ink1 : C.ink2, fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{children}</div>;
}

function Flow({ kaynak, hedef }: { kaynak: string; hedef?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>{kaynak}</span>
      {hedef && (
        <>
          <span style={{ color: C.accent, display: 'inline-flex', flexShrink: 0 }}><ArrowRight size={13} /></span>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>{hedef}</span>
        </>
      )}
    </div>
  );
}

// ── Pagination controls ───────────────────────────────────────────────────────
function PerPage({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [o, setO] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setO(v => !v)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, height: 44, padding: '0 16px', borderRadius: C.radiusSm, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clay, color: C.ink1, fontSize: 13.5, fontWeight: 700 }}>
        {value} / sayfa <span style={{ color: C.ink3, display: 'inline-flex', transform: o ? 'rotate(180deg)' : 'none', transition: 'transform 220ms ease' }}><ChevronDown size={15} /></span>
      </button>
      {o && (
        <>
          <div onClick={() => setO(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 31, minWidth: 150, padding: 8, borderRadius: C.radiusSm, background: C.surfaceHi, boxShadow: `0 20px 44px -14px rgba(150,128,96,0.5), ${C.clay}`, animation: 'mkPopIn 200ms ease' }}>
            {[10, 20, 50, 100].map(n => (
              <button key={n} onClick={() => { onChange(n); setO(false); }} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 12, background: value === n ? `${C.accent}14` : 'transparent', color: C.ink1, fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                <span style={{ flex: 1 }}>{n} / sayfa</span>{value === n && <span style={{ color: C.accent, display: 'inline-flex' }}><Check size={15} /></span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Pager({ page, pages, onPrev, onNext }: { page: number; pages: number; onPrev: () => void; onNext: () => void }) {
  const btn = (on: boolean): React.CSSProperties => ({ cursor: on ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 7, height: 44, padding: '0 16px', borderRadius: C.radiusSm, background: on ? `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})` : C.surface2, boxShadow: on ? C.clay : C.clayInset, color: on ? C.ink1 : C.ink3, fontSize: 13.5, fontWeight: 700, opacity: on ? 1 : 0.6, border: 'none', fontFamily: 'inherit' });
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button onClick={page > 1 ? onPrev : undefined} style={btn(page > 1)}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> Önceki</button>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, height: 44, padding: '0 12px', borderRadius: C.radiusSm, background: `linear-gradient(180deg, ${C.accent2}, ${C.accent})`, boxShadow: `0 6px 12px -5px ${C.accentGlow}`, color: '#fff', fontSize: 14.5, fontWeight: 800 }}>{page}</span>
      <button onClick={page < pages ? onNext : undefined} style={btn(page < pages)}>Sonraki <ArrowRight size={14} /></button>
    </div>
  );
}

// ── Transaction row (wide) ────────────────────────────────────────────────────
const TXN_COLS = '36px 122px 106px 150px minmax(92px,0.95fr) 140px 58px minmax(140px,1.35fr)';

function TxnExpand({ tx }: { tx: LedgerRow }) {
  const postChips: React.ReactNode[] = [];
  if (tx.postAdetDepo !== undefined) {
    postChips.push(
      <span key="depo" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: C.radiusPill, background: 'rgba(124,168,222,0.16)', boxShadow: C.clayFlat, color: SKY_DEEP, fontSize: 13.5, fontWeight: 700 }}>
        <Warehouse size={15} /> {tx.konum}: {tx.postAdetDepo}
      </span>
    );
  }
  if (tx.postAdetHedef !== undefined) {
    const loc = tx.hedefKonum || tx.konum;
    postChips.push(
      <span key="hedef" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: C.radiusPill, background: 'rgba(111,181,133,0.16)', boxShadow: C.clayFlat, color: C.waterDeep, fontSize: 13.5, fontWeight: 700 }}>
        <Building2 size={15} /> {loc}: {tx.postAdetHedef}
      </span>
    );
  }
  return (
    <div style={{ padding: '4px 22px 18px 60px', animation: 'mkPopIn 260ms ease' }}>
      <div style={{ padding: 16, borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
          <span style={{ color: C.accent, display: 'inline-flex' }}><Hash size={15} /></span>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ink1 }}>İşlemdeki Seri Numaraları ({tx.seriNolar.length})</span>
        </div>
        {tx.seriNolar.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {tx.seriNolar.map(s => (
              <span key={s} style={{ padding: '6px 12px', borderRadius: C.radiusPill, background: C.surfaceHi, boxShadow: C.clayFlat, fontSize: 12.5, fontWeight: 600, color: C.ink1, fontFamily: 'ui-monospace, monospace' }}>{s}</span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.ink3, fontStyle: 'italic' }}>Bu işlem lot bazlıdır, seri numarası bulunmuyor.</div>
        )}
        {postChips.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.ink3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>İşlem Sonrası Stok</span>
            {postChips}
          </div>
        )}
      </div>
    </div>
  );
}

function TxnRow({ tx, open, onToggle }: { tx: LedgerRow; open: boolean; onToggle: () => void }) {
  return (
    <div style={{ borderRadius: C.radius, background: C.surfaceHi, boxShadow: open ? `${C.clayFlat}, 0 0 0 1.5px ${C.accent}44` : C.clayFlat, transition: 'box-shadow 300ms ease', overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ display: 'grid', gridTemplateColumns: TXN_COLS, gap: 12, alignItems: 'center', padding: '13px 22px', cursor: 'pointer' }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', color: C.accent, background: C.surface2, boxShadow: C.clayInset, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 260ms ease' }}><ChevronRight size={14} /></span>
        <Cell mono strong>{tx.lotNumarasi || '-'}</Cell>
        <Cell mono>{tx.miad || '-'}</Cell>
        <div><TypeBadge type={tx.islemTipi} /></div>
        <Cell>{tx.actor || '—'}</Cell>
        <Cell mono>{format(tx.tarih, 'dd.MM.yyyy HH:mm', { locale: tr })}</Cell>
        <div style={{ textAlign: 'center' }}><span style={{ fontSize: 15, fontWeight: 800, color: C.ink1 }}>{tx.adet}</span></div>
        <Flow kaynak={tx.konum} hedef={tx.hedefKonum} />
      </div>
      {open && <TxnExpand tx={tx} />}
    </div>
  );
}

function TxnCard({ tx, open, onToggle }: { tx: LedgerRow; open: boolean; onToggle: () => void }) {
  return (
    <div style={{ borderRadius: C.radius, background: C.surfaceHi, boxShadow: open ? `${C.clayFlat}, 0 0 0 1.5px ${C.accent}44` : C.clayFlat, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', cursor: 'pointer' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <TypeBadge type={tx.islemTipi} />
          </div>
          <div style={{ fontSize: 12.5, color: C.ink2, fontFamily: 'ui-monospace, monospace', marginTop: 5 }}>Lot {tx.lotNumarasi || '-'} · {format(tx.tarih, 'dd.MM.yyyy HH:mm', { locale: tr })}</div>
          <div style={{ fontSize: 12.5, color: C.ink2, marginTop: 3 }}>{tx.konum}{tx.hedefKonum ? ` → ${tx.hedefKonum}` : ''} · {tx.actor || '—'}</div>
        </div>
        <span style={{ fontSize: 18, fontWeight: 800, color: C.accent }}>{tx.adet}</span>
        <span style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', color: C.accent, background: C.surface2, boxShadow: C.clayInset, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 260ms ease' }}><ChevronRight size={14} /></span>
      </div>
      {open && <TxnExpand tx={tx} />}
    </div>
  );
}

// ── Detail view ───────────────────────────────────────────────────────────────
function DetailView({ prod, stock, txns, onBack, wide }: {
  prod: { name: string; code: string; unit: string }; stock: StockSummary[]; txns: LedgerRow[]; onBack: (() => void) | null; wide: boolean;
}) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  React.useEffect(() => { setPage(1); setOpen(new Set()); }, [prod.code]);

  const pages = Math.max(1, Math.ceil(txns.length / perPage));
  const slice = txns.slice((page - 1) * perPage, page * perPage);
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div style={{ animation: 'mkPopIn 320ms ease' }}>
      {/* breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderRadius: C.radius, background: C.surface2, boxShadow: C.clayInset, marginBottom: 16 }}>
        <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 13, display: 'grid', placeItems: 'center', color: C.accent, background: C.surfaceHi, boxShadow: C.clayFlat }}><Box size={20} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prod.name}</div>
          <div style={{ fontSize: 13, color: C.ink2, fontWeight: 600, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>{prod.code}{prod.unit ? ` · ${prod.unit}` : ''}</div>
        </div>
        {onBack && (
          <button onClick={onBack} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 18px', borderRadius: C.radiusSm, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clay, color: C.ink1, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
            <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> Listeye Dön
          </button>
        )}
      </div>

      {/* stock distribution */}
      {stock.length > 0 && (
        <div style={{ padding: '18px 22px', borderRadius: C.radius, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, boxShadow: C.clay, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ color: C.accent, display: 'inline-flex' }}><Box size={19} /></span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.ink3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Güncel Stok Dağılımı</span>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {stock.map((s, i) => {
              const isLab = s.konumTipi === 'laboratuvar';
              const col = isLab ? C.waterDeep : SKY;
              const bg = isLab ? 'rgba(111,181,133,0.14)' : 'rgba(124,168,222,0.16)';
              return (
                <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 11, padding: '12px 18px', borderRadius: C.radiusPill, background: bg, boxShadow: C.clayFlat }}>
                  <span style={{ color: col, display: 'inline-flex' }}>{isLab ? <Building2 size={18} /> : <Warehouse size={18} />}</span>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: C.ink1 }}>{s.konum}</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: col }}>{s.adet}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink2 }}>{s.birim}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* list head */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.ink2 }}>
          Toplam <strong style={{ color: C.ink1 }}>{txns.length}</strong> işlem · Sayfa {page} / {pages}
        </div>
        <div style={{ flex: 1 }} />
        <PerPage value={perPage} onChange={v => { setPerPage(v); setPage(1); }} />
        <Pager page={page} pages={pages} onPrev={() => setPage(p => Math.max(1, p - 1))} onNext={() => setPage(p => Math.min(pages, p + 1))} />
      </div>

      {/* table */}
      <div style={{ borderRadius: C.radiusLg, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, boxShadow: C.clay, overflow: 'hidden' }}>
        {wide && (
          <div style={{ display: 'grid', gridTemplateColumns: TXN_COLS, gap: 12, padding: '15px 22px', borderBottom: `1px solid ${C.line}` }}>
            {['', 'Lot', 'Miad', 'İşlem Tipi', 'İşlemi Yapan', 'Tarih / Saat', 'Adet', 'Akış (Kaynak → Hedef)'].map((h, i) => (
              <div key={i} style={{ fontSize: 10.5, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: i === 6 ? 'center' : 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h}</div>
            ))}
          </div>
        )}
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {slice.length === 0 ? (
            <div style={{ padding: '50px 0', textAlign: 'center', color: C.ink3, fontWeight: 600 }}>Liste boş.</div>
          ) : (
            slice.map(tx => (
              wide
                ? <TxnRow key={tx.id} tx={tx} open={open.has(tx.id)} onToggle={() => toggle(tx.id)} />
                : <TxnCard key={tx.id} tx={tx} open={open.has(tx.id)} onToggle={() => toggle(tx.id)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Matching products picker ──────────────────────────────────────────────────
function MatchList({ items, onPick }: { items: ProductMatch[]; onPick: (p: ProductMatch) => void }) {
  return (
    <div style={{ animation: 'mkPopIn 320ms ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ color: C.accent, display: 'inline-flex' }}><Box size={20} /></span>
        <span style={{ fontSize: 16, fontWeight: 800, color: C.ink1 }}>Eşleşen Ürünler ({items.length})</span>
        <span style={{ fontSize: 13.5, color: C.ink3, fontWeight: 500 }}>— Detayları yüklemek için bir ürün seçin</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((p, i) => <MatchRow key={p.stokKodu} p={p} onPick={() => onPick(p)} i={i} />)}
      </div>
    </div>
  );
}

function MatchRow({ p, onPick, i }: { p: ProductMatch; onPick: () => void; i: number }) {
  const [pr, setPr] = useState(false);
  return (
    <button onClick={onPick} onPointerDown={() => setPr(true)} onPointerUp={() => setPr(false)} onPointerLeave={() => setPr(false)}
      style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 16, padding: '18px 22px', borderRadius: C.radius, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, boxShadow: pr ? C.clayPress : C.clay, transition: 'transform 220ms ease, box-shadow 220ms ease', transform: pr ? 'translateY(1px) scale(0.995)' : 'none', animation: `mkPopIn ${260 + i * 40}ms ease` }}>
      <span style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: C.accent, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: C.clayFlat }}><Box size={22} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.ink1, letterSpacing: '-0.01em' }}>{p.stokAdi}</div>
        <div style={{ fontSize: 13, color: C.ink2, fontWeight: 600, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>{p.stokKodu}{p.anaBirim ? ` · ${p.anaBirim}` : ''}</div>
      </div>
      <span style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', color: '#fff', background: `radial-gradient(120% 120% at 30% 25%, ${C.accent2}, ${C.accent})`, boxShadow: `0 6px 12px -4px ${C.accentGlow}` }}><ArrowRight size={19} /></span>
    </button>
  );
}

// ── Empty / no-result states ──────────────────────────────────────────────────
function EmptyState({ noResult, query }: { noResult?: boolean; query?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '80px 40px', textAlign: 'center', animation: 'mkPopIn 320ms ease' }}>
      <div style={{ width: 96, height: 96, borderRadius: '30%', display: 'grid', placeItems: 'center', background: C.surface2, boxShadow: C.clayInset, color: noResult ? C.danger : C.ink3 }}>
        {noResult ? <X size={40} /> : <Search size={42} />}
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.ink1 }}>{noResult ? 'Sonuç Bulunamadı' : 'Aramaya Başlayın'}</div>
        <div style={{ fontSize: 14.5, color: C.ink2, fontWeight: 500, marginTop: 8, maxWidth: 460, lineHeight: 1.6 }}>
          {noResult ? `"${query}" ile eşleşen kayıt bulunamadı. Stok kodu, lot veya seri numarasını kontrol edin.` : 'Yukarıdaki arama çubuğuna stok kodu, stok adı, lot numarası veya seri numarası girerek arama yapabilirsiniz.'}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Panel
// =============================================================================
export default function AramaPanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const searchCounterRef = useRef(0);

  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchType, setSearchType] = useState<'product' | 'lot' | 'serial'>('product');

  const [results, setResults] = useState<LedgerRow[]>([]);
  const [stockSummary, setStockSummary] = useState<StockSummary[]>([]);
  const [productMatches, setProductMatches] = useState<ProductMatch[]>([]);
  const [selectedStokKodu, setSelectedStokKodu] = useState<string | null>(null);

  const [wide, setWide] = useState(true);
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const h = () => setWide(mq.matches); h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  const runSearch = useCallback(async (q: string, pickedStokKodu: string | null) => {
    const currentSearch = ++searchCounterRef.current;
    setQuery(q);
    setIsSearching(true);
    setHasSearched(true);

    try {
      const result: SearchResult = await searchProductLedger(q, currentCompanyId, isSuperAdmin, pickedStokKodu);
      if (currentSearch !== searchCounterRef.current) return;

      if (result.needsProductSelection && result.productMatches && result.productMatches.length > 0) {
        setProductMatches(result.productMatches);
        setResults([]);
        setStockSummary([]);
        setSearchType(result.searchType);
        setSelectedStokKodu(null);
        toast({ title: 'Ürün Seçin', description: `${result.productMatches.length} eşleşen ürün bulundu. Listeden birini seçin.` });
        return;
      }

      const ledgerRows = result.ledgerRows
        .map(row => ({ ...row, tarih: row.tarih instanceof Date ? row.tarih : new Date(row.tarih) }))
        .sort((a, b) => b.tarih.getTime() - a.tarih.getTime());

      setProductMatches([]);
      setResults(ledgerRows);
      setStockSummary(result.stockSummary);
      setSearchType(result.searchType);

      if (ledgerRows.length === 0) {
        toast({ title: 'Sonuç Bulunamadı', description: 'Arama kriterlerine uygun kayıt bulunamadı.' });
      } else {
        toast({ title: 'Arama Tamamlandı', description: `${ledgerRows.length} işlem kaydı bulundu.` });
      }
    } catch (error) {
      if (currentSearch !== searchCounterRef.current) return;
      console.error('Search error:', error);
      const message = error instanceof Error && error.message.includes('zaman aşımı')
        ? 'Arama zaman aşımına uğradı. Lütfen daha spesifik bir arama yapın.'
        : 'Arama sırasında bir hata oluştu. Lütfen tekrar deneyin.';
      toast({ title: 'Arama Hatası', description: message, variant: 'destructive' });
    } finally {
      if (currentSearch === searchCounterRef.current) setIsSearching(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin]);

  const handleSearch = useCallback(() => {
    const q = draft.trim();
    if (q.length < 2) {
      toast({ title: 'Arama Çok Kısa', description: 'En az 2 karakter girmeniz gerekiyor.' });
      return;
    }
    setSelectedStokKodu(null);
    setProductMatches([]);
    runSearch(q, null);
  }, [draft, runSearch, toast]);

  const handleSelectProduct = useCallback((match: ProductMatch) => {
    setSelectedStokKodu(match.stokKodu);
    setProductMatches([]);
    runSearch(query, match.stokKodu);
  }, [runSearch, query]);

  const handleBackToList = useCallback(() => {
    setSelectedStokKodu(null);
    setResults([]);
    setStockSummary([]);
    if (query) runSearch(query, null);
  }, [runSearch, query]);

  const clearAll = useCallback(() => {
    setDraft('');
    setQuery('');
    setHasSearched(false);
    setResults([]);
    setStockSummary([]);
    setProductMatches([]);
    setSelectedStokKodu(null);
  }, []);

  const handleExport = useCallback(() => {
    if (results.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak veri bulunmuyor.' });
      return;
    }
    const data = results.map(ev => ({
      'Stok Kodu': ev.stokKodu,
      'Stok Adı': ev.stokAdi,
      'Lot': ev.lotNumarasi || '-',
      'Miad': ev.miad || '-',
      'İşlem Tipi': ev.islemTipi,
      'İşlemi Yapan': ev.actor || '-',
      'Tarih/Saat': format(ev.tarih, 'dd.MM.yyyy HH:mm', { locale: tr }),
      'İşlem Adedi': ev.adet,
      'Kaynak Konum': ev.konum,
      'Hedef Konum': ev.hedefKonum || '-',
      'Sonrası Depo': ev.postAdetDepo ?? '-',
      'Sonrası Hedef': ev.postAdetHedef ?? '-',
      'Seri Numaraları': ev.seriNolar.join(', ') || '-',
    }));
    exportDataToExcel(data, `Arama_Ekstre_${query.replace(/\s+/g, '_')}`, 'Ekstre', toast);
  }, [results, query, toast]);

  const prod = useMemo(() => {
    if (results.length === 0) return null;
    const first = results[0];
    return { name: first.stokAdi, code: first.stokKodu, unit: stockSummary[0]?.birim || '' };
  }, [results, stockSummary]);

  const showDetail = hasSearched && !isSearching && productMatches.length === 0 && results.length > 0 && prod;
  const showNoResult = hasSearched && !isSearching && productMatches.length === 0 && results.length === 0;
  const showMatching = !isSearching && productMatches.length > 0;
  const showEmpty = !hasSearched && !isSearching && productMatches.length === 0;
  const headerDivider = showDetail || showMatching;

  const typeLabel = searchType === 'serial' ? 'Seri No Araması' : searchType === 'lot' ? 'Lot Araması' : 'Ürün Araması';

  return (
    <div className="mk-shell" style={{ minHeight: '100vh' }}>
      <MkClayStyles />
      <SearchBar value={draft} onChange={setDraft} onSubmit={handleSearch} onClear={clearAll} busy={isSearching} />

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '6px 24px 60px' }}>
        <div style={{ borderRadius: C.radiusLg, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, boxShadow: C.clay, overflow: 'hidden' }}>

          {/* card header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '24px 28px', borderBottom: headerDivider ? `1px solid ${C.line}` : 'none', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
                <span style={{ color: C.accent, display: 'inline-flex' }}><Search size={24} /></span>
                <h1 style={{ margin: 0, fontSize: 25, fontWeight: 800, letterSpacing: '-0.02em', color: C.ink1 }}>Qore Search</h1>
                <span style={{ padding: '5px 12px', borderRadius: C.radiusPill, background: C.surface2, boxShadow: C.clayInset, fontSize: 12.5, fontWeight: 700, color: C.ink2, whiteSpace: 'nowrap' }}>{hasSearched ? typeLabel : 'Ürün Araması'}</span>
              </div>
              <p style={{ margin: '7px 0 0', fontSize: 14.5, color: C.ink2, fontWeight: 500 }}>Stok kodu, stok adı, lot veya seri numarası ile arayın.</p>
            </div>
            <button onClick={handleExport} disabled={results.length === 0} style={{ all: 'unset', cursor: results.length === 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10, height: 48, padding: '0 20px', borderRadius: C.radiusSm, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clay, color: C.waterDeep, fontSize: 14.5, fontWeight: 700, opacity: results.length === 0 ? 0.5 : 1 }}>
              <FileSpreadsheet size={18} /> Excel&apos;e Aktar
            </button>
          </div>

          {/* body */}
          <div style={{ padding: showEmpty || showNoResult ? 0 : '22px 24px' }}>
            {isSearching && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '70px 0', color: C.ink2 }}>
                <span style={{ display: 'inline-flex', animation: 'mkSpin 1s linear infinite' }}><RefreshCw size={22} /></span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Aranıyor…</span>
              </div>
            )}
            {!isSearching && showEmpty && <EmptyState />}
            {!isSearching && showNoResult && <EmptyState noResult query={query} />}
            {showMatching && <MatchList items={productMatches} onPick={handleSelectProduct} />}
            {showDetail && prod && (
              <DetailView prod={prod} stock={stockSummary} txns={results} wide={wide} onBack={selectedStokKodu ? handleBackToList : null} />
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
