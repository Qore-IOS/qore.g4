
'use client';
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Hospital, Depot, ProductCode, MinMaxRule } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Search,
  ScanBarcode,
  Building2,
  TestTube,
  Package,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  ArrowRight,
  Save,
  X,
  ClipboardCheck,
  CalendarDays,
  ChevronDown,
  AlertCircle,
  Plus,
  Mic,
  MicOff,
  Users,
  UserPlus,
  Mail,
  ShieldCheck,
  Bell,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';
import useHidScanner from '@/hooks/useHidScanner';
import { parseAndResolveBarcode } from '@/lib/barcode';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  createSession, joinSession, declineSession, updatePresence, removePresence,
  updateSessionCountData, completeSession, subscribeToSession, subscribeToUserSessions,
  getUsersForLocation, getPresenceColor,
  type MaliyetSayimOturum, type SessionParticipant, type PresenceData,
} from '@/lib/maliyet-session';
import { emitMaliyetSayimInvitation } from '@/lib/notifications';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

// ============================================================================
// TYPES
// ============================================================================

interface LotEntry {
  lot: string;
  miad?: string;        // dd.MM.yyyy format
  count: number;
}

interface SerialEntry {
  serial: string;
  lot?: string;
  miad?: string;        // dd.MM.yyyy format
}

interface ExpiryWarning {
  id: string;
  miad: string;         // yyyy-MM-dd (input date format)
}

interface ProductCountEntry {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  stokAdedi: string;   // string to allow empty
  cihazUstuAdedi: string; // string to allow empty
  counted: boolean;
  lots: LotEntry[];
  serials: SerialEntry[];
  expiryWarnings: ExpiryWarning[];
}

interface CostByCurrency {
  TRY: number;
  EUR: number;
  USD: number;
}

interface BrandProgress {
  brand: string;
  total: number;
  completed: number;
  status: 'idle' | 'in_progress' | 'completed';
  costs: CostByCurrency;
}

type LocationType = 'lab' | 'depot';
type VoiceAssistantActionType = 'complete_count' | 'complete_brand' | 'next_brand' | 'go_to_brand';

interface MaliyetSayimPanelProps {
  hospitals: Hospital[];
  depots: Depot[];
  productCodes: ProductCode[];
}

// ============================================================================
// HELPERS
// ============================================================================

/** Parse dd.MM.yyyy to Date */
function parseDdMmYyyy(s: string): Date | null {
  const parts = s.split('.');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

/** Get remaining days from today to expiry date string (dd.MM.yyyy or yyyy-MM-dd) */
function getRemainingDays(miad: string): number | null {
  let date: Date | null = null;
  if (miad.includes('.')) {
    date = parseDdMmYyyy(miad);
  } else if (miad.includes('-')) {
    date = new Date(miad);
  }
  if (!date || isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Get expiry color class */
function expiryColor(days: number | null): string {
  if (days === null) return '';
  if (days <= 30) return 'text-red-600 bg-red-50 border-red-200';
  if (days <= 45) return 'text-amber-600 bg-amber-50 border-amber-200';
  return '';
}

/** Calculate total cost for a single product based on count data */
function calcProductCost(product: ProductCode, entry?: ProductCountEntry): { amount: number; currency: string } {
  if (!entry || !product.cost || !product.ambalajDegeri) return { amount: 0, currency: product.currency || 'TRY' };
  const stokNum = parseInt(entry.stokAdedi, 10) || 0;
  const cihazNum = parseInt(entry.cihazUstuAdedi, 10) || 0;
  const toplamTest = (stokNum * product.ambalajDegeri) + cihazNum;
  if (toplamTest <= 0) return { amount: 0, currency: product.currency || 'TRY' };
  return { amount: (product.cost / product.ambalajDegeri) * toplamTest, currency: product.currency || 'TRY' };
}

/** Format CostByCurrency as display string */
function formatCosts(costs: CostByCurrency): string {
  const parts: string[] = [];
  if (costs.EUR > 0) parts.push(`${costs.EUR.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}€`);
  if (costs.USD > 0) parts.push(`${costs.USD.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}$`);
  if (costs.TRY > 0) parts.push(`${costs.TRY.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}₺`);
  return parts.join(' + ');
}

function getBrandsFromRules(
  minMaxRules: MinMaxRule[],
  productCodes: ProductCode[]
): string[] {
  if (minMaxRules.length === 0) return [];
  const stokKoduSet = new Set(minMaxRules.map(r => r.stokKodu));
  const brands = new Set<string>();
  productCodes.forEach(p => {
    if (stokKoduSet.has(p.stokKodu) && p.marka) {
      brands.add(p.marka);
    }
  });
  return Array.from(brands).sort((a, b) => a.localeCompare(b, 'tr'));
}

function getProductsForBrandFromRules(
  brand: string,
  minMaxRules: MinMaxRule[],
  productCodes: ProductCode[]
): ProductCode[] {
  if (minMaxRules.length === 0) return [];
  const stokKoduSet = new Set(minMaxRules.map(r => r.stokKodu));
  return productCodes
    .filter(p => p.marka === brand && stokKoduSet.has(p.stokKodu))
    .sort((a, b) => a.stokAdi.localeCompare(b.stokAdi, 'tr'));
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Brand item in the left sidebar checklist */
function BrandChecklistItem({
  brand,
  isActive,
  onClick,
  showCost,
}: {
  brand: BrandProgress;
  isActive: boolean;
  onClick: () => void;
  showCost: boolean;
}) {
  const pct = brand.total > 0 ? Math.round((brand.completed / brand.total) * 100) : 0;

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
      {/* Status icon */}
      <span className="shrink-0">
        {brand.status === 'completed' ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
        ) : brand.status === 'in_progress' ? (
          <div className="w-5 h-5 rounded-full border-2 border-amber-500 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
        ) : (
          <Circle className="w-5 h-5 text-[var(--dashboard-muted)]" />
        )}
      </span>

      {/* Brand info */}
      <div className="flex-1 min-w-0">
        <span className={cn(
          'text-sm font-medium block truncate',
          isActive ? 'text-[var(--dashboard-text)]' : 'text-[var(--dashboard-text)]/80'
        )}>
          {brand.brand}
        </span>
        <span className="text-xs text-[var(--dashboard-muted)]">
          {brand.completed} / {brand.total} ürün
        </span>
        {showCost && (brand.costs.TRY > 0 || brand.costs.EUR > 0 || brand.costs.USD > 0) && (
          <span className="text-[10px] font-semibold text-emerald-600">
            {formatCosts(brand.costs)}
          </span>
        )}
      </div>

      {/* Mini progress */}
      <div className="shrink-0 w-10 h-10 relative">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="14" fill="none" stroke="var(--dashboard-stroke)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="14" fill="none"
            stroke={brand.status === 'completed' ? '#10b981' : brand.status === 'in_progress' ? '#f59e0b' : 'var(--dashboard-stroke)'}
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

/** Product count card in the right panel */
function ProductCountCard({
  product,
  entry,
  onStokChange,
  onCihazChange,
  onMarkCounted,
  onAddExpiryWarning,
  onRemoveExpiryWarning,
  showCost,
  countedByName,
  activeUsers,
}: {
  product: ProductCode;
  entry: ProductCountEntry;
  onStokChange: (val: string) => void;
  onCihazChange: (val: string) => void;
  onMarkCounted: () => void;
  onAddExpiryWarning: (miad: string) => void;
  onRemoveExpiryWarning: (id: string) => void;
  showCost: boolean;
  countedByName?: string;
  activeUsers?: { name: string; color: string }[];
}) {
  const [accordionOpen, setAccordionOpen] = useState(false);

  const ambalajDegeri = product.ambalajDegeri || 0;
  const anaBirim = product.anaBirim || 'Adet';
  const stokNum = parseInt(entry.stokAdedi, 10) || 0;
  const cihazNum = parseInt(entry.cihazUstuAdedi, 10) || 0;
  const toplamTest = ambalajDegeri > 0 ? (stokNum * ambalajDegeri) + cihazNum : 0;

  const productCost = product.cost || 0;
  const currency = product.currency || 'TRY';
  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : '₺';
  const testBasinaMaliyet = ambalajDegeri > 0 && productCost > 0 ? productCost / ambalajDegeri : 0;
  const toplamMaliyet = testBasinaMaliyet * toplamTest;

  const hasTrackingData = entry.lots.length > 0 || entry.serials.length > 0;
  const hasExpiryWarnings = entry.expiryWarnings.length > 0;
  const hasAccordionContent = hasTrackingData || hasExpiryWarnings;

  // Find worst expiry across lots, serials, and manual warnings
  const allExpiries: number[] = [];
  entry.lots.forEach(l => { if (l.miad) { const d = getRemainingDays(l.miad); if (d !== null) allExpiries.push(d); } });
  entry.serials.forEach(s => { if (s.miad) { const d = getRemainingDays(s.miad); if (d !== null) allExpiries.push(d); } });
  entry.expiryWarnings.forEach(w => { const d = getRemainingDays(w.miad); if (d !== null) allExpiries.push(d); });
  const worstExpiry = allExpiries.length > 0 ? Math.min(...allExpiries) : null;
  const cardExpiryClass = expiryColor(worstExpiry);

  return (
    <div
      className={cn(
        'cihaz-card p-4 sm:p-5 transition-all duration-200',
        entry.counted && 'ring-1 ring-emerald-500/30 bg-emerald-500/5',
        cardExpiryClass && `ring-1 ${cardExpiryClass}`
      )}
    >
      {/* Active users indicator */}
      {activeUsers && activeUsers.length > 0 && (
        <div className="flex items-center gap-1 mb-2">
          {activeUsers.map((u, i) => (
            <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium text-white" style={{ backgroundColor: u.color }}>
              {u.name.split(' ')[0]}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        {/* Product info */}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-[var(--dashboard-text)] leading-snug truncate">
            {product.stokAdi}
          </h4>
          <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">
            {product.stokKodu}
            {product.urunGrubu && (
              <span className="ml-2 inline-flex items-center">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {product.urunGrubu === 'kit' ? 'Kit' : product.urunGrubu === 'sarf' ? 'Sarf' : 'Yedek Parça'}
                </Badge>
              </span>
            )}
            {worstExpiry !== null && worstExpiry <= 45 && (
              <span className={cn('ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded', worstExpiry <= 30 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
                {worstExpiry <= 0 ? 'Miadı geçmiş' : `${worstExpiry} gün`}
              </span>
            )}
          </p>
        </div>

        {/* Manual expiry warning + counted */}
        <div className="flex items-center gap-1.5 shrink-0">
          <label className="relative w-8 h-8 cursor-pointer" title="Miad uyarısı ekle">
            <span className="w-8 h-8 rounded-xl flex items-center justify-center bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-amber-600 transition-colors">
              <CalendarDays className="w-4 h-4" />
            </span>
            <input
              type="date"
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => {
                if (e.target.value) onAddExpiryWarning(e.target.value);
                e.target.value = '';
              }}
            />
          </label>
          <div className="flex flex-col items-center gap-0.5">
            <button
              onClick={onMarkCounted}
              className={cn(
                'w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200',
                entry.counted
                  ? 'bg-emerald-500 text-white shadow-md'
                  : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-accent)]'
              )}
            >
              <Check className="w-4 h-4" />
            </button>
            {countedByName && entry.counted && (
              <span className="text-[8px] text-emerald-600 font-medium truncate max-w-[60px]">{countedByName}</span>
            )}
          </div>
        </div>
      </div>

      {/* Count inputs + summary row */}
      <div className="flex gap-3 mt-3">
        {/* Left 60%: Inputs */}
        <div className="flex gap-3" style={{ flex: '0 0 60%' }}>
          <div className="flex-1">
            <label className="text-[11px] font-medium text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">
              Stok Adedi
            </label>
            <Input
              type="number"
              min="0"
              placeholder=""
              value={entry.stokAdedi}
              onChange={(e) => onStokChange(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-[11px] font-medium text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">
              Cihaz Üstü Test
            </label>
            <Input
              type="number"
              min="0"
              placeholder=""
              value={entry.cihazUstuAdedi}
              onChange={(e) => onCihazChange(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        {/* Right 40%: Ambalaj info + total test + cost */}
        <div className="flex flex-col justify-end items-end gap-1" style={{ flex: '0 0 calc(40% - 0.75rem)' }}>
          {ambalajDegeri > 0 && (
            <span className="text-[11px] text-[var(--dashboard-muted)]">
              {anaBirim} x{ambalajDegeri}
            </span>
          )}
          {ambalajDegeri > 0 && (stokNum > 0 || cihazNum > 0) ? (
            <div className="cihaz-pressed px-3 py-1.5 rounded-xl text-center w-full">
              <span className="text-[10px] text-[var(--dashboard-muted)] block">Toplam Test{showCost && toplamMaliyet > 0 ? ' / Maliyet' : ''}</span>
              <span className="text-base font-bold text-[var(--dashboard-accent)]">
                {toplamTest.toLocaleString('tr-TR')}
                {showCost && toplamMaliyet > 0 && (
                  <span className="text-emerald-600"> / {toplamMaliyet.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}{currencySymbol}</span>
                )}
              </span>
            </div>
          ) : !ambalajDegeri ? (
            <span className="text-[11px] text-[var(--dashboard-muted)] italic">{anaBirim}</span>
          ) : null}
        </div>
      </div>

      {/* Accordion: Lot/Serial/Expiry details */}
      {hasAccordionContent && (
        <div className="mt-3 border-t border-[var(--dashboard-stroke)] pt-2">
          <button
            onClick={() => setAccordionOpen(prev => !prev)}
            className="flex items-center gap-1.5 text-xs text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors w-full"
          >
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', accordionOpen && 'rotate-180')} />
            <span className="font-medium">
              {entry.serials.length > 0 && `${entry.serials.length} seri no`}
              {entry.serials.length > 0 && entry.lots.length > 0 && ' · '}
              {entry.lots.length > 0 && `${entry.lots.length} lot`}
              {(entry.serials.length > 0 || entry.lots.length > 0) && entry.expiryWarnings.length > 0 && ' · '}
              {entry.expiryWarnings.length > 0 && `${entry.expiryWarnings.length} miad uyarısı`}
            </span>
          </button>

          {accordionOpen && (
            <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
              {/* Serial entries */}
              {entry.serials.map((s, i) => {
                const days = s.miad ? getRemainingDays(s.miad) : null;
                const colorClass = expiryColor(days);
                return (
                  <div key={`s-${i}`} className={cn('flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border', colorClass || 'bg-[var(--dashboard-surface)] border-[var(--dashboard-stroke)]')}>
                    <span className="font-mono font-medium">SN: {s.serial}</span>
                    <div className="flex items-center gap-2">
                      {s.lot && <span className="text-[var(--dashboard-muted)]">Lot: {s.lot}</span>}
                      {s.miad && <span>{s.miad}{days !== null && days <= 45 ? ` (${days}g)` : ''}</span>}
                    </div>
                  </div>
                );
              })}

              {/* Lot entries */}
              {entry.lots.map((l, i) => {
                const days = l.miad ? getRemainingDays(l.miad) : null;
                const colorClass = expiryColor(days);
                return (
                  <div key={`l-${i}`} className={cn('flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border', colorClass || 'bg-[var(--dashboard-surface)] border-[var(--dashboard-stroke)]')}>
                    <span className="font-mono font-medium">Lot: {l.lot}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{l.count} adet</span>
                      {l.miad && <span>{l.miad}{days !== null && days <= 45 ? ` (${days}g)` : ''}</span>}
                    </div>
                  </div>
                );
              })}

              {/* Manual expiry warnings */}
              {entry.expiryWarnings.map(w => {
                const days = getRemainingDays(w.miad);
                const colorClass = expiryColor(days);
                const displayDate = w.miad.split('-').reverse().join('.');
                return (
                  <div key={w.id} className={cn('flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border', colorClass || 'bg-[var(--dashboard-surface)] border-[var(--dashboard-stroke)]')}>
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Miad: {displayDate}{days !== null ? ` (${days <= 0 ? 'geçmiş' : `${days} gün`})` : ''}</span>
                    </div>
                    <button onClick={() => onRemoveExpiryWarning(w.id)} className="text-[var(--dashboard-muted)] hover:text-red-500 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PANEL
// ============================================================================

export default function MaliyetSayimPanel({ hospitals, depots, productCodes }: MaliyetSayimPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUserProfile } = useAuth();
  const canSeeCost = ['admin', 'admin_developer', 'super_admin', 'teknik_lojistik'].includes(currentUserProfile?.role ?? '');

  // Location selection - initialize from URL params
  const [locationType, setLocationType] = useState<LocationType | null>(() => {
    const t = searchParams.get('type');
    return t === 'lab' || t === 'depot' ? t : null;
  });
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(() => searchParams.get('id'));

  // ---- COLLABORATIVE SESSION STATE ----
  const [preScreenTab, setPreScreenTab] = useState<'new' | 'invitations'>('new');
  const [showParticipantSelection, setShowParticipantSelection] = useState(false);
  const [locationUsers, setLocationUsers] = useState<{ uid: string; name: string; email: string; role: string }[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // Active session
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => searchParams.get('session'));
  const [activeSession, setActiveSession] = useState<MaliyetSayimOturum | null>(null);
  const [sessionMode, setSessionMode] = useState<'solo' | 'collaborative'>('solo');

  // Pending invitations
  const [pendingInvitations, setPendingInvitations] = useState<MaliyetSayimOturum[]>([]);

  // Presence tracking
  const presenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // MinMaxRules fetched from Firestore sub-collection
  const [locationMinMaxRules, setLocationMinMaxRules] = useState<MinMaxRule[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false);

  // Brand & product state
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [countData, setCountData] = useState<Record<string, ProductCountEntry>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyUncounted, setShowOnlyUncounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Barcode scanner
  const [scannerActive, setScannerActive] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const { formats: barcodeFormats } = useSafeBarcodeFormats();

  // Voice counting
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const recognitionRef = useRef<any>(null);
  const voiceProcessingRef = useRef(false);
  const activeBrandRef = useRef<string | null>(null);

  // Completion modal & saving
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  // ---- COLLABORATIVE SESSION SUBSCRIPTIONS ----

  // Subscribe to pending invitations for current user
  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    const unsub = subscribeToUserSessions(currentUserProfile.uid, (sessions) => {
      setPendingInvitations(sessions);

      // Auto-join if URL has ?session=xxx
      if (activeSessionId && !activeSession) {
        const target = sessions.find(s => s.id === activeSessionId);
        if (target) {
          const participant = target.participants.find(p => p.uid === currentUserProfile.uid);
          if (participant && participant.status === 'invited') {
            joinSession(activeSessionId, currentUserProfile.uid, currentUserProfile.name || '').catch(console.error);
          }
          setActiveSession(target);
          setSessionMode('collaborative');
          setLocationType(target.locationType);
          setSelectedLocationId(target.locationId);
        }
      }
    });
    return () => unsub();
  }, [currentUserProfile?.uid, activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to active session for real-time updates
  useEffect(() => {
    if (!activeSessionId || sessionMode !== 'collaborative') return;
    const unsub = subscribeToSession(activeSessionId, (session) => {
      if (session) {
        setActiveSession(session);
        // Merge remote count data into local state
        if (session.countData) {
          setCountData(prev => {
            const next = { ...prev };
            Object.entries(session.countData!).forEach(([stokKodu, remote]) => {
              if (!next[stokKodu]) {
                next[stokKodu] = {
                  stokKodu: remote.stokKodu,
                  stokAdi: remote.stokAdi,
                  marka: remote.marka,
                  stokAdedi: String(remote.stokAdedi),
                  cihazUstuAdedi: String(remote.cihazUstuAdedi),
                  counted: remote.counted,
                  lots: [],
                  serials: [],
                  expiryWarnings: [],
                };
              } else {
                // Only update if remote is newer (simple merge - last write wins)
                next[stokKodu] = {
                  ...next[stokKodu],
                  stokAdedi: String(remote.stokAdedi),
                  cihazUstuAdedi: String(remote.cihazUstuAdedi),
                  counted: remote.counted,
                };
              }
            });
            return next;
          });
        }
      }
    });
    return () => unsub();
  }, [activeSessionId, sessionMode]);

  // Presence update interval
  useEffect(() => {
    if (!activeSessionId || sessionMode !== 'collaborative' || !currentUserProfile?.uid) return;

    const myIdx = activeSession?.participants.findIndex(p => p.uid === currentUserProfile.uid) ?? 0;

    const doUpdate = () => {
      updatePresence(activeSessionId, currentUserProfile.uid, {
        activeBrand: activeBrand,
        activeProduct: null,
        name: currentUserProfile.name || '',
        color: getPresenceColor(myIdx),
      }).catch(console.error);
    };

    doUpdate();
    presenceIntervalRef.current = setInterval(doUpdate, 15000);

    return () => {
      if (presenceIntervalRef.current) clearInterval(presenceIntervalRef.current);
      removePresence(activeSessionId, currentUserProfile.uid).catch(console.error);
    };
  }, [activeSessionId, sessionMode, currentUserProfile?.uid, activeBrand]); // eslint-disable-line react-hooks/exhaustive-deps

  const scanFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeBrandRef.current = activeBrand;
  }, [activeBrand]);

  // Fetch minMaxRules from Firestore when location changes
  useEffect(() => {
    if (!selectedLocationId || !locationType) {
      setLocationMinMaxRules([]);
      return;
    }

    const collectionPath = locationType === 'lab'
      ? `hospitals/${selectedLocationId}/minMaxRules`
      : `depots/${selectedLocationId}/minMaxRules`;

    setIsLoadingRules(true);
    getDocs(collection(db, collectionPath))
      .then(snap => {
        setLocationMinMaxRules(snap.docs.map(d => d.data() as MinMaxRule));
      })
      .catch(err => {
        console.error('Error fetching minMaxRules:', err);
        setLocationMinMaxRules([]);
      })
      .finally(() => setIsLoadingRules(false));
  }, [selectedLocationId, locationType]);

  // ---- Derived data ----

  const locationName = useMemo(() => {
    if (!selectedLocationId || !locationType) return '';
    if (locationType === 'lab') {
      return hospitals.find(h => h.id === selectedLocationId)?.name ?? '';
    }
    return depots.find(d => d.id === selectedLocationId)?.name ?? '';
  }, [selectedLocationId, locationType, hospitals, depots]);

  const brands = useMemo(() => {
    if (!selectedLocationId || !locationType) return [];
    return getBrandsFromRules(locationMinMaxRules, productCodes);
  }, [selectedLocationId, locationType, locationMinMaxRules, productCodes]);

  const brandProducts = useMemo(() => {
    if (!activeBrand || !selectedLocationId || !locationType) return [];
    return getProductsForBrandFromRules(activeBrand, locationMinMaxRules, productCodes);
  }, [activeBrand, selectedLocationId, locationType, locationMinMaxRules, productCodes]);

  // Initialize count data when brand products change
  useEffect(() => {
    if (brandProducts.length === 0) return;
    setCountData(prev => {
      const next = { ...prev };
      brandProducts.forEach(p => {
        if (!next[p.stokKodu]) {
          next[p.stokKodu] = {
            stokKodu: p.stokKodu,
            stokAdi: p.stokAdi,
            marka: p.marka ?? '',
            stokAdedi: '',
            cihazUstuAdedi: '',
            counted: false,
            lots: [],
            serials: [],
            expiryWarnings: [],
          };
        }
      });
      return next;
    });
  }, [brandProducts]);

  // Brand progress
  const brandProgressList = useMemo((): BrandProgress[] => {
    return brands.map(brand => {
      const products = getProductsForBrandFromRules(brand, locationMinMaxRules, productCodes);
      const completed = products.filter(p => countData[p.stokKodu]?.counted).length;
      let status: BrandProgress['status'] = 'idle';
      if (completed > 0 && completed < products.length) status = 'in_progress';
      if (completed === products.length && products.length > 0) status = 'completed';
      const costs: CostByCurrency = { TRY: 0, EUR: 0, USD: 0 };
      products.forEach(p => {
        const { amount, currency } = calcProductCost(p, countData[p.stokKodu]);
        const key = (currency === 'EUR' || currency === 'USD') ? currency : 'TRY';
        costs[key] += amount;
      });
      return { brand, total: products.length, completed, status, costs };
    });
  }, [brands, countData, locationMinMaxRules, productCodes]);

  const totalBrands = brandProgressList.length;
  const completedBrands = brandProgressList.filter(b => b.status === 'completed').length;
  const totalProducts = brandProgressList.reduce((s, b) => s + b.total, 0);
  const totalCounted = brandProgressList.reduce((s, b) => s + b.completed, 0);
  const overallPct = totalProducts > 0 ? Math.round((totalCounted / totalProducts) * 100) : 0;
  const totalCosts: CostByCurrency = brandProgressList.reduce(
    (s, b) => ({ TRY: s.TRY + b.costs.TRY, EUR: s.EUR + b.costs.EUR, USD: s.USD + b.costs.USD }),
    { TRY: 0, EUR: 0, USD: 0 }
  );
  const totalCostStr = formatCosts(totalCosts);

  // Filtered products for display
  const filteredProducts = useMemo(() => {
    let list = brandProducts;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        p.stokAdi.toLowerCase().includes(q) ||
        p.stokKodu.toLowerCase().includes(q)
      );
    }
    if (showOnlyUncounted) {
      list = list.filter(p => !countData[p.stokKodu]?.counted);
    }
    // Sort: uncounted first, then counted
    return list.sort((a, b) => {
      const aCounted = countData[a.stokKodu]?.counted ? 1 : 0;
      const bCounted = countData[b.stokKodu]?.counted ? 1 : 0;
      return aCounted - bCounted;
    });
  }, [brandProducts, searchQuery, showOnlyUncounted, countData]);

  // ---- Handlers ----

  // Sync a field change to Firestore session (collaborative mode)
  const syncToSession = useCallback((stokKodu: string, field: string, value: string | number | boolean, entry: ProductCountEntry) => {
    if (sessionMode !== 'collaborative' || !activeSessionId || !currentUserProfile?.uid) return;
    updateSessionCountData(
      activeSessionId,
      stokKodu,
      field,
      value,
      { uid: currentUserProfile.uid, name: currentUserProfile.name || '' },
      {
        stokKodu: entry.stokKodu,
        stokAdi: entry.stokAdi,
        marka: entry.marka,
        stokAdedi: parseInt(entry.stokAdedi) || 0,
        cihazUstuAdedi: parseInt(entry.cihazUstuAdedi) || 0,
        counted: entry.counted,
      }
    ).catch(console.error);
  }, [sessionMode, activeSessionId, currentUserProfile]);

  const handleStokChange = useCallback((stokKodu: string, val: string) => {
    setCountData(prev => {
      const updated = { ...prev, [stokKodu]: { ...prev[stokKodu], stokAdedi: val } };
      syncToSession(stokKodu, 'stokAdedi', parseInt(val) || 0, updated[stokKodu]);
      return updated;
    });
  }, [syncToSession]);

  const handleCihazChange = useCallback((stokKodu: string, val: string) => {
    setCountData(prev => {
      const updated = { ...prev, [stokKodu]: { ...prev[stokKodu], cihazUstuAdedi: val } };
      syncToSession(stokKodu, 'cihazUstuAdedi', parseInt(val) || 0, updated[stokKodu]);
      return updated;
    });
  }, [syncToSession]);

  const handleMarkCounted = useCallback((stokKodu: string) => {
    setCountData(prev => {
      const newCounted = !prev[stokKodu]?.counted;
      const updated = { ...prev, [stokKodu]: { ...prev[stokKodu], counted: newCounted } };
      syncToSession(stokKodu, 'counted', newCounted, updated[stokKodu]);
      return updated;
    });
  }, [syncToSession]);

  const handleAddExpiryWarning = useCallback((stokKodu: string, miad: string) => {
    setCountData(prev => {
      const entry = prev[stokKodu];
      if (!entry) return prev;
      return {
        ...prev,
        [stokKodu]: {
          ...entry,
          expiryWarnings: [...entry.expiryWarnings, { id: crypto.randomUUID(), miad }],
        },
      };
    });
  }, []);

  const handleRemoveExpiryWarning = useCallback((stokKodu: string, warningId: string) => {
    setCountData(prev => {
      const entry = prev[stokKodu];
      if (!entry) return prev;
      return {
        ...prev,
        [stokKodu]: {
          ...entry,
          expiryWarnings: entry.expiryWarnings.filter(w => w.id !== warningId),
        },
      };
    });
  }, []);

  const handleCompleteBrand = useCallback(() => {
    // Mark all products of active brand as counted
    setCountData(prev => {
      const next = { ...prev };
      brandProducts.forEach(p => {
        if (next[p.stokKodu]) {
          next[p.stokKodu] = { ...next[p.stokKodu], counted: true };
        }
      });
      return next;
    });
  }, [brandProducts]);

  const handleNextBrand = useCallback(() => {
    const nextIncomplete = brandProgressList.find(b => b.status !== 'completed' && b.brand !== activeBrand);
    if (nextIncomplete) {
      setActiveBrand(nextIncomplete.brand);
    }
  }, [brandProgressList, activeBrand]);

  const saveSessionToFirestore = useCallback(async () => {
    if (!locationType || !selectedLocationId || isSaving) return;
    setIsSaving(true);
    try {
      const entries = Object.values(countData) as ProductCountEntry[];
      const countedEntries = entries.filter(entry => entry.counted);

      if (sessionMode === 'collaborative' && activeSessionId && activeSession) {
        // Collaborative mode: use completeSession to save with attribution
        const finalItems = countedEntries.map(entry => {
          const sessionItem = activeSession.countData?.[entry.stokKodu];
          return {
            stokKodu: entry.stokKodu,
            stokAdi: entry.stokAdi,
            marka: entry.marka,
            stokAdedi: parseInt(entry.stokAdedi) || 0,
            cihazUstuAdedi: parseInt(entry.cihazUstuAdedi) || 0,
            countedByUid: sessionItem?.countedByUid || currentUserProfile?.uid || '',
            countedByName: sessionItem?.countedByName || currentUserProfile?.name || '',
            updates: sessionItem?.updates || [],
          };
        });

        await completeSession(activeSessionId, finalItems, {
          locationType,
          locationId: selectedLocationId,
          locationName,
          createdByUid: activeSession.createdByUid,
          createdByName: activeSession.createdByName,
          totalBrands,
          participants: activeSession.participants,
        });
      } else {
        // Solo mode: legacy save
        const items = countedEntries.map(entry => ({
          stokKodu: entry.stokKodu,
          stokAdi: entry.stokAdi,
          marka: entry.marka,
          stokAdedi: parseInt(entry.stokAdedi) || 0,
          cihazUstuAdedi: parseInt(entry.cihazUstuAdedi) || 0,
        }));

        await addDoc(collection(db, 'maliyetSayimSessions'), {
          locationType,
          locationId: selectedLocationId,
          locationName,
          createdAt: serverTimestamp(),
          createdByUid: currentUserProfile?.uid ?? '',
          createdByName: currentUserProfile?.name ?? '',
          items,
          totalBrands,
          totalProducts: items.length,
        });
      }

      toast({ title: 'Sayım kaydedildi', description: `${countedEntries.length} ürün ${locationName} için kaydedildi.` });
    } catch (err) {
      console.error('Error saving session:', err);
      toast({ title: 'Hata', description: 'Sayım kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [locationType, selectedLocationId, locationName, countData, currentUserProfile, totalBrands, isSaving, toast, sessionMode, activeSessionId, activeSession]);

  const flashFeedback = useCallback((type: 'success' | 'error', message: string) => {
    if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current);
    setScanFeedback({ type, message });
    scanFeedbackTimer.current = setTimeout(() => setScanFeedback(null), 2500);
  }, []);

  const handleScan = useCallback(({ raw }: { raw: string }) => {
    if (!raw.trim()) return;

    // Parse barcode with all formats
    const result = parseAndResolveBarcode(raw.trim(), barcodeFormats, productCodes);
    let found = result?.product;
    const parsed = result?.parsed;

    // Fallback: direct lookup
    if (!found) {
      found = productCodes.find(
        p => p.barcodeNumber === raw.trim() || p.stokKodu === raw.trim()
      );
    }

    if (!found) {
      flashFeedback('error', 'Ürün bulunamadı');
      return;
    }

    // Check if product is in current location
    const stokKoduSet = new Set(locationMinMaxRules.map(r => r.stokKodu));
    if (stokKoduSet.size > 0 && !stokKoduSet.has(found.stokKodu)) {
      flashFeedback('error', `${found.stokAdi} bu lokasyonda tanımlı değil`);
      return;
    }

    // Switch brand if needed
    if (found.marka && found.marka !== activeBrand) {
      setActiveBrand(found.marka);
    }

    const trackingMode = found.trackingMode || 'qty_barcode';
    const serial = parsed?.seriNumarasi;
    const lot = parsed?.lotNumarasi;
    const miad = parsed?.miadFormatted; // dd.MM.yyyy

    setCountData(prev => {
      const existing = prev[found!.stokKodu];
      const base: ProductCountEntry = {
        stokKodu: found!.stokKodu,
        stokAdi: found!.stokAdi,
        marka: found!.marka ?? '',
        stokAdedi: existing?.stokAdedi ?? '0',
        cihazUstuAdedi: existing?.cihazUstuAdedi ?? '',
        counted: existing?.counted ?? false,
        lots: existing?.lots ?? [],
        serials: existing?.serials ?? [],
        expiryWarnings: existing?.expiryWarnings ?? [],
      };

      const currentStok = parseInt(base.stokAdedi, 10) || 0;

      if (trackingMode === 'serial' && serial) {
        // Duplicate serial check
        if (base.serials.some(s => s.serial === serial)) {
          flashFeedback('error', `Mükerrer seri no: ${serial}`);
          return prev;
        }
        base.serials = [...base.serials, { serial, lot, miad }];
        base.stokAdedi = String(currentStok + 1);
      } else if ((trackingMode === 'lot_barcode' || trackingMode === 'lot_manual') && lot) {
        // Add to existing lot or create new
        const existingLot = base.lots.find(l => l.lot === lot);
        if (existingLot) {
          base.lots = base.lots.map(l => l.lot === lot ? { ...l, count: l.count + 1, miad: miad || l.miad } : l);
        } else {
          base.lots = [...base.lots, { lot, miad, count: 1 }];
        }
        base.stokAdedi = String(currentStok + 1);
      } else {
        // qty tracking - just increment
        base.stokAdedi = String(currentStok + 1);
      }

      return { ...prev, [found!.stokKodu]: base };
    });

    const feedbackParts = [found.stokAdi, '+1'];
    if (serial) feedbackParts.push(`SN:${serial}`);
    else if (lot) feedbackParts.push(`Lot:${lot}`);
    flashFeedback('success', feedbackParts.join(' '));
  }, [barcodeFormats, productCodes, locationMinMaxRules, activeBrand, flashFeedback]);

  // HID barcode scanner listener
  useHidScanner({
    enabled: scannerActive && !!selectedLocationId,
    allowDuringInputs: false,
    onScan: handleScan,
  });

  // ---- Voice counting: parse transcript via Gemini ----
  const processVoiceTranscript = useCallback(async (transcript: string) => {
    if (!transcript.trim() || voiceProcessingRef.current) return;
    voiceProcessingRef.current = true;
    setVoiceProcessing(true);

    try {
      // Build product list from ALL brands (not just active)
      const allStokKoduSet = new Set(locationMinMaxRules.map(r => r.stokKodu));
      const allProducts = productCodes
        .filter(p => allStokKoduSet.has(p.stokKodu))
        .map(p => ({ stokKodu: p.stokKodu, stokAdi: p.stokAdi }));

      if (allProducts.length === 0) {
        flashFeedback('error', 'Ürün listesi boş');
        return;
      }

      const res = await fetch('/api/ai/voice-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, products: allProducts, brands }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Hata' }));
        flashFeedback('error', err.error || 'Ses tanıma hatası');
        return;
      }

      const data = await res.json();
      const actions: { type: VoiceAssistantActionType; brand?: string }[] = data.actions || [];
      const commands: { stokKodu: string; stokAdedi?: number; cihazUstuAdedi?: number }[] = data.commands || [];

      if (commands.length === 0 && actions.length === 0) {
        flashFeedback('error', `Ürün eşleşemedi: "${transcript}"`);
        return;
      }

      const feedbackParts: string[] = [];

      // Apply assistant actions
      let shouldOpenFinishModal = false;
      let effectiveBrand = activeBrandRef.current;
      const brandsToComplete = new Set<string>();

      for (const commandAction of actions) {
        if (commandAction.type === 'complete_count') {
          shouldOpenFinishModal = true;
          feedbackParts.push('Sayım tamamlama ekranı açıldı');
        } else if (commandAction.type === 'complete_brand') {
          if (effectiveBrand) {
            brandsToComplete.add(effectiveBrand);
            feedbackParts.push(`${effectiveBrand} marka sayımı tamamlandı`);
          } else {
            feedbackParts.push('Aktif marka bulunamadı');
          }
        } else if (commandAction.type === 'next_brand') {
          const nextIncomplete = brandProgressList.find(b => b.status !== 'completed' && b.brand !== effectiveBrand)
            ?? brandProgressList.find(b => b.status !== 'completed');
          if (nextIncomplete) {
            effectiveBrand = nextIncomplete.brand;
            feedbackParts.push(`${nextIncomplete.brand} markasına geçildi`);
          } else {
            feedbackParts.push('Geçilecek tamamlanmamış marka yok');
          }
        } else if (commandAction.type === 'go_to_brand' && commandAction.brand) {
          const target = brands.find(brand => {
            const normalizedBrand = normalizeText(brand);
            const normalizedTarget = normalizeText(commandAction.brand ?? '');
            return normalizedBrand === normalizedTarget ||
              normalizedBrand.includes(normalizedTarget) ||
              normalizedTarget.includes(normalizedBrand);
          });
          if (target) {
            effectiveBrand = target;
            feedbackParts.push(`${target} markasına geçildi`);
          } else {
            feedbackParts.push(`Marka bulunamadı: ${commandAction.brand}`);
          }
        }
      }

      if (brandsToComplete.size > 0) {
        setCountData(prev => {
          const next = { ...prev };
          brandsToComplete.forEach(brand => {
            const products = getProductsForBrandFromRules(brand, locationMinMaxRules, productCodes);
            products.forEach(p => {
              const existing = next[p.stokKodu];
              if (!existing) return;
              next[p.stokKodu] = { ...existing, counted: true };
            });
          });
          return next;
        });
      }

      if (shouldOpenFinishModal) {
        setShowFinishModal(true);
      }

      // Apply product commands to countData
      setCountData(prev => {
        const next = { ...prev };
        for (const cmd of commands) {
          const product = productCodes.find(p => p.stokKodu === cmd.stokKodu);
          if (!product) continue;

          // Switch to correct brand if needed
          if (product.marka && product.marka !== effectiveBrand) {
            effectiveBrand = product.marka;
          }

          const existing = next[cmd.stokKodu];
          const base: ProductCountEntry = {
            stokKodu: cmd.stokKodu,
            stokAdi: product.stokAdi,
            marka: product.marka ?? '',
            stokAdedi: existing?.stokAdedi ?? '',
            cihazUstuAdedi: existing?.cihazUstuAdedi ?? '',
            counted: existing?.counted ?? false,
            lots: existing?.lots ?? [],
            serials: existing?.serials ?? [],
            expiryWarnings: existing?.expiryWarnings ?? [],
          };

          if (cmd.stokAdedi !== undefined) {
            base.stokAdedi = String(cmd.stokAdedi);
          }
          if (cmd.cihazUstuAdedi !== undefined) {
            base.cihazUstuAdedi = String(cmd.cihazUstuAdedi);
          }

          next[cmd.stokKodu] = base;

          const parts = [product.stokAdi.substring(0, 25)];
          if (cmd.stokAdedi !== undefined) parts.push(`S:${cmd.stokAdedi}`);
          if (cmd.cihazUstuAdedi !== undefined) parts.push(`C:${cmd.cihazUstuAdedi}`);
          feedbackParts.push(parts.join(' '));
        }
        return next;
      });

      if (effectiveBrand && effectiveBrand !== activeBrandRef.current) {
        setActiveBrand(effectiveBrand);
      }

      if (feedbackParts.length > 0) {
        flashFeedback('success', feedbackParts.join(' | '));
      }
    } catch (err) {
      flashFeedback('error', 'Ses işleme hatası');
    } finally {
      voiceProcessingRef.current = false;
      setVoiceProcessing(false);
    }
  }, [locationMinMaxRules, productCodes, activeBrand, flashFeedback, brands, brandProgressList]);

  // ---- Voice counting: SpeechRecognition lifecycle ----
  const toggleVoice = useCallback(() => {
    if (voiceActive) {
      // Stop - clear ref BEFORE stop() so onend doesn't auto-restart
      const ref = recognitionRef.current;
      recognitionRef.current = null;
      ref?.stop();
      setVoiceActive(false);
      setVoiceTranscript('');
      return;
    }

    // Start
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      flashFeedback('error', 'Tarayıcınız ses tanımayı desteklemiyor');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      // Show interim text for visual feedback
      if (interimTranscript) {
        setVoiceTranscript(interimTranscript);
      }

      // Process final transcript immediately
      if (finalTranscript.trim()) {
        setVoiceTranscript('');
        processVoiceTranscript(finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        flashFeedback('error', `Mikrofon hatası: ${event.error}`);
      }
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be active
      if (recognitionRef.current === recognition) {
        try {
          recognition.start();
        } catch {
          setVoiceActive(false);
          setVoiceTranscript('');
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setVoiceActive(true);
  }, [voiceActive, processVoiceTranscript, flashFeedback]);

  // Cleanup voice recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        const ref = recognitionRef.current;
        recognitionRef.current = null;
        ref.stop();
      }
    };
  }, []);

  const handleSelectLocation = useCallback(async (type: LocationType, id: string) => {
    setLocationType(type);
    setSelectedLocationId(id);
    setActiveBrand(null);
    setCountData({});
    setSearchQuery('');
    // Stop voice if active
    if (recognitionRef.current) {
      const ref = recognitionRef.current;
      recognitionRef.current = null;
      ref.stop();
    }
    setVoiceActive(false);
    setVoiceTranscript('');

    // Show participant selection step
    setShowParticipantSelection(true);
    setIsLoadingUsers(true);
    try {
      const users = await getUsersForLocation(type, id);
      // Exclude current user from the list
      setLocationUsers(users.filter(u => u.uid !== currentUserProfile?.uid));
    } catch (err) {
      console.error('Error fetching users:', err);
      setLocationUsers([]);
    } finally {
      setIsLoadingUsers(false);
    }
  }, [currentUserProfile?.uid]);

  const handleStartSolo = useCallback(() => {
    setShowParticipantSelection(false);
    setSessionMode('solo');
    router.replace(`/maliyet-sayim?type=${locationType}&id=${selectedLocationId}`, { scroll: false });
  }, [router, locationType, selectedLocationId]);

  const handleStartCollaborative = useCallback(async () => {
    if (!locationType || !selectedLocationId || !currentUserProfile?.uid) return;
    setIsCreatingSession(true);
    try {
      const locationName = locationType === 'lab'
        ? hospitals.find(h => h.id === selectedLocationId)?.name ?? ''
        : depots.find(d => d.id === selectedLocationId)?.name ?? '';

      const invitedUsers = locationUsers
        .filter(u => selectedParticipants.has(u.uid))
        .map(u => ({ uid: u.uid, name: u.name }));

      const sessionId = await createSession({
        locationType,
        locationId: selectedLocationId,
        locationName,
        creatorUid: currentUserProfile.uid,
        creatorName: currentUserProfile.name || '',
        invitedUsers,
      });

      // Send notifications to invited users
      if (invitedUsers.length > 0) {
        await emitMaliyetSayimInvitation({
          actor: { uid: currentUserProfile.uid, name: currentUserProfile.name || '' },
          sessionId,
          locationName,
          invitedUserUids: invitedUsers.map(u => u.uid),
        });
      }

      setActiveSessionId(sessionId);
      setSessionMode('collaborative');
      setShowParticipantSelection(false);
      router.replace(`/maliyet-sayim?type=${locationType}&id=${selectedLocationId}&session=${sessionId}`, { scroll: false });

      toast({ title: 'Oturum oluşturuldu', description: `${invitedUsers.length} kişiye davet gönderildi.` });
    } catch (err) {
      console.error('Error creating session:', err);
      toast({ title: 'Hata', description: 'Oturum oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsCreatingSession(false);
    }
  }, [locationType, selectedLocationId, currentUserProfile, locationUsers, selectedParticipants, hospitals, depots, router, toast]);

  const handleJoinInvitation = useCallback(async (session: MaliyetSayimOturum) => {
    if (!currentUserProfile?.uid) return;
    try {
      await joinSession(session.id, currentUserProfile.uid, currentUserProfile.name || '');
      setActiveSessionId(session.id);
      setSessionMode('collaborative');
      setLocationType(session.locationType);
      setSelectedLocationId(session.locationId);
      router.replace(`/maliyet-sayim?type=${session.locationType}&id=${session.locationId}&session=${session.id}`, { scroll: false });
      toast({ title: 'Oturuma katıldınız', description: session.locationName });
    } catch (err) {
      toast({ title: 'Hata', description: 'Oturuma katılınamadı.', variant: 'destructive' });
    }
  }, [currentUserProfile, router, toast]);

  const handleDeclineInvitation = useCallback(async (session: MaliyetSayimOturum) => {
    if (!currentUserProfile?.uid) return;
    try {
      await declineSession(session.id, currentUserProfile.uid);
      toast({ title: 'Davet reddedildi' });
    } catch (err) {
      toast({ title: 'Hata', variant: 'destructive' });
    }
  }, [currentUserProfile, toast]);

  // Auto-select first incomplete brand when brands load
  useEffect(() => {
    if (brands.length > 0 && !activeBrand) {
      setActiveBrand(brands[0]);
    }
  }, [brands, activeBrand]);

  // ---- RENDER: Participant Selection (after location is chosen) ----
  if (showParticipantSelection && locationType && selectedLocationId) {
    const selectedLocName = locationType === 'lab'
      ? hospitals.find(h => h.id === selectedLocationId)?.name ?? ''
      : depots.find(d => d.id === selectedLocationId)?.name ?? '';

    return (
      <div className="cihaz-shell min-h-screen">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-24">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={() => { setShowParticipantSelection(false); setSelectedLocationId(null); setLocationType(null); }}
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors shrink-0"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-[var(--dashboard-text)]">Katılımcı Seçimi</h1>
              <p className="text-xs text-[var(--dashboard-muted)]">{selectedLocName} — Sayıma davet edeceğiniz kişileri seçin</p>
            </div>
          </div>

          {/* User list */}
          <div className="cihaz-card-strong rounded-2xl overflow-hidden mb-4">
            <div className="px-5 py-3 border-b border-[var(--dashboard-stroke)] flex items-center gap-2">
              <Users className="w-4 h-4 text-[var(--dashboard-accent)]" />
              <span className="text-xs font-semibold text-[var(--dashboard-text)]">Lokasyona Tanımlı Kullanıcılar</span>
              {selectedParticipants.size > 0 && (
                <span className="ml-auto text-[11px] font-medium text-[var(--dashboard-accent)]">
                  {selectedParticipants.size} seçili
                </span>
              )}
            </div>

            {isLoadingUsers ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--dashboard-accent)]" />
              </div>
            ) : locationUsers.length === 0 ? (
              <div className="text-center py-12 text-xs text-[var(--dashboard-muted)]">
                Bu lokasyona tanımlı başka kullanıcı bulunamadı.
              </div>
            ) : (
              <ScrollArea className="max-h-[400px]">
                <div className="divide-y divide-[var(--dashboard-stroke)]">
                  {locationUsers.map(user => {
                    const isSelected = selectedParticipants.has(user.uid);
                    const isAdmin = ['admin', 'admin_developer', 'super_admin'].includes(user.role);
                    return (
                      <button
                        key={user.uid}
                        onClick={() => {
                          setSelectedParticipants(prev => {
                            const next = new Set(prev);
                            if (next.has(user.uid)) next.delete(user.uid);
                            else next.add(user.uid);
                            return next;
                          });
                        }}
                        className={cn(
                          'w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors',
                          isSelected ? 'bg-[var(--dashboard-accent)]/5' : 'hover:bg-[var(--dashboard-surface-2)]/50'
                        )}
                      >
                        <span className={cn(
                          'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors',
                          isSelected
                            ? 'border-[var(--dashboard-accent)] bg-[var(--dashboard-accent)]'
                            : 'border-[var(--dashboard-muted)]/30'
                        )}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--dashboard-text)]">{user.name}</span>
                            {isAdmin && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                                <ShieldCheck className="w-2.5 h-2.5" />
                                Admin
                              </span>
                            )}
                          </div>
                          {user.email && (
                            <p className="text-[11px] text-[var(--dashboard-muted)] truncate">{user.email}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleStartSolo}
              className="flex-1 h-11 rounded-xl text-sm font-semibold bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
            >
              Solo Sayım
            </button>
            <button
              onClick={handleStartCollaborative}
              disabled={selectedParticipants.size === 0 || isCreatingSession}
              className={cn(
                'flex-1 h-11 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2',
                selectedParticipants.size > 0
                  ? 'bg-[var(--dashboard-accent)] text-white shadow-md hover:opacity-90'
                  : 'bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] cursor-not-allowed opacity-50'
              )}
            >
              {isCreatingSession ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Oturum Oluştur & Başla
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- RENDER: Location Selection (with tabs for invitations) ----
  if (!locationType || !selectedLocationId) {
    const myPendingInvitations = pendingInvitations.filter(s =>
      s.participants.some(p => p.uid === currentUserProfile?.uid && (p.status === 'invited' || p.status === 'joined'))
    );

    return (
      <div className="cihaz-shell min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-24">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6 px-1">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <ClipboardCheck className="h-5 w-5 text-[var(--dashboard-accent)]" />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)]">Maliyet Sayım</h1>
              <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">Yeni sayım başlatın veya davetleri görüntüleyin</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setPreScreenTab('new')}
              className={cn(
                'flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200',
                preScreenTab === 'new'
                  ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                  : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
              )}
            >
              Yeni Sayım
            </button>
            <button
              onClick={() => setPreScreenTab('invitations')}
              className={cn(
                'flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 relative',
                preScreenTab === 'invitations'
                  ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                  : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
              )}
            >
              <Bell className="w-4 h-4 inline mr-1.5" />
              Bekleyen Davetler
              {myPendingInvitations.filter(s => s.participants.some(p => p.uid === currentUserProfile?.uid && p.status === 'invited')).length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {myPendingInvitations.filter(s => s.participants.some(p => p.uid === currentUserProfile?.uid && p.status === 'invited')).length}
                </span>
              )}
            </button>
          </div>

          {preScreenTab === 'new' ? (
            <>
              {/* Location type selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                <button
                  onClick={() => setLocationType('lab')}
                  className={cn(
                    'cihaz-action-tile cihaz-focus-ring flex flex-col items-center justify-center gap-3 p-6 sm:p-8 min-h-[160px]',
                    locationType === 'lab' && 'ring-2 ring-[var(--dashboard-accent)]'
                  )}
                >
                  <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
                    <TestTube className="h-7 w-7 text-[var(--dashboard-accent)]" />
                  </span>
                  <span className="text-base font-semibold text-[var(--dashboard-text)]">Laboratuvar</span>
                  <span className="text-xs text-[var(--dashboard-muted)]">{hospitals.length} laboratuvar</span>
                </button>

                <button
                  onClick={() => setLocationType('depot')}
                  className={cn(
                    'cihaz-action-tile cihaz-focus-ring flex flex-col items-center justify-center gap-3 p-6 sm:p-8 min-h-[160px]',
                    locationType === 'depot' && 'ring-2 ring-[var(--dashboard-accent)]'
                  )}
                >
                  <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
                    <Building2 className="h-7 w-7 text-[var(--dashboard-accent)]" />
                  </span>
                  <span className="text-base font-semibold text-[var(--dashboard-text)]">Depo</span>
                  <span className="text-xs text-[var(--dashboard-muted)]">{depots.length} depo</span>
                </button>
              </div>

              {/* Location list */}
              {locationType && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--dashboard-muted)] uppercase tracking-wider px-1 mb-3">
                    {locationType === 'lab' ? 'Laboratuvar Seçin' : 'Depo Seçin'}
                  </p>
                  {(locationType === 'lab' ? hospitals : depots).map(loc => (
                    <button
                      key={loc.id}
                      onClick={() => handleSelectLocation(locationType, loc.id)}
                      className="cihaz-tool-item cihaz-focus-ring flex items-center gap-3 px-4 py-3.5 w-full text-left"
                    >
                      <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] shrink-0">
                        {locationType === 'lab' ? (
                          <TestTube className="h-4 w-4 text-[var(--dashboard-accent)]" />
                        ) : (
                          <Building2 className="h-4 w-4 text-[var(--dashboard-accent)]" />
                        )}
                      </span>
                      <span className="text-sm font-medium text-[var(--dashboard-text)] flex-1">{loc.name}</span>
                      <ChevronRight className="h-4 w-4 text-[var(--dashboard-muted)] shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* ---- Pending Invitations Tab ---- */
            <div className="space-y-3">
              {myPendingInvitations.length === 0 ? (
                <div className="cihaz-card-strong rounded-2xl p-12 text-center">
                  <Bell className="w-10 h-10 text-[var(--dashboard-muted)] mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Bekleyen Davet Yok</p>
                  <p className="text-xs text-[var(--dashboard-muted)]">Sayıma davet edildiğinizde burada görünür.</p>
                </div>
              ) : (
                myPendingInvitations.map(session => {
                  const myParticipant = session.participants.find(p => p.uid === currentUserProfile?.uid);
                  const isInvited = myParticipant?.status === 'invited';
                  const isJoined = myParticipant?.status === 'joined';
                  const joinedCount = session.participants.filter(p => p.status === 'joined').length;
                  const createdAt = session.createdAt?.toDate ? session.createdAt.toDate() : (session.createdAt?.seconds ? new Date(session.createdAt.seconds * 1000) : null);

                  return (
                    <div key={session.id} className="cihaz-card-strong rounded-2xl p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider',
                              session.locationType === 'lab'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            )}>
                              {session.locationType === 'lab' ? 'Lab' : 'Depo'}
                            </span>
                            <span className="text-sm font-semibold text-[var(--dashboard-text)]">{session.locationName}</span>
                            {isInvited && (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                Davet
                              </span>
                            )}
                            {isJoined && (
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                Katıldınız
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--dashboard-muted)]">
                            <span>Oluşturan: {session.createdByName}</span>
                            <span>{joinedCount}/{session.participants.length} katılımcı</span>
                            {createdAt && <span>{format(createdAt, 'dd MMM HH:mm', { locale: tr })}</span>}
                          </div>

                          {/* Participant avatars */}
                          <div className="flex items-center gap-1 mt-2">
                            {session.participants.map((p, i) => (
                              <span
                                key={p.uid}
                                title={`${p.name} (${p.status === 'joined' ? 'katıldı' : p.status === 'invited' ? 'davet edildi' : 'reddetti'})`}
                                className={cn(
                                  'w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white',
                                  p.status === 'declined' && 'opacity-30'
                                )}
                                style={{ backgroundColor: getPresenceColor(i) }}
                              >
                                {p.name.charAt(0).toUpperCase()}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-2 shrink-0">
                          {isInvited && (
                            <>
                              <button
                                onClick={() => handleJoinInvitation(session)}
                                className="h-9 px-4 rounded-xl text-xs font-semibold bg-[var(--dashboard-accent)] text-white shadow-md hover:opacity-90 transition-all"
                              >
                                Katıl
                              </button>
                              <button
                                onClick={() => handleDeclineInvitation(session)}
                                className="h-9 px-4 rounded-xl text-xs font-semibold bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-red-500 transition-colors"
                              >
                                Reddet
                              </button>
                            </>
                          )}
                          {isJoined && (
                            <button
                              onClick={() => handleJoinInvitation(session)}
                              className="h-9 px-4 rounded-xl text-xs font-semibold bg-[var(--dashboard-accent)] text-white shadow-md hover:opacity-90 transition-all"
                            >
                              Devam Et
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- RENDER: Loading minMaxRules ----
  if (isLoadingRules) {
    return (
      <div className="flex h-full w-full items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
      </div>
    );
  }

  // ---- RENDER: Main Counting Interface ----

  const activeBrandProgress = brandProgressList.find(b => b.brand === activeBrand);
  const activeBrandPct = activeBrandProgress && activeBrandProgress.total > 0
    ? Math.round((activeBrandProgress.completed / activeBrandProgress.total) * 100)
    : 0;

  return (
    <div className="cihaz-shell min-h-screen flex flex-col">
      {/* ===== TOP STATUS BAR ===== */}
      <div className="sticky top-0 z-[var(--z-sticky)] bg-[var(--dashboard-bg)]/95 backdrop-blur-md border-b border-[var(--dashboard-stroke)]">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap">
          {/* Back button + Location */}
          <button
            onClick={() => { setSelectedLocationId(null); setLocationType(null); router.replace('/maliyet-sayim', { scroll: false }); }}
            className="shrink-0 flex items-center gap-2 text-sm text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Geri</span>
          </button>

          <div className="flex items-center gap-2">
            {locationType === 'lab' ? (
              <TestTube className="w-4 h-4 text-[var(--dashboard-accent)]" />
            ) : (
              <Building2 className="w-4 h-4 text-[var(--dashboard-accent)]" />
            )}
            <span className="text-sm font-semibold text-[var(--dashboard-text)]">{locationName}</span>

            <button
              onClick={() => setScannerActive(prev => !prev)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all duration-200',
                scannerActive
                  ? 'bg-emerald-500 text-white shadow-md animate-pulse'
                  : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
              )}
            >
              <ScanBarcode className="w-4 h-4" />
              {scannerActive ? 'Okuyucu Aktif' : 'Barkod'}
            </button>

            <button
              onClick={toggleVoice}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all duration-200',
                voiceActive
                  ? 'bg-red-500 text-white shadow-md animate-pulse'
                  : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
              )}
            >
              {voiceActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              {voiceActive ? 'Mikrofon Aktif' : 'Sesli Sayım'}
            </button>

            {/* Voice transcript live preview */}
            {voiceActive && voiceTranscript && (
              <span className="text-xs font-medium px-2 py-1 rounded-lg bg-blue-500/10 text-blue-600 animate-in fade-in max-w-[200px] truncate">
                {voiceTranscript}...
              </span>
            )}

            {/* Voice processing indicator */}
            {voiceProcessing && (
              <span className="text-xs font-medium px-2 py-1 rounded-lg bg-purple-500/10 text-purple-600 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                İşleniyor
              </span>
            )}

            {scanFeedback && (
              <span className={cn(
                'text-xs font-medium px-2 py-1 rounded-lg animate-in fade-in slide-in-from-left-2',
                scanFeedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'
              )}>
                {scanFeedback.message}
              </span>
            )}
          </div>

          {/* Progress summary */}
          <div className="flex items-center gap-4 ml-auto text-xs text-[var(--dashboard-muted)]">
            <span>{completedBrands} / {totalBrands} marka</span>
            <span>{totalCounted} / {totalProducts} ürün</span>
            {canSeeCost && totalCostStr && (
              <span className="font-semibold text-emerald-600">{totalCostStr}</span>
            )}
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

          {/* Finish button */}
          {completedBrands === totalBrands && totalBrands > 0 && (
            <Button
              size="sm"
              onClick={() => setShowFinishModal(true)}
              className="ml-2"
            >
              Sayımı Bitir
            </Button>
          )}
        </div>
      </div>

      {/* ===== COLLABORATIVE PARTICIPANT BAR ===== */}
      {sessionMode === 'collaborative' && activeSession && (
        <div className="px-4 sm:px-6 py-2 border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]/50">
          <div className="flex items-center gap-3 flex-wrap">
            <Users className="w-4 h-4 text-[var(--dashboard-accent)] shrink-0" />
            {activeSession.participants.filter(p => p.status === 'joined').map((p, i) => {
              const presence = activeSession.presence?.[p.uid];
              const isOnline = presence && presence.lastSeen &&
                (Date.now() - (typeof presence.lastSeen === 'object' && presence.lastSeen.seconds ? presence.lastSeen.seconds * 1000 : new Date(presence.lastSeen).getTime())) < 30000;
              return (
                <div key={p.uid} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--dashboard-surface-2)]/50" title={presence?.activeBrand ? `${p.name}: ${presence.activeBrand}` : p.name}>
                  <span className="relative">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                      style={{ backgroundColor: getPresenceColor(i) }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    {isOnline && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-[var(--dashboard-surface)]" />
                    )}
                  </span>
                  <span className="text-[11px] text-[var(--dashboard-text)] font-medium">{p.name.split(' ')[0]}</span>
                  {presence?.activeBrand && (
                    <span className="text-[9px] text-[var(--dashboard-muted)] bg-[var(--dashboard-surface-2)] px-1.5 py-0.5 rounded">
                      {presence.activeBrand}
                    </span>
                  )}
                </div>
              );
            })}
            {activeSession.participants.filter(p => p.status === 'invited').length > 0 && (
              <span className="text-[10px] text-[var(--dashboard-muted)]">
                +{activeSession.participants.filter(p => p.status === 'invited').length} davet bekliyor
              </span>
            )}
          </div>
        </div>
      )}

      {/* ===== MAIN CONTENT ===== */}
      <div className="flex-1 flex overflow-hidden">
        {/* ---- LEFT SIDEBAR: Brand Checklist ---- */}
        <aside
          className={cn(
            'shrink-0 border-r border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)] transition-all duration-300 flex flex-col',
            sidebarOpen ? 'w-[280px] sm:w-[320px]' : 'w-0 overflow-hidden'
          )}
        >
          {/* Sidebar header */}
          <div className="px-4 py-3 border-b border-[var(--dashboard-stroke)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">
                Markalar
              </span>
              <div className="flex gap-1 text-xs text-[var(--dashboard-muted)]">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  {completedBrands}
                </span>
                <span>/ {totalBrands}</span>
              </div>
            </div>

            {/* Mini counters */}
            <div className="grid grid-cols-3 gap-2">
              <div className="cihaz-pressed px-2 py-1.5 text-center">
                <div className="text-sm font-bold text-[var(--dashboard-text)]">{totalBrands}</div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Toplam</div>
              </div>
              <div className="cihaz-pressed px-2 py-1.5 text-center">
                <div className="text-sm font-bold text-emerald-500">{completedBrands}</div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Tamam</div>
              </div>
              <div className="cihaz-pressed px-2 py-1.5 text-center">
                <div className="text-sm font-bold text-amber-500">{totalBrands - completedBrands}</div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Bekleyen</div>
              </div>
            </div>
          </div>

          {/* Brand list */}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {brandProgressList.map(bp => (
                <BrandChecklistItem
                  key={bp.brand}
                  brand={bp}
                  isActive={bp.brand === activeBrand}
                  onClick={() => setActiveBrand(bp.brand)}
                  showCost={canSeeCost}
                />
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Sidebar toggle (mobile) */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="sm:hidden shrink-0 w-6 flex items-center justify-center border-r border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)] text-[var(--dashboard-muted)]"
        >
          {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* ---- RIGHT PANEL: Product Counting ---- */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {activeBrand ? (
            <>
              {/* Brand header card */}
              <div className="px-4 sm:px-6 py-4 border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)]">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-lg font-bold text-[var(--dashboard-text)]">{activeBrand}</h2>
                    <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">
                      {activeBrandProgress?.total ?? 0} ürün
                      {' · '}
                      <span className="text-emerald-500">{activeBrandProgress?.completed ?? 0} tamamlandı</span>
                      {' · '}
                      <span className="text-amber-500">{(activeBrandProgress?.total ?? 0) - (activeBrandProgress?.completed ?? 0)} bekliyor</span>
                    </p>
                  </div>

                  {/* Brand progress bar */}
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 rounded-full bg-[var(--dashboard-surface-2)] overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          activeBrandPct === 100 ? 'bg-emerald-500' : 'bg-[var(--dashboard-accent)]'
                        )}
                        style={{ width: `${activeBrandPct}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-[var(--dashboard-text)]">%{activeBrandPct}</span>
                  </div>
                </div>

                {/* Action row: search, filters */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[120px] max-w-[240px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dashboard-muted)]" />
                    <Input
                      type="text"
                      placeholder="Ürün ara..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9 text-sm"
                    />
                  </div>

                  {/* Filters */}
                  <Button
                    size="sm"
                    variant={showOnlyUncounted ? 'default' : 'outline'}
                    onClick={() => setShowOnlyUncounted(!showOnlyUncounted)}
                    className="h-9 text-xs"
                  >
                    Sadece Sayılmayanlar
                  </Button>

                  {/* Brand actions */}
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCompleteBrand}
                      className="h-9 text-xs"
                    >
                      <Check className="w-3.5 h-3.5 mr-1" />
                      Markayı Tamamla
                    </Button>
                  </div>
                </div>
              </div>

              {/* Product cards list */}
              <ScrollArea className="flex-1">
                <div className="p-4 sm:p-6 space-y-3">
                  {filteredProducts.length > 0 ? (
                    filteredProducts.map(product => (
                      <ProductCountCard
                        key={product.stokKodu}
                        product={product}
                        entry={countData[product.stokKodu] ?? {
                          stokKodu: product.stokKodu,
                          stokAdi: product.stokAdi,
                          marka: product.marka ?? '',
                          stokAdedi: '',
                          cihazUstuAdedi: '',
                          counted: false,
                          lots: [],
                          serials: [],
                          expiryWarnings: [],
                        }}
                        onStokChange={(val) => handleStokChange(product.stokKodu, val)}
                        onCihazChange={(val) => handleCihazChange(product.stokKodu, val)}
                        onMarkCounted={() => handleMarkCounted(product.stokKodu)}
                        onAddExpiryWarning={(miad) => handleAddExpiryWarning(product.stokKodu, miad)}
                        onRemoveExpiryWarning={(id) => handleRemoveExpiryWarning(product.stokKodu, id)}
                        showCost={canSeeCost}
                        countedByName={sessionMode === 'collaborative' ? activeSession?.countData?.[product.stokKodu]?.countedByName : undefined}
                        activeUsers={sessionMode === 'collaborative' && activeSession?.presence
                          ? Object.values(activeSession.presence)
                              .filter(p => p.activeProduct === product.stokKodu)
                              .map(p => ({ name: p.name, color: p.color }))
                          : undefined
                        }
                      />
                    ))
                  ) : (
                    <div className="text-center py-12 text-sm text-[var(--dashboard-muted)]">
                      {searchQuery ? 'Aramayla eşleşen ürün bulunamadı.' : 'Bu markaya ait ürün bulunamadı.'}
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* ===== BOTTOM STICKY ACTION BAR ===== */}
              <div className="sticky bottom-0 z-[var(--z-sticky)] border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)]/95 backdrop-blur-md px-4 sm:px-6 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-[var(--dashboard-muted)]">
                    <span className="font-medium text-[var(--dashboard-text)]">{activeBrandProgress?.completed ?? 0}</span> / {activeBrandProgress?.total ?? 0} ürün sayıldı
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={saveSessionToFirestore}
                      disabled={isSaving}
                      className="h-9 text-xs"
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                      Kaydet
                    </Button>

                    {activeBrandPct === 100 && (
                      <Button
                        size="sm"
                        onClick={handleNextBrand}
                        className="h-9 text-xs"
                      >
                        Sonraki Marka
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[var(--dashboard-muted)]">
              Sol panelden bir marka seçin
            </div>
          )}
        </main>
      </div>

      {/* ===== FINISH MODAL ===== */}
      <Dialog open={showFinishModal} onOpenChange={setShowFinishModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sayımı Tamamla</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="cihaz-card p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--dashboard-muted)]">Lokasyon</span>
                <span className="font-medium text-[var(--dashboard-text)]">{locationName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--dashboard-muted)]">Toplam Marka</span>
                <span className="font-medium text-[var(--dashboard-text)]">{totalBrands}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--dashboard-muted)]">Tamamlanan Marka</span>
                <span className="font-medium text-emerald-500">{completedBrands}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--dashboard-muted)]">Sayılan Ürün</span>
                <span className="font-medium text-[var(--dashboard-text)]">{totalCounted}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--dashboard-muted)]">Toplam Ürün</span>
                <span className="font-medium text-[var(--dashboard-text)]">{totalProducts}</span>
              </div>
            </div>

            {completedBrands < totalBrands && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Henüz tamamlanmamış {totalBrands - completedBrands} marka var. Yine de sayımı bitirmek istiyor musunuz?
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowFinishModal(false)}>
              Düzenlemeye Dön
            </Button>
            <Button
              onClick={async () => {
                await saveSessionToFirestore();
                setShowFinishModal(false);
              }}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
              Sayımı Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
