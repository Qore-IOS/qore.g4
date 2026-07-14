
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ProductCode, Currency, MinMaxRule } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, ArrowLeft, Calendar, User,
  ChevronDown, Search, X, Building2, TestTube,
  Tag, Users, History, Edit3, Save,
} from 'lucide-react';
import { format, isValid } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useProductCodes } from '@/hooks/useFirebaseQueries';
import { useAuth } from '@/contexts/auth-context';
import { matchesCompanyScope } from '@/lib/company-scope';
import { getExchangeRates } from '@/lib/exchange-rates';
import { useToast } from '@/hooks/use-toast';

// ============================================================================
// TYPES
// ============================================================================

interface CellUpdate {
  uid: string;
  name: string;
  field: string;
  value: string | number | boolean;
  timestamp: any;
}

interface SayimSessionItem {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  stokAdedi: number;
  cihazUstuAdedi: number;
}

interface DetailedSessionItem extends SayimSessionItem {
  counted: boolean;
  countedByUid?: string;
  countedByName?: string;
  updates: CellUpdate[];
}

interface SessionParticipantInfo {
  uid: string;
  name: string;
}

interface SayimSession {
  id: string;
  locationType: 'lab' | 'depot';
  locationId: string;
  locationName: string;
  createdAt: any;
  createdByUid?: string;
  createdByName?: string;
  items: SayimSessionItem[];
  itemsDetailed?: DetailedSessionItem[];
  participants?: SessionParticipantInfo[];
  sessionId?: string; // reference to maliyetSayimOturumlar
  totalBrands: number;
  totalProducts: number;
  updatedAt?: any;
  updatedByUid?: string;
  updatedByName?: string;
}

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  EUR: '\u20AC',
  USD: '$',
  TRY: '\u20BA',
};

const PARTICIPANT_COLORS = [
  '#F2994A', '#6FCF97', '#56CCF2', '#BB6BD9', '#F2C94C',
  '#EB5757', '#2F80ED', '#27AE60', '#9B51E0', '#2D9CDB',
];

async function fetchExchangeRates(): Promise<Record<Currency, number>> {
  return getExchangeRates();
}

function getSessionDate(session: SayimSession): Date | null {
  if (!session.createdAt) return null;
  if (session.createdAt.toDate) return session.createdAt.toDate();
  if (session.createdAt.seconds) return new Date(session.createdAt.seconds * 1000);
  const d = new Date(session.createdAt);
  return isValid(d) ? d : null;
}

function formatCurrency(value: number, symbol: string): string {
  return `${symbol}${value.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatCurrencyDetailed(value: number, symbol: string): string {
  return `${symbol}${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getParticipantColor(uid: string, participants: SessionParticipantInfo[]): string {
  const idx = participants.findIndex(p => p.uid === uid);
  return PARTICIPANT_COLORS[idx >= 0 ? idx % PARTICIPANT_COLORS.length : 0];
}


function toEditableNumber(value: number | string | undefined | null): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

function itemFromProduct(product: ProductCode, existing?: SayimSessionItem): SayimSessionItem {
  return {
    stokKodu: product.stokKodu,
    stokAdi: product.stokAdi || existing?.stokAdi || product.stokKodu,
    marka: product.marka || existing?.marka || '',
    stokAdedi: existing?.stokAdedi ?? 0,
    cihazUstuAdedi: existing?.cihazUstuAdedi ?? 0,
  };
}


// ============================================================================
// UPDATE LOG COMPONENT
// ============================================================================

function UpdateLog({ updates, participants }: { updates: CellUpdate[]; participants: SessionParticipantInfo[] }) {
  const [open, setOpen] = useState(false);

  if (!updates || updates.length === 0) return null;

  const fieldLabels: Record<string, string> = {
    stokAdedi: 'Stok',
    cihazUstuAdedi: 'Cihaz Ustu',
    counted: 'Sayildi',
  };

  return (
    <div className="mt-2 border-t border-[var(--dashboard-stroke)]/50 pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
      >
        <History className="w-3 h-3" />
        <span>{updates.length} degisiklik</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
          {[...updates].reverse().map((u, i) => {
            const color = getParticipantColor(u.uid, participants);
            const ts = u.timestamp ? (typeof u.timestamp === 'string' ? new Date(u.timestamp) : (u.timestamp.toDate ? u.timestamp.toDate() : new Date(u.timestamp.seconds * 1000))) : null;
            return (
              <div key={i} className="flex items-center gap-2 text-[10px] px-2 py-1 rounded-lg bg-[var(--dashboard-surface-2)]/50">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="font-medium text-[var(--dashboard-text)]">{u.name}</span>
                <span className="text-[var(--dashboard-muted)]">
                  {fieldLabels[u.field] || u.field}: {String(u.value)}
                </span>
                {ts && isValid(ts) && (
                  <span className="text-[var(--dashboard-muted)] ml-auto shrink-0">
                    {format(ts, 'HH:mm', { locale: tr })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function MaliyetSayimDetayPage() {
  const params = useParams();
  const sessionId = Array.isArray(params?.sessionId) ? params.sessionId[0] : params?.sessionId;
  const router = useRouter();
  const { data: productCodes } = useProductCodes();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();
  const isAdminRole = ['admin', 'admin_developer', 'super_admin'].includes(currentUserProfile?.role ?? '');
  const { toast } = useToast();

  const [session, setSession] = useState<SayimSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [rates, setRates] = useState<Record<Currency, number> | null>(null);
  const [currency, setCurrency] = useState<Currency>('TRY');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());
  const [showAttribution, setShowAttribution] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [isEditLoading, setIsEditLoading] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editableBaseItems, setEditableBaseItems] = useState<SayimSessionItem[]>([]);
  const [editValues, setEditValues] = useState<Record<string, { stokAdedi: string; cihazUstuAdedi: string }>>({});

  // Fetch session and rates
  useEffect(() => {
    if (!sessionId) return;
    const load = async () => {
      setLoading(true);
      try {
        const [sessionSnap, ratesData] = await Promise.all([
          getDoc(doc(db, 'maliyetSayimSessions', sessionId)),
          fetchExchangeRates(),
        ]);
        setRates(ratesData);
        if (sessionSnap.exists()) {
          const sessionData = { id: sessionSnap.id, ...sessionSnap.data() } as SayimSession;
          if (!matchesCompanyScope(sessionData as any, currentCompanyId, isSuperAdmin)) {
            router.push('/cost-dashboard/gecmis');
            return;
          }
          // Lab-scoped users cannot view sessions for labs they aren't
          // assigned to. Depot sessions remain accessible.
          const assignedLabs = currentUserProfile?.assignedLaboratories ?? [];
          if (
            !isSuperAdmin &&
            !isAdminRole &&
            assignedLabs.length > 0 &&
            sessionData.locationType === 'lab' &&
            !assignedLabs.includes(sessionData.locationId)
          ) {
            router.push('/cost-dashboard/gecmis');
            return;
          }
          setSession(sessionData);
        }
      } catch (err) {
        console.error('Error loading session:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sessionId, currentCompanyId, isSuperAdmin, isAdminRole, currentUserProfile?.assignedLaboratories]);

  // Product map for cost lookup
  const productMap = useMemo(() => {
    const map = new Map<string, ProductCode>();
    (productCodes || []).forEach(p => map.set(p.stokKodu, p));
    return map;
  }, [productCodes]);

  const loadEditableItems = useCallback(async (targetSession: SayimSession) => {
    setIsEditLoading(true);
    try {
      const baseCollection = targetSession.locationType === 'lab' ? 'hospitals' : 'depots';
      const rulesSnap = await getDocs(collection(db, `${baseCollection}/${targetSession.locationId}/minMaxRules`));
      const minMaxCodes = new Set(
        rulesSnap.docs
          .map(d => (d.data() as MinMaxRule).stokKodu)
          .filter(Boolean),
      );

      const existingByCode = new Map<string, SayimSessionItem>();
      (targetSession.items || []).forEach(item => existingByCode.set(item.stokKodu, item));
      (targetSession.itemsDetailed || []).forEach(item => existingByCode.set(item.stokKodu, item));

      const allCodes = new Set<string>([...minMaxCodes, ...existingByCode.keys()]);
      const rows = Array.from(allCodes)
        .map(code => {
          const product = productMap.get(code);
          const existing = existingByCode.get(code);
          if (product) return itemFromProduct(product, existing);
          return existing;
        })
        .filter((item): item is SayimSessionItem => !!item)
        .sort((a, b) => (a.marka || '').localeCompare(b.marka || '', 'tr') || a.stokAdi.localeCompare(b.stokAdi, 'tr'));

      setEditableBaseItems(rows);
      setEditValues(Object.fromEntries(rows.map(item => [
        item.stokKodu,
        {
          stokAdedi: toEditableNumber(item.stokAdedi),
          cihazUstuAdedi: toEditableNumber(item.cihazUstuAdedi),
        },
      ])));
    } catch (err) {
      console.error('Error loading editable count items:', err);
      toast({ title: 'Düzenleme verileri yüklenemedi', description: 'Lokasyon min-max ürünleri alınırken hata oluştu.', variant: 'destructive' });
    } finally {
      setIsEditLoading(false);
    }
  }, [productMap, toast]);

  const startEdit = useCallback(() => {
    if (!session) return;
    setEditMode(true);
    loadEditableItems(session);
  }, [session, loadEditableItems]);

  const cancelEdit = useCallback(() => {
    setEditMode(false);
    setEditableBaseItems([]);
    setEditValues({});
  }, []);

  const updateEditValue = useCallback((stokKodu: string, field: 'stokAdedi' | 'cihazUstuAdedi', value: string) => {
    const sanitized = value.replace(/[^0-9]/g, '');
    setEditValues(prev => ({
      ...prev,
      [stokKodu]: {
        stokAdedi: prev[stokKodu]?.stokAdedi ?? '',
        cihazUstuAdedi: prev[stokKodu]?.cihazUstuAdedi ?? '',
        [field]: sanitized,
      },
    }));
  }, []);

  const saveEdit = useCallback(async () => {
    if (!sessionId || !session || isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      const existingDetailed = new Map<string, DetailedSessionItem>();
      (session.itemsDetailed || []).forEach(item => existingDetailed.set(item.stokKodu, item));
      const editorUid = currentUserProfile?.uid || '';
      const editorName = currentUserProfile?.name || currentUserProfile?.email || 'Kullanıcı';
      const timestamp = new Date().toISOString();

      const items = editableBaseItems.map(base => {
        const values = editValues[base.stokKodu] || { stokAdedi: '', cihazUstuAdedi: '' };
        return {
          ...base,
          stokAdedi: parseInt(values.stokAdedi, 10) || 0,
          cihazUstuAdedi: parseInt(values.cihazUstuAdedi, 10) || 0,
        };
      });

      const itemsDetailed = items.map(item => {
        const previous = existingDetailed.get(item.stokKodu);
        const updates = [...(previous?.updates || [])];
        if ((previous?.stokAdedi ?? 0) !== item.stokAdedi) {
          updates.push({ uid: editorUid, name: editorName, field: 'stokAdedi', value: item.stokAdedi, timestamp });
        }
        if ((previous?.cihazUstuAdedi ?? 0) !== item.cihazUstuAdedi) {
          updates.push({ uid: editorUid, name: editorName, field: 'cihazUstuAdedi', value: item.cihazUstuAdedi, timestamp });
        }
        const hasCount = item.stokAdedi > 0 || item.cihazUstuAdedi > 0;
        return {
          ...item,
          counted: hasCount,
          countedByUid: hasCount ? (previous?.countedByUid || editorUid) : undefined,
          countedByName: hasCount ? (previous?.countedByName || editorName) : undefined,
          updates,
        };
      });

      const snapshotItems = items.map(item => {
        const product = productMap.get(item.stokKodu);
        return {
          ...item,
          cost: product?.cost ?? (session.items.find(i => i.stokKodu === item.stokKodu) as any)?.cost ?? 0,
          currency: product?.currency || (session.items.find(i => i.stokKodu === item.stokKodu) as any)?.currency || 'TRY',
          ambalajDegeri: Number(product?.ambalajDegeri) || 1,
        };
      });

      await updateDoc(doc(db, 'maliyetSayimSessions', sessionId), {
        items: snapshotItems,
        itemsDetailed: itemsDetailed.map(item => {
          const product = productMap.get(item.stokKodu);
          return {
            ...item,
            cost: product?.cost ?? (session.items.find(i => i.stokKodu === item.stokKodu) as any)?.cost ?? 0,
            currency: product?.currency || (session.items.find(i => i.stokKodu === item.stokKodu) as any)?.currency || 'TRY',
            ambalajDegeri: Number(product?.ambalajDegeri) || 1,
          };
        }),
        totalBrands: new Set(items.map(i => i.marka).filter(Boolean)).size,
        totalProducts: items.length,
        updatedAt: serverTimestamp(),
        updatedByUid: editorUid,
        updatedByName: editorName,
      });

      setSession(prev => prev ? {
        ...prev,
        items: snapshotItems,
        itemsDetailed,
        totalBrands: new Set(items.map(i => i.marka).filter(Boolean)).size,
        totalProducts: items.length,
      } : prev);
      setEditMode(false);
      toast({ title: 'Sayım güncellendi', description: 'Maliyet gözlem hesapları güncel sayım değerleriyle yeniden hesaplanacak.' });
    } catch (err) {
      console.error('Error updating count session:', err);
      toast({ title: 'Kayıt hatası', description: 'Sayım güncellenirken bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsSavingEdit(false);
    }
  }, [sessionId, session, isSavingEdit, currentUserProfile, editableBaseItems, editValues, productMap, toast]);

  // Calculate cost for a product
  const getProductCost = useCallback((stokKodu: string, quantity: number, cihazUstu: number) => {
    if (!rates) return 0;
    const product = productMap.get(stokKodu);
    if (!product?.cost) return 0;
    const ambalajDegeri = Number(product.ambalajDegeri) > 0 ? Number(product.ambalajDegeri) : 1;

    const totalTest = (quantity * ambalajDegeri) + cihazUstu;
    const costPerTest = product.cost / ambalajDegeri;
    const totalCostNative = costPerTest * totalTest;
    const productCurrency = (product.currency || 'TRY') as Currency;

    let costEUR: number;
    switch (productCurrency) {
      case 'EUR': costEUR = totalCostNative; break;
      case 'USD': costEUR = totalCostNative / (rates.USD || 1); break;
      case 'TRY': costEUR = totalCostNative / (rates.TRY || 1); break;
      default: costEUR = totalCostNative / (rates.TRY || 1);
    }

    return costEUR * (rates[currency] || 1);
  }, [rates, productMap, currency]);

  // Use detailed items if available, otherwise fall back to basic items
  const hasDetailedItems = !!session?.itemsDetailed && session.itemsDetailed.length > 0;
  const displayItems: (SayimSessionItem & { countedByUid?: string; countedByName?: string; updates?: CellUpdate[] })[] = useMemo(() => {
    if (!session) return [];
    if (editMode && editableBaseItems.length > 0) {
      return editableBaseItems.map(item => ({
        ...item,
        stokAdedi: parseInt(editValues[item.stokKodu]?.stokAdedi || '', 10) || 0,
        cihazUstuAdedi: parseInt(editValues[item.stokKodu]?.cihazUstuAdedi || '', 10) || 0,
      }));
    }
    if (hasDetailedItems) return session.itemsDetailed!;
    return session.items;
  }, [session, editMode, editableBaseItems, editValues, hasDetailedItems]);

  const sessionParticipants = session?.participants || [];
  const isMultiUser = sessionParticipants.length > 1;

  // Group items by brand
  const brandGroups = useMemo(() => {
    const map = new Map<string, { brand: string; items: typeof displayItems; totalCost: number }>();

    displayItems.forEach(item => {
      const brand = item.marka || 'Diger';
      if (!map.has(brand)) map.set(brand, { brand, items: [], totalCost: 0 });
      const group = map.get(brand)!;
      group.items.push(item);
      group.totalCost += getProductCost(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi);
    });

    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
  }, [displayItems, getProductCost]);

  // Filtered brand groups
  const filteredBrandGroups = useMemo(() => {
    if (!searchQuery) return brandGroups;
    const q = searchQuery.toLowerCase();
    return brandGroups
      .map(group => ({
        ...group,
        items: group.items.filter(item =>
          item.stokAdi.toLowerCase().includes(q) ||
          item.stokKodu.toLowerCase().includes(q) ||
          item.marka.toLowerCase().includes(q)
        ),
      }))
      .filter(group => group.items.length > 0 || group.brand.toLowerCase().includes(q));
  }, [brandGroups, searchQuery]);

  // Total cost
  const totalCost = useMemo(() => {
    return brandGroups.reduce((sum, g) => sum + g.totalCost, 0);
  }, [brandGroups]);

  const toggleBrand = (brand: string) => {
    setExpandedBrands(prev => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });
  };

  const expandAll = () => setExpandedBrands(new Set(brandGroups.map(g => g.brand)));
  const collapseAll = () => setExpandedBrands(new Set());

  const sym = CURRENCY_SYMBOLS[currency];

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="cihaz-shell maliyet-clay min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-[var(--dashboard-muted)] mb-4">Sayim oturumu bulunamadi.</p>
          <button
            onClick={() => router.push('/cost-dashboard/gecmis')}
            className="text-sm text-[var(--dashboard-accent)] hover:underline"
          >
            Gecmise Don
          </button>
        </div>
      </div>
    );
  }

  const sessionDate = getSessionDate(session);

  return (
    <div className="cihaz-shell maliyet-clay min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-24">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push('/cost-dashboard/gecmis')}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider',
                session.locationType === 'lab'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              )}>
                {session.locationType === 'lab' ? (
                  <><TestTube className="w-3 h-3" /> Lab</>
                ) : (
                  <><Building2 className="w-3 h-3" /> Depo</>
                )}
              </span>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)] truncate">
                {session.locationName}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--dashboard-muted)]">
              {sessionDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {format(sessionDate, 'dd MMMM yyyy HH:mm', { locale: tr })}
                </span>
              )}
              {session.createdByName && (
                <span className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  {session.createdByName}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {editMode ? (
              <>
                <button
                  onClick={cancelEdit}
                  disabled={isSavingEdit}
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] disabled:opacity-50"
                >
                  Vazgeç
                </button>
                <button
                  onClick={saveEdit}
                  disabled={isSavingEdit || isEditLoading}
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--dashboard-accent)] text-white shadow-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                >
                  {isSavingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Kaydet
                </button>
              </>
            ) : (
              <button
                onClick={startEdit}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] flex items-center gap-2"
              >
                <Edit3 className="w-4 h-4" />
                Düzenle
              </button>
            )}
          </div>
        </div>

        {editMode && (
          <div className="cihaz-card-strong rounded-2xl p-4 mb-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dashboard-text)]">
              {isEditLoading && <Loader2 className="w-4 h-4 animate-spin text-[var(--dashboard-accent)]" />}
              <span>Sayım düzenleme modu</span>
            </div>
            <p className="mt-1 text-xs text-[var(--dashboard-muted)]">
              Bu ekranda lokasyona ait min-max tanımlı tüm ürünler gösterilir. Boş bırakılan değerler 0 kabul edilir ve kaydedildiğinde maliyet gözlem hesapları bu oturum üzerinden güncellenir.
            </p>
          </div>
        )}

        {/* Participants bar (for multi-user sessions) */}
        {isMultiUser && (
          <div className="cihaz-card-strong rounded-2xl p-4 mb-5">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-[var(--dashboard-accent)]" />
              <span className="text-xs font-semibold text-[var(--dashboard-text)]">
                Katilimcilar ({sessionParticipants.length})
              </span>
              <button
                onClick={() => setShowAttribution(!showAttribution)}
                className={cn(
                  'ml-auto px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors',
                  showAttribution
                    ? 'bg-[var(--dashboard-accent)]/10 text-[var(--dashboard-accent)]'
                    : 'bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]'
                )}
              >
                {showAttribution ? 'Atif Goster' : 'Atif Gizle'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {sessionParticipants.map((p, i) => (
                <div
                  key={p.uid}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--dashboard-surface-2)]/50"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length] }}
                  />
                  <span className="text-xs font-medium text-[var(--dashboard-text)]">{p.name}</span>
                  {p.uid === session.createdByUid && (
                    <span className="text-[9px] text-[var(--dashboard-muted)] bg-[var(--dashboard-surface-2)] px-1.5 py-0.5 rounded">
                      olusturan
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="cihaz-pressed px-4 py-3 flex flex-col items-center text-center">
            <span className="text-lg font-bold text-[var(--dashboard-accent)]">{formatCurrency(totalCost, sym)}</span>
            <span className="text-[10px] text-[var(--dashboard-muted)]">Toplam Maliyet</span>
          </div>
          <div className="cihaz-pressed px-4 py-3 flex flex-col items-center text-center">
            <span className="text-lg font-bold text-[var(--dashboard-text)]">{brandGroups.length}</span>
            <span className="text-[10px] text-[var(--dashboard-muted)]">Marka</span>
          </div>
          <div className="cihaz-pressed px-4 py-3 flex flex-col items-center text-center">
            <span className="text-lg font-bold text-[var(--dashboard-text)]">{displayItems.length}</span>
            <span className="text-[10px] text-[var(--dashboard-muted)]">Urun</span>
          </div>
          <div className="cihaz-pressed px-4 py-3 flex flex-col items-center text-center">
            <span className="text-lg font-bold text-[var(--dashboard-text)]">
              {displayItems.reduce((sum, i) => sum + i.stokAdedi, 0)}
            </span>
            <span className="text-[10px] text-[var(--dashboard-muted)]">Toplam Stok</span>
          </div>
        </div>

        {/* Toolbar */}
        <div className="cihaz-card-strong rounded-2xl p-4 mb-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* Search */}
            <div className="flex-1 w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <Search className="w-4 h-4 text-[var(--dashboard-muted)] shrink-0" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Urun veya marka ara..."
                className="flex-1 bg-transparent text-sm text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)] outline-none"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              {/* Currency switcher */}
              <div className="flex items-center gap-1">
                {(['EUR', 'USD', 'TRY'] as Currency[]).map(cur => (
                  <button
                    key={cur}
                    onClick={() => setCurrency(cur)}
                    className={cn(
                      'px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all duration-200',
                      currency === cur
                        ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                        : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
                    )}
                  >
                    {CURRENCY_SYMBOLS[cur]}
                  </button>
                ))}
              </div>

              {/* Expand/Collapse */}
              <button
                onClick={expandedBrands.size > 0 ? collapseAll : expandAll}
                className="px-3 py-1.5 rounded-xl text-[11px] font-medium bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
              >
                {expandedBrands.size > 0 ? 'Daralt' : 'Genislet'}
              </button>
            </div>
          </div>
        </div>

        {/* Brand Groups */}
        <div className="space-y-3">
          {filteredBrandGroups.map(group => {
            const isExpanded = expandedBrands.has(group.brand);

            return (
              <div key={group.brand} className="cihaz-card-strong rounded-2xl overflow-hidden">
                {/* Brand Header */}
                <button
                  onClick={() => toggleBrand(group.brand)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left group hover:bg-[var(--dashboard-surface-2)]/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Tag className="w-4 h-4 text-[var(--dashboard-accent)] shrink-0" />
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-[var(--dashboard-text)]">{group.brand}</span>
                      <span className="text-[11px] text-[var(--dashboard-muted)] ml-2">
                        {group.items.length} urun
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-bold text-[var(--dashboard-accent)]">
                      {formatCurrency(group.totalCost, sym)}
                    </span>
                    <ChevronDown className={cn(
                      'w-4 h-4 text-[var(--dashboard-muted)] transition-transform duration-200',
                      isExpanded && 'rotate-180'
                    )} />
                  </div>
                </button>

                {/* Product List */}
                {isExpanded && (
                  <div className="border-t border-[var(--dashboard-stroke)]">
                    {/* Table Header */}
                    <div className="hidden sm:grid grid-cols-12 gap-2 px-5 py-2.5 bg-[var(--dashboard-surface-2)]/50 text-[10px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">
                      <div className="col-span-1">Kod</div>
                      <div className={cn("col-span-4", isMultiUser && showAttribution ? "col-span-3" : "col-span-4")}>Urun Adi</div>
                      <div className="col-span-2 text-center">Stok</div>
                      <div className="col-span-2 text-center">Cihaz Ustu</div>
                      <div className="col-span-2 text-right">Maliyet</div>
                      {isMultiUser && showAttribution && <div className="col-span-2 text-right">Sayan</div>}
                    </div>

                    {/* Items */}
                    <div className="divide-y divide-[var(--dashboard-stroke)]">
                      {group.items.map((item, idx) => {
                        const cost = getProductCost(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi);
                        const product = productMap.get(item.stokKodu);
                        const nativeCurrency = (product?.currency || 'TRY') as Currency;
                        const detailedItem = item as DetailedSessionItem;
                        const hasUpdates = detailedItem.updates && detailedItem.updates.length > 0;

                        return (
                          <div
                            key={`${item.stokKodu}-${idx}`}
                            className="px-5 py-3 hover:bg-[var(--dashboard-surface-2)]/30 transition-colors"
                          >
                            {/* Desktop */}
                            <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                              <div className="col-span-1 text-[11px] font-mono text-[var(--dashboard-muted)] truncate">
                                {item.stokKodu}
                              </div>
                              <div className={cn("text-sm text-[var(--dashboard-text)] truncate", isMultiUser && showAttribution ? "col-span-3" : "col-span-4")}>
                                {item.stokAdi}
                              </div>
                              <div className="col-span-2 text-sm text-[var(--dashboard-text)] text-center">
                                {editMode ? (
                                  <input
                                    inputMode="numeric"
                                    value={editValues[item.stokKodu]?.stokAdedi ?? ''}
                                    onChange={(e) => updateEditValue(item.stokKodu, 'stokAdedi', e.target.value)}
                                    className="w-full h-9 rounded-lg bg-[var(--dashboard-surface-2)] px-2 text-center outline-none shadow-[var(--dashboard-pressed)]"
                                    placeholder="0"
                                  />
                                ) : item.stokAdedi}
                              </div>
                              <div className="col-span-2 text-sm text-[var(--dashboard-text)] text-center">
                                {editMode ? (
                                  <input
                                    inputMode="numeric"
                                    value={editValues[item.stokKodu]?.cihazUstuAdedi ?? ''}
                                    onChange={(e) => updateEditValue(item.stokKodu, 'cihazUstuAdedi', e.target.value)}
                                    className="w-full h-9 rounded-lg bg-[var(--dashboard-surface-2)] px-2 text-center outline-none shadow-[var(--dashboard-pressed)]"
                                    placeholder="0"
                                  />
                                ) : (item.cihazUstuAdedi || 0)}
                              </div>
                              <div className="col-span-2 text-right">
                                <span className="text-sm font-semibold text-[var(--dashboard-accent)]">
                                  {formatCurrencyDetailed(cost, sym)}
                                </span>
                                {nativeCurrency !== currency && cost > 0 && (
                                  <p className="text-[9px] text-[var(--dashboard-muted)]">
                                    {CURRENCY_SYMBOLS[nativeCurrency]}{nativeCurrency}
                                  </p>
                                )}
                              </div>
                              {isMultiUser && showAttribution && (
                                <div className="col-span-2 text-right">
                                  {detailedItem.countedByName ? (
                                    <div className="flex items-center justify-end gap-1.5">
                                      <span
                                        className="w-2.5 h-2.5 rounded-full shrink-0"
                                        style={{ backgroundColor: getParticipantColor(detailedItem.countedByUid || '', sessionParticipants) }}
                                      />
                                      <span className="text-[11px] text-[var(--dashboard-muted)] truncate">
                                        {detailedItem.countedByName}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-[var(--dashboard-muted)]">-</span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Mobile */}
                            <div className="sm:hidden">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-[var(--dashboard-text)] leading-snug">
                                    {item.stokAdi}
                                  </p>
                                  <p className="text-[11px] text-[var(--dashboard-muted)] mt-0.5">
                                    {item.stokKodu} · Stok: {item.stokAdedi}
                                    {item.cihazUstuAdedi > 0 && ` · CU: ${item.cihazUstuAdedi}`}
                                  </p>
                                  {editMode && (
                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                      <input
                                        inputMode="numeric"
                                        value={editValues[item.stokKodu]?.stokAdedi ?? ''}
                                        onChange={(e) => updateEditValue(item.stokKodu, 'stokAdedi', e.target.value)}
                                        className="h-9 rounded-lg bg-[var(--dashboard-surface-2)] px-2 text-xs outline-none shadow-[var(--dashboard-pressed)]"
                                        placeholder="Stok"
                                      />
                                      <input
                                        inputMode="numeric"
                                        value={editValues[item.stokKodu]?.cihazUstuAdedi ?? ''}
                                        onChange={(e) => updateEditValue(item.stokKodu, 'cihazUstuAdedi', e.target.value)}
                                        className="h-9 rounded-lg bg-[var(--dashboard-surface-2)] px-2 text-xs outline-none shadow-[var(--dashboard-pressed)]"
                                        placeholder="Cihaz üstü"
                                      />
                                    </div>
                                  )}
                                  {isMultiUser && showAttribution && detailedItem.countedByName && (
                                    <div className="flex items-center gap-1 mt-1">
                                      <span
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: getParticipantColor(detailedItem.countedByUid || '', sessionParticipants) }}
                                      />
                                      <span className="text-[10px] text-[var(--dashboard-muted)]">
                                        {detailedItem.countedByName}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <span className="text-sm font-semibold text-[var(--dashboard-accent)] shrink-0">
                                  {formatCurrencyDetailed(cost, sym)}
                                </span>
                              </div>
                            </div>

                            {/* Update log (for detailed items with multi-user) */}
                            {isMultiUser && showAttribution && hasUpdates && (
                              <UpdateLog updates={detailedItem.updates} participants={sessionParticipants} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filteredBrandGroups.length === 0 && searchQuery && (
          <div className="cihaz-card-strong rounded-2xl p-12 text-center">
            <Search className="w-10 h-10 text-[var(--dashboard-muted)] mx-auto mb-3 opacity-40" />
            <p className="text-sm text-[var(--dashboard-muted)]">Aramanizla eslesen urun bulunamadi.</p>
          </div>
        )}
      </div>
    </div>
  );
}
