// File: /app/(protected)/laboratuvar/sayim/[labId]/page.tsx
'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection, doc, getDocs, where, query, Timestamp, writeBatch, getDoc, updateDoc,
} from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { getScopedDocs } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Loader2,
  Save,
  ScanBarcode,
  Search,
  TestTube,
  X,
  PackageX,
  ArrowRight,
  UploadCloud,
  FileText,
  FileSpreadsheet,
  Download,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ProductCode, DepoStokItem, ConsumptionRecord, MinMaxRule } from '@/lib/types';
import { saveLabCountSession } from '@/lib/labCount';
import { downloadLabCountTemplate, parseLabCountExcel } from '@/lib/labCountExcel';
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

interface ExistingLot {
  lot: string;
  miad: string;
  count: number;
  itemIds: string[]; // depoStok doc ids in this group
}

interface ProductCountEntry {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  urunGrubu: string;
  laboratuvarGrubu: string;
  existingTotal: number;
  existingLots: ExistingLot[];
  /** Manual override quantity (string to allow empty input) */
  enteredQty: string;
  /** Device/open tests. Informational only; never changes physical stock. */
  openTestQty: string;
  /** True if user confirmed the existing/entered count */
  counted: boolean;
}

interface CountStateEntry {
  enteredQty: string;
  openTestQty?: string;
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

function miadBadgeClass(severity: MiadSeverity): string {
  if (severity === 'expired' || severity === 'critical') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  if (severity === 'warning') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
  if (severity === 'caution') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (severity === 'notice') return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
  return '';
}

function formatUrunGrubu(g?: string): string {
  if (!g) return '';
  if (g === 'kit') return 'Kit';
  if (g === 'sarf') return 'Sarf';
  if (g === 'yedek_parca') return 'Yedek Parça';
  return g;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface SidebarChecklistItemProps {
  label: string;
  group: GroupProgress;
  isActive: boolean;
  onClick: () => void;
}

function SidebarChecklistItem({ label, group, isActive, onClick }: SidebarChecklistItemProps) {
  const pct = group.total > 0 ? Math.round((group.completed / group.total) * 100) : 0;
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-200',
        isActive
          ? 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-l-[3px] border-l-[var(--dashboard-accent)]'
          : 'hover:bg-[var(--dashboard-surface-2)]/50',
      )}
    >
      <span className="shrink-0">
        {group.status === 'completed' ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
        ) : group.status === 'in_progress' ? (
          <div className="w-5 h-5 rounded-full border-2 border-amber-500 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
        ) : (
          <Circle className="w-5 h-5 text-[var(--dashboard-muted)]" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <span className={cn('text-sm font-medium block truncate', isActive ? 'text-[var(--dashboard-text)]' : 'text-[var(--dashboard-text)]/80')}>
          {label}
        </span>
        <span className="text-xs text-[var(--dashboard-muted)]">
          {group.completed} / {group.total} ürün
        </span>
      </div>
      <div className="shrink-0 w-10 h-10 relative">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="14" fill="none" stroke="var(--dashboard-stroke)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="14" fill="none"
            stroke={group.status === 'completed' ? '#10b981' : group.status === 'in_progress' ? '#f59e0b' : 'var(--dashboard-stroke)'}
            strokeWidth="3"
            strokeDasharray={`${pct * 0.88} 88`}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[var(--dashboard-muted)]">
          {pct}
        </span>
      </div>
    </button>
  );
}

interface ProductRowProps {
  product: ProductCode;
  entry: ProductCountEntry;
  isOutOfStock: boolean;
  onEnteredChange: (val: string) => void;
  onConfirmExisting: () => void;
  onToggleCounted: () => void;
}

function ProductRow({ product, entry, isOutOfStock, onEnteredChange, onConfirmExisting, onToggleCounted }: ProductRowProps) {
  const enteredNum = entry.enteredQty.trim() === '' ? null : parseInt(entry.enteredQty, 10);
  const effectiveCount = enteredNum != null && !isNaN(enteredNum) ? enteredNum : entry.existingTotal;
  const delta = effectiveCount - entry.existingTotal;

  return (
    <div
      className={cn(
        'w-full px-4 sm:px-5 py-3 border-b border-[var(--dashboard-stroke)] last:border-b-0 transition-all',
        entry.counted && 'bg-emerald-500/5',
        isOutOfStock && !entry.counted && 'bg-slate-500/5',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Product info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--dashboard-text)] truncate">
            {product.stokAdi}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-[var(--dashboard-muted)]">{product.stokKodu}</span>
            {product.urunGrubu && (
              <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] bg-[var(--dashboard-surface-2)] px-1.5 py-0.5 rounded">
                {formatUrunGrubu(product.urunGrubu)}
              </span>
            )}
            {product.marka && (
              <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] bg-[var(--dashboard-surface-2)] px-1.5 py-0.5 rounded">
                {product.marka}
              </span>
            )}
            {isOutOfStock && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                <PackageX className="w-2.5 h-2.5" />
                Stokta Yok
              </span>
            )}
          </div>
        </div>

        {/* Counted tick */}
        <button
          onClick={onToggleCounted}
          title={entry.counted ? 'Onayı kaldır' : 'Sayımı onayla'}
          className={cn(
            'shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200',
            entry.counted
              ? 'bg-emerald-500 text-white shadow-md'
              : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-accent)]',
          )}
        >
          <Check className="w-4 h-4" />
        </button>
      </div>

      {/* Existing lots */}
      {!isOutOfStock && entry.existingLots.length > 0 && (
        <div className="mt-2 space-y-1">
          {entry.existingLots.map((lot, i) => {
            const info = getMiadInfo(lot.miad);
            return (
              <div
                key={`${lot.lot}-${lot.miad}-${i}`}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--dashboard-surface)] border border-[var(--dashboard-stroke)] text-xs"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="font-mono text-[var(--dashboard-text)] truncate">
                    {lot.lot ? `Lot: ${lot.lot}` : 'Lot: —'}
                  </span>
                  {lot.miad && (
                    <span className="text-[var(--dashboard-muted)]">{lot.miad}</span>
                  )}
                  {lot.miad && info.severity !== 'normal' && info.days !== Infinity && (
                    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold', miadBadgeClass(info.severity))}>
                      {info.days < 0 ? 'geçmiş' : `${info.days}g`}
                    </span>
                  )}
                </div>
                <span className="font-bold text-[var(--dashboard-text)] shrink-0">
                  {lot.count}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Inputs row */}
      <div className="mt-2 flex items-center gap-2">
        {/* Existing total + confirm button */}
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'text-[11px] font-semibold px-2 py-1 rounded-md',
              isOutOfStock
                ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
            )}
            title="Mevcut lab stoğu"
          >
            Stok: {entry.existingTotal}
          </span>
          {!isOutOfStock && (
            <button
              type="button"
              onClick={onConfirmExisting}
              className="h-7 px-2 rounded-md text-[10px] font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-200 transition-colors flex items-center gap-1"
              title="Stoktaki adedi sayım olarak onayla"
            >
              <Check className="w-3 h-3" />
              Stoğu Onayla
            </button>
          )}
        </div>

        {/* Manual entry input */}
        <div className="flex-1 flex items-center gap-1.5">
          <label className="text-[10px] font-medium text-[var(--dashboard-muted)] uppercase tracking-wider shrink-0">
            Sayım
          </label>
          <Input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder={String(entry.existingTotal)}
            value={entry.enteredQty}
            onChange={(e) => onEnteredChange(e.target.value)}
            className="h-8 text-sm w-24"
          />
          {enteredNum != null && !isNaN(enteredNum) && delta !== 0 && (
            <span
              className={cn(
                'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                delta > 0
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
              )}
            >
              {delta > 0 ? `+${delta}` : delta}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const formatProductMoney = (amount: number, currency?: string) =>
  amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + currencySymbol(currency);

const toMetricEntry = (entry: ProductCountEntry) => ({
  stokKodu: entry.stokKodu,
  stokAdi: entry.stokAdi,
  marka: entry.marka,
  stokAdedi: entry.enteredQty,
  cihazUstuAdedi: entry.openTestQty,
  counted: entry.counted,
});

function LabToolChip({ ico, label, onClick, live, tone, compact, disabled }: any) {
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

interface ClayProductCardProps {
  product: ProductCode;
  entry: ProductCountEntry;
  isOutOfStock: boolean;
  mobile: boolean;
  index: number;
  onEnteredChange: (value: string) => void;
  onOpenTestChange: (value: string) => void;
  onConfirmExisting: () => void;
  onToggleCounted: () => void;
  ac?: Accent;
}

function ClayProductCard({
  product,
  entry,
  isOutOfStock,
  mobile,
  index,
  onEnteredChange,
  onOpenTestChange,
  onConfirmExisting,
  onToggleCounted,
  ac = AC,
}: ClayProductCardProps) {
  const entered = entry.enteredQty.trim() === '' ? null : parseInt(entry.enteredQty, 10);
  const effective = entered != null && Number.isFinite(entered) ? entered : entry.existingTotal;
  const delta = effective - entry.existingTotal;
  const metric = toMetricEntry(entry);
  const totalTests = productTotalTests(product, metric);
  const productCost = calcProductCost(product, metric);
  const packageValue = product.ambalajDegeri || 1;

  return (
    <article
      style={{
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        background: entry.counted
          ? 'linear-gradient(180deg, rgba(111,181,133,0.09), rgba(111,181,133,0.03))'
          : 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
        boxShadow: entry.counted ? 'var(--clay), inset 0 0 0 1.5px rgba(111,181,133,0.35)' : 'var(--clay)',
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
              {product.urunGrubu && <MlPill style={{ padding: '3px 9px', fontSize: 10.5 }}>{formatUrunGrubu(product.urunGrubu)}</MlPill>}
              {product.marka && <MlPill tone="accent" style={{ padding: '3px 9px', fontSize: 10.5 }}>{product.marka}</MlPill>}
              <MlPill tone="blue" style={{ padding: '3px 9px', fontSize: 10.5 }}><MLIco.box s={12} /> Kutu ×{packageValue}</MlPill>
              {isOutOfStock && <MlPill style={{ padding: '3px 9px', fontSize: 10.5, color: 'var(--danger)' }}><PackageX size={12} /> Stokta Yok</MlPill>}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleCounted}
            aria-label={entry.counted ? 'Sayım onayını kaldır' : 'Satırı tamamla'}
            title={entry.counted ? 'Onayı kaldır' : 'Satırı tamamla'}
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              color: entry.counted ? '#fff' : 'var(--ink-3)',
              background: entry.counted ? 'radial-gradient(circle at 32% 28%, #8FD3A6, var(--water-solid))' : 'var(--surface-2)',
              boxShadow: entry.counted ? '0 6px 13px -4px rgba(111,181,133,0.6)' : 'var(--clay-inset)',
              border: entry.counted ? 'none' : '2px solid var(--ink-3)',
              boxSizing: 'border-box',
            }}
          >
            <MLIco.check s={19} />
          </button>
        </div>

        {entry.existingLots.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 11 }}>
            {entry.existingLots.map((lot, lotIndex) => {
              const info = getMiadInfo(lot.miad);
              const urgent = info.severity !== 'normal' && info.days !== Infinity;
              return (
                <span
                  key={`${lot.lot}-${lot.miad}-${lotIndex}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 9px',
                    borderRadius: 'var(--radius-pill)',
                    background: urgent ? 'var(--amber-soft)' : 'var(--surface-2)',
                    boxShadow: urgent ? 'none' : 'var(--clay-inset)',
                    color: urgent ? (info.days < 0 || info.days <= 3 ? 'var(--danger)' : '#9A6F1E') : 'var(--ink-2)',
                    fontSize: 10.5,
                    fontWeight: 700,
                  }}
                >
                  {lot.lot ? `Lot ${lot.lot}` : 'Lot —'} · {lot.miad || 'Miad —'} · {lot.count}
                  {urgent && <strong>{info.days < 0 ? 'geçmiş' : `${info.days}g`}</strong>}
                </span>
              );
            })}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : '1fr 1fr 1.3fr', gap: 10, marginTop: 13 }}>
          <div style={{ padding: '10px 13px', borderRadius: 'var(--radius)', background: 'var(--surface-hi)', boxShadow: 'var(--clay-inset)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <label htmlFor={`count-${product.stokKodu}`} style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Kutu Adedi</label>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-3)' }}>Stok {entry.existingTotal}</span>
            </div>
            <input
              id={`count-${product.stokKodu}`}
              value={entry.enteredQty}
              onChange={event => onEnteredChange(event.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder={String(entry.existingTotal)}
              style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', marginTop: 2, fontSize: mobile ? 24 : 27, fontWeight: 800, color: 'var(--ink-1)', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minHeight: 24 }}>
              {!isOutOfStock ? (
                <button type="button" onClick={onConfirmExisting} style={{ all: 'unset', cursor: 'pointer', fontSize: 10.5, fontWeight: 800, color: 'var(--water-deep)' }}>
                  Stoğu onayla
                </button>
              ) : <span />}
              {entered != null && delta !== 0 && <span style={{ fontSize: 10.5, fontWeight: 800, color: delta > 0 ? 'var(--water-deep)' : 'var(--danger)' }}>{delta > 0 ? `+${delta}` : delta}</span>}
            </div>
          </div>

          <div style={{ padding: '10px 13px', borderRadius: 'var(--radius)', background: 'var(--surface-hi)', boxShadow: 'var(--clay-inset)' }}>
            <label htmlFor={`open-${product.stokKodu}`} style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Açık / Ek Test</label>
            <input
              id={`open-${product.stokKodu}`}
              value={entry.openTestQty}
              onChange={event => onOpenTestChange(event.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="0"
              style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', marginTop: 2, fontSize: mobile ? 24 : 27, fontWeight: 800, color: 'var(--ink-2)', fontFamily: 'inherit' }}
            />
            <div style={{ minHeight: 24, display: 'flex', alignItems: 'center', fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)' }}>Stok mutasyonuna dahil edilmez</div>
          </div>

          <div
            style={{
              gridColumn: mobile ? '1 / -1' : 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '11px 16px',
              borderRadius: 'var(--radius)',
              background: entry.counted ? `linear-gradient(135deg, ${ac.accent}, ${ac.primary})` : 'var(--surface-2)',
              boxShadow: entry.counted ? `inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 18px -8px ${ac.glow}` : 'var(--clay-inset)',
            }}
          >
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: entry.counted ? 'rgba(255,255,255,0.82)' : 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Toplam Test</div>
              <MlNum value={totalTests} size={mobile ? 25 : 32} color={entry.counted ? '#fff' : 'var(--ink-1)'} />
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: entry.counted ? 'rgba(255,255,255,0.82)' : 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Maliyet</div>
              <div style={{ marginTop: 3, fontSize: mobile ? 18 : 22, fontWeight: 800, color: entry.counted ? '#fff' : 'var(--accent)', whiteSpace: 'nowrap' }}>
                {formatProductMoney(productCost.amount, productCost.currency)}
              </div>
            </div>
          </div>
        </div>
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

  // Per-product count state
  const [countData, setCountData] = useState<Record<string, CountStateEntry>>({});
  const [countMonth, setCountMonth] = useState(new Date().getMonth());
  const [countYear, setCountYear] = useState(new Date().getFullYear());
  const [uploadFlow, setUploadFlow] = useState<{ sessionId: string; step: PendingCalculationKind } | null>(null);
  const [modalFiles, setModalFiles] = useState<File[]>([]);
  const [isUploadingCalcFile, setIsUploadingCalcFile] = useState(false);

  // Excel-based count entry
  const [isExcelBusy, setIsExcelBusy] = useState(false);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const countPeriod = useMemo(() => buildCalculationPeriod(countMonth, countYear), [countMonth, countYear]);
  const countMonthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
    value: i,
    label: new Date(0, i, 1).toLocaleString('tr-TR', { month: 'long' }),
  })), []);
  const countYearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 7 }, (_, i) => y - 3 + i);
  }, []);

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

  // Build per-product entries (existing lots + total)
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
        existingLots: [],
        enteredQty: countData[p.stokKodu]?.enteredQty ?? '',
        openTestQty: countData[p.stokKodu]?.openTestQty ?? '',
        counted: countData[p.stokKodu]?.counted ?? false,
      };
    });

    // Group raw stock by stokKodu / lot / miad
    const lotMap = new Map<string, ExistingLot>();
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
          existingLots: [],
          enteredQty: countData[item.stokKodu]?.enteredQty ?? '',
          openTestQty: countData[item.stokKodu]?.openTestQty ?? '',
          counted: countData[item.stokKodu]?.counted ?? false,
        };
      }
      const lotKey = `${item.stokKodu}|${item.lotNumarasi || ''}|${formatMiad(item.miad as any) || ''}`;
      let lot = lotMap.get(lotKey);
      if (!lot) {
        lot = {
          lot: item.lotNumarasi || '',
          miad: formatMiad(item.miad as any) || '',
          count: 0,
          itemIds: [],
        };
        lotMap.set(lotKey, lot);
        map[item.stokKodu].existingLots.push(lot);
      }
      lot.count++;
      if (item.id) lot.itemIds.push(item.id);
      map[item.stokKodu].existingTotal++;
    });

    // Sort lots within each product (closest miad first)
    Object.values(map).forEach(entry => {
      entry.existingLots.sort((a, b) => {
        const ai = getMiadInfo(a.miad).days;
        const bi = getMiadInfo(b.miad).days;
        return ai - bi;
      });
    });

    return map;
  }, [scopeProducts, rawStock, countData]);

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
  const setEntry = useCallback((stokKodu: string, patch: Partial<CountStateEntry>) => {
    setCountData(prev => {
      const cur = prev[stokKodu] ?? { enteredQty: '', openTestQty: '', counted: false };
      return { ...prev, [stokKodu]: { ...cur, ...patch } };
    });
  }, []);

  const handleEnteredChange = useCallback((stokKodu: string, val: string) => {
    setEntry(stokKodu, { enteredQty: val, counted: true });
  }, [setEntry]);

  const handleOpenTestChange = useCallback((stokKodu: string, val: string) => {
    setEntry(stokKodu, { openTestQty: val, counted: true });
  }, [setEntry]);

  const handleConfirmExisting = useCallback((stokKodu: string) => {
    const existing = productEntries[stokKodu]?.existingTotal ?? 0;
    setEntry(stokKodu, { enteredQty: String(existing), counted: true });
  }, [productEntries, setEntry]);

  const handleToggleCounted = useCallback((stokKodu: string) => {
    setCountData(prev => {
      const cur = prev[stokKodu] ?? { enteredQty: '', openTestQty: '', counted: false };
      const nextCounted = !cur.counted;
      // If user is confirming an out-of-stock product, default the entered qty to 0
      const existing = productEntries[stokKodu]?.existingTotal ?? 0;
      const nextEntered =
        nextCounted && cur.enteredQty.trim() === ''
          ? String(existing)
          : cur.enteredQty;
      return { ...prev, [stokKodu]: { enteredQty: nextEntered, counted: nextCounted } };
    });
  }, [productEntries]);

  const handleCompleteGroup = useCallback(() => {
    if (!activeGroup) return;
    setCountData(prev => {
      const next = { ...prev };
      activeProducts.forEach(p => {
        const existing = productEntries[p.stokKodu]?.existingTotal ?? 0;
        const cur = next[p.stokKodu] ?? { enteredQty: '', openTestQty: '', counted: false };
        next[p.stokKodu] = {
          enteredQty: cur.enteredQty.trim() === '' ? String(existing) : cur.enteredQty,
          counted: true,
        };
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
    const entries = Object.values(productEntries);
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
          mevcutAdet: e.existingTotal,
        }))
        .sort((a, b) => {
          const byMarka = (a.marka || '').localeCompare(b.marka || '', 'tr');
          if (byMarka !== 0) return byMarka;
          return a.stokAdi.localeCompare(b.stokAdi, 'tr');
        });
      const safeName = (labName || 'Laboratuvar').replace(/[^\p{L}\p{N}]+/gu, '_');
      await downloadLabCountTemplate(rows, `Sayim_Sablonu_${safeName}.xlsx`);
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
      const parsed = await parseLabCountExcel(file);
      if (parsed.length === 0) {
        toast({ title: 'Veri bulunamadı', description: 'Yüklenen dosyada geçerli "Sayım Adeti" girişi bulunamadı.', variant: 'destructive' });
        return;
      }

      let applied = 0;
      let unknown = 0;
      setCountData(prev => {
        const next = { ...prev };
        parsed.forEach(({ stokKodu, sayimAdeti }) => {
          if (!productEntries[stokKodu]) {
            unknown++;
            return;
          }
          next[stokKodu] = {
            ...next[stokKodu],
            enteredQty: String(sayimAdeti),
            openTestQty: next[stokKodu]?.openTestQty ?? '',
            counted: true,
          };
          applied++;
        });
        return next;
      });

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

    // Increment the entered quantity by 1 and mark as counted.
    setCountData(prev => {
      const cur = prev[found!.stokKodu] ?? { enteredQty: '', openTestQty: '', counted: false };
      const baseStr = cur.enteredQty.trim();
      const baseNum = baseStr === '' ? 0 : (parseInt(baseStr, 10) || 0);
      return {
        ...prev,
        [found!.stokKodu]: {
          ...cur,
          enteredQty: String(baseNum + 1),
          counted: true,
        },
      };
    });

    flashFeedback('success', `${found.stokAdi} +1`);
  }, [barcodeFormats, productCodes, scopeStokKodus, filterMode, activeGroup, flashFeedback]);

  useHidScanner({
    enabled: scannerActive,
    allowDuringInputs: false,
    onScan: handleScan,
  });

  const handleCompleteAll = useCallback(() => {
    setCountData(prev => {
      const next = { ...prev };
      scopeProducts.forEach(product => {
        const current = next[product.stokKodu] ?? { enteredQty: '', openTestQty: '', counted: false };
        const existing = productEntries[product.stokKodu]?.existingTotal ?? 0;
        next[product.stokKodu] = {
          ...current,
          enteredQty: current.enteredQty.trim() === '' ? String(existing) : current.enteredQty,
          openTestQty: current.openTestQty ?? '',
          counted: true,
        };
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
        setCountData(prev => {
          const next = { ...prev };
          commands.forEach(command => {
            const product = scopeProducts.find(candidate => candidate.stokKodu === command?.stokKodu);
            if (!product) return;
            const current = next[product.stokKodu] ?? { enteredQty: '', openTestQty: '', counted: false };
            const enteredQty = safeQuantity(command.stokAdedi);
            const openTestQty = safeQuantity(command.cihazUstuAdedi);
            next[product.stokKodu] = {
              ...current,
              enteredQty: enteredQty ?? current.enteredQty,
              openTestQty: openTestQty ?? current.openTestQty ?? '',
              counted: true,
            };
          });
          return next;
        });
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

    const allCountedEntries = Object.values(productEntries).filter(e => e.counted);
    if (allCountedEntries.length === 0) {
      toast({ title: 'Sayım yok', description: 'Kaydedilecek onaylı ürün bulunamadı.' });
      return;
    }

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      let itemsRemoved = 0;
      let itemsAdded = 0;

      for (const entry of allCountedEntries) {
        const enteredNum = entry.enteredQty.trim() === '' ? null : parseInt(entry.enteredQty, 10);
        const counted = enteredNum != null && !isNaN(enteredNum) ? enteredNum : entry.existingTotal;
        const diff = counted - entry.existingTotal;

        if (diff === 0) continue;

        if (diff < 0) {
          // Stock decreased: remove |diff| items, write consumption records
          const toRemove = Math.abs(diff);
          // Flatten lots into individual stock items, prefer earliest expiry first
          const flat: { id: string; lot: string; miad: string }[] = [];
          entry.existingLots.forEach(lot => {
            lot.itemIds.forEach(id => flat.push({ id, lot: lot.lot, miad: lot.miad }));
          });
          flat.sort((a, b) => getMiadInfo(a.miad).days - getMiadInfo(b.miad).days);

          const slice = flat.slice(0, toRemove);
          for (const it of slice) {
            const stockRef = doc(db, 'depoStok', it.id);
            batch.delete(stockRef);
            itemsRemoved++;

            const consRef = doc(collection(db, 'tuketimKayitlari'));
            const consumption: Omit<ConsumptionRecord, 'id'> = {
              stokKodu: entry.stokKodu,
              stokAdi: entry.stokAdi,
              lotNumarasi: it.lot || '',
              miad: it.miad || '',
              seriNumarasi: '',
              laboratoryId: labId,
              laboratoryName: labName,
              consumptionTimestamp: new Date(),
              consumptionType: 'sayimdan_dusum',
              userId: currentUserProfile.uid,
              userName: currentUserProfile.name || currentUserProfile.email || 'System',
            };
            batch.set(consRef, consumption);
          }
        } else {
          // Stock increased: add |diff| items
          const template = entry.existingLots[0] ?? { lot: '', miad: '' };
          for (let i = 0; i < diff; i++) {
            const newRef = doc(collection(db, 'depoStok'));
            batch.set(newRef, withCompanyScope({
              stokKodu: entry.stokKodu,
              stokAdi: entry.stokAdi,
              lotNumarasi: template.lot || '',
              miad: template.miad || '',
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
        cihazUstuUploaded: false,
        kumulatifUploaded: false,
        items: allCountedEntries.map(entry => {
          const enteredNum = entry.enteredQty.trim() === '' ? null : parseInt(entry.enteredQty, 10);
          const counted = enteredNum != null && !isNaN(enteredNum) ? enteredNum : entry.existingTotal;
          const openTestQty = Math.max(0, parseInt(entry.openTestQty || '0', 10) || 0);
          const product = productCodes.find(candidate => candidate.stokKodu === entry.stokKodu);
          const totalTests = counted * (product?.ambalajDegeri || 1) + openTestQty;
          const currency = product?.currency || 'TRY';
          const costAmount = product?.cost
            ? (product.cost / (product.ambalajDegeri || 1)) * totalTests
            : 0;
          return {
            stokKodu: entry.stokKodu,
            stokAdi: entry.stokAdi,
            lotNumarasi: entry.existingLots[0]?.lot ?? '',
            miad: entry.existingLots[0]?.miad ?? '',
            marka: entry.marka || null,
            expected: entry.existingTotal,
            counted,
            verifiedSerials: [],
            unscannedSerials: [],
            openTestQty,
            totalTests,
            costAmount,
            currency,
          } as any;
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
  }, [labId, labName, currentUserProfile, currentCompanyId, productEntries, productCodes, isSaving, countPeriod, countMonth, countYear, toast]);

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

          {!mobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <LabToolChip ico="barcode" label={scannerActive ? 'Okuyucu Aktif' : 'Barkod'} live={scannerActive} onClick={() => setScannerActive(value => !value)} />
              <LabToolChip ico="mic" label={voiceActive ? 'Mikrofon Aktif' : 'Sesli'} live={voiceActive} tone="red" onClick={toggleVoice} />
              <LabToolChip ico="download" label="Şablon" disabled={isExcelBusy} onClick={handleDownloadExcelTemplate} />
              <LabToolChip ico="excel" label="Excel" disabled={isExcelBusy} onClick={() => excelInputRef.current?.click()} />
              <LabToolChip ico="history" label="Sayım Geçmişi" onClick={() => router.push(`/laboratuvar/sayim/${labId}/history`)} />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 8 : 14, paddingLeft: mobile ? 3 : 12, borderLeft: mobile ? 'none' : '1px solid var(--line)' }}>
            {!mobile && (
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
          {mobile && (
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
                {activeProducts.map((product, index) => {
                  const entry = productEntries[product.stokKodu];
                  if (!entry) return null;
                  return (
                    <ClayProductCard
                      key={product.stokKodu}
                      product={product}
                      entry={entry}
                      isOutOfStock={entry.existingTotal === 0}
                      mobile={mobile}
                      index={index}
                      onEnteredChange={value => handleEnteredChange(product.stokKodu, value)}
                      onOpenTestChange={value => handleOpenTestChange(product.stokKodu, value)}
                      onConfirmExisting={() => handleConfirmExisting(product.stokKodu)}
                      onToggleCounted={() => handleToggleCounted(product.stokKodu)}
                    />
                  );
                })}
                {activeProducts.length === 0 && (
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

  return (
    <div ref={rootRef} className="ml-root min-h-screen" style={{ position: 'relative', paddingBottom: mobile ? 150 : 132 }}>
      <MlStyles />
      {/* TOP STATUS BAR */}
      <div className="sticky top-0 z-[var(--z-sticky)] bg-[var(--dashboard-bg)]/95 backdrop-blur-md border-b border-[var(--dashboard-stroke)]">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap">
          <button
            onClick={() => router.push('/laboratuvar-yonetimi')}
            className="shrink-0 flex items-center gap-2 text-sm text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Geri</span>
          </button>

          <div className="flex items-center gap-2">
            <TestTube className="w-4 h-4 text-[var(--dashboard-accent)]" />
            <span className="text-sm font-semibold text-[var(--dashboard-text)]">{labName}</span>
          </div>

          <div className="flex items-center gap-2 rounded-full bg-[var(--dashboard-surface)] px-3 py-1.5 border border-[var(--dashboard-stroke)]">
            <Label className="text-xs text-[var(--dashboard-muted)]">Dönem</Label>
            <select
              value={countMonth}
              onChange={(e) => setCountMonth(Number(e.target.value))}
              className="bg-transparent text-xs outline-none"
              disabled={isSaving || totalCounted > 0}
            >
              {countMonthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select
              value={countYear}
              onChange={(e) => setCountYear(Number(e.target.value))}
              className="bg-transparent text-xs outline-none"
              disabled={isSaving || totalCounted > 0}
            >
              {countYearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setScannerActive(prev => !prev)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all duration-200',
                scannerActive
                  ? 'bg-emerald-500 text-white shadow-md animate-pulse'
                  : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]',
              )}
            >
              <ScanBarcode className="w-4 h-4" />
              {scannerActive ? 'Okuyucu Aktif' : 'Barkod'}
            </button>

            {scanFeedback && (
              <span
                className={cn(
                  'text-xs font-medium px-2 py-1 rounded-lg animate-in fade-in slide-in-from-left-2',
                  scanFeedback.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : 'bg-red-500/10 text-red-600',
                )}
              >
                {scanFeedback.message}
              </span>
            )}
          </div>

          {/* Excel ile sayım */}
          <div className="flex items-center gap-1.5">
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="sr-only"
              onChange={(e) => handleExcelFileSelected(e.target.files?.[0])}
            />
            <button
              onClick={handleDownloadExcelTemplate}
              disabled={isExcelBusy}
              title="Sayım şablonunu Excel olarak indir"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExcelBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span className="hidden md:inline">Şablon İndir</span>
            </button>
            <button
              onClick={() => excelInputRef.current?.click()}
              disabled={isExcelBusy}
              title="Doldurulmuş Excel şablonunu yükleyerek sayım gir"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExcelBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              <span className="hidden md:inline">Excel ile Sayım</span>
            </button>
          </div>

          {/* Filter mode toggle */}
          <div className="flex items-center gap-1 ml-2 cihaz-pressed rounded-xl p-1">
            <button
              onClick={() => setFilterMode('marka')}
              className={cn(
                'px-3 py-1 rounded-lg text-xs font-semibold transition-colors',
                filterMode === 'marka'
                  ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                  : 'text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]',
              )}
            >
              Marka
            </button>
            <button
              onClick={() => setFilterMode('urunGrubu')}
              className={cn(
                'px-3 py-1 rounded-lg text-xs font-semibold transition-colors',
                filterMode === 'urunGrubu'
                  ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                  : 'text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]',
              )}
            >
              Ürün Grubu
            </button>
          </div>

          {/* Progress summary */}
          <div className="flex items-center gap-4 ml-auto text-xs text-[var(--dashboard-muted)]">
            <span>{totalCounted} / {totalProducts} ürün</span>
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-24 h-2 rounded-full bg-[var(--dashboard-surface-2)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--dashboard-accent)] transition-all duration-500"
                  style={{ width: `${overallPct}%` }}
                />
              </div>
              <span className="font-semibold text-[var(--dashboard-text)]">%{overallPct}</span>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR */}
        <aside
          className={cn(
            'shrink-0 border-r border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)] transition-all duration-300 flex flex-col',
            sidebarOpen ? 'w-[280px] sm:w-[320px]' : 'w-0 overflow-hidden',
          )}
        >
          <div className="px-4 py-3 border-b border-[var(--dashboard-stroke)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">
                {filterMode === 'marka' ? 'Markalar' : 'Ürün Grupları'}
              </span>
              <span className="text-xs text-[var(--dashboard-muted)]">
                {groupProgress.filter(g => g.status === 'completed').length} / {groupProgress.length}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="cihaz-pressed px-2 py-1.5 text-center rounded-lg">
                <div className="text-sm font-bold text-[var(--dashboard-text)]">{groupProgress.length}</div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Toplam</div>
              </div>
              <div className="cihaz-pressed px-2 py-1.5 text-center rounded-lg">
                <div className="text-sm font-bold text-emerald-500">
                  {groupProgress.filter(g => g.status === 'completed').length}
                </div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Tamam</div>
              </div>
              <div className="cihaz-pressed px-2 py-1.5 text-center rounded-lg">
                <div className="text-sm font-bold text-amber-500">
                  {groupProgress.length - groupProgress.filter(g => g.status === 'completed').length}
                </div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Bekleyen</div>
              </div>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {groupProgress.length === 0 ? (
                <div className="text-center py-6 text-xs text-[var(--dashboard-muted)]">
                  Bu laboratuvarda tanımlı ürün yok.
                </div>
              ) : (
                groupProgress.map(g => (
                  <SidebarChecklistItem
                    key={g.key}
                    label={filterLabel(g.key)}
                    group={g}
                    isActive={g.key === activeGroup}
                    onClick={() => setActiveGroup(g.key)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </aside>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="sm:hidden shrink-0 w-6 flex items-center justify-center border-r border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)] text-[var(--dashboard-muted)]"
        >
          {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* RIGHT PANEL */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {activeGroup ? (
            <>
              {/* Group header */}
              <div className="px-4 sm:px-6 py-4 border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)]">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-lg font-bold text-[var(--dashboard-text)]">{filterLabel(activeGroup)}</h2>
                    <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">
                      {activeGroupProgress?.total ?? 0} ürün
                      {' · '}
                      <span className="text-emerald-500">{activeGroupProgress?.completed ?? 0} tamamlandı</span>
                      {' · '}
                      <span className="text-amber-500">
                        {(activeGroupProgress?.total ?? 0) - (activeGroupProgress?.completed ?? 0)} bekliyor
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 rounded-full bg-[var(--dashboard-surface-2)] overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          activePct === 100 ? 'bg-emerald-500' : 'bg-[var(--dashboard-accent)]',
                        )}
                        style={{ width: `${activePct}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-[var(--dashboard-text)]">%{activePct}</span>
                  </div>
                </div>

                {/* Search + filters */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <div className="relative flex-1 min-w-[120px] max-w-[280px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dashboard-muted)]" />
                    <Input
                      type="text"
                      placeholder="Ürün ara..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9 text-sm"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant={showOnlyUncounted ? 'default' : 'outline'}
                    onClick={() => setShowOnlyUncounted(v => !v)}
                    className="h-9 text-xs"
                  >
                    Sadece Sayılmayanlar
                  </Button>

                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCompleteGroup}
                      className="h-9 text-xs"
                    >
                      <Check className="w-3.5 h-3.5 mr-1" />
                      Grubu Tamamla
                    </Button>
                  </div>
                </div>
              </div>

              {/* Product list */}
              <ScrollArea className="flex-1">
                <div className="cihaz-card-strong m-4 sm:m-6 overflow-hidden">
                  {activeProducts.length > 0 ? (
                    activeProducts.map(product => {
                      const entry = productEntries[product.stokKodu];
                      if (!entry) return null;
                      const isOutOfStock = entry.existingTotal === 0;
                      return (
                        <ProductRow
                          key={product.stokKodu}
                          product={product}
                          entry={entry}
                          isOutOfStock={isOutOfStock}
                          onEnteredChange={(val) => handleEnteredChange(product.stokKodu, val)}
                          onConfirmExisting={() => handleConfirmExisting(product.stokKodu)}
                          onToggleCounted={() => handleToggleCounted(product.stokKodu)}
                        />
                      );
                    })
                  ) : (
                    <div className="text-center py-12 text-sm text-[var(--dashboard-muted)]">
                      {searchQuery ? 'Aramayla eşleşen ürün bulunamadı.' : 'Bu grupta ürün bulunamadı.'}
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Bottom action bar */}
              <div className="sticky bottom-0 z-[var(--z-sticky)] border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)]/95 backdrop-blur-md px-4 sm:px-6 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-[var(--dashboard-muted)]">
                    <span className="font-medium text-[var(--dashboard-text)]">
                      {activeGroupProgress?.completed ?? 0}
                    </span>{' '}
                    / {activeGroupProgress?.total ?? 0} ürün sayıldı
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={isSaving || totalCounted === 0}
                      className="h-9 text-xs"
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                      Sayımı Kaydet
                    </Button>

                    {activePct === 100 && groupProgress.some(g => g.status !== 'completed') && (
                      <Button size="sm" variant="outline" onClick={handleNextGroup} className="h-9 text-xs">
                        Sonraki
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[var(--dashboard-muted)]">
              {filterMode === 'marka' ? 'Sol panelden bir marka seçin' : 'Sol panelden bir ürün grubu seçin'}
            </div>
          )}
        </main>
      </div>

      <Dialog open={!!uploadFlow} onOpenChange={(open) => { if (!open && !isUploadingCalcFile) skipUploadStep(); }}>
        <DialogContent className="max-w-2xl rounded-3xl p-0 overflow-hidden">
          <div className="bg-gradient-to-br from-sky-500 via-cyan-500 to-blue-600 px-6 py-5 text-white">
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl font-bold">Sayım Dosyalarını Yükle</DialogTitle>
              <DialogDescription className="text-white/85">
                {labName} — {countPeriod}. Dosyaları şimdi yükleyebilir veya bu adımı geçip sayım geçmişinden daha sonra tamamlayabilirsiniz.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="grid gap-5 p-6 md:grid-cols-[1.1fr_0.9fr]">
            <label className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50/60 p-6 text-center transition hover:bg-sky-50">
              <UploadCloud className="mb-3 h-10 w-10 text-sky-500" />
              <span className="text-sm font-semibold text-slate-800">Dosyaları seç veya buraya bırak</span>
              <span className="mt-1 text-xs text-slate-500">PDF, TXT ve CSV dosyaları desteklenir.</span>
              <Input
                type="file"
                multiple
                accept=".pdf,.txt,.csv,application/pdf,text/*"
                className="sr-only"
                onChange={(event) => setModalFiles(Array.from(event.target.files || []))}
              />
            </label>

            <div className="space-y-4">
              <div className="rounded-2xl border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Akış</p>
                <div className="mt-3 space-y-3">
                  {[
                    { key: 'cihazUstu', label: '1. Cihaz üstü dosyası' },
                    { key: 'kumulatif', label: '2. Kümülatif dosyası' },
                  ].map((step) => {
                    const active = uploadFlow?.step === step.key;
                    return (
                      <div key={step.key} className="flex items-center gap-3">
                        <span className={cn('h-3 w-3 rounded-full', active ? 'bg-sky-500 ring-4 ring-sky-100' : 'bg-slate-300')} />
                        <span className={cn('text-sm', active ? 'font-semibold text-slate-900' : 'text-muted-foreground')}>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-sm font-semibold">Seçilen dosyalar</p>
                {modalFiles.length > 0 ? (
                  <div className="mt-3 max-h-36 space-y-2 overflow-y-auto pr-1">
                    {modalFiles.map((file) => (
                      <div key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                        <span className="flex min-w-0 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-sky-500" />
                          <span className="truncate">{file.name}</span>
                        </span>
                        <span className="shrink-0 text-muted-foreground">{Math.ceil(file.size / 1024)} KB</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">Henüz dosya seçilmedi.</p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 border-t bg-muted/20 px-6 py-4">
            <Button variant="outline" onClick={skipUploadStep} disabled={isUploadingCalcFile}>
              {uploadFlow?.step === 'cihazUstu' ? 'Atla ve İleri' : 'Atla ve Bitir'}
            </Button>
            <Button onClick={handleCalculationFileUpload} disabled={isUploadingCalcFile || modalFiles.length === 0}>
              {isUploadingCalcFile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {uploadFlow?.step === 'cihazUstu' ? 'Yükle ve İleri' : 'Yükle ve Bitir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
