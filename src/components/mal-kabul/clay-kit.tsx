/**
 * @fileoverview Mal Kabul — claymorphic cream design kit
 * @description Shared design tokens, keyframes and presentational components
 * for the Mal Kabul panel + history page, matching the Siparişler / Direkt
 * Transfer cream-clay language.
 */

'use client';

import React, { useState } from 'react';
import { Camera, Plus, FileText, Search, RefreshCw, Check, Package, QrCode, Box, Trash2, ArrowRight, MapPin, AlertTriangle } from 'lucide-react';

// ── Cream clay design tokens (matches Siparişler / Direkt Transfer) ──────────
export const MK_C = {
  bg0: '#EFEAE0',
  surface: '#FCFAF5',
  surface2: '#F5F1E8',
  surfaceHi: '#FFFFFF',
  ink1: '#3D382F',
  ink2: '#908872',
  ink3: '#BBB2A0',
  line: 'rgba(90,72,40,0.07)',
  accent: '#C98A57',
  accent2: '#E0B776',
  accentGlow: 'rgba(201,138,87,0.24)',
  waterSolid: '#6FB585',
  waterDeep: '#4E9E6B',
  amber: '#E0A33E',
  amberSoft: 'rgba(224,163,62,0.16)',
  danger: '#C0796A',
  radius: 24,
  radiusSm: 16,
  radiusLg: 32,
  radiusPill: 999,
  clay: 'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16)',
  clayPress: 'inset 0 2px 5px rgba(178,160,128,0.32), inset 0 -1px 0 rgba(255,255,255,0.6), 0 2px 6px -4px rgba(150,128,96,0.2)',
  clayInset: 'inset 0 2px 5px rgba(178,160,128,0.30), inset 0 -1px 0 rgba(255,255,255,0.55)',
  clayFlat: 'inset 0 1px 1px rgba(255,255,255,0.85), 0 4px 12px -7px rgba(150,128,96,0.28)',
} as const;

/** Keyframes + shell helpers injected once per page. */
export function MkClayStyles() {
  return (
    <style>{`
      @keyframes mkAmberPulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(224,163,62,0.45), inset 0 3px 5px rgba(255,255,255,0.6), inset 0 -5px 9px rgba(150,100,30,0.35); }
        50% { box-shadow: 0 0 0 10px rgba(224,163,62,0), inset 0 3px 5px rgba(255,255,255,0.6), inset 0 -5px 9px rgba(150,100,30,0.35); }
      }
      @keyframes mkReadyGlow {
        0%,100% { box-shadow: inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16), 0 0 0 1.5px rgba(111,181,133,0.55), 0 0 16px -3px rgba(111,181,133,0.25); }
        50% { box-shadow: inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16), 0 0 0 1.5px rgba(111,181,133,0.9), 0 0 26px 1px rgba(111,181,133,0.5); }
      }
      @keyframes mkLivePulse { 0%,100% { box-shadow: 0 0 0 0 rgba(111,181,133,0.55); } 70% { box-shadow: 0 0 0 7px rgba(111,181,133,0); } }
      @keyframes mkCountPop { 0% { transform: scale(0.55); opacity: 0; } 55% { transform: scale(1.18); } 100% { transform: scale(1); opacity: 1; } }
      @keyframes mkBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
      @keyframes mkSpin { to { transform: rotate(360deg); } }
      @keyframes mkPopIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @keyframes mkFadeIn { from { opacity: 0; } to { opacity: 1; } }
      .mk-shell { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background: linear-gradient(120deg, #F6F2EA 0%, transparent 55%), linear-gradient(225deg, #E8E1D2 0%, transparent 55%), #EFEAE0; color: #3D382F; min-height: 100vh; -webkit-font-smoothing: antialiased; }
      .mk-grid-kpi { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.15fr); gap: 14px; }
      @media (max-width: 1079px) { .mk-grid-kpi { grid-template-columns: 1fr; } }
    `}</style>
  );
}

const C = MK_C;

// ── Top stepper (Depo → Okut → Kabul) ────────────────────────────────────────
export function MkTopStepper({ active }: { active: number }) {
  const steps = ['Depo', 'Okut', 'Kabul'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {steps.map((label, i) => {
        const cur = active === i;
        const done = active > i;
        return (
          <React.Fragment key={label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 800,
                background: done ? 'linear-gradient(180deg, #8FD3A6, #6FB585)' : cur ? `linear-gradient(180deg, ${C.accent2}, ${C.accent})` : C.surface2,
                boxShadow: (done || cur) ? '0 5px 11px -4px rgba(150,128,96,0.4)' : C.clayInset,
                color: (done || cur) ? '#fff' : C.ink3, transition: 'all 320ms ease',
              }}>{done ? <Check size={14} /> : i + 1}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: cur ? C.ink1 : C.ink3, whiteSpace: 'nowrap' }}>{label}</span>
            </div>
            {i < 2 && <span style={{ width: 28, height: 2.5, borderRadius: 2, background: active > i ? C.waterSolid : C.ink3, opacity: active > i ? 1 : 0.3, transition: 'all 320ms ease' }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Soft pill button (Geçmiş / Bekleyen İrsaliyeler) ─────────────────────────
export function MkSoftBtn({ icon, children, onClick, disabled, badge, accentIcon = true }: {
  icon?: React.ReactNode; children: React.ReactNode; onClick?: () => void; disabled?: boolean; badge?: number; accentIcon?: boolean;
}) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{
      all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer', position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 9,
      height: 46, padding: '0 18px', borderRadius: C.radiusSm,
      background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clay,
      color: C.ink1, fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', opacity: disabled ? 0.5 : 1,
    }}>
      {icon && <span style={{ color: accentIcon ? C.accent : C.ink2, display: 'inline-flex' }}>{icon}</span>}
      {children}
      {badge != null && badge > 0 && (
        <span style={{ position: 'absolute', top: -7, right: -7, minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999, display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg, #E58A78, #C0796A)', color: '#fff', fontSize: 12, fontWeight: 800, boxShadow: '0 4px 9px -3px rgba(192,121,106,0.7)' }}>{badge}</span>
      )}
    </button>
  );
}

// ── Readiness KPI card ───────────────────────────────────────────────────────
const MK_READY_STEPS = ['Barkod formatları', 'Stok & adres verileri', 'İrsaliye eşleştirme'];

export type MkLastItem = { stokAdi: string; stokKodu: string; seriNumarasi?: string; lotNumarasi?: string; miad?: string; qty: number; unit: string } | null;

export function MkReadinessCard({ stage, ready, pct, lastItem, lotCount, unitCount, pulse, onReload, feedback }: {
  stage: number; ready: boolean; pct: number; lastItem: MkLastItem; lotCount: number; unitCount: number; pulse: boolean; onReload: () => void;
  feedback?: { type: 'success' | 'error'; message: string } | null;
}) {
  const readyShadow = `${C.clay}, 0 0 0 1.5px rgba(111,181,133,0.55), 0 0 16px -3px rgba(111,181,133,0.25)`;
  const loadingShadow = `${C.clay}, 0 0 0 1.5px rgba(224,163,62,0.32)`;
  return (
    <div style={{
      padding: 16, borderRadius: C.radius, minHeight: 184,
      background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
      boxShadow: ready ? readyShadow : loadingShadow,
      animation: ready ? 'mkReadyGlow 2.6s ease-in-out infinite' : undefined,
      transition: 'box-shadow 600ms ease', display: 'flex', flexDirection: 'column',
    }}>
      {ready
        ? <MkReadyView lastItem={lastItem} lotCount={lotCount} unitCount={unitCount} pulse={pulse} onReload={onReload} feedback={feedback} />
        : <MkPreparingView stage={stage} pct={pct} onReload={onReload} />}
    </div>
  );
}

function MkReloadBtn({ onReload, size = 34 }: { onReload: () => void; size?: number }) {
  return (
    <button onClick={onReload} aria-label="Yeniden yükle" style={{
      all: 'unset', cursor: 'pointer', width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'grid', placeItems: 'center', color: C.ink2,
      background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clayFlat,
    }}><RefreshCw size={16} /></button>
  );
}

function MkReadyView({ lastItem, lotCount, unitCount, pulse, onReload, feedback }: {
  lastItem: MkLastItem; lotCount: number; unitCount: number; pulse: boolean; onReload: () => void;
  feedback?: { type: 'success' | 'error'; message: string } | null;
}) {
  const showError = feedback?.type === 'error';
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: C.waterDeep, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          <span style={{ position: 'relative', width: 12, height: 12 }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: C.waterSolid, animation: 'mkLivePulse 1.8s ease-in-out infinite' }} />
          </span>
          Sistem Hazır · Barkod Okutmaya Hazır
        </span>
        <span style={{ marginLeft: 'auto' }}><MkReloadBtn onReload={onReload} /></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 150px', gap: 14, flex: 1 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.waterDeep, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>Son Okutulan Ürün</div>
          {showError ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 86 }}>
              <span style={{ color: C.danger, display: 'inline-flex' }}><AlertTriangle size={22} /></span>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.danger, lineHeight: 1.35 }}>{feedback?.message}</div>
            </div>
          ) : lastItem ? (
            <div key={lastItem.stokKodu + lastItem.qty} style={{ animation: 'mkPopIn 260ms ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <span style={{
                  width: 42, height: 42, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center', color: '#fff',
                  background: 'radial-gradient(circle at 32% 28%, #A6E3BC 0%, #6FB585 78%)',
                  boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.55), 0 6px 12px -5px rgba(111,181,133,0.6)',
                }}><Box size={20} /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink1, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lastItem.stokAdi}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.ink2, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>{lastItem.stokKodu}</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {lastItem.seriNumarasi && <span style={chipMono}>SN: {lastItem.seriNumarasi}</span>}
                {lastItem.lotNumarasi && <span style={chipMono}>Lot: {lastItem.lotNumarasi}</span>}
                {lastItem.miad && <span style={chipMono}>SKT: {lastItem.miad}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.ink2 }}>Bu üründen</span>
                <span key={lastItem.qty} style={{
                  display: 'inline-flex', alignItems: 'baseline', gap: 4, padding: '5px 12px', borderRadius: C.radiusPill,
                  background: 'linear-gradient(180deg, #8FD3A6, #6FB585)',
                  boxShadow: '0 5px 11px -5px rgba(111,181,133,0.7), inset 0 1px 0 rgba(255,255,255,0.4)',
                  color: '#fff', animation: pulse ? 'mkCountPop 480ms ease' : 'none',
                }}>
                  <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{lastItem.qty}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.92 }}>{lastItem.unit}</span>
                </span>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 86 }}>
              <span style={{ display: 'inline-flex', color: C.waterDeep, animation: 'mkBob 2.4s ease-in-out infinite' }}><QrCode size={26} /></span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink1 }}>Barkod okutun</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: C.ink2, marginTop: 2 }}>Son okutulan ürün burada görünecek.</div>
              </div>
            </div>
          )}
        </div>

        <div style={{ borderRadius: C.radiusSm, padding: '12px 14px', background: C.surface2, boxShadow: C.clayInset, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.ink3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Okuma Adetleri</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: C.waterDeep, lineHeight: 1 }}>{lotCount}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.ink2 }}>lot</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: C.ink1, lineHeight: 1 }}>{unitCount}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.ink2 }}>ürün</span>
          </div>
        </div>
      </div>
    </>
  );
}

const chipMono: React.CSSProperties = { padding: '3px 9px', borderRadius: 999, background: MK_C.surface2, boxShadow: MK_C.clayInset, fontSize: 11, fontWeight: 600, color: MK_C.ink2, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' };

function MkPreparingView({ stage, pct, onReload }: { stage: number; pct: number; onReload: () => void }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <div style={{
          width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
          background: 'radial-gradient(circle at 32% 28%, #F4CE86 0%, #E0A33E 75%)',
          boxShadow: 'inset 0 3px 5px rgba(255,255,255,0.6), inset 0 -5px 9px rgba(150,100,30,0.35)',
          animation: 'mkAmberPulse 1.8s ease-in-out infinite', display: 'grid', placeItems: 'center', color: '#fff',
        }}>
          <span style={{ display: 'inline-flex', animation: 'mkSpin 1.1s linear infinite' }}><RefreshCw size={19} /></span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Sistem Durumu</div>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em', color: C.amber, marginTop: 2 }}>Sistem Hazırlanıyor…</div>
        </div>
        <span style={{ fontSize: 15, fontWeight: 800, color: C.amber }}>%{pct}</span>
      </div>
      <div style={{ margin: '12px 0' }}>
        <div style={{ height: 7, borderRadius: 99, background: C.surface2, boxShadow: C.clayInset, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: C.amber, transition: 'width 500ms ease' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {MK_READY_STEPS.map((label, i) => {
          const done = stage > i, loading = stage === i;
          return (
            <div key={label} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '11px 8px', borderRadius: C.radiusSm,
              background: done ? 'rgba(111,181,133,0.10)' : loading ? C.amberSoft : C.surface2,
              boxShadow: done || loading ? 'none' : C.clayInset, transition: 'background 400ms ease', textAlign: 'center',
            }}>
              <span style={{
                width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                background: done ? C.waterSolid : loading ? C.amber : C.surfaceHi,
                boxShadow: done || loading ? 'none' : C.clayInset, color: done || loading ? '#fff' : C.ink3,
              }}>
                {done ? <Check size={14} /> : loading ? <span style={{ display: 'inline-flex', animation: 'mkSpin 1s linear infinite' }}><RefreshCw size={13} /></span> : <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.ink3 }} />}
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: done ? C.waterDeep : loading ? '#9A6F1E' : C.ink2, lineHeight: 1.2 }}>{label}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Add panel (5 tiles) ──────────────────────────────────────────────────────
export function MkAddTile({ icon, label, onClick, disabled, highlight, badge, active }: {
  icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean; highlight?: boolean; badge?: number; active?: boolean;
}) {
  const [p, setP] = useState(false);
  const hl = highlight && !disabled;
  const pressed = p || active;
  return (
    <button onClick={disabled ? undefined : onClick}
      onPointerDown={() => !disabled && setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer', boxSizing: 'border-box', position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '14px 6px',
        borderRadius: C.radiusSm,
        background: hl ? `linear-gradient(180deg, ${C.accent2}, ${C.accent})` : active ? C.surface2 : `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`,
        boxShadow: pressed ? C.clayPress : (hl ? `inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 20px -9px ${C.accentGlow}` : C.clayFlat),
        color: disabled ? C.ink3 : hl ? '#fff' : C.ink1, opacity: disabled ? 0.5 : 1,
        transition: 'transform 200ms ease, box-shadow 200ms ease', transform: p ? 'translateY(1px) scale(0.97)' : 'none', textAlign: 'center',
      }}>
      <span style={{ color: disabled ? C.ink3 : hl ? '#fff' : C.accent, display: 'inline-flex' }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>
      {badge != null && badge > 0 && (
        <span style={{ position: 'absolute', top: 6, right: 6, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999, display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg, #E58A78, #C0796A)', color: '#fff', fontSize: 11, fontWeight: 800 }}>{badge}</span>
      )}
    </button>
  );
}

export function MkAddPanel({ ready, onTekli, onSeri, onManual, onIrsaliye, onDepoda, manualActive, irsaliyeBadge, depodaDisabled, depodaLoading }: {
  ready: boolean; onTekli: () => void; onSeri: () => void; onManual: () => void; onIrsaliye: () => void; onDepoda: () => void;
  manualActive?: boolean; irsaliyeBadge?: number; depodaDisabled?: boolean; depodaLoading?: boolean;
}) {
  return (
    <div style={{ padding: 16, borderRadius: C.radius, minHeight: 184, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, boxShadow: C.clay, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink3, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Ürün Ekle</span>
        {!ready && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999, background: C.amberSoft, color: '#9A6F1E', fontSize: 11, fontWeight: 700 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber }} /> Hazırlanıyor
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 9, flex: 1 }}>
        <MkAddTile icon={<Camera size={20} />} label="Tekli Tara" onClick={onTekli} disabled={!ready} />
        <MkAddTile icon={<Camera size={20} />} label="Seri Tarama" onClick={onSeri} disabled={!ready} highlight />
        <MkAddTile icon={<Plus size={20} />} label="Manuel Ekle" onClick={onManual} active={manualActive} />
        <MkAddTile icon={<FileText size={20} />} label="İrsaliye Tara" onClick={onIrsaliye} disabled={!ready} badge={irsaliyeBadge} />
        <MkAddTile icon={depodaLoading ? <span style={{ display: 'inline-flex', animation: 'mkSpin 1s linear infinite' }}><RefreshCw size={18} /></span> : <Search size={20} />} label={depodaLoading ? 'Sorgulanıyor…' : 'Depoda Kontrol'} onClick={onDepoda} disabled={depodaDisabled} />
      </div>
    </div>
  );
}

// ── Toolbar chip button ──────────────────────────────────────────────────────
export function MkChipBtn({ icon, children, onClick, active, danger, disabled, title }: {
  icon?: React.ReactNode; children: React.ReactNode; onClick?: () => void; active?: boolean; danger?: boolean; disabled?: boolean; title?: string;
}) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} title={title} style={{
      all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 14px',
      borderRadius: C.radiusSm,
      background: active ? `${C.accent}16` : `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`,
      boxShadow: active ? `inset 0 0 0 1.5px ${C.accent}66` : C.clay,
      color: danger ? C.danger : active ? C.accent : C.ink1, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', opacity: disabled ? 0.4 : 1,
    }}>
      {icon}{children}
    </button>
  );
}

// ── Accept button ────────────────────────────────────────────────────────────
export function MkAcceptBtn({ count, onClick, disabled, loading, label }: { count: number; onClick: () => void; disabled?: boolean; loading?: boolean; label?: string }) {
  const [p, setP] = useState(false);
  const on = count > 0 && !disabled;
  return (
    <button onClick={on && !loading ? onClick : undefined} onPointerDown={() => on && setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: (on && !loading) ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 10, height: 48, padding: '0 22px',
        borderRadius: C.radiusSm, background: on ? 'linear-gradient(180deg, #8FD3A6, #6FB585)' : C.surface2,
        boxShadow: on ? (p ? 'inset 0 3px 7px rgba(60,120,80,0.3)' : 'inset 0 1px 0 rgba(255,255,255,0.4), 0 12px 22px -10px rgba(111,181,133,0.6)') : C.clayInset,
        color: on ? '#fff' : C.ink3, fontWeight: 800, fontSize: 14.5, transition: 'all 240ms ease', transform: p ? 'translateY(1px) scale(0.99)' : 'none',
      }}>
      {loading ? <span style={{ display: 'inline-flex', animation: 'mkSpin 1s linear infinite' }}><RefreshCw size={18} /></span> : <Box size={18} />}
      <span style={{ whiteSpace: 'nowrap' }}>{label ?? `Kabul Et ve Stoğa Ekle (${count})`}</span>
    </button>
  );
}

// ── Small chips for product rows ─────────────────────────────────────────────
export function MkWarnChip({ children }: { children: React.ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: C.radiusPill, background: C.amberSoft, color: '#9A6F1E', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>;
}
export function MkGoodChip({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: C.radiusPill, background: C.surface2, boxShadow: C.clayInset, color: C.ink1, fontSize: 12.5, fontWeight: 700, fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', whiteSpace: 'nowrap' }}>{children}</span>;
}

// ── Empty state ──────────────────────────────────────────────────────────────
export function MkEmptyState({ ready, onSerial, onIrsaliye, onAI, irsaliyeBadge }: {
  ready: boolean; onSerial: () => void; onIrsaliye: () => void; onAI: () => void; irsaliyeBadge?: number;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '64px 40px', textAlign: 'center' }}>
      <div style={{ width: 86, height: 86, borderRadius: '30%', display: 'grid', placeItems: 'center', background: C.surface2, boxShadow: C.clayInset, color: ready ? C.accent : C.ink3, animation: ready ? 'mkBob 2.4s ease-in-out infinite' : 'none' }}>
        {ready ? <Search size={36} /> : <span style={{ display: 'inline-flex', animation: 'mkSpin 1.2s linear infinite', color: C.amber }}><RefreshCw size={32} /></span>}
      </div>
      <div>
        <div style={{ fontSize: 19, fontWeight: 800, color: C.ink1 }}>{ready ? 'Okutulmuş ürün bulunmuyor' : 'Sistem hazırlanıyor…'}</div>
        <div style={{ fontSize: 14.5, color: C.ink2, fontWeight: 500, marginTop: 6 }}>{ready ? 'Başlamak için bir yöntem seçin:' : 'Veriler yükleniyor, hazır olunca tarama açılacak.'}</div>
      </div>
      {ready && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={onSerial} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, height: 50, padding: '0 22px', borderRadius: C.radiusSm, background: `linear-gradient(180deg, ${C.accent2}, ${C.accent})`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4), 0 12px 22px -10px ${C.accentGlow}`, color: '#fff', fontWeight: 800, fontSize: 14.5 }}>
            <Camera size={19} /> Seri Tarama Başlat
          </button>
          <button onClick={onIrsaliye} style={{ all: 'unset', cursor: 'pointer', position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 9, height: 50, padding: '0 22px', borderRadius: C.radiusSm, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clay, color: C.ink1, fontWeight: 700, fontSize: 14.5 }}>
            <span style={{ color: C.accent, display: 'inline-flex' }}><FileText size={19} /></span> PDF İrsaliye Yükle
            {irsaliyeBadge != null && irsaliyeBadge > 0 && <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999, display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg, #E58A78, #C0796A)', color: '#fff', fontSize: 11, fontWeight: 800 }}>{irsaliyeBadge}</span>}
          </button>
          <button onClick={onAI} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, height: 50, padding: '0 22px', borderRadius: C.radiusSm, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clay, color: C.ink1, fontWeight: 700, fontSize: 14.5 }}>
            <span style={{ color: C.accent, display: 'inline-flex' }}><Search size={18} /></span> AI Toplu Barkod Tara
          </button>
        </div>
      )}
    </div>
  );
}

// ── Waybill card (Bekleyen İrsaliyeler) ──────────────────────────────────────
export function MkWaybillCard({ title, subtitle, code, selected, onClick, children }: {
  title: string; subtitle?: string; code?: string; selected?: boolean; onClick?: () => void; children?: React.ReactNode;
}) {
  const [p, setP] = useState(false);
  return (
    <div style={{ borderRadius: C.radius, background: C.surfaceHi, boxShadow: selected ? `${C.clayFlat}, 0 0 0 1.5px ${C.accent}66` : (p ? C.clayPress : C.clayFlat), transition: 'box-shadow 200ms ease' }}>
      <button onClick={onClick} onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
        style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.01em', color: C.ink1 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 13, color: C.ink2, fontWeight: 600, marginTop: 3 }}>{subtitle}</div>}
        </div>
        {code && <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink3, fontFamily: 'ui-monospace, monospace' }}>{code}</span>}
        <span style={{ color: C.accent, display: 'inline-flex' }}><ArrowRight size={20} /></span>
      </button>
      {children && <div style={{ padding: '0 20px 16px' }}>{children}</div>}
    </div>
  );
}
