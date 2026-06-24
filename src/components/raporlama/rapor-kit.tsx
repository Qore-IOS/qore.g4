/**
 * @fileoverview Raporlama — claymorphic cream design kit.
 * @description Shared clay primitives for the Reporting hub and its sub-panels
 * (Oluşturulan Raporlar, Dosya Yönetimi, Kümülatif / Cihaz Üstü Hesaplama,
 * Tüketim İstatistikleri, Seri No Format, Stok İşlemleri). Faithful TSX port of
 * the demo `window.RaporData` / `window.RaporViews` kit, layered on top of the
 * established cream-clay tokens (MK_C) so it stays visually consistent with
 * Cihaz Yönetimi / Mal Kabul / Sipariş / Dashboard.
 *
 * Self-contained, responsive-first: inputs use JS token values (not CSS vars),
 * upload zones / dropdowns / modals are touch-friendly (≥44px targets), and all
 * motion respects prefers-reduced-motion through the shared `.cy-scope` styles.
 */
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft, ChevronDown, Check, X, Info, UploadCloud, Calendar,
  type LucideIcon,
} from 'lucide-react';

import { C, AC, type Accent } from '@/components/cihaz-yonetimi/clay-kit';

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

// Re-export the canonical tokens / page wrapper / shared primitives so panels
// only need to import from one place.
export {
  C, AC, PAL, fmtInt, useMode, ClayPage, CyStyles, ICON, StatNum,
  Card, CardHead, Pill, KpiTile, MiniInfo, NavBtn, GhostBtn, IconBtn,
  Segmented, HBar, Donut, Legend, LineChart, ClaySearch, ClayLoader,
} from '@/components/cihaz-yonetimi/clay-kit';
export type { Accent, Mode, Tone } from '@/components/cihaz-yonetimi/clay-kit';

/* ────────────────────────────────────────────────────────────────────────────
   Hub feature card  (matches demo FeatureCard)
   ──────────────────────────────────────────────────────────────────────────── */
export function FeatureCard({
  icon: Icon, title, desc, onClick, ac = AC, delay = 0,
}: { icon: LucideIcon; title: string; desc: string; onClick?: () => void; ac?: Accent; delay?: number }) {
  const [p, setP] = useState(false);
  return (
    <button
      type="button" onClick={onClick}
      onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-start', gap: 16,
        padding: '20px 22px', borderRadius: C.radiusLg,
        background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
        boxShadow: p ? C.clayPress : C.clay,
        animation: `cyRise 460ms ${EASE} ${delay}ms both`,
        transition: `transform 240ms ${EASE}, box-shadow 240ms ${EASE}`,
        transform: p ? 'translateY(1px) scale(0.99)' : 'none',
      }}
    >
      <span style={{ width: 50, height: 50, flexShrink: 0, borderRadius: 15, display: 'grid', placeItems: 'center', color: ac.primary, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: C.clayFlat }}>
        <Icon size={23} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-0.01em', color: C.ink1 }}>{title}</div>
        <p style={{ margin: '5px 0 0', fontSize: 13, color: C.ink2, fontWeight: 500, lineHeight: 1.5 }}>{desc}</p>
      </div>
      <span style={{ color: C.ink3, flexShrink: 0, marginTop: 4 }}><ChevronDown size={16} style={{ transform: 'rotate(-90deg)' }} /></span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   View header with back button  (matches demo ViewHead — light icon tile)
   ──────────────────────────────────────────────────────────────────────────── */
export function RaporHead({
  icon: Icon, title, desc, onBack, right, ac = AC, mobile,
}: { icon?: LucideIcon; title: string; desc?: string; onBack?: () => void; right?: React.ReactNode; ac?: Accent; mobile?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
      {onBack && (
        <SoftBtn onClick={onBack} style={{ whiteSpace: 'nowrap' }}>
          <ChevronLeft size={16} /> Geri Dön
        </SoftBtn>
      )}
      {Icon && (
        <span style={{ width: mobile ? 44 : 50, height: mobile ? 44 : 50, flexShrink: 0, borderRadius: 15, display: 'grid', placeItems: 'center', color: ac.primary, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: C.clayFlat }}>
          <Icon size={mobile ? 22 : 24} />
        </span>
      )}
      <div style={{ flex: 1, minWidth: 180 }}>
        <h1 style={{ margin: 0, fontSize: mobile ? 21 : 25, fontWeight: 800, letterSpacing: '-0.02em', color: C.ink1, lineHeight: 1.15 }}>{title}</h1>
        {desc && <p style={{ margin: '4px 0 0', fontSize: 13.5, color: C.ink2, fontWeight: 500, lineHeight: 1.5 }}>{desc}</p>}
      </div>
      {right}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   SoftBtn  (matches demo RSoftBtn — soft clay button, tone = text/icon color)
   Pass a gradient `style.background` for the primary variant.
   ──────────────────────────────────────────────────────────────────────────── */
export function SoftBtn({
  children, onClick, tone, style, disabled, type = 'button',
}: { children: React.ReactNode; onClick?: () => void; tone?: string; style?: React.CSSProperties; disabled?: boolean; type?: 'button' | 'submit' }) {
  const [p, setP] = useState(false);
  const isCustomBg = !!style?.background;
  return (
    <button
      type={type} onClick={onClick} disabled={disabled}
      onPointerDown={() => !disabled && setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', boxSizing: 'border-box', cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
        height: 48, padding: '0 18px', borderRadius: C.radiusSm,
        background: isCustomBg ? undefined : `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`,
        boxShadow: disabled ? C.clayInset : (p ? C.clayPress : (isCustomBg ? style!.boxShadow : C.clay)),
        color: disabled ? C.ink3 : (tone || C.ink1), fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap',
        opacity: disabled ? 0.7 : 1,
        transition: `transform 200ms ${EASE}, box-shadow 200ms ${EASE}`,
        transform: p ? 'translateY(1px) scale(0.98)' : 'none',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Primary (accent gradient) button — convenience wrapper around SoftBtn. */
export function PrimaryBtn({
  children, onClick, ac = AC, style, disabled, type = 'button',
}: { children: React.ReactNode; onClick?: () => void; ac?: Accent; style?: React.CSSProperties; disabled?: boolean; type?: 'button' | 'submit' }) {
  return (
    <SoftBtn
      onClick={onClick} tone="#fff" disabled={disabled} type={type}
      style={{
        background: disabled ? C.surface2 : `linear-gradient(180deg, ${ac.accent}, ${ac.primary})`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4), 0 12px 22px -10px ${ac.glow}`,
        ...style,
      }}
    >
      {children}
    </SoftBtn>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Field label  (matches demo FieldLabel — uppercase, optional info hint)
   ──────────────────────────────────────────────────────────────────────────── */
export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{children}</span>
      {hint && <Info size={13} style={{ color: C.ink3, flexShrink: 0 }} />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Clay text input
   ──────────────────────────────────────────────────────────────────────────── */
export function ClayInput({
  value, onChange, placeholder, icon, type = 'text', style, onKeyDown, autoFocus, disabled, min, inputMode,
}: {
  value: string | number; onChange?: (v: string) => void; placeholder?: string; icon?: React.ReactNode;
  type?: string; style?: React.CSSProperties; onKeyDown?: (e: React.KeyboardEvent) => void; autoFocus?: boolean;
  disabled?: boolean; min?: string | number; inputMode?: 'numeric' | 'text' | 'decimal';
}) {
  return (
    <div style={{ position: 'relative' }}>
      {icon && <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: C.ink3, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>{icon}</span>}
      <input
        value={value} type={type} placeholder={placeholder} autoFocus={autoFocus} disabled={disabled} min={min} inputMode={inputMode}
        onChange={(e) => onChange?.(e.target.value)} onKeyDown={onKeyDown}
        style={{
          width: '100%', boxSizing: 'border-box', height: 52, padding: icon ? '0 16px 0 44px' : '0 16px', borderRadius: C.radiusSm,
          border: 'none', background: C.surface2, boxShadow: C.clayInset, color: C.ink1, fontSize: 14.5, fontWeight: 600,
          fontFamily: 'inherit', outline: 'none', opacity: disabled ? 0.6 : 1, ...style,
        }}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Clay dropdown  (matches demo Dropdown — custom popover select)
   options: string[] | { value: string; label: string }[]
   ──────────────────────────────────────────────────────────────────────────── */
type Opt = string | { value: string; label: string };
const optVal = (o: Opt) => (typeof o === 'string' ? o : o.value);
const optLabel = (o: Opt) => (typeof o === 'string' ? o : o.label);

export function Dropdown({
  value, onChange, options, placeholder, icon, disabled, ac = AC, maxHeight = 280,
}: {
  value: string; onChange: (v: string) => void; options: Opt[]; placeholder?: string;
  icon?: React.ReactNode; disabled?: boolean; ac?: Accent; maxHeight?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => optVal(o) === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button" disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          all: 'unset', boxSizing: 'border-box', cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 52, padding: '0 14px',
          borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset, opacity: disabled ? 0.55 : 1,
          transition: `box-shadow 200ms ${EASE}`,
        }}
      >
        {icon && <span style={{ color: ac.primary, display: 'inline-flex', flexShrink: 0 }}>{icon}</span>}
        <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600, color: selected ? C.ink1 : C.ink3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? optLabel(selected) : (placeholder || 'Seçiniz')}
        </span>
        <ChevronDown size={17} style={{ color: C.ink3, flexShrink: 0, transition: `transform 220ms ${EASE}`, transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 60,
            background: C.surface, borderRadius: C.radiusSm, boxShadow: `${C.clay}, 0 20px 44px -18px rgba(90,72,40,0.5)`,
            padding: 6, maxHeight, overflowY: 'auto', animation: `cyPopIn 180ms ${EASE}`,
          }}
        >
          {options.length === 0 ? (
            <div style={{ padding: '14px 12px', fontSize: 13, fontWeight: 600, color: C.ink3, textAlign: 'center' }}>Seçenek yok</div>
          ) : options.map((o) => {
            const v = optVal(o); const on = v === value;
            return (
              <button
                key={v} type="button"
                onClick={() => { onChange(v); setOpen(false); }}
                style={{
                  all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '11px 12px', borderRadius: 12,
                  background: on ? ac.primary + '16' : 'transparent', color: on ? ac.primary : C.ink1,
                  fontSize: 14, fontWeight: on ? 800 : 600, transition: `background 140ms ${EASE}`,
                }}
                onPointerEnter={(e) => { if (!on) e.currentTarget.style.background = C.surface2; }}
                onPointerLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{optLabel(o)}</span>
                {on && <Check size={16} style={{ flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Clay toggle switch  (matches demo Toggle)
   ──────────────────────────────────────────────────────────────────────────── */
export function Toggle({ on, onChange, ac = AC }: { on: boolean; onChange: (v: boolean) => void; ac?: Accent }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      style={{
        all: 'unset', cursor: 'pointer', flexShrink: 0, width: 48, height: 28, borderRadius: 999, position: 'relative',
        background: on ? `linear-gradient(180deg, ${ac.accent}, ${ac.primary})` : C.surface2,
        boxShadow: on ? `inset 0 1px 2px rgba(120,80,30,0.3), 0 4px 10px -4px ${ac.glow}` : C.clayInset,
        transition: `background 240ms ${EASE}, box-shadow 240ms ${EASE}`,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: on ? 23 : 3, width: 22, height: 22, borderRadius: '50%',
        background: '#fff', boxShadow: '0 2px 5px rgba(90,72,40,0.35)', transition: `left 240ms ${EASE}`,
      }} />
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Upload zone  (matches demo UploadZone — dashed dropzone)
   ──────────────────────────────────────────────────────────────────────────── */
export function UploadZone({
  ac = AC, accept, hint, onPick, onFiles, multiple = true, acceptAttr,
}: {
  ac?: Accent; accept?: string[]; hint?: string; onPick?: () => void;
  onFiles?: (files: FileList) => void; multiple?: boolean; acceptAttr?: string;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const trigger = () => { if (onFiles) inputRef.current?.click(); else onPick?.(); };
  return (
    <div
      role="button" tabIndex={0}
      onClick={trigger}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) { if (onFiles) onFiles(e.dataTransfer.files); else onPick?.(); } }}
      style={{
        cursor: 'pointer', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        padding: '40px 24px', borderRadius: C.radius, textAlign: 'center',
        background: over ? ac.primary + '0F' : C.surface2,
        boxShadow: C.clayInset,
        outline: `2px dashed ${over ? ac.primary : 'rgba(150,128,96,0.35)'}`, outlineOffset: -8,
        transition: `background 200ms ${EASE}, outline-color 200ms ${EASE}`,
      }}
    >
      {onFiles && <input ref={inputRef} type="file" multiple={multiple} accept={acceptAttr} style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ''; }} />}
      <span style={{ width: 56, height: 56, borderRadius: 18, display: 'grid', placeItems: 'center', color: ac.primary, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: C.clayFlat }}>
        <UploadCloud size={26} />
      </span>
      <div style={{ fontSize: 15.5, fontWeight: 800, color: C.ink1 }}>Dosyaları sürükleyip bırakın veya seçmek için tıklayın</div>
      {hint && <div style={{ fontSize: 13, fontWeight: 500, color: C.ink2, maxWidth: 460 }}>{hint}</div>}
      {accept && accept.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>
          {accept.map((a) => (
            <span key={a} style={{ padding: '5px 12px', borderRadius: 999, background: C.surfaceHi, boxShadow: C.clayFlat, fontSize: 11.5, fontWeight: 700, color: C.ink2 }}>{a}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Empty state block  (matches demo EmptyBlock)
   ──────────────────────────────────────────────────────────────────────────── */
export function EmptyBlock({ icon, text, sub }: { icon?: React.ReactNode; text: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '48px 24px', textAlign: 'center' }}>
      {icon && (
        <span style={{ width: 60, height: 60, borderRadius: '28%', display: 'grid', placeItems: 'center', color: C.ink3, background: C.surface2, boxShadow: C.clayInset }}>
          {icon}
        </span>
      )}
      <div style={{ fontSize: 14.5, fontWeight: 700, color: C.ink2 }}>{text}</div>
      {sub && <div style={{ fontSize: 13, fontWeight: 500, color: C.ink3, maxWidth: 360 }}>{sub}</div>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Status badge  (active/passive pill — matches demo StateBadge)
   ──────────────────────────────────────────────────────────────────────────── */
export function StateBadge({ on, onLabel = 'Aktif', offLabel = 'Pasif' }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return (
    <span style={{
      display: 'inline-flex', padding: '5px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700,
      background: on ? 'rgba(111,181,133,0.16)' : C.surface2, color: on ? C.waterDeep : C.ink3,
      boxShadow: on ? 'none' : C.clayInset,
    }}>{on ? onLabel : offLabel}</span>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Clay date field — wraps a native date input with clay styling
   ──────────────────────────────────────────────────────────────────────────── */
export function ClayDateInput({ value, onChange, ac = AC }: { value: string; onChange?: (v: string) => void; ac?: Accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 16px', borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
      <span style={{ color: ac.primary, display: 'inline-flex', flexShrink: 0 }}><Calendar size={17} /></span>
      <input
        type="date" value={value} onChange={(e) => onChange?.(e.target.value)}
        style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', color: C.ink1, fontSize: 14.5, fontWeight: 600, fontFamily: 'inherit' }}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Modal  (matches demo Modal — portal overlay + clay sheet)
   ──────────────────────────────────────────────────────────────────────────── */
export function Modal({
  open, onClose, width = 600, children,
}: { open: boolean; onClose: () => void; width?: number; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onEsc); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!mounted || !open) return null;
  return createPortal(
    <div
      className="cy-scope"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80, display: 'grid', placeItems: 'center', padding: 16,
        background: 'rgba(61,56,47,0.32)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        animation: `cyFadeIn 200ms ${EASE}`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(' + width + 'px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column',
          background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, borderRadius: C.radiusLg,
          boxShadow: `0 44px 90px -30px rgba(90,72,40,0.55), ${C.clay}`, overflow: 'hidden',
          animation: `cyRise 320ms ${EASE}`,
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Modal header row with light icon tile + close button. */
export function ModalHead({
  icon: Icon, title, desc, onClose, ac = AC,
}: { icon?: LucideIcon; title: string; desc?: string; onClose: () => void; ac?: Accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '22px 24px', borderBottom: `1px solid ${C.line}` }}>
      {Icon && (
        <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: ac.primary, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: C.clayFlat }}>
          <Icon size={22} />
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: C.ink1, letterSpacing: '-0.01em' }}>{title}</h2>
        {desc && <p style={{ margin: '4px 0 0', fontSize: 13.5, color: C.ink2, fontWeight: 500, lineHeight: 1.45 }}>{desc}</p>}
      </div>
      <button onClick={onClose} aria-label="Kapat" style={{ all: 'unset', cursor: 'pointer', flexShrink: 0, width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', color: C.ink2, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clay }}>
        <X size={18} />
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Modal action row (clay row used inside picker modals — matches ReportRow)
   ──────────────────────────────────────────────────────────────────────────── */
export function ModalActionRow({
  icon: Icon, title, desc, onClick, ac = AC,
}: { icon: LucideIcon; title: string; desc: string; onClick?: () => void; ac?: Accent }) {
  const [p, setP] = useState(false);
  return (
    <button
      type="button" onClick={onClick}
      onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 14,
        padding: '15px 16px', borderRadius: C.radius, background: C.surfaceHi, boxShadow: p ? C.clayPress : C.clayFlat,
        transition: `transform 200ms ${EASE}, box-shadow 200ms ${EASE}`, transform: p ? 'translateY(1px) scale(0.995)' : 'none',
      }}
    >
      <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: ac.primary, background: C.surface2, boxShadow: C.clayInset }}>
        <Icon size={20} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 800, color: C.ink1 }}>{title}</div>
        <div style={{ fontSize: 13, color: C.ink2, fontWeight: 500, marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
      </div>
      <span style={{ color: C.ink3, flexShrink: 0 }}><ChevronDown size={16} style={{ transform: 'rotate(-90deg)' }} /></span>
    </button>
  );
}
