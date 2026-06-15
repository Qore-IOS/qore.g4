/**
 * @fileoverview Total Verimlilik (Total Efficiency) Panel Component
 * @description Comprehensive efficiency calculation panel for multi-laboratory environments.
 * Provides stock accuracy tracking, kit efficiency metrics, cost analysis, and
 * hak ediş (entitlement) calculations across verimlilik pools.
 * @module components/total-verimlilik-panel
 * @version 1.0.0
 *
 * @features
 * - Multi-laboratory efficiency pool management
 * - 25-column data table with manual and calculated fields
 * - Stock accuracy deviation tracking (Stok Doğruluk)
 * - Kit efficiency deviation tracking (Kit Verimlilik)
 * - Box loss calculation (Kutu Kayıp)
 * - Cost calculation with multi-currency support (TRY/USD/EUR)
 * - Hak ediş karşılığı (entitlement equivalent) calculation
 * - Profit/loss analysis per product
 * - Center lab hak ediş calculation from İş Analizi data
 * - Excel import/export functionality
 * - Previous period data carryover
 * - Real-time exchange rate fetching with fallback
 * - Cost checkpoint system for historical cost tracking
 * - Advanced filtering and sorting capabilities
 * - Results-only view mode
 *
 * @accessibility
 * - ARIA labels for all interactive elements
 * - Keyboard accessible inputs and buttons
 * - Screen reader compatible data table
 * - Clear visual indicators for efficiency states
 * - Focus management for modal dialogs
 *
 * @calculations
 * - Column 8:  Total Ay Başı Stok = (Baş.Stok Kutu × Ambalaj) + Ay Üstü Cihaz Test
 * - Column 10: Ay Başı Sevkiyat (Test) = Ay Başı Sevkiyat (Kutu) × Ambalaj
 * - Column 14: Sevkiyatlar Sonrası Total = ((Sevk.Kutuları) × Ambalaj) + Total Ay Başı
 * - Column 18: Dönem Sonu Toplam = (D.Sonu Stok Kutu × Ambalaj) + D.Sonu Cihaz Test
 * - Column 20: Beklenen Test = Sevkiyatlar Sonrası (14) − D.Sonu Toplam (18)
 * - Column 22: Stok Doğruluk Fark = Beklenen Test (20) − Kümülatif (15)
 *              (eksik: Fark>0 / fark yok: Fark=0 / fazla: Fark<0)
 * - Column 23: Kutu Kayıp = Stok Doğruluk Fark / Ambalaj
 * - Column 24: Kit Verimlilik Fark = Kümülatif (15) − Hak Ediş (21)  [Maliyet grubu]
 * - Column 25: Sarfiyat Maliyeti = StokFark × (Maliyet/Ambalaj)
 * - Column 26: Hak Ediş Karşılığı = HakEdişTL × Beklenen Test (20)
 * - Column 27: Kâr = Hak Ediş Karşılığı (26) − Sarfiyat Maliyeti (25)
 */

'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, memo, useDeferredValue } from 'react';
import * as XLSX from 'xlsx';
import type { Hospital, ProductCode, EfficiencyPool, LabPool, MinMaxRule } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Loader2, BarChart3, FileSpreadsheet, Save, Download, ChevronRight, ChevronDown, Upload, Eye, EyeOff, History, Filter, ArrowUp, ArrowDown, Search, X, Crown, RotateCcw, Clock, Bold, Italic, AlignLeft, AlignCenter, AlignRight, PaintBucket, Plus, SlidersHorizontal, Columns3, Trash2, Maximize2, Minimize2, Bot } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { LabSelector } from '@/components/common/LabSelector';
import { Label } from '@/components/ui/label';
import { collection, getDocs, query, orderBy, doc, setDoc, getDoc, Timestamp, where, collectionGroup } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { getScopedDocs, scopedQuery } from '@/lib/firestore-helpers';
import { totalVerimlilikLogger } from '@/lib/logger';
import { cn, exportDataToExcel } from '@/lib/utils';
import { getExchangeRates } from '@/lib/exchange-rates';
import Link from 'next/link';

interface TotalVerimlilikPanelProps {
  hospitals: Hospital[];
  productCodes: ProductCode[];
}

interface TableRow {
  id: string; // labId-stokKodu kombinasyonu
  labId: string;
  labName: string;
  labKod: string;
  stokKodu: string;
  stokAdi: string;
  testAdi: string;
  ambalajDegeri: number;
  cihazGrubu: string;
  // Manuel giriş alanları (Sütun 7-8)
  baslangicStokuKutu: number;
  ayBasiCihazUstuTest: number;
  // Hesaplanan alan (Sütun 9)
  totalAyBasiStok: number;
  // Phase 2 - Sütunlar 9-14
  ayBasiSevkiyatKutu: number; // Sütun 9 - Ay Başı Sevkiyat (Kutu)
  ayBasiSevkiyatTest: number; // Sütun 10 - Ay Başı Sevkiyat (Test) = Kutu × Ambalaj (hesaplanan)
  goztepeSevkiyat: number; // Sütun 11 - Göztepe Sevkiyat (Kutu)
  kurumlarArasiSevk: number; // Sütun 12 - Kurumlar Arası Sevk (Kutu)
  kurumlarArasiSevkKaynakLabId?: string; // Sütun 12 için kaynak lab
  lojistikAraTransfer: number; // Sütun 13 - Lojistik Ara Transfer (Kutu)
  sevkiyatlarSonrasiTotalTest: number; // Sütun 14 - Hesaplanan
  // Phase 3 - Sütunlar 15-19
  kumulatifTotal: number; // Sütun 15 - Kümülatif Total (Test)
  donemSonuStokKutu: number; // Sütun 16 - Dönem Sonu Stok (Kutu)
  donemSonuCihazUstuTest: number; // Sütun 17 - Dönem Sonu Cihaz Üstü (Test)
  donemSonuToplamTest: number; // Sütun 18 - Hesaplanan: (16 * ambalaj) + 17
  // Sütun 19: Cihazdan çıkan kit (ejectedKitRecords) test toplamı (otomatik, salt-okunur, bilgi amaçlı)
  arizaliKitTest: number;
  // Sütun 20: Beklenen Test = sevkiyatlarSonrasiTotalTest − donemSonuToplamTest (hesaplanan)
  beklenenTestSayisi: number;
  hakEdis: number; // Sütun 21 - Hak Ediş (Test)
  // Phase 4 - Sütunlar 22 / 24
  stokDogrulukFark: number; // Sütun 22 - Beklenen Test (20) − Kümülatif (15) = Fark (Test)
  stokDogrulukYuzde: number; // Sütun 22 - Fark/Kümülatif * 100 = Sapma %
  kitVerimlilikFark: number; // Sütun 24 - Kümülatif (15) − Hak Ediş (21) = Fark (Test) [Maliyet grubu]
  kitVerimlilikYuzde: number; // Sütun 24 - Fark/Kümülatif * 100 = Sapma %
}

type EditableField = 'baslangicStokuKutu' | 'ayBasiCihazUstuTest' | 'ayBasiSevkiyatKutu' | 'goztepeSevkiyat' | 'kurumlarArasiSevk' | 'lojistikAraTransfer' | 'kumulatifTotal' | 'donemSonuStokKutu' | 'donemSonuCihazUstuTest' | 'hakEdis';


interface EfficiencyMetrics {
  toplamKumulatif: number;
  toplamBeklenenTuketim: number;
  toplamHakEdis: number;
  stokSapmaYuzde: number;
  kitSapmaYuzde: number;
  stokDogrulukSkoru: number;
  kitVerimlilikSkoru: number;
  genelVerimlilik: number;
  toplamEtkiDegeri: number;
  maliyetAgirlikli: boolean;
  hesaplananSatirSayisi: number;
  hakEdisVerisiGirildi: boolean;
  algoritma: 'value-impact-efficiency-index';
}

type ExchangeRateMap = { EUR: number; USD: number; TRY: number };

const emptyEfficiencyMetrics = (): EfficiencyMetrics => ({
  toplamKumulatif: 0,
  toplamBeklenenTuketim: 0,
  toplamHakEdis: 0,
  stokSapmaYuzde: 0,
  kitSapmaYuzde: 0,
  stokDogrulukSkoru: 100,
  kitVerimlilikSkoru: 100,
  genelVerimlilik: 100,
  toplamEtkiDegeri: 0,
  maliyetAgirlikli: false,
  hesaplananSatirSayisi: 0,
  hakEdisVerisiGirildi: false,
  algoritma: 'value-impact-efficiency-index',
});

const clampEfficiencyScore = (value: number) => Math.max(0, Math.min(100, value));

const deviationToScore = (deviation: number, denominator: number) => {
  if (denominator <= 0) return 100;
  return clampEfficiencyScore(100 - (Math.abs(deviation) / denominator) * 100);
};

const getUnitCostInEur = (
  row: TableRow,
  productCodes: ProductCode[],
  costCheckpointData: Record<string, { cost: number; currency: 'EUR' | 'USD' | 'TRY' }> | null,
  exchangeRates: ExchangeRateMap | null,
): number | null => {
  if (!exchangeRates) return null;

  const checkpointCost = costCheckpointData?.[row.stokKodu];
  const product = productCodes.find(p => p.stokKodu === row.stokKodu);
  const productCost = checkpointCost?.cost ?? product?.cost;
  const productCurrency = checkpointCost?.currency ?? (product?.currency as 'EUR' | 'USD' | 'TRY' | undefined) ?? 'EUR';

  if (!productCost || productCost <= 0) return null;

  const packageCostInEur = productCurrency === 'EUR'
    ? productCost
    : productCurrency === 'USD'
      ? productCost / exchangeRates.USD
      : productCost / exchangeRates.TRY;

  return packageCostInEur / (row.ambalajDegeri || 1);
};

const calculateEfficiencyMetrics = (
  rows: TableRow[],
  productCodes: ProductCode[],
  costCheckpointData: Record<string, { cost: number; currency: 'EUR' | 'USD' | 'TRY' }> | null,
  exchangeRates: ExchangeRateMap | null,
): EfficiencyMetrics => {
  if (rows.length === 0) return emptyEfficiencyMetrics();

  let toplamKumulatif = 0;
  let toplamBeklenenTuketim = 0;
  let toplamHakEdis = 0;
  let toplamEtkiDegeri = 0;
  let weightedStockScore = 0;
  let weightedKitScore = 0;
  let weightedGeneralScore = 0;
  let hesaplananSatirSayisi = 0;
  let rowsWithCost = 0;
  let rowsWithoutCost = 0;
  const hakEdisVerisiGirildi = rows.some(row => Number(row.hakEdis || 0) > 0);

  const rowInputs = rows.map(row => {
    const beklenenTuketim = row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest;
    const volume = Math.max(0, row.kumulatifTotal || 0);
    const stockScore = deviationToScore(row.stokDogrulukFark, volume);
    const kitScore = hakEdisVerisiGirildi ? deviationToScore(row.kitVerimlilikFark, volume) : 0;
    const generalScore = hakEdisVerisiGirildi ? (stockScore + kitScore) / 2 : stockScore;
    const unitCostInEur = getUnitCostInEur(row, productCodes, costCheckpointData, exchangeRates);

    toplamKumulatif += row.kumulatifTotal;
    toplamBeklenenTuketim += beklenenTuketim;
    toplamHakEdis += row.hakEdis;

    if (volume > 0) {
      if (unitCostInEur && unitCostInEur > 0) rowsWithCost += 1;
      else rowsWithoutCost += 1;
    }

    return { volume, stockScore, kitScore, generalScore, unitCostInEur };
  });

  const useCostWeighting = rowsWithCost > 0 && rowsWithoutCost === 0;

  rowInputs.forEach(({ volume, stockScore, kitScore, generalScore, unitCostInEur }) => {
    if (volume <= 0) return;

    const impact = useCostWeighting ? (unitCostInEur || 0) * volume : volume;
    if (impact <= 0) return;

    toplamEtkiDegeri += impact;
    weightedStockScore += stockScore * impact;
    weightedKitScore += kitScore * impact;
    weightedGeneralScore += generalScore * impact;
    hesaplananSatirSayisi += 1;
  });

  const stokSapmaYuzde = toplamKumulatif !== 0
    ? ((toplamBeklenenTuketim - toplamKumulatif) / toplamKumulatif) * 100
    : 0;

  const kitSapmaYuzde = toplamKumulatif !== 0
    ? ((toplamKumulatif - toplamHakEdis) / toplamKumulatif) * 100
    : 0;

  if (toplamEtkiDegeri === 0) {
    return {
      ...emptyEfficiencyMetrics(),
      toplamKumulatif,
      toplamBeklenenTuketim,
      toplamHakEdis,
      stokSapmaYuzde,
      kitSapmaYuzde,
      hakEdisVerisiGirildi,
    };
  }

  const stokDogrulukSkoru = weightedStockScore / toplamEtkiDegeri;
  const kitVerimlilikSkoru = weightedKitScore / toplamEtkiDegeri;
  const genelVerimlilik = weightedGeneralScore / toplamEtkiDegeri;

  return {
    toplamKumulatif,
    toplamBeklenenTuketim,
    toplamHakEdis,
    stokSapmaYuzde,
    kitSapmaYuzde,
    stokDogrulukSkoru,
    kitVerimlilikSkoru,
    genelVerimlilik,
    toplamEtkiDegeri,
    maliyetAgirlikli: useCostWeighting,
    hesaplananSatirSayisi,
    hakEdisVerisiGirildi,
    algoritma: 'value-impact-efficiency-index',
  };
};

interface HakEdisDefinition {
  id: string;
  sutKodu: string;
  sutTestAdi: string;
  linkedStokKodu: string;
  hakEdisMiktari: number; // TL cinsinden
}

interface FormulaColumnDef {
  id: string;
  name: string;
  expr: string;
}

interface SnapshotMetrics {
  monthKey: string;
  label: string;
  verimlilik: number;
  hakEdisToplam: number;
}


const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' })
}));

// ─── COLUMN DEFINITIONS ──────────────────────────────────────────────────
type ColType = 'info' | 'manual' | 'calc' | 'result';
interface ColDef {
  id: string;
  num: number;
  label: string;
  sub?: string;
  w: number;
  frozen?: 1 | 2 | 3;
  type: ColType;
  cost?: boolean;        // only visible when showCostColumns
  centerOnly?: boolean;  // only visible in centerHakEdisMode
}

const COLS: ColDef[] = [
  { id: 'stokKodu',                  num: 1,  label: 'Stok Kodu',                            w: 96,  type: 'info' },
  { id: 'stokAdi',                   num: 2,  label: 'Ürün Adı',                             w: 230, frozen: 1, type: 'info' },
  { id: 'testAdi',                   num: 3,  label: 'Test Adı',                             w: 86,  type: 'info' },
  { id: 'ambalajDegeri',             num: 4,  label: 'Ambalaj',                              w: 64,  type: 'info' },
  { id: 'cihazGrubu',                num: 5,  label: 'Cihaz Grubu',                          w: 76,  type: 'info' },
  { id: 'baslangicStokuKutu',        num: 6,  label: 'Baş. Stoğu',          sub: '(Kutu)',   w: 76,  type: 'manual' },
  { id: 'ayBasiCihazUstuTest',       num: 7,  label: 'Ay Üstü',             sub: '(Test)',   w: 66,  type: 'manual' },
  { id: 'totalAyBasiStok',           num: 8,  label: 'Total Ay Başı',       sub: '(Test)',   w: 80,  type: 'calc' },
  { id: 'ayBasiSevkiyatKutu',        num: 9,  label: 'Ay Başı Sevk.',       sub: '(Kutu)',   w: 80,  type: 'manual' },
  { id: 'ayBasiSevkiyatTest',        num: 10, label: 'Ay Başı Sevk.',       sub: '(Test)',   w: 84,  type: 'calc' },
  { id: 'goztepeSevkiyat',           num: 11, label: 'Göztepe Sevk.',       sub: '(Kutu)',   w: 80,  type: 'manual' },
  { id: 'kurumlarArasiSevk',         num: 12, label: 'K.Arası Sevk',        sub: '(Kutu)',   w: 80,  type: 'manual' },
  { id: 'lojistikAraTransfer',       num: 13, label: 'Loj. Transfer',       sub: '(Kutu)',   w: 80,  type: 'manual' },
  { id: 'sevkiyatlarSonrasiTotalTest', num: 14, label: 'Sevk. Sonrası',     sub: '(Test)',   w: 84,  type: 'calc' },
  { id: 'kumulatifTotal',            num: 15, label: 'Küm. Total',          sub: '(Test)',   w: 78,  type: 'manual' },
  { id: 'donemSonuStokKutu',         num: 16, label: 'D.Sonu Stok',         sub: '(Kutu)',   w: 78,  type: 'manual' },
  { id: 'donemSonuCihazUstuTest',    num: 17, label: 'D.Sonu Cihaz',        sub: '(Test)',   w: 82,  type: 'manual' },
  { id: 'donemSonuToplamTest',       num: 18, label: 'D.Sonu Toplam',       sub: '(Test)',   w: 82,  type: 'calc' },
  { id: 'arizaliKitTest',            num: 19, label: 'Arızalı Kitler',      sub: '(Test)',   w: 90,  type: 'calc' },
  { id: 'beklenenTestSayisi',        num: 20, label: 'Beklenen Test',       sub: '(Test)',   w: 90,  type: 'calc' },
  { id: 'hakEdis',                   num: 21, label: 'Hak Ediş',            sub: '(Test)',   w: 74,  type: 'manual' },
  { id: 'stokDogrulukFark',          num: 22, label: 'Stok Doğruluk',                        w: 124, type: 'result' },
  { id: 'kutuKayip',                 num: 23, label: 'Kutu Kayıp',                           w: 116, type: 'result' },
  { id: 'kitVerimlilikFark',         num: 24, label: 'Kit Verimlilik',                       w: 124, type: 'result', cost: true },
  { id: 'sarfiyatMaliyeti',          num: 25, label: 'Sarfiyat Maliyeti',                    w: 110, type: 'result', cost: true },
  { id: 'hakEdisKarsiligi',          num: 26, label: 'Hak Ediş Karş.',                       w: 110, type: 'result', cost: true },
  { id: 'kar',                       num: 27, label: 'Kâr',                                  w: 96,  type: 'result', cost: true },
  { id: 'zararMaliyeti',             num: 28, label: 'Zarar Maliyeti',                       w: 110, type: 'result' },
  { id: 'merkezeGonderilen',         num: 29, label: 'Merkeze Gön.',        sub: '(Test)',   w: 96,  type: 'result', centerOnly: true },
];

const COLS_BY_ID: Record<string, ColDef> = COLS.reduce((m, c) => { m[c.id] = c; return m; }, {} as Record<string, ColDef>);

// ─── FORMAT PALETTES ──────────────────────────────────────────────────────
// Palettes ordered by hue (warm → cool) so visual flow is predictable
const FILL_PALETTE = [
  // Row 1 — warm pastels (yellow → orange → red → pink)
  '#fef9c3', '#fde68a', '#fed7aa', '#fecaca', '#fbcfe8',
  // Row 2 — cool pastels (green → teal → blue → indigo → violet)
  '#bbf7d0', '#a7f3d0', '#bfdbfe', '#c7d2fe', '#ddd6fe',
];
// Text palette ordered: black → grey → primary hues (red → orange → green → blue → purple → pink)
const TEXT_PALETTE = ['#111111', '#6b7280', '#b91c1c', '#c2410c', '#15803d', '#1d4ed8', '#7c3aed', '#be185d'];

// ─── ADVANCED FILTER OPERATORS ────────────────────────────────────────────
type AdvOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'between' | 'topN' | 'topPct' | 'aboveAvg' | 'belowAvg' | 'contains' | 'startsWith';
const ADV_OPS: { value: AdvOp; label: string; numeric?: boolean }[] = [
  { value: '=',          label: 'eşit' },
  { value: '!=',         label: 'eşit değil' },
  { value: '>',          label: '>',  numeric: true },
  { value: '<',          label: '<',  numeric: true },
  { value: '>=',         label: '≥',  numeric: true },
  { value: '<=',         label: '≤',  numeric: true },
  { value: 'between',    label: 'aralık', numeric: true },
  { value: 'topN',       label: 'Top N', numeric: true },
  { value: 'topPct',     label: 'Top %', numeric: true },
  { value: 'aboveAvg',   label: 'Ort. Üstü', numeric: true },
  { value: 'belowAvg',   label: 'Ort. Altı', numeric: true },
  { value: 'contains',   label: 'içerir' },
  { value: 'startsWith', label: 'başlar' },
];

interface AdvFilter { id: string; col: string; op: AdvOp; val: string }

function evalAdvFilterRaw(raw: unknown, f: AdvFilter): boolean {
  // Empty filter value = passive (matches everything) — important UX:
  // when user adds a rule but hasn't typed anything yet, all rows stay visible.
  if (f.val === '' || f.val == null) return true;

  // Try numeric comparison if filter value parses as a number AND the cell value is numeric-ish.
  const numV = parseFloat(f.val);
  const numRaw = typeof raw === 'number' ? raw : (raw != null && raw !== '' ? parseFloat(String(raw)) : NaN);
  const numericMode = !isNaN(numV) && !isNaN(numRaw) && (f.op === '>' || f.op === '<' || f.op === '>=' || f.op === '<=');
  if (numericMode) {
    switch (f.op) {
      case '>':  return numRaw >  numV;
      case '<':  return numRaw <  numV;
      case '>=': return numRaw >= numV;
      case '<=': return numRaw <= numV;
    }
  }

  // For ordering ops without numeric values → row fails (no meaningful comparison).
  if (f.op === '>' || f.op === '<' || f.op === '>=' || f.op === '<=' || f.op === 'between' || f.op === 'topN' || f.op === 'topPct' || f.op === 'aboveAvg' || f.op === 'belowAvg') return false;

  // String-mode comparison for =, !=, contains, startsWith (case-insensitive).
  // Treat missing/null as empty string so '!=' works correctly for absent values.
  const s = (raw == null ? '' : String(raw)).toLowerCase();
  const v = f.val.toLowerCase();
  switch (f.op) {
    case '=':          return s === v;
    case '!=':         return s !== v;
    case 'contains':   return s.includes(v);
    case 'startsWith': return s.startsWith(v);
    default:           return true;
  }
}

// ─── LOCAL STORAGE HELPERS ───────────────────────────────────────────────
function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function saveLS(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function evalFormula(expr: string, scope: Record<string, number>): number {
  const safeExpr = expr.replace(/[^0-9+\-*/()._% a-zA-Z]/g, '');
  const normalized = safeExpr.replace(/%/g, '/100');
  const names = Object.keys(scope);
  const values = names.map(k => Number(scope[k] || 0));
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, `return (${normalized});`) as (...args: number[]) => number;
    const result = fn(...values);
    return Number.isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}

// Optimizasyon için Debounced Input bileşeni
// Kullanıcı yazmayı bitirene kadar ana state'i güncellemez
const DebouncedInput = memo(function DebouncedInput({
  value,
  onChange,
  debounceMs = 300,
  ...props
}: {
  value: string | number;
  onChange: (value: string) => void;
  debounceMs?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dış value değiştiğinde local'i güncelle
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    // Önceki timeout'u temizle
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Yeni debounced güncelleme
    timeoutRef.current = setTimeout(() => {
      onChange(newValue);
    }, debounceMs);
  }, [onChange, debounceMs]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <input
      {...props}
      value={localValue}
      onChange={handleChange}
      className={`tv-cell-input ${props.className || ''}`}
    />
  );
});

// ─── COLUMN FILTER POPOVER (Excel-like value picker) ─────────────────
function ColFilterPopover({ col, x, y, allValues, activeFilter, sortCol, sortDir, onSort, onClearSort, onHide, onApply, onClose }: {
  col: ColDef;
  x: number; y: number;
  allValues: (string | number)[];
  activeFilter: string[] | null;
  sortCol: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (dir: 'asc' | 'desc') => void;
  onClearSort: () => void;
  onHide: () => void;
  onApply: (vals: string[] | null) => void;
  onClose: () => void;
}) {
  const [valSearch, setValSearch] = useState('');
  const [pending, setPending] = useState<Set<string> | null>(activeFilter ? new Set(activeFilter) : null);

  const filtered = allValues.filter(v => String(v).toLowerCase().includes(valSearch.toLowerCase()));
  const allChecked = pending === null || pending.size === allValues.length;
  const isAsc = sortCol === col.id && sortDir === 'asc';
  const isDesc = sortCol === col.id && sortDir === 'desc';
  const isChecked = (v: string | number) => pending === null ? true : pending.has(String(v));
  const toggleVal = (v: string | number) => {
    setPending(p => {
      const base = p === null ? new Set(allValues.map(String)) : new Set(p);
      const k = String(v);
      if (base.has(k)) base.delete(k); else base.add(k);
      return base.size === allValues.length ? null : base;
    });
  };
  const toggleAll = () => setPending(p => p === null ? new Set() : null);
  const apply = () => onApply(pending === null ? null : [...pending]);

  return (
    <div className="tv-colfilter-pop fixed z-50" style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 380) }}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg shadow-xl p-1 min-w-[220px]">
        {/* Sort */}
        <div className="px-2 pt-1.5 pb-1 text-[9px] uppercase font-bold text-zinc-400">Sıralama</div>
        <button onClick={() => onSort('asc')} className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] rounded hover:bg-zinc-50 dark:hover:bg-zinc-800 ${isAsc ? 'bg-blue-50 text-blue-700 font-semibold' : ''}`}>
          <ArrowUp className="h-3 w-3" />Küçükten Büyüğe
        </button>
        <button onClick={() => onSort('desc')} className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] rounded hover:bg-zinc-50 dark:hover:bg-zinc-800 ${isDesc ? 'bg-blue-50 text-blue-700 font-semibold' : ''}`}>
          <ArrowDown className="h-3 w-3" />Büyükten Küçüğe
        </button>
        {(isAsc || isDesc) && (
          <button onClick={onClearSort} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] rounded hover:bg-zinc-50 dark:hover:bg-zinc-800">
            <X className="h-3 w-3" />Sıralamayı Kaldır
          </button>
        )}
        <div className="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />
        {/* Value list */}
        <div className="px-2 pb-1 text-[9px] uppercase font-bold text-zinc-400">Değere Göre Filtrele</div>
        <div className="px-2">
          <div className="flex items-center gap-1 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 mb-1">
            <Search className="h-3 w-3 text-zinc-400" />
            <input value={valSearch} onChange={e => setValSearch(e.target.value)} placeholder="Ara..." className="bg-transparent border-0 outline-0 text-[11.5px] flex-1" />
          </div>
        </div>
        <div className="max-h-44 overflow-y-auto px-1">
          <button onClick={toggleAll} className="w-full flex items-center gap-2 px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded">
            <div className={`w-3 h-3 rounded-sm border ${allChecked ? 'bg-blue-600 border-blue-600 text-white flex items-center justify-center text-[7px]' : 'border-zinc-300'}`}>{allChecked && '✓'}</div>
            <span className="text-[11px] font-semibold text-zinc-500">(Tümünü Seç)</span>
          </button>
          {filtered.map(v => {
            const k = String(v);
            const checked = isChecked(v);
            return (
              <button key={k} onClick={() => toggleVal(v)} className="w-full flex items-center gap-2 px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded">
                <div className={`w-3 h-3 rounded-sm border ${checked ? 'bg-blue-600 border-blue-600 text-white flex items-center justify-center text-[7px]' : 'border-zinc-300'}`}>{checked && '✓'}</div>
                <span className={`text-[11.5px] truncate ${typeof v === 'number' ? 'font-mono' : ''}`}>{k === '' ? '(Boş)' : k}</span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-1 px-1 pt-1.5 pb-1 mt-1 border-t border-zinc-200 dark:border-zinc-700">
          {!col.frozen && <button onClick={onHide} className="flex-1 px-2 py-1 rounded border border-zinc-200 text-[11px] hover:bg-zinc-50">Gizle</button>}
          <button onClick={() => onApply(null)} className="flex-1 px-2 py-1 rounded border border-zinc-200 text-[11px] hover:bg-zinc-50">Temizle</button>
          <button onClick={apply} className="flex-1 px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-semibold hover:bg-blue-700">Uygula</button>
        </div>
      </div>
    </div>
  );
}

// ─── CONTEXT MENU (cell/row/col formatting) ──────────────────────────
function CtxMenu({ menu, onApply, onClose }: {
  menu: { x: number; y: number; rowId: string | null; colId: string | null };
  onApply: (target: 'cell' | 'row' | 'col', key: 'bg' | 'textColor', value: string | undefined) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<'cell' | 'row' | 'col'>(menu.rowId && menu.colId ? 'cell' : menu.colId ? 'col' : 'row');
  const x = Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 800) - 240);
  const y = Math.min(menu.y, (typeof window !== 'undefined' ? window.innerHeight : 600) - 220);
  return (
    <div className="tv-ctx-menu fixed z-50 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg shadow-xl p-2 w-56" style={{ left: x, top: y }}>
      <div className="flex gap-1 mb-2">
        {([['cell', 'Hücre'], ['row', 'Satır'], ['col', 'Sütun']] as const).map(([t, l]) => {
          const enabled = (t === 'cell' && menu.rowId && menu.colId) || (t === 'row' && menu.rowId) || (t === 'col' && menu.colId);
          return (
            <button
              key={t}
              disabled={!enabled}
              onClick={() => setTarget(t)}
              className={`flex-1 px-2 py-1 rounded text-[11px] font-medium border ${target === t ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 hover:bg-zinc-50'} ${!enabled ? 'opacity-30 cursor-not-allowed' : ''}`}
            >{l}</button>
          );
        })}
      </div>
      <div className="text-[9px] uppercase font-bold text-zinc-400 mb-1">Hücre Rengi</div>
      <div className="grid grid-cols-5 gap-1 mb-2">
        {FILL_PALETTE.map(c => (
          <button key={c} onClick={() => { onApply(target, 'bg', c); onClose(); }} className="w-7 h-7 rounded border border-zinc-200" style={{ background: c }} />
        ))}
        <button onClick={() => { onApply(target, 'bg', undefined); onClose(); }} className="w-7 h-7 rounded border border-dashed border-zinc-300 text-zinc-400 text-[10px] flex items-center justify-center">✕</button>
      </div>
      <div className="text-[9px] uppercase font-bold text-zinc-400 mb-1">Metin Rengi</div>
      <div className="grid grid-cols-5 gap-1">
        {TEXT_PALETTE.map(c => (
          <button key={c} onClick={() => { onApply(target, 'textColor', c); onClose(); }} className="w-7 h-7 rounded border border-zinc-200" style={{ background: c }} />
        ))}
        <button onClick={() => { onApply(target, 'textColor', undefined); onClose(); }} className="w-7 h-7 rounded border border-dashed border-zinc-300 text-zinc-400 text-[10px] flex items-center justify-center">✕</button>
      </div>
    </div>
  );
}

export default function TotalVerimlilikPanel({
  hospitals = [],
  productCodes = [],
}: TotalVerimlilikPanelProps) {
  const REQUIRED_VISIBLE_COLS = useMemo(() => new Set(['stokAdi', 'testAdi', 'ambalajDegeri']), []);
  const { toast } = useToast();
  const { currentUser, currentCompanyId, isSuperAdmin } = useAuth();

  const [selectedPoolId, setSelectedPoolId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [efficiencyPools, setEfficiencyPools] = useState<EfficiencyPool[]>([]);
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [allMinMaxRules, setAllMinMaxRules] = useState<Record<string, MinMaxRule[]>>({});

  // Ara Kayıt (Checkpoint/Draft) State'leri
  const [isSavingAraKayit, setIsSavingAraKayit] = useState(false);
  const [araKayitInfo, setAraKayitInfo] = useState<{
    exists: boolean;
    savedAt?: Date;
    savedBy?: string;
  } | null>(null);

  const [rows, setRows] = useState<TableRow[]>([]);

  // Phase 2 State'leri
  const [depots, setDepots] = useState<{ id: string; name: string }[]>([]);

  // Sevkiyat Bilgisi Modal State'leri (Sütun 11)
  const [showSevkiyatBilgisiModal, setShowSevkiyatBilgisiModal] = useState(false);
  const [selectedDepotForSevkiyat, setSelectedDepotForSevkiyat] = useState<string>('');
  const [selectedLabsForSevkiyat, setSelectedLabsForSevkiyat] = useState<Set<string>>(new Set());
  const [isFetchingSevkiyat, setIsFetchingSevkiyat] = useState(false);

  // Kurumlar Arası Sevk Modal State'leri (Sütun 12)
  const [showKurumlarArasiModal, setShowKurumlarArasiModal] = useState(false);
  const [kurumlarArasiEditingRow, setKurumlarArasiEditingRow] = useState<{ rowId: string; value: number } | null>(null);

  // Kurumlar arası transfer bilgisi - hangi labdan ne kadar alındığını takip eder
  // Key: "targetRowId" -> { sourceLabId, kutuAdet }
  const [interLabTransfers, setInterLabTransfers] = useState<Record<string, { sourceLabId: string; sourceLabName: string; kutuAdet: number }>>({});

  // Phase 5 - Excel Import Modal State'leri
  const [showExcelImportModal, setShowExcelImportModal] = useState(false);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Virtualization ve Edge Scroll için Ref'ler
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tableParentRef = useRef<HTMLDivElement>(null);
  const edgeScrollIntervalRef = useRef<number | null>(null);

  // Yatay slider ve kenar glow ref'leri (state yerine ref kullanarak gereksiz re-render'ları önle)
  const sliderRef = useRef<HTMLInputElement>(null);
  const glowLeftRef = useRef<HTMLDivElement>(null);
  const glowRightRef = useRef<HTMLDivElement>(null);
  const sliderSyncRef = useRef(false); // slider → scroll sync flag

  // Phase 6 - Sonuç Odaklı Görünüm
  const [showResultsOnly, setShowResultsOnly] = useState(false);

  // Sütun 23 - Kutu Kayıp Görünüm Modu
  const [column22Mode, setColumn22Mode] = useState<'kumulatif' | 'hakedis'>('kumulatif');

  // Maliyet sütunları (Kit Verimlilik dahil 24-27) Göster/Gizle (default: kapalı)
  const [showCostColumns, setShowCostColumns] = useState(false);

  // Sütun 23 - Maliyet Hesabı için Para Birimi ve Döviz Kurları
  const [costCurrency, setCostCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [exchangeRates, setExchangeRates] = useState<{ EUR: number; USD: number; TRY: number } | null>(null);

  // Maliyet Checkpoint Sistemi (Checkpoint'ler Ürün Kodu Yönetimi'nden kaydedilir)
  const [costCheckpoints, setCostCheckpoints] = useState<{ id: string; year: number; month: number; createdAt: Date }[]>([]);
  const [selectedCostCheckpoint, setSelectedCostCheckpoint] = useState<string>(''); // 'YYYY-MM' format
  const [costCheckpointData, setCostCheckpointData] = useState<Record<string, { cost: number; currency: 'EUR' | 'USD' | 'TRY' }> | null>(null);

  // Sütun 24-25 - Hak Ediş Karşılığı ve Kâr için laboratuvar bazlı hak ediş tanımları
  const [labHakEdisDefinitions, setLabHakEdisDefinitions] = useState<Record<string, HakEdisDefinition[]>>({});

  // Filter, Sort ve Search State'leri
  const [columnFilters, setColumnFilters] = useState<{
    labName: Set<string>;
    stokAdi: Set<string>;
    testAdi: Set<string>;
    cihazGrubu: Set<string>;
  }>({
    labName: new Set(),
    stokAdi: new Set(),
    testAdi: new Set(),
    cihazGrubu: new Set(),
  });
  const [sortConfig, setSortConfig] = useState<{
    column: 'stokDogrulukFark' | 'kitVerimlilikFark' | null;
    direction: 'asc' | 'desc';
  }>({ column: null, direction: 'asc' });
  const [searchTerm, setSearchTerm] = useState('');

  // Marka ve Ürün Grubu Filtreleri (Hesaplama başlamadan önce)
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [selectedUrunGrubu, setSelectedUrunGrubu] = useState<string>('');

  // Merkez Hak Edişi Hesaplama State'leri
  const [centerHakEdisMode, setCenterHakEdisMode] = useState(false);
  const [isCalculatingCenterHakEdis, setIsCalculatingCenterHakEdis] = useState(false);
  // Key: rowId (labId-stokKodu), Value: merkeze gönderilen test sayısı
  const [testsSentToCenter, setTestsSentToCenter] = useState<Record<string, number>>({});
  // İş analizi raw data cache
  const [isAnaliziRawData, setIsAnaliziRawData] = useState<any[] | null>(null);

  // ─── REDESIGNED UI STATE ──────────────────────────────────────────────
  // Lab grouping (expand/collapse) — only render rows when lab is expanded
  const [expandedLabs, setExpandedLabs] = useState<Set<string>>(new Set());
  // Hidden column ids
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  // Bulk selection
  const [selRows, setSelRows] = useState<Set<string>>(new Set());
  const [selCols, setSelCols] = useState<Set<string>>(new Set());
  // Cell-level selection (Excel-style click). Anchor + active = current selection
  const [selCells, setSelCells] = useState<Set<string>>(new Set());
  const cellAnchor = useRef<{ rowId: string; colId: string } | null>(null);
  // Per-cell / per-row / per-col formatting (persisted)
  type FmtRec = { bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right'; textColor?: string; bg?: string };
  const [cellFmts, setCellFmts] = useState<Record<string, FmtRec>>(() => loadLS('totalVerim_cellFmts', {}));
  const [rowFmts, setRowFmts] = useState<Record<string, FmtRec>>(() => loadLS('totalVerim_rowFmts', {}));
  const [colFmts, setColFmts] = useState<Record<string, FmtRec>>(() => loadLS('totalVerim_colFmts', {}));
  // Toolbar active format
  const [activeFmt, setActiveFmt] = useState<{ bold: boolean; italic: boolean; align: 'left' | 'center' | 'right' | null; textColor: string | null; fillColor: string | null }>({
    bold: false, italic: false, align: null, textColor: null, fillColor: null,
  });
  // Dropdown open state (save | excel | textColor | fillColor)
  const [openDrop, setOpenDrop] = useState<string | null>(null);
  // Collapsible filter bar
  const [showFilterBar, setShowFilterBar] = useState(false);
  // Column manager modal
  const [colMgrOpen, setColMgrOpen] = useState(false);
  // Column header filter dropdown
  const [colFilterOpen, setColFilterOpen] = useState<{ col: ColDef; x: number; y: number; allValues: (string | number)[] } | null>(null);
  // Per-column "value-list" filter
  const [colValFilters, setColValFilters] = useState<Record<string, string[]>>(() => loadLS('totalVerim_colValFilters', {}));
  // Advanced filter builder
  const [advFilterOpen, setAdvFilterOpen] = useState(false);
  const [advFilters, setAdvFilters] = useState<AdvFilter[]>(() => loadLS('totalVerim_advFilters', []));
  const [advMode, setAdvMode] = useState<'AND' | 'OR'>(() => loadLS('totalVerim_advMode', 'AND'));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(loadLS<string[]>('totalVerim_collapsedGroups', [])));
  // Excel-tarzı formül çubuğu için aktif (son tıklanan) hücre.
  const [activeCell, setActiveCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [pivotRowsBy, setPivotRowsBy] = useState<string>('labName');
  const [pivotColsBy, setPivotColsBy] = useState<string>('testAdi');
  const [pivotValueBy, setPivotValueBy] = useState<string>('hakEdis');
  const [pivotDrillOpen, setPivotDrillOpen] = useState(false);
  const [pivotDrillRows, setPivotDrillRows] = useState<TableRow[]>([]);
  const [formulaCols, setFormulaCols] = useState<FormulaColumnDef[]>(() => loadLS('totalVerim_formulaCols', []));
  const [newFormulaName, setNewFormulaName] = useState('');
  const [newFormulaExpr, setNewFormulaExpr] = useState('');
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotMetrics>>(() => loadLS('totalVerim_snapshots', {}));
  const [aiAnalysisOpen, setAiAnalysisOpen] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiAnalysisText, setAiAnalysisText] = useState('');
  const [aiTargetLabel, setAiTargetLabel] = useState<string>('Tablo Geneli');
  // Edge-scroll glow refs (green)
  const greenGlowLeftRef = useRef<HTMLDivElement>(null);
  const greenGlowRightRef = useRef<HTMLDivElement>(null);
  // Context menu for cell/row/col formatting
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; rowId: string | null; colId: string | null } | null>(null);
  // Density tweak
  const [density, setDensity] = useState<'compact' | 'normal' | 'comfortable'>('compact');

  // ─── PERSIST UI PREFERENCES ──────────────────────────────────────────
  useEffect(() => { saveLS('totalVerim_cellFmts', cellFmts); }, [cellFmts]);
  useEffect(() => { saveLS('totalVerim_rowFmts', rowFmts); }, [rowFmts]);
  useEffect(() => { saveLS('totalVerim_colFmts', colFmts); }, [colFmts]);
  useEffect(() => { saveLS('totalVerim_colValFilters', colValFilters); }, [colValFilters]);
  useEffect(() => { saveLS('totalVerim_advFilters', advFilters); }, [advFilters]);
  useEffect(() => { saveLS('totalVerim_advMode', advMode); }, [advMode]);
  useEffect(() => { saveLS('totalVerim_collapsedGroups', Array.from(collapsedGroups)); }, [collapsedGroups]);
  useEffect(() => { saveLS('totalVerim_formulaCols', formulaCols); }, [formulaCols]);
  useEffect(() => { saveLS('totalVerim_snapshots', snapshots); }, [snapshots]);

  // ─── DROPDOWN / CONTEXT MENU GLOBAL CLOSE ─────────────────────────────
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.tv-drop-wrap') && !t.closest('.tv-color-pop')) setOpenDrop(null);
      if (!t.closest('.tv-ctx-menu')) setCtxMenu(null);
      if (!t.closest('.tv-colfilter-pop')) setColFilterOpen(null);
    };
    window.addEventListener('mousedown', onDocMouseDown);
    return () => window.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // Verimlilik havuzlarını, ortak lab havuzlarını ve depoları çek
  useEffect(() => {
    let isActive = true;

    const fetchPools = async () => {
      setIsLoading(true);

      const [effPoolsResult, labPoolsResult, depotsResult] = await Promise.allSettled([
        // Havuz seçicisi eski/legacy kayıtları da göstermeli. Sıralamayı istemcide
        // yapmak, createdAt alanı olmayan eski havuzların sorgudan düşmesini önler.
        getScopedDocs('efficiencyPools', currentCompanyId, isSuperAdmin),
        getScopedDocs('labPools', currentCompanyId, isSuperAdmin),
        getScopedDocs('depots', currentCompanyId, isSuperAdmin),
      ]);

      if (!isActive) return;

      if (effPoolsResult.status === 'fulfilled') {
        const pools = effPoolsResult.value
          .map(d => ({ id: d.id, ...d.data() } as EfficiencyPool))
          .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
        setEfficiencyPools(pools);
      } else {
        setEfficiencyPools([]);
        totalVerimlilikLogger.error('Verimlilik havuzları yüklenirken hata oluştu', effPoolsResult.reason);
        toast({ title: 'Hata', description: 'Havuzlar yüklenemedi.', variant: 'destructive' });
      }

      if (labPoolsResult.status === 'fulfilled') {
        setLabPools(labPoolsResult.value.map(d => ({ id: d.id, ...d.data() } as LabPool)));
      } else {
        totalVerimlilikLogger.error('Laboratuvar havuzları yüklenirken hata oluştu', labPoolsResult.reason);
      }

      if (depotsResult.status === 'fulfilled') {
        setDepots(depotsResult.value.map(d => ({ id: d.id, name: (d.data() as any).name || d.id })));
      } else {
        totalVerimlilikLogger.error('Depolar yüklenirken hata oluştu', depotsResult.reason);
      }

      setIsLoading(false);
    };

    void fetchPools();

    return () => {
      isActive = false;
    };
  }, [currentCompanyId, isSuperAdmin, toast]);

  // Sütun 23 için döviz kurlarını çek
  useEffect(() => {
    const fetchRates = async () => {
      try {
        setExchangeRates(await getExchangeRates());
      } catch (error) {
        totalVerimlilikLogger.warn('Döviz kuru API başarısız oldu, fallback değerler kullanılıyor', { error });
        setExchangeRates({ EUR: 1, USD: 1.08, TRY: 38.5 });
      }
    };

    fetchRates();
  }, []);

  // Maliyet checkpoint'lerini çek
  useEffect(() => {
    const fetchCostCheckpoints = async () => {
      try {
        const checkpointsSnap = await getDocs(
          scopedQuery('costCheckpoints', currentCompanyId, isSuperAdmin, orderBy('year', 'desc'), orderBy('month', 'desc'))
        );
        const checkpointsList = checkpointsSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            year: data.year as number,
            month: data.month as number,
            createdAt: data.createdAt?.toDate() || new Date(),
          };
        });
        setCostCheckpoints(checkpointsList);

        // Varsayılan olarak en güncel checkpoint'i seç
        if (checkpointsList.length > 0 && !selectedCostCheckpoint) {
          setSelectedCostCheckpoint(checkpointsList[0].id);
        }
      } catch (error) {
        totalVerimlilikLogger.error('Maliyet checkpoint kayıtları yüklenirken hata oluştu', error);
      }
    };

    fetchCostCheckpoints();
  }, [selectedCostCheckpoint]);

  // Seçilen maliyet checkpoint'inin verilerini çek
  useEffect(() => {
    if (!selectedCostCheckpoint) {
      setCostCheckpointData(null);
      return;
    }

    const fetchCheckpointData = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'costCheckpoints', selectedCostCheckpoint));
        if (docSnap.exists()) {
          const data = docSnap.data();
          setCostCheckpointData(data.costs as Record<string, { cost: number; currency: 'EUR' | 'USD' | 'TRY' }>);
        } else {
          setCostCheckpointData(null);
        }
      } catch (error) {
        totalVerimlilikLogger.error('Checkpoint verisi yüklenirken hata oluştu', error, { checkpointId: selectedCostCheckpoint });
        setCostCheckpointData(null);
      }
    };

    fetchCheckpointData();
  }, [selectedCostCheckpoint]);

  // Sütun 24-25: Seçilen havuzdaki tüm laboratuvarların hak ediş tanımlarını çek
  useEffect(() => {
    if (!selectedPoolId) {
      setLabHakEdisDefinitions({});
      return;
    }

    const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
    if (!selectedPool || selectedPool.memberIds.length === 0) {
      setLabHakEdisDefinitions({});
      return;
    }

    const fetchHakEdisDefinitions = async () => {
      try {
        // Tüm laboratuvarların hak ediş tanımlarını PARALEL çek. Önceden her lab
        // için ardışık getDocs yapılıyordu (N round-trip, havuz açılışını çok
        // yavaşlatıyordu); artık tek Promise.all batch'i.
        const entries = await Promise.all(
          selectedPool.memberIds.map(async (labId) => {
            try {
              const hakEdisSnap = await getDocs(
                query(collection(db, 'hospitals', labId, 'hakEdisDefinitions'), orderBy('sutKodu', 'asc'))
              );
              return [labId, hakEdisSnap.docs.map(d => ({ id: d.id, ...d.data() } as HakEdisDefinition))] as const;
            } catch (e) {
              totalVerimlilikLogger.warn('Laboratuvar hak ediş tanımları yüklenirken hata oluştu', { labId, error: e });
              return [labId, [] as HakEdisDefinition[]] as const;
            }
          })
        );
        const hakEdisMap: Record<string, HakEdisDefinition[]> = Object.fromEntries(entries);

        setLabHakEdisDefinitions(hakEdisMap);
      } catch (error) {
        totalVerimlilikLogger.error('Hak ediş tanımları yüklenirken hata oluştu', error, { poolId: selectedPoolId });
      }
    };

    fetchHakEdisDefinitions();
  }, [selectedPoolId, efficiencyPools]);

  // Seçilen havuz değiştiğinde min-max kurallarını çek ve satırları oluştur
  useEffect(() => {
    if (!selectedPoolId) {
      setRows([]);
      return;
    }

    const fetchMinMaxAndBuildRows = async () => {
      setIsLoading(true);
      try {
        const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
        if (!selectedPool) {
          setRows([]);
          return;
        }

        // Önce skip edilecek laboratuvarları belirle
        // Eğer bir laboratuvar bir ortak stok havuzuna dahilse ve o havuzun ana laboratuvarı
        // verimlilik havuzunda ise, bu laboratuvar skip edilmeli (ana lab zaten temsil ediyor)
        const labsToSkip = new Set<string>();

        for (const labId of selectedPool.memberIds) {
          // Bu laboratuvar herhangi bir ortak stok havuzuna dahil mi?
          const sharedPool = labPools.find(p => p.memberIds.includes(labId));

          if (sharedPool && sharedPool.mainLabId) {
            // Bu ortak stok havuzunun ana laboratuvarı verimlilik havuzunda mı?
            if (selectedPool.memberIds.includes(sharedPool.mainLabId)) {
              // Eğer bu laboratuvar ana lab değilse, skip et
              if (labId !== sharedPool.mainLabId) {
                labsToSkip.add(labId);
              }
            }
          }
        }

        // Havuzdaki laboratuvarların ID'lerini al (skip edilenler hariç)
        const labIdsToProcess = new Set<string>();
        const labIdToDisplayName = new Map<string, { name: string; kod: string }>();
        const labIdToMinMaxLabIds = new Map<string, string[]>();

        for (const labId of selectedPool.memberIds) {
          // Skip listesindeki laboratuvarları atla - bunlar zaten ana lab tarafından temsil ediliyor
          if (labsToSkip.has(labId)) continue;

          const lab = hospitals.find(h => h.id === labId);
          if (!lab) continue;

          // Bu laboratuvar bir ortak havuzun ana laboratuvarı mı?
          const sharedPool = labPools.find(p => p.mainLabId === labId);
          if (sharedPool) {
            // Ana laboratuvar olarak görüntüle ama tüm havuz üyelerinin min-max'ını al
            labIdToDisplayName.set(labId, { name: lab.name, kod: lab.kod || '' });
            labIdToMinMaxLabIds.set(labId, sharedPool.memberIds);
            sharedPool.memberIds.forEach(memberId => labIdsToProcess.add(memberId));
          } else {
            labIdsToProcess.add(labId);
            labIdToDisplayName.set(labId, { name: lab.name, kod: lab.kod || '' });
            labIdToMinMaxLabIds.set(labId, [labId]);
          }
        }

        // Min-max kurallarını PARALEL çek (önceden lab başına ardışık getDocs →
        // N round-trip; havuz açılışındaki asıl gecikme buydu).
        const ruleEntries = await Promise.all(
          Array.from(labIdsToProcess).map(async (labId) => {
            try {
              const rulesSnap = await getDocs(collection(db, 'hospitals', labId, 'minMaxRules'));
              return [labId, rulesSnap.docs.map(d => ({ stokKodu: d.id, ...d.data() } as MinMaxRule))] as const;
            } catch (e) {
              totalVerimlilikLogger.warn('Min-max kuralları yüklenirken hata oluştu', { labId, error: e });
              return [labId, [] as MinMaxRule[]] as const;
            }
          })
        );
        const rulesMap: Record<string, MinMaxRule[]> = Object.fromEntries(ruleEntries);
        setAllMinMaxRules(rulesMap);

        // ── Arızalı kitler (Cihazdan Çıkan Kit) ──────────────────────────────
        // Seçili ayda havuz üyesi labler için açılmış ejectedKitRecords kayıtları;
        // `${labId}|${stokKodu}` -> dönem içi toplam test. Lab başına PARALEL çekilir
        // (laboratoryId tek-alan sorgusu; lab şirkete özgü olduğundan kapsamlıdır).
        const monthStart = new Date(selectedYear, selectedMonth, 1, 0, 0, 0, 0);
        const monthEndExclusive = new Date(selectedYear, selectedMonth + 1, 1, 0, 0, 0, 0);
        const ejectedTestByLabCode = new Map<string, number>();
        try {
          const ejectedSnaps = await Promise.all(
            Array.from(labIdsToProcess).map(labId =>
              getDocs(query(collection(db, 'ejectedKitRecords'), where('laboratoryId', '==', labId)))
            )
          );
          ejectedSnaps.forEach(snap => {
            snap.docs.forEach(d => {
              const data = d.data() as { laboratoryId?: string; stokKodu?: string; testCount?: number; createdAt?: { toDate?: () => Date } };
              const created = data.createdAt?.toDate ? data.createdAt.toDate() : null;
              if (!created || created < monthStart || created >= monthEndExclusive) return;
              const lid = String(data.laboratoryId || '');
              const code = String(data.stokKodu || '');
              if (!lid || !code) return;
              const key = `${lid}|${code}`;
              ejectedTestByLabCode.set(key, (ejectedTestByLabCode.get(key) || 0) + (Number(data.testCount) || 0));
            });
          });
        } catch (e) {
          totalVerimlilikLogger.warn('Cihazdan çıkan kit kayıtları yüklenirken hata oluştu', { poolId: selectedPoolId, error: e });
        }

        // Her laboratuvar için benzersiz ürün listesi oluştur
        const newRows: TableRow[] = [];

        for (const labId of selectedPool.memberIds) {
          // Skip listesindeki laboratuvarları atla
          if (labsToSkip.has(labId)) continue;

          const displayInfo = labIdToDisplayName.get(labId);
          if (!displayInfo) continue;

          // Bu laboratuvar (veya ortak havuz) için tüm min-max ürünlerini topla
          const labIdsForMinMax = labIdToMinMaxLabIds.get(labId) || [labId];

          const uniqueProductCodes = new Set<string>();
          labIdsForMinMax.forEach(lid => {
            const rules = rulesMap[lid] || [];
            rules.forEach(rule => uniqueProductCodes.add(rule.stokKodu));
          });

          // Her ürün için satır oluştur
          const productCodesArray = Array.from(uniqueProductCodes);
          productCodesArray.forEach(stokKodu => {
            const product = productCodes.find(p => p.stokKodu === stokKodu);
            if (!product) return;

            // Arızalı kit (cihazdan çıkan kit) testi: ana lab satırına, havuz üyesi
            // tüm lablerden o stok koduna ait dönem içi toplam yazılır.
            let arizaliKitTest = 0;
            labIdsForMinMax.forEach(lid => {
              arizaliKitTest += ejectedTestByLabCode.get(`${lid}|${stokKodu}`) || 0;
            });

            // NOT: Marka / ürün grubu filtresi burada UYGULANMAZ. Tüm satırlar
            // kurulur; marka/grup filtresi yalnızca GÖRÜNÜM aşamasında
            // (filteredAndSortedRows) uygulanır. Böylece filtre değişiminde veri
            // yeniden çekilmez, kayıt tüm satırları içerir (kısmi kayıt → veri
            // kaybı önlenir) ve girilen değerler kaybolmaz.

            newRows.push({
              id: `${labId}-${stokKodu}`,
              labId: labId,
              labName: displayInfo.name,
              labKod: displayInfo.kod,
              stokKodu: product.stokKodu,
              stokAdi: product.stokAdi,
              testAdi: product.testAdi || '',
              ambalajDegeri: product.ambalajDegeri || 0,
              cihazGrubu: product.cihazGrubu || '',
              baslangicStokuKutu: 0,
              ayBasiCihazUstuTest: 0,
              totalAyBasiStok: 0,
              // Phase 2 alanları
              ayBasiSevkiyatKutu: 0,
              ayBasiSevkiyatTest: 0,
              goztepeSevkiyat: 0,
              kurumlarArasiSevk: 0,
              lojistikAraTransfer: 0,
              sevkiyatlarSonrasiTotalTest: 0,
              // Phase 3 alanları
              kumulatifTotal: 0,
              donemSonuStokKutu: 0,
              donemSonuCihazUstuTest: 0,
              donemSonuToplamTest: 0,
              // Yeni sütunlar (18-19)
              arizaliKitTest,
              beklenenTestSayisi: 0,
              hakEdis: 0,
              // Phase 4 alanları
              stokDogrulukFark: 0,
              stokDogrulukYuzde: 0,
              kitVerimlilikFark: 0,
              kitVerimlilikYuzde: 0,
            });
          });
        }

        // Alfabetik sıralama: önce laboratuvar adı, sonra ürün adı
        newRows.sort((a, b) => {
          const labCompare = a.labName.localeCompare(b.labName, 'tr');
          if (labCompare !== 0) return labCompare;
          return a.stokAdi.localeCompare(b.stokAdi, 'tr');
        });

        // Phase 3.5: Önceki ayın dönem sonu verilerini çek ve devret
        // Önceki ay/yıl hesapla
        let prevMonth = selectedMonth - 1;
        let prevYear = selectedYear;
        if (prevMonth < 0) {
          prevMonth = 11; // Aralık
          prevYear = selectedYear - 1;
        }

        // Önceki ayın kaydını kontrol et (önce ay sonu kaydı, yoksa ara kayıt)
        const prevDocId = `${selectedPoolId}-${prevYear}-${prevMonth}`;
        const prevAraKayitDocId = `araKayit-${selectedPoolId}-${prevYear}-${prevMonth}`;
        try {
          const prevDocSnap = await getDoc(doc(db, 'totalEfficiencyRecords', prevDocId));

          const applyCarryover = (prevRows: TableRow[], source: string) => {
            newRows.forEach(row => {
              const prevRow = prevRows.find(pr => pr.id === row.id);
              if (prevRow) {
                // Sütun 16 -> Sütun 7, Sütun 17 -> Sütun 8
                row.baslangicStokuKutu = prevRow.donemSonuStokKutu || 0;
                row.ayBasiCihazUstuTest = prevRow.donemSonuCihazUstuTest || 0;
              }
            });
            toast({
              title: 'Devir Yapıldı',
              description: `${MONTHS[prevMonth]?.label} ${prevYear} ${source} stok devri alındı.`,
            });
          };

          if (prevDocSnap.exists()) {
            // Ay sonu kaydı var → oradan devret
            const prevRows = (prevDocSnap.data().rows as TableRow[]) || [];
            applyCarryover(prevRows, 'döneminden');
          } else {
            // Ay sonu kaydı yok → ara kayıt var mı kontrol et
            const prevAraKayitSnap = await getDoc(doc(db, 'totalEfficiencyRecords', prevAraKayitDocId));
            if (prevAraKayitSnap.exists()) {
              const prevRows = (prevAraKayitSnap.data().rows as TableRow[]) || [];
              applyCarryover(prevRows, 'ara kaydından');
            }
          }
        } catch (e) {
          totalVerimlilikLogger.warn('Önceki dönem verileri yüklenirken hata oluştu', {
            prevMonth,
            prevYear,
            poolId: selectedPoolId,
            error: e,
          });
          // Hata olursa sessizce devam et, devir yapılmaz
        }

        // Hesaplanan alanları güncelle
        const computedRows = newRows.map(row => {
          const totalAyBasiStok = (row.baslangicStokuKutu * row.ambalajDegeri) + row.ayBasiCihazUstuTest;
          const ayBasiSevkiyatTest = row.ayBasiSevkiyatKutu * row.ambalajDegeri;
          const sevkiyatlarKutuToplam = row.ayBasiSevkiyatKutu + row.goztepeSevkiyat + row.kurumlarArasiSevk + row.lojistikAraTransfer;
          const sevkiyatlarSonrasiTotalTest = (sevkiyatlarKutuToplam * row.ambalajDegeri) + totalAyBasiStok;
          const donemSonuToplamTest = (row.donemSonuStokKutu * row.ambalajDegeri) + row.donemSonuCihazUstuTest;

          // Beklenen Test = Sevk.Sonrası − D.Sonu Toplam ; Stok Doğruluk = Beklenen − Kümülatif
          const beklenenTestSayisi = sevkiyatlarSonrasiTotalTest - donemSonuToplamTest;
          const stokDogrulukFark = beklenenTestSayisi - row.kumulatifTotal;
          const stokDogrulukYuzde = row.kumulatifTotal !== 0 ? (stokDogrulukFark / row.kumulatifTotal) * 100 : 0;
          const kitVerimlilikFark = row.kumulatifTotal - row.hakEdis;
          const kitVerimlilikYuzde = row.kumulatifTotal !== 0 ? (kitVerimlilikFark / row.kumulatifTotal) * 100 : 0;

          return {
            ...row,
            totalAyBasiStok,
            ayBasiSevkiyatTest,
            sevkiyatlarSonrasiTotalTest,
            donemSonuToplamTest,
            beklenenTestSayisi,
            stokDogrulukFark,
            stokDogrulukYuzde,
            kitVerimlilikFark,
            kitVerimlilikYuzde,
          };
        });

        // Ara kayıt kontrolü - varsa yükle
        const araKayitDocId = `araKayit-${selectedPoolId}-${selectedYear}-${selectedMonth}`;
        try {
          const araKayitSnap = await getDoc(doc(db, 'totalEfficiencyRecords', araKayitDocId));
          if (araKayitSnap.exists()) {
            const araKayitData = araKayitSnap.data();
            const araKayitRows = araKayitData.rows as TableRow[] || [];

            // Ara kayıttaki değerleri mevcut row'lara uygula
            const mergedRows = computedRows.map(row => {
              const savedRow = araKayitRows.find(ar => ar.id === row.id);
              if (savedRow) {
                // Kullanıcı tarafından girilmiş verileri ara kayıttan al
                return {
                  ...row,
                  baslangicStokuKutu: savedRow.baslangicStokuKutu,
                  ayBasiCihazUstuTest: savedRow.ayBasiCihazUstuTest,
                  ayBasiSevkiyatKutu: savedRow.ayBasiSevkiyatKutu,
                  goztepeSevkiyat: savedRow.goztepeSevkiyat,
                  kurumlarArasiSevk: savedRow.kurumlarArasiSevk,
                  lojistikAraTransfer: savedRow.lojistikAraTransfer,
                  kumulatifTotal: savedRow.kumulatifTotal,
                  donemSonuStokKutu: savedRow.donemSonuStokKutu,
                  donemSonuCihazUstuTest: savedRow.donemSonuCihazUstuTest,
                  hakEdis: savedRow.hakEdis,
                };
              }
              return row;
            });

            // Hesaplanan alanları yeniden hesapla
            const recomputedRows = mergedRows.map(row => {
              const totalAyBasiStok = (row.baslangicStokuKutu * row.ambalajDegeri) + row.ayBasiCihazUstuTest;
              const ayBasiSevkiyatTest = row.ayBasiSevkiyatKutu * row.ambalajDegeri;
              const sevkiyatlarKutuToplam = row.ayBasiSevkiyatKutu + row.goztepeSevkiyat + row.kurumlarArasiSevk + row.lojistikAraTransfer;
              const sevkiyatlarSonrasiTotalTest = (sevkiyatlarKutuToplam * row.ambalajDegeri) + totalAyBasiStok;
              const donemSonuToplamTest = (row.donemSonuStokKutu * row.ambalajDegeri) + row.donemSonuCihazUstuTest;
              const beklenenTestSayisi = sevkiyatlarSonrasiTotalTest - donemSonuToplamTest;
              const stokDogrulukFark = beklenenTestSayisi - row.kumulatifTotal;
              const stokDogrulukYuzde = row.kumulatifTotal !== 0 ? (stokDogrulukFark / row.kumulatifTotal) * 100 : 0;
              const kitVerimlilikFark = row.kumulatifTotal - row.hakEdis;
              const kitVerimlilikYuzde = row.kumulatifTotal !== 0 ? (kitVerimlilikFark / row.kumulatifTotal) * 100 : 0;

              return {
                ...row,
                totalAyBasiStok,
                ayBasiSevkiyatTest,
                sevkiyatlarSonrasiTotalTest,
                donemSonuToplamTest,
                beklenenTestSayisi,
                stokDogrulukFark,
                stokDogrulukYuzde,
                kitVerimlilikFark,
                kitVerimlilikYuzde,
              };
            });

            // Inter-lab transferleri de yükle
            if (araKayitData.interLabTransfers) {
              setInterLabTransfers(araKayitData.interLabTransfers);
            }

            setRows(recomputedRows);
            setAraKayitInfo({
              exists: true,
              savedAt: araKayitData.updatedAt?.toDate?.() || new Date(),
              savedBy: araKayitData.createdByName || 'Bilinmiyor',
            });

            toast({
              title: 'Ara Kayıt Yüklendi',
              description: `${araKayitData.createdByName || 'Bilinmiyor'} tarafından kaydedilen ara kayıt yüklendi.`,
            });
          } else {
            setRows(computedRows);
            setAraKayitInfo({ exists: false });
          }
        } catch (araKayitError) {
          console.error('Error loading ara kayit:', araKayitError);
          setRows(computedRows);
          setAraKayitInfo({ exists: false });
        }
      } catch (error) {
        totalVerimlilikLogger.error('Tablo satırları oluşturulurken hata oluştu', error, {
          poolId: selectedPoolId,
          month: selectedMonth,
          year: selectedYear,
        });
        toast({ title: 'Hata', description: 'Veriler yüklenirken bir sorun oluştu.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchMinMaxAndBuildRows();
    // selectedBrand / selectedUrunGrubu KASITLI olarak bağımlılıkta DEĞİL: marka/
    // grup filtresi artık client-side (görünüm) uygulanıyor; değişiminde veri
    // yeniden çekilmiyor.
  }, [selectedPoolId, selectedMonth, selectedYear, efficiencyPools, labPools, hospitals, productCodes, toast]);

  // Hesaplama fonksiyonu
  const computeRow = useCallback((row: TableRow, allRows?: TableRow[], transfers?: Record<string, { sourceLabId: string; sourceLabName: string; kutuAdet: number }>): TableRow => {
    // Total Ay Başı Stok = (Başlangıç Stoğu Kutu * Ambalaj Değeri) + Ay Başı Cihaz Üstü Test
    const totalAyBasiStok = (row.baslangicStokuKutu * row.ambalajDegeri) + row.ayBasiCihazUstuTest;

    // Sütun 14: Sevkiyatlar Sonrası Total Test Adet
    // Formül: ((10+11+12+13) * ambalaj) + 9 (Total Ay Başı Stok)
    const sevkiyatlarKutuToplam = row.ayBasiSevkiyatKutu + row.goztepeSevkiyat + row.kurumlarArasiSevk + row.lojistikAraTransfer;
    let sevkiyatlarSonrasiTotalTest = (sevkiyatlarKutuToplam * row.ambalajDegeri) + totalAyBasiStok;

    // Eğer bu satır başka bir laboratuvara ürün verdiyse, o miktarı düş
    if (transfers && allRows) {
      // Bu lab'ın bu ürününden başka lab'a transfer edilen miktarı bul
      for (const [targetRowId, transfer] of Object.entries(transfers)) {
        if (transfer.sourceLabId === row.labId) {
          // Aynı ürün mü kontrol et
          const targetRow = allRows.find(r => r.id === targetRowId);
          if (targetRow && targetRow.stokKodu === row.stokKodu) {
            // Kaynak labdan düşülecek test adedi = kutu * ambalaj
            sevkiyatlarSonrasiTotalTest -= transfer.kutuAdet * row.ambalajDegeri;
          }
        }
      }
    }

    // Sütun 10: Ay Başı Sevkiyat (Test) = Ay Başı Sevkiyat (Kutu) × Ambalaj
    const ayBasiSevkiyatTest = row.ayBasiSevkiyatKutu * row.ambalajDegeri;

    // Sütun 18: Dönem Sonu Toplam Test
    // Formül: (Dönem Sonu Stok Kutu * Ambalaj) + Dönem Sonu Cihaz Üstü Test
    const donemSonuToplamTest = (row.donemSonuStokKutu * row.ambalajDegeri) + row.donemSonuCihazUstuTest;

    // Sütun 20: Beklenen Test = Sevkiyatlar Sonrası Total (14) − D.Sonu Toplam (18)
    // (Laboratuvara gönderilen ve sonuç vermesi beklenen test miktarı.)
    const beklenenTestSayisi = sevkiyatlarSonrasiTotalTest - donemSonuToplamTest;

    // Sütun 22: Stok Doğruluk Fark = Beklenen Test (20) − Kümülatif (15)
    // Fark>0 → eksik (fire), Fark=0 → fark yok, Fark<0 → fazla
    const stokDogrulukFark = beklenenTestSayisi - row.kumulatifTotal;
    // Sapma yüzdesi: Fark / Kümülatif * 100 (kümülatif 0 ise 0)
    const stokDogrulukYuzde = row.kumulatifTotal !== 0 ? (stokDogrulukFark / row.kumulatifTotal) * 100 : 0;

    // Sütun 24: Kit Verimlilik
    // Fark: Kümülatif - Hak Ediş
    const kitVerimlilikFark = row.kumulatifTotal - row.hakEdis;
    // Sapma yüzdesi: Fark / Kümülatif * 100 (kümülatif 0 ise 0)
    const kitVerimlilikYuzde = row.kumulatifTotal !== 0 ? (kitVerimlilikFark / row.kumulatifTotal) * 100 : 0;

    return {
      ...row,
      totalAyBasiStok,
      ayBasiSevkiyatTest,
      sevkiyatlarSonrasiTotalTest,
      donemSonuToplamTest,
      beklenenTestSayisi,
      stokDogrulukFark,
      stokDogrulukYuzde,
      kitVerimlilikFark,
      kitVerimlilikYuzde,
    };
  }, []);

  // Tüm satırları yeniden hesapla (inter-lab transfer değiştiğinde)
  const recomputeAllRows = useCallback((currentRows: TableRow[], transfers: Record<string, { sourceLabId: string; sourceLabName: string; kutuAdet: number }>) => {
    return currentRows.map(row => computeRow(row, currentRows, transfers));
  }, [computeRow]);

  // Değer değişikliği handler'ı
  const handleValueChange = useCallback((rowId: string, field: EditableField, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    if (isNaN(numValue)) return;

    setRows(prevRows => {
      const updatedRows = prevRows.map(row => {
        if (row.id !== rowId) return row;
        return { ...row, [field]: numValue };
      });
      return recomputeAllRows(updatedRows, interLabTransfers);
    });
  }, [recomputeAllRows, interLabTransfers]);

  // Kurumlar Arası Sevk değişikliği - modal açar
  const handleKurumlarArasiSevkChange = useCallback((rowId: string, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    if (isNaN(numValue)) return;

    if (numValue > 0) {
      // Modal aç, kaynak lab seçimi için
      setKurumlarArasiEditingRow({ rowId, value: numValue });
      setShowKurumlarArasiModal(true);
    } else {
      // Sıfırlandıysa, inter-lab transfer'i de temizle
      const newTransfers = { ...interLabTransfers };
      delete newTransfers[rowId];
      setInterLabTransfers(newTransfers);

      setRows(prevRows => {
        const updatedRows = prevRows.map(row => {
          if (row.id !== rowId) return row;
          return { ...row, kurumlarArasiSevk: 0 };
        });
        return recomputeAllRows(updatedRows, newTransfers);
      });
    }
  }, [interLabTransfers, recomputeAllRows]);

  // Kaynak lab seçildikten sonra Kurumlar Arası Sevk'i uygula
  const handleConfirmKurumlarArasi = useCallback((sourceLabId: string) => {
    if (!kurumlarArasiEditingRow) return;

    const { rowId, value } = kurumlarArasiEditingRow;
    const sourceLab = hospitals.find(h => h.id === sourceLabId);

    // Inter-lab transfer bilgisini kaydet
    const newTransfers = {
      ...interLabTransfers,
      [rowId]: {
        sourceLabId,
        sourceLabName: sourceLab?.name || sourceLabId,
        kutuAdet: value,
      },
    };
    setInterLabTransfers(newTransfers);

    // Satırı güncelle
    setRows(prevRows => {
      const updatedRows = prevRows.map(row => {
        if (row.id !== rowId) return row;
        return { ...row, kurumlarArasiSevk: value, kurumlarArasiSevkKaynakLabId: sourceLabId };
      });
      return recomputeAllRows(updatedRows, newTransfers);
    });

    setShowKurumlarArasiModal(false);
    setKurumlarArasiEditingRow(null);
  }, [kurumlarArasiEditingRow, hospitals, interLabTransfers, recomputeAllRows]);

  // Sevkiyat Bilgisi - depodan laboratuvarlara yapılan sevkiyatları çek
  const handleFetchSevkiyatBilgisi = useCallback(async () => {
    if (!selectedDepotForSevkiyat) {
      toast({ title: 'Uyarı', description: 'Lütfen bir gönderen depo seçin.', variant: 'destructive' });
      return;
    }
    if (selectedLabsForSevkiyat.size === 0) {
      toast({ title: 'Uyarı', description: 'Lütfen en az bir alıcı laboratuvar seçin.', variant: 'destructive' });
      return;
    }

    setIsFetchingSevkiyat(true);
    try {
      // Seçilen ay için tarih aralığı oluştur (bitiş tarihini exclusive tutarak milisaniye taşmalarını önle)
      const startDate = new Date(selectedYear, selectedMonth, 1, 0, 0, 0, 0);
      const endDateExclusive = new Date(selectedYear, selectedMonth + 1, 1, 0, 0, 0, 0);

      const normalizeTransferDate = (rawDate: any): Date | null => {
        if (!rawDate) return null;

        // Firestore Timestamp
        if (rawDate?.toDate && typeof rawDate.toDate === 'function') {
          const d = rawDate.toDate();
          return d instanceof Date && !isNaN(d.getTime()) ? d : null;
        }

        if (rawDate instanceof Date) {
          return !isNaN(rawDate.getTime()) ? rawDate : null;
        }

        if (typeof rawDate === 'number') {
          // seconds veya milliseconds gelebilir
          const d = new Date(rawDate < 1e12 ? rawDate * 1000 : rawDate);
          return !isNaN(d.getTime()) ? d : null;
        }

        if (typeof rawDate === 'string') {
          // ISO formatını önce dene
          let d = new Date(rawDate);
          if (!isNaN(d.getTime())) return d;

          // DD.MM.YYYY vb. lokal formatlar
          const parts = rawDate.trim().split(/[./\-]/);
          if (parts.length === 3) {
            const [day, month, year] = parts.map(p => Number(p));
            if (Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year)) {
              d = new Date(year, month - 1, day);
              if (!isNaN(d.getTime())) return d;
            }
          }
        }

        return null;
      };

      // Seçilen depodan yapılan transferleri çek (transfers collection)
      // sourceDepotId + mode='lab' + tarih aralığı ile filtrele; lab filtrelemesi client-side
      const startTimestamp = Timestamp.fromDate(startDate);
      const endTimestamp = Timestamp.fromDate(new Date(endDateExclusive.getTime() - 1));
      const transfersQuery = scopedQuery(
        'transfers',
        currentCompanyId,
        isSuperAdmin,
        where('sourceDepotId', '==', selectedDepotForSevkiyat),
        where('mode', '==', 'lab'),
        where('timestamp', '>=', startTimestamp),
        where('timestamp', '<=', endTimestamp)
      );
      const transfersSnap = await getDocs(transfersQuery);

      // Seçilen lab ID'lerini Set olarak hazırla (doğrudan targetHospitalId ile eşleştirmek için)
      const selectedLabIds = new Set(Array.from(selectedLabsForSevkiyat));

      // Her transfer için item'ları grupla: labId -> stokKodu -> toplam adet
      const labProductCounts: Record<string, Record<string, number>> = {};

      for (const transferDoc of transfersSnap.docs) {
        const transferData = transferDoc.data();

        // Tarih filtresini client-side uygula (sunucu tarafı filtreye ek güvenlik katmanı)
        const transferTimestamp = normalizeTransferDate(
          transferData.timestamp ?? transferData.createdAt ?? transferData.sevkTarihi ?? transferData.transferDate
        );
        if (!transferTimestamp) continue;

        // Seçilen ay/yıl dönemine kesin filtre (sunucu sorgusuna ek güvenlik)
        if (transferTimestamp < startDate || transferTimestamp >= endDateExclusive) continue;
        if (transferTimestamp.getFullYear() !== selectedYear || transferTimestamp.getMonth() !== selectedMonth) continue;

        // targetHospitalId ile seçilen lab'ları doğrudan eşleştir
        const matchedLabId = transferData.targetHospitalId;
        if (!matchedLabId || !selectedLabIds.has(matchedLabId)) continue;

        // Items subcollection'ını çek (her belge = 1 adet)
        const itemsSnap = await getDocs(collection(db, 'transfers', transferDoc.id, 'items'));
        for (const itemDoc of itemsSnap.docs) {
          const stokKodu = itemDoc.data().stokKodu;
          if (!stokKodu) continue;

          if (!labProductCounts[matchedLabId]) {
            labProductCounts[matchedLabId] = {};
          }
          if (!labProductCounts[matchedLabId][stokKodu]) {
            labProductCounts[matchedLabId][stokKodu] = 0;
          }
          labProductCounts[matchedLabId][stokKodu] += 1; // Her item dokümanı = 1 adet
        }
      }

      // Satırları güncelle - sadece seçilen lab'ların verilerini güncelle
      // Aynı zamanda toast özet bilgisi için kutu dönüşümlerini topla
      const toastSummary: { labName: string; items: { stokAdi: string; kutu: number }[] }[] = [];

      setRows(prevRows => {
        // labId -> labName haritası oluştur
        const labIdToName = new Map<string, string>();
        prevRows.forEach(r => { if (!labIdToName.has(r.labId)) labIdToName.set(r.labId, r.labName); });

        const updatedRows = prevRows.map(row => {
          // Sadece seçilen lab'lara ait satırları güncelle
          if (!selectedLabsForSevkiyat.has(row.labId)) return row;
          const counts = labProductCounts[row.labId]?.[row.stokKodu] || 0;
          // transfer/items koleksiyonunda her doküman 1 kutuyu temsil eder.
          // Bu yüzden ambalaj değerine göre tekrar dönüştürme yapmadan doğrudan kutu adetini yaz.
          return { ...row, goztepeSevkiyat: counts };
        });

        // Toast özet bilgisini oluştur
        for (const labId of selectedLabsForSevkiyat) {
          const labName = labIdToName.get(labId) || labId;
          const productCounts = labProductCounts[labId];
          if (!productCounts) continue;
          const items: { stokAdi: string; kutu: number }[] = [];
          for (const [stokKodu, adet] of Object.entries(productCounts)) {
            if (adet <= 0) continue;
            const matchedRow = prevRows.find(r => r.labId === labId && r.stokKodu === stokKodu);
            const stokAdi = matchedRow?.stokAdi || stokKodu;
            const kutu = adet;
            items.push({ stokAdi, kutu });
          }
          if (items.length > 0) {
            toastSummary.push({ labName, items });
          }
        }

        return recomputeAllRows(updatedRows, interLabTransfers);
      });

      const selectedDepotName = depots.find(d => d.id === selectedDepotForSevkiyat)?.name || selectedDepotForSevkiyat;

      if (toastSummary.length === 0) {
        toast({
          title: 'Bilgi',
          description: `${selectedDepotName} deposundan seçilen laboratuvarlara ${MONTHS[selectedMonth]?.label} ${selectedYear} döneminde sevkiyat bulunamadı.`,
        });
      } else {
        const totalSevkiyat = transfersSnap.docs.length;
        toast({
          title: 'Sevkiyat Verileri Çekildi',
          description: (
            <div className="mt-1 space-y-2 max-h-60 overflow-y-auto text-sm">
              <div className="font-medium">{selectedDepotName} &rarr; {toastSummary.length} laboratuvar ({totalSevkiyat} sevkiyat kaydı)</div>
              {toastSummary.map((lab, i) => (
                <div key={i}>
                  <div className="font-medium text-primary">{lab.labName}</div>
                  <ul className="ml-3 list-disc list-inside">
                    {lab.items.map((item, j) => (
                      <li key={j}>{item.stokAdi}: <strong>{item.kutu} kutu</strong></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ),
          duration: 10000,
        });
      }
    } catch (error) {
      totalVerimlilikLogger.error('Sevkiyat bilgisi çekilirken hata oluştu', error, {
        selectedDepot: selectedDepotForSevkiyat,
        selectedLabs: Array.from(selectedLabsForSevkiyat),
        month: selectedMonth,
        year: selectedYear,
      });
      toast({ title: 'Hata', description: 'Sevkiyat verileri çekilirken hata oluştu.', variant: 'destructive' });
    } finally {
      setIsFetchingSevkiyat(false);
      setShowSevkiyatBilgisiModal(false);
      setSelectedLabsForSevkiyat(new Set());
      setSelectedDepotForSevkiyat('');
    }
  }, [selectedDepotForSevkiyat, selectedLabsForSevkiyat, selectedYear, selectedMonth, depots, hospitals, toast, recomputeAllRows, interLabTransfers]);

  // Listedeki laboratuvarlar (verimlilik havuzundaki)
  const poolLabIds = useMemo(() => {
    const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
    return selectedPool?.memberIds || [];
  }, [selectedPoolId, efficiencyPools]);

  const poolLabs = useMemo(() => {
    return hospitals.filter(h => poolLabIds.includes(h.id));
  }, [hospitals, poolLabIds]);

  // Excel export
  const handleExportExcel = useCallback(() => {
    if (rows.length === 0) return;

    const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
    // Marka/grup filtresi artık client-side; export de görüntülenen alt kümeyi
    // yansıtsın (eski davranış).
    const rowsToExport = (selectedBrand || selectedUrunGrubu)
      ? rows.filter(r => {
          const p = productCodes.find(pc => pc.stokKodu === r.stokKodu);
          if (selectedBrand && p?.marka !== selectedBrand) return false;
          if (selectedUrunGrubu && p?.urunGrubu !== selectedUrunGrubu) return false;
          return true;
        })
      : rows;
    const dataToExport = rowsToExport.map(r => {
      // Stok Doğruluk Fark paneldeki gibi ters işaretle gösterilir
      // (eksik = negatif, fazla = pozitif).
      const stokFarkExcel = r.stokDogrulukFark !== 0 ? -r.stokDogrulukFark : 0;
      const kitFarkExcel = r.kitVerimlilikFark !== 0 ? -r.kitVerimlilikFark : 0;
      // Kutu Kayıp: arayüzdeki işaretin AYNISI (eksik → +, fazla → −).
      // Stok Doğruluk Fark / Ambalaj — negatiflenmez ki Excel ile arayüz uyuşsun.
      const kutuKayip = r.ambalajDegeri > 0 ? r.stokDogrulukFark / r.ambalajDegeri : 0;
      // Stok Doğruluk durum etiketi (arayüzdeki badge ile birebir)
      const stokDurum = r.stokDogrulukFark > 0 ? 'Eksik' : (r.stokDogrulukFark < 0 ? 'Fazla' : 'Fark Yok');

      return {
        'Laboratuvar': r.labName,
        'Lab Kodu': r.labKod,
        'Stok Kodu': r.stokKodu,
        'Ürün Adı': r.stokAdi,
        'Test Adı': r.testAdi,
        'Ambalaj Miktarı': r.ambalajDegeri,
        'Cihaz Grubu': r.cihazGrubu,
        'Başlangıç Stoğu (Kutu)': r.baslangicStokuKutu,
        'Ay Başı Cihaz Üstü (Test)': r.ayBasiCihazUstuTest,
        'Total Ay Başı Stok (Test)': r.totalAyBasiStok,
        'Ay Başı Sevkiyat (Kutu)': r.ayBasiSevkiyatKutu,
        'Ay Başı Sevkiyat (Test)': r.ayBasiSevkiyatTest,
        'Göztepe Sevkiyat (Kutu)': r.goztepeSevkiyat,
        'Kurumlar Arası Sevk (Kutu)': r.kurumlarArasiSevk,
        'Kaynak Lab': interLabTransfers[r.id]?.sourceLabName || '',
        'Lojistik Ara Transfer (Kutu)': r.lojistikAraTransfer,
        'Sevkiyatlar Sonrası Total Test': r.sevkiyatlarSonrasiTotalTest,
        // Phase 3
        'Kümülatif Total (Test)': r.kumulatifTotal,
        'Dönem Sonu Stok (Kutu)': r.donemSonuStokKutu,
        'Dönem Sonu Cihaz Üstü (Test)': r.donemSonuCihazUstuTest,
        'Dönem Sonu Toplam Test': r.donemSonuToplamTest,
        'Arızalı Kitler (Test)': r.arizaliKitTest,
        'Beklenen Test (Test)': r.beklenenTestSayisi,
        'Hak Ediş (Test)': r.hakEdis,
        // Phase 4 — Stok Doğruluk ve Kutu Kayıp yan yana (panel sırasıyla aynı)
        'Stok Doğruluk Fark (Test)': stokFarkExcel,
        'Stok Doğruluk Durum': stokDurum,
        'Kutu Kayıp': Number(kutuKayip.toFixed(1)),
        'Kit Verimlilik Fark (Test)': kitFarkExcel,
        'Stok Doğruluk Sapma (%)': Number(r.stokDogrulukYuzde.toFixed(2)),
        'Kit Verimlilik Sapma (%)': Number(r.kitVerimlilikYuzde.toFixed(2)),
      };
    });

    const fileName = `Total_Verimlilik_${selectedPool?.name || 'Rapor'}_${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
    exportDataToExcel(dataToExport, fileName, 'Veriler', toast);
  }, [rows, selectedPoolId, efficiencyPools, selectedYear, selectedMonth, toast, interLabTransfers, selectedBrand, selectedUrunGrubu, productCodes]);

  // Phase 5 - Excel Dosyası Yükle ve Verileri Aktar
  const handleExcelImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImportingExcel(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];

        // Excel verilerini satırlara eşle
        let updatedCount = 0;

        setRows(prevRows => {
          const updatedRows = prevRows.map(row => {
            // Excel'de aynı stok kodunu ve lab kodunu bul
            const excelRow = jsonData.find((excelR) =>
              excelR['Stok Kodu'] === row.stokKodu &&
              (excelR['Lab Kodu'] === row.labKod || excelR['Laboratuvar'] === row.labName)
            );

            if (!excelRow) return row;

            updatedCount++;

            // Sadece belirtilen sütunları güncelle
            const getNumValue = (key: string): number => {
              const val = excelRow[key];
              if (val === '' || val === null || val === undefined) return row[key as keyof TableRow] as number || 0;
              const num = parseFloat(String(val));
              return isNaN(num) ? 0 : num;
            };

            return {
              ...row,
              baslangicStokuKutu: getNumValue('7. Başlangıç Stoğu (Kutu)'),
              ayBasiCihazUstuTest: getNumValue('8. Ay Başı Cihaz Üstü (Test)'),
              ayBasiSevkiyatKutu: getNumValue('10. Ay Başı Sevkiyat (Kutu)'),
              lojistikAraTransfer: getNumValue('13. Lojistik Ara Transfer (Kutu)'),
              kumulatifTotal: getNumValue('15. Kümülatif Total (Test)'),
              donemSonuStokKutu: getNumValue('16. Dönem Sonu Stok (Kutu)'),
              donemSonuCihazUstuTest: getNumValue('17. Dönem Sonu Cihaz Üstü (Test)'),
              hakEdis: getNumValue('19. Hak Ediş (Test)'),
            };
          });

          return recomputeAllRows(updatedRows, interLabTransfers);
        });

        toast({
          title: 'Veriler Aktarıldı',
          description: `${updatedCount} satır güncellendi.`,
        });
      } catch (error) {
        totalVerimlilikLogger.error('Excel dosyası içe aktarılırken hata oluştu', error);
        toast({
          title: 'Hata',
          description: 'Excel dosyası okunurken bir hata oluştu.',
          variant: 'destructive',
        });
      } finally {
        setIsImportingExcel(false);
        setShowExcelImportModal(false);
        // File input'u temizle
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };

    reader.readAsBinaryString(file);
  }, [toast, recomputeAllRows, interLabTransfers]);

  // Kaydetme
  const handleSave = useCallback(async () => {
    if (!selectedPoolId || rows.length === 0) return;

    setIsSaving(true);
    try {
      const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
      const docId = `${selectedPoolId}-${selectedYear}-${selectedMonth}`;

      // Verimlilik metriklerini hesapla
      let toplamKumulatif = 0;
      let toplamBeklenenTuketim = 0;
      let toplamHakEdis = 0;

      rows.forEach(row => {
        toplamKumulatif += row.kumulatifTotal;
        toplamBeklenenTuketim += (row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest);
        toplamHakEdis += row.hakEdis;
      });

      const stokSapmaYuzde = toplamKumulatif !== 0
        ? ((toplamBeklenenTuketim - toplamKumulatif) / toplamKumulatif) * 100
        : 0;
      const kitSapmaYuzde = toplamKumulatif !== 0
        ? ((toplamKumulatif - toplamHakEdis) / toplamKumulatif) * 100
        : 0;
      const stokDogrulukSkoru = Math.max(0, Math.min(100, 100 - Math.abs(stokSapmaYuzde)));
      const kitVerimlilikSkoru = Math.max(0, Math.min(100, 100 - Math.abs(kitSapmaYuzde)));
      const genelVerimlilik = (stokDogrulukSkoru + kitVerimlilikSkoru) / 2;

      const dataToSave = {
        poolId: selectedPoolId,
        poolName: selectedPool?.name || '',
        month: selectedMonth,
        year: selectedYear,
        rows: rows,
        // Verimlilik metrikleri
        efficiencyMetrics: {
          toplamKumulatif,
          toplamBeklenenTuketim,
          toplamHakEdis,
          stokSapmaYuzde,
          kitSapmaYuzde,
          stokDogrulukSkoru,
          kitVerimlilikSkoru,
          genelVerimlilik,
        },
        createdAt: Timestamp.now(),
        createdByUid: currentUser?.uid || '',
        createdByName: currentUser?.name || currentUser?.email || '',
        updatedAt: Timestamp.now(),
      };

      await setDoc(doc(db, 'totalEfficiencyRecords', docId), dataToSave, { merge: true });
      toast({ title: 'Kaydedildi', description: `Total verimlilik verileri kaydedildi. Genel Verimlilik: %${genelVerimlilik.toFixed(1)}` });
    } catch (error) {
      totalVerimlilikLogger.error('Total verimlilik kaydedilirken hata oluştu', error, {
        poolId: selectedPoolId,
        month: selectedMonth,
        year: selectedYear,
        rowCount: rows.length,
      });
      toast({ title: 'Hata', description: 'Kayıt sırasında bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [selectedPoolId, rows, selectedYear, selectedMonth, currentUser, efficiencyPools, toast]);

  // Ara Kayıt (Checkpoint) Kaydetme
  const handleAraKayitSave = useCallback(async () => {
    if (!selectedPoolId || rows.length === 0) return;

    setIsSavingAraKayit(true);
    try {
      const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
      const araKayitDocId = `araKayit-${selectedPoolId}-${selectedYear}-${selectedMonth}`;

      const dataToSave = {
        poolId: selectedPoolId,
        poolName: selectedPool?.name || '',
        month: selectedMonth,
        year: selectedYear,
        rows: rows,
        interLabTransfers: interLabTransfers, // Kurumlar arası transferleri de kaydet
        isAraKayit: true, // Ara kayıt olduğunu belirt
        createdAt: araKayitInfo?.exists ? araKayitInfo.savedAt : Timestamp.now(),
        createdByUid: currentUser?.uid || '',
        createdByName: currentUser?.name || currentUser?.email || '',
        updatedAt: Timestamp.now(),
      };

      await setDoc(doc(db, 'totalEfficiencyRecords', araKayitDocId), dataToSave, { merge: true });

      setAraKayitInfo({
        exists: true,
        savedAt: new Date(),
        savedBy: currentUser?.name || currentUser?.email || 'Bilinmiyor',
      });

      toast({
        title: 'Ara Kayıt Alındı',
        description: `${selectedPool?.name} havuzu için ${MONTHS[selectedMonth]?.label} ${selectedYear} dönemi ara kaydı alındı.`,
      });
    } catch (error) {
      console.error('Error saving ara kayit:', error);
      toast({ title: 'Hata', description: 'Ara kayıt sırasında bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsSavingAraKayit(false);
    }
  }, [selectedPoolId, rows, selectedYear, selectedMonth, currentUser, efficiencyPools, interLabTransfers, araKayitInfo, toast]);

  // Laboratuvar gruplarını hesapla (aynı laboratuvarın satırlarını gruplamak için)
  const labGroups = useMemo(() => {
    const groups: { labId: string; labName: string; startIndex: number; count: number }[] = [];
    let currentLabId = '';
    let startIndex = 0;
    let count = 0;

    rows.forEach((row, index) => {
      if (row.labId !== currentLabId) {
        if (currentLabId) {
          groups.push({ labId: currentLabId, labName: rows[startIndex].labName, startIndex, count });
        }
        currentLabId = row.labId;
        startIndex = index;
        count = 1;
      } else {
        count++;
      }
    });

    if (currentLabId) {
      groups.push({ labId: currentLabId, labName: rows[startIndex].labName, startIndex, count });
    }

    return groups;
  }, [rows]);

  // Marka ve Ürün Grubu seçenekleri (ürün kodlarından çek)
  const brandAndGroupOptions = useMemo(() => {
    const brands = new Set<string>();
    const groups = new Set<string>();

    productCodes.forEach(pc => {
      if (pc.marka) brands.add(pc.marka);
      if (pc.urunGrubu) groups.add(pc.urunGrubu);
    });

    return {
      brands: Array.from(brands).sort((a, b) => a.localeCompare(b, 'tr')),
      groups: Array.from(groups).sort((a, b) => a.localeCompare(b, 'tr')),
    };
  }, [productCodes]);

  // Ürün grubu Türkçe etiketleri
  const urunGrubuLabels: Record<string, string> = {
    'kit': 'Kit',
    'sarf': 'Sarf Malzemesi',
    'yedek_parca': 'Yedek Parça',
  };

  // Filter için benzersiz değerleri hesapla
  const uniqueFilterValues = useMemo(() => {
    const labNames = new Set<string>();
    const stokAdlari = new Set<string>();
    const testAdlari = new Set<string>();
    const cihazGruplari = new Set<string>();

    rows.forEach(row => {
      if (row.labName) labNames.add(row.labName);
      if (row.stokAdi) stokAdlari.add(row.stokAdi);
      if (row.testAdi) testAdlari.add(row.testAdi);
      if (row.cihazGrubu) cihazGruplari.add(row.cihazGrubu);
    });

    return {
      labName: Array.from(labNames).sort((a, b) => a.localeCompare(b, 'tr')),
      stokAdi: Array.from(stokAdlari).sort((a, b) => a.localeCompare(b, 'tr')),
      testAdi: Array.from(testAdlari).sort((a, b) => a.localeCompare(b, 'tr')),
      cihazGrubu: Array.from(cihazGruplari).sort((a, b) => a.localeCompare(b, 'tr')),
    };
  }, [rows]);

  // Filtrelenmiş ve sıralanmış satırlar
  // stokKodu → ürün meta (marka / ürün grubu) — client-side marka/grup filtresi
  // için hızlı arama.
  const productMetaByCode = useMemo(() => {
    const m = new Map<string, { marka?: string; urunGrubu?: string }>();
    productCodes.forEach(p => m.set(p.stokKodu, { marka: p.marka, urunGrubu: p.urunGrubu }));
    return m;
  }, [productCodes]);

  // Marka / ürün grubu filtresi GÖRÜNÜM aşamasında uygulanır (veri yeniden
  // çekilmez). Bu ara küme, eskiden `rows`'un brand-filtreli hâliyle aynı role
  // sahip: özet metrikler ve tablo bunun üzerinden çalışır; `rows` (tam küme)
  // ise hesaplama ve kayıt için bozulmadan kalır.
  const brandGroupFilteredRows = useMemo(() => {
    if (!selectedBrand && !selectedUrunGrubu) return rows;
    return rows.filter(row => {
      const meta = productMetaByCode.get(row.stokKodu);
      if (selectedBrand && meta?.marka !== selectedBrand) return false;
      if (selectedUrunGrubu && meta?.urunGrubu !== selectedUrunGrubu) return false;
      return true;
    });
  }, [rows, selectedBrand, selectedUrunGrubu, productMetaByCode]);

  const filteredAndSortedRows = useMemo(() => {
    let result = [...brandGroupFilteredRows];

    // Search filter
    if (searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(row =>
        row.labName.toLowerCase().includes(lowerSearch) ||
        row.stokKodu.toLowerCase().includes(lowerSearch) ||
        row.stokAdi.toLowerCase().includes(lowerSearch) ||
        row.testAdi.toLowerCase().includes(lowerSearch) ||
        row.cihazGrubu.toLowerCase().includes(lowerSearch)
      );
    }

    // Column filters
    if (columnFilters.labName.size > 0) {
      result = result.filter(row => columnFilters.labName.has(row.labName));
    }
    if (columnFilters.stokAdi.size > 0) {
      result = result.filter(row => columnFilters.stokAdi.has(row.stokAdi));
    }
    if (columnFilters.testAdi.size > 0) {
      result = result.filter(row => columnFilters.testAdi.has(row.testAdi));
    }
    if (columnFilters.cihazGrubu.size > 0) {
      result = result.filter(row => columnFilters.cihazGrubu.has(row.cihazGrubu));
    }

    // Sorting
    if (sortConfig.column) {
      result.sort((a, b) => {
        const aVal = Math.abs(a[sortConfig.column!]);
        const bVal = Math.abs(b[sortConfig.column!]);
        if (sortConfig.direction === 'asc') {
          return aVal - bVal;
        } else {
          return bVal - aVal;
        }
      });
    }

    return result;
  }, [brandGroupFilteredRows, searchTerm, columnFilters, sortConfig]);

  // Deferred value ile ağır tablo render'larında UI'ın bloke olmasını engelle
  const deferredRows = useDeferredValue(filteredAndSortedRows);

  // Filter toggle helper
  const toggleFilterValue = useCallback((
    filterKey: 'labName' | 'stokAdi' | 'testAdi' | 'cihazGrubu',
    value: string
  ) => {
    setColumnFilters(prev => {
      const newSet = new Set(prev[filterKey]);
      if (newSet.has(value)) {
        newSet.delete(value);
      } else {
        newSet.add(value);
      }
      return { ...prev, [filterKey]: newSet };
    });
  }, []);

  // Select all / deselect all helper
  const setAllFilterValues = useCallback((
    filterKey: 'labName' | 'stokAdi' | 'testAdi' | 'cihazGrubu',
    values: string[],
    select: boolean
  ) => {
    setColumnFilters(prev => ({
      ...prev,
      [filterKey]: select ? new Set(values) : new Set(),
    }));
  }, []);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setColumnFilters({
      labName: new Set(),
      stokAdi: new Set(),
      testAdi: new Set(),
      cihazGrubu: new Set(),
    });
    setSortConfig({ column: null, direction: 'asc' });
    setSearchTerm('');
  }, []);

  // Toggle sort
  const toggleSort = useCallback((column: 'stokDogrulukFark' | 'kitVerimlilikFark') => {
    setSortConfig(prev => {
      if (prev.column === column) {
        if (prev.direction === 'asc') {
          return { column, direction: 'desc' };
        } else {
          return { column: null, direction: 'asc' };
        }
      }
      return { column, direction: 'asc' };
    });
  }, []);

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return columnFilters.labName.size > 0 ||
      columnFilters.stokAdi.size > 0 ||
      columnFilters.testAdi.size > 0 ||
      columnFilters.cihazGrubu.size > 0 ||
      sortConfig.column !== null ||
      searchTerm.trim() !== '';
  }, [columnFilters, sortConfig, searchTerm]);

  // Genel Verimlilik Hesaplaması — özet, görüntülenen marka/grup alt kümesini
  // yansıtır (eski davranış: marka seçilince skor o markaya aitti).
  const efficiencyMetrics = useMemo(() => {
    if (brandGroupFilteredRows.length === 0) {
      return {
        toplamKumulatif: 0,
        toplamBeklenenTuketim: 0,
        toplamHakEdis: 0,
        stokSapmaYuzde: 0,
        kitSapmaYuzde: 0,
        stokDogrulukSkoru: 100,
        kitVerimlilikSkoru: 100,
        genelVerimlilik: 100,
      };
    }

    // Toplam değerleri hesapla
    let toplamKumulatif = 0;
    let toplamBeklenenTuketim = 0;
    let toplamHakEdis = 0;

    brandGroupFilteredRows.forEach(row => {
      toplamKumulatif += row.kumulatifTotal;
      toplamBeklenenTuketim += (row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest);
      toplamHakEdis += row.hakEdis;
    });

    // Sapma oranlarını hesapla (kümülatif 0 ise 0 sapma)
    const stokSapmaYuzde = toplamKumulatif !== 0
      ? ((toplamBeklenenTuketim - toplamKumulatif) / toplamKumulatif) * 100
      : 0;

    const kitSapmaYuzde = toplamKumulatif !== 0
      ? ((toplamKumulatif - toplamHakEdis) / toplamKumulatif) * 100
      : 0;

    // Verimlilik skorları (sapma → verimlilik dönüşümü, 0-100 arası)
    const stokDogrulukSkoru = Math.max(0, Math.min(100, 100 - Math.abs(stokSapmaYuzde)));
    const kitVerimlilikSkoru = Math.max(0, Math.min(100, 100 - Math.abs(kitSapmaYuzde)));

    // Genel verimlilik
    const genelVerimlilik = (stokDogrulukSkoru + kitVerimlilikSkoru) / 2;

    return {
      toplamKumulatif,
      toplamBeklenenTuketim,
      toplamHakEdis,
      stokSapmaYuzde,
      kitSapmaYuzde,
      stokDogrulukSkoru,
      kitVerimlilikSkoru,
      genelVerimlilik,
    };
  }, [brandGroupFilteredRows]);

  // Sütun 23: Maliyet hesaplama yardımcı fonksiyonu
  const calculateRowCost = useCallback((row: TableRow): { cost: number; hasData: boolean } => {
    if (!exchangeRates) return { cost: 0, hasData: false };

    // Öncelikle checkpoint'ten maliyet bilgisini al, yoksa ürün bilgisinden al
    let productCost: number | undefined;
    let productCurrency: 'EUR' | 'USD' | 'TRY' = 'EUR';

    if (costCheckpointData && costCheckpointData[row.stokKodu]) {
      // Checkpoint'ten maliyet al
      productCost = costCheckpointData[row.stokKodu].cost;
      productCurrency = costCheckpointData[row.stokKodu].currency;
    } else {
      // Ürün bilgisinden al (fallback)
      const product = productCodes.find(p => p.stokKodu === row.stokKodu);
      if (product && product.cost && product.cost > 0) {
        productCost = product.cost;
        productCurrency = (product.currency as 'EUR' | 'USD' | 'TRY') || 'EUR';
      }
    }

    if (!productCost || productCost === 0) {
      return { cost: 0, hasData: false };
    }

    // Dönem içi sarfiyat (test cinsinden) = Sütun 14 - Sütun 18
    const sarfiyat = row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest;
    if (sarfiyat <= 0) return { cost: 0, hasData: true };

    // Ambalaj değeri (1 kutuda kaç test var)
    const ambalaj = row.ambalajDegeri || 1;

    // Test başına maliyet = Kutu maliyeti / Ambalaj
    const productCostInEur = productCurrency === 'EUR'
      ? productCost
      : productCurrency === 'USD'
        ? productCost / exchangeRates.USD
        : productCost / exchangeRates.TRY; // TRY

    const costPerTestInEur = productCostInEur / ambalaj;

    // Toplam maliyet (EUR cinsinden)
    const totalCostInEur = sarfiyat * costPerTestInEur;

    // Seçilen para birimine çevir
    let finalCost = totalCostInEur;
    if (costCurrency === 'USD') {
      finalCost = totalCostInEur * exchangeRates.USD;
    } else if (costCurrency === 'TRY') {
      finalCost = totalCostInEur * exchangeRates.TRY;
    }

    return { cost: finalCost, hasData: true };
  }, [productCodes, exchangeRates, costCurrency, costCheckpointData]);

  // Toplam maliyet hesapla
  const totalCost = useMemo(() => {
    let total = 0;
    rows.forEach(row => {
      const { cost } = calculateRowCost(row);
      total += cost;
    });
    return total;
  }, [rows, calculateRowCost]);

  // Sütun 24: Hak Ediş Karşılığı hesaplama yardımcı fonksiyonu
  // hakEdisMiktari (TL) × row.hakEdis (test sayısı) = toplam TL karşılık
  const calculateHakEdisKarsiligi = useCallback((row: TableRow, useAdjusted: boolean = false): { amount: number; hasData: boolean } => {
    if (!exchangeRates) return { amount: 0, hasData: false };

    // Bu laboratuvarın hak ediş tanımlarından ilgili ürünü bul
    const labDefinitions = labHakEdisDefinitions[row.labId] || [];
    const hakEdisDefinition = labDefinitions.find(d => d.linkedStokKodu === row.stokKodu);

    if (!hakEdisDefinition || hakEdisDefinition.hakEdisMiktari <= 0) {
      return { amount: 0, hasData: false };
    }

    // Hak ediş test sayısı (Sütun 19) - merkez hak ediş modu aktifse düzeltilmiş değeri kullan
    let hakEdisTestSayisi = row.hakEdis || 0;
    if (useAdjusted && centerHakEdisMode) {
      const sentCount = testsSentToCenter[row.id] || 0;
      hakEdisTestSayisi = Math.max(0, hakEdisTestSayisi - sentCount);
    }
    if (hakEdisTestSayisi <= 0) {
      return { amount: 0, hasData: true };
    }

    // Toplam TL karşılık = test başına TL × test sayısı
    const toplamTL = hakEdisDefinition.hakEdisMiktari * hakEdisTestSayisi;

    // Seçilen para birimine çevir
    let finalAmount = toplamTL;
    if (costCurrency === 'USD') {
      // TL -> EUR -> USD
      finalAmount = (toplamTL / exchangeRates.TRY) * exchangeRates.USD;
    } else if (costCurrency === 'EUR') {
      // TL -> EUR
      finalAmount = toplamTL / exchangeRates.TRY;
    }
    // TRY ise zaten TL cinsinden

    return { amount: finalAmount, hasData: true };
  }, [labHakEdisDefinitions, exchangeRates, costCurrency, centerHakEdisMode, testsSentToCenter]);

  // Toplam hak ediş karşılığı hesapla
  const totalHakEdisKarsiligi = useMemo(() => {
    let total = 0;
    rows.forEach(row => {
      const { amount } = calculateHakEdisKarsiligi(row);
      total += amount;
    });
    return total;
  }, [rows, calculateHakEdisKarsiligi]);

  // Sütun 25: Kâr hesaplama yardımcı fonksiyonu (24 - 23)
  const calculateKar = useCallback((row: TableRow, useAdjusted: boolean = false): { kar: number; hasData: boolean } => {
    const { amount: hakEdisKarsiligi, hasData: hasHakEdis } = calculateHakEdisKarsiligi(row, useAdjusted);
    const { cost: sarfiyatMaliyeti, hasData: hasCost } = calculateRowCost(row);

    if (!hasHakEdis && !hasCost) {
      return { kar: 0, hasData: false };
    }

    // Kâr = Hak Ediş Karşılığı - Sarfiyat Maliyeti
    const kar = hakEdisKarsiligi - sarfiyatMaliyeti;

    return { kar, hasData: true };
  }, [calculateHakEdisKarsiligi, calculateRowCost]);

  // Toplam kâr hesapla
  const totalKar = useMemo(() => {
    let total = 0;
    rows.forEach(row => {
      const { kar } = calculateKar(row);
      total += kar;
    });
    return total;
  }, [rows, calculateKar]);

  // Sütun 26: Zarar Maliyeti hesaplama yardımcı fonksiyonu
  // Zarar Maliyeti = Stok Doğruluk Fark (20) × (Ürün Maliyeti / Ambalaj)
  const calculateZararMaliyeti = useCallback((row: TableRow): { zarar: number; hasData: boolean } => {
    if (!exchangeRates) return { zarar: 0, hasData: false };

    // Stok doğruluk farkı (pozitif değer = fire/kayıp, negatif değer = tasarruf)
    const farkTest = row.stokDogrulukFark;

    // Eğer fark 0 veya negatifse zarar yok
    if (farkTest <= 0) {
      return { zarar: 0, hasData: true };
    }

    // Ürün maliyetini bul (önce checkpoint, sonra ürün bilgisinden)
    let productCost: number | undefined;
    let productCurrency: 'EUR' | 'USD' | 'TRY' = 'EUR';

    if (costCheckpointData && costCheckpointData[row.stokKodu]) {
      productCost = costCheckpointData[row.stokKodu].cost;
      productCurrency = costCheckpointData[row.stokKodu].currency;
    } else {
      const product = productCodes.find(p => p.stokKodu === row.stokKodu);
      if (product && product.cost && product.cost > 0) {
        productCost = product.cost;
        productCurrency = product.currency || 'EUR';
      }
    }

    if (!productCost || productCost <= 0) {
      return { zarar: 0, hasData: false };
    }

    // Ambalaj değeri (0 veya tanımsız ise 1 varsay)
    const ambalaj = row.ambalajDegeri > 0 ? row.ambalajDegeri : 1;

    // Ürün maliyetini EUR'a çevir
    let productCostInEur = productCost;
    if (productCurrency === 'USD') {
      productCostInEur = productCost / exchangeRates.USD;
    } else if (productCurrency === 'TRY') {
      productCostInEur = productCost / exchangeRates.TRY;
    }

    // Test başına maliyet (EUR)
    const costPerTestInEur = productCostInEur / ambalaj;

    // Toplam zarar maliyeti (EUR)
    const totalZararInEur = farkTest * costPerTestInEur;

    // Seçilen para birimine çevir
    let finalZarar = totalZararInEur;
    if (costCurrency === 'USD') {
      finalZarar = totalZararInEur * exchangeRates.USD;
    } else if (costCurrency === 'TRY') {
      finalZarar = totalZararInEur * exchangeRates.TRY;
    }

    return { zarar: finalZarar, hasData: true };
  }, [productCodes, exchangeRates, costCurrency, costCheckpointData]);

  // Toplam zarar maliyeti hesapla
  const totalZararMaliyeti = useMemo(() => {
    let total = 0;
    rows.forEach(row => {
      const { zarar } = calculateZararMaliyeti(row);
      total += zarar;
    });
    return total;
  }, [rows, calculateZararMaliyeti]);

  // Merkez laboratuvar bilgisi
  const selectedPool = useMemo(() => {
    return efficiencyPools.find(p => p.id === selectedPoolId);
  }, [efficiencyPools, selectedPoolId]);

  const centerLab = useMemo(() => {
    if (!selectedPool?.centerLabId) return null;
    return hospitals.find(h => h.id === selectedPool.centerLabId) || null;
  }, [selectedPool, hospitals]);

  // Merkez Hak Edişi Hesaplama Fonksiyonu
  const calculateCenterHakEdis = useCallback(async () => {
    if (!selectedPool?.centerLabId) {
      toast({ title: 'Uyarı', description: 'Bu havuzda merkez laboratuvar tanımlanmamış.', variant: 'destructive' });
      return;
    }

    const centerLabInfo = hospitals.find(h => h.id === selectedPool.centerLabId);
    if (!centerLabInfo?.kod) {
      toast({ title: 'Uyarı', description: 'Merkez laboratuvarın kodu tanımlı değil.', variant: 'destructive' });
      return;
    }

    setIsCalculatingCenterHakEdis(true);

    try {
      // İş analizi raw verisini çek (her zaman güncel veri için yeniden çek)
      const analysisDocRef = doc(db, 'isAnaliziVerileri', 'sonVeri');
      const docSnap = await getDoc(analysisDocRef);

      if (!docSnap.exists()) {
        toast({ title: 'Uyarı', description: 'İş analizi verisi bulunamadı. Önce LBYS Veri Yönetimi panelinden veri yükleyin.', variant: 'destructive' });
        setIsCalculatingCenterHakEdis(false);
        return;
      }

      const rawData = docSnap.data().rawData || [];
      setIsAnaliziRawData(rawData);

      if (rawData.length === 0) {
        toast({ title: 'Uyarı', description: 'İş analizi verisinde kayıt bulunamadı.', variant: 'destructive' });
        setIsCalculatingCenterHakEdis(false);
        return;
      }

      totalVerimlilikLogger.debug('Merkez hak ediş hesaplama başlatıldı', {
        rawDataCount: rawData.length,
        selectedPeriod: `${selectedYear}-${selectedMonth + 1}`,
        labDefinitionsCount: Object.keys(labHakEdisDefinitions).length,
      });

      // Seçilen dönemin başlangıç ve bitiş tarihlerini hesapla
      const periodStart = new Date(selectedYear, selectedMonth, 1);
      const periodEnd = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);

      // Her satır için merkeze gönderilen test sayısını hesapla
      const sentToCenter: Record<string, number> = {};
      let debugInfo: string[] = [];

      for (const row of rows) {
        // Merkez laboratuvarı atla (merkez kendi kendine test göndermez)
        if (row.labId === selectedPool.centerLabId) {
          sentToCenter[row.id] = 0;
          continue;
        }

        // Bu satırın laboratuvarının kodunu bul
        const labInfo = hospitals.find(h => h.id === row.labId);
        if (!labInfo?.kod) {
          debugInfo.push(`${row.labName}: Lab kodu tanımlı değil`);
          sentToCenter[row.id] = 0;
          continue;
        }

        // 999 kodlu ASM'leri atla
        if (labInfo.kod === '999') {
          sentToCenter[row.id] = 0;
          continue;
        }

        // Bu ürüne bağlı hak ediş tanımından SUT kodunu bul
        const labDefinitions = labHakEdisDefinitions[row.labId] || [];
        const hakEdisDefinition = labDefinitions.find(d => d.linkedStokKodu === row.stokKodu);

        if (!hakEdisDefinition) {
          debugInfo.push(`${row.labName} - ${row.stokAdi}: Hak ediş tanımı bulunamadı (stokKodu: ${row.stokKodu})`);
          sentToCenter[row.id] = 0;
          continue;
        }

        const sutTestAdi = String(hakEdisDefinition.sutTestAdi || '').trim().toLowerCase();
        const labKod = String(labInfo.kod || '').trim();

        totalVerimlilikLogger.debug('Test eşleşmesi aranıyor', {
          labKod,
          sutTestAdi: hakEdisDefinition.sutTestAdi,
          stokAdi: row.stokAdi,
        });

        // İş analizi verisinde eşleşmeleri say
        let testCount = 0;
        let matchedRecords: any[] = [];

        for (const record of rawData) {
          // Hastane ID kontrolü - normalize et ve karşılaştır
          const recordHastaneId = String(record.hastaneId || '').trim();
          if (recordHastaneId !== labKod) continue;

          // Test ADI kontrolü - test adı eşleşmesi (testId yerine testAdi kullan)
          // rawData'daki testAdi ile hakEdisDefinition'daki sutTestAdi'yı karşılaştır
          const recordTestAdi = String(record.testAdi || '').trim().toLowerCase();
          if (recordTestAdi !== sutTestAdi && !recordTestAdi.includes(sutTestAdi) && !sutTestAdi.includes(recordTestAdi)) continue;

          // Tarih kontrolü - seçilen dönem içinde mi?
          const recordDate = record.labKabulTarihi || record.istemTarihi || record.kayitTarihi;
          if (recordDate) {
            let dateObj: Date | null = null;

            if (typeof recordDate === 'number') {
              // Excel date number (serial date)
              dateObj = new Date(Math.round((recordDate - 25569) * 86400 * 1000));
            } else if (recordDate instanceof Date) {
              dateObj = recordDate;
            } else if (typeof recordDate === 'string') {
              // Farklı tarih formatlarını dene
              dateObj = new Date(recordDate);
              if (isNaN(dateObj.getTime())) {
                // DD.MM.YYYY formatı dene
                const parts = recordDate.split(/[./\-]/);
                if (parts.length === 3) {
                  dateObj = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
                }
              }
            } else if (recordDate?.toDate) {
              // Firestore Timestamp
              dateObj = recordDate.toDate();
            }

            if (dateObj && !isNaN(dateObj.getTime())) {
              if (dateObj < periodStart || dateObj > periodEnd) continue;
            }
          }

          testCount++;
          if (matchedRecords.length < 3) {
            matchedRecords.push(record);
          }
        }

        if (testCount > 0) {
          totalVerimlilikLogger.debug('Eşleşme bulundu', {
            labName: row.labName,
            stokAdi: row.stokAdi,
            testCount,
            sampleRecords: matchedRecords.length,
          });
        }

        sentToCenter[row.id] = testCount;
      }

      // Debug bilgilerini loga yaz
      if (debugInfo.length > 0) {
        totalVerimlilikLogger.debug('Merkez hak ediş hesaplama debug bilgileri', {
          warnings: debugInfo,
        });
      }

      // rawData istatistiklerini loga yaz
      const uniqueHastaneIds = [...new Set(rawData.map((r: any) => String(r.hastaneId || '').trim()))];
      const uniqueTestAdis = [...new Set(rawData.map((r: any) => String(r.testAdi || '').trim()))];

      totalVerimlilikLogger.debug('Raw data istatistikleri', {
        uniqueHastaneIdCount: uniqueHastaneIds.length,
        uniqueTestAdiCount: uniqueTestAdis.length,
      });

      setTestsSentToCenter(sentToCenter);
      setCenterHakEdisMode(true);

      const totalSent = Object.values(sentToCenter).reduce((a, b) => a + b, 0);
      toast({
        title: 'Hesaplama Tamamlandı',
        description: `Toplam ${totalSent} test merkeze gönderilmiş olarak hesaplandı.`,
      });
    } catch (error) {
      totalVerimlilikLogger.error('Merkez hak ediş hesaplaması yapılırken hata oluştu', error, {
        centerLabId: selectedPool?.centerLabId,
        rowCount: rows.length,
      });
      toast({ title: 'Hata', description: 'Merkez hak ediş hesaplaması yapılırken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsCalculatingCenterHakEdis(false);
    }
  }, [selectedPool, hospitals, rows, labHakEdisDefinitions, selectedYear, selectedMonth, toast]);

  // Düzeltilmiş hak ediş değerini hesapla (merkez hak ediş modu aktifken)
  const getAdjustedHakEdis = useCallback((row: TableRow): number => {
    if (!centerHakEdisMode) return row.hakEdis;
    const sentCount = testsSentToCenter[row.id] || 0;
    return Math.max(0, row.hakEdis - sentCount);
  }, [centerHakEdisMode, testsSentToCenter]);

  // Merkez hak ediş modunu sıfırla
  const resetCenterHakEdisMode = useCallback(() => {
    setCenterHakEdisMode(false);
    setTestsSentToCenter({});
  }, []);

  // Scroll viewport yardımcı fonksiyon
  const getScrollViewport = useCallback(() => {
    const container = scrollContainerRef.current;
    return container?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
  }, []);

  // Yatay slider sync: viewport scroll → slider position (DOM manipulation ile - state kullanmadan)
  useEffect(() => {
    const scrollEl = getScrollViewport();
    if (!scrollEl) return;

    const handleScroll = () => {
      if (sliderSyncRef.current) return;
      const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
      if (maxScroll > 0 && sliderRef.current) {
        sliderRef.current.value = String((scrollEl.scrollLeft / maxScroll) * 100);
      }
    };

    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, [getScrollViewport, rows.length]);

  // Slider değişimi → viewport scroll (DOM manipulation ile)
  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    const scrollEl = getScrollViewport();
    if (scrollEl) {
      sliderSyncRef.current = true;
      const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
      scrollEl.scrollLeft = (value / 100) * maxScroll;
      requestAnimationFrame(() => { sliderSyncRef.current = false; });
    }
  }, [getScrollViewport]);

  // Edge Scroll + Glow efekti - Mouse ekranın kenarlarına geldiğinde
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    // Yavaş alan: 90px (kenara yakınlaşıldıkça hızlanır)
    // Hızlı alan: en içte 25px (anında hızlı kayma)
    const EDGE_THRESHOLD = 90;
    const FAST_THRESHOLD = 25;
    const SLOW_SPEED = 6;
    const FAST_SPEED = 16;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = scrollContainer.getBoundingClientRect();
      const mouseX = e.clientX;
      const mouseY = e.clientY;

      // Mouse scroll container içinde mi kontrol et
      if (mouseY < rect.top || mouseY > rect.bottom) {
        if (edgeScrollIntervalRef.current) {
          clearInterval(edgeScrollIntervalRef.current);
          edgeScrollIntervalRef.current = null;
        }
        if (glowLeftRef.current) { glowLeftRef.current.style.opacity = '0'; glowLeftRef.current.style.boxShadow = 'none'; }
        if (glowRightRef.current) { glowRightRef.current.style.opacity = '0'; glowRightRef.current.style.boxShadow = 'none'; }
        return;
      }

      const distanceFromRight = rect.right - mouseX;
      const distanceFromLeft = mouseX - rect.left;

      // Glow DOM güncellemesi - YEŞİL spotlight (yeni tasarım)
      const updateGlow = (leftIntensity: number, rightIntensity: number) => {
        const setOne = (el: HTMLDivElement | null, intensity: number, side: 'left' | 'right') => {
          if (!el) return;
          el.style.opacity = String(intensity);
          if (intensity > 0) {
            const dir = side === 'left' ? 12 : -12;
            el.style.boxShadow = `inset ${dir}px 0 ${Math.round(intensity * 24) + 8}px -6px rgba(34, 197, 94, ${intensity * 0.55})`;
          } else {
            el.style.boxShadow = 'none';
          }
        };
        setOne(glowLeftRef.current, leftIntensity, 'left');
        setOne(glowRightRef.current, rightIntensity, 'right');
        setOne(greenGlowLeftRef.current, leftIntensity, 'left');
        setOne(greenGlowRightRef.current, rightIntensity, 'right');
      };

      // Sağ kenara yakınsa sağa kaydır + glow
      if (distanceFromRight < EDGE_THRESHOLD && distanceFromRight > 0) {
        const slowT = Math.max(0, (EDGE_THRESHOLD - distanceFromRight) / EDGE_THRESHOLD);
        const fastT = distanceFromRight < FAST_THRESHOLD ? (FAST_THRESHOLD - distanceFromRight) / FAST_THRESHOLD : 0;
        const intensity = Math.max(slowT, fastT);
        updateGlow(0, intensity);
        if (!edgeScrollIntervalRef.current) {
          edgeScrollIntervalRef.current = window.setInterval(() => {
            const scrollEl = scrollContainer.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
            if (scrollEl) {
              const speed = SLOW_SPEED * slowT + FAST_SPEED * fastT;
              if (speed > 0) scrollEl.scrollLeft += speed;
            }
          }, 16);
        }
      }
      // Sol kenara yakınsa sola kaydır + glow
      else if (distanceFromLeft < EDGE_THRESHOLD && distanceFromLeft > 0) {
        const slowT = Math.max(0, (EDGE_THRESHOLD - distanceFromLeft) / EDGE_THRESHOLD);
        const fastT = distanceFromLeft < FAST_THRESHOLD ? (FAST_THRESHOLD - distanceFromLeft) / FAST_THRESHOLD : 0;
        const intensity = Math.max(slowT, fastT);
        updateGlow(intensity, 0);
        if (!edgeScrollIntervalRef.current) {
          edgeScrollIntervalRef.current = window.setInterval(() => {
            const scrollEl = scrollContainer.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
            if (scrollEl) {
              const speed = SLOW_SPEED * slowT + FAST_SPEED * fastT;
              if (speed > 0) scrollEl.scrollLeft -= speed;
            }
          }, 16);
        }
      }
      // Kenarlardan uzaksa durdur
      else {
        updateGlow(0, 0);
        if (edgeScrollIntervalRef.current) {
          clearInterval(edgeScrollIntervalRef.current);
          edgeScrollIntervalRef.current = null;
        }
      }
    };

    const handleMouseLeave = () => {
      const reset = (el: HTMLDivElement | null) => {
        if (!el) return;
        el.style.opacity = '0';
        el.style.boxShadow = 'none';
      };
      reset(glowLeftRef.current);
      reset(glowRightRef.current);
      reset(greenGlowLeftRef.current);
      reset(greenGlowRightRef.current);
      if (edgeScrollIntervalRef.current) {
        clearInterval(edgeScrollIntervalRef.current);
        edgeScrollIntervalRef.current = null;
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    scrollContainer.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      scrollContainer.removeEventListener('mouseleave', handleMouseLeave);
      if (edgeScrollIntervalRef.current) {
        clearInterval(edgeScrollIntervalRef.current);
      }
    };
  }, []);

  // ─── REDESIGNED UI: HELPERS ──────────────────────────────────────────
  const COLUMN_GROUPS: Record<string, string[]> = {
    sevkiyat: ['ayBasiSevkiyatKutu', 'ayBasiSevkiyatTest', 'goztepeSevkiyat', 'kurumlarArasiSevk', 'lojistikAraTransfer'],
  };
  const EDITABLE_FIELDS = new Set<EditableField>(['baslangicStokuKutu', 'ayBasiCihazUstuTest', 'ayBasiSevkiyatKutu', 'goztepeSevkiyat', 'kurumlarArasiSevk', 'lojistikAraTransfer', 'kumulatifTotal', 'donemSonuStokKutu', 'donemSonuCihazUstuTest', 'hakEdis']);
  const dynamicFormulaCols = useMemo<ColDef[]>(() => formulaCols.map((f, idx) => ({
    id: `fx_${f.id}`,
    num: 100 + idx + 1,
    label: f.name || `Formül ${idx + 1}`,
    sub: 'ƒx',
    w: 110,
    type: 'result',
  })), [formulaCols]);
  const allCols = useMemo(() => [...COLS, ...dynamicFormulaCols], [dynamicFormulaCols]);

  const toggleColumnGroup = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }, []);

  // Visible columns honor: hidden set + cost flag + center flag
  const visibleCols = useMemo(() => allCols.filter(c => {
    if (hiddenCols.has(c.id) && !REQUIRED_VISIBLE_COLS.has(c.id)) return false;
    const isCollapsedByGroup = Object.entries(COLUMN_GROUPS).some(([gid, ids]) => collapsedGroups.has(gid) && ids.includes(c.id));
    if (isCollapsedByGroup) return false;
    if (showResultsOnly && c.type === 'manual') return false; // hide manual inputs in results-only
    if (c.cost && !showCostColumns) return false;
    if (c.centerOnly && !centerHakEdisMode) return false;
    return true;
  }), [allCols, hiddenCols, showResultsOnly, showCostColumns, centerHakEdisMode, REQUIRED_VISIBLE_COLS, collapsedGroups]);

  useEffect(() => {
    setHiddenCols(prev => {
      if (![...REQUIRED_VISIBLE_COLS].some(id => prev.has(id))) return prev;
      const next = new Set(prev);
      REQUIRED_VISIBLE_COLS.forEach(id => next.delete(id));
      return next;
    });
  }, [REQUIRED_VISIBLE_COLS]);

  const stickyLeftByColId = useMemo(() => {
    let currentLeft = 36; // row selection column width
    const map: Record<string, number> = {};
    visibleCols.forEach(col => {
      if (!col.frozen) return;
      map[col.id] = currentLeft;
      currentLeft += col.w;
    });
    return map;
  }, [visibleCols]);

  const resolveFilterValue = useCallback((row: TableRow, colId: string): unknown => {
    if (colId.startsWith('fx_')) {
      const fxId = colId.replace('fx_', '');
      const fx = formulaCols.find(f => f.id === fxId);
      if (!fx) return 0;
      return evalFormula(fx.expr, {
        hakEdis: row.hakEdis,
        total: row.totalAyBasiStok,
        kumulatifTotal: row.kumulatifTotal,
        sevkiyatSonrasi: row.sevkiyatlarSonrasiTotalTest,
        donemSonu: row.donemSonuToplamTest,
      });
    }
    switch (colId) {
      case 'kutuKayip': {
        const sentCount = testsSentToCenter[row.id] || 0;
        const effHak = centerHakEdisMode ? Math.max(0, row.hakEdis - sentCount) : row.hakEdis;
        const testFark = column22Mode === 'kumulatif'
          ? row.stokDogrulukFark
          : (row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest) - effHak;
        const ambalaj = row.ambalajDegeri || 1;
        return testFark / ambalaj;
      }
      case 'sarfiyatMaliyeti':
        return calculateRowCost(row).cost;
      case 'hakEdisKarsiligi':
        return calculateHakEdisKarsiligi(row, centerHakEdisMode).amount;
      case 'kar':
        return calculateKar(row, centerHakEdisMode).kar;
      case 'zararMaliyeti':
        return calculateZararMaliyeti(row).zarar;
      case 'merkezeGonderilen':
        return testsSentToCenter[row.id] || 0;
      default:
        return (row as unknown as Record<string, unknown>)[colId];
    }
  }, [
    centerHakEdisMode,
    column22Mode,
    calculateRowCost,
    calculateHakEdisKarsiligi,
    calculateKar,
    calculateZararMaliyeti,
    testsSentToCenter,
    formulaCols,
  ]);

  // Group rows by lab (after primary filtering)
  const groupedRows = useMemo(() => {
    // Apply advanced filters on top of existing deferredRows (which already has search+colFilters+sort)
    let result = deferredRows;
    if (advFilters.length > 0) {
      const metricCache = new Map<string, number[]>();
      const getMetricValues = (colId: string) => {
        if (metricCache.has(colId)) return metricCache.get(colId)!;
        const vals = result
          .map(r => Number(resolveFilterValue(r, colId)))
          .filter(v => Number.isFinite(v))
          .sort((a, b) => b - a);
        metricCache.set(colId, vals);
        return vals;
      };
      result = result.filter(r => {
        const matches = advFilters.map(f => {
          const raw = resolveFilterValue(r, f.col);
          if (f.op === 'between') {
            const [a, b] = f.val.split(/[;,]/).map(v => parseFloat(v.trim()));
            const numRaw = Number(raw);
            if (!Number.isFinite(numRaw) || !Number.isFinite(a) || !Number.isFinite(b)) return false;
            return numRaw >= Math.min(a, b) && numRaw <= Math.max(a, b);
          }
          if (f.op === 'aboveAvg' || f.op === 'belowAvg') {
            const values = getMetricValues(f.col);
            if (values.length === 0) return false;
            const avg = values.reduce((s, n) => s + n, 0) / values.length;
            const numRaw = Number(raw);
            if (!Number.isFinite(numRaw)) return false;
            return f.op === 'aboveAvg' ? numRaw > avg : numRaw < avg;
          }
          if (f.op === 'topN' || f.op === 'topPct') {
            const values = getMetricValues(f.col);
            if (values.length === 0) return false;
            const numRaw = Number(raw);
            if (!Number.isFinite(numRaw)) return false;
            const rankCount = f.op === 'topN'
              ? Math.max(1, Math.floor(parseFloat(f.val || '0')))
              : Math.max(1, Math.floor(values.length * (Math.min(100, Math.max(1, parseFloat(f.val || '0'))) / 100)));
            const threshold = values[Math.min(values.length - 1, rankCount - 1)];
            return numRaw >= threshold;
          }
          return evalAdvFilterRaw(raw, f);
        });
        return advMode === 'AND' ? matches.every(Boolean) : matches.some(Boolean);
      });
    }
    // Apply per-column value filters (header dropdown filter)
    const valEntries = Object.entries(colValFilters).filter(([, v]) => v && v.length > 0);
    if (valEntries.length > 0) {
      result = result.filter(r => valEntries.every(([cid, vals]) => {
        const v = String(resolveFilterValue(r, cid) ?? '');
        return (vals as string[]).includes(v);
      }));
    }
    // Group
    const groups: { labId: string; labName: string; labKod: string; rows: TableRow[] }[] = [];
    const map = new Map<string, { labId: string; labName: string; labKod: string; rows: TableRow[] }>();
    result.forEach(r => {
      let g = map.get(r.labId);
      if (!g) {
        g = { labId: r.labId, labName: r.labName, labKod: r.labKod, rows: [] };
        map.set(r.labId, g);
        groups.push(g);
      }
      g.rows.push(r);
    });
    return groups;
  }, [deferredRows, advFilters, advMode, colValFilters, resolveFilterValue]);

  const totalVisibleRows = useMemo(() => groupedRows.reduce((s, g) => s + g.rows.length, 0), [groupedRows]);
  const flatVisibleRows = useMemo(() => groupedRows.flatMap(g => g.rows), [groupedRows]);

  // Excel veri giriş şablonu, panelde o anda görünen satırları esas alır.
  // Böylece marka/ürün grubu, laboratuvar, arama, sütun ve gelişmiş filtreler
  // şablon indirilirken kaybolmaz.
  const handleDownloadTemplate = useCallback(() => {
    if (flatVisibleRows.length === 0) return;

    const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
    const templateData = flatVisibleRows.map(r => ({
      'Laboratuvar': r.labName,
      'Lab Kodu': r.labKod,
      'Stok Kodu': r.stokKodu,
      'Ürün Adı': r.stokAdi,
      'Test Adı': r.testAdi,
      'Ambalaj Miktarı': r.ambalajDegeri,
      '7. Başlangıç Stoğu (Kutu)': r.baslangicStokuKutu || '',
      '8. Ay Başı Cihaz Üstü (Test)': r.ayBasiCihazUstuTest || '',
      '10. Ay Başı Sevkiyat (Kutu)': r.ayBasiSevkiyatKutu || '',
      'Ay Başı Sevkiyat (Test) [Hesaplanan]': r.ayBasiSevkiyatTest || '',
      '13. Lojistik Ara Transfer (Kutu)': r.lojistikAraTransfer || '',
      '15. Kümülatif Total (Test)': r.kumulatifTotal || '',
      '16. Dönem Sonu Stok (Kutu)': r.donemSonuStokKutu || '',
      '17. Dönem Sonu Cihaz Üstü (Test)': r.donemSonuCihazUstuTest || '',
      '19. Hak Ediş (Test)': r.hakEdis || '',
    }));

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Şablon');

    const fileName = `Verimlilik_Sablon_${selectedPool?.name || 'Havuz'}_${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}.xlsx`;
    XLSX.writeFile(wb, fileName);

    toast({
      title: 'Şablon İndirildi',
      description: `${templateData.length} filtrelenmiş satır içeren Excel şablonu indirildi.`,
    });
    setShowExcelImportModal(false);
  }, [flatVisibleRows, selectedPoolId, efficiencyPools, selectedYear, selectedMonth, toast]);

  const footerAgg = useMemo(() => {
    const nums = (colId: string) => flatVisibleRows.map(r => Number(resolveFilterValue(r, colId))).filter(v => Number.isFinite(v));
    const sum = (list: number[]) => list.reduce((s, n) => s + n, 0);
    const avg = (list: number[]) => list.length > 0 ? sum(list) / list.length : 0;
    const hakList = nums('hakEdis');
    const kitPerfList = flatVisibleRows.map(r => Math.max(0, Math.min(100, 100 - Math.abs(r.kitVerimlilikYuzde))));
    const costList = nums('sarfiyatMaliyeti');
    return {
      hakSum: sum(hakList),
      kitAvg: avg(kitPerfList),
      costSum: sum(costList),
      minKit: kitPerfList.length ? Math.min(...kitPerfList) : 0,
      maxKit: kitPerfList.length ? Math.max(...kitPerfList) : 0,
    };
  }, [flatVisibleRows, resolveFilterValue]);
  const pivotData = useMemo(() => {
    const rowKeys = Array.from(new Set(flatVisibleRows.map(r => String(resolveFilterValue(r, pivotRowsBy) || '—'))));
    const colKeys = Array.from(new Set(flatVisibleRows.map(r => String(resolveFilterValue(r, pivotColsBy) || '—'))));
    const matrix: Record<string, Record<string, number>> = {};
    rowKeys.forEach(rk => { matrix[rk] = {}; colKeys.forEach(ck => { matrix[rk][ck] = 0; }); });
    flatVisibleRows.forEach(r => {
      const rk = String(resolveFilterValue(r, pivotRowsBy) || '—');
      const ck = String(resolveFilterValue(r, pivotColsBy) || '—');
      const vv = Number(resolveFilterValue(r, pivotValueBy) || 0);
      if (!matrix[rk]) matrix[rk] = {};
      matrix[rk][ck] = (matrix[rk][ck] || 0) + (Number.isFinite(vv) ? vv : 0);
    });
    return { rowKeys, colKeys, matrix };
  }, [flatVisibleRows, resolveFilterValue, pivotRowsBy, pivotColsBy, pivotValueBy]);
  const currentSnapshotMetrics = useMemo<SnapshotMetrics>(() => ({
    monthKey: `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`,
    label: `${MONTHS[selectedMonth]?.label} ${selectedYear}`,
    verimlilik: efficiencyMetrics.genelVerimlilik,
    hakEdisToplam: efficiencyMetrics.toplamHakEdis,
  }), [selectedYear, selectedMonth, efficiencyMetrics.genelVerimlilik, efficiencyMetrics.toplamHakEdis]);
  const plannedSnapshot = snapshots[`planned-${currentSnapshotMetrics.monthKey}`];
  const actualSnapshot = snapshots[`actual-${currentSnapshotMetrics.monthKey}`];
  const AI_ANALYZABLE_COLS = useMemo(() => ['stokDogrulukFark', 'kitVerimlilikFark', 'kutuKayip', 'sarfiyatMaliyeti'], []);

  const runAiAnalysis = useCallback(async (mode: 'table' | 'column' | 'cell', payload?: { colId?: string; rowId?: string }) => {
    try {
      setAiAnalyzing(true);
      setAiAnalysisOpen(true);
      const subset = flatVisibleRows.slice(0, 300).map(r => ({
        lab: r.labName,
        stok: r.stokAdi,
        stokKodu: r.stokKodu,
        stokDogrulukFark: r.stokDogrulukFark,
        kitVerimlilikFark: r.kitVerimlilikFark,
        kutuKayip: Number(resolveFilterValue(r, 'kutuKayip') || 0),
        sarfiyatMaliyeti: Number(resolveFilterValue(r, 'sarfiyatMaliyeti') || 0),
      }));
      const targetRow = payload?.rowId ? flatVisibleRows.find(r => r.id === payload.rowId) : null;
      const targetCol = payload?.colId || '';
      const cellTargetValue = targetRow ? (targetRow as unknown as Record<string, unknown>)[targetCol] : undefined;
      const cellSummary = targetRow ? {
        lab: targetRow.labName,
        stok: targetRow.stokAdi,
        stokKodu: targetRow.stokKodu,
        sutun: targetCol,
        deger: cellTargetValue,
        stokDogrulukFark: targetRow.stokDogrulukFark,
        kitVerimlilikFark: targetRow.kitVerimlilikFark,
        kutuKayip: Number(resolveFilterValue(targetRow, 'kutuKayip') || 0),
        sarfiyatMaliyeti: Number(resolveFilterValue(targetRow, 'sarfiyatMaliyeti') || 0),
      } : null;
      const prompt = mode === 'table'
        ? `Aşağıdaki total verimlilik verisini analiz et. Smart alertler, auto insights, anomaly detection ve gelecek ay tahmini verimlilik üret. Kısa ve madde madde yaz.\nVeri:${JSON.stringify(subset)}`
        : mode === 'column'
          ? `Sadece ${targetCol} sütununu analiz et. Düşük performans, anomali, trend ve aksiyon önerisi ver.\nVeri:${JSON.stringify(subset.map(r => ({ lab: r.lab, stok: r.stok, value: (r as Record<string, unknown>)[targetCol] })))}`
          : `Tek hücre analizi yap. ${targetCol} sütunundaki bu değeri anomali açısından değerlendir ve kısa, maddeli öneri ver.\nVeri:${JSON.stringify(cellSummary)}`;
      setAiTargetLabel(mode === 'table' ? 'Tablo Geneli' : mode === 'column' ? `Sütun: ${targetCol}` : `Hücre: ${targetCol}`);
      const res = await fetch('/api/ai/total-verimlilik-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: 'Sen sağlık operasyon verimlilik danışmanısın. Cevabı Türkçe, kısa, maddeli ve aksiyon odaklı ver.',
          prompt,
          temperature: 0.2,
          maxOutputTokens: 1200,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      setAiAnalysisText(data?.text || 'AI analiz çıktısı boş döndü.');
    } catch (e) {
      setAiAnalysisText(`AI analiz hatası: ${e instanceof Error ? e.message : 'Bilinmeyen hata'}`);
    } finally {
      setAiAnalyzing(false);
    }
  }, [flatVisibleRows, resolveFilterValue]);
  // Flat ordered row IDs across visible (expanded) groups - used for shift-range selection
  const visibleRowIds = useMemo(() => {
    const ids: string[] = [];
    for (const g of groupedRows) {
      if (expandedLabs.has(g.labId)) for (const r of g.rows) ids.push(r.id);
    }
    return ids;
  }, [groupedRows, expandedLabs]);

  // Track whether we manually changed expansion (so filter auto-expand doesn't override later)
  const lastFilterSig = useRef<string>('');

  // Auto-expand behavior:
  // - On first appearance of data: expand first lab (so user sees something)
  // - When filters become active: expand ALL labs that have matching rows
  //   (otherwise filtered rows hide inside collapsed groups → user thinks data disappeared)
  // - When filters cleared: revert to first-lab-only
  useEffect(() => {
    if (groupedRows.length === 0) return;
    const hasFilters = advFilters.length > 0 || Object.keys(colValFilters).length > 0 || searchTerm.trim().length > 0;
    const sig = `${hasFilters ? '1' : '0'}|${advFilters.length}|${Object.keys(colValFilters).join(',')}|${searchTerm}`;
    if (sig === lastFilterSig.current) return;
    lastFilterSig.current = sig;
    if (hasFilters) {
      // Expand every group that has rows matching current filters
      setExpandedLabs(new Set(groupedRows.map(g => g.labId)));
    } else if (expandedLabs.size === 0) {
      setExpandedLabs(new Set([groupedRows[0].labId]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedRows, advFilters, colValFilters, searchTerm]);

  const toggleLabExpand = useCallback((labId: string) => {
    setExpandedLabs(prev => {
      const n = new Set(prev);
      if (n.has(labId)) n.delete(labId); else n.add(labId);
      return n;
    });
  }, []);
  const expandAllLabs = useCallback(() => setExpandedLabs(new Set(groupedRows.map(g => g.labId))), [groupedRows]);
  const collapseAllLabs = useCallback(() => setExpandedLabs(new Set()), []);

  // Selection
  const toggleSelRow = useCallback((rowId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelRows(prev => { const n = new Set(prev); n.has(rowId) ? n.delete(rowId) : n.add(rowId); return n; });
  }, []);
  const toggleSelCol = useCallback((colId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelCols(prev => { const n = new Set(prev); n.has(colId) ? n.delete(colId) : n.add(colId); return n; });
  }, []);
  const clearSel = useCallback(() => { setSelRows(new Set()); setSelCols(new Set()); setSelCells(new Set()); cellAnchor.current = null; }, []);

  // Drag-to-select state (Excel: hold mouse down + drag across cells)
  const isDraggingCells = useRef(false);

  // Build a rectangular selection between two cells
  const rangeSelect = useCallback((aRow: string, aCol: string, bRow: string, bCol: string): Set<string> => {
    const r1 = visibleRowIds.indexOf(aRow);
    const r2 = visibleRowIds.indexOf(bRow);
    const c1 = visibleCols.findIndex(c => c.id === aCol);
    const c2 = visibleCols.findIndex(c => c.id === bCol);
    if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return new Set([`${bRow}-${bCol}`]);
    const [rA, rB] = [Math.min(r1, r2), Math.max(r1, r2)];
    const [cA, cB] = [Math.min(c1, c2), Math.max(c1, c2)];
    const next = new Set<string>();
    for (let i = rA; i <= rB; i++) {
      for (let j = cA; j <= cB; j++) next.add(`${visibleRowIds[i]}-${visibleCols[j].id}`);
    }
    return next;
  }, [visibleRowIds, visibleCols]);

  // MouseDown: start a drag-select. Shift extends, Ctrl toggles, plain replaces.
  const onCellMouseDown = useCallback((rowId: string, colId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return; // left-click only
    const key = `${rowId}-${colId}`;
    setActiveCell({ rowId, colId }); // formül çubuğu için aktif hücre
    if (e.shiftKey && cellAnchor.current) {
      const a = cellAnchor.current;
      setSelCells(rangeSelect(a.rowId, a.colId, rowId, colId));
    } else if (e.ctrlKey || e.metaKey) {
      setSelCells(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
      cellAnchor.current = { rowId, colId };
    } else {
      setSelCells(new Set([key]));
      cellAnchor.current = { rowId, colId };
      setSelRows(new Set());
      setSelCols(new Set());
    }
    isDraggingCells.current = true;
  }, [rangeSelect]);

  // MouseEnter while dragging: extend selection from anchor to current cell
  const onCellMouseEnter = useCallback((rowId: string, colId: string) => {
    if (!isDraggingCells.current || !cellAnchor.current) return;
    const a = cellAnchor.current;
    setSelCells(rangeSelect(a.rowId, a.colId, rowId, colId));
  }, [rangeSelect]);

  // Global mouseup ends drag-select
  useEffect(() => {
    const onUp = () => { isDraggingCells.current = false; };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  // Apply format to current selection (cells + rows + cols)
  const applyToSelection = useCallback(<K extends keyof FmtRec>(key: K, value: FmtRec[K]) => {
    setActiveFmt(p => {
      const k = key === 'bg' ? 'fillColor' : (key as string);
      return { ...p, [k]: value as never };
    });
    if (selRows.size === 0 && selCols.size === 0 && selCells.size === 0) {
      toast({ title: 'Seçim yok', description: 'Önce hücre, satır veya sütun seçin.', variant: 'destructive' });
      return;
    }
    if (selCells.size > 0) {
      setCellFmts(prev => {
        const n = { ...prev };
        selCells.forEach(k => { n[k] = { ...(n[k] || {}), [key]: value }; });
        return n;
      });
    }
    if (selRows.size > 0) {
      setRowFmts(prev => {
        const n = { ...prev };
        selRows.forEach(rid => { n[rid] = { ...(n[rid] || {}), [key]: value }; });
        return n;
      });
    }
    if (selCols.size > 0) {
      setColFmts(prev => {
        const n = { ...prev };
        selCols.forEach(cid => { n[cid] = { ...(n[cid] || {}), [key]: value }; });
        return n;
      });
    }
  }, [selRows, selCols, selCells, toast]);

  const toggleFmt = useCallback((key: 'bold' | 'italic') => {
    const next = !activeFmt[key];
    applyToSelection(key, next);
  }, [activeFmt, applyToSelection]);

  // Merged format for a cell = col fmt < row fmt < cell fmt
  const getMergedFmt = useCallback((rowId: string, colId: string): FmtRec => {
    return { ...(colFmts[colId] || {}), ...(rowFmts[rowId] || {}), ...(cellFmts[`${rowId}-${colId}`] || {}) };
  }, [colFmts, rowFmts, cellFmts]);

  // Context menu apply
  const applyCtxFmt = useCallback((target: 'cell' | 'row' | 'col', key: keyof FmtRec, value: FmtRec[keyof FmtRec], menu: NonNullable<typeof ctxMenu>) => {
    if (target === 'cell' && menu.rowId && menu.colId) {
      const k = `${menu.rowId}-${menu.colId}`;
      setCellFmts(p => ({ ...p, [k]: { ...(p[k] || {}), [key]: value } }));
    } else if (target === 'row' && menu.rowId) {
      setRowFmts(p => ({ ...p, [menu.rowId!]: { ...(p[menu.rowId!] || {}), [key]: value } }));
    } else if (target === 'col' && menu.colId) {
      setColFmts(p => ({ ...p, [menu.colId!]: { ...(p[menu.colId!] || {}), [key]: value } }));
    }
  }, []);

  // Column hide toggle
  const toggleHidden = useCallback((id: string) => {
    setHiddenCols(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const showAllCols = useCallback(() => setHiddenCols(new Set()), []);

  // Per-column value filter
  const applyColValFilter = useCallback((colId: string, vals: string[] | null) => {
    setColValFilters(p => {
      const n = { ...p };
      if (!vals || vals.length === 0) delete n[colId]; else n[colId] = vals;
      return n;
    });
  }, []);

  // Sort helper that mirrors the existing toggleSort but supports any column
  const setSort = useCallback((colId: string | null, dir: 'asc' | 'desc') => {
    if (!colId) { setSortConfig({ column: null, direction: 'asc' }); return; }
    // We only support sorting by the columns existing sortConfig accepts; coerce others into deferred sort
    if (colId === 'stokDogrulukFark' || colId === 'kitVerimlilikFark') {
      setSortConfig({ column: colId as 'stokDogrulukFark' | 'kitVerimlilikFark', direction: dir });
    }
    // For other columns, we silently no-op for now (sort by row prop is in groupedRows already)
  }, []);

  // Advanced filter helpers
  const addAdvFilter = useCallback(() => {
    setAdvFilters(p => [...p, { id: `f${Date.now()}`, col: 'stokAdi', op: 'contains', val: '' }]);
  }, []);
  const updateAdvFilter = useCallback((id: string, patch: Partial<AdvFilter>) => {
    setAdvFilters(p => p.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);
  const removeAdvFilter = useCallback((id: string) => {
    setAdvFilters(p => p.filter(f => f.id !== id));
  }, []);
  const clearAdvFilters = useCallback(() => setAdvFilters([]), []);

  // Currency helpers
  const cur = costCurrency === 'TRY' ? '₺' : costCurrency === 'USD' ? '$' : '€';
  const fmtN = (n: number) => n.toLocaleString('tr-TR');

  // Excel-tarzı formül: hesaplanan bir hücrenin değerini ÜRETEN formülü,
  // gerçek sayılar yerine konularak döndürür. Manuel/bilgi sütunları için null.
  const getCellFormula = (row: TableRow, colId: string): string | null => {
    const f = (v: number) => fmtN(Math.round((v ?? 0) * 100) / 100);
    switch (colId) {
      case 'totalAyBasiStok':
        return `(Baş.Stoğu ${f(row.baslangicStokuKutu)} × Ambalaj ${f(row.ambalajDegeri)}) + Ay Üstü ${f(row.ayBasiCihazUstuTest)} = ${f(row.totalAyBasiStok)}`;
      case 'ayBasiSevkiyatTest':
        return `Ay Başı Sevkiyat ${f(row.ayBasiSevkiyatKutu)} kutu × Ambalaj ${f(row.ambalajDegeri)} = ${f(row.ayBasiSevkiyatTest)}`;
      case 'sevkiyatlarSonrasiTotalTest':
        return `((AyBaşıSevk ${f(row.ayBasiSevkiyatKutu)} + Göztepe ${f(row.goztepeSevkiyat)} + K.Arası ${f(row.kurumlarArasiSevk)} + Loj ${f(row.lojistikAraTransfer)}) × Ambalaj ${f(row.ambalajDegeri)}) + TotalAyBaşı ${f(row.totalAyBasiStok)} = ${f(row.sevkiyatlarSonrasiTotalTest)}`;
      case 'donemSonuToplamTest':
        return `(D.SonuStok ${f(row.donemSonuStokKutu)} × Ambalaj ${f(row.ambalajDegeri)}) + D.SonuCihaz ${f(row.donemSonuCihazUstuTest)} = ${f(row.donemSonuToplamTest)}`;
      case 'arizaliKitTest':
        return `Cihazdan çıkan kit (dönem içi) test toplamı = ${f(row.arizaliKitTest)}`;
      case 'beklenenTestSayisi':
        return `Sevk.Sonrası ${f(row.sevkiyatlarSonrasiTotalTest)} − D.Sonu Toplam ${f(row.donemSonuToplamTest)} = ${f(row.beklenenTestSayisi)}`;
      case 'stokDogrulukFark':
        return `Beklenen Test ${f(row.beklenenTestSayisi)} − Kümülatif ${f(row.kumulatifTotal)} = ${f(row.stokDogrulukFark)}`;
      case 'kitVerimlilikFark':
        return `Kümülatif ${f(row.kumulatifTotal)} − Hak Ediş ${f(row.hakEdis)} = ${f(row.kitVerimlilikFark)}   ·   Sapma %${f(row.kitVerimlilikYuzde)}`;
      case 'kutuKayip':
        return row.ambalajDegeri > 0
          ? `Stok Doğruluk Fark ${f(row.stokDogrulukFark)} ÷ Ambalaj ${f(row.ambalajDegeri)} = ${f(row.stokDogrulukFark / row.ambalajDegeri)} kutu`
          : `Ambalaj 0 olduğundan hesaplanamaz`;
      default:
        return null;
    }
  };

  // Render value for a column×row cell
  const renderCellValue = (col: ColDef, row: TableRow): React.ReactNode => {
    if (col.id.startsWith('fx_')) {
      const fx = formulaCols.find(f => `fx_${f.id}` === col.id);
      if (!fx) return null;
      const v = evalFormula(fx.expr, {
        hakEdis: row.hakEdis,
        total: row.totalAyBasiStok,
        kumulatifTotal: row.kumulatifTotal,
        sevkiyatSonrasi: row.sevkiyatlarSonrasiTotalTest,
        donemSonu: row.donemSonuToplamTest,
      });
      return <span className="font-mono text-[11px]">{Number(v).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</span>;
    }
    switch (col.id) {
      case 'lab': return null; // handled separately
      case 'stokKodu': return <span className="font-mono text-[11px] block text-left">{row.stokKodu}</span>;
      case 'stokAdi': return <span className="text-[11.5px]">{row.stokAdi}</span>;
      case 'testAdi': return <span className="text-muted-foreground text-[11px]">{row.testAdi || '—'}</span>;
      case 'ambalajDegeri': return <span className="text-[11px]">{row.ambalajDegeri || '—'}</span>;
      case 'cihazGrubu': return <span className="text-muted-foreground text-[11px]">{row.cihazGrubu || '—'}</span>;
      case 'baslangicStokuKutu':
      case 'ayBasiCihazUstuTest':
      case 'ayBasiSevkiyatKutu':
      case 'goztepeSevkiyat':
      case 'lojistikAraTransfer':
      case 'kumulatifTotal':
      case 'donemSonuStokKutu':
      case 'donemSonuCihazUstuTest':
      case 'hakEdis': {
        const v = (row as unknown as Record<string, number>)[col.id];
        return (
          <DebouncedInput
            type="number"
            min="0"
            value={v || ''}
            onChange={(value) => handleValueChange(row.id, col.id as never, value)}
            placeholder=""
          />
        );
      }
      case 'kurumlarArasiSevk':
        return (
          <>
            <input
              type="number" min={0}
              className="tv-cell-input"
              value={row.kurumlarArasiSevk || ''}
              onChange={e => handleKurumlarArasiSevkChange(row.id, e.target.value)}
              placeholder=""
            />
            {interLabTransfers[row.id] && (
              <span className="absolute bottom-0 left-1 text-[8px] text-orange-600 leading-none">← {interLabTransfers[row.id].sourceLabName}</span>
            )}
          </>
        );
      case 'totalAyBasiStok': return <span title="(Baş. Stoğu × Ambalaj) + Ay Üstü" className="font-mono text-[11px] font-semibold underline decoration-dotted cursor-help">{fmtN(row.totalAyBasiStok)}</span>;
      case 'ayBasiSevkiyatTest': return <span title="Ay Başı Sevkiyat (Kutu) × Ambalaj" className="font-mono text-[11px] font-semibold underline decoration-dotted cursor-help">{fmtN(row.ayBasiSevkiyatTest || 0)}</span>;
      case 'sevkiyatlarSonrasiTotalTest': return <span className="font-mono text-[11px] font-semibold">{fmtN(row.sevkiyatlarSonrasiTotalTest)}</span>;
      case 'donemSonuToplamTest': return <span className="font-mono text-[11px] font-semibold">{fmtN(row.donemSonuToplamTest)}</span>;
      case 'arizaliKitTest': return <span title="Cihazdan çıkan kit (dönem içi) test toplamı" className={cn("font-mono text-[11px] font-semibold", row.arizaliKitTest > 0 ? "text-amber-600" : "text-muted-foreground")}>{fmtN(row.arizaliKitTest)}</span>;
      case 'beklenenTestSayisi': return <span title="Sevkiyatlar Sonrası − D.Sonu Toplam" className="font-mono text-[11px] font-semibold underline decoration-dotted cursor-help">{fmtN(row.beklenenTestSayisi)}</span>;
      case 'stokDogrulukFark': {
        // Beklenen Test − Kümülatif:
        //   Fark > 0 → "eksik" (fire/kayıp, kırmızı) — beklenen test > kümülatif
        //   Fark = 0 → "fark yok" (yeşil) — beklenen test = kümülatif
        //   Fark < 0 → "fazla" (anlamsız fazla sonuç, sarı) — beklenen test < kümülatif
        const fark = row.stokDogrulukFark;
        const sign = fark > 0 ? '-' : (fark < 0 ? '+' : '');
        const label = fark > 0 ? 'eksik' : (fark < 0 ? 'fazla' : 'fark yok');
        const cls = fark > 0 ? 'bg-red-100 text-red-700 border-red-200'
                  : fark < 0 ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
                  : 'bg-green-100 text-green-700 border-green-200';
        return (
          <div className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold border ${cls}`}>
              {sign}{Math.abs(fark).toLocaleString('tr-TR')}
              <span className="font-sans uppercase tracking-wide text-[9px] font-bold opacity-80">{label}</span>
            </span>
            <button onClick={() => runAiAnalysis('cell', { rowId: row.id, colId: 'stokDogrulukFark' })} className="text-indigo-500 hover:text-indigo-700"><Bot className="h-3 w-3" /></button>
          </div>
        );
      }
      case 'kitVerimlilikFark': {
        const efficiencyScore = Math.max(0, Math.min(100, 100 - Math.abs(row.kitVerimlilikYuzde)));
        const sign = row.kitVerimlilikFark > 0 ? '-' : (row.kitVerimlilikFark < 0 ? '+' : '');
        const cls = efficiencyScore < 70 ? 'bg-red-100 text-red-700 border-red-200'
                  : efficiencyScore <= 90 ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
                  : 'bg-green-100 text-green-700 border-green-200';
        return (
          <div className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold border ${cls}`}>
              {sign}{Math.abs(row.kitVerimlilikFark).toLocaleString('tr-TR')} · %{Math.abs(row.kitVerimlilikYuzde).toFixed(1)} · Verim %{efficiencyScore.toFixed(0)}
            </span>
            <button onClick={() => runAiAnalysis('cell', { rowId: row.id, colId: 'kitVerimlilikFark' })} className="text-indigo-500 hover:text-indigo-700"><Bot className="h-3 w-3" /></button>
          </div>
        );
      }
      case 'kutuKayip': {
        const effHak = centerHakEdisMode ? getAdjustedHakEdis(row) : row.hakEdis;
        const testFark = column22Mode === 'kumulatif' ? row.stokDogrulukFark : (row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest) - effHak;
        const ambalaj = row.ambalajDegeri || 1;
        const kutuFark = testFark / ambalaj;
        const abs = Math.abs(kutuFark);
        // Kutu kayıp 0 (1 kutudan az) → yeşil "fark yok"
        if (abs < 1) {
          return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-green-100 text-green-700 border-green-200">
              0 kutu
              <span className="uppercase tracking-wide text-[9px] font-bold opacity-80">fark yok</span>
            </span>
          );
        }
        // ≥1 kutu: eksik (Fark>0, kırmızı) veya fazla (Fark<0, sarı)
        const isEksik = testFark > 0;
        const label = isEksik ? 'eksik' : 'fazla';
        const cls = isEksik ? 'bg-red-100 text-red-700 border-red-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200';
        return (
          <div className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold border ${cls}`}>
              {kutuFark > 0 ? '+' : '-'}{abs.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kutu
              <span className="font-sans uppercase tracking-wide text-[9px] font-bold opacity-80">{label}</span>
            </span>
            <button onClick={() => runAiAnalysis('cell', { rowId: row.id, colId: 'kutuKayip' })} className="text-indigo-500 hover:text-indigo-700"><Bot className="h-3 w-3" /></button>
          </div>
        );
      }
      case 'sarfiyatMaliyeti': {
        const { cost, hasData } = calculateRowCost(row);
        if (!hasData) return <span className="text-muted-foreground text-[10px]">—</span>;
        if (cost === 0) return <span className="text-muted-foreground">—</span>;
        return <div className="flex items-center gap-1"><span className="font-mono text-[11px] font-semibold text-emerald-700">{cur}{cost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><button onClick={() => runAiAnalysis('cell', { rowId: row.id, colId: 'sarfiyatMaliyeti' })} className="text-indigo-500 hover:text-indigo-700"><Bot className="h-3 w-3" /></button></div>;
      }
      case 'hakEdisKarsiligi': {
        const { amount, hasData } = calculateHakEdisKarsiligi(row, centerHakEdisMode);
        if (!hasData) return <span className="text-muted-foreground text-[10px]">—</span>;
        if (amount === 0) return <span className="text-muted-foreground">—</span>;
        return <span className="font-mono text-[11px] font-semibold text-amber-700">{cur}{amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
      }
      case 'kar': {
        const { kar, hasData } = calculateKar(row, centerHakEdisMode);
        if (!hasData) return <span className="text-muted-foreground text-[10px]">—</span>;
        if (kar === 0) return <span className="text-muted-foreground">—</span>;
        const cls = kar > 0 ? 'text-green-600' : 'text-red-600';
        return <span className={`font-mono text-[11px] font-semibold ${cls}`}>{kar > 0 ? '+' : ''}{cur}{kar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
      }
      case 'zararMaliyeti': {
        const { zarar, hasData } = calculateZararMaliyeti(row);
        if (!hasData) return <span className="text-muted-foreground text-[10px]">—</span>;
        if (zarar === 0) return <span className="text-muted-foreground">—</span>;
        return <span className="font-mono text-[11px] font-semibold text-rose-600">{cur}{zarar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
      }
      case 'merkezeGonderilen': {
        const sentCount = testsSentToCenter[row.id] || 0;
        if (selectedPool?.centerLabId === row.labId) return <span className="text-muted-foreground text-[10px]">Merkez</span>;
        if (sentCount === 0) return <span className="text-muted-foreground">—</span>;
        return <span className="font-mono text-[11px] font-semibold text-orange-600">{sentCount.toLocaleString('tr-TR')}</span>;
      }
      default: return null;
    }
  };

  const renderFooterValue = (col: ColDef): React.ReactNode => {
    switch (col.id) {
      case 'stokAdi':
        return <span className="font-semibold text-[11px]">Toplam Hak Ediş: {fmtN(footerAgg.hakSum)}</span>;
      case 'kitVerimlilikFark':
        return <span className="font-semibold text-[10.5px]">Ort. Verimlilik: %{footerAgg.kitAvg.toFixed(1)}</span>;
      case 'hakEdis':
        return <span className="font-mono text-[10.5px]">SUM: {fmtN(footerAgg.hakSum)}</span>;
      case 'sarfiyatMaliyeti':
        return <span className="font-mono text-[10.5px]">SUM: {cur}{footerAgg.costSum.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</span>;
      case 'stokDogrulukFark':
        return <span className="font-mono text-[10.5px]">MIN/MAX Verim: %{footerAgg.minKit.toFixed(0)} / %{footerAgg.maxKit.toFixed(0)}</span>;
      default:
        return null;
    }
  };

  // Background tint per column type (subtle Excel-like coloring)
  const typeBgClass = (t: ColType): string => {
    switch (t) {
      case 'manual': return 'bg-blue-50/40 dark:bg-blue-950/30';
      case 'calc':   return 'bg-emerald-50/40 dark:bg-emerald-950/30';
      case 'result': return 'bg-violet-50/40 dark:bg-violet-950/30';
      default:       return '';
    }
  };
  const headerBgClass = (t: ColType): string => {
    switch (t) {
      case 'manual': return 'bg-blue-100/70 dark:bg-blue-900/40';
      case 'calc':   return 'bg-emerald-100/70 dark:bg-emerald-900/40';
      case 'result': return 'bg-violet-100/70 dark:bg-violet-900/40';
      default:       return 'bg-muted/60';
    }
  };
  const rowHeightCls = density === 'compact' ? 'h-7' : density === 'normal' ? 'h-9' : 'h-11';

  // Column header filter button click
  const openColFilter = (col: ColDef, e: React.MouseEvent) => {
    e.stopPropagation();
    if (colFilterOpen?.col.id === col.id) { setColFilterOpen(null); return; }
    const rect = (e.currentTarget as HTMLElement).closest('th')?.getBoundingClientRect();
    if (!rect) return;
    // gather unique values across all rows
    const seen = new Set<string>();
    const vals: (string | number)[] = [];
    rows.forEach(r => {
      const v = (r as unknown as Record<string, unknown>)[col.id];
      const k = String(v ?? '');
      if (!seen.has(k)) { seen.add(k); vals.push(v as string | number); }
    });
    vals.sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'tr'));
    setColFilterOpen({ col, x: rect.left, y: rect.bottom + 2, allValues: vals });
  };

  // Format style for inline use
  const fmtToStyle = (f: FmtRec): React.CSSProperties => {
    const s: React.CSSProperties = {};
    if (f.bg) s.background = f.bg;
    if (f.textColor) s.color = f.textColor;
    if (f.bold) s.fontWeight = 700;
    if (f.italic) s.fontStyle = 'italic';
    if (f.align) s.textAlign = f.align;
    return s;
  };

  return (
    <div className="relative flex flex-col h-full w-full bg-[#f3f3f1] dark:bg-zinc-950 text-[13px]" role="main" aria-label="Total Verimlilik Paneli">

      {/* ─── MAIN TOOLBAR (RIBBON) ──────────────────────────────────── */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-300 dark:border-zinc-700 px-3 h-9 flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {/* Save dropdown */}
        <div className="tv-drop-wrap relative inline-flex">
          <button
            onClick={() => setOpenDrop(p => p === 'save' ? null : 'save')}
            disabled={isSaving || isSavingAraKayit || rows.length === 0}
            className="flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium bg-orange-500 text-white border border-orange-500 hover:bg-orange-600 disabled:opacity-50"
          >
            {isSaving || isSavingAraKayit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Kaydet
            <ChevronDown className="h-3 w-3" />
          </button>
          {openDrop === 'save' && (
            <div className="absolute top-full left-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-lg min-w-[180px] z-50 p-1">
              <button onClick={() => { handleSave(); setOpenDrop(null); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
                <Save className="h-3 w-3" />Kaydet
              </button>
              <button onClick={() => { handleAraKayitSave(); setOpenDrop(null); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
                <Clock className="h-3 w-3" />Ara Kayıt
                {araKayitInfo?.exists && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />}
              </button>
            </div>
          )}
        </div>
        <Link href="/total-dashboard">
          <button className="flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap">
            <BarChart3 className="h-3 w-3" />
            Total Dashboard
          </button>
        </Link>
        {/* Excel dropdown */}
        <div className="tv-drop-wrap relative inline-flex">
          <button
            onClick={() => setOpenDrop(p => p === 'excel' ? null : 'excel')}
            disabled={rows.length === 0}
            className="flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3 w-3" />Excel
            <ChevronDown className="h-3 w-3" />
          </button>
          {openDrop === 'excel' && (
            <div className="absolute top-full left-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-lg min-w-[200px] z-50 p-1">
              <button onClick={() => { handleExportExcel(); setOpenDrop(null); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
                <Download className="h-3 w-3" />Excel'e Aktar
              </button>
              <button onClick={() => { setShowSevkiyatBilgisiModal(true); setOpenDrop(null); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
                <Download className="h-3 w-3" />Sevkiyat Bilgisi Çek
              </button>
              <div className="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />
              <button onClick={() => { setShowExcelImportModal(true); setOpenDrop(null); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
                <Upload className="h-3 w-3" />Excel ile Veri Gir
              </button>
            </div>
          )}
        </div>
        <Link href="/total-verimlilik/gecmis">
          <button className="flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <History className="h-3 w-3" />Geçmiş
          </button>
        </Link>

        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        {/* Format toolbar */}
        <button onClick={() => toggleFmt('bold')} className={`w-7 h-7 rounded flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 ${activeFmt.bold ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`} title="Kalın">
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => toggleFmt('italic')} className={`w-7 h-7 rounded flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 ${activeFmt.italic ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`} title="İtalik">
          <Italic className="h-3.5 w-3.5" />
        </button>

        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

        {/* Text color */}
        <div className="tv-drop-wrap relative inline-flex">
          <button onClick={() => setOpenDrop(p => p === 'textColor' ? null : 'textColor')} className="w-8 h-7 rounded flex flex-col items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 gap-0.5" title="Metin Rengi">
            <span className="text-[10px] font-bold leading-none" style={{ color: activeFmt.textColor || 'currentColor' }}>A</span>
            <span className="w-4 h-0.5 rounded" style={{ background: activeFmt.textColor || '#111' }} />
          </button>
          {openDrop === 'textColor' && (
            <div className="tv-color-pop absolute top-full left-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg shadow-xl z-50 p-2.5 w-[178px]">
              <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Metin Rengi</div>
              <div className="grid grid-cols-4 gap-1.5 mb-1.5">
                {TEXT_PALETTE.map(c => (
                  <button key={c} title={c} className={`h-7 rounded border ${activeFmt.textColor === c ? 'ring-2 ring-offset-1 ring-blue-500' : 'border-zinc-200 dark:border-zinc-700'}`} style={{ background: c }} onClick={() => { applyToSelection('textColor', c); setOpenDrop(null); }} />
                ))}
              </div>
              <button className="w-full h-7 rounded border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={() => { applyToSelection('textColor', undefined); setOpenDrop(null); }}>Renksiz</button>
            </div>
          )}
        </div>

        {/* Fill color */}
        <div className="tv-drop-wrap relative inline-flex">
          <button onClick={() => setOpenDrop(p => p === 'fillColor' ? null : 'fillColor')} className="w-8 h-7 rounded flex flex-col items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 gap-0.5" title="Hücre Rengi">
            <PaintBucket className="h-3 w-3" />
            <span className="w-4 h-0.5 rounded border border-zinc-300" style={{ background: activeFmt.fillColor || 'transparent' }} />
          </button>
          {openDrop === 'fillColor' && (
            <div className="tv-color-pop absolute top-full left-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg shadow-xl z-50 p-2.5 w-[206px]">
              <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Hücre Rengi</div>
              <div className="grid grid-cols-5 gap-1.5 mb-1.5">
                {FILL_PALETTE.map(c => (
                  <button key={c} title={c} className={`h-7 rounded border ${activeFmt.fillColor === c ? 'ring-2 ring-offset-1 ring-blue-500' : 'border-zinc-200 dark:border-zinc-700'}`} style={{ background: c }} onClick={() => { applyToSelection('bg', c); setOpenDrop(null); }} />
                ))}
              </div>
              <button className="w-full h-7 rounded border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={() => { applyToSelection('bg', undefined); setOpenDrop(null); }}>Renksiz</button>
            </div>
          )}
        </div>

        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

        {/* Alignment */}
        {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => (
          <button key={a} onClick={() => applyToSelection('align', activeFmt.align === a ? undefined : a as 'left' | 'center' | 'right')} className={`w-7 h-7 rounded flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 ${activeFmt.align === a ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`} title={a}>
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}

        {/* Selection badge */}
        {(selRows.size > 0 || selCols.size > 0 || selCells.size > 0) && (
          <>
            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 border border-blue-200">
              {[
                selCells.size > 0 && `${selCells.size} hücre`,
                selRows.size > 0 && `${selRows.size} satır`,
                selCols.size > 0 && `${selCols.size} sütun`,
              ].filter(Boolean).join(' + ')}
            </span>
            <button onClick={clearSel} className="w-6 h-6 rounded flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Seçimi temizle">
              <X className="h-3 w-3" />
            </button>
          </>
        )}

        <div className="flex-1" />

        {/* Legend */}
        <div className="hidden md:flex items-center gap-2 text-[9.5px] text-zinc-400">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-300" />Manuel</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />Hesap</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-300" />Sonuç</span>
        </div>

        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

        {/* Advanced filter button */}
        <button onClick={() => setAdvFilterOpen(true)} className={`flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border ${advFilters.length > 0 ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`} title="Gelişmiş Filtre">
          <SlidersHorizontal className="h-3 w-3" />
          Gelişmiş Filtre
          {advFilters.length > 0 && <span className="px-1 rounded bg-blue-600 text-white text-[9px] font-bold">{advFilters.length}</span>}
        </button>

        {/* Filter bar toggle */}
        <button onClick={() => setShowFilterBar(v => !v)} className={`flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border ${showFilterBar ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
          <Filter className="h-3 w-3" />Havuz / Dönem
          <ChevronDown className={`h-3 w-3 transition-transform ${showFilterBar ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* ─── COLLAPSIBLE FILTER BAR (Havuz/Ay/Yıl/Marka/Ürün Grubu/Maliyet) ─── */}
      <div className={`bg-white dark:bg-zinc-900 overflow-hidden transition-all flex-shrink-0 ${showFilterBar ? 'max-h-20 border-b border-zinc-200 dark:border-zinc-800' : 'max-h-0'}`}>
        <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-semibold text-zinc-400">Havuz</span>
            <Select value={selectedPoolId} onValueChange={setSelectedPoolId}>
              <SelectTrigger className="h-7 w-48 text-[11.5px]"><SelectValue placeholder="Havuz seçin..." /></SelectTrigger>
              <SelectContent>{efficiencyPools.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.memberIds.length} lab)</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-semibold text-zinc-400">Ay</span>
            <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(Number(v))}>
              <SelectTrigger className="h-7 w-28 text-[11.5px]"><SelectValue /></SelectTrigger>
              <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i)}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-semibold text-zinc-400">Yıl</span>
            <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
              <SelectTrigger className="h-7 w-20 text-[11.5px]"><SelectValue /></SelectTrigger>
              <SelectContent>{YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-semibold text-zinc-400">Marka</span>
            <Select value={selectedBrand || '__all__'} onValueChange={v => setSelectedBrand(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-7 w-32 text-[11.5px]"><SelectValue placeholder="Tümü" /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">Tümü</SelectItem>{brandAndGroupOptions.brands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-semibold text-zinc-400">Ürün Grubu</span>
            <Select value={selectedUrunGrubu || '__all__'} onValueChange={v => setSelectedUrunGrubu(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-7 w-36 text-[11.5px]"><SelectValue placeholder="Tümü" /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">Tümü</SelectItem>{brandAndGroupOptions.groups.map(g => <SelectItem key={g} value={g}>{urunGrubuLabels[g] || g}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-semibold text-zinc-400">Maliyet Dönemi</span>
            <Select value={selectedCostCheckpoint} onValueChange={setSelectedCostCheckpoint}>
              <SelectTrigger className="h-7 w-36 text-[11.5px]"><SelectValue placeholder={costCheckpoints.length === 0 ? 'Yok' : 'Seçin...'} /></SelectTrigger>
              <SelectContent>{costCheckpoints.map(cp => <SelectItem key={cp.id} value={cp.id}>{MONTHS[cp.month]?.label} {cp.year}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-semibold text-zinc-400">Para</span>
            <Select value={costCurrency} onValueChange={v => setCostCurrency(v as 'TRY' | 'USD' | 'EUR')}>
              <SelectTrigger className="h-7 w-20 text-[11.5px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="TRY">TRY ₺</SelectItem><SelectItem value="USD">USD $</SelectItem><SelectItem value="EUR">EUR €</SelectItem></SelectContent>
            </Select>
          </div>
          {selectedCostCheckpoint && costCheckpointData && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
              {Object.keys(costCheckpointData).length} ürün maliyeti yüklendi
            </span>
          )}
          {selectedPool?.centerLabId && centerLab && (
            <button
              onClick={centerHakEdisMode ? resetCenterHakEdisMode : calculateCenterHakEdis}
              disabled={isCalculatingCenterHakEdis || rows.length === 0}
              className={`flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border ${centerHakEdisMode ? 'bg-amber-100 border-amber-300 text-amber-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}
              title={centerHakEdisMode ? 'Merkez modunu sıfırla' : `Merkez Lab: ${centerLab.name}`}
            >
              {isCalculatingCenterHakEdis ? <Loader2 className="h-3 w-3 animate-spin" /> : centerHakEdisMode ? <RotateCcw className="h-3 w-3" /> : <Crown className="h-3 w-3" />}
              {centerHakEdisMode ? 'Merkez Mod ON' : 'Merkez Hak Ediş'}
            </button>
          )}
        </div>
      </div>

      {/* ─── TABLE TOOLBAR ──────────────────────────────────────────── */}
      <div className="bg-white dark:bg-zinc-900 border-b-2 border-zinc-300 dark:border-zinc-700 px-3 h-9 flex items-center gap-1.5 flex-shrink-0">
        <div className="flex items-center gap-1 px-2 h-7 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 w-56">
          <Search className="h-3 w-3 text-zinc-400" />
          <input
            placeholder="Ürün, stok kodu, test adı..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="bg-transparent border-0 outline-0 text-[11.5px] flex-1 placeholder:text-zinc-400"
          />
          {searchTerm && <button onClick={() => setSearchTerm('')} className="text-zinc-400 hover:text-zinc-700"><X className="h-3 w-3" /></button>}
        </div>
        <button
          onClick={() => setShowResultsOnly(v => !v)}
          className={`flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border ${showResultsOnly ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
        >
          {showResultsOnly ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          Sadece Sonuçları
        </button>
        <button
          onClick={() => setShowCostColumns(v => !v)}
          className={`flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border ${showCostColumns ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
        >
          <span className="font-bold">{cur}</span>
          Maliyet
        </button>
        <button
          onClick={() => runAiAnalysis('table')}
          className="flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
        >
          <Bot className="h-3 w-3" />Analiz Et
        </button>
        {(Object.keys(colValFilters).length > 0 || advFilters.length > 0 || hasActiveFilters) && (
          <button onClick={() => { setColValFilters({}); clearAllFilters(); clearAdvFilters(); }} className="flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">
            <X className="h-3 w-3" />
            {Object.keys(colValFilters).length + advFilters.length + (sortConfig.column ? 1 : 0) + (searchTerm ? 1 : 0)} filtre aktif
          </button>
        )}
        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700" />
        <button onClick={expandAllLabs} className="flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <Maximize2 className="h-3 w-3" />Tümünü Aç
        </button>
        <button onClick={collapseAllLabs} className="flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <Minimize2 className="h-3 w-3" />Tümünü Daralt
        </button>
        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700" />
        <button
          onClick={() => setColMgrOpen(v => !v)}
          className={`flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium border ${colMgrOpen ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
        >
          <Columns3 className="h-3 w-3" />Sütunlar
          {hiddenCols.size > 0 && <span className="ml-1 px-1 rounded bg-orange-500 text-white text-[9px] font-bold">{hiddenCols.size}</span>}
        </button>
        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700" />
        {/* Excel-tarzı formül çubuğu: tıklanan hücre bir SONUÇ üretiyorsa,
            o sonucu üreten hesabı gerçek sayılarla burada gösterir. */}
        <div className="flex items-center gap-2 flex-1 min-w-0 border border-zinc-200 dark:border-zinc-700 rounded px-2 h-7 bg-zinc-50 dark:bg-zinc-800/50">
          <span className="text-[10px] font-mono font-bold text-emerald-600 shrink-0">fx</span>
          {(() => {
            if (!activeCell) {
              return <span className="text-[10.5px] text-zinc-400 truncate">Bir hücreye tıklayın — hesaplanan değerin formülü burada görünür</span>;
            }
            const fRow = rows.find(r => r.id === activeCell.rowId);
            const fCol = COLS_BY_ID[activeCell.colId];
            if (!fRow || !fCol) return <span className="text-[10.5px] text-zinc-400 truncate">—</span>;
            const formula = getCellFormula(fRow, fCol.id);
            return (
              <span className="text-[10.5px] truncate" title={formula || fCol.label}>
                <span className="font-semibold text-zinc-500">{fCol.num}. {fCol.label} · {fRow.stokAdi}: </span>
                {formula
                  ? <span className="font-mono text-zinc-800 dark:text-zinc-200">{formula}</span>
                  : <span className="text-zinc-400">{fCol.type === 'manual' ? 'Manuel giriş (formül yok)' : '—'}</span>}
              </span>
            );
          })()}
        </div>
      </div>

      {/* ─── DATA TABLE ─────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden bg-white dark:bg-zinc-900">
        {!selectedPoolId ? (
          <div className="flex items-center justify-center h-full text-zinc-400 text-[13px]">
            <div className="text-center">
              <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <div className="font-medium mb-1">Verimlilik havuzu seçilmedi</div>
              <div className="text-[11px]">Üst toolbar'dan "Havuz / Dönem" panelini açın</div>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-400 text-[13px]">Bu havuz için min-max tanımlı ürün bulunamadı.</div>
        ) : totalVisibleRows === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-400 text-[13px]">
            <div className="text-center">
              <SlidersHorizontal className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <div className="font-medium mb-1 text-zinc-600">Filtreye uyan veri yok</div>
              <div className="text-[11px] mb-3">{rows.length} satırın hiçbiri aktif filtrelerle eşleşmiyor</div>
              <button onClick={() => { clearAdvFilters(); setColValFilters({}); setSearchTerm(''); }} className="px-3 py-1.5 rounded bg-blue-600 text-white text-[11px] font-semibold hover:bg-blue-700">
                Tüm Filtreleri Temizle
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Edge glow (green spotlight) */}
            <div ref={greenGlowLeftRef} className="pointer-events-none absolute left-0 top-0 bottom-0 w-20 z-30" style={{ opacity: 0, background: 'linear-gradient(to right, rgba(34,197,94,0.18), transparent)', transition: 'opacity 120ms' }} />
            <div ref={greenGlowRightRef} className="pointer-events-none absolute right-0 top-0 bottom-0 w-20 z-30" style={{ opacity: 0, background: 'linear-gradient(to left, rgba(34,197,94,0.18), transparent)', transition: 'opacity 120ms' }} />
            {/* Minimalist horizontal scroll slider */}
            <div className="px-3 py-1 border-b border-zinc-200/70 dark:border-zinc-700/60 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-sm">
              <input
                ref={sliderRef}
                type="range"
                min={0}
                max={100}
                step={0.1}
                defaultValue={0}
                onChange={handleSliderChange}
                aria-label="Tabloyu yatay kaydır"
                className="table-hscroll-slider"
              />
            </div>
            <ScrollArea className="w-full h-[calc(100%-22px)]" ref={scrollContainerRef}>
              <div ref={tableParentRef} style={{ minWidth: visibleCols.reduce((s, c) => s + c.w, 0) + 36 }}>
                <table className="border-separate border-spacing-0 w-full">
                  <thead>
                    <tr>
                      {/* Row select column */}
                      <th className="sticky top-0 left-0 z-40 bg-zinc-100 dark:bg-zinc-800 border-b-2 border-r border-zinc-300 dark:border-zinc-700 h-8 w-9 px-1">
                        <span className="text-[9px] text-zinc-400">#</span>
                      </th>
                      {visibleCols.map(col => {
                        const stickyLeft = col.frozen ? stickyLeftByColId[col.id] : undefined;
                        const isSel = selCols.has(col.id);
                        const colFmt = colFmts[col.id] || {};
                        const hasFilter = !!colValFilters[col.id];
                        return (
                          <th
                            key={col.id}
                            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, rowId: null, colId: col.id }); }}
                            className={`group sticky top-0 ${col.frozen ? 'z-40' : 'z-30'} border-b-2 border-r border-zinc-300 dark:border-zinc-700 ${headerBgClass(col.type)} ${isSel ? 'outline outline-2 outline-blue-500 -outline-offset-2' : ''} h-8 px-1.5 text-left text-[9.5px] font-semibold text-zinc-600 dark:text-zinc-300 align-bottom`}
                            style={{ width: col.w, minWidth: col.w, left: stickyLeft, position: col.frozen ? 'sticky' : undefined, ...(colFmt.bg ? { background: colFmt.bg } : {}) }}
                          >
                            <div className="flex flex-col items-stretch gap-0">
                              <div className="flex items-center gap-1 cursor-pointer" onClick={(e) => toggleSelCol(col.id, e)}>
                                <span className="text-[8px] text-zinc-400 font-normal">{col.num}.</span>
                                <span className="flex-1 truncate">{col.label}</span>
                                {sortConfig.column === col.id && (sortConfig.direction === 'asc' ? <ArrowUp className="h-2.5 w-2.5 text-blue-600" /> : <ArrowDown className="h-2.5 w-2.5 text-blue-600" />)}
                                {AI_ANALYZABLE_COLS.includes(col.id) && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); runAiAnalysis('column', { colId: col.id }); }}
                                    className="opacity-0 group-hover:opacity-70 hover:!opacity-100 w-3.5 h-3.5 rounded-sm flex items-center justify-center hover:bg-indigo-100 text-indigo-600"
                                    title="Sütun AI analizi"
                                  >
                                    <Bot className="h-2.5 w-2.5" />
                                  </button>
                                )}
                                <button
                                  onClick={(e) => openColFilter(col, e)}
                                  className={`opacity-0 group-hover:opacity-70 hover:!opacity-100 w-3.5 h-3.5 rounded-sm flex items-center justify-center ${hasFilter ? 'opacity-100 bg-blue-600 text-white' : 'hover:bg-zinc-300/50'}`}
                                  title="Sırala / Filtrele"
                                ><ChevronDown className="h-2.5 w-2.5" /></button>
                                {!col.frozen && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleHidden(col.id); }}
                                    className="opacity-0 group-hover:opacity-70 hover:!opacity-100 w-3.5 h-3.5 rounded-sm flex items-center justify-center hover:bg-zinc-300/50"
                                    title="Sütunu gizle"
                                  ><X className="h-2.5 w-2.5" /></button>
                                )}
                              </div>
                              {col.sub && <span className="text-[8.5px] text-zinc-400 font-normal pl-3 -mt-0.5">{col.sub}</span>}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedRows.map(group => {
                      const isOpen = expandedLabs.has(group.labId);
                      const avgKitVerim = group.rows.length > 0 ? Math.max(0, Math.min(100, 100 - (group.rows.reduce((s, r) => s + Math.abs(r.kitVerimlilikYuzde), 0) / group.rows.length))) : 0;
                      const totalHak = group.rows.reduce((s, r) => s + r.hakEdis, 0);
                      return (
                        <React.Fragment key={group.labId}>
                          {/* Group row */}
                          <tr onClick={() => toggleLabExpand(group.labId)} className="cursor-pointer select-none">
                            <td colSpan={1 + visibleCols.length} className="sticky top-8 left-0 z-20 bg-zinc-900 dark:bg-zinc-800 text-white border-b border-zinc-950 h-8 px-2">
                              <div className="flex items-center gap-2">
                                <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                                <span className="font-semibold text-[11.5px]">{group.labName}</span>
                                {group.labKod && <span className="text-[9.5px] text-zinc-400 font-mono">({group.labKod})</span>}
                                <span className="text-[9.5px] text-zinc-400">· {group.rows.length} ürün</span>
                                <div className="flex-1" />
                                <span className="text-[9.5px] text-zinc-400">Ort. Verimlilik: <strong className={`font-mono ${avgKitVerim >= 90 ? 'text-emerald-400' : avgKitVerim >= 70 ? 'text-amber-400' : 'text-rose-400'}`}>%{avgKitVerim.toFixed(0)}</strong></span>
                                <span className="text-[9.5px] text-zinc-400">Hak Ediş: <strong className="font-mono text-white">{fmtN(totalHak)}</strong></span>
                              </div>
                            </td>
                          </tr>

                          {/* Product rows (only render when expanded) */}
                          {isOpen && group.rows.map((row, ri) => {
                            const isRowSel = selRows.has(row.id);
                            const rowFmt = rowFmts[row.id] || {};
                            return (
                              <tr key={row.id} className={isRowSel ? 'bg-blue-50 dark:bg-blue-950/40' : (ri % 2 === 1 ? 'bg-zinc-50/50 dark:bg-zinc-900/40' : '')}>
                                {/* Selection cell */}
                                <td
                                  onClick={(e) => toggleSelRow(row.id, e)}
                                  className={`sticky left-0 z-10 ${isRowSel ? 'bg-blue-100 dark:bg-blue-950' : 'bg-white dark:bg-zinc-900'} border-b border-r border-zinc-200 dark:border-zinc-800 ${rowHeightCls} w-9 px-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800`}
                                >
                                  <div className="flex items-center justify-center">
                                    <div className={`w-3 h-3 rounded-sm border ${isRowSel ? 'bg-blue-600 border-blue-600 text-white flex items-center justify-center text-[8px]' : 'border-zinc-300'}`}>
                                      {isRowSel && '✓'}
                                    </div>
                                  </div>
                                </td>
                                {visibleCols.map(col => {
                                  const stickyLeft = col.frozen ? stickyLeftByColId[col.id] : undefined;
                                  const isColSel = selCols.has(col.id);
                                  const isCellSel = selCells.has(`${row.id}-${col.id}`);
                                  const cellFmt = getMergedFmt(row.id, col.id);
                                  const cellStyle = fmtToStyle(cellFmt);
                                  const baseBg = !cellFmt.bg ? typeBgClass(col.type) : '';
                                  const isManual = col.type === 'manual';
                                  return (
                                    <td
                                      key={col.id}
                                      onMouseDown={(e) => onCellMouseDown(row.id, col.id, e)}
                                      onMouseEnter={() => onCellMouseEnter(row.id, col.id)}
                                      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, rowId: row.id, colId: col.id }); }}
                                      className={`tv-cell border-b border-r border-zinc-200 dark:border-zinc-800 ${rowHeightCls} ${isManual ? 'p-0' : 'px-2'} align-middle ${baseBg} ${col.frozen ? 'sticky z-10 bg-white dark:bg-zinc-900' : ''} ${isColSel ? 'outline outline-1 outline-blue-300 -outline-offset-1' : ''} ${isRowSel ? '!bg-blue-50 dark:!bg-blue-950/40' : ''} ${isCellSel ? 'tv-cell-selected' : ''}`}
                                      style={{ width: col.w, minWidth: col.w, left: stickyLeft, position: col.frozen ? 'sticky' : undefined, ...cellStyle }}
                                    >
                                      {renderCellValue(col, row)}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="sticky bottom-0 left-0 z-20 bg-zinc-900 text-white border-t border-r border-zinc-800 h-8 w-9 px-1 text-[9px]">Σ</td>
                      {visibleCols.map(col => {
                        const stickyLeft = col.frozen ? stickyLeftByColId[col.id] : undefined;
                        return (
                          <td
                            key={`footer-${col.id}`}
                            className={`sticky bottom-0 ${col.frozen ? 'z-20' : 'z-10'} bg-zinc-100 dark:bg-zinc-800 border-t border-r border-zinc-300 dark:border-zinc-700 h-8 px-2 text-[10px] text-zinc-700 dark:text-zinc-200`}
                            style={{ width: col.w, minWidth: col.w, left: stickyLeft, position: col.frozen ? 'sticky' : undefined }}
                          >
                            {renderFooterValue(col)}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </>
        )}
      </div>

      {/* ─── COLUMN MANAGER MODAL ───────────────────────────────────── */}
      {colMgrOpen && (
        <div className="fixed inset-0 z-50" onClick={() => setColMgrOpen(false)}>
          <div className="absolute right-3 top-32 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg shadow-xl w-72 max-h-[480px] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
              <span className="text-[12px] font-semibold">Sütun Görünürlüğü</span>
              <div className="flex gap-1">
                <button onClick={showAllCols} className="text-[10px] text-zinc-500 hover:text-zinc-900 px-1.5 py-0.5 rounded hover:bg-zinc-100">Tümünü Göster</button>
                <button onClick={() => setColMgrOpen(false)} className="w-5 h-5 rounded flex items-center justify-center hover:bg-zinc-100"><X className="h-3 w-3" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {(['info', 'manual', 'calc', 'result'] as ColType[]).map(t => {
                const cols = allCols.filter(c => c.type === t && !c.frozen);
                if (cols.length === 0) return null;
                const tlabel = t === 'info' ? 'Sabit' : t === 'manual' ? 'Manuel Giriş' : t === 'calc' ? 'Hesaplanan' : 'Sonuç';
                const dot = t === 'info' ? 'bg-zinc-300' : t === 'manual' ? 'bg-blue-300' : t === 'calc' ? 'bg-emerald-300' : 'bg-violet-300';
                return (
                  <div key={t}>
                    <div className="px-3 pt-2 pb-1 text-[9.5px] font-bold uppercase text-zinc-400 flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{tlabel}</div>
                    {cols.map(c => (
                      <button key={c.id} onClick={() => toggleHidden(c.id)} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                        <span className="flex-1 text-left text-[11.5px]">{c.num}. {c.label}</span>
                        <div className={`w-3 h-3 rounded-sm border ${!hiddenCols.has(c.id) ? 'bg-zinc-900 border-zinc-900 text-white flex items-center justify-center text-[7px]' : 'border-zinc-300'}`}>
                          {!hiddenCols.has(c.id) && '✓'}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── COLUMN HEADER FILTER POPOVER ───────────────────────────── */}
      {colFilterOpen && (
        <ColFilterPopover
          col={colFilterOpen.col}
          x={colFilterOpen.x}
          y={colFilterOpen.y}
          allValues={colFilterOpen.allValues}
          activeFilter={colValFilters[colFilterOpen.col.id] || null}
          sortCol={sortConfig.column}
          sortDir={sortConfig.direction}
          onSort={(dir) => { setSort(colFilterOpen.col.id, dir); setColFilterOpen(null); }}
          onClearSort={() => { setSort(null, 'asc'); setColFilterOpen(null); }}
          onHide={() => { toggleHidden(colFilterOpen.col.id); setColFilterOpen(null); }}
          onApply={(vals) => { applyColValFilter(colFilterOpen.col.id, vals); setColFilterOpen(null); }}
          onClose={() => setColFilterOpen(null)}
        />
      )}

      {/* ─── CONTEXT MENU ───────────────────────────────────────────── */}
      {ctxMenu && (
        <CtxMenu
          menu={ctxMenu}
          onApply={(t, k, v) => applyCtxFmt(t, k, v, ctxMenu)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* ─── ADVANCED FILTER SIDE PANEL (right slide-in) ───────────── */}
      {advFilterOpen && (
        <div className="absolute inset-0 z-40 pointer-events-none">
          {/* backdrop click area only on left side, panel is non-blocking */}
          <div className="absolute inset-0 pointer-events-auto" onClick={() => setAdvFilterOpen(false)} />
          <aside className="absolute right-0 top-0 bottom-0 w-[420px] max-w-full bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl pointer-events-auto flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 h-12 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-blue-600" />
                <span className="font-semibold text-[13px]">Gelişmiş Filtre</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="inline-flex rounded border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                  {(['AND', 'OR'] as const).map(m => (
                    <button key={m} onClick={() => setAdvMode(m)} className={`px-2.5 py-1 text-[10.5px] font-bold ${advMode === m ? 'bg-blue-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{m}</button>
                  ))}
                </div>
                <button onClick={() => setAdvFilterOpen(false)} className="w-7 h-7 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center" title="Kapat">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {advFilters.length === 0 ? (
                <div className="border border-dashed border-zinc-200 dark:border-zinc-700 rounded-md p-6 text-center text-[11.5px] text-zinc-400">
                  Henüz kural eklenmedi. Aşağıdaki "Kural Ekle" tuşuyla başlayın.
                </div>
              ) : advFilters.map((f, i) => (
                <div key={f.id} className="flex items-center gap-2">
                  <span className="text-[9px] font-bold uppercase text-zinc-400 w-6 text-right">{i === 0 ? 'GİR' : advMode}</span>
                  <Select value={f.col} onValueChange={v => updateAdvFilter(f.id, { col: v })}>
                    <SelectTrigger className="h-8 flex-1 text-[11.5px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {allCols.filter(c => c.id !== 'lab').map(c => <SelectItem key={c.id} value={c.id}>{c.num}. {c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={f.op} onValueChange={v => updateAdvFilter(f.id, { op: v as AdvOp })}>
                    <SelectTrigger className="h-8 w-24 text-[11.5px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ADV_OPS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    value={f.val}
                    onChange={e => updateAdvFilter(f.id, { val: e.target.value })}
                    placeholder={f.op === 'between' ? 'min,max' : f.op === 'topPct' ? '10' : f.op === 'topN' ? '5' : (f.op === 'aboveAvg' || f.op === 'belowAvg') ? '—' : 'değer'}
                    disabled={f.op === 'aboveAvg' || f.op === 'belowAvg'}
                    className="h-8 w-24 text-[11.5px]"
                  />
                  <button onClick={() => removeAdvFilter(f.id)} className="w-7 h-7 rounded flex items-center justify-center text-zinc-400 hover:text-rose-500 hover:bg-rose-50" title="Kaldır">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button onClick={addAdvFilter} className="w-full mt-2 flex items-center justify-center gap-1.5 py-2 border border-dashed border-zinc-300 dark:border-zinc-700 rounded text-[11.5px] text-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-400">
                <Plus className="h-3.5 w-3.5" />Kural Ekle
              </button>
              {advFilters.length > 0 && (
                <div className="text-[11px] text-zinc-500 bg-zinc-50 dark:bg-zinc-800 px-2 py-1.5 rounded mt-2">
                  <strong>{totalVisibleRows}</strong>/{rows.length} satır gösteriliyor
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="flex gap-2 p-3 border-t border-zinc-200 dark:border-zinc-800 flex-shrink-0">
              <button onClick={clearAdvFilters} className="flex-1 h-9 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[12px] font-medium">Temizle</button>
              <button onClick={() => setAdvFilterOpen(false)} className="flex-1 h-9 rounded bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold">Uygula</button>
            </div>
          </aside>
        </div>
      )}


      <Dialog open={pivotDrillOpen} onOpenChange={setPivotDrillOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Drill-through</DialogTitle>
            <DialogDescription>Hastane → Ürün → Seri (stok kodu) → İşlem (satır id)</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto text-[12px]">
            <table className="w-full">
              <thead><tr className="text-left border-b"><th className="py-1">Hastane</th><th>Ürün</th><th>Seri</th><th>İşlem</th></tr></thead>
              <tbody>
                {pivotDrillRows.map(r => (
                  <tr key={r.id} className="border-b">
                    <td className="py-1">{r.labName}</td>
                    <td>{r.stokAdi}</td>
                    <td className="font-mono">{r.stokKodu}</td>
                    <td className="font-mono">{r.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={aiAnalysisOpen} onOpenChange={setAiAnalysisOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>AI Analiz — {aiTargetLabel}</DialogTitle>
            <DialogDescription>
              Gemini destekli içgörü motoru: smart alert, anomaly ve forecast çıktıları.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded border bg-zinc-50 p-3 min-h-[220px] max-h-[60vh] overflow-auto text-[12px] whitespace-pre-wrap">
            {aiAnalyzing ? (
              <div className="flex items-center gap-2 text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />AI analiz hazırlanıyor...</div>
            ) : aiAnalysisText || 'Henüz analiz yok.'}
          </div>
        </DialogContent>
      </Dialog>

      {/* Sevkiyat Bilgisi Modal - Sütun 11 */}
      <Dialog open={showSevkiyatBilgisiModal} onOpenChange={setShowSevkiyatBilgisiModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sevkiyat Bilgisi Çek</DialogTitle>
            <DialogDescription>
              {MONTHS[selectedMonth]?.label} {selectedYear} döneminde seçilen depodan laboratuvarlara yapılan sevkiyat verilerini çeker.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Gönderen Depo Seçimi */}
            <div className="space-y-2">
              <Label className="font-medium">Gönderen Depo</Label>
              <Select value={selectedDepotForSevkiyat} onValueChange={setSelectedDepotForSevkiyat}>
                <SelectTrigger>
                  <SelectValue placeholder="Depo seçin..." />
                </SelectTrigger>
                <SelectContent>
                  {depots.map(depot => (
                    <SelectItem key={depot.id} value={depot.id}>{depot.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Alıcı Laboratuvar Seçimi */}
            <LabSelector
              mode="multi"
              label="Alıcı Laboratuvarlar"
              labs={poolLabs.map(l => ({ id: l.id, name: l.name, kod: l.kod }))}
              values={Array.from(selectedLabsForSevkiyat)}
              onValuesChange={(ids) => setSelectedLabsForSevkiyat(new Set(ids))}
              placeholder="Laboratuvar seçin"
              showChips
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSevkiyatBilgisiModal(false)}>
              İptal
            </Button>
            <Button onClick={handleFetchSevkiyatBilgisi} disabled={isFetchingSevkiyat || !selectedDepotForSevkiyat || selectedLabsForSevkiyat.size === 0}>
              {isFetchingSevkiyat ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Çekiliyor...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Bilgileri Al
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kurumlar Arası Sevk Modal - Sütun 12 */}
      <Dialog open={showKurumlarArasiModal} onOpenChange={(open) => {
        if (!open) {
          setKurumlarArasiEditingRow(null);
        }
        setShowKurumlarArasiModal(open);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Kaynak Laboratuvar Seç</DialogTitle>
            <DialogDescription>
              {kurumlarArasiEditingRow && (
                <>
                  {kurumlarArasiEditingRow.value} kutu ürün hangi laboratuvardan alındı?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-md p-3 max-h-60 overflow-y-auto space-y-2">
            {poolLabs
              .filter(lab => {
                // Kendi kendine transfer yapılamaz
                if (!kurumlarArasiEditingRow) return true;
                const editingRow = rows.find(r => r.id === kurumlarArasiEditingRow.rowId);
                return lab.id !== editingRow?.labId;
              })
              .map(lab => (
                <Button
                  key={lab.id}
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handleConfirmKurumlarArasi(lab.id)}
                >
                  <ChevronRight className="h-4 w-4 mr-2" />
                  {lab.name}
                </Button>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowKurumlarArasiModal(false);
              setKurumlarArasiEditingRow(null);
            }}>
              İptal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 5 - Excel Import Modal */}
      <Dialog open={showExcelImportModal} onOpenChange={setShowExcelImportModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excel ile Veri Gir</DialogTitle>
            <DialogDescription>
              Şablonu indirip verileri girdikten sonra dosyayı yükleyerek verileri aktarabilirsiniz.
              Sadece manuel giriş alanları (7, 8, 10, 13, 15, 16, 17, 19) aktarılır.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 gap-3">
              <Button
                variant="outline"
                className="h-20 flex flex-col gap-2"
                onClick={handleDownloadTemplate}
                disabled={totalVisibleRows === 0}
              >
                <Download className="h-6 w-6" />
                <span>Şablon İndir</span>
              </Button>
              <Button
                variant="default"
                className="h-20 flex flex-col gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={rows.length === 0 || isImportingExcel}
              >
                {isImportingExcel ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span>Yükleniyor...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-6 w-6" />
                    <span>Verileri Aktar</span>
                  </>
                )}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Not:</strong> Excel'de şu sütunlar aktarılacak:</p>
              <ul className="list-disc list-inside ml-2">
                <li>7. Başlangıç Stoğu (Kutu)</li>
                <li>8. Ay Başı Cihaz Üstü (Test)</li>
                <li>10. Ay Başı Sevkiyat (Kutu)</li>
                <li>13. Lojistik Ara Transfer (Kutu)</li>
                <li>15. Kümülatif Total (Test)</li>
                <li>16. Dönem Sonu Stok (Kutu)</li>
                <li>17. Dönem Sonu Cihaz Üstü (Test)</li>
                <li>19. Hak Ediş (Test)</li>
              </ul>
              <p className="text-orange-600 dark:text-orange-400 mt-2">
                11. Göztepe Sevkiyat (Kutu) ve 12. Kurumlar Arası Sevk sütunları sadece panel üzerinden yönetilir. Sütun 11 için &quot;Sevkiyat Bilgisi Çek&quot; butonunu kullanın.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExcelImportModal(false)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden file input for Excel import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleExcelImport}
        accept=".xlsx,.xls"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}
