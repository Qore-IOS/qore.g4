/**
 * @fileoverview Direct Transfer Panel Component
 * @description Enterprise-grade direct transfer panel for inventory transfers between
 * depots and laboratories with barcode scanning, FEFO validation, and batch processing.
 * @module components/direkt-transfer-panel
 * @version 2.0.0
 */

'use client';

import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, Suspense, ChangeEvent } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { Depot, DepoStokItem, ProductCode, Hospital, ConsumptionRecord, ManualProductOption, TransferTemplate } from '@/lib/types';
import type { BarcodeFormat, ParsedGeneric } from '@/lib/barcode';
import { decodeBulkSerialQrPayload } from '@/lib/barcode';

// Type imports from direkt-transfer module
import type { TransferRow, FefoViolation, ScanSource } from '@/lib/direkt-transfer/types';
// Yazma katmanı TEK KAYNAK — masaüstü terminali de bu fonksiyonları çağırır.
import {
  applyTransferItemWrites,
  buildTransferHeader,
  type TransferWriteContext,
} from '@/lib/direkt-transfer/write';

// Logging integration
import { direktTransferLogger } from '@/lib/logger';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  query,
  writeBatch,
  doc,
  Timestamp,
  addDoc,
  setDoc,
  serverTimestamp,
  type Firestore,
  where,
  onSnapshot,
  limit,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useDepotStockLite, touchStockMetadata, useDepots, useProductCodes, useHospitals, useBorcDepots, useInvalidateQueries } from '@/hooks/useFirebaseQueries';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2, Camera, Truck, Plus, CheckCircle2, History, DatabaseZap, ChevronsUpDown, Check, Trash2, AlertTriangle, Package, FileText, ListChecks, ArrowRight, Minus, MoreHorizontal, X, ChevronDown, ChevronUp, Search, QrCode, RefreshCw } from 'lucide-react';
import { TrackingMode, resolveDefaultTrackingMode, resolveEffectiveTrackingMode } from '@/lib/tracking';
import useHidScanner from '@/hooks/useHidScanner';
import { ScanCommitProbe, ScanPerformanceBadge, useScanPerformance } from '@/hooks/useScanPerformance';
import { LedStripGlow } from '@/components/ui/led-strip-glow';
import BarcodeFormatSelect, { type FormatValue } from '@/components/BarcodeFormatSelect';
import { cn, playFeedback, sanitizeGS1, generateId } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, matchesScopedQueryCompany, withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { appendSerialEvents } from '@/lib/serial-ledger/client';
import type { SerialEventInput } from '@/lib/serial-ledger/core';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { compareAsc, parse as parseDate } from 'date-fns';
import { formatMiad } from '@/lib/date';
import BackButton from '@/components/BackButton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { LabSelector } from '@/components/common/LabSelector';
import { autoPrintTutanakFromTransferId, isAutoTutanakEnabled } from '@/lib/tutanak-autoprint';
import { emitFefoOverride } from '@/lib/notifications';
import { VirtualizedList } from '@/components/ui/virtualized-list';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { formatUnitMultiplier, normalizeUnitLabel, formatQuantityWithUnit } from '@/lib/product-unit';
import { getStockItemQuantity, isAvailableDepotStock, sumStockItemQuantities } from '@/lib/stock-quantity';


const CameraScanner = dynamic(() => import('@/components/camera-barcode-scanner'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /><span className="ml-2">Kamera Yükleniyor...</span></div>,
});

const TemplateSelector = dynamic(() => import('@/components/direkt-transfer/TemplateSelector'), {
  ssr: false,
  loading: () => <div className="h-20 animate-pulse bg-muted rounded-md" />
});

const ManualInlineAdder = dynamic(() => import('@/components/direkt-transfer/ManualInlineAdder'), {
  ssr: false,
  loading: () => <div className="h-10 animate-pulse bg-muted rounded-md" />
});

// ── Cream clay design tokens (matches Siparişler panel) ──────────────────────
const C = {
  surface: 'var(--qc-surface)',
  surface2: 'var(--qc-surface2)',
  surfaceHi: 'var(--qc-surface-hi)',
  ink1: 'var(--qc-ink1)',
  ink2: 'var(--qc-ink2)',
  ink3: 'var(--qc-ink3)',
  line: 'rgba(90,72,40,0.07)',
  accent: 'var(--qc-accent)',
  accent2: 'var(--qc-accent2)',
  accentGlow: 'rgba(201,138,87,0.24)',
  // accent'in şeffaf tonları — clay-kit'teki MK_C ile aynı değerler.
  // Bu iki jeton eksikti ama aşağıda kullanılıyordu: `C.accentA08` undefined
  // dönüyor, `background: "undefined"` geçersiz CSS olduğu için tarayıcı
  // atıyordu ve FEFO uyarı kutusu arka plansız/kenarlıksız çiziliyordu.
  accentA08: 'color-mix(in srgb, var(--qc-accent) 8%, transparent)',
  accentA25: 'color-mix(in srgb, var(--qc-accent) 25%, transparent)',
  waterSolid: 'var(--qc-water-solid)',
  waterDeep: 'var(--qc-water-deep)',
  amber: 'var(--qc-amber)',
  amberSoft: 'rgba(224,163,62,0.16)',
  danger: 'var(--qc-danger)',
  radius: 24,
  radiusSm: 16,
  radiusLg: 32,
  radiusPill: 999,
  clay: 'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16)',
  clayPress: 'inset 0 2px 5px rgba(178,160,128,0.32), inset 0 -1px 0 rgba(255,255,255,0.6), 0 2px 6px -4px rgba(150,128,96,0.2)',
  clayInset: 'inset 0 2px 5px rgba(178,160,128,0.30), inset 0 -1px 0 rgba(255,255,255,0.55)',
  clayFlat: 'inset 0 1px 1px rgba(255,255,255,0.85), 0 4px 12px -7px rgba(150,128,96,0.28)',
} as const;

function useWide(bp = 1150) {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth >= bp : true);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${bp}px)`);
    const h = () => setW(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [bp]);
  return w;
}

// ── Cream clay helper components ──────────────────────────────────────────────

const DT_READY_STEPS = [
  { id: 'fmt', label: 'Barkod formatları' },
  { id: 'stock', label: 'Stok verileri' },
  { id: 'lot', label: 'Lot / Miad eşleştirme' },
];

function DTMiniStat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 800, color: tone ?? C.ink1, lineHeight: 1 }}>{value}</span>
    </div>
  );
}

function DTReloadBtn({ onReload }: { onReload: () => void }) {
  return (
    <button onClick={onReload} aria-label="Yeniden yükle" style={{
      all: 'unset', cursor: 'pointer', width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
      display: 'grid', placeItems: 'center', color: C.ink2,
      background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clayFlat,
    }}>
      <RefreshCw size={17} />
    </button>
  );
}

function DTPreparingView({ stage, pct, onReload }: { stage: number; pct: number; onReload: () => void }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'radial-gradient(circle at 32% 28%, #F4CE86 0%, #E0A33E 75%)',
            boxShadow: 'inset 0 3px 5px rgba(255,255,255,0.6), inset 0 -5px 9px rgba(150,100,30,0.35)',
            animation: 'dtAmberPulse 1.8s ease-in-out infinite',
            display: 'grid', placeItems: 'center', color: '#fff',
          }}>
            <div style={{ display: 'inline-flex', animation: 'dtSpin 1.1s linear infinite' }}><RefreshCw size={20} /></div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Sistem Durumu</div>
          <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-0.01em', color: C.amber, marginTop: 2 }}>Sistem Hazırlanıyor…</div>
        </div>
        <DTReloadBtn onReload={onReload} />
      </div>
      <div style={{ margin: '16px 0 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, marginBottom: 7 }}>
          <span style={{ color: C.ink3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Veriler</span>
          <span style={{ color: C.amber }}>%{pct}</span>
        </div>
        <div style={{ height: 8, borderRadius: 99, background: C.surface2, boxShadow: C.clayInset, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: C.amber, transition: 'width 600ms ease' }} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {DT_READY_STEPS.map((s, i) => {
          const done = stage > i;
          const loading = stage === i;
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: C.radiusSm,
              background: done ? 'rgba(111,181,133,0.10)' : loading ? C.amberSoft : C.surface2,
              boxShadow: done || loading ? 'none' : C.clayInset,
              transition: 'background 400ms ease',
            }}>
              <span style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                background: done ? C.waterSolid : loading ? C.amber : C.surfaceHi,
                boxShadow: done || loading ? 'none' : C.clayInset,
                color: done || loading ? '#fff' : C.ink3,
                transition: 'all 400ms ease',
              }}>
                {done ? <Check size={14} />
                  : loading ? <div style={{ display: 'inline-flex', animation: 'dtSpin 1s linear infinite' }}><RefreshCw size={13} /></div>
                  : <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.ink3 }} />}
              </span>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: done ? C.waterDeep : loading ? '#9A6F1E' : C.ink2 }}>{s.label}</span>
              {done && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.waterDeep }}>Hazır</span>}
              {loading && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#9A6F1E' }}>Yükleniyor</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function DTScanStatusView({ lastItem, itemCount, totalAdet, pulse, onReload }: {
  lastItem: { name: string; code: string; qty: number; unit: string } | null;
  itemCount: number; totalAdet: number; pulse: boolean; onReload: () => void;
}) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 46, height: 46, borderRadius: '50%',
            background: 'radial-gradient(circle at 32% 28%, #A6E3BC 0%, #6FB585 75%)',
            boxShadow: 'inset 0 3px 5px rgba(255,255,255,0.6), inset 0 -5px 9px rgba(40,110,70,0.35)',
            display: 'grid', placeItems: 'center', color: '#fff',
          }}>
            <QrCode size={22} />
          </div>
          <span style={{
            position: 'absolute', right: -1, bottom: -1, width: 15, height: 15, borderRadius: '50%',
            background: C.waterSolid, border: `2.5px solid ${C.surface}`,
            animation: 'dtLivePulse 1.8s ease-in-out infinite',
          }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: C.waterDeep, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.waterSolid, flexShrink: 0 }} /> Sistem Hazır
          </div>
          <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-0.01em', color: C.ink1, marginTop: 2 }}>Barkod Okutmaya Hazır</div>
        </div>
        <DTReloadBtn onReload={onReload} />
      </div>
      {lastItem ? (
        <div style={{
          marginTop: 12, padding: 12, borderRadius: C.radiusSm,
          background: 'rgba(111,181,133,0.10)',
          boxShadow: pulse ? 'inset 0 0 0 1.5px rgba(111,181,133,0.55)' : 'inset 0 0 0 1px rgba(111,181,133,0.18)',
          transition: 'box-shadow 500ms ease',
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.waterDeep, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Son Okutulan</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.ink1, marginTop: 4, lineHeight: 1.25 }}>{lastItem.name}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.ink2, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>{lastItem.code}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: C.ink2 }}>Bu üründen okutulan</span>
            <span key={lastItem.qty} style={{
              display: 'inline-flex', alignItems: 'baseline', gap: 4,
              padding: '6px 14px', borderRadius: C.radiusPill,
              background: 'linear-gradient(180deg, #8FD3A6, #6FB585)',
              boxShadow: '0 6px 12px -5px rgba(111,181,133,0.7), inset 0 1px 0 rgba(255,255,255,0.4)',
              color: '#fff', animation: pulse ? 'dtCountPop 480ms ease' : 'none',
            }}>
              <span style={{ fontSize: 21, fontWeight: 800, lineHeight: 1 }}>{lastItem.qty}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.92 }}>{lastItem.unit}</span>
            </span>
          </div>
        </div>
      ) : (
        <div style={{
          marginTop: 12, padding: '14px', borderRadius: C.radiusSm,
          background: C.surface2, boxShadow: C.clayInset,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center',
        }}>
          <span style={{ display: 'inline-flex', color: C.waterDeep, animation: 'dtBob 2.4s ease-in-out infinite' }}><QrCode size={26} /></span>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink1 }}>İlk barkodu okutun</div>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.ink2, lineHeight: 1.5 }}>Okutulan ürün ve adedi burada görünecek.</div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <DTMiniStat label="Kalem" value={itemCount} />
        <DTMiniStat label="Toplam Adet" value={totalAdet} tone={C.waterDeep} />
      </div>
    </>
  );
}

function DTReadinessCard({ stage, ready, pct, lastItem, itemCount, totalAdet, pulse, onReload }: {
  stage: number; ready: boolean; pct: number;
  lastItem: { name: string; code: string; qty: number; unit: string } | null;
  itemCount: number; totalAdet: number; pulse: boolean; onReload: () => void;
}) {
  const readyShadow = `${C.clay}, 0 0 0 1.5px rgba(111,181,133,0.55), 0 0 16px -3px rgba(111,181,133,0.25)`;
  const loadingShadow = `${C.clay}, 0 0 0 1.5px rgba(224,163,62,0.32)`;
  return (
    <div style={{
      padding: 14, borderRadius: C.radius,
      background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
      boxShadow: ready ? readyShadow : loadingShadow,
      animation: ready ? 'dtReadyGlow 2.6s ease-in-out infinite' : undefined,
      transition: 'box-shadow 600ms ease',
    }}>
      {ready
        ? <DTScanStatusView lastItem={lastItem} itemCount={itemCount} totalAdet={totalAdet} pulse={pulse} onReload={onReload} />
        : <DTPreparingView stage={stage} pct={pct} onReload={onReload} />}
    </div>
  );
}

function DTPanel({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div style={{ padding: '11px 14px', borderRadius: C.radius, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, boxShadow: C.clay }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink3, letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{title}</span>
        {badge}
      </div>
      {children}
    </div>
  );
}

function DTFieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 5 }}>{children}</div>
  );
}

function DTAddTile({ icon, label, onClick, disabled, lockReason }: {
  icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean; lockReason?: string;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={disabled ? lockReason : undefined}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer', boxSizing: 'border-box', width: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '11px 6px', borderRadius: C.radiusSm,
        background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`,
        boxShadow: pressed ? C.clayPress : C.clayFlat,
        color: disabled ? C.ink3 : C.ink1, opacity: disabled ? 0.55 : 1,
        transition: 'transform 200ms ease, box-shadow 200ms ease',
        transform: pressed ? 'translateY(1px) scale(0.98)' : 'none',
      }}
    >
      <span style={{ color: disabled ? C.ink3 : C.accent, display: 'inline-flex' }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

function DTStepper({ steps }: { steps: { label: string; done: boolean }[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {steps.map((s, i) => {
        const prevDone = i === 0 || steps[i - 1]?.done;
        const cur = !s.done && prevDone;
        return (
          <React.Fragment key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{
                width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800,
                background: s.done ? 'linear-gradient(180deg, #8FD3A6, #6FB585)' : cur ? `linear-gradient(180deg, ${C.accent2}, ${C.accent})` : C.surface2,
                boxShadow: (s.done || cur) ? '0 5px 11px -4px rgba(150,128,96,0.4)' : C.clayInset,
                color: (s.done || cur) ? '#fff' : C.ink3, transition: 'all 320ms ease',
              }}>
                {s.done ? <Check size={15} /> : i + 1}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: cur ? C.ink1 : C.ink3, whiteSpace: 'nowrap' }}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <span style={{ width: 38, height: 2.5, borderRadius: 2, background: s.done ? C.waterSolid : C.ink3, opacity: s.done ? 1 : 0.3, transition: 'all 320ms ease' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function DTClayProd() {
  return (
    <div style={{
      width: 46, height: 46, borderRadius: '28%', flexShrink: 0,
      background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF 0%, #ECE4D4 82%)',
      boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.9), inset 0 -4px 7px rgba(178,160,128,0.22), 0 6px 12px -6px rgba(150,128,96,0.3)',
      display: 'grid', placeItems: 'center', color: C.accent,
    }}>
      <Package size={22} />
    </div>
  );
}

function DTTransferBtn({ enabled, onClick, loading }: { enabled: boolean; onClick: () => void; loading?: boolean }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={enabled && !loading ? onClick : undefined}
      onPointerDown={() => enabled && !loading && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        all: 'unset', cursor: (enabled && !loading) ? 'pointer' : 'not-allowed',
        display: 'inline-flex', alignItems: 'center', gap: 10, height: 48, padding: '0 24px',
        borderRadius: C.radiusSm,
        background: enabled ? `linear-gradient(180deg, ${C.accent2}, ${C.accent})` : C.surface2,
        boxShadow: enabled ? (pressed ? 'inset 0 3px 7px rgba(120,80,30,0.3)' : `inset 0 1px 0 rgba(255,255,255,0.4), 0 12px 22px -10px ${C.accentGlow}`) : C.clayInset,
        color: enabled ? '#fff' : C.ink3, fontWeight: 800, fontSize: 15,
        transition: 'all 240ms ease', transform: pressed ? 'translateY(1px) scale(0.99)' : 'none',
      }}
    >
      {loading
        ? <div style={{ display: 'inline-flex', animation: 'dtSpin 1s linear infinite' }}><RefreshCw size={19} /></div>
        : <Truck size={19} />}
      Transfer Et
    </button>
  );
}

function DTProductRow({ group, wide, available, meta, onQtyChange, onRemove, onRemoveSerial }: {
  group: { key: string; stokKodu: string; stokAdi: string; lotNumarasi: string; miad: string; adet: number; isGroup: boolean; serials: { id: string; seriNumarasi: string }[] };
  wide: boolean; available: number; meta: any;
  onQtyChange: (key: string, val: string) => void;
  onRemove: () => void;
  onRemoveSerial: (id: string) => void;
}) {
  const isOverStock = group.adet > available && available > 0;
  const noStock = available === 0;
  const multiplier = formatUnitMultiplier(meta);

  const depodaPill = (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: C.radiusPill,
      background: noStock || isOverStock ? 'rgba(192,121,106,0.12)' : C.surface2,
      boxShadow: noStock || isOverStock ? 'none' : C.clayInset,
      fontSize: 14, fontWeight: 700,
      color: noStock || isOverStock ? C.danger : C.ink1,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: noStock || isOverStock ? C.danger : C.waterSolid }} />
      {available > 0 ? available : '?'}
    </span>
  );

  const qtyControl = group.isGroup ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', padding: 6, borderRadius: C.radiusPill, background: C.surface2, boxShadow: C.clayInset }}>
      <button onClick={() => onQtyChange(group.key, String(Math.max(1, group.adet - 1)))} style={{
        all: 'unset', cursor: 'pointer', width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
        background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clayFlat, color: C.ink2,
      }}><Minus size={16} /></button>
      <input
        type="number"
        value={group.adet}
        onChange={e => { const v = parseInt(e.target.value.replace(/\D/g, ''), 10); onQtyChange(group.key, String(isNaN(v) ? 1 : v)); }}
        style={{ width: 34, textAlign: 'center', border: 'none', background: 'transparent', fontSize: 16, fontWeight: 800, color: C.accent, fontFamily: 'inherit', outline: 'none' }}
      />
      <button onClick={() => onQtyChange(group.key, String(group.adet + 1))} style={{
        all: 'unset', cursor: 'pointer', width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
        background: `radial-gradient(120% 120% at 30% 25%, ${C.accent2}, ${C.accent})`,
        boxShadow: `inset 0 1px 1px rgba(255,255,255,0.4), 0 5px 11px -4px ${C.accentGlow}`,
        color: '#fff',
      }}><Plus size={16} /></button>
    </div>
  ) : (
    <span style={{ fontSize: 15, fontWeight: 800, color: C.ink1, display: 'block', textAlign: 'center' }}>
      {formatQuantityWithUnit(group.adet, meta, { showMultiplier: true })}
    </span>
  );

  const deleteBtn = (
    <button onClick={onRemove} aria-label="Sil" style={{
      all: 'unset', cursor: 'pointer', width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center',
      color: C.danger, background: C.surface2, boxShadow: C.clayFlat, justifySelf: 'center',
    }}><Trash2 size={16} /></button>
  );

  const serialChips = group.serials.length > 0 && (
    <div style={{ padding: '8px 16px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {group.serials.slice(0, 50).map(serial => (
        <span key={serial.id} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 8,
          background: C.surface2, border: `1px solid ${C.line}`, fontSize: 10, fontFamily: 'ui-monospace, monospace', color: C.ink2,
        }}>
          <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{serial.seriNumarasi}</span>
          <button onClick={() => onRemoveSerial(serial.id)} style={{ all: 'unset', cursor: 'pointer', color: C.danger, display: 'inline-flex' }}><X size={10} /></button>
        </span>
      ))}
      {group.serials.length > 50 && (
        <span style={{ fontSize: 10, color: C.ink3, padding: '3px 8px' }}>+{group.serials.length - 50} daha...</span>
      )}
    </div>
  );

  if (wide) {
    return (
      <div style={{ animation: 'dtPopIn 280ms ease' }}>
        <div className="dt-prod-row" style={{
          display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) 140px 92px 164px 44px', gap: 14, alignItems: 'center',
          padding: '14px 16px', borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayFlat,
        }}>
          <DTClayProd />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.ink1, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.stokAdi}</div>
            <div style={{ fontSize: 12.5, color: C.ink2, fontFamily: 'ui-monospace, monospace', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {group.stokKodu} · {normalizeUnitLabel(meta?.anaBirim)}{multiplier ? ` (${multiplier})` : ''}
            </div>
          </div>
          <div style={{ fontSize: 13, color: C.ink2, fontWeight: 600, minWidth: 0 }}>
            {group.lotNumarasi && <div style={{ fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.lotNumarasi}</div>}
            {group.miad && <div style={{ fontSize: 12, color: C.ink3, marginTop: 2 }}>{group.miad}</div>}
            {!group.lotNumarasi && !group.miad && <span style={{ color: C.ink3 }}>—</span>}
          </div>
          <div style={{ textAlign: 'center' }}>{depodaPill}</div>
          {qtyControl}
          {deleteBtn}
        </div>
        {isOverStock && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 16px 6px', fontSize: 11, color: C.danger, fontWeight: 700 }}>
            <AlertTriangle size={12} /> Maksimum: {available} adet (Depoda kalan stok)
          </div>
        )}
        {serialChips}
      </div>
    );
  }

  return (
    <div className="dt-prod-row" style={{ padding: '14px 16px', borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayFlat, animation: 'dtPopIn 280ms ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <DTClayProd />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink1, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.stokAdi}</div>
          <div style={{ fontSize: 12.5, color: C.ink2, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>{group.stokKodu}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {group.lotNumarasi && <span style={{ padding: '3px 8px', borderRadius: 999, background: C.surface2, boxShadow: C.clayInset, fontSize: 11, fontWeight: 600, color: C.ink2, fontFamily: 'ui-monospace, monospace' }}>Lot {group.lotNumarasi}</span>}
            {group.miad && <span style={{ padding: '3px 8px', borderRadius: 999, background: C.surface2, boxShadow: C.clayInset, fontSize: 11, fontWeight: 600, color: C.ink2 }}>Miad {group.miad}</span>}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999,
              background: noStock || isOverStock ? 'rgba(192,121,106,0.12)' : C.surface2,
              boxShadow: noStock || isOverStock ? 'none' : C.clayInset,
              fontSize: 11, fontWeight: 700, color: noStock || isOverStock ? C.danger : C.ink1,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: noStock || isOverStock ? C.danger : C.waterSolid }} /> Depoda {available > 0 ? available : '?'}
            </span>
          </div>
        </div>
        {qtyControl}
        {deleteBtn}
      </div>
      {isOverStock && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: C.danger, fontWeight: 700 }}>
          <AlertTriangle size={12} /> Maksimum: {available} (Depoda kalan)
        </div>
      )}
      {serialChips}
    </div>
  );
}

function DTEmptyState({ ready, onScan, onManual }: { ready: boolean; onScan: () => void; onManual: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 60, textAlign: 'center' }}>
      <div style={{
        width: 84, height: 84, borderRadius: '30%', display: 'grid', placeItems: 'center',
        background: C.surface2, boxShadow: C.clayInset,
        color: ready ? C.accent : C.ink3,
        animation: ready ? 'dtBob 2.4s ease-in-out infinite' : 'none',
      }}>
        {ready ? <QrCode size={36} /> : <div style={{ display: 'inline-flex', animation: 'dtSpin 1.2s linear infinite', color: C.amber }}><RefreshCw size={32} /></div>}
      </div>
      <div>
        <div style={{ fontSize: 19, fontWeight: 800, color: C.ink1 }}>{ready ? 'Henüz ürün eklenmedi' : 'Sistem hazırlanıyor…'}</div>
        <div style={{ fontSize: 14.5, color: C.ink2, fontWeight: 500, marginTop: 6, maxWidth: 380, lineHeight: 1.6 }}>
          {ready ? 'Barkod okutun veya sol panelden bir yöntem seçin.' : 'Barkod formatları ve stok verileri yükleniyor. Hazır olunca tarama açılacak.'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={ready ? onScan : undefined} disabled={!ready} style={{
          all: 'unset', cursor: ready ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 9, height: 50, padding: '0 22px',
          borderRadius: C.radiusSm, opacity: ready ? 1 : 0.5,
          background: ready ? `linear-gradient(180deg, ${C.accent2}, ${C.accent})` : C.surface2,
          boxShadow: ready ? `inset 0 1px 0 rgba(255,255,255,0.4), 0 12px 22px -10px ${C.accentGlow}` : C.clayInset,
          color: ready ? '#fff' : C.ink3, fontWeight: 800, fontSize: 14.5,
        }}><Camera size={19} /> Seri Tarama Başlat</button>
        <button onClick={onManual} style={{
          all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, height: 50, padding: '0 22px',
          borderRadius: C.radiusSm, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clay,
          color: C.ink1, fontWeight: 700, fontSize: 14.5,
        }}><span style={{ color: C.accent, display: 'inline-flex' }}><Plus size={19} /></span> Manuel Ekle</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DirektTransferSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 animate-pulse">
      <div className="h-12 w-32 bg-muted rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-48 bg-muted rounded-xl" />
        <div className="h-48 bg-muted rounded-xl" />
      </div>
      <div className="h-24 bg-muted rounded-xl mt-4" />
      <div className="flex-1 bg-muted rounded-xl mt-4" style={{ minHeight: '400px' }} />
    </div>
  );
}


// OPTIMIZED FEFO CHECK:
// Uses batch queries with Firestore 'in' clause (max 30 values) to reduce round trips
const checkFefoOptimized = async (
  itemsToShip: DepoStokItem[],
  depotId: string,
  currentCompanyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<FefoViolation[]> => {
  const violations: FefoViolation[] = [];

  // Transfer listesindeki benzersiz stok kodlarını bul
  const uniqueStokKodlari = Array.from(new Set(itemsToShip.map(i => i.stokKodu)));

  if (uniqueStokKodlari.length === 0) return violations;

  // OPTIMIZED: Batch queries using 'in' clause (max 30 values per query)
  // This reduces N queries to ceil(N/30) queries
  const allProductStock: DepoStokItem[] = [];

  // Process in batches of 30 (Firestore 'in' clause limit)
  const batchSize = 30;
  for (let i = 0; i < uniqueStokKodlari.length; i += batchSize) {
    const batchCodes = uniqueStokKodlari.slice(i, i + batchSize);

    // companyId sorguya DAHİL olmalı — yalnızca istemcide ayıklamak yetmez.
    // Kurallar `list`te companyId filtresi istiyor; filtresiz sorgu
    // permission-denied alır (bu, transfer butonunu sonsuz loading'de bırakan
    // hatanın ta kendisiydi). Ayrıca filtresiz sorgu başka şirketin
    // belgelerini de istemciye indiriyordu.
    const q = scopedQuery(
      'depoStok',
      currentCompanyId,
      isSuperAdmin,
      where('depotId', '==', depotId),
      where('stokKodu', 'in', batchCodes),
    );
    const snap = await getDocs(q);
    snap.docs.forEach(d => {
      const data = d.data();
      if (!matchesScopedQueryCompany(data as any, currentCompanyId, isSuperAdmin)) return;
      if (!isAvailableDepotStock(data)) return;
      allProductStock.push({ id: d.id, ...data } as DepoStokItem);
    });
  }

  // Group stock by stokKodu for efficient lookups
  const stockByCode = new Map<string, DepoStokItem[]>();
  allProductStock.forEach(item => {
    const existing = stockByCode.get(item.stokKodu) || [];
    existing.push(item);
    stockByCode.set(item.stokKodu, existing);
  });

  // Create a Set of item IDs being shipped for O(1) lookup
  const shippingIds = new Set(itemsToShip.map(i => i.id));

  // FEFO check for each item being shipped
  for (const item of itemsToShip) {
    try {
      const itemMiadStr = formatMiad(item.miad, '');
      const itemDate = parseDate(itemMiadStr, 'dd.MM.yyyy', new Date());

      const productStockInDepot = stockByCode.get(item.stokKodu) || [];

      // Depodaki, transfer listesinde OLMAYAN ve miadı daha eski olan ürünleri bul
      const earlierItems = productStockInDepot.filter(s => {
        // Kendisi veya transfer listesindeki başka bir item olmamalı
        if (shippingIds.has(s.id)) return false;

        // Tarih kontrolü
        try {
          const sMiadStr = formatMiad(s.miad, '');
          const stockDate = parseDate(sMiadStr, 'dd.MM.yyyy', new Date());
          // Stoktaki tarih < Transfer edilen tarih ise violation vardır
          return compareAsc(stockDate, itemDate) < 0;
        } catch {
          return false;
        }
      });

      if (earlierItems.length > 0) {
        // En eski tarihli olanı öneri olarak ekle
        earlierItems.sort((a, b) => {
          try {
            return compareAsc(
              parseDate(formatMiad(a.miad, ''), 'dd.MM.yyyy', new Date()),
              parseDate(formatMiad(b.miad, ''), 'dd.MM.yyyy', new Date())
            );
          } catch {
            return 0;
          }
        });

        violations.push({ scannedItem: item, recommendedItem: earlierItems[0] });
      }
    } catch (e) {
      direktTransferLogger.warn('Tarih parslama hatası, FEFO kontrolü atlanıyor', {
        stokKodu: item.stokKodu,
        miad: item.miad,
      });
    }
  }

  return violations;
};


export default function DirektTransferPanel() {
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const router = useRouter();
  const { invalidateDepoStok } = useInvalidateQueries();

  // Optimized fetching with TanStack Query
  const { data: allDepots = [], isLoading: depotsLoading } = useDepots();
  const { data: products = [], isLoading: productsLoading } = useProductCodes();
  const { data: hospitals = [], isLoading: hospitalsLoading } = useHospitals();
  const { data: borcDepots = [], isLoading: borcLoading } = useBorcDepots();

  const depots = useMemo(() => filterOperationalSourceDepots(allDepots, currentUserProfile), [allDepots, currentUserProfile]);
  const prereqsLoading = depotsLoading || productsLoading || hospitalsLoading || borcLoading;

  const { formats: barcodeFormats, loading: formatsLoading, parseAnyBarcode, resolveProductFromParsed, parseAndResolveBarcode } = useBarcodeParser();
  

  
  const productMetaByCode = useMemo(() => {
    const map = new Map<string, ProductCode>();
    products.forEach((p) => {
      if (p.stokKodu) map.set(p.stokKodu, p);
    });
    return map;
  }, [products]);
  
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');

  // Pre-load depot stock for instant barcode lookups (eliminates 200-500ms per scan)
  const { data: depotStockData = [], isPending: depotStockPending } = useDepotStockLite(selectedDepotId);

  // Create lookup maps for O(1) stock queries - DRAMATIC performance improvement
  const depotStockLookups = useMemo(() => {
    const bySerial = new Map<string, DepoStokItem[]>(); // key: stokKodu__serial
    const byLot = new Map<string, DepoStokItem[]>();    // key: stokKodu__lot
    const byCode = new Map<string, DepoStokItem[]>();   // key: stokKodu

    const unshipped = depotStockData.filter(isAvailableDepotStock);

    for (const item of unshipped) {
      const code = item.stokKodu || '';

      // Index by stock code
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code)!.push(item);

      // Index by serial (only if has serial)
      if (item.seriNumarasi) {
        const serialKey = `${code}__${item.seriNumarasi}`;
        if (!bySerial.has(serialKey)) bySerial.set(serialKey, []);
        bySerial.get(serialKey)!.push(item);
      }

      // Index by lot (only for non-serial items)
      if (item.lotNumarasi && (!item.seriNumarasi || item.seriNumarasi.trim() === '')) {
        const lotKey = `${code}__${item.lotNumarasi}`;
        if (!byLot.has(lotKey)) byLot.set(lotKey, []);
        byLot.get(lotKey)!.push(item);
      }
    }

    return { bySerial, byLot, byCode };
  }, [depotStockData]);

  const transferDataProgress = useMemo(() => {
    // Readiness must reflect the actual arrays the scan handler parses against,
    // not just the isLoading flags. After depotStock became fast (Admin SDK),
    // the green light could turn on while productCodes / barcodeFormats were
    // still streaming in via the slower getScopedDocs path — the first scan then
    // hit an empty formats/products array and failed to parse, while a retry a
    // second later (data arrived) succeeded. Gating on length closes that race.
    const sourcesReady = [
      !depotsLoading,
      !productsLoading && products.length > 0,
      !hospitalsLoading,
      !formatsLoading && barcodeFormats.length > 0,
      Boolean(selectedDepotId) && !depotStockPending,
    ];
    return Math.round((sourcesReady.filter(Boolean).length / sourcesReady.length) * 100);
  }, [depotsLoading, productsLoading, products.length, hospitalsLoading, formatsLoading, barcodeFormats.length, selectedDepotId, depotStockPending]);
  const isTransferDataLoading = transferDataProgress < 100;
  const transferDataReady = !isTransferDataLoading;

  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [isBorcMode, setIsBorcMode] = useState<boolean>(false);
  const [selectedBorcDepotId, setSelectedBorcDepotId] = useState<string>('');
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [directTransferItems, setDirectTransferItems] = useState<TransferRow[]>([]);
  const [shipmentLoading, setShipmentLoading] = useState<boolean>(false);
  const [lastTransferCount, setLastTransferCount] = useState<number>(0);

  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [isBatchScanning, setIsBatchScanning] = useState(false);
  const [isBulkScanMode, setIsBulkScanMode] = useState(false);
  const [showManualInline, setShowManualInline] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [templates, setTemplates] = useState<TransferTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const [selectedFormatId, setSelectedFormatId] = useState<FormatValue>('__auto__');
  
  const [fefoViolations, setFefoViolations] = useState<FefoViolation[]>([]);

  // Ölçülebilir uygulama maliyeti: senkron JS ve React'in acil UI commit süresi.
  const { startScanMeasurement, controller: scanPerformanceController } = useScanPerformance();
  const [, startTransition] = useTransition();

  // Last scanned product tracking for UI feedback
  const [lastScannedProduct, setLastScannedProduct] = useState<{
    stokKodu: string;
    stokAdi: string;
    lotNumarasi?: string;
    miad?: string;
    seriNumarasi?: string;
  } | null>(null);

  // Scan feedback: flash green/red on son okutulan area
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const scanFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashScanFeedback = useCallback((type: 'success' | 'error', message: string) => {
    if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current);
    setScanFeedback({ type, message });
    scanFeedbackTimer.current = setTimeout(() => setScanFeedback(null), 2500);
  }, []);

  const selectedLabName = useMemo(() => hospitals.find(l => l.id === selectedLabId)?.name || '', [hospitals, selectedLabId]);

  // Computed counts for last scanned product
  const lotCount = useMemo(() => {
    if (!lastScannedProduct) return 0;
    return directTransferItems
      .filter(item => item.stokKodu === lastScannedProduct.stokKodu && item.lotNumarasi === lastScannedProduct.lotNumarasi)
      .reduce((n, it) => n + getStockItemQuantity(it), 0);
  }, [directTransferItems, lastScannedProduct]);

  const totalCountForProduct = useMemo(() => {
    if (!lastScannedProduct) return 0;
    return directTransferItems
      .filter(item => item.stokKodu === lastScannedProduct.stokKodu)
      .reduce((n, it) => n + getStockItemQuantity(it), 0);
  }, [directTransferItems, lastScannedProduct]);
  
  // Auto-select first depot
  useEffect(() => {
    if (depots.length > 0 && !selectedDepotId) {
      setSelectedDepotId(depots[0].id);
    }
  }, [depots, selectedDepotId]);

  // Fetch templates when template selector is opened
  const fetchTemplates = useCallback(async () => {
    if (templates.length > 0) return; // Already loaded
    setTemplatesLoading(true);
    try {
      const snap = await getDocs(scopedQuery('transferTemplates', currentCompanyId, isSuperAdmin));
      const templateList = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate?.() || null,
        updatedAt: d.data().updatedAt?.toDate?.() || null,
      })) as TransferTemplate[];
      setTemplates(templateList.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    } catch (err) {
      console.error('Error fetching templates:', err);
      toast({ title: 'Hata', description: 'Şablonlar yüklenemedi.', variant: 'destructive' });
    } finally {
      setTemplatesLoading(false);
    }
  }, [templates.length, toast]);

  const { productTracking, productNames } = useMemo(() => {
    const trackingMap: Record<string, TrackingMode> = {};
    const nameMap: Record<string, string> = {};
    products.forEach(p => {
      const stokKodu = p.stokKodu ?? '';
      if (stokKodu) {
          nameMap[stokKodu] = p.stokAdi ?? stokKodu;
          if ((p as any).trackingMode) trackingMap[stokKodu] = (p as any).trackingMode as TrackingMode;
      }
    });
    return { productTracking: trackingMap, productNames: nameMap };
  }, [products]);
  
  const upsertGroupedRow = useCallback((partial: Partial<TransferRow>, inc = 1) => {
    const k = `${partial.stokKodu ?? ''}__${partial.lotNumarasi || ''}`;
    setDirectTransferItems(prev => {
      const i = prev.findIndex(r => r.key === k);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], adet: copy[i].adet + inc };
        return copy;
      }
      const row: TransferRow = {
        key: k,
        stokKodu: partial.stokKodu ?? '',
        stokAdi: partial.stokAdi ?? '',
        lotNumarasi: partial.lotNumarasi || '',
        miad: partial.miad || '',
        seriNumarasi: partial.seriNumarasi || '',
        adet: inc,
        isGroup: true,
      } as TransferRow;
      return [row, ...prev];
    });
  }, []);

  const addDirectTransferItem = useCallback((itemToAdd: DepoStokItem) => {
    setDirectTransferItems(prevItems => {
        if (prevItems.some(item => item.id === itemToAdd.id)) {
            return prevItems;
        }
        return [{...itemToAdd, adet: 1, key: itemToAdd.id, isGroup: false}, ...prevItems];
    });
  }, []);

  const depotName = useMemo(() => depots.find(d => d.id === selectedDepotId)?.name || '', [depots, selectedDepotId]);

  // OPTIMIZED: Synchronous in-memory lookups instead of async Firestore queries
  // This reduces barcode scan time from 1.5-2s to <50ms
  const countStockBySerial = useCallback((stokKodu: string, serial: string): DepoStokItem[] => {
      const key = `${stokKodu}__${serial}`;
      return depotStockLookups.bySerial.get(key) || [];
  }, [depotStockLookups]);

  const countStockByLot = useCallback((stokKodu: string, lot: string): DepoStokItem[] => {
      const key = `${stokKodu}__${lot}`;
      return depotStockLookups.byLot.get(key) || [];
  }, [depotStockLookups]);

  const countStockByCode = useCallback((stokKodu: string): DepoStokItem[] => {
      return depotStockLookups.byCode.get(stokKodu) || [];
  }, [depotStockLookups]);

  // Lot-tracked items are stored as a single document with `adet: N`; serial-tracked
  // items are one-document-per-unit (adet: 1). Available units = sum of adet, not doc count.
  const sumStockAdet = useCallback((items: DepoStokItem[]): number => {
      return sumStockItemQuantities(items);
  }, []);

  const alreadyQueued = useCallback((stokKodu: string, lot?: string, seri?: string) => {
    return directTransferItems
      .filter(r => {
        if (r.stokKodu !== stokKodu) return false;
        if (seri) {
          return r.seriNumarasi === seri;
        }
        // Non-serial items
        if (r.seriNumarasi) return false;
        return lot ? r.lotNumarasi === lot : !r.lotNumarasi;
      })
      .reduce((n, r) => n + getStockItemQuantity(r), 0);
  }, [directTransferItems]);
  
  const handleScan = useCallback(
    async (raw: string, source: 'hid' | 'camera' | 'manual' | 'bulk_item' = 'hid') => {
      if (!raw) return;
      if (!transferDataReady) {
        playFeedback(true);
        flashScanFeedback('error', 'Ürün, barkod ve depo stok verileri henüz hazır değil.');
        return;
      }

      // Toplu QR içindeki alt okutmalar ana okutmanın ölçümünü ezmesin.
      if (source !== 'bulk_item') startScanMeasurement();

      const trimmedRaw = raw.trim();
      if (!trimmedRaw) return;

      const decodedBulk = decodeBulkSerialQrPayload(trimmedRaw);
      if (decodedBulk) {
        for (const serial of decodedBulk) {
          await handleScan(serial, 'bulk_item');
        }
        setIsBulkScanMode(false);
        flashScanFeedback('success', `${decodedBulk.length} barkod transfer listesine işlendi.`);
        return;
      }

      if (isBulkScanMode && source !== 'bulk_item') {
        playFeedback(true);
        flashScanFeedback('error', 'Bu modda sadece toplu barkodlar okunabilir.');
        return;
      }
      
      let resolveResult: ReturnType<typeof parseAndResolveBarcode> = null;
      if (selectedFormatId && selectedFormatId !== '__auto__') {
          const fmt = barcodeFormats.find(f => f.id === selectedFormatId);
          if (fmt) {
            const parsed = parseAnyBarcode(trimmedRaw, [fmt]);
            if (parsed) {
              const resolved = resolveProductFromParsed(parsed, products);
              resolveResult = { parsed: resolved, product: resolved.product };
            }
          }
      }
      if (!resolveResult || !resolveResult.product) {
          resolveResult = parseAndResolveBarcode(trimmedRaw, barcodeFormats, products);
      }

      if (!resolveResult || !resolveResult.parsed) {
        playFeedback(true);
        flashScanFeedback('error', 'Barkod tanımlı formatlarla eşleşmiyor.');
        return;
      }

      const resolved = resolveResult.parsed;
      if (!resolveResult.product || !resolved.stokKodu) {
        playFeedback(true);
        flashScanFeedback('error', 'Barkoddan bir ürün çözümlenemedi.');
        return;
      }
      const product = resolveResult.product;
      const stokKodu = product.stokKodu ?? '';
      const stokAdi = product.stokAdi ?? '';
      const lot = resolved.lotNumarasi || '';
      const miad = resolved.miadFormatted || '';
      const seri = resolved.seriNumarasi || '';

      // Check for duplicate - must match both stokKodu AND seriNumarasi since same serial can exist for different products
      if (seri && directTransferItems.some(item => item.stokKodu === stokKodu && item.seriNumarasi === seri)) {
          playFeedback(true);
          flashScanFeedback('error', 'Bu ürün zaten listeye eklendi.');
          return;
      }

      // Determine tracking mode based on what the barcode contains
      const matchedFormat = resolved.matchedFormatId
        ? barcodeFormats.find(f => f.id === resolved.matchedFormatId)
        : undefined;
      const staticTrackingMode = productTracking[stokKodu] || resolveDefaultTrackingMode(product as any);
      const mode: TrackingMode = (staticTrackingMode === 'qty_manual' || staticTrackingMode === 'qty_barcode')
        ? 'qty_barcode'
        : resolveEffectiveTrackingMode(resolved, matchedFormat, product as any);
      if (mode === 'serial') {
        if (!seri) {
          playFeedback(true);
          flashScanFeedback('error', `${stokAdi}: Seri no takipli üründe barkod seri içermiyor.`);
          return;
        }
        const items = countStockBySerial(stokKodu, seri);
        if (items.length === 0) {
          playFeedback(true);
          flashScanFeedback('error', `Seri No ${seri} bu depoda bulunamadı.`);
          return;
        }
        const serialAvailable = sumStockAdet(items);
        if (alreadyQueued(stokKodu, undefined, seri) >= serialAvailable) {
          playFeedback(true);
          flashScanFeedback('error', `Seri No ${seri} için yeterli stok yok.`);
          return;
        }
        startTransition(() => addDirectTransferItem(items[0]));
        setLastScannedProduct({ stokKodu, stokAdi, lotNumarasi: lot, miad, seriNumarasi: seri });
        flashScanFeedback('success', `${stokAdi} eklendi.`);
        playFeedback();
        return;
      }

      if (mode === 'lot_barcode') {
        if (!lot) {
          playFeedback(true);
          flashScanFeedback('error', `${stokAdi}: Lot barkodu gerekli fakat bulunamadı.`);
          return;
        }
        const items = countStockByLot(stokKodu, lot);
        if (items.length === 0) {
          playFeedback(true);
          flashScanFeedback('error', `${stokKodu} (Lot: ${lot}) bu depoda bulunamadı.`);
          return;
        }
        const lotAvailable = sumStockAdet(items);
        const queued = alreadyQueued(stokKodu, lot);
        if (queued >= lotAvailable) {
          playFeedback(true);
          flashScanFeedback('error', `${stokKodu} (Lot: ${lot}) için en fazla ${lotAvailable} gönderilebilir.`);
          return;
        }
        startTransition(() => upsertGroupedRow(
          { stokKodu, stokAdi, lotNumarasi: lot, miad },
          1
        ));
        setLastScannedProduct({ stokKodu, stokAdi, lotNumarasi: lot, miad });
        flashScanFeedback('success', `${stokAdi} eklendi.`);
        playFeedback();
        return;
      }

      const items = countStockByCode(stokKodu);
      if (items.length === 0) {
        playFeedback(true);
        flashScanFeedback('error', `${stokKodu} bu depoda bulunamadı.`);
        return;
      }
      const codeAvailable = sumStockAdet(items);
      const queued = alreadyQueued(stokKodu);
      if (queued >= codeAvailable) {
        playFeedback(true);
        flashScanFeedback('error', `${stokKodu} için en fazla ${codeAvailable} gönderilebilir.`);
        return;
      }
      startTransition(() => upsertGroupedRow(
        { stokKodu, stokAdi },
        1
      ));
      setLastScannedProduct({ stokKodu, stokAdi });
      flashScanFeedback('success', `${stokAdi} eklendi.`);
      playFeedback();
    },
    [selectedFormatId, barcodeFormats, products, toast, addDirectTransferItem, upsertGroupedRow, countStockBySerial, countStockByLot, countStockByCode, sumStockAdet, alreadyQueued, resolveProductFromParsed, parseAnyBarcode, parseAndResolveBarcode, directTransferItems, isBulkScanMode, flashScanFeedback, transferDataReady, startScanMeasurement]
  );
  
  useHidScanner({
    enabled: transferDataReady,
    onScan: ({ raw }) => {
      if (raw) handleScan(raw.trim(), 'hid');
    },
  });
  
  const handleCameraScan = (raw: string) => {
    if (raw?.trim()) handleScan(raw.trim(), 'camera');
    if (isCameraScannerOpen) setIsCameraScannerOpen(false);
  };

  // OPTIMIZED: Batch allocate all groups at once instead of one query per group
  const batchAllocateForGroups = useCallback(async (groupRows: TransferRow[]): Promise<{ allocations: Map<string, DepoStokItem[]>; error: TransferRow | null }> => {
    const alreadyAllocatedIds = new Set(
      directTransferItems
        .filter(item => !item.isGroup)
        .map(item => item.id)
    );

    // Collect unique stokKodu values from all groups
    const uniqueStokKodlari = Array.from(new Set(groupRows.map(r => r.stokKodu)));

    if (uniqueStokKodlari.length === 0) {
      return { allocations: new Map(), error: null };
    }

    // Batch query all stock codes at once
    const allStock: DepoStokItem[] = [];
    const batchSize = 30;

    for (let i = 0; i < uniqueStokKodlari.length; i += batchSize) {
      const batchCodes = uniqueStokKodlari.slice(i, i + batchSize);
      // companyId sorguya dahil — gerekçe checkFefoOptimized'daki notta.
      const q = scopedQuery(
        'depoStok',
        currentCompanyId,
        isSuperAdmin,
        where('depotId', '==', selectedDepotId),
        where('stokKodu', 'in', batchCodes),
      );
      const snap = await getDocs(q);
      snap.docs.forEach(d => {
        const data = d.data();
        if (!matchesScopedQueryCompany(data as any, currentCompanyId, isSuperAdmin)) return;
        if (!isAvailableDepotStock(data)) return;
        allStock.push({ id: d.id, ...data } as DepoStokItem);
      });
    }

    // Group stock by stokKodu and lotNumarasi for efficient allocation
    const stockByCodeAndLot = new Map<string, DepoStokItem[]>();
    const stockByCode = new Map<string, DepoStokItem[]>();
    allStock.forEach(item => {
      const key = `${item.stokKodu}__${item.lotNumarasi || ''}`;
      const existing = stockByCodeAndLot.get(key) || [];
      existing.push(item);
      stockByCodeAndLot.set(key, existing);

      const codeExisting = stockByCode.get(item.stokKodu) || [];
      codeExisting.push(item);
      stockByCode.set(item.stokKodu, codeExisting);
    });

    // Sort each group by FEFO (earliest expiry first)
    stockByCodeAndLot.forEach((items, key) => {
      items.sort((a, b) => {
        try {
          const ad = parseDate(formatMiad(a.miad, ''), 'dd.MM.yyyy', new Date());
          const bd = parseDate(formatMiad(b.miad, ''), 'dd.MM.yyyy', new Date());
          return compareAsc(ad, bd);
        } catch {
          return 0;
        }
      });
    });
    stockByCode.forEach((items, key) => {
      items.sort((a, b) => {
        try {
          const ad = parseDate(formatMiad(a.miad, ''), 'dd.MM.yyyy', new Date());
          const bd = parseDate(formatMiad(b.miad, ''), 'dd.MM.yyyy', new Date());
          return compareAsc(ad, bd);
        } catch {
          return 0;
        }
      });
    });

    // Allocate for each group
    const allocations = new Map<string, (DepoStokItem & { transferAdet?: number })[]>();
    const usedIds = new Set<string>(alreadyAllocatedIds);

    for (const row of groupRows) {
      const trackingMode = productTracking[row.stokKodu] || resolveDefaultTrackingMode({ stokAdi: row.stokAdi } as any);
      const isQuantityTracked = trackingMode === 'qty_manual' || trackingMode === 'qty_barcode';

      const key = `${row.stokKodu}__${row.lotNumarasi || ''}`;
      const sourcePool = isQuantityTracked && !row.lotNumarasi
        ? (stockByCode.get(row.stokKodu) || [])
        : (stockByCodeAndLot.get(key) || []);
      
      const pool = sourcePool.filter(s => !usedIds.has(s.id));

      const need = Math.max(1, row.adet ?? 1);
      let accumulated = 0;
      const picks: (DepoStokItem & { transferAdet?: number })[] = [];

      for (const docItem of pool) {
        if (accumulated >= need) break;

        const docQty = getStockItemQuantity(docItem);
        const remainingToNeed = need - accumulated;
        const take = Math.min(docQty, remainingToNeed);

        picks.push({ ...docItem, transferAdet: take });
        accumulated += take;
        
        // If we took EVERYTHING from this document, mark it as used
        if (take === docQty) {
          usedIds.add(docItem.id);
        }
        // If we only took PART of it, we don't mark it as fully used 
        // because another pick might take the rest, but for simplicity in memory
        // we'll track it in a more refined way if needed. For now, usedIds works for full takes.
      }

      if (accumulated < need) {
        return { allocations: new Map(), error: row };
      }
      allocations.set(row.key, picks);
    }

    return { allocations, error: null };
  }, [directTransferItems, selectedDepotId, productTracking, currentCompanyId, isSuperAdmin]);

  // Legacy function kept for compatibility
  const allocateDocsForGroup = useCallback(async (row: TransferRow): Promise<DepoStokItem[] | null> => {
    const { allocations, error } = await batchAllocateForGroups([row]);
    if (error) return null;
    return allocations.get(row.key) || null;
  }, [batchAllocateForGroups]);

  const processTransfer = useCallback(async (confirmedViolations: FefoViolation[] = []) => {
    if (!currentUser || !currentUserProfile) return;

    if (!isBorcMode && !selectedLabId) {
      toast({ title: 'Hedef Seçilmedi', description: 'Lütfen transfer için bir hedef laboratuvar seçin.', variant: 'destructive' });
      return;
    }

    setShipmentLoading(true);
    setFefoViolations([]);

    const targetLab = isBorcMode ? null : hospitals.find(l => l.id === selectedLabId);
    const targetName = isBorcMode
      ? (borcDepots.find(d => d.id === selectedBorcDepotId)?.name || 'Borç')
      : (targetLab?.name || '');
    const targetId = isBorcMode ? null : selectedLabId;

    const itemsToShip: DepoStokItem[] = [];
    let allocationError = false;

    // Ağ çağrısı gerektiren ön tahsis işlemini yapalım (bu çok hızlıdır, 0.5s sürer)
    //
    // try/catch şart: `allocateDocsForGroup` Firestore'a sorgu atar ve
    // fırlayabilir. Korumasız bırakılırsa istisna yukarı gider,
    // `setShipmentLoading(false)` hiç çalışmaz ve buton sonsuz loading'de kalır
    // — handleCompleteDirectTransfer'deki aynı hatanın ikizi.
    try {
      for (const row of directTransferItems) {
        const picks = row.isGroup ? await allocateDocsForGroup(row) : [row];
        if (!picks) {
          toast({ title: 'Yetersiz Stok', description: `${row.stokAdi} ${row.lotNumarasi ? `(Lot: ${row.lotNumarasi})` : ''} için depoda yeterli adet (${row.adet}) yok.`, variant: 'destructive' });
          allocationError = true;
          break;
        }
        itemsToShip.push(...(picks as DepoStokItem[]));
      }
    } catch (err) {
      direktTransferLogger.error('Ön tahsis başarısız', err, { depotId: selectedDepotId });
      toast({
        title: 'Transfer başlatılamadı',
        description: err instanceof Error ? err.message : 'Stok okunurken beklenmeyen bir hata oluştu.',
        variant: 'destructive',
      });
      setShipmentLoading(false);
      return;
    }

    if (allocationError) {
      setShipmentLoading(false);
      return;
    }

    // --- OPTIMISTIC UI: Durumu Yedekle ve Ekranı Temizle ---
    const previousDirectTransferItems = [...directTransferItems];
    setDirectTransferItems([]);
    setShipmentLoading(false);

    const totalShippedAdet = itemsToShip.reduce(
      (sum, item: DepoStokItem & { transferAdet?: number }) => sum + (item.transferAdet ?? getStockItemQuantity(item)),
      0
    );

    toast({
      title: 'İşlem Kaydediliyor...',
      description: `${totalShippedAdet} adet ürün arka planda transfer ediliyor. Çıkış yapmayınız.`,
      duration: 3000
    });

    // --- ARKA PLAN İŞLEMİ (Fire and Forget) ---
    (async () => {
      try {
        const transferRef = doc(collection(db, 'transfers'));
        const batch = writeBatch(db);
        const trackingDisabled = !isBorcMode && targetLab?.consumptionTrackingEnabled === false;

        // Seri No Defteri olayları AYRI, parçalı bir yazımda işlenir.
        // Sebebi: bir transfer yüzlerce kalem içerebilir ve tek `writeBatch`
        // Firestore'un 500 işlem sınırına takılır. Stok yazımının atomikliği
        // (mevcut davranış) korunur; defter, stok yazımı başarılı olduktan
        // hemen sonra 150'lik partiler hâlinde yazılır.
        const ledgerEvents: SerialEventInput[] = [];

        const targetHospitalId = isBorcMode ? null : selectedLabId;

        // Kalem başına yazımlar `@/lib/direkt-transfer/write` içinde TEK
        // KAYNAK olarak yaşar; masaüstü terminali (`/terminal/transfer`) de
        // aynı fonksiyonu çağırır, böylece iki uygulama stoğu birebir aynı
        // şekilde günceller.
        const writeCtx: TransferWriteContext = {
          transferRef,
          sourceDepotId: selectedDepotId,
          sourceDepotName: depotName,
          targetHospitalId,
          targetName,
          isBorcMode,
          targetBorcDepotId: selectedBorcDepotId,
          company: isBorcMode ? selectedCompany : null,
          trackingDisabled,
          actorUid: currentUser.uid ?? null,
          actorName: currentUserProfile.name ?? currentUser.email ?? null,
          productMetaByCode,
        };

        itemsToShip.forEach((item: DepoStokItem & { transferAdet?: number }) => {
          const result = applyTransferItemWrites(batch, item, writeCtx, currentCompanyId);
          ledgerEvents.push(...result.ledgerEvents);
        });

        batch.set(
          transferRef,
          withCompanyScope(
            buildTransferHeader(writeCtx, totalShippedAdet, serverTimestamp()),
            currentCompanyId,
          ),
        );

        await batch.commit();

        // Defter yazımı stok yazımından SONRA gelir; burada bir hata olursa
        // stok transferi geri alınmaz (ürünler gerçekten taşındı). Defter
        // türetilmiş bir dizindir ve yönetim panelindeki "Seri No Defteri
        // Doldurma" aracıyla her zaman yeniden kurulabilir.
        try {
          await appendSerialEvents(ledgerEvents, currentCompanyId);
        } catch (ledgerError) {
          direktTransferLogger.error('Seri No Defteri güncellenemedi', ledgerError, {
            transferId: transferRef.id,
            eventCount: ledgerEvents.length,
          });
        }

        await touchStockMetadata();

        toast({ title: 'Transfer Tamamlandı', description: `${totalShippedAdet} adet ürün başarıyla transfer edildi.` });
        setLastTransferCount(totalShippedAdet);
        
        confirmedViolations.forEach(v => {
          emitFefoOverride({
              actor: { uid: currentUserProfile.uid ?? '', name: currentUserProfile.name ?? 'Bilinmeyen' },
              action: 'direct_transfer',
              product: {
                  stokKodu: v.scannedItem.stokKodu,
                  stokAdi: v.scannedItem.stokAdi,
                  lot: v.scannedItem.lotNumarasi,
                  miad: v.scannedItem.miad ?? '',
              },
              shipmentId: transferRef.id,
              depotId: selectedDepotId,
          });
        });

        await autoPrintTutanakFromTransferId(db, transferRef.id, targetLab, currentUserProfile.name ?? currentUser.email ?? '');
        
        if (targetId && selectedDepotId) {
          try {
            const labTransferDocId = `${targetId}_${selectedDepotId}`;
            const labTransferRef = doc(db, 'labTransferDates', labTransferDocId);
            const now = new Date();
            const userName = currentUserProfile?.name || currentUser?.email || '';

            const transfersUpdate: Record<string, any> = {};
            itemsToShip.forEach((item) => {
              if (item.stokKodu) {
                transfersUpdate[item.stokKodu] = {
                  lastTransferDate: Timestamp.fromDate(now),
                  lastTransferBy: userName,
                };
              }
            });

            await setDoc(labTransferRef, {
              labId: targetId,
              depotId: selectedDepotId,
              labName: targetName,
              depotName: depotName,
              transfers: transfersUpdate,
              updatedAt: serverTimestamp(),
            }, { merge: true });

            direktTransferLogger.debug('labTransferDates güncellendi', { docId: labTransferDocId, updates: Object.keys(transfersUpdate) });
          } catch (transferError) {
            direktTransferLogger.error('labTransferDates güncellenemedi', transferError, { labId: targetId, depotId: selectedDepotId });
          }
        }

        direktTransferLogger.info('Transfer başarıyla tamamlandı', { transferId: transferRef.id, itemCount: totalShippedAdet, targetName, mode: isBorcMode ? 'borc' : 'lab' });
      } catch (err) {
        direktTransferLogger.error('Transfer commit hatası', err, { depotId: selectedDepotId, targetId, itemCount: totalShippedAdet });
        
        // --- ROLLBACK ---
        setDirectTransferItems(previousDirectTransferItems);
        toast({ title: 'İşlem İptal Edildi (Rollback)', description: 'Transfer sırasında bir hata oluştu, veriler eski haline getirildi.', variant: 'destructive' });
      }
    })();
  }, [currentUser, currentUserProfile, isBorcMode, selectedLabId, hospitals, borcDepots, selectedBorcDepotId, selectedDepotId, depotName, directTransferItems, allocateDocsForGroup, toast, selectedCompany, invalidateDepoStok, productMetaByCode]);


  const handleCompleteDirectTransfer = async () => {
    if (directTransferItems.length === 0) return;

    setShipmentLoading(true);

    // DİKKAT — bu fonksiyonun gövdesi try/finally İÇİNDE olmak zorunda.
    //
    // Eskiden `setShipmentLoading(false)` yalnızca mutlu yollarda çağrılıyordu.
    // Aradaki `await`lerden biri fırlarsa (ör. bir Firestore sorgusu
    // permission-denied alırsa) istisna yukarı gidiyor, bayrak `true` kalıyor
    // ve "Transfer Et" butonu SONSUZA KADAR loading'de kalıyordu — kullanıcıya
    // ne bir hata ne de bir çıkış yolu görünüyordu.
    try {
      const itemsToShip: DepoStokItem[] = [];

      // OPTIMIZED: Use batch allocation for all groups at once
      const groupRows = directTransferItems.filter(row => row.isGroup);
      const nonGroupRows = directTransferItems.filter(row => !row.isGroup);

      // Add non-group items directly (already allocated)
      itemsToShip.push(...nonGroupRows as DepoStokItem[]);

      // Batch allocate all groups in one query
      if (groupRows.length > 0) {
        const { allocations, error } = await batchAllocateForGroups(groupRows);

        if (error) {
          toast({
            title: 'Yetersiz Stok',
            description: `${error.stokAdi} ${error.lotNumarasi ? `(Lot: ${error.lotNumarasi})` : ''} için yeterli stok bulunmuyor.`,
            variant: 'destructive'
          });
          return;
        }

        // Collect all allocated items
        groupRows.forEach(row => {
          const picks = allocations.get(row.key);
          if (picks) {
            itemsToShip.push(...picks);
          }
        });
      }

      // OPTIMIZED FEFO CHECK: Sadece ilgili ürünler için FEFO kontrolü yap
      const violations = await checkFefoOptimized(itemsToShip, selectedDepotId, currentCompanyId, isSuperAdmin);

      if (violations.length > 0) {
        // Benzersiz violationları filtrele
        const uniqueViolations = violations.filter((v, i, a) =>
          a.findIndex(t => t.scannedItem.id === v.scannedItem.id) === i
        );
        setFefoViolations(uniqueViolations);
      } else {
        processTransfer();
      }
    } catch (err) {
      direktTransferLogger.error('Transfer hazırlığı başarısız', err, {
        depotId: selectedDepotId,
        itemCount: directTransferItems.length,
      });
      toast({
        title: 'Transfer başlatılamadı',
        description: err instanceof Error ? err.message : 'Stok okunurken beklenmeyen bir hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setShipmentLoading(false);
    }
  };

  // Barkodsuz giriş için tüm non-serial ürünleri listele (lot_manual, qty_manual, lot_barcode, qty_barcode)
  const allNonSerialProducts = useMemo(() => {
    const opts: { code: string; name: string; tracking: TrackingMode }[] = [];
    products.forEach(p => {
        const stokKodu = p.stokKodu ?? '';
        if (!stokKodu) return;
        const tracking = productTracking[stokKodu] || resolveDefaultTrackingMode(p as any);
        // Seri takipli ürünleri hariç tut, diğer tüm takip modlarını dahil et
        if (tracking !== 'serial') {
            opts.push({ code: stokKodu, name: productNames[stokKodu] || stokKodu, tracking });
        }
    });
    return opts.sort((a,b) => a.name.localeCompare(b.name));
  }, [products, productTracking, productNames]);
  
  const handleAddAllStock = async () => {
    if (!selectedDepotId) return;
    const q = scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('depotId', '==', selectedDepotId));
    const snap = await getDocs(q);
    // Lot/adet takipli ürünler `adet: N` taşıyan tek bir doküman; seri takipli
    // ürünler doküman başına `adet: 1`. Her ikisinde de dokümandaki gerçek
    // adet kullanılmalı — yoksa lot dokümanları listede 1 birim olarak görünür.
    const items = filterByCompanyScope(
        snap.docs.map(d => {
            const data = d.data() as any;
            const safeAdet = getStockItemQuantity(data);
            return {
                ...data,
                id: d.id,
                adet: safeAdet,
                key: d.id,
                isGroup: false,
            } as TransferRow;
        }),
        currentCompanyId,
        isSuperAdmin,
    ).filter(isAvailableDepotStock);

    setDirectTransferItems(items);
    const totalAdet = sumStockItemQuantities(items);
    flashScanFeedback('success', `${items.length} kalem (${totalAdet} adet) transfer listesine eklendi.`);
  };
  
  // Binlerce satırın gruplanması okutma event'ini bloke etmesin; sayaçlar ve
  // mükerrer kontrolü güncel listeyi, görsel liste ertelenmiş snapshot'ı kullanır.
  const deferredDirectTransferItems = useDeferredValue(directTransferItems);

  const groupedTransferItems = useMemo(() => {
    const groups: Record<string, {
      key: string,
      stokKodu: string;
      stokAdi: string;
      lotNumarasi: string;
      miad: string;
      adet: number;
      isGroup: boolean;
      serials: { id: string; seriNumarasi: string }[]
    }> = {};

    deferredDirectTransferItems.forEach(item => {
      const groupKey = `${item.stokKodu}-${item.lotNumarasi || ''}-${item.miad || ''}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          key: groupKey,
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          lotNumarasi: item.lotNumarasi || '',
          miad: item.miad ?? '',
          adet: 0,
          isGroup: true,
          serials: [],
        };
      }
      groups[groupKey].adet += getStockItemQuantity(item);
      if (!item.isGroup && item.seriNumarasi) {
        groups[groupKey].serials.push({ id: item.id, seriNumarasi: item.seriNumarasi });
      }
    });
    return Object.values(groups).sort((a,b) => a.stokAdi.localeCompare(b.stokAdi));
  }, [deferredDirectTransferItems]);

  const removeTransferItem = (itemId: string, isGroup: boolean | undefined) => {
    if (isGroup) {
      // itemId is a composite group key: stokKodu-lotNumarasi-miad
      // Match against the same composite key logic used in groupedTransferItems
      setDirectTransferItems(prev => prev.filter(item => {
        const compositeKey = `${item.stokKodu}-${item.lotNumarasi || ''}-${item.miad || ''}`;
        return compositeKey !== itemId;
      }));
    } else {
      setDirectTransferItems(prev => prev.filter(item => item.id !== itemId));
    }
  };

  const removeSerialFromGroup = (serialId: string) => {
    setDirectTransferItems(prev => prev.filter(item => item.id !== serialId));
  };

  const handleGroupAdetChange = (groupKey: string, newAdetStr: string) => {
    const newAdet = parseInt(newAdetStr, 10);
    if (isNaN(newAdet) || newAdet < 0) return;

    const makeCompositeKey = (item: TransferRow) => `${item.stokKodu}-${item.lotNumarasi || ''}-${item.miad || ''}`;

    setDirectTransferItems(prev => {
        const groupItems = prev.filter(item => item.isGroup && makeCompositeKey(item) === groupKey);
        if (groupItems.length > 0) {
            const updatedGroup = { ...groupItems[0], adet: newAdet };
            return [updatedGroup, ...prev.filter(item => !(item.isGroup && makeCompositeKey(item) === groupKey))];
        }
        // For non-group items (serial-tracked), we can't change adet individually
        return prev;
    });
  };

  // ── Computed: stepper state ──
  const stepperState = useMemo(() => {
    const hasSource = !!selectedDepotId;
    const hasTarget = isBorcMode ? (!!selectedBorcDepotId && !!selectedCompany) : !!selectedLabId;
    const hasItems = directTransferItems.length > 0;
    const totalAdet = directTransferItems.reduce((sum, item) => sum + getStockItemQuantity(item), 0);
    const totalKalem = groupedTransferItems.length;
    return { hasSource, hasTarget, hasItems, totalAdet, totalKalem };
  }, [selectedDepotId, selectedLabId, isBorcMode, selectedBorcDepotId, selectedCompany, directTransferItems, groupedTransferItems]);

  // ── Computed: availability map for inline warnings ──
  const availabilityMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of groupedTransferItems) {
      const key = group.lotNumarasi ? `${group.stokKodu}__${group.lotNumarasi}` : group.stokKodu;
      const stockItems = group.lotNumarasi
        ? (depotStockLookups.byLot.get(`${group.stokKodu}__${group.lotNumarasi}`) || [])
        : (depotStockLookups.byCode.get(group.stokKodu) || []);
      // Sum the `adet` field — lot-tracked items are stored as a single doc with adet:N,
      // so counting docs would under-report stock (root cause of the "1 adet okutabilirsiniz" bug).
      const available = sumStockItemQuantities(stockItems);
      map.set(key, available);
    }
    return map;
  }, [groupedTransferItems, depotStockLookups]);

  // ── Computed: transfer readiness ──
  const isTransferReady = stepperState.hasSource && stepperState.hasTarget && stepperState.hasItems;

  // ── More menu state ──
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [showAllStockConfirm, setShowAllStockConfirm] = useState(false);

  const wide = useWide();
  const pulseActive = scanFeedback?.type === 'success';

  const readinessStage = useMemo(() => {
    const fmtReady = !formatsLoading && barcodeFormats.length > 0;
    const stockReady = !productsLoading && products.length > 0;
    const lotReady = Boolean(selectedDepotId) && !depotStockPending;
    if (fmtReady && stockReady && lotReady) return 3;
    if (fmtReady && stockReady) return 2;
    if (fmtReady) return 1;
    return 0;
  }, [formatsLoading, barcodeFormats.length, productsLoading, products.length, selectedDepotId, depotStockPending]);

  const readinessPct = Math.round((readinessStage / 3) * 100);

  const lastItemForCard = useMemo(() => {
    if (!lastScannedProduct) return null;
    const meta = productMetaByCode.get(lastScannedProduct.stokKodu);
    return {
      name: lastScannedProduct.stokAdi,
      code: lastScannedProduct.stokKodu,
      qty: totalCountForProduct,
      unit: meta?.anaBirim || 'Adet',
    };
  }, [lastScannedProduct, totalCountForProduct, productMetaByCode]);

  return (
    <>
      <ScanCommitProbe controller={scanPerformanceController} />
      <style>{`
        @keyframes dtAmberPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(224,163,62,0.45), inset 0 3px 5px rgba(255,255,255,0.6), inset 0 -5px 9px rgba(150,100,30,0.35); }
          50% { box-shadow: 0 0 0 10px rgba(224,163,62,0), inset 0 3px 5px rgba(255,255,255,0.6), inset 0 -5px 9px rgba(150,100,30,0.35); }
        }
        @keyframes dtReadyGlow {
          0%,100% { box-shadow: inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16), 0 0 0 1.5px rgba(111,181,133,0.55), 0 0 16px -3px rgba(111,181,133,0.25); }
          50% { box-shadow: inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16), 0 0 0 1.5px rgba(111,181,133,0.9), 0 0 26px 1px rgba(111,181,133,0.5); }
        }
        @keyframes dtTransferGlow {
          0%,100% { box-shadow: inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16), 0 0 0 1.5px rgba(201,138,87,0.32), 0 0 22px -2px rgba(201,138,87,0.18); }
          50% { box-shadow: inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16), 0 0 0 1.5px rgba(201,138,87,0.65), 0 0 32px 2px rgba(201,138,87,0.28); }
        }
        @keyframes dtLivePulse { 0%,100% { box-shadow: 0 0 0 0 rgba(111,181,133,0.55); } 70% { box-shadow: 0 0 0 7px rgba(111,181,133,0); } }
        @keyframes dtCountPop { 0% { transform: scale(0.55); opacity: 0; } 55% { transform: scale(1.18); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes dtBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        @keyframes dtSpin { to { transform: rotate(360deg); } }
        @keyframes dtPopIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes dtRise { from { opacity: 0; transform: translateY(14px) scale(0.97); } to { opacity: 1; transform: none; } }
        .dt-shell { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background: var(--qc-shell-bg); color: var(--qc-ink1); min-height: 100vh; padding: 14px 24px 22px; -webkit-font-smoothing: antialiased; }
        .dt-grid { display: grid; grid-template-columns: 320px minmax(0,1fr); gap: 18px; align-items: start; }
        @media (max-width: 1149px) { .dt-grid { grid-template-columns: 1fr; } }
        .dt-prod-row:hover { transform: translateY(-1px); box-shadow: inset 0 1px 1px rgba(255,255,255,0.9), 0 8px 22px -8px rgba(150,128,96,0.28), 0 2px 6px -2px rgba(150,128,96,0.14); }
        .dt-prod-row { transition: transform 200ms ease, box-shadow 200ms ease; }
        @media (prefers-reduced-motion: reduce) {
          .dt-prod-row:hover { transform: none; }
        }
      `}</style>

      {/* Full-bleed cream backdrop — paneli çevreleyen gri tema zeminini örter */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, background: 'linear-gradient(120deg, var(--qc-glow-1) 0%, transparent 55%), linear-gradient(225deg, var(--qc-glow-2) 0%, transparent 55%), var(--qc-bg0)', zIndex: 0 }} />

      <div className="dt-shell" style={{ maxWidth: 1680, margin: '0 auto', position: 'relative', zIndex: 1 }}>

        {/* ══ TOP BAR ══ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap', animation: 'dtRise 420ms cubic-bezier(0.34,1.56,0.64,1) both' }}>
          <BackButton fallback="/siparisler" />

          {/* Route breadcrumb pill */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: C.radiusPill,
            background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clayFlat,
            fontSize: 13.5, fontWeight: 700,
          }}>
            <span style={{ color: depotName ? C.ink1 : C.ink3 }}>{depotName || 'Depo seçin'}</span>
            {(selectedLabName || (isBorcMode && selectedCompany)) && (
              <>
                <span style={{ color: C.accent, fontSize: 16, lineHeight: 1 }}>→</span>
                <span style={{ color: isBorcMode ? C.waterDeep : C.accent }}>
                  {selectedLabName || `${selectedCompany} (Borç)`}
                </span>
              </>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <DTStepper steps={[
            { label: 'Bağlam', done: stepperState.hasSource && stepperState.hasTarget },
            { label: 'Ürün Ekle', done: stepperState.hasItems },
            { label: 'Transfer', done: false },
          ]} />

          <div style={{ flex: 1 }} />

          {(currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'lojistik_sorumlusu' || currentUserProfile?.role === 'teknik_lojistik') && (
            <button onClick={() => router.push('/direkt-transfer/yedek-parca-transfer')} style={{
              all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
              height: 44, padding: '0 16px', borderRadius: C.radiusSm,
              background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clay,
              color: C.waterDeep, fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap',
            }}>
              <Package size={18} /> Yedek Parça
            </button>
          )}

          <Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
            <PopoverTrigger asChild>
              <button style={{
                all: 'unset', cursor: 'pointer', width: 44, height: 44, borderRadius: '50%',
                display: 'grid', placeItems: 'center', color: C.ink2,
                background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clayFlat,
              }}>
                <MoreHorizontal size={20} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1" align="end">
              <button onClick={() => { router.push(`/transfer-gecmis?depotId=${selectedDepotId}`); setMoreMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)]" disabled={!selectedDepotId}>
                <History className="h-4 w-4 text-[var(--dashboard-muted)]" /> Transfer Geçmişi
              </button>
              <button onClick={() => { router.push('/transfer-sablonlari'); setMoreMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)]">
                <FileText className="h-4 w-4 text-[var(--dashboard-muted)]" /> Transfer Şablonları
              </button>
            </PopoverContent>
          </Popover>
        </div>

        {/* ══ TWO-COLUMN GRID ══ */}
        <div className="dt-grid">

          {/* LEFT RAIL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, animation: 'dtRise 460ms cubic-bezier(0.34,1.56,0.64,1) 60ms both' }}>

            <DTReadinessCard
              stage={readinessStage}
              ready={transferDataReady}
              pct={readinessPct}
              lastItem={lastItemForCard}
              itemCount={stepperState.totalKalem}
              totalAdet={stepperState.totalAdet}
              pulse={pulseActive}
              onReload={() => window.location.reload()}
            />

            {/* Kaynak & Hedef */}
            <DTPanel title="Kaynak & Hedef">
              <DTFieldLabel>Kaynak Depo</DTFieldLabel>
              <div style={{ marginBottom: 8 }}>
                <Select value={selectedDepotId} onValueChange={setSelectedDepotId} disabled={prereqsLoading}>
                  <SelectTrigger className="w-full border-0" style={{ background: C.surface2, boxShadow: C.clayInset, borderRadius: C.radiusSm, height: 44 }}>
                    <SelectValue placeholder="Kaynak depo seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {depots.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {!isBorcMode && (
                <>
                  <DTFieldLabel>Hedef Laboratuvar</DTFieldLabel>
                  <div style={{ marginBottom: 8 }}>
                    <LabSelector
                      label=""
                      labs={hospitals.map(l => ({ id: l.id, name: l.name ?? '', kod: l.kod }))}
                      value={selectedLabId}
                      onChange={setSelectedLabId}
                      placeholder="Laboratuvar seçin"
                      disabled={hospitals.length === 0}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
                <div>
                  <DTFieldLabel>Barkod Formatı</DTFieldLabel>
                  <BarcodeFormatSelect
                    value={selectedFormatId || '__auto__'}
                    onChange={v => setSelectedFormatId(v)}
                    disabled={formatsLoading}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 12px', borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.ink1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Borç Modu</span>
                  <Switch checked={isBorcMode} onCheckedChange={setIsBorcMode} id="borc-mode" />
                </div>
              </div>

              {isBorcMode && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <DTFieldLabel>Borç Depo <span style={{ color: C.danger }}>*</span></DTFieldLabel>
                    <Select value={selectedBorcDepotId} onValueChange={setSelectedBorcDepotId}>
                      <SelectTrigger className="w-full border-0" style={{ background: C.surface2, boxShadow: C.clayInset, borderRadius: C.radiusSm, height: 44 }}>
                        <SelectValue placeholder="Depo seçin" />
                      </SelectTrigger>
                      <SelectContent>{borcDepots.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <DTFieldLabel>Firma <span style={{ color: C.danger }}>*</span></DTFieldLabel>
                    <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                      <SelectTrigger className="w-full border-0" style={{ background: C.surface2, boxShadow: C.clayInset, borderRadius: C.radiusSm, height: 44 }}>
                        <SelectValue placeholder="Firma seçin" />
                      </SelectTrigger>
                      <SelectContent>{borcDepots.find(d => d.id === selectedBorcDepotId)?.companies?.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </DTPanel>

            {/* Ürün Ekle */}
            <DTPanel title="Ürün Ekle" badge={!transferDataReady ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999, background: C.amberSoft, color: '#9A6F1E', fontSize: 11, fontWeight: 700 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber }} /> Hazırlanıyor
              </span>
            ) : undefined}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <DTAddTile icon={<Camera size={19} />} label="Tekli Tara"
                  onClick={() => { setIsBatchScanning(false); setIsCameraScannerOpen(true); }}
                  disabled={!transferDataReady || (!isBorcMode && !selectedLabId) || (isBorcMode && !selectedCompany)}
                  lockReason="Sistem hazırlanıyor" />
                <DTAddTile icon={<Camera size={19} />} label="Seri Tara"
                  onClick={() => { setIsBatchScanning(true); setIsCameraScannerOpen(true); }}
                  disabled={!transferDataReady || (!isBorcMode && !selectedLabId) || (isBorcMode && !selectedCompany)}
                  lockReason="Sistem hazırlanıyor" />
                <DTAddTile icon={<QrCode size={19} />} label="Toplu Oku"
                  onClick={() => { const next = !isBulkScanMode; setIsBulkScanMode(next); flashScanFeedback('success', next ? 'Toplu barkod modu açık' : 'Normal moda dönüldü.'); }}
                  disabled={!transferDataReady || (!isBorcMode && !selectedLabId) || (isBorcMode && !selectedCompany)}
                  lockReason="Sistem hazırlanıyor" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <DTAddTile icon={<Plus size={19} />} label="Manuel" onClick={() => setShowManualInline(v => !v)} disabled={!transferDataReady} />
                <DTAddTile icon={<ListChecks size={19} />} label="Şablon" onClick={() => { setShowTemplateSelector(v => !v); fetchTemplates(); }} disabled={!transferDataReady} />
                <DTAddTile icon={<DatabaseZap size={17} />} label="Tüm Stok" onClick={() => setShowAllStockConfirm(true)} disabled={!selectedDepotId || !transferDataReady} />
              </div>
              {isBulkScanMode && (
                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: C.radiusSm, background: `${C.accentA08}`, border: `1px solid ${C.accentA25}`, fontSize: 12, fontWeight: 600, color: C.accent }}>
                  Toplu barkod modu aktif — QR barkodu okutun.
                </div>
              )}
              {scanFeedback?.type === 'error' && (
                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: C.radiusSm, background: 'rgba(192,121,106,0.10)', border: `1px solid rgba(192,121,106,0.3)`, fontSize: 12, fontWeight: 600, color: C.danger }}>
                  {scanFeedback.message}
                </div>
              )}
            </DTPanel>

            {showManualInline && (
              <div style={{ padding: '14px', borderRadius: C.radius, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, boxShadow: C.clay, position: 'relative' }}>
                <button onClick={() => setShowManualInline(false)} style={{ all: 'unset', cursor: 'pointer', position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 8, background: C.surface2, display: 'grid', placeItems: 'center', color: C.ink3 }}>
                  <X size={14} />
                </button>
                <ManualInlineAdder
                  visible={showManualInline}
                  onClose={() => setShowManualInline(false)}
                  depotName={depotName}
                  stockPool={depotStockData}
                  transferRows={directTransferItems}
                  products={allNonSerialProducts}
                  onAddLot={({ code, name, lot, miad, qty }) => upsertGroupedRow({ stokKodu: code, stokAdi: name, lotNumarasi: lot, miad: miad ?? '' }, qty)}
                  onAddQty={({ code, name, qty }) => upsertGroupedRow({ stokKodu: code, stokAdi: name }, qty)}
                />
              </div>
            )}

            {showTemplateSelector && (
              <div style={{ padding: '14px', borderRadius: C.radius, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, boxShadow: C.clay }}>
                <TemplateSelector
                  visible={showTemplateSelector}
                  onClose={() => setShowTemplateSelector(false)}
                  templates={templates}
                  templatesLoading={templatesLoading}
                  stockPool={depotStockData}
                  transferRows={directTransferItems}
                  onAddLot={({ code, name, lot, miad, qty }) => upsertGroupedRow({ stokKodu: code, stokAdi: name, lotNumarasi: lot, miad: miad ?? '' }, qty)}
                  onAddQty={({ code, name, qty }) => upsertGroupedRow({ stokKodu: code, stokAdi: name }, qty)}
                />
              </div>
            )}
          </div>

          {/* RIGHT: Transfer Listesi */}
          <div style={{
            borderRadius: C.radiusLg, minHeight: 'calc(100vh - 120px)',
            background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
            boxShadow: isTransferReady ? `${C.clay}, 0 0 0 1.5px rgba(201,138,87,0.32)` : C.clay,
            animation: `dtRise 500ms cubic-bezier(0.34,1.56,0.64,1) 120ms both${isTransferReady ? ', dtTransferGlow 3s ease-in-out 1.5s infinite' : ''}`,
            transition: 'box-shadow 600ms ease',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '22px 28px', borderBottom: `1px solid ${C.line}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: C.ink1, whiteSpace: 'nowrap' }}>Transfer Listesi</h1>
                  {stepperState.totalKalem > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 11px', borderRadius: C.radiusPill, background: `linear-gradient(180deg, ${C.accent2}, ${C.accent})`, boxShadow: `0 5px 12px -4px ${C.accentGlow}`, fontSize: 13.5, fontWeight: 800, color: '#fff' }}>
                      {stepperState.totalKalem}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: C.ink2, fontWeight: 600, marginTop: 3 }}>
                  {stepperState.totalAdet > 0 ? `${stepperState.totalAdet} adet ürün transfer edilecek` : 'Ürün listesi boş — taramaya başlayın'}
                </div>
              </div>
              {directTransferItems.length > 0 && (
                <>
                  <button onClick={() => setDirectTransferItems([])} style={{
                    all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 16px',
                    borderRadius: C.radiusSm, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clay,
                    color: C.danger, fontSize: 14, fontWeight: 700,
                  }}>
                    <Trash2 size={16} /> Temizle
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 16px', borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
                    <span key={stepperState.totalAdet} style={{ fontSize: 26, fontWeight: 800, color: C.ink1, lineHeight: 1, animation: 'dtCountPop 380ms ease' }}>{stepperState.totalAdet}</span>
                    <span style={{ fontSize: 10.5, color: C.ink3, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 1 }}>Adet</span>
                  </div>
                </>
              )}
              <DTTransferBtn enabled={isTransferReady && !shipmentLoading} onClick={handleCompleteDirectTransfer} loading={shipmentLoading} />
            </div>

            {/* Body */}
            {directTransferItems.length === 0 ? (
              <DTEmptyState
                ready={transferDataReady}
                onScan={() => { setIsBatchScanning(true); setIsCameraScannerOpen(true); }}
                onManual={() => setShowManualInline(true)}
              />
            ) : (
              <>
                {wide && (
                  <div style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) 140px 92px 164px 44px', gap: 14, padding: '14px 24px', borderBottom: `1px solid ${C.line}` }}>
                    {['', 'Ürün', 'Lot / Miad', 'Depoda', 'Adet', ''].map((h, i) => (
                      <div key={i} style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: (i === 3 || i === 4) ? 'center' : 'left' }}>{h}</div>
                    ))}
                  </div>
                )}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {groupedTransferItems.map(group => {
                    const stockKey = group.lotNumarasi ? `${group.stokKodu}__${group.lotNumarasi}` : group.stokKodu;
                    const available = availabilityMap.get(stockKey) ?? 0;
                    const meta = productMetaByCode.get(group.stokKodu || '');
                    return (
                      <DTProductRow
                        key={group.key}
                        group={group}
                        wide={wide}
                        available={available}
                        meta={meta}
                        onQtyChange={handleGroupAdetChange}
                        onRemove={() => removeTransferItem(group.key, true)}
                        onRemoveSerial={removeSerialFromGroup}
                      />
                    );
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 28px', borderTop: `1px solid ${C.line}` }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: C.radiusPill, background: C.surface2, boxShadow: C.clayInset, fontSize: 13, fontWeight: 700, color: C.ink1 }}>
                    <span style={{ fontSize: 11, color: C.ink3, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Kalem</span>
                    <strong>{stepperState.totalKalem}</strong>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: C.radiusPill, background: C.surface2, boxShadow: C.clayInset, fontSize: 13, fontWeight: 700, color: C.ink1 }}>
                    <span style={{ fontSize: 11, color: C.ink3, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Adet</span>
                    <strong style={{ color: C.accent }}>{stepperState.totalAdet}</strong>
                  </span>
                  {!isBorcMode && !selectedLabId && (
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: C.radiusPill, background: C.amberSoft, fontSize: 13, fontWeight: 700, color: '#9A6F1E' }}>
                      <AlertTriangle size={13} /> Hedef laboratuvar seçin
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ══ MODALS ══ */}

      <Dialog open={isCameraScannerOpen} onOpenChange={setIsCameraScannerOpen}>
        <DialogContent className="max-w-md p-0">
          <DialogHeader className="p-4">
            <DialogTitle>Kamera ile Tara</DialogTitle>
            {isBatchScanning && <DialogDescription>Seri tarama açık. Bitince pencereyi kapatın.</DialogDescription>}
          </DialogHeader>
          {isCameraScannerOpen && (
            <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" /></div>}>
              <CameraScanner onScanSuccess={handleCameraScan} onClose={() => setIsCameraScannerOpen(false)} />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={fefoViolations.length > 0} onOpenChange={(open) => !open && setFefoViolations([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="text-amber-500" /> FEFO Uyarısı</AlertDialogTitle>
            <AlertDialogDescription>Transfer listesinde, depoda daha erken miadlı alternatifi olan ürünler var. Onaylarsanız bu durum kaydedilecektir.</AlertDialogDescription>
          </AlertDialogHeader>
          <ScrollArea className="max-h-60 mt-4 border rounded-md p-2">
            {fefoViolations.map((v, i) => (
              <div key={i} className="text-sm p-3 mb-2 bg-[var(--dashboard-surface-2)] rounded-xl">
                <p className="font-semibold text-[var(--dashboard-text)]">{v.scannedItem.stokAdi}</p>
                <p className="text-[var(--dashboard-muted)] text-xs mt-1">Okutulan: {v.scannedItem.lotNumarasi} (Miad: {v.scannedItem.miad ?? ''})</p>
                <p className="text-green-600 text-xs">Önerilen: {v.recommendedItem.lotNumarasi} (Miad: {v.recommendedItem.miad ?? ''})</p>
              </div>
            ))}
          </ScrollArea>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={() => processTransfer(fefoViolations)}>Yine de Transfer Et</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showAllStockConfirm} onOpenChange={setShowAllStockConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
            <AlertDialogDescription>Bu işlem, &quot;{depotName}&quot; deposundaki sevk edilmemiş tüm ürünleri transfer listesine ekleyecektir.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={() => { handleAddAllStock(); setShowAllStockConfirm(false); }}>Evet, Tümünü Ekle</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
