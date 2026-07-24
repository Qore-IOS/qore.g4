'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MinMaxRule } from '@/lib/types';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  EllipsisVertical,
  FilePlus2,
  FileSpreadsheet,
  FlaskConical,
  Package,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import BekleyenIrsaliyelerPanel from '@/components/lab/BekleyenIrsaliyelerPanel';
import {
  MlIconBtn,
  MlPill,
  MlStyles,
  useContainerMode,
} from '@/components/maliyet/ml-primitives';

export interface ClayStockRow {
  groupKey: string;
  stokKodu: string;
  stokAdi: string;
  lot: string;
  miad: string;
  quantity: number;
  anaBirim: string;
  firstId: string;
}

export interface ClayWarningRow extends ClayStockRow {
  warningReasons: string[];
  totalForStokKodu: number;
  miadDays: number;
  minStock: number | null;
  maxStock: number | null;
}

interface LaboratoryOption {
  id: string;
  name: string;
}

interface ClayLaboratoryManagementViewProps {
  laboratories: LaboratoryOption[];
  selectedLabId: string;
  selectedLabName: string;
  onSelectLab: (id: string) => void;
  isLoading: boolean;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  rows: ClayStockRow[];
  allRows: ClayStockRow[];
  warnings: ClayWarningRow[];
  selectedWarnings: Set<string>;
  onToggleWarning: (groupKey: string) => void;
  onToggleWarningCategory: (groupKeys: string[], checked: boolean) => void;
  onDeleteSelectedWarnings: () => void;
  isDeletingWarning: boolean;
  minMaxRules: Record<string, MinMaxRule>;
  lotTrackedStockCodes: Set<string>;
  currentPage: number;
  pageCount: number;
  rowsPerPage: number;
  totalFilteredRows: number;
  onCurrentPageChange: (page: number) => void;
  onRowsPerPageChange: (count: number) => void;
  onStartCount: () => void;
  onExport: () => void;
  onImportFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isParsingExcel: boolean;
  isAdmin: boolean;
  editingGroupKey: string | null;
  editQuantity: number;
  onEditQuantityChange: (value: number) => void;
  onStartEdit: (row: ClayStockRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (groupKey: string) => void;
  onDeleteGroup: (groupKey: string) => void;
  deletingGroupKey: string | null;
  onOpenDetail: (id: string) => void;
}

type WarningCategory = {
  id: 'miad' | 'critical' | 'single';
  title: string;
  rows: ClayWarningRow[];
  color: string;
  background: string;
};

const clayButtonStyle: React.CSSProperties = {
  all: 'unset',
  boxSizing: 'border-box',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 'var(--radius-pill)',
  color: 'var(--ink-2)',
  fontSize: 13.5,
  fontWeight: 800,
  whiteSpace: 'nowrap',
  background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))',
  boxShadow: 'var(--clay)',
};

function getMiadStatus(miad: string) {
  if (!miad) return { days: Number.POSITIVE_INFINITY, label: 'Miad yok', color: 'var(--ink-3)' };
  const [day, month, year] = miad.split('.').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  if (!Number.isFinite(date.getTime())) {
    return { days: Number.POSITIVE_INFINITY, label: miad, color: 'var(--ink-3)' };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { days, label: 'Süresi dolmuş', color: 'var(--danger)' };
  if (days <= 30) return { days, label: `${days} gün kaldı`, color: 'var(--danger)' };
  if (days < 45) return { days, label: `${days} gün kaldı`, color: 'var(--amber)' };
  if (days < 60) return { days, label: `${days} gün kaldı`, color: '#DDAF67' };
  return { days, label: `${days} gün kaldı`, color: 'var(--water-deep)' };
}

function getCoverage(
  row: ClayStockRow,
  minMaxRules: Record<string, MinMaxRule>,
  lotTrackedStockCodes: Set<string>,
  allRows: ClayStockRow[],
) {
  const rule = minMaxRules[row.stokKodu];
  const min = Number(rule?.min ?? 0);
  const max = Number(rule?.max ?? 0);
  const maxGun = Number(rule?.maxGun ?? 0);
  const quantity = lotTrackedStockCodes.has(row.stokKodu)
    ? row.quantity
    : allRows.reduce((sum, item) => item.stokKodu === row.stokKodu ? sum + item.quantity : sum, 0);
  if (!max || Math.floor(maxGun) <= 0) {
    return { label: 'Tanımsız', days: null as number | null, min, max, riskyBoxes: 0, tone: 'muted' as const };
  }
  const dailyNeed = max / Math.floor(maxGun);
  const days = Math.max(0, Math.floor(quantity / dailyNeed));
  const miad = getMiadStatus(row.miad);
  const riskyBoxes =
    Number.isFinite(miad.days) && miad.days > 0 && days > miad.days
      ? Math.max(0, Math.ceil((days - miad.days) * dailyNeed))
      : 0;
  return {
    label: `${days} gün yeter`,
    days,
    min,
    max,
    riskyBoxes,
    tone: days <= 3 ? 'danger' as const : days <= 10 ? 'amber' as const : 'good' as const,
  };
}

function formatQuantity(row: ClayStockRow) {
  const unit = row.anaBirim || 'Adet';
  return `${row.quantity.toLocaleString('tr-TR')} ${unit}`;
}

export default function ClayLaboratoryManagementView(props: ClayLaboratoryManagementViewProps) {
  const {
    laboratories,
    selectedLabId,
    selectedLabName,
    onSelectLab,
    isLoading,
    searchQuery,
    onSearchQueryChange,
    rows,
    allRows,
    warnings,
    selectedWarnings,
    onToggleWarning,
    onToggleWarningCategory,
    onDeleteSelectedWarnings,
    isDeletingWarning,
    minMaxRules,
    lotTrackedStockCodes,
    currentPage,
    pageCount,
    rowsPerPage,
    totalFilteredRows,
    onCurrentPageChange,
    onRowsPerPageChange,
    onStartCount,
    onExport,
    onImportFile,
    isParsingExcel,
    isAdmin,
    editingGroupKey,
    editQuantity,
    onEditQuantityChange,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onDeleteGroup,
    deletingGroupKey,
    onOpenDetail,
  } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const mode = useContainerMode(rootRef as React.RefObject<HTMLElement>);
  const mobile = mode === 'mobile';
  const tablet = mode === 'tablet';
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [warningCategory, setWarningCategory] = useState<string>('miad');
  const selectorRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const excelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!selectorRef.current?.contains(target)) setSelectorOpen(false);
      if (!actionsRef.current?.contains(target)) {
        setWarningsOpen(false);
      }
      if (!excelRef.current?.contains(target)) setExcelOpen(false);
      if (!(target instanceof Element) || !target.closest('[data-row-menu-root]')) {
        setRowMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRowMenu(null);
    };
    document.addEventListener('mousedown', closeMenus);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenus);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    setRowMenu(null);
  }, [selectedLabId]);

  const warningCategories = useMemo<WarningCategory[]>(() => {
    const miadRows = warnings.filter(row =>
      row.warningReasons.some(reason => reason.toLocaleLowerCase('tr').includes('miad')),
    );
    const criticalRows = warnings.filter(row =>
      row.warningReasons.some(reason => reason.toLocaleLowerCase('tr').includes('minimum')),
    );
    const singleRows = warnings.filter(row =>
      row.warningReasons.some(reason => reason.includes('1 adet')),
    );
    return [
      { id: 'miad', title: 'Miad Uyarıları', rows: miadRows, color: 'var(--danger)', background: 'rgba(192,121,106,0.09)' },
      { id: 'critical', title: 'Kritik Stok Uyarıları', rows: criticalRows, color: 'var(--accent)', background: 'rgba(201,138,87,0.09)' },
      { id: 'single', title: 'Tek Kalan Ürünler', rows: singleRows, color: '#B58A39', background: 'rgba(224,163,62,0.09)' },
    ];
  }, [warnings]);

  const selectedCategory =
    warningCategories.find(category => category.id === warningCategory) ?? warningCategories[0];

  useEffect(() => {
    if (selectedCategory?.rows.length) return;
    const firstNonEmpty = warningCategories.find(category => category.rows.length > 0);
    if (firstNonEmpty && firstNonEmpty.id !== warningCategory) {
      setWarningCategory(firstNonEmpty.id);
    }
  }, [selectedCategory, warningCategories, warningCategory]);

  const labSelector = (
    <div
      ref={selectorRef}
      style={{
        position: 'relative',
        width: selectedLabId ? (mobile ? '100%' : 'fit-content') : (mobile ? '100%' : 'min(420px, 100%)'),
        maxWidth: '100%',
      }}
    >
      <button
        type="button"
        onClick={() => setSelectorOpen(open => !open)}
        aria-expanded={selectorOpen}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          width: selectedLabId ? 'auto' : '100%',
          maxWidth: '100%',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: selectedLabId ? 10 : 13,
          minHeight: selectedLabId ? 46 : (mobile ? 54 : 58),
          padding: selectedLabId ? 0 : '0 18px',
          borderRadius: selectedLabId ? 0 : 'var(--radius)',
          color: selectedLabId ? 'var(--ink-1)' : 'var(--ink-2)',
          fontSize: selectedLabId ? (mobile ? 27 : 35) : (mobile ? 15 : 16),
          lineHeight: selectedLabId ? 1.06 : undefined,
          letterSpacing: selectedLabId ? '-0.04em' : undefined,
          textTransform: selectedLabId ? 'uppercase' : undefined,
          fontWeight: selectedLabId ? 850 : 800,
          background: selectedLabId ? 'transparent' : 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))',
          boxShadow: selectedLabId ? 'none' : (selectorOpen ? 'var(--clay-press)' : 'var(--clay)'),
        }}
      >
        {!selectedLabId && <span style={{ color: 'var(--accent)', display: 'inline-flex' }}><FlaskConical size={20} /></span>}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
          {selectedLabName || 'Bir laboratuvar seçin'}
        </span>
        <span style={{
          width: selectedLabId ? 42 : 'auto',
          height: selectedLabId ? 42 : 'auto',
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          borderRadius: selectedLabId ? 14 : 0,
          color: 'var(--accent)',
          background: selectedLabId ? 'var(--surface-2)' : 'transparent',
          boxShadow: selectedLabId ? 'var(--clay-inset)' : 'none',
        }}>
          <ChevronDown size={18} style={{ transform: selectorOpen ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }} />
        </span>
      </button>

      {selectorOpen && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 80,
            top: 'calc(100% + 10px)',
            left: 0,
            right: selectedLabId ? 'auto' : 0,
            width: selectedLabId ? 'min(420px, calc(100vw - 32px))' : undefined,
            maxHeight: 'min(340px, 60vh)',
            overflowY: 'auto',
            padding: 8,
            borderRadius: 'var(--radius)',
            background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))',
            boxShadow: '0 28px 58px -24px rgba(90,72,40,0.52), var(--clay)',
            animation: 'mlModalPop 220ms var(--ease-fluid)',
          }}
        >
          {laboratories.map(lab => (
            <button
              type="button"
              role="option"
              aria-selected={lab.id === selectedLabId}
              key={lab.id}
              onClick={() => {
                onSelectLab(lab.id);
                setSelectorOpen(false);
              }}
              style={{
                all: 'unset',
                boxSizing: 'border-box',
                width: '100%',
                minHeight: 50,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                color: lab.id === selectedLabId ? 'var(--accent)' : 'var(--ink-1)',
                background: lab.id === selectedLabId ? 'rgba(201,138,87,0.10)' : 'transparent',
                fontSize: 14.5,
                fontWeight: 750,
              }}
            >
              <FlaskConical size={18} />
              <span style={{ flex: 1 }}>{lab.name}</span>
              {lab.id === selectedLabId && <Check size={17} />}
            </button>
          ))}
          {!isLoading && laboratories.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5, fontWeight: 700 }}>
              Erişebileceğiniz laboratuvar bulunmuyor.
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (!selectedLabId) {
    return (
      <div ref={rootRef} className="ml-root" style={{ minHeight: 'calc(100vh - 72px)', padding: mobile ? 20 : 'clamp(28px, 4vw, 58px)' }}>
        <MlStyles />
        <div style={{ width: 'min(1240px, 100%)', margin: '0 auto' }}>
          <div style={{ width: mobile ? '100%' : 'min(420px, 44vw)', minWidth: mobile ? 0 : 360 }}>
            <h1 style={{ margin: 0, color: 'var(--ink-1)', fontSize: mobile ? 30 : 38, lineHeight: 1.08, fontWeight: 850, letterSpacing: '-0.035em' }}>
              Laboratuvar Seçin
            </h1>
            <p style={{ margin: '7px 0 16px', color: 'var(--ink-2)', fontSize: 15, fontWeight: 600 }}>
              Başlamak için bir laboratuvar seçin
            </p>
            {labSelector}
          </div>
          <div style={{
            marginTop: mobile ? 72 : 82,
            marginLeft: mobile ? 0 : '36%',
            color: 'var(--ink-3)',
            fontSize: mobile ? 15 : 17,
            fontWeight: 750,
            textAlign: mobile ? 'center' : 'left',
          }}>
            Stokları görmek için yukarıdan bir laboratuvar seçin.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="ml-root" style={{ minHeight: 'calc(100vh - 72px)', padding: mobile ? '14px 12px 90px' : '22px 26px 80px' }}>
      <MlStyles />
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="sr-only"
        onChange={onImportFile}
      />

      <div style={{ width: 'min(1240px, 100%)', margin: '0 auto' }}>
        <section style={{ display: 'flex', gap: 18, alignItems: (mobile || tablet) ? 'stretch' : 'flex-start', flexDirection: (mobile || tablet) ? 'column' : 'row', marginBottom: 18 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {labSelector}
            <p style={{ margin: '7px 0 0', color: 'var(--ink-2)', fontSize: 13.5, fontWeight: 650 }}>
              {totalFilteredRows.toLocaleString('tr-TR')} kayıt · değiştirmek için satıra dokunun
            </p>
          </div>

          <div
            ref={actionsRef}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: (mobile || tablet) ? 'stretch' : 'flex-end',
              gap: 9,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={onStartCount}
              style={{
                ...clayButtonStyle,
                flex: (mobile || tablet) ? '1 1 160px' : undefined,
                color: '#fff',
                background: 'linear-gradient(180deg, var(--accent-2), var(--accent))',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 22px -11px var(--accent-glow)',
              }}
            >
              <ClipboardCheck size={17} /> Sayım Başlat
            </button>

            <BekleyenIrsaliyelerPanel
              locationType="hospital"
              locationId={selectedLabId}
              locationName={selectedLabName}
              presentation="clay-trigger"
            />

            <button
              type="button"
              onClick={() => {
                setWarningsOpen(open => !open);
                setExcelOpen(false);
              }}
              aria-expanded={warningsOpen}
              style={{
                ...clayButtonStyle,
                flex: (mobile || tablet) ? '1 1 160px' : undefined,
                color: warnings.length ? 'var(--danger)' : 'var(--ink-2)',
                background: warnings.length
                  ? 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(192,121,106,0.12))'
                  : 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))',
                boxShadow: warningsOpen ? 'var(--clay-press)' : 'var(--clay)',
              }}
            >
              <AlertTriangle size={17} />
              Stok Uyarıları
              <span style={{ minWidth: 26, height: 26, padding: '0 7px', display: 'grid', placeItems: 'center', borderRadius: 999, color: '#fff', background: warnings.length ? 'var(--danger)' : 'var(--ink-3)', fontSize: 12 }}>
                {warnings.length}
              </span>
            </button>

            {warningsOpen && (
              <div style={{
                position: mobile ? 'fixed' : 'absolute',
                zIndex: 120,
                top: mobile ? 12 : 'calc(100% + 12px)',
                right: mobile ? 12 : 0,
                left: mobile ? 12 : 'auto',
                width: mobile ? 'auto' : 'min(460px, calc(100vw - 48px))',
                maxHeight: mobile ? 'calc(100vh - 24px)' : 'min(70vh, calc(100vh - 160px))',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 'var(--radius-lg)',
                background: 'linear-gradient(180deg, var(--surface), var(--surface-2))',
                boxShadow: '0 40px 80px -30px rgba(90,72,40,0.65), var(--clay)',
                overflow: 'hidden',
                animation: 'mlModalPop 250ms var(--ease-fluid)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 13, color: 'var(--danger)', background: 'rgba(192,121,106,0.12)' }}>
                    <AlertTriangle size={20} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 850 }}>Stok Uyarıları</div>
                    <div style={{ marginTop: 2, fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 600 }}>{warnings.length} kayıt dikkat gerektiriyor</div>
                  </div>
                  <MlIconBtn size={38} ariaLabel="Uyarıları kapat" onClick={() => setWarningsOpen(false)}><X size={17} /></MlIconBtn>
                </div>

                <div style={{ padding: '14px 14px 0', display: 'flex', gap: 8, overflowX: 'auto' }}>
                  {warningCategories.map(category => (
                    <button
                      type="button"
                      key={category.id}
                      onClick={() => setWarningCategory(category.id)}
                      style={{
                        ...clayButtonStyle,
                        minHeight: 38,
                        padding: '0 12px',
                        fontSize: 12,
                        color: warningCategory === category.id ? category.color : 'var(--ink-2)',
                        background: warningCategory === category.id ? category.background : 'var(--surface-2)',
                        boxShadow: warningCategory === category.id ? `inset 0 0 0 1.5px color-mix(in srgb, ${category.color} 34%, transparent)` : 'var(--clay-inset)',
                      }}
                    >
                      {category.title} ({category.rows.length})
                    </button>
                  ))}
                </div>

                <div style={{ overflowY: 'auto', padding: 14, flex: 1 }}>
                  {selectedCategory.rows.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {selectedCategory.rows.map(row => {
                        const checked = selectedWarnings.has(row.groupKey);
                        return (
                          <button
                            type="button"
                            key={row.groupKey}
                            onClick={() => onToggleWarning(row.groupKey)}
                            style={{
                              all: 'unset',
                              boxSizing: 'border-box',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 12,
                              padding: '14px 15px',
                              borderRadius: 'var(--radius)',
                              background: 'var(--surface-hi)',
                              boxShadow: checked ? `inset 0 0 0 2px color-mix(in srgb, ${selectedCategory.color} 40%, transparent), var(--clay-flat)` : 'var(--clay-flat)',
                            }}
                          >
                            <span style={{
                              width: 22,
                              height: 22,
                              flexShrink: 0,
                              display: 'grid',
                              placeItems: 'center',
                              borderRadius: 999,
                              color: checked ? '#fff' : selectedCategory.color,
                              border: checked ? 'none' : `2px solid color-mix(in srgb, ${selectedCategory.color} 54%, transparent)`,
                              background: checked ? selectedCategory.color : 'transparent',
                            }}>
                              {checked && <Check size={14} strokeWidth={3} />}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                              <span style={{ display: 'block', fontSize: 14.5, color: 'var(--ink-1)', fontWeight: 850 }}>{row.stokAdi}</span>
                              <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: 'var(--ink-3)', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
                                {row.stokKodu} · Lot {row.lot || '—'} · Miad {row.miad || '—'}
                              </span>
                              <span style={{ display: 'block', marginTop: 7, color: selectedCategory.color, fontSize: 12, fontWeight: 750, lineHeight: 1.45, whiteSpace: 'pre-line' }}>
                                {row.warningReasons.map(reason => `• ${reason}`).join('\n')}
                              </span>
                            </span>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
                              <MlPill>Bu lot: {row.quantity}</MlPill>
                              <MlPill>Toplam: {row.totalForStokKodu}</MlPill>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ padding: 36, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5, fontWeight: 700 }}>
                      Bu kategoride uyarı bulunmuyor.
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 16px', borderTop: '1px solid var(--line)', flexWrap: mobile ? 'wrap' : 'nowrap' }}>
                  <button
                    type="button"
                    onClick={() => onToggleWarningCategory(
                      selectedCategory.rows.map(row => row.groupKey),
                      !selectedCategory.rows.every(row => selectedWarnings.has(row.groupKey)),
                    )}
                    style={{ ...clayButtonStyle, minHeight: 40, padding: '0 13px', fontSize: 12.5, flex: mobile ? '1 1 150px' : undefined }}
                  >
                    <Check size={15} /> Tümünü Seç
                  </button>
                  <button
                    type="button"
                    onClick={onDeleteSelectedWarnings}
                    disabled={selectedWarnings.size === 0 || isDeletingWarning}
                    style={{
                      ...clayButtonStyle,
                      minHeight: 40,
                      padding: '0 13px',
                      fontSize: 12.5,
                      cursor: selectedWarnings.size === 0 ? 'not-allowed' : 'pointer',
                      opacity: selectedWarnings.size === 0 ? 0.5 : 1,
                      color: selectedWarnings.size ? '#fff' : 'var(--ink-3)',
                      background: selectedWarnings.size ? 'linear-gradient(180deg, #D58C7D, var(--danger))' : 'var(--surface-2)',
                      flex: mobile ? '1 1 150px' : undefined,
                    }}
                  >
                    <Trash2 size={15} /> Seçilenleri Sil ({selectedWarnings.size})
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: mobile ? 'wrap' : 'nowrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: mobile ? '100%' : 250 }}>
            <Search size={18} style={{ position: 'absolute', zIndex: 1, left: 17, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
            <input
              type="search"
              value={searchQuery}
              onChange={event => onSearchQueryChange(event.target.value)}
              placeholder="Stok Kodu, Adı, Lot, Miad veya Seri No"
              style={{
                width: '100%',
                height: 54,
                padding: '0 18px 0 48px',
                border: 'none',
                borderRadius: 'var(--radius-pill)',
                outline: 'none',
                color: 'var(--ink-1)',
                background: 'var(--surface-hi)',
                boxShadow: 'var(--clay-inset)',
                font: '600 14.5px inherit',
              }}
            />
          </div>
        </section>

        <section style={{ borderRadius: 'var(--radius-lg)', overflow: 'visible', background: 'linear-gradient(180deg, var(--surface), var(--surface-2))', boxShadow: 'var(--clay)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: mobile ? '15px 16px' : '18px 24px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220, color: 'var(--ink-2)', fontSize: 13, fontWeight: 750 }}>
              {selectedLabName} · Toplam: <strong style={{ color: 'var(--ink-1)' }}>{totalFilteredRows.toLocaleString('tr-TR')} kayıt</strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, color: 'var(--ink-2)', fontSize: 11.5, fontWeight: 750 }}>
              <span><i style={{ display: 'inline-block', width: 10, height: 10, marginRight: 5, borderRadius: 99, background: 'var(--danger)' }} />&lt;30 gün</span>
              <span><i style={{ display: 'inline-block', width: 10, height: 10, marginRight: 5, borderRadius: 99, background: 'var(--amber)' }} />&lt;45 gün</span>
              <span><i style={{ display: 'inline-block', width: 10, height: 10, marginRight: 5, borderRadius: 99, background: '#DDAF67' }} />&lt;60 gün</span>
            </div>
            <div ref={excelRef} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setExcelOpen(open => !open)}
                style={{ ...clayButtonStyle, height: 46, color: 'var(--ink-1)' }}
              >
                <FileSpreadsheet size={17} /> Excel <ChevronDown size={15} />
              </button>
              {excelOpen && (
                <div style={{
                  position: 'absolute',
                  zIndex: 90,
                  top: 'calc(100% + 9px)',
                  right: 0,
                  width: 220,
                  padding: 8,
                  borderRadius: 'var(--radius-sm)',
                  background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))',
                  boxShadow: '0 26px 50px -24px rgba(90,72,40,0.58), var(--clay)',
                  animation: 'mlModalPop 200ms var(--ease-fluid)',
                }}>
                  <button type="button" onClick={() => { onExport(); setExcelOpen(false); }} style={{ ...clayButtonStyle, width: '100%', justifyContent: 'flex-start', borderRadius: 'var(--radius-sm)', boxShadow: 'none', background: 'transparent' }}>
                    <Download size={17} color="var(--accent)" /> Excel’e Aktar
                  </button>
                  <button type="button" onClick={() => { fileInputRef.current?.click(); setExcelOpen(false); }} style={{ ...clayButtonStyle, width: '100%', justifyContent: 'flex-start', borderRadius: 'var(--radius-sm)', boxShadow: 'none', background: 'transparent' }}>
                    <FilePlus2 size={17} color="var(--accent)" /> Excel ile Stok Ekle
                  </button>
                </div>
              )}
            </div>
          </div>

          {isLoading || isParsingExcel ? (
            <div style={{ minHeight: 300, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 12, fontWeight: 850, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              Yükleniyor
            </div>
          ) : rows.length === 0 ? (
            <div style={{ minHeight: 300, display: 'grid', placeItems: 'center', padding: 30, textAlign: 'center' }}>
              <div>
                <span style={{ width: 70, height: 70, display: 'grid', placeItems: 'center', margin: '0 auto 14px', borderRadius: 24, color: 'var(--ink-3)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}>
                  <Package size={31} />
                </span>
                <div style={{ color: 'var(--ink-1)', fontSize: 15, fontWeight: 850 }}>Stok kaydı bulunamadı</div>
                <div style={{ marginTop: 5, color: 'var(--ink-3)', fontSize: 13, fontWeight: 600 }}>
                  {searchQuery ? 'Arama ölçütlerinizi değiştirin.' : 'Bu laboratuvar için henüz stok eklenmemiş.'}
                </div>
              </div>
            </div>
          ) : mobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11, padding: 12 }}>
              {rows.map(row => {
                const miad = getMiadStatus(row.miad);
                const coverage = getCoverage(row, minMaxRules, lotTrackedStockCodes, allRows);
                const editing = editingGroupKey === row.groupKey;
                return (
                  <article key={row.groupKey} onClick={() => row.firstId && onOpenDetail(row.firstId)} style={{ position: 'relative', padding: 16, borderRadius: 'var(--radius)', background: 'var(--surface-hi)', boxShadow: 'var(--clay-flat)', cursor: row.firstId ? 'pointer' : 'default' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ width: 10, height: 10, marginTop: 6, flexShrink: 0, borderRadius: 99, background: miad.color }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 850, lineHeight: 1.3 }}>{row.stokAdi}</div>
                        <div style={{ marginTop: 3, color: 'var(--ink-3)', font: '700 11px ui-monospace, monospace' }}>{row.stokKodu} · Lot {row.lot || '—'}</div>
                      </div>
                      <MlPill>{formatQuantity(row)}</MlPill>
                      <div data-row-menu-root style={{ position: 'relative' }}>
                        <MlIconBtn
                          size={38}
                          ariaLabel="İşlem menüsü"
                          onClick={(event: React.MouseEvent) => {
                            event.stopPropagation();
                            setRowMenu(rowMenu === row.groupKey ? null : row.groupKey);
                          }}
                        >
                          <EllipsisVertical size={17} />
                        </MlIconBtn>
                        {rowMenu === row.groupKey && (
                          <div
                            onClick={event => event.stopPropagation()}
                            style={{ position: 'absolute', zIndex: 70, top: 46, right: 0, width: 188, padding: 7, borderRadius: 'var(--radius)', textAlign: 'left', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: '0 24px 48px -24px rgba(90,72,40,0.58), var(--clay)' }}
                          >
                            <button type="button" onClick={() => { row.firstId && onOpenDetail(row.firstId); setRowMenu(null); }} style={{ ...clayButtonStyle, width: '100%', minHeight: 40, justifyContent: 'flex-start', borderRadius: 13, boxShadow: 'none', background: 'transparent', fontSize: 12.5 }}>
                              <ChevronRight size={15} /> Detayı Aç
                            </button>
                            {isAdmin && (
                              <button type="button" onClick={() => { onStartEdit(row); setRowMenu(null); }} style={{ ...clayButtonStyle, width: '100%', minHeight: 40, justifyContent: 'flex-start', borderRadius: 13, boxShadow: 'none', background: 'transparent', fontSize: 12.5 }}>
                                <Pencil size={15} /> Adedi Düzenle
                              </button>
                            )}
                            <button type="button" onClick={() => { onDeleteGroup(row.groupKey); setRowMenu(null); }} disabled={deletingGroupKey === row.groupKey} style={{ ...clayButtonStyle, width: '100%', minHeight: 40, justifyContent: 'flex-start', borderRadius: 13, boxShadow: 'none', background: 'transparent', color: 'var(--danger)', fontSize: 12.5 }}>
                              <Trash2 size={15} /> Kaydı Sil
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {editing && (
                      <div
                        onClick={event => event.stopPropagation()}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, padding: 9, borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}
                      >
                        <span style={{ color: 'var(--ink-2)', fontSize: 11.5, fontWeight: 800 }}>Yeni adet</span>
                        <input
                          type="number"
                          min={0}
                          value={editQuantity}
                          onChange={event => onEditQuantityChange(Math.max(0, Number(event.target.value) || 0))}
                          style={{ width: 76, height: 36, marginLeft: 'auto', border: 'none', borderRadius: 12, outline: 'none', textAlign: 'center', color: 'var(--ink-1)', background: 'var(--surface-hi)', boxShadow: 'var(--clay-inset)', font: '800 13px inherit' }}
                        />
                        <MlIconBtn size={36} ariaLabel="Kaydet" onClick={() => onSaveEdit(row.groupKey)}><Check size={16} color="var(--water-deep)" /></MlIconBtn>
                        <MlIconBtn size={36} ariaLabel="İptal" onClick={onCancelEdit}><X size={16} /></MlIconBtn>
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginTop: 12 }}>
                      <div style={{ padding: 10, borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}>
                        <div style={{ color: 'var(--ink-3)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}>Miad</div>
                        <div style={{ marginTop: 3, fontSize: 13, fontWeight: 850 }}>{row.miad || '—'}</div>
                        <div style={{ marginTop: 2, color: miad.color, fontSize: 11, fontWeight: 750 }}>{miad.label}</div>
                      </div>
                      <div style={{ padding: 10, borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}>
                        <div style={{ color: 'var(--ink-3)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}>Yeterlilik</div>
                        <div style={{ marginTop: 3, color: coverage.tone === 'danger' ? 'var(--danger)' : coverage.tone === 'amber' ? 'var(--amber)' : coverage.tone === 'good' ? 'var(--water-deep)' : 'var(--ink-2)', fontSize: 12, fontWeight: 850 }}>{coverage.label}</div>
                        <div style={{ marginTop: 2, color: 'var(--ink-3)', fontSize: 10.5, fontWeight: 650 }}>Min: {coverage.min || '—'} / Max: {coverage.max || '—'}</div>
                        {coverage.riskyBoxes > 0 && <div style={{ marginTop: 3, color: 'var(--danger)', fontSize: 10.5, fontWeight: 750 }}>{coverage.riskyBoxes} kutu riskli</div>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: tablet ? 900 : 1080, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--ink-3)', fontSize: 10.5, fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.045em' }}>
                    <th style={{ width: 48, padding: '14px 8px' }} />
                    <th style={{ padding: '14px 12px', textAlign: 'left' }}>Stok Kodu</th>
                    <th style={{ padding: '14px 12px', textAlign: 'left' }}>Stok Adı</th>
                    <th style={{ padding: '14px 12px', textAlign: 'left' }}>Lot</th>
                    <th style={{ padding: '14px 12px', textAlign: 'left' }}>Miad</th>
                    <th style={{ padding: '14px 12px', textAlign: 'center' }}>Adet</th>
                    <th style={{ padding: '14px 12px', textAlign: 'left' }}>Yeterlilik</th>
                    <th style={{ width: 84, padding: '14px 12px', textAlign: 'center' }}>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const miad = getMiadStatus(row.miad);
                    const coverage = getCoverage(row, minMaxRules, lotTrackedStockCodes, allRows);
                    const editing = editingGroupKey === row.groupKey;
                    return (
                      <tr key={row.groupKey} style={{ position: 'relative', borderTop: '1px solid var(--line)', color: 'var(--ink-1)', fontSize: 13.5, fontWeight: 700 }}>
                        <td style={{ position: 'relative', padding: 0 }}>
                          <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 4, borderRadius: '0 4px 4px 0', background: miad.color }} />
                          <span style={{ display: 'block', width: 10, height: 10, margin: '0 auto', borderRadius: 99, background: miad.color }} />
                        </td>
                        <td onClick={() => row.firstId && onOpenDetail(row.firstId)} style={{ padding: '17px 12px', cursor: row.firstId ? 'pointer' : 'default', color: 'var(--ink-2)', font: '750 11.5px ui-monospace, monospace' }}>{row.stokKodu}</td>
                        <td onClick={() => row.firstId && onOpenDetail(row.firstId)} style={{ padding: '17px 12px', cursor: row.firstId ? 'pointer' : 'default', fontSize: 14, fontWeight: 850 }}>{row.stokAdi}</td>
                        <td onClick={() => row.firstId && onOpenDetail(row.firstId)} style={{ padding: '17px 12px', cursor: row.firstId ? 'pointer' : 'default', color: 'var(--ink-2)', font: '700 11.5px ui-monospace, monospace' }}>{row.lot || '—'}</td>
                        <td onClick={() => row.firstId && onOpenDetail(row.firstId)} style={{ padding: '12px', cursor: row.firstId ? 'pointer' : 'default' }}>
                          <div style={{ fontWeight: 850 }}>{row.miad || '—'}</div>
                          <span style={{ display: 'inline-flex', marginTop: 4, padding: '3px 8px', borderRadius: 999, color: miad.color, background: `color-mix(in srgb, ${miad.color} 10%, transparent)`, fontSize: 10.5, fontWeight: 800 }}>{miad.label}</span>
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {editing ? (
                            <input
                              type="number"
                              min={0}
                              value={editQuantity}
                              onChange={event => onEditQuantityChange(Math.max(0, Number(event.target.value) || 0))}
                              onClick={event => event.stopPropagation()}
                              style={{ width: 86, height: 38, border: 'none', borderRadius: 13, outline: 'none', textAlign: 'center', color: 'var(--ink-1)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', font: '800 13px inherit' }}
                            />
                          ) : (
                            <MlPill style={{ color: 'var(--ink-1)' }}>{formatQuantity(row)}</MlPill>
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 999, color: coverage.tone === 'danger' ? 'var(--danger)' : coverage.tone === 'amber' ? 'var(--amber)' : coverage.tone === 'good' ? 'var(--water-deep)' : 'var(--ink-2)', background: coverage.tone === 'danger' ? 'rgba(192,121,106,0.12)' : coverage.tone === 'amber' ? 'var(--amber-soft)' : coverage.tone === 'good' ? 'rgba(111,181,133,0.13)' : 'var(--surface-2)', fontSize: 11.5, fontWeight: 850 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 99, background: 'currentColor' }} />
                            {coverage.label}
                          </div>
                          <div style={{ marginTop: 5, color: 'var(--ink-3)', fontSize: 10.5, fontWeight: 650 }}>Min: {coverage.min || '—'} / Max: {coverage.max || '—'}</div>
                          {coverage.riskyBoxes > 0 && <div style={{ marginTop: 3, color: 'var(--danger)', fontSize: 10.5, fontWeight: 750 }}>{coverage.riskyBoxes} kutu riskli</div>}
                        </td>
                        <td data-row-menu-root style={{ position: 'relative', padding: '12px', textAlign: 'center' }}>
                          {editing ? (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
                              <MlIconBtn size={36} ariaLabel="Kaydet" onClick={() => onSaveEdit(row.groupKey)}><Check size={16} color="var(--water-deep)" /></MlIconBtn>
                              <MlIconBtn size={36} ariaLabel="İptal" onClick={onCancelEdit}><X size={16} /></MlIconBtn>
                            </div>
                          ) : (
                            <MlIconBtn size={38} ariaLabel="İşlem menüsü" onClick={() => setRowMenu(rowMenu === row.groupKey ? null : row.groupKey)}>
                              <EllipsisVertical size={17} />
                            </MlIconBtn>
                          )}
                          {rowMenu === row.groupKey && !editing && (
                            <div style={{ position: 'absolute', zIndex: 70, top: 54, right: 16, width: 190, padding: 7, borderRadius: 'var(--radius)', textAlign: 'left', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: '0 24px 48px -24px rgba(90,72,40,0.58), var(--clay)' }}>
                              <button type="button" onClick={() => { row.firstId && onOpenDetail(row.firstId); setRowMenu(null); }} style={{ ...clayButtonStyle, width: '100%', minHeight: 40, justifyContent: 'flex-start', borderRadius: 13, boxShadow: 'none', background: 'transparent', fontSize: 12.5 }}>
                                <ChevronRight size={15} /> Detayı Aç
                              </button>
                              {isAdmin && (
                                <button type="button" onClick={() => { onStartEdit(row); setRowMenu(null); }} style={{ ...clayButtonStyle, width: '100%', minHeight: 40, justifyContent: 'flex-start', borderRadius: 13, boxShadow: 'none', background: 'transparent', fontSize: 12.5 }}>
                                  <Pencil size={15} /> Adedi Düzenle
                                </button>
                              )}
                              <button type="button" onClick={() => { onDeleteGroup(row.groupKey); setRowMenu(null); }} disabled={deletingGroupKey === row.groupKey} style={{ ...clayButtonStyle, width: '100%', minHeight: 40, justifyContent: 'flex-start', borderRadius: 13, boxShadow: 'none', background: 'transparent', color: 'var(--danger)', fontSize: 12.5 }}>
                                <Trash2 size={15} /> Kaydı Sil
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: mobile ? '14px 12px' : '15px 20px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--ink-2)', fontSize: 12, fontWeight: 700 }}>
              <span>Sayfa başına</span>
              <select
                value={rowsPerPage}
                onChange={event => onRowsPerPageChange(Number(event.target.value))}
                style={{ height: 36, border: 'none', borderRadius: 12, outline: 'none', padding: '0 28px 0 10px', color: 'var(--ink-1)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', font: '800 12px inherit' }}
              >
                {[10, 20, 50, 100].map(count => <option key={count} value={count}>{count}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <MlIconBtn size={38} ariaLabel="Önceki sayfa" onClick={() => onCurrentPageChange(Math.max(1, currentPage - 1))}><ChevronLeft size={17} /></MlIconBtn>
              <span style={{ minWidth: 80, textAlign: 'center', color: 'var(--ink-2)', fontSize: 12.5, fontWeight: 800 }}>{currentPage} / {pageCount}</span>
              <MlIconBtn size={38} ariaLabel="Sonraki sayfa" onClick={() => onCurrentPageChange(Math.min(pageCount, currentPage + 1))}><ChevronRight size={17} /></MlIconBtn>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
