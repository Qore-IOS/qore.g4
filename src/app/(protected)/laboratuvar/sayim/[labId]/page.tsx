// File: /app/(protected)/laboratuvar/sayim/[labId]/page.tsx
'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection, doc, getDocs, where, Timestamp, writeBatch, getDoc, updateDoc,
} from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { getScopedDocs } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  PackageX,
  UploadCloud,
  FileText,
} from 'lucide-react';
import type { ProductCode, DepoStokItem, ConsumptionRecord, MinMaxRule } from '@/lib/types';
import { getStockItemQuantity } from '@/lib/stock-quantity';
import { saveLabCountSession } from '@/lib/labCount';
import { downloadMaliyetSayimTemplate, parseMaliyetSayimExcel } from '@/lib/labCountExcel';
import { buildCalculationPeriod, savePendingCalculationFiles, type PendingCalculationKind } from '@/lib/qore-hesaplama/pending-calculation-files';
import { formatMiad } from '@/lib/date';
import { differenceInDays, parse, isValid } from 'date-fns';
import useHidScanner from '@/hooks/useHidScanner';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';
import { parseAndResolveBarcode } from '@/lib/barcode';
import {
  AC,
  MLIco,
  MlBar,
  MlBtn,
  MlIconBtn,
  MlModal,
  MlModalHead,
  MlNum,
  MlPill,
  MlRing,
  MlStyles,
  useContainerMode,
  type Accent,
} from '@/components/maliyet/ml-primitives';
import {
  calcProductCost,
  currencySymbol,
  formatCosts,
  normalizeText,
  productTotalTests,
  type CostByCurrency,
} from '@/components/maliyet/ml-logic';

// ============================================================================
// TYPES
// ============================================================================

type FilterMode = 'marka' | 'urunGrubu';

interface LotEntry {
  key: string; // `${stokKodu}|${lot}|${miad}` — identifies one countable line item
  lot: string;
  miad: string;
  existingQty: number; // real unit quantity for this lot (sums each doc's `adet`, not doc count)
  items: { id: string; qty: number }[]; // depoStok docs in this lot with their real quantity
  /** Manual override quantity for this specific lot (string to allow empty input) */
  enteredQty: string;
  /** True once the user confirmed this lot's count (Enter, or the checkmark button) */
  counted: boolean;
  /** The lot targeted by whole-product entry methods (barcode scan, voice, Excel) —
      the nearest-expiry lot, or the synthetic zero-stock placeholder when a product
      has no existing stock. */
  isPrimary: boolean;
}

interface ProductCountEntry {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  urunGrubu: string;
  laboratuvarGrubu: string;
  existingTotal: number;
  lots: LotEntry[]; // one row per existing lot (+ a synthetic empty row when out of stock)
  /** Device/open tests. Informational only; never changes physical stock. Product-level, not per-lot. */
  openTestQty: string;
  /** True once every lot row for this product has been confirmed */
  counted: boolean;
}

interface LotCountState {
  enteredQty: string;
  counted: boolean;
}

interface GroupProgress {
  key: string;
  total: number;
  completed: number;
  status: 'idle' | 'in_progress' | 'completed';
}

// ============================================================================
// HELPERS
// ============================================================================

type MiadSeverity = 'normal' | 'notice' | 'caution' | 'warning' | 'critical' | 'expired';

function getMiadInfo(miadStr: string): { days: number; severity: MiadSeverity } {
  if (!miadStr) return { days: Infinity, severity: 'normal' };
  const miadDate = parse(miadStr, 'dd.MM.yyyy', new Date());
  if (!isValid(miadDate)) return { days: Infinity, severity: 'normal' };
  const days = differenceInDays(miadDate, new Date());
  if (days < 0) return { days, severity: 'expired' };
  if (days <= 3) return { days, severity: 'critical' };
  if (days <= 10) return { days, severity: 'warning' };
  if (days < 45) return { days, severity: 'caution' };
  if (days < 60) return { days, severity: 'notice' };
  return { days, severity: 'normal' };
}

function formatUrunGrubu(g?: string): string {
  if (!g) return '';
  if (g === 'kit') return 'Kit';
  if (g === 'sarf') return 'Sarf';
  if (g === 'yedek_parca') return 'Yedek Parça';
  return g;
}

// ============================================================================
// CLAY SUB-COMPONENTS
// ============================================================================

const formatProductMoney = (amount: number, currency?: string) =>
  amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + currencySymbol(currency);

/** Sum of all lot rows' entered quantity for a product (parsed, blank = 0). */
const productEnteredTotal = (entry: ProductCountEntry): number =>
  entry.lots.reduce((sum, lot) => {
    const n = lot.enteredQty.trim() === '' ? 0 : parseInt(lot.enteredQty, 10);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

const toMetricEntry = (entry: ProductCountEntry) => ({
  stokKodu: entry.stokKodu,
  stokAdi: entry.stokAdi,
  marka: entry.marka,
  stokAdedi: String(productEnteredTotal(entry)),
  cihazUstuAdedi: entry.openTestQty,
  counted: entry.counted,
});

interface LabToolChipProps {
  ico: keyof typeof MLIco;
  label: string;
  onClick?: () => void;
  live?: boolean;
  tone?: 'red';
  compact?: boolean;
  disabled?: boolean;
}

function LabToolChip({ ico, label, onClick, live, tone, compact, disabled }: LabToolChipProps) {
  const Icon = MLIco[ico];
  const liveColor = tone === 'red' ? 'var(--danger)' : 'var(--water-deep)';
  const liveBackground = tone === 'red' ? 'rgba(192,121,106,0.16)' : 'rgba(111,181,133,0.16)';
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        all: 'unset',
        boxSizing: 'border-box',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: compact ? 5 : 7,
        height: compact ? 36 : 38,
        padding: compact ? '0 10px' : '0 13px',
        borderRadius: 'var(--radius-pill)',
        background: live ? liveBackground : 'var(--surface-2)',
        boxShadow: live ? 'none' : 'var(--clay-inset)',
        color: live ? liveColor : 'var(--ink-2)',
        fontSize: compact ? 12 : 12.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.48 : 1,
        flex: '0 0 auto',
      }}
    >
      {live && (
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: tone === 'red' ? 'var(--danger)' : 'var(--water-solid)',
            animation: 'mlLivePulse 1.8s ease-in-out infinite',
          }}
        />
      )}
      <Icon s={compact ? 14 : 15} />
      {label}
    </button>
  );
}

interface ClayGroupRailProps {
  groups: GroupProgress[];
  active: string | null;
  setActive: (key: string) => void;
  labelFor: (key: string) => string;
  filterMode: FilterMode;
  setFilterMode: (mode: FilterMode) => void;
  costFor: (key: string) => string;
  bare?: boolean;
  ac?: Accent;
}

function ClayGroupRail({
  groups,
  active,
  setActive,
  labelFor,
  filterMode,
  setFilterMode,
  costFor,
  bare,
  ac = AC,
}: ClayGroupRailProps) {
  const done = groups.filter(group => group.status === 'completed').length;
  const inner = (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
        {([
          ['marka', 'Marka'],
          ['urunGrubu', 'Grup'],
        ] as const).map(([value, label]) => {
          const selected = filterMode === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setFilterMode(value)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                textAlign: 'center',
                padding: '8px 6px',
                borderRadius: 'var(--radius-pill)',
                color: selected ? '#fff' : 'var(--ink-2)',
                background: selected ? `linear-gradient(180deg, ${ac.accent}, ${ac.primary})` : 'var(--surface-2)',
                boxShadow: selected ? `0 8px 16px -9px ${ac.glow}` : 'var(--clay-inset)',
                fontSize: 11.5,
                fontWeight: 800,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {groups.map(group => {
          const pct = group.total > 0 ? Math.round((group.completed / group.total) * 100) : 0;
          const selected = active === group.key;
          const completed = pct === 100;
          const cost = costFor(group.key);
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => setActive(group.key)}
              style={{
                all: 'unset',
                boxSizing: 'border-box',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '11px 12px',
                borderRadius: 'var(--radius)',
                background: selected ? `linear-gradient(180deg, ${ac.accent}22, ${ac.primary}18)` : 'transparent',
                boxShadow: selected ? `inset 0 0 0 1.5px ${ac.primary}66` : 'none',
                transition: 'all 200ms var(--ease-fluid)',
              }}
            >
              <MlRing pct={pct} size={38} thickness={5} color={completed ? 'var(--water-solid)' : (selected ? ac.primary : undefined)} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: selected ? 'var(--ink-1)' : 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {labelFor(group.key)}
                </span>
                <span style={{ display: 'block', marginTop: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {group.completed}/{group.total} ürün{cost ? ` · ${cost}` : ''}
                </span>
              </span>
              {completed && <span style={{ display: 'inline-flex', color: 'var(--water-deep)' }}><MLIco.check s={17} /></span>}
            </button>
          );
        })}
      </div>
    </>
  );

  if (bare) return <div>{inner}</div>;
  return (
    <aside
      style={{
        alignSelf: 'start',
        position: 'sticky',
        top: 104,
        padding: 12,
        borderRadius: 'var(--radius-lg)',
        background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
        boxShadow: 'var(--clay)',
        maxHeight: 'calc(100vh - 240px)',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 7px 11px' }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ink-3)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
          {filterMode === 'marka' ? 'Markalar' : 'Ürün Grupları'}
        </span>
        <MlPill tone="ok">{done}/{groups.length}</MlPill>
      </div>
      {inner}
    </aside>
  );
}

interface ClayLotCardProps {
  product: ProductCode;
  productEntry: ProductCountEntry;
  lot: LotEntry;
  mobile: boolean;
  index: number;
  completing: boolean;
  focusActive: boolean;
  onEnteredChange: (value: string) => void;
  /** Enter pressed with a non-empty value — triggers the slide-away completion animation */
  onEnterComplete: () => void;
  /** Checkmark button — toggles this lot's counted state instantly (no animation) */
  onToggleCounted: () => void;
  onOpenTestChange: (value: string) => void;
  onConfirmExisting: () => void;
  ac?: Accent;
}

function ClayLotCard({
  product,
  productEntry,
  lot,
  mobile,
  index,
  completing,
  focusActive,
  onEnteredChange,
  onEnterComplete,
  onToggleCounted,
  onOpenTestChange,
  onConfirmExisting,
  ac = AC,
}: ClayLotCardProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const entered = lot.enteredQty.trim() === '' ? null : parseInt(lot.enteredQty, 10);
  const effective = entered != null && Number.isFinite(entered) ? entered : lot.existingQty;
  const delta = effective - lot.existingQty;
  const isOutOfStock = lot.existingQty === 0;
  const miadInfo = getMiadInfo(lot.miad);
  const urgent = miadInfo.severity !== 'normal' && miadInfo.days !== Infinity;
  const packageValue = product.ambalajDegeri || 1;

  const metric = toMetricEntry(productEntry);
  const totalTests = productTotalTests(product, metric);
  const productCost = calcProductCost(product, metric);

  React.useEffect(() => {
    if (focusActive) { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select(); }
  }, [focusActive]);

  return (
    <article
      style={{
        position: 'relative',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        transform: completing ? 'translateX(115%) scale(0.98)' : 'translateX(0) scale(1)',
        opacity: completing ? 0 : 1,
        background: completing
          ? 'linear-gradient(180deg, rgba(111,181,133,0.18), rgba(111,181,133,0.08))'
          : lot.counted
            ? 'linear-gradient(180deg, rgba(111,181,133,0.09), rgba(111,181,133,0.03))'
            : 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
        boxShadow: lot.counted ? 'var(--clay), inset 0 0 0 1.5px rgba(111,181,133,0.35)' : 'var(--clay)',
        transition: 'transform 280ms var(--ease-fluid), opacity 220ms ease, box-shadow 300ms var(--ease-fluid), background 300ms',
        willChange: completing ? 'transform, opacity' : undefined,
        animation: `mlPopIn ${200 + Math.min(index, 10) * 45}ms var(--ease-fluid)`,
      }}
    >
      <div style={{ padding: mobile ? 15 : 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: mobile ? 15 : 16.5, lineHeight: 1.25, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--ink-1)' }}>
              {product.stokAdi}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', fontFamily: 'ui-monospace, monospace' }}>{product.stokKodu}</span>
              <MlPill style={{ padding: '3px 9px', fontSize: 10.5 }}>{lot.lot ? `Lot ${lot.lot}` : 'Lot —'} · {lot.miad || 'Miad —'}</MlPill>
              {urgent && (
                <MlPill style={{ padding: '3px 9px', fontSize: 10.5, color: miadInfo.days < 0 || miadInfo.days <= 3 ? 'var(--danger)' : '#9A6F1E' }}>
                  {miadInfo.days < 0 ? 'Süresi geçmiş' : `${miadInfo.days} gün kaldı`}
                </MlPill>
              )}
              {product.urunGrubu && <MlPill style={{ padding: '3px 9px', fontSize: 10.5 }}>{formatUrunGrubu(product.urunGrubu)}</MlPill>}
              {product.marka && <MlPill tone="accent" style={{ padding: '3px 9px', fontSize: 10.5 }}>{product.marka}</MlPill>}
              <MlPill tone="blue" style={{ padding: '3px 9px', fontSize: 10.5 }}><MLIco.box s={12} /> Kutu ×{packageValue}</MlPill>
              {isOutOfStock && <MlPill style={{ padding: '3px 9px', fontSize: 10.5, color: 'var(--danger)' }}><PackageX size={12} /> Stokta Yok</MlPill>}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleCounted}
            aria-label={lot.counted ? 'Sayım onayını kaldır' : 'Satırı tamamla'}
            title={lot.counted ? 'Onayı kaldır' : 'Satırı tamamla'}
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              color: lot.counted ? '#fff' : 'var(--ink-3)',
              background: lot.counted ? 'radial-gradient(circle at 32% 28%, #8FD3A6, var(--water-solid))' : 'var(--surface-2)',
              boxShadow: lot.counted ? '0 6px 13px -4px rgba(111,181,133,0.6)' : 'var(--clay-inset)',
              border: lot.counted ? 'none' : '2px solid var(--ink-3)',
              boxSizing: 'border-box',
            }}
          >
            <MLIco.check s={19} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : (lot.isPrimary ? '1fr 1fr 1fr' : '1fr 1fr'), gap: 10, marginTop: 13 }}>
          <div style={{ padding: '10px 13px', borderRadius: 'var(--radius)', background: 'var(--surface-hi)', boxShadow: 'var(--clay-inset)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <label htmlFor={`count-${lot.key}`} style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Kutu Adedi</label>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-3)' }}>Stok {lot.existingQty}</span>
            </div>
            <input
              id={`count-${lot.key}`}
              ref={inputRef}
              value={lot.enteredQty}
              onChange={event => onEnteredChange(event.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); e.stopPropagation(); if (lot.enteredQty.trim() !== '') onEnterComplete(); }}
              inputMode="numeric"
              placeholder={String(lot.existingQty)}
              style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', marginTop: 2, fontSize: mobile ? 24 : 27, fontWeight: 800, color: 'var(--ink-1)', fontFamily: 'inherit' }}
            />
            {!isOutOfStock && (
              <button type="button" onClick={onConfirmExisting} style={{ all: 'unset', cursor: 'pointer', fontSize: 10.5, fontWeight: 800, color: 'var(--water-deep)' }}>
                Stoğu onayla
              </button>
            )}
          </div>

          <div style={{ padding: '11px 16px', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: lot.counted ? `linear-gradient(135deg, ${ac.accent}, ${ac.primary})` : 'var(--surface-2)', boxShadow: lot.counted ? `inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 18px -8px ${ac.glow}` : 'var(--clay-inset)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: lot.counted ? 'rgba(255,255,255,0.85)' : 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Fark</div>
              <div style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: lot.counted ? '#fff' : (delta === 0 ? 'var(--ink-1)' : delta > 0 ? 'var(--water-deep)' : 'var(--danger)') }}>
                {entered != null ? (delta > 0 ? `+${delta}` : delta) : '—'}
              </div>
            </div>
          </div>

          {lot.isPrimary && (
            <div style={{ padding: '10px 13px', borderRadius: 'var(--radius)', background: 'var(--surface-hi)', boxShadow: 'var(--clay-inset)' }}>
              <label htmlFor={`open-${product.stokKodu}`} style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Açık / Ek Test</label>
              <input
                id={`open-${product.stokKodu}`}
                value={productEntry.openTestQty}
                onChange={event => onOpenTestChange(event.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                placeholder="0"
                style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', marginTop: 2, fontSize: mobile ? 24 : 27, fontWeight: 800, color: 'var(--ink-2)', fontFamily: 'inherit' }}
              />
              <div style={{ minHeight: 24, display: 'flex', alignItems: 'center', fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)' }}>Stok mutasyonuna dahil edilmez</div>
            </div>
          )}
        </div>

        {lot.isPrimary && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, padding: '2px 4px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>
              Toplam Test <strong style={{ color: 'var(--ink-1)', fontSize: 13 }}>{totalTests}</strong>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>
              Maliyet <strong style={{ color: 'var(--accent)', fontSize: 13 }}>{formatProductMoney(productCost.amount, productCost.currency)}</strong>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function LaboratuvarSayimPage() {
  const params = useParams();
  const labId = Array.isArray(params?.labId) ? params.labId[0] : (params?.labId as string);
  const router = useRouter();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const mode = useContainerMode(rootRef as React.RefObject<HTMLElement>);
  const mobile = mode === 'mobile';
  const tablet = mode === 'tablet';

  const [labName, setLabName] = useState<string>('');
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [rawStock, setRawStock] = useState<DepoStokItem[]>([]);
  const [minMaxRules, setMinMaxRules] = useState<MinMaxRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [filterMode, setFilterMode] = useState<FilterMode>('marka');
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyUncounted, setShowOnlyUncounted] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Barcode scanning
  const [scannerActive, setScannerActive] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const scanFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<any>(null);
  const { formats: barcodeFormats } = useSafeBarcodeFormats();

  // Per-lot count state (key: `${stokKodu}|${lot}|${miad}`) — each lot is counted independently.
  const [lotCountData, setLotCountData] = useState<Record<string, LotCountState>>({});
  // Açık/Ek Test is a product-level concept (device tests, not tied to a specific lot).
  const [openTestData, setOpenTestData] = useState<Record<string, string>>({});
  const [completingLots, setCompletingLots] = useState<Set<string>>(() => new Set());
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [countMonth, setCountMonth] = useState(new Date().getMonth());
  const [countYear, setCountYear] = useState(new Date().getFullYear());
  const [uploadFlow, setUploadFlow] = useState<{ sessionId: string; step: PendingCalculationKind } | null>(null);
  const [modalFiles, setModalFiles] = useState<File[]>([]);
  const [isUploadingCalcFile, setIsUploadingCalcFile] = useState(false);

  // Excel-based count entry
  const [isExcelBusy, setIsExcelBusy] = useState(false);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * Bu lab-dönem için daha önce girilmiş sayımın özeti.
   *
   * Sayılan adetler kutulara YAZILMAZ — beklenen rakamı önceden göstermek
   * sayımı yönlendirir ve bayat bir değeri sessizce doğrulatır. Burada yalnızca
   * "bu dönem için zaten kayıt var, şu panelden girilmiş" bilgisi verilir;
   * kullanıcı bilerek yeniden saymayı seçebilsin diye.
   */
  const [mevcutSayimOzeti, setMevcutSayimOzeti] = useState<{
    urunSayisi: number;
    kaynaklar: string[];
    sonGuncelleme: number;
  } | null>(null);

  const countPeriod = useMemo(() => buildCalculationPeriod(countMonth, countYear), [countMonth, countYear]);
  const countMonthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
    value: i,
    label: new Date(0, i, 1).toLocaleString('tr-TR', { month: 'long' }),
  })), []);
  const countYearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 7 }, (_, i) => y - 3 + i);
  }, []);

  useEffect(() => {
    if (!labId) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ getLabPeriodSnapshots }, { alanOzeti }, { KAYNAK_ADI }] = await Promise.all([
          import('@/actions/labPeriodActions'),
          import('@/lib/lab-period/merge'),
          import('@/lib/lab-period/types'),
        ]);
        const snapshotlar = await getLabPeriodSnapshots(
          [labId],
          countYear,
          countMonth + 1, // countMonth 0-indekslidir
          currentCompanyId,
          isSuperAdmin,
        );
        if (cancelled) return;
        const ozet = alanOzeti(snapshotlar[labId], 'stok');
        setMevcutSayimOzeti(
          ozet.urunSayisi > 0
            ? {
                urunSayisi: ozet.urunSayisi,
                kaynaklar: ozet.kaynaklar.map(k => KAYNAK_ADI[k] ?? k),
                sonGuncelleme: ozet.sonGuncelleme,
              }
            : null,
        );
      } catch (err) {
        // Uyarı gösterilemezse sayım normal akışında devam eder.
        console.error('[lab-sayim] Dönem kaydı okunamadı:', err);
        if (!cancelled) setMevcutSayimOzeti(null);
      }
    })();
    return () => { cancelled = true; };
  }, [labId, countYear, countMonth, currentCompanyId, isSuperAdmin]);

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!labId) return;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const labRef = doc(db, 'hospitals', labId as string);
        // Legacy-aware: getScopedDocs companyId'si eksik ya da __legacy__
        // etiketli ürün ve depoStok kayıtlarını da getirir. scopedQuery'nin
        // server-side where('companyId', '==', X) filtresi eski kayıtları
        // dışarıda bırakıyor ve sayım sayfası boş yükleniyordu.
        const [labSnap, productDocs, rulesSnap] = await Promise.all([
          getDoc(labRef),
          getScopedDocs('productCodes', currentCompanyId, isSuperAdmin),
          getDocs(collection(db, 'hospitals', labId as string, 'minMaxRules')),
        ]);

        if (!labSnap.exists()) {
          if (!cancelled) toast({ title: 'Hata', description: 'Laboratuvar bulunamadı.', variant: 'destructive' });
          return;
        }

        const { name } = labSnap.data() as any;
        if (!cancelled) {
          setLabName(name);
          setProductCodes(productDocs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
          setMinMaxRules(rulesSnap.docs.map(d => d.data() as MinMaxRule));
        }

        // Load lab stock — match by hedefKurumId, plus legacy by name
        const [byIdDocs, legacyDocs] = await Promise.all([
          getScopedDocs('depoStok', currentCompanyId, isSuperAdmin, where('isShipped', '==', true), where('hedefKurumId', '==', labId)),
          getScopedDocs('depoStok', currentCompanyId, isSuperAdmin, where('isShipped', '==', true), where('hedefKurum', '==', name)),
        ]);

        const byId = byIdDocs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
        const legacy = legacyDocs
          .map(d => ({ id: d.id, ...d.data() } as DepoStokItem))
          .filter(item => !item.hedefKurumId);
        const all = filterByCompanyScope([...byId, ...legacy], currentCompanyId, isSuperAdmin);

        if (!cancelled) setRawStock(all);
      } catch (err) {
        console.error('Error loading lab counting data:', err);
        if (!cancelled) toast({ title: 'Veri Hatası', description: 'Sayım verileri yüklenemedi.', variant: 'destructive' });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [labId, currentCompanyId, isSuperAdmin, toast]);

  // ------------------------------------------------------------------
  // Derived data
  // ------------------------------------------------------------------

  // All stokKodu values that are part of the count scope (have min/max rules OR have stock)
  const scopeStokKodus = useMemo(() => {
    const set = new Set<string>();
    minMaxRules.forEach(r => set.add(r.stokKodu));
    rawStock.forEach(s => set.add(s.stokKodu));
    return set;
  }, [minMaxRules, rawStock]);

  // Product list within the scope (only known products)
  const scopeProducts = useMemo(() => {
    return productCodes.filter(p => scopeStokKodus.has(p.stokKodu));
  }, [productCodes, scopeStokKodus]);

  const lotEntryKey = (stokKodu: string, lot: string, miad: string) => `${stokKodu}|${lot}|${miad}`;

  // Build per-product entries, each holding one LotEntry (line item) per existing lot.
  const productEntries = useMemo<Record<string, ProductCountEntry>>(() => {
    const map: Record<string, ProductCountEntry> = {};

    // Initialize entries for all in-scope products
    scopeProducts.forEach(p => {
      map[p.stokKodu] = {
        stokKodu: p.stokKodu,
        stokAdi: p.stokAdi,
        marka: p.marka || '',
        urunGrubu: formatUrunGrubu(p.urunGrubu),
        laboratuvarGrubu: p.laboratuvarGrubu || '',
        existingTotal: 0,
        lots: [],
        openTestQty: openTestData[p.stokKodu] ?? '',
        counted: false,
      };
    });

    // Group raw stock by stokKodu / lot / miad — one LotEntry (line item) per group
    const lotMap = new Map<string, LotEntry>();
    rawStock.forEach(item => {
      if (!map[item.stokKodu]) {
        // Stock for an unknown product (no productCode + no min/max rule).
        // Add a synthetic entry so it still shows up.
        map[item.stokKodu] = {
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi || item.stokKodu,
          marka: (item as any).marka || '',
          urunGrubu: '',
          laboratuvarGrubu: '',
          existingTotal: 0,
          lots: [],
          openTestQty: openTestData[item.stokKodu] ?? '',
          counted: false,
        };
      }
      const lotKey = lotEntryKey(item.stokKodu, item.lotNumarasi || '', formatMiad(item.miad as any) || '');
      let lotEntry = lotMap.get(lotKey);
      if (!lotEntry) {
        lotEntry = {
          key: lotKey,
          lot: item.lotNumarasi || '',
          miad: formatMiad(item.miad as any) || '',
          existingQty: 0,
          items: [],
          enteredQty: lotCountData[lotKey]?.enteredQty ?? '',
          counted: lotCountData[lotKey]?.counted ?? false,
          isPrimary: false,
        };
        lotMap.set(lotKey, lotEntry);
        map[item.stokKodu].lots.push(lotEntry);
      }
      // A depoStok doc can represent more than one physical unit — order picking
      // (siparişler → toplama) commonly ships a whole lot/qty pick as a single
      // doc with `adet: N` instead of N per-unit docs, so counting docs here
      // would under-report real stock and later delete/create the wrong amount.
      const qty = getStockItemQuantity(item);
      lotEntry.existingQty += qty;
      if (item.id) lotEntry.items.push({ id: item.id, qty });
      map[item.stokKodu].existingTotal += qty;
    });

    // Sort lots within each product (closest miad first), mark the first as
    // primary (the row barcode/voice/Excel entry targets), and add a synthetic
    // zero-stock row for products with no existing lots at all.
    Object.values(map).forEach(entry => {
      entry.lots.sort((a, b) => {
        const ai = getMiadInfo(a.miad).days;
        const bi = getMiadInfo(b.miad).days;
        return ai - bi;
      });
      if (entry.lots.length === 0) {
        const key = lotEntryKey(entry.stokKodu, '', '');
        entry.lots.push({
          key,
          lot: '',
          miad: '',
          existingQty: 0,
          items: [],
          enteredQty: lotCountData[key]?.enteredQty ?? '',
          counted: lotCountData[key]?.counted ?? false,
          isPrimary: true,
        });
      } else {
        entry.lots[0].isPrimary = true;
      }
      entry.counted = entry.lots.every(l => l.counted);
    });

    return map;
  }, [scopeProducts, rawStock, lotCountData, openTestData]);

  // Available filter values (markas or product groups)
  const filterValues = useMemo<string[]>(() => {
    const set = new Set<string>();
    scopeProducts.forEach(p => {
      if (filterMode === 'marka') {
        if (p.marka) set.add(p.marka);
      } else {
        if (p.urunGrubu) set.add(p.urunGrubu);
      }
    });
    const list = Array.from(set);
    list.sort((a, b) => a.localeCompare(b, 'tr'));
    return list;
  }, [scopeProducts, filterMode]);

  // Build a label for a filter key (turn 'kit' -> 'Kit' etc.)
  const filterLabel = useCallback(
    (key: string) => (filterMode === 'urunGrubu' ? formatUrunGrubu(key) : key),
    [filterMode],
  );

  // Group progress per filter value
  const groupProgress = useMemo<GroupProgress[]>(() => {
    return filterValues.map(key => {
      const products = scopeProducts.filter(p =>
        filterMode === 'marka' ? p.marka === key : p.urunGrubu === key,
      );
      const completed = products.filter(p => productEntries[p.stokKodu]?.counted).length;
      let status: GroupProgress['status'] = 'idle';
      if (completed > 0 && completed < products.length) status = 'in_progress';
      if (completed === products.length && products.length > 0) status = 'completed';
      return { key, total: products.length, completed, status };
    });
  }, [filterValues, scopeProducts, productEntries, filterMode]);

  // Auto-select first group on load / filter change
  useEffect(() => {
    if (!activeGroup && filterValues.length > 0) {
      setActiveGroup(filterValues[0]);
    } else if (activeGroup && !filterValues.includes(activeGroup)) {
      setActiveGroup(filterValues[0] ?? null);
    }
  }, [filterValues, activeGroup]);

  // Reset active group when filter mode changes
  useEffect(() => {
    setActiveGroup(filterValues[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMode]);

  // Products in the active group, with stockless ones at the bottom
  const activeProducts = useMemo<ProductCode[]>(() => {
    if (!activeGroup) return [];
    const list = scopeProducts.filter(p =>
      filterMode === 'marka' ? p.marka === activeGroup : p.urunGrubu === activeGroup,
    );

    let filtered = list;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = list.filter(p =>
        p.stokAdi.toLowerCase().includes(q) ||
        p.stokKodu.toLowerCase().includes(q),
      );
    }
    if (showOnlyUncounted) {
      filtered = filtered.filter(p => !productEntries[p.stokKodu]?.counted);
    }

    return filtered.sort((a, b) => {
      const aOos = (productEntries[a.stokKodu]?.existingTotal ?? 0) === 0;
      const bOos = (productEntries[b.stokKodu]?.existingTotal ?? 0) === 0;
      if (aOos !== bOos) return aOos ? 1 : -1; // out-of-stock at the bottom
      const aDone = productEntries[a.stokKodu]?.counted ? 1 : 0;
      const bDone = productEntries[b.stokKodu]?.counted ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone; // uncounted first
      return a.stokAdi.localeCompare(b.stokAdi, 'tr');
    });
  }, [activeGroup, scopeProducts, filterMode, searchQuery, showOnlyUncounted, productEntries]);

  // Flatten active products into individual lot rows — each lot is its own line item.
  const activeLotRows = useMemo<{ product: ProductCode; entry: ProductCountEntry; lot: LotEntry }[]>(() => {
    const rows: { product: ProductCode; entry: ProductCountEntry; lot: LotEntry }[] = [];
    activeProducts.forEach(product => {
      const entry = productEntries[product.stokKodu];
      if (!entry) return;
      entry.lots.forEach(lot => {
        if (showOnlyUncounted && lot.counted) return;
        rows.push({ product, entry, lot });
      });
    });
    return rows;
  }, [activeProducts, productEntries, showOnlyUncounted]);

  // Overall progress
  const { totalProducts, totalCounted, overallPct } = useMemo(() => {
    const total = scopeProducts.length;
    const done = scopeProducts.filter(p => productEntries[p.stokKodu]?.counted).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { totalProducts: total, totalCounted: done, overallPct: pct };
  }, [scopeProducts, productEntries]);

  const grandMetrics = useMemo(() => {
    const costs: CostByCurrency = { TRY: 0, EUR: 0, USD: 0 };
    let tests = 0;
    scopeProducts.forEach(product => {
      const entry = productEntries[product.stokKodu];
      if (!entry) return;
      const metric = toMetricEntry(entry);
      tests += productTotalTests(product, metric);
      const result = calcProductCost(product, metric);
      const currency = result.currency === 'EUR' || result.currency === 'USD' ? result.currency : 'TRY';
      costs[currency] += result.amount;
    });
    return { tests, costs, costLabel: formatCosts(costs) || '0₺' };
  }, [scopeProducts, productEntries]);

  const groupCostLabel = useCallback((key: string) => {
    const costs: CostByCurrency = { TRY: 0, EUR: 0, USD: 0 };
    scopeProducts
      .filter(product => filterMode === 'marka' ? product.marka === key : product.urunGrubu === key)
      .forEach(product => {
        const entry = productEntries[product.stokKodu];
        if (!entry) return;
        const result = calcProductCost(product, toMetricEntry(entry));
        const currency = result.currency === 'EUR' || result.currency === 'USD' ? result.currency : 'TRY';
        costs[currency] += result.amount;
      });
    return formatCosts(costs);
  }, [filterMode, scopeProducts, productEntries]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------
  const setLotEntry = useCallback((lotKey: string, patch: Partial<LotCountState>) => {
    setLotCountData(prev => {
      const cur = prev[lotKey] ?? { enteredQty: '', counted: false };
      return { ...prev, [lotKey]: { ...cur, ...patch } };
    });
  }, []);

  const handleLotEnteredChange = useCallback((lotKey: string, val: string) => {
    setLotEntry(lotKey, { enteredQty: val });
  }, [setLotEntry]);

  const handleOpenTestChange = useCallback((stokKodu: string, val: string) => {
    setOpenTestData(prev => ({ ...prev, [stokKodu]: val }));
  }, []);

  /** Enter pressed on a lot's Sayılan input (non-empty value) — slides the row away,
      then confirms it. Mirrors depo sayım / maliyet sayım: typing alone never
      completes a row, only Enter (or the checkmark button) does. */
  const handleLotEnterComplete = useCallback((lotKey: string, nextKey?: string) => {
    setCompletingLots(prev => new Set(prev).add(lotKey));
    window.setTimeout(() => {
      setLotCountData(prev => {
        const cur = prev[lotKey] ?? { enteredQty: '', counted: false };
        return { ...prev, [lotKey]: { ...cur, counted: true } };
      });
      setCompletingLots(prev => { const n = new Set(prev); n.delete(lotKey); return n; });
      if (nextKey) setFocusTarget(nextKey);
    }, 280);
  }, []);

  const handleConfirmExisting = useCallback((lotKey: string, existingQty: number) => {
    setLotEntry(lotKey, { enteredQty: String(existingQty), counted: true });
  }, [setLotEntry]);

  const handleToggleCounted = useCallback((lotKey: string, existingQty: number) => {
    setLotCountData(prev => {
      const cur = prev[lotKey] ?? { enteredQty: '', counted: false };
      const nextCounted = !cur.counted;
      // If user is confirming an out-of-stock lot, default the entered qty to 0
      const nextEntered = nextCounted && cur.enteredQty.trim() === '' ? String(existingQty) : cur.enteredQty;
      return { ...prev, [lotKey]: { enteredQty: nextEntered, counted: nextCounted } };
    });
  }, []);

  const handleCompleteGroup = useCallback(() => {
    if (!activeGroup) return;
    setLotCountData(prev => {
      const next = { ...prev };
      activeProducts.forEach(p => {
        productEntries[p.stokKodu]?.lots.forEach(lot => {
          const cur = next[lot.key] ?? { enteredQty: '', counted: false };
          next[lot.key] = {
            enteredQty: cur.enteredQty.trim() === '' ? String(lot.existingQty) : cur.enteredQty,
            counted: true,
          };
        });
      });
      return next;
    });
  }, [activeGroup, activeProducts, productEntries]);

  const handleNextGroup = useCallback(() => {
    const next = groupProgress.find(g => g.status !== 'completed' && g.key !== activeGroup);
    if (next) setActiveGroup(next.key);
  }, [groupProgress, activeGroup]);

  // ------------------------------------------------------------------
  // Excel-based count entry (template download + upload)
  // ------------------------------------------------------------------
  const handleDownloadExcelTemplate = useCallback(async () => {
    const entries: ProductCountEntry[] = Object.values(productEntries);
    if (entries.length === 0) {
      toast({ title: 'Ürün yok', description: 'Bu laboratuvarda sayıma dahil ürün bulunmuyor.' });
      return;
    }
    setIsExcelBusy(true);
    try {
      const rows = entries
        .map(e => ({
          marka: e.marka || '',
          stokKodu: e.stokKodu,
          stokAdi: e.stokAdi,
          mevcutStok: e.existingTotal,
        }))
        .sort((a, b) => {
          const byMarka = (a.marka || '').localeCompare(b.marka || '', 'tr');
          if (byMarka !== 0) return byMarka;
          return a.stokAdi.localeCompare(b.stokAdi, 'tr');
        });
      const safeName = (labName || 'Laboratuvar').replace(/[^\p{L}\p{N}]+/gu, '_');
      await downloadMaliyetSayimTemplate(rows, `Sayim_Sablonu_${safeName}.xlsx`);
      toast({ title: 'Şablon indirildi', description: 'Sayım şablonu Excel olarak indirildi.' });
    } catch (err: any) {
      console.error('Lab count template download error:', err);
      toast({ title: 'Hata', description: err?.message || 'Şablon oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsExcelBusy(false);
    }
  }, [productEntries, labName, toast]);

  const handleExcelFileSelected = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setIsExcelBusy(true);
    try {
      const parsed = await parseMaliyetSayimExcel(file);
      if (parsed.length === 0) {
        toast({ title: 'Veri bulunamadı', description: 'Yüklenen dosyada geçerli stok veya cihaz üstü sayım girişi bulunamadı.', variant: 'destructive' });
        return;
      }

      let applied = 0;
      let unknown = 0;
      // Excel bulk entry stays product-level: each row targets the product's
      // primary (nearest-expiry) lot row, or its zero-stock placeholder.
      const openTestUpdates: Record<string, string> = {};
      setLotCountData(prev => {
        const next = { ...prev };
        parsed.forEach(({ stokKodu, stokAdedi, cihazUstuAdedi }) => {
          const entry = productEntries[stokKodu];
          const primaryLot = entry?.lots.find(l => l.isPrimary) ?? entry?.lots[0];
          if (!entry || !primaryLot) {
            unknown++;
            return;
          }
          const cur = next[primaryLot.key] ?? { enteredQty: '', counted: false };
          next[primaryLot.key] = {
            enteredQty: stokAdedi !== null ? String(stokAdedi) : cur.enteredQty,
            counted: true,
          };
          if (cihazUstuAdedi !== null) openTestUpdates[stokKodu] = String(cihazUstuAdedi);
          applied++;
        });
        return next;
      });
      if (Object.keys(openTestUpdates).length > 0) {
        setOpenTestData(prev => ({ ...prev, ...openTestUpdates }));
      }

      const parts: string[] = [`${applied} ürün için sayım girildi`];
      if (unknown > 0) parts.push(`${unknown} tanımsız satır atlandı`);
      toast({
        title: applied > 0 ? 'Excel ile sayım yüklendi' : 'Eşleşen ürün yok',
        description: parts.join(' · '),
        variant: applied > 0 ? 'default' : 'destructive',
      });
    } catch (err: any) {
      console.error('Lab count Excel import error:', err);
      toast({ title: 'Hata', description: err?.message || 'Excel dosyası okunamadı.', variant: 'destructive' });
    } finally {
      setIsExcelBusy(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  }, [productEntries, toast]);

  // ------------------------------------------------------------------
  // Barcode scanning
  // ------------------------------------------------------------------
  const flashFeedback = useCallback((type: 'success' | 'error', message: string) => {
    if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current);
    setScanFeedback({ type, message });
    scanFeedbackTimer.current = setTimeout(() => setScanFeedback(null), 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current);
    };
  }, []);

  const handleScan = useCallback(({ raw }: { raw: string }) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    const result = parseAndResolveBarcode(trimmed, barcodeFormats, productCodes);
    let found = result?.product;
    if (!found) {
      found = productCodes.find(p => p.barcodeNumber === trimmed || p.stokKodu === trimmed);
    }

    if (!found) {
      flashFeedback('error', 'Ürün bulunamadı');
      return;
    }

    // Check the product is in the count scope (has min/max defined OR has stock).
    if (!scopeStokKodus.has(found.stokKodu)) {
      flashFeedback('error', `${found.stokAdi} bu laboratuvarda tanımlı değil`);
      return;
    }

    // Switch active group if the scanned product belongs to a different one.
    const targetGroup = filterMode === 'marka' ? (found.marka ?? '') : (found.urunGrubu ?? '');
    if (targetGroup && targetGroup !== activeGroup) {
      setActiveGroup(targetGroup);
    }

    // Increment the primary (nearest-expiry) lot's entered quantity by 1 and mark it counted.
    const scannedEntry = productEntries[found.stokKodu];
    const primaryLot = scannedEntry?.lots.find(l => l.isPrimary) ?? scannedEntry?.lots[0];
    if (!primaryLot) {
      flashFeedback('error', `${found.stokAdi} için lot bulunamadı`);
      return;
    }
    setLotCountData(prev => {
      const cur = prev[primaryLot.key] ?? { enteredQty: '', counted: false };
      const baseStr = cur.enteredQty.trim();
      const baseNum = baseStr === '' ? 0 : (parseInt(baseStr, 10) || 0);
      return {
        ...prev,
        [primaryLot.key]: { enteredQty: String(baseNum + 1), counted: true },
      };
    });

    flashFeedback('success', `${found.stokAdi} +1`);
  }, [barcodeFormats, productCodes, scopeStokKodus, filterMode, activeGroup, flashFeedback, productEntries]);

  useHidScanner({
    enabled: scannerActive,
    allowDuringInputs: false,
    onScan: handleScan,
  });

  const handleCompleteAll = useCallback(() => {
    setLotCountData(prev => {
      const next = { ...prev };
      scopeProducts.forEach(product => {
        productEntries[product.stokKodu]?.lots.forEach(lot => {
          const cur = next[lot.key] ?? { enteredQty: '', counted: false };
          next[lot.key] = {
            enteredQty: cur.enteredQty.trim() === '' ? String(lot.existingQty) : cur.enteredQty,
            counted: true,
          };
        });
      });
      return next;
    });
  }, [scopeProducts, productEntries]);

  const processVoice = useCallback(async (transcript: string) => {
    try {
      const products = scopeProducts.map(product => ({ stokKodu: product.stokKodu, stokAdi: product.stokAdi }));
      const response = await fetch('/api/ai/voice-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, products, brands: filterValues.map(filterLabel) }),
      });
      if (!response.ok) {
        flashFeedback('error', 'Sesli sayım işlenemedi');
        return;
      }

      const data = await response.json();
      const commands: any[] = Array.isArray(data?.commands) ? data.commands : [];
      const actions: any[] = Array.isArray(data?.actions) ? data.actions : [];
      if (commands.length === 0 && actions.length === 0) {
        flashFeedback('error', 'Sesli komut eşleşmedi');
        return;
      }

      const safeQuantity = (value: unknown): string | null => {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return null;
        return String(Math.max(0, Math.round(parsed)));
      };

      if (commands.length > 0) {
        const firstProduct = scopeProducts.find(product => product.stokKodu === commands[0]?.stokKodu);
        if (firstProduct) {
          const targetGroup = filterMode === 'marka' ? firstProduct.marka : firstProduct.urunGrubu;
          if (targetGroup) setActiveGroup(targetGroup);
        }
        const voiceOpenTestUpdates: Record<string, string> = {};
        setLotCountData(prev => {
          const next = { ...prev };
          commands.forEach(command => {
            const product = scopeProducts.find(candidate => candidate.stokKodu === command?.stokKodu);
            if (!product) return;
            const entry = productEntries[product.stokKodu];
            const primaryLot = entry?.lots.find(l => l.isPrimary) ?? entry?.lots[0];
            if (!primaryLot) return;
            const cur = next[primaryLot.key] ?? { enteredQty: '', counted: false };
            const enteredQty = safeQuantity(command.stokAdedi);
            const openTestQty = safeQuantity(command.cihazUstuAdedi);
            next[primaryLot.key] = { enteredQty: enteredQty ?? cur.enteredQty, counted: true };
            if (openTestQty !== null) voiceOpenTestUpdates[product.stokKodu] = openTestQty;
          });
          return next;
        });
        if (Object.keys(voiceOpenTestUpdates).length > 0) {
          setOpenTestData(prev => ({ ...prev, ...voiceOpenTestUpdates }));
        }
      }

      actions.forEach(action => {
        if (action?.type === 'complete_count') {
          handleCompleteAll();
        } else if (action?.type === 'complete_brand') {
          handleCompleteGroup();
        } else if (action?.type === 'next_brand') {
          handleNextGroup();
        } else if (action?.type === 'go_to_brand' && action?.brand) {
          const target = filterValues.find(key => normalizeText(filterLabel(key)) === normalizeText(String(action.brand)));
          if (target) setActiveGroup(target);
        }
      });
      flashFeedback('success', 'Sesli sayım uygulandı');
    } catch (error) {
      console.error('Voice count error:', error);
      flashFeedback('error', 'Sesli sayım hatası');
    }
  }, [
    scopeProducts,
    filterValues,
    filterLabel,
    filterMode,
    handleCompleteAll,
    handleCompleteGroup,
    handleNextGroup,
    flashFeedback,
    productEntries,
  ]);

  const toggleVoice = useCallback(() => {
    if (voiceActive) {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      try { recognition?.stop(); } catch {}
      setVoiceActive(false);
      return;
    }

    const SpeechRecognition = typeof window !== 'undefined'
      ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
      : null;
    if (!SpeechRecognition) {
      flashFeedback('error', 'Tarayıcı sesli sayımı desteklemiyor');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        if (event.results[index].isFinal) finalTranscript += event.results[index][0].transcript;
      }
      if (finalTranscript.trim()) processVoice(finalTranscript.trim());
    };
    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        flashFeedback('error', 'Mikrofon hatası');
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        try { recognition.start(); } catch {}
      } else {
        setVoiceActive(false);
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setVoiceActive(true);
    } catch {
      recognitionRef.current = null;
      flashFeedback('error', 'Mikrofon başlatılamadı');
    }
  }, [voiceActive, processVoice, flashFeedback]);

  useEffect(() => () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try { recognition?.stop(); } catch {}
  }, []);

  // ------------------------------------------------------------------
  // Save: update lab stock based on counts + persist count session
  // ------------------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (!labId || !currentUserProfile || isSaving) return;

    const allCountedLots = (Object.values(productEntries) as ProductCountEntry[]).flatMap(entry =>
      entry.lots.filter(lot => lot.counted).map(lot => ({ entry, lot })),
    );
    if (allCountedLots.length === 0) {
      toast({ title: 'Sayım yok', description: 'Kaydedilecek onaylı ürün bulunamadı.' });
      return;
    }

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      let itemsRemoved = 0;
      let itemsAdded = 0;

      for (const { entry, lot } of allCountedLots) {
        const enteredNum = lot.enteredQty.trim() === '' ? null : parseInt(lot.enteredQty, 10);
        const counted = enteredNum != null && !isNaN(enteredNum) ? enteredNum : lot.existingQty;
        const diff = counted - lot.existingQty;

        if (diff === 0) continue;

        if (diff < 0) {
          // Stock decreased: remove |diff| units from THIS lot's docs, write
          // consumption records. A doc's `adet` can be >1 (partial/full
          // order-picking shipments carry the picked quantity on one doc), so
          // removal must decrement `adet` instead of always deleting the whole
          // doc — otherwise a small count correction could wipe out a
          // multi-unit doc's entire remaining stock.
          let toRemove = Math.abs(diff);
          for (const it of lot.items) {
            if (toRemove <= 0) break;
            const stockRef = doc(db, 'depoStok', it.id);
            const removeQty = Math.min(it.qty, toRemove);
            if (removeQty >= it.qty) {
              batch.delete(stockRef);
            } else {
              batch.update(stockRef, { adet: it.qty - removeQty });
            }
            itemsRemoved += removeQty;
            toRemove -= removeQty;

            const consRef = doc(collection(db, 'tuketimKayitlari'));
            const consumption: Omit<ConsumptionRecord, 'id'> & { adet?: number } = {
              stokKodu: entry.stokKodu,
              stokAdi: entry.stokAdi,
              lotNumarasi: lot.lot || '',
              miad: lot.miad || '',
              seriNumarasi: '',
              laboratoryId: labId,
              laboratoryName: labName,
              consumptionTimestamp: new Date(),
              consumptionType: 'sayimdan_dusum',
              userId: currentUserProfile.uid,
              userName: currentUserProfile.name || currentUserProfile.email || 'System',
              adet: removeQty,
            };
            batch.set(consRef, consumption);
          }
        } else {
          // Stock increased: add |diff| items to THIS specific lot/miad
          for (let i = 0; i < diff; i++) {
            const newRef = doc(collection(db, 'depoStok'));
            batch.set(newRef, withCompanyScope({
              stokKodu: entry.stokKodu,
              stokAdi: entry.stokAdi,
              lotNumarasi: lot.lot || '',
              miad: lot.miad || '',
              seriNumarasi: '',
              isShipped: true,
              hedefKurumId: labId,
              hedefKurum: labName,
              eklenmeTarihi: Timestamp.now(),
              ekleyenKullanici: currentUserProfile.name || currentUserProfile.email || 'System',
              eklemeSebebi: 'sayim_fazlasi',
            }, currentCompanyId));
            itemsAdded++;
          }
        }
      }

      // Persist a count history record
      const sessionId = await saveLabCountSession({
        laboratoryId: labId,
        laboratoryName: labName,
        user: { id: currentUserProfile.uid || '', name: currentUserProfile.name || currentUserProfile.email || 'Bilinmeyen' },
        period: countPeriod,
        month: countMonth,
        year: countYear,
        scopeProducts: scopeProducts.map(product => ({
          stokKodu: product.stokKodu,
          stokAdi: product.stokAdi,
          laboratuvarGrubu: product.laboratuvarGrubu || '',
          laboratuvarGruplari: product.laboratuvarGruplari || [],
          ambalajDegeri: product.ambalajDegeri || 1,
        })),
        cihazUstuUploaded: false,
        kumulatifUploaded: false,
        companyId: currentCompanyId,
        batch,
        // One LabCountItem per counted lot — matches buildCountItemsFromStock's own
        // stokKodu|lot|miad granularity. openTestQty/totalTests/costAmount (product-level
        // concepts) are attributed only to the primary lot so a multi-lot product's totals
        // aren't double-counted when summed across its lot items.
        items: allCountedLots.map(({ entry, lot }) => {
          const enteredNum = lot.enteredQty.trim() === '' ? null : parseInt(lot.enteredQty, 10);
          const counted = enteredNum != null && !isNaN(enteredNum) ? enteredNum : lot.existingQty;
          const openTestQty = lot.isPrimary ? Math.max(0, parseInt(entry.openTestQty || '0', 10) || 0) : 0;
          const product = productCodes.find(candidate => candidate.stokKodu === entry.stokKodu);
          const totalTests = counted * (product?.ambalajDegeri || 1) + openTestQty;
          const currency = product?.currency || 'TRY';
          const costAmount = product?.cost
            ? (product.cost / (product.ambalajDegeri || 1)) * totalTests
            : 0;
          return {
            stokKodu: entry.stokKodu,
            stokAdi: entry.stokAdi,
            lotNumarasi: lot.lot,
            miad: lot.miad,
            marka: entry.marka || null,
            expected: lot.existingQty,
            counted,
            verifiedSerials: [],
            unscannedSerials: [],
            openTestQty,
            totalTests,
            costAmount,
            currency,
          };
        }),
      });

      await batch.commit();

      const messages: string[] = [];
      if (itemsRemoved > 0) messages.push(`${itemsRemoved} ürün düşüldü`);
      if (itemsAdded > 0) messages.push(`${itemsAdded} ürün eklendi`);
      const result = messages.length > 0 ? messages.join(', ') : 'Stok değişikliği yok';

      toast({ title: 'Sayım Kaydedildi', description: `${labName} — ${result}. Dosya yükleme adımına geçiliyor.` });
      setUploadFlow({ sessionId, step: 'cihazUstu' });
      setModalFiles([]);
    } catch (err) {
      console.error('Save lab count error:', err);
      toast({ title: 'Hata', description: 'Sayım kaydedilirken hata oluştu.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [labId, labName, currentUserProfile, currentCompanyId, productEntries, productCodes, scopeProducts, isSaving, countPeriod, countMonth, countYear, toast]);

  const completeUploadStep = useCallback(() => {
    setModalFiles([]);
    if (uploadFlow?.step === 'cihazUstu') {
      setUploadFlow({ ...uploadFlow, step: 'kumulatif' });
      return;
    }
    setUploadFlow(null);
    router.push(`/laboratuvar/sayim/${labId}/history`);
  }, [labId, router, uploadFlow]);

  const handleCalculationFileUpload = useCallback(async () => {
    if (!uploadFlow || !labId || modalFiles.length === 0) return;
    setIsUploadingCalcFile(true);
    try {
      await savePendingCalculationFiles({
        kind: uploadFlow.step,
        hospitalId: labId,
        hospitalName: labName,
        month: countMonth,
        year: countYear,
        stockCountSessionId: uploadFlow.sessionId,
        files: modalFiles,
        currentCompanyId,
        user: {
          id: currentUserProfile?.uid,
          name: currentUserProfile?.name,
          email: currentUserProfile?.email,
        },
      });
      await updateDoc(doc(db, 'hospitals', labId, 'stockCounts', uploadFlow.sessionId), {
        [uploadFlow.step === 'cihazUstu' ? 'cihazUstuUploaded' : 'kumulatifUploaded']: true,
        [uploadFlow.step === 'cihazUstu' ? 'cihazUstuUploadedAt' : 'kumulatifUploadedAt']: Timestamp.now(),
      });
      toast({ title: 'Dosya kaydedildi', description: `${uploadFlow.step === 'cihazUstu' ? 'Cihaz üstü' : 'Kümülatif'} dosyaları ${countPeriod} dönemi için beklemeye alındı.` });
      completeUploadStep();
    } catch (err: any) {
      toast({ title: 'Dosya kaydedilemedi', description: err?.message || 'Beklenmeyen hata oluştu.', variant: 'destructive' });
    } finally {
      setIsUploadingCalcFile(false);
    }
  }, [uploadFlow, labId, modalFiles, labName, countMonth, countYear, currentCompanyId, currentUserProfile, toast, countPeriod, completeUploadStep]);

  const skipUploadStep = useCallback(() => {
    completeUploadStep();
  }, [completeUploadStep]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="ml-root flex min-h-screen w-full items-center justify-center">
        <MlStyles />
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  const activeGroupProgress = groupProgress.find(g => g.key === activeGroup);
  const activePct =
    activeGroupProgress && activeGroupProgress.total > 0
      ? Math.round((activeGroupProgress.completed / activeGroupProgress.total) * 100)
      : 0;

  return (
    <div ref={rootRef} className="ml-root" style={{ position: 'relative', minHeight: '100vh', paddingBottom: mobile ? 150 : 134 }}>
      <MlStyles />
      <input
        ref={excelInputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        style={{ display: 'none' }}
        onChange={event => handleExcelFileSelected(event.target.files?.[0])}
      />

      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          padding: mobile ? '12px 14px 10px' : '16px 24px 12px',
          background: 'linear-gradient(180deg, var(--bg-0) 78%, transparent)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: mobile ? 9 : 13,
            padding: mobile ? '10px 12px' : '13px 18px',
            borderRadius: 'var(--radius-lg)',
            background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
            boxShadow: 'var(--clay)',
          }}
        >
          <MlIconBtn onClick={() => router.push('/laboratuvar-yonetimi')} ac={AC} size={mobile ? 38 : 44} ariaLabel="Geri">
            <MLIco.back s={18} />
          </MlIconBtn>
          {!mobile && (
            <span
              style={{
                width: 44,
                height: 44,
                flexShrink: 0,
                borderRadius: 13,
                display: 'grid',
                placeItems: 'center',
                color: '#fff',
                background: `radial-gradient(circle at 32% 28%, ${AC.accent}, ${AC.primary})`,
                boxShadow: `0 8px 16px -7px ${AC.glow}`,
              }}
            >
              <MLIco.flask s={22} />
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: mobile ? 15.5 : 18, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {labName}
            </div>
            <div style={{ marginTop: 2, fontSize: mobile ? 10.5 : 12, fontWeight: 600, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {groupProgress.filter(group => group.status === 'completed').length}/{groupProgress.length} {filterMode === 'marka' ? 'marka' : 'grup'} · {totalCounted}/{totalProducts} ürün
            </div>
          </div>

          {!mobile && !tablet && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <LabToolChip ico="barcode" label={scannerActive ? 'Okuyucu Aktif' : 'Barkod'} live={scannerActive} onClick={() => setScannerActive(value => !value)} />
              <LabToolChip ico="mic" label={voiceActive ? 'Mikrofon Aktif' : 'Sesli'} live={voiceActive} tone="red" onClick={toggleVoice} />
              <LabToolChip ico="download" label="Şablon" disabled={isExcelBusy} onClick={handleDownloadExcelTemplate} />
              <LabToolChip ico="excel" label="Excel" disabled={isExcelBusy} onClick={() => excelInputRef.current?.click()} />
              <LabToolChip ico="history" label="Sayım Geçmişi" onClick={() => router.push(`/laboratuvar/sayim/${labId}/history`)} />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 8 : 14, paddingLeft: mobile ? 3 : 12, borderLeft: mobile ? 'none' : '1px solid var(--line)' }}>
            {!mobile && !tablet && (
              <div style={{ textAlign: 'right', maxWidth: 180 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Toplam Maliyet</div>
                <div style={{ marginTop: 2, fontSize: 16, fontWeight: 800, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{grandMetrics.costLabel}</div>
              </div>
            )}
            <MlRing pct={overallPct} size={mobile ? 38 : 48} thickness={mobile ? 5 : 6} />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 9,
            overflowX: 'auto',
            padding: '1px 2px 3px',
          }}
        >
          {(mobile || tablet) && (
            <>
              <LabToolChip compact ico="barcode" label={scannerActive ? 'Aktif' : 'Barkod'} live={scannerActive} onClick={() => setScannerActive(value => !value)} />
              <LabToolChip compact ico="mic" label={voiceActive ? 'Aktif' : 'Sesli'} live={voiceActive} tone="red" onClick={toggleVoice} />
              <LabToolChip compact ico="download" label="Şablon" disabled={isExcelBusy} onClick={handleDownloadExcelTemplate} />
              <LabToolChip compact ico="excel" label="Excel" disabled={isExcelBusy} onClick={() => excelInputRef.current?.click()} />
              <LabToolChip compact ico="history" label="Geçmiş" onClick={() => router.push(`/laboratuvar/sayim/${labId}/history`)} />
            </>
          )}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              height: 36,
              flex: '0 0 auto',
              padding: '0 12px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--surface-2)',
              boxShadow: 'var(--clay-inset)',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-3)' }}>Dönem</span>
            <select
              value={countMonth}
              onChange={event => setCountMonth(Number(event.target.value))}
              disabled={isSaving || totalCounted > 0}
              aria-label="Sayım ayı"
              style={{ border: 0, outline: 0, background: 'transparent', color: 'var(--ink-1)', fontSize: 11.5, fontWeight: 700 }}
            >
              {countMonthOptions.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
            </select>
            <select
              value={countYear}
              onChange={event => setCountYear(Number(event.target.value))}
              disabled={isSaving || totalCounted > 0}
              aria-label="Sayım yılı"
              style={{ border: 0, outline: 0, background: 'transparent', color: 'var(--ink-1)', fontSize: 11.5, fontWeight: 700 }}
            >
              {countYearOptions.map(year => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>
          {mevcutSayimOzeti && (
            <span
              style={{ flex: '0 0 auto' }}
              title={`Son güncelleme: ${
                mevcutSayimOzeti.sonGuncelleme
                  ? new Date(mevcutSayimOzeti.sonGuncelleme).toLocaleString('tr-TR')
                  : 'bilinmiyor'
              }. Sayılan adetler bilerek doldurulmadı — sayımın bağımsız olması için.`}
            >
              <MlPill tone="amber">
                Bu dönem için zaten sayım var ({mevcutSayimOzeti.urunSayisi} ürün ·{' '}
                {mevcutSayimOzeti.kaynaklar.join(', ')})
              </MlPill>
            </span>
          )}
          {scanFeedback && (
            <MlPill tone={scanFeedback.type === 'success' ? 'ok' : 'amber'} style={{ flex: '0 0 auto' }}>
              {scanFeedback.message}
            </MlPill>
          )}
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : (tablet ? '210px minmax(0, 1fr)' : '250px minmax(0, 1fr)'),
          gap: mobile ? 0 : 16,
          padding: mobile ? '0 14px 10px' : '4px 24px 18px',
          maxWidth: 1480,
          margin: '0 auto',
        }}
      >
        {!mobile && (
          <ClayGroupRail
            groups={groupProgress}
            active={activeGroup}
            setActive={setActiveGroup}
            labelFor={filterLabel}
            filterMode={filterMode}
            setFilterMode={setFilterMode}
            costFor={groupCostLabel}
          />
        )}

        <main style={{ minWidth: 0 }}>
          {mobile && activeGroup && (
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              style={{
                all: 'unset',
                boxSizing: 'border-box',
                cursor: 'pointer',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '11px 14px',
                marginBottom: 12,
                borderRadius: 'var(--radius)',
                background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))',
                boxShadow: 'var(--clay)',
              }}
            >
              <MlRing pct={activePct} size={38} thickness={5} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filterLabel(activeGroup)}</span>
                <span style={{ display: 'block', marginTop: 1, fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)' }}>
                  {activeGroupProgress?.completed ?? 0}/{activeGroupProgress?.total ?? 0} ürün · {filterMode === 'marka' ? 'marka' : 'grup'} değiştir
                </span>
              </span>
              <MLIco.chevD s={18} />
            </button>
          )}

          {activeGroup ? (
            <>
              <div style={{ padding: mobile ? '4px 2px 12px' : '10px 2px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h1 style={{ margin: 0, fontSize: mobile ? 22 : 26, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>{filterLabel(activeGroup)}</h1>
                  <MlPill tone={activePct === 100 ? 'ok' : 'accent'}>{activeGroupProgress?.completed ?? 0}/{activeGroupProgress?.total ?? 0} sayıldı</MlPill>
                  {groupCostLabel(activeGroup) && <MlPill tone="blue">{groupCostLabel(activeGroup)}</MlPill>}
                  <div style={{ flex: 1 }} />
                  {!mobile && (
                    <MlBtn ico="check" variant="green" ac={AC} onClick={handleCompleteGroup} size="sm">
                      {filterMode === 'marka' ? 'Markayı Tamamla' : 'Grubu Tamamla'}
                    </MlBtn>
                  )}
                </div>
                <div style={{ marginTop: 11 }}><MlBar pct={activePct} tone={activePct === 100 ? 'linear-gradient(90deg, #8FD3A6, var(--water-solid))' : undefined} height={8} /></div>
              </div>

              <div style={{ display: 'flex', gap: 9, marginBottom: 14, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                  <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', display: 'inline-flex' }}><MLIco.search s={17} /></span>
                  <input
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="Ürün ara…"
                    style={{ width: '100%', height: 46, padding: '0 16px 0 42px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-1)', fontSize: 14.5, fontWeight: 500, fontFamily: 'inherit', outline: 'none' }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowOnlyUncounted(value => !value)}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 46,
                    padding: '0 16px',
                    borderRadius: 'var(--radius-pill)',
                    background: showOnlyUncounted ? `${AC.primary}16` : 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))',
                    boxShadow: showOnlyUncounted ? `inset 0 0 0 1.5px ${AC.primary}66` : 'var(--clay)',
                    color: showOnlyUncounted ? AC.primary : 'var(--ink-2)',
                    fontSize: 13,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <MLIco.filter s={15} /> Sadece Sayılmayanlar
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeLotRows.map(({ product, entry, lot }: { product: ProductCode; entry: ProductCountEntry; lot: LotEntry }, index: number) => {
                  const nextRow = activeLotRows.slice(index + 1).find(r => !r.lot.counted);
                  return (
                    <ClayLotCard
                      key={lot.key}
                      product={product}
                      productEntry={entry}
                      lot={lot}
                      mobile={mobile || tablet}
                      index={index}
                      completing={completingLots.has(lot.key)}
                      focusActive={focusTarget === lot.key}
                      onEnteredChange={value => handleLotEnteredChange(lot.key, value)}
                      onEnterComplete={() => handleLotEnterComplete(lot.key, nextRow?.lot.key)}
                      onToggleCounted={() => handleToggleCounted(lot.key, lot.existingQty)}
                      onOpenTestChange={value => handleOpenTestChange(product.stokKodu, value)}
                      onConfirmExisting={() => handleConfirmExisting(lot.key, lot.existingQty)}
                    />
                  );
                })}
                {activeLotRows.length === 0 && (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontWeight: 700, borderRadius: 'var(--radius)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}>
                    {showOnlyUncounted ? 'Bu bölümde sayılmayan ürün kalmadı.' : searchQuery ? 'Aramayla eşleşen ürün bulunamadı.' : 'Bu bölümde ürün bulunamadı.'}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ padding: 54, textAlign: 'center', color: 'var(--ink-3)', fontWeight: 700, borderRadius: 'var(--radius)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}>
              Bu laboratuvarda sayım kapsamına giren ürün bulunamadı.
            </div>
          )}
        </main>
      </div>

      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 80,
          padding: mobile ? '8px 14px calc(8px + env(safe-area-inset-bottom))' : '12px 24px 16px',
          background: 'linear-gradient(0deg, var(--bg-0) 72%, transparent)',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            maxWidth: 1480,
            margin: '0 auto',
            display: 'flex',
            flexDirection: mobile ? 'column' : 'row',
            alignItems: mobile ? 'stretch' : 'center',
            gap: mobile ? 7 : 12,
            padding: mobile ? '8px 10px 10px' : '12px 18px',
            borderRadius: 'var(--radius-lg)',
            background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))',
            boxShadow: '0 -8px 24px -12px rgba(150,128,96,0.4), var(--clay)',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: mobile ? 'center' : 'flex-start', gap: mobile ? 15 : 22, flex: 1, minWidth: 0 }}>
            <div style={{ textAlign: mobile ? 'center' : 'left' }}>
              <div style={{ fontSize: mobile ? 8.5 : 10.5, fontWeight: 800, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Toplam Test</div>
              <MlNum value={grandMetrics.tests} size={mobile ? 18 : 24} />
            </div>
            <div style={{ width: 1, height: mobile ? 30 : 40, background: 'var(--line)' }} />
            <div style={{ textAlign: mobile ? 'center' : 'left', minWidth: 0 }}>
              <div style={{ fontSize: mobile ? 8.5 : 10.5, fontWeight: 800, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Toplam Maliyet</div>
              <div style={{ marginTop: 2, maxWidth: mobile ? 160 : 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: mobile ? 15 : 24, fontWeight: 800, color: 'var(--accent)' }}>{grandMetrics.costLabel}</div>
            </div>
            {!mobile && (
              <>
                <div style={{ width: 1, height: 40, background: 'var(--line)' }} />
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sayılan</div>
                  <div style={{ marginTop: 2, fontSize: 22, fontWeight: 800, color: 'var(--ink-1)' }}>{totalCounted}<span style={{ fontSize: 14, color: 'var(--ink-3)' }}>/{totalProducts}</span></div>
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 9 }}>
            {mobile && activeGroup && (
              <MlBtn ico="check" variant="green" ac={AC} onClick={handleCompleteGroup} size="sm">
                {filterMode === 'marka' ? 'Marka' : 'Grup'}
              </MlBtn>
            )}
            {activePct === 100 && groupProgress.some(group => group.status !== 'completed') && (
              <MlBtn ac={AC} onClick={handleNextGroup} size={mobile ? 'sm' : undefined}>Sonraki</MlBtn>
            )}
            <MlBtn
              ico="check"
              variant="primary"
              ac={AC}
              onClick={handleSave}
              disabled={isSaving || totalCounted === 0}
              size={mobile ? 'sm' : 'lg'}
            >
              {isSaving ? 'Kaydediliyor…' : 'Sayımı Kaydet'}
            </MlBtn>
          </div>
        </div>
      </div>

      {mobile && railOpen && (
        <MlModal open={railOpen} onClose={() => setRailOpen(false)} sheet>
          <MlModalHead
            ico="tag"
            title={filterMode === 'marka' ? 'Marka Seç' : 'Ürün Grubu Seç'}
            sub={`${groupProgress.filter(group => group.status === 'completed').length}/${groupProgress.length} tamamlandı`}
            onClose={() => setRailOpen(false)}
            ac={AC}
          />
          <div style={{ padding: 14, overflowY: 'auto' }}>
            <ClayGroupRail
              bare
              groups={groupProgress}
              active={activeGroup}
              setActive={key => { setActiveGroup(key); setRailOpen(false); }}
              labelFor={filterLabel}
              filterMode={filterMode}
              setFilterMode={setFilterMode}
              costFor={groupCostLabel}
            />
          </div>
        </MlModal>
      )}

      <MlModal
        open={!!uploadFlow}
        onClose={() => { if (!isUploadingCalcFile) skipUploadStep(); }}
        width={720}
        sheet={mobile}
      >
        <MlModalHead
          ico="excel"
          title="Sayım Dosyalarını Yükle"
          sub={`${labName} · ${countPeriod}. Dosyaları şimdi yükleyebilir veya bu adımı geçip sayım geçmişinden daha sonra tamamlayabilirsiniz.`}
          onClose={() => { if (!isUploadingCalcFile) skipUploadStep(); }}
          ac={AC}
        />
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1.08fr 0.92fr', gap: 16, padding: mobile ? 16 : 22, overflowY: 'auto' }}>
          <label
            style={{
              minHeight: mobile ? 160 : 230,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 22,
              textAlign: 'center',
              borderRadius: 'var(--radius)',
              background: 'var(--surface-2)',
              boxShadow: 'var(--clay-inset)',
              border: '2px dashed rgba(201,138,87,0.34)',
            }}
          >
            <span style={{ width: 54, height: 54, display: 'grid', placeItems: 'center', borderRadius: 17, color: 'var(--accent)', background: 'rgba(201,138,87,0.12)', marginBottom: 12 }}>
              <UploadCloud size={28} />
            </span>
            <strong style={{ fontSize: 14.5, color: 'var(--ink-1)' }}>Dosyaları seç veya buraya bırak</strong>
            <span style={{ marginTop: 5, fontSize: 12, color: 'var(--ink-2)' }}>PDF, TXT ve CSV dosyaları desteklenir.</span>
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.csv,application/pdf,text/*"
              style={{ display: 'none' }}
              onChange={event => setModalFiles(Array.from(event.target.files || []))}
            />
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: 15, borderRadius: 'var(--radius)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Akış</div>
              {([
                ['cihazUstu', '1. Cihaz üstü dosyası'],
                ['kumulatif', '2. Kümülatif dosyası'],
              ] as const).map(([key, label]) => {
                const active = uploadFlow?.step === key;
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: active ? 'var(--accent)' : 'var(--ink-3)', boxShadow: active ? '0 0 0 5px rgba(201,138,87,0.13)' : 'none' }} />
                    <span style={{ fontSize: 13, fontWeight: active ? 800 : 600, color: active ? 'var(--ink-1)' : 'var(--ink-2)' }}>{label}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ flex: 1, minHeight: 110, padding: 15, borderRadius: 'var(--radius)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: 'var(--clay)' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-1)' }}>Seçilen dosyalar</div>
              {modalFiles.length > 0 ? (
                <div style={{ maxHeight: 150, overflowY: 'auto', marginTop: 9 }}>
                  {modalFiles.map(file => (
                    <div key={`${file.name}-${file.size}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line)', fontSize: 11.5 }}>
                      <FileText size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink-2)', fontWeight: 600 }}>{file.name}</span>
                      <span style={{ color: 'var(--ink-3)' }}>{Math.ceil(file.size / 1024)} KB</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-3)' }}>Henüz dosya seçilmedi.</div>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '14px 20px 18px', borderTop: '1px solid var(--line)' }}>
          <MlBtn onClick={skipUploadStep} disabled={isUploadingCalcFile} size="sm">
            {uploadFlow?.step === 'cihazUstu' ? 'Atla ve İleri' : 'Atla ve Bitir'}
          </MlBtn>
          <MlBtn variant="primary" ac={AC} onClick={handleCalculationFileUpload} disabled={isUploadingCalcFile || modalFiles.length === 0} size="sm">
            {isUploadingCalcFile ? 'Yükleniyor…' : uploadFlow?.step === 'cihazUstu' ? 'Yükle ve İleri' : 'Yükle ve Bitir'}
          </MlBtn>
        </div>
      </MlModal>
    </div>
  );

}
