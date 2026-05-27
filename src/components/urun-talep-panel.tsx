
'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2,
  Trash2,
  ClipboardPlus,
  Check,
  ChevronsUpDown,
  Unplug,
  CalendarDays,
  Wrench,
  FlaskConical,
  History,
  Search,
  Plus,
  Minus,
  MoreHorizontal,
  Package,
  X,
  ShoppingCart,
  Warehouse,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import type { Depot, Hospital, ProductCode, MinMaxRule, OrderItem, OrderUrgency } from '@/lib/types';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, AlertCircle, Flame } from 'lucide-react';
import { generateId, playNotificationSound, cn } from '@/lib/utils';
import BackButton from '@/components/BackButton';
import { emitOrderCreatedFromRequest } from '@/lib/notifications';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useActiveDutyShifts, useUpcomingDutyShifts } from '@/hooks/useFirebaseQueries';
import type { DutyShift } from '@/lib/types';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { LabSelector } from '@/components/common/LabSelector';

/* =======================================================
   DUTY SCHEDULE HELPERS (preserved from original)
   ======================================================= */

function formatShiftDate(date: unknown): string {
  const d = date instanceof Date ? date : new Date(date as any);
  return formatDate(d, 'd MMM yyyy', { locale: tr });
}

function DutyScheduleModal({ open, onOpenChange, selectedLabId }: { open: boolean; onOpenChange: (open: boolean) => void; selectedLabId: string | null }) {
  const { data: upcomingShifts = [], isLoading } = useUpcomingDutyShifts(selectedLabId);

  const teknikServisShifts = React.useMemo(() =>
    upcomingShifts.filter((s: DutyShift) => s.role === 'teknik_servis'),
    [upcomingShifts]
  );
  const aplikasyonShifts = React.useMemo(() =>
    upcomingShifts.filter((s: DutyShift) => s.role === 'aplikasyon'),
    [upcomingShifts]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Nöbet Takvimi - Gelecek 30 Gün
          </DialogTitle>
          <DialogDescription>
            Seçili laboratuvara atanmış nöbetçi personel listesi
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Yükleniyor...</span>
            </div>
          ) : upcomingShifts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>Gelecek 30 gün için nöbet kaydı bulunamadı.</p>
            </div>
          ) : (
            <div className="space-y-6 pr-3">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Wrench className="h-4 w-4 text-blue-400" />
                  <h3 className="font-semibold text-sm text-blue-400 uppercase tracking-wider">Teknik Servis</h3>
                </div>
                {teknikServisShifts.length === 0 ? (
                  <p className="text-sm text-muted-foreground pl-6">Atanmış nöbetçi yok</p>
                ) : (
                  <div className="space-y-2 pl-6">
                    {teknikServisShifts.map((shift: DutyShift) => (
                      <div key={shift.id} className="flex items-center justify-between rounded-lg border p-3 bg-blue-500/5 border-blue-500/20">
                        <span className="font-medium text-sm">{shift.userName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatShiftDate(shift.startDate)} - {formatShiftDate(shift.endDate)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FlaskConical className="h-4 w-4 text-purple-400" />
                  <h3 className="font-semibold text-sm text-purple-400 uppercase tracking-wider">Aplikasyon</h3>
                </div>
                {aplikasyonShifts.length === 0 ? (
                  <p className="text-sm text-muted-foreground pl-6">Atanmış nöbetçi yok</p>
                ) : (
                  <div className="space-y-2 pl-6">
                    {aplikasyonShifts.map((shift: DutyShift) => (
                      <div key={shift.id} className="flex items-center justify-between rounded-lg border p-3 bg-purple-500/5 border-purple-500/20">
                        <span className="font-medium text-sm">{shift.userName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatShiftDate(shift.startDate)} - {formatShiftDate(shift.endDate)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function DutyInfo({ selectedLabId }: { selectedLabId: string | null }) {
  const { data: activeShifts = [] } = useActiveDutyShifts();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const dutyPersonnel = React.useMemo(() => {
    if (!selectedLabId || !activeShifts.length) return { teknikServis: null, aplikasyon: null };

    const labShifts = activeShifts.filter(shift => shift.laboratoryIds.includes(selectedLabId));
    const teknikServisShift = labShifts.find(s => s.role === 'teknik_servis');
    const aplikasyonShift = labShifts.find(s => s.role === 'aplikasyon');

    return {
      teknikServis: teknikServisShift ? { name: teknikServisShift.userName } : null,
      aplikasyon: aplikasyonShift ? { name: aplikasyonShift.userName } : null,
    };
  }, [selectedLabId, activeShifts]);

  if (!selectedLabId) return null;

  const hasDutyPersonnel = dutyPersonnel.teknikServis || dutyPersonnel.aplikasyon;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className="hidden md:flex items-center gap-4 text-foreground cursor-pointer hover:opacity-80 transition-opacity rounded-lg px-3 py-1.5 hover:bg-white/5"
      >
        <span className="text-base opacity-70 font-semibold text-foreground">Nöbetçi</span>
        {hasDutyPersonnel ? (
          <>
            {dutyPersonnel.teknikServis && (
              <div className="flex items-center gap-2 duty-glow-text">
                <Wrench className="h-5 w-5 text-blue-400 flex-shrink-0" />
                <span className="whitespace-nowrap font-bold text-xl tracking-wide">{dutyPersonnel.teknikServis.name}</span>
              </div>
            )}
            {dutyPersonnel.teknikServis && dutyPersonnel.aplikasyon && (
              <span className="opacity-30 text-xl">|</span>
            )}
            {dutyPersonnel.aplikasyon && (
              <div className="flex items-center gap-2 duty-glow-text">
                <FlaskConical className="h-5 w-5 text-purple-400 flex-shrink-0" />
                <span className="whitespace-nowrap font-bold text-xl tracking-wide">{dutyPersonnel.aplikasyon.name}</span>
              </div>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground italic">Atanmış nöbetçi yok</span>
        )}
      </button>
      <DutyScheduleModal open={isModalOpen} onOpenChange={setIsModalOpen} selectedLabId={selectedLabId} />
    </>
  );
}


/* =======================================================
   QUANTITY INPUT DIALOG
   ======================================================= */

interface QuantityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductCode | null;
  existingQty: number;
  onConfirm: (productId: string, qty: number) => void;
}

function QuantityDialog({ open, onOpenChange, product, existingQty, onConfirm }: QuantityDialogProps) {
  const [qty, setQty] = useState<number | string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Packaging info
  const ambalaj = product?.ambalajDegeri ?? 0;
  const birim = product?.anaBirim || '';
  const numericQty = typeof qty === 'number' ? qty : 0;
  const totalUnits = ambalaj > 0 && numericQty > 0 ? ambalaj * numericQty : 0;

  // Reset qty when product changes — start empty
  useEffect(() => {
    if (open) {
      setQty('');
      // Focus input after dialog opens
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, product?.id]);

  const handleConfirm = () => {
    if (product && numericQty > 0) {
      onConfirm(product.id, numericQty);
      onOpenChange(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-xl sm:text-2xl font-bold text-[var(--dashboard-text)] leading-tight">
            {product.stokAdi}
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-[var(--dashboard-muted)]">
            {product.stokKodu}
            {birim && (
              <span className="ml-2">· {birim}{ambalaj > 0 ? ` (${ambalaj} adet)` : ''}</span>
            )}
            {existingQty > 0 && (
              <span className="ml-2 text-amber-500 font-medium">
                (Listede mevcut: {existingQty})
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-6 py-4">
          {/* Large quantity controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQty(Math.max(1, numericQty - 1))}
              className="w-14 h-14 rounded-2xl bg-[var(--dashboard-surface-2)] border border-[var(--dashboard-stroke)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-all active:scale-95 shadow-[var(--dashboard-pressed)]"
            >
              <Minus className="h-6 w-6" />
            </button>
            <Input
              ref={inputRef}
              type="number"
              min={1}
              value={qty}
              onChange={e => {
                const val = e.target.value;
                if (val === '') { setQty(''); return; }
                const num = Number(val);
                if (!isNaN(num) && num >= 0) setQty(num);
              }}
              onKeyDown={handleKeyDown}
              placeholder="0"
              className="w-28 h-14 text-center text-3xl font-bold border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] rounded-2xl [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              onClick={() => setQty(numericQty + 1)}
              className="w-14 h-14 rounded-2xl bg-[var(--dashboard-surface-2)] border border-[var(--dashboard-stroke)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-all active:scale-95 shadow-[var(--dashboard-pressed)]"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>

          {/* Packaging info */}
          {totalUnits > 0 && (
            <div className="text-center">
              <span className="text-sm font-semibold text-[var(--dashboard-text)]">
                {numericQty} {birim}
              </span>
              <span className="text-sm text-[var(--dashboard-muted)] ml-1">
                ({totalUnits.toLocaleString('tr-TR')} adet)
              </span>
            </div>
          )}

          {/* Quick qty buttons */}
          <div className="flex gap-2">
            {[1, 5, 10, 20].map(n => (
              <button
                key={n}
                onClick={() => setQty(n)}
                className={cn(
                  "px-3.5 py-1.5 rounded-xl text-sm font-semibold transition-all",
                  numericQty === n
                    ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised-soft)]"
                    : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] hover:text-[var(--dashboard-text)]"
                )}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Confirm button */}
          <button
            onClick={handleConfirm}
            disabled={numericQty <= 0}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-base font-bold transition-all",
              numericQty > 0
                ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised)] hover:shadow-[var(--dashboard-raised-soft)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[var(--dashboard-pressed)]"
                : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] cursor-not-allowed"
            )}
          >
            <Check className="h-5 w-5" />
            {existingQty > 0 ? `Listeye Ekle (+${numericQty || 0})` : `Listeye Ekle (${numericQty || 0})`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


/* =======================================================
   URGENCY + NOTE DIALOG (peripheral flow only)
   ======================================================= */

interface UrgencyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalItems: number;
  totalAdet: number;
  loading: boolean;
  onConfirm: (urgency: OrderUrgency, note: string) => void;
}

const URGENCY_OPTIONS: Array<{
  value: OrderUrgency;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  classes: { ring: string; bg: string; text: string; dot: string };
}> = [
  {
    value: 'normal',
    label: 'Normal',
    description: 'Standart süreçte karşılansın',
    icon: AlertCircle,
    classes: {
      ring: 'ring-emerald-500 border-emerald-500',
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-700 dark:text-emerald-400',
      dot: 'bg-emerald-500',
    },
  },
  {
    value: 'acil',
    label: 'Acil',
    description: 'Mümkün olan en kısa sürede',
    icon: AlertTriangle,
    classes: {
      ring: 'ring-amber-500 border-amber-500',
      bg: 'bg-amber-500/10',
      text: 'text-amber-700 dark:text-amber-400',
      dot: 'bg-amber-500',
    },
  },
  {
    value: 'cok_acil',
    label: 'Çok Acil',
    description: 'Aynı gün — kritik',
    icon: Flame,
    classes: {
      ring: 'ring-red-500 border-red-500',
      bg: 'bg-red-500/10',
      text: 'text-red-700 dark:text-red-400',
      dot: 'bg-red-500',
    },
  },
];

function UrgencyDialog({ open, onOpenChange, totalItems, totalAdet, loading, onConfirm }: UrgencyDialogProps) {
  const [urgency, setUrgency] = useState<OrderUrgency>('normal');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setUrgency('normal');
      setNote('');
    }
  }, [open]);

  const handleSubmit = () => {
    if (loading) return;
    onConfirm(urgency, note.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o); }}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-[var(--dashboard-text)]">
            Talebi Onayla
          </DialogTitle>
          <DialogDescription className="text-sm text-[var(--dashboard-muted)]">
            Aciliyet durumunu seçin ve dilerseniz kısa bir açıklama ekleyin. Talep onaylandıktan sonra ofis lojistiğine iletilecek ve otomatik e-posta gönderilecek.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Summary */}
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[var(--dashboard-surface-2)] text-xs">
            <ShoppingCart className="h-4 w-4 text-[var(--dashboard-muted)]" />
            <span className="text-[var(--dashboard-muted)]">
              <span className="font-bold text-[var(--dashboard-text)]">{totalItems}</span> kalem
              {' · '}
              <span className="font-bold text-[var(--dashboard-text)]">{totalAdet}</span> adet
            </span>
          </div>

          {/* Urgency chips */}
          <div>
            <div className="text-xs font-semibold text-[var(--dashboard-text)] mb-2">
              Aciliyet Durumu <span className="text-red-500">*</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {URGENCY_OPTIONS.map(opt => {
                const Icon = opt.icon;
                const selected = urgency === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setUrgency(opt.value)}
                    disabled={loading}
                    className={cn(
                      'group flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border-2 transition-all text-center',
                      selected
                        ? cn('ring-2', opt.classes.ring, opt.classes.bg)
                        : 'border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] hover:border-[var(--dashboard-accent)]/60'
                    )}
                    aria-pressed={selected}
                  >
                    <div className={cn('p-1.5 rounded-lg', selected ? opt.classes.bg : 'bg-[var(--dashboard-surface-2)]')}>
                      <Icon className={cn('h-4 w-4', selected ? opt.classes.text : 'text-[var(--dashboard-muted)]')} />
                    </div>
                    <div className={cn('text-sm font-bold', selected ? opt.classes.text : 'text-[var(--dashboard-text)]')}>
                      {opt.label}
                    </div>
                    <div className="text-[10px] text-[var(--dashboard-muted)] leading-tight">
                      {opt.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Note */}
          <div>
            <div className="text-xs font-semibold text-[var(--dashboard-text)] mb-2">
              Açıklama <span className="text-[var(--dashboard-muted)] font-normal">(opsiyonel)</span>
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Örn. Hafta sonu nöbeti için kritik..."
              maxLength={500}
              rows={3}
              disabled={loading}
              className="resize-none"
            />
            <div className="text-[10px] text-[var(--dashboard-muted)] text-right mt-1">
              {note.length}/500
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--dashboard-surface-2)] text-[var(--dashboard-text)] hover:bg-[var(--dashboard-surface)] shadow-[var(--dashboard-pressed)] disabled:opacity-50"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className={cn(
              'flex-[1.5] flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all',
              loading
                ? 'bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] cursor-not-allowed'
                : 'bg-green-600 text-white shadow-[var(--dashboard-raised)] hover:shadow-[var(--dashboard-raised-soft)] hover:-translate-y-0.5 active:translate-y-0'
            )}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {loading ? 'Gönderiliyor...' : 'Onayla ve Gönder'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


/* =======================================================
   MAIN PANEL
   ======================================================= */

export default function UrunTalepPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);

  // Master Data
  const [depots, setDepots] = useState<Depot[]>([]);
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
  const [allProducts, setAllProducts] = useState<ProductCode[]>([]);

  // Selections
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [labMinMaxRules, setLabMinMaxRules] = useState<MinMaxRule[]>([]);

  // Order Basket
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);

  // Product list filter
  const [selectedLabGroup, setSelectedLabGroup] = useState<string>('all');
  const [productSearch, setProductSearch] = useState<string>('');

  // Quantity dialog
  const [qtyDialogOpen, setQtyDialogOpen] = useState(false);
  const [qtyDialogProduct, setQtyDialogProduct] = useState<ProductCode | null>(null);

  // Urgency confirmation dialog (peripheral flow only)
  const [urgencyDialogOpen, setUrgencyDialogOpen] = useState(false);

  // More menu
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);


  // -- Derived Data --
  const userHospitals = useMemo(() => {
    if (currentUserProfile?.role === 'admin') return allHospitals;
    return allHospitals.filter(h => currentUserProfile?.assignedLaboratories?.includes(h.id));
  }, [allHospitals, currentUserProfile]);

  const selectedLab = useMemo(
    () => userHospitals.find(h => h.id === selectedLabId) ?? null,
    [userHospitals, selectedLabId]
  );

  const isPeripheralFlow = selectedLab?.perifer === true;

  // Auto-select: if the user is assigned to exactly one lab, pick it immediately.
  // (expanded from original: now works for ALL single-lab users, not just perifer)
  const singleAutoLab = useMemo(() => {
    return userHospitals.length === 1 ? userHospitals[0] : null;
  }, [userHospitals]);

  useEffect(() => {
    if (selectedLabId) return;
    if (singleAutoLab?.id) {
      setSelectedLabId(singleAutoLab.id);
    }
  }, [singleAutoLab, selectedLabId]);

  // Show/hide logic
  const showLabPicker = !singleAutoLab;
  const showDepotPicker = !isPeripheralFlow && !selectedLab?.defaultDepotId;

  // Available products (min-max defined)
  const availableProducts = useMemo(() => {
    const ruleStockCodes = new Set(labMinMaxRules.map(r => r.stokKodu));
    return allProducts.filter(p => ruleStockCodes.has(p.stokKodu));
  }, [labMinMaxRules, allProducts]);

  // Lab groups extracted from available products
  const labGroups = useMemo(() => {
    const groups = new Set<string>();
    availableProducts.forEach(p => {
      if (p.laboratuvarGrubu) groups.add(p.laboratuvarGrubu);
    });
    return Array.from(groups).sort();
  }, [availableProducts]);

  // Filtered product list
  const filteredProducts = useMemo(() => {
    let list = availableProducts;

    // Filter by lab group
    if (selectedLabGroup !== 'all') {
      list = list.filter(p => p.laboratuvarGrubu === selectedLabGroup);
    }

    // Filter by search
    if (productSearch.trim()) {
      const q = productSearch.trim().toLowerCase();
      list = list.filter(p =>
        p.stokAdi?.toLowerCase().includes(q) ||
        p.stokKodu?.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => (a.stokAdi ?? '').localeCompare(b.stokAdi ?? ''));
  }, [availableProducts, selectedLabGroup, productSearch]);

  // Cart summary
  const totalDraftItems = orderItems.length;
  const totalDraftAdet = orderItems.reduce((sum, i) => sum + (Number(i.adet) || 0), 0);

  const selectedLabName = useMemo(
    () => userHospitals.find(h => h.id === selectedLabId)?.name ?? '',
    [userHospitals, selectedLabId]
  );

  // Product lookup by stok kodu for packaging info display
  const productMetaByCode = useMemo(() => {
    const map = new Map<string, ProductCode>();
    allProducts.forEach(p => { if (p.stokKodu) map.set(p.stokKodu, p); });
    return map;
  }, [allProducts]);

  const isCreateReady = !!selectedLabId && orderItems.length > 0 && (isPeripheralFlow || !!selectedDepotId);


  // -- Data Fetching --
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [depotSnap, hospitalSnap, productSnap] = await Promise.all([
        getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
      ]);
      setDepots(depotSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)));
      setAllHospitals(hospitalSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
      setAllProducts(productSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
    } catch (err) {
      console.error('Error fetching initial data:', err);
      toast({ title: 'Hata', description: 'Gerekli veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch Min-Max rules and handle automated depot selection when a lab is selected
  useEffect(() => {
    if (!selectedLabId) {
      setLabMinMaxRules([]);
      setOrderItems([]);
      setSelectedDepotId('');
      return;
    }

    // Auto-select depot if laboratory has a default assignment
    const lab = allHospitals.find(h => h.id === selectedLabId);
    if (lab?.defaultDepotId) {
      setSelectedDepotId(lab.defaultDepotId);
    } else if (!isPeripheralFlow) {
      setSelectedDepotId('');
    }

    const fetchRules = async () => {
      setLoading(true);
      try {
        const rulesSnap = await getDocs(
          collection(db, 'hospitals', selectedLabId, 'minMaxRules')
        );
        setLabMinMaxRules(rulesSnap.docs.map(d => d.data() as MinMaxRule));
      } catch (err) {
        console.error('Error fetching min-max rules:', err);
        setLabMinMaxRules([]);
        toast({ title: 'Hata', description: 'Bu laboratuvar için Min-Max kuralları alınamadı.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    fetchRules();
  }, [selectedLabId, toast, allHospitals, isPeripheralFlow]);


  // -- Handlers --

  const handleProductClick = (product: ProductCode) => {
    setQtyDialogProduct(product);
    setQtyDialogOpen(true);
  };

  const handleQtyConfirm = (productId: string, qty: number) => {
    const product = allProducts.find(p => p.id === productId);
    if (!product || qty <= 0) return;

    setOrderItems(prev => {
      const existing = prev.find(item => item.stokKodu === product.stokKodu);
      if (existing) {
        return prev.map(item =>
          item.stokKodu === product.stokKodu
            ? { ...item, adet: item.adet + qty }
            : item
        );
      }
      return [
        ...prev,
        { id: product.id, stokKodu: product.stokKodu, stokAdi: product.stokAdi, adet: qty },
      ];
    });
  };

  const removeOrderItem = (productId: string) => {
    setOrderItems(prev => prev.filter(item => item.id !== productId));
  };

  // Entry point bound to both "Talep Oluştur" buttons. For peripheral labs we
  // open the urgency/note dialog and let it call submitOrderRequest after
  // confirmation; for non-peripheral flow we submit immediately.
  const handleCreateClick = () => {
    if (!selectedLabId || orderItems.length === 0) {
      toast({ title: 'Eksik Bilgi', description: 'Laboratuvar ve en az bir ürün seçmelisiniz.', variant: 'destructive' });
      return;
    }
    if (!isPeripheralFlow && !selectedDepotId) {
      toast({ title: 'Eksik Bilgi', description: 'Depo, laboratuvar ve en az bir ürün seçmelisiniz.', variant: 'destructive' });
      return;
    }

    if (isPeripheralFlow) {
      setUrgencyDialogOpen(true);
      return;
    }
    submitOrderRequest();
  };

  const submitOrderRequest = async (urgency?: OrderUrgency, note?: string) => {
    if (!selectedLabId || orderItems.length === 0) return;
    if (!isPeripheralFlow && !selectedDepotId) return;

    setLoading(true);
    try {
      const orderId = generateId();
      const labName = allHospitals.find(h => h.id === selectedLabId)?.name || 'Bilinmeyen Kurum';
      const depotName = depots.find(d => d.id === selectedDepotId)?.name || '';

      // Perifer talepleri depo ataması yapmadan kayıt edilir; hangi depoya
      // yönlendirileceğine ofis lojistik sorumlusu karar verir.
      const newOrder: Record<string, any> = {
        id: orderId,
        labId: selectedLabId,
        kurumAdi: labName,
        items: orderItems,
        status: 'pending' as const,
        createdAt: serverTimestamp(),
        createdBy: currentUserProfile?.name || currentUser?.email || 'Unknown User',
        createdById: currentUser?.uid || 'unknown',
        requestSource: isPeripheralFlow ? ('lab_to_office' as const) : ('lab_to_depot' as const),
        isPeripheral: isPeripheralFlow,
        transferredAt: null,
      };
      if (!isPeripheralFlow) {
        newOrder.depotId = selectedDepotId;
        newOrder.depotName = depotName || 'Bilinmeyen Depo';
      } else {
        newOrder.depotId = null;
        newOrder.depotName = null;
      }
      if (isPeripheralFlow) {
        newOrder.urgency = urgency ?? 'normal';
        if (note && note.length > 0) newOrder.note = note;
      }

      await setDoc(doc(db, 'orders', orderId), withCompanyScope(newOrder, currentCompanyId));

      // Bildirim için kısa ürün özeti: ilk 3 ürünü "Ad x adet" formatıyla, fazlasını "+N kalem" olarak göster.
      const totalAdetForNotif = orderItems.reduce((s, it) => s + (Number(it.adet) || 0), 0);
      const preview = orderItems
        .slice(0, 3)
        .map(it => `${it.stokAdi} x${it.adet}`)
        .join(', ');
      const extra = orderItems.length > 3 ? ` (+${orderItems.length - 3} kalem)` : '';
      const itemsSummary = `${preview}${extra}`;

      await emitOrderCreatedFromRequest({
        actor: { uid: currentUserProfile?.uid || '', name: currentUserProfile?.name || '' },
        orderId: orderId,
        labId: selectedLabId,
        labName,
        depotId: isPeripheralFlow ? '' : selectedDepotId,
        isPeripheral: isPeripheralFlow,
        itemsSummary,
        itemsCount: orderItems.length,
        totalAdet: totalAdetForNotif,
        urgency: isPeripheralFlow ? (urgency ?? 'normal') : undefined,
        audienceHint: {
          userId: currentUserProfile?.uid,
          role: currentUserProfile?.role,
          views: currentUserProfile?.accessibleViews,
          labIds: currentUserProfile?.assignedLaboratories,
          depotIds: currentUserProfile?.assignedDepots,
        }
      });

      playNotificationSound();
      toast({
        title: 'Talep Oluşturuldu',
        description: isPeripheralFlow
          ? 'Talebiniz ofis lojistiğine iletildi.'
          : `Siparişiniz "${depotName}" deposuna iletildi.`,
      });

      // Reset form — but keep the auto-selected lab so the user can
      // immediately create another request without re-picking it.
      setOrderItems([]);
      if (!singleAutoLab) {
        setSelectedLabId('');
        setLabMinMaxRules([]);
      }
      setUrgencyDialogOpen(false);
    } catch (err) {
      console.error('Error creating order request:', err);
      toast({ title: 'Hata', description: 'Sipariş talebi oluşturulamadı.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };


  // -- Render --

  return (
    <div
      className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4 sm:space-y-5 min-h-screen"
      role="main"
      aria-label="Urun talep paneli"
    >
      {/* ====================== HEADER ====================== */}
      <div className="flex items-center gap-3">
        <BackButton fallback="/urun-kullanim" />
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-[var(--dashboard-text)] flex items-center gap-2">
            <ClipboardPlus className="h-5 w-5 text-[var(--dashboard-accent)]" />
            Ürün Talep
          </h1>
          <p className="text-[11px] sm:text-xs text-[var(--dashboard-muted)] truncate">
            {selectedLabName
              ? `${selectedLabName}${isPeripheralFlow ? ' · Perifer' : ''}`
              : 'Yetkili laboratuvarlar için ürün talebi oluşturun'}
          </p>
        </div>

        <DutyInfo selectedLabId={selectedLabId || null} />

        {/* CTA — Create Order (top right) */}
        <button
          onClick={handleCreateClick}
          disabled={!isCreateReady || loading}
          className={cn(
            "hidden sm:flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-bold transition-all",
            isCreateReady && !loading
              ? "bg-green-600 text-white shadow-[var(--dashboard-raised)] hover:shadow-[var(--dashboard-raised-soft)] active:shadow-[var(--dashboard-pressed)] hover:-translate-y-0.5 active:translate-y-0"
              : "cihaz-pressed text-[var(--dashboard-muted)] cursor-not-allowed"
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShoppingCart className="h-4 w-4" />
          )}
          {isPeripheralFlow ? 'Talep Oluştur' : 'Talep Oluştur'}
          {totalDraftItems > 0 && (
            <span className="ml-0.5 px-1.5 py-0.5 rounded-md bg-white/20 text-[10px] font-bold">{totalDraftItems}</span>
          )}
        </button>

        {/* More menu */}
        <Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
          <PopoverTrigger asChild>
            <button className="cihaz-tool-item flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10">
              <MoreHorizontal className="h-4 w-4 text-[var(--dashboard-muted)]" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="end">
            <button onClick={() => { router.push(selectedLabId ? `/urun-talep/gecmis?labId=${selectedLabId}` : '/urun-talep/gecmis'); setMoreMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)]">
              <History className="h-4 w-4 text-[var(--dashboard-muted)]" /> Geçmiş
            </button>
            <button onClick={() => { router.push('/cihazdan-cikan-kit'); setMoreMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)]">
              <Unplug className="h-4 w-4 text-[var(--dashboard-muted)]" /> Cihazdan Çıkan Kit
            </button>
          </PopoverContent>
        </Popover>
      </div>


      {/* ====================== LAB & DEPOT SELECTORS ====================== */}
      <div className="flex flex-wrap gap-3">
        {/* Depot selector — hidden for perifer flow */}
        {showDepotPicker && (
          <div className="cihaz-card p-3 sm:p-4 flex-1 min-w-[180px]">
            <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1.5">Kaynak Depo</label>
            <Select value={selectedDepotId} onValueChange={setSelectedDepotId} disabled={loading}>
              <SelectTrigger className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10">
                <SelectValue placeholder="Depo seçin..." />
              </SelectTrigger>
              <SelectContent>
                {depots.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Lab selector — hidden for single-lab users */}
        {showLabPicker && (
          <div className="cihaz-card p-3 sm:p-4 flex-1 min-w-[220px]">
            <LabSelector
              label="Hedef Laboratuvar"
              labs={userHospitals.map(h => ({
                id: h.id ?? '',
                name: h.name,
                kod: h.kod,
                meta: h.perifer ? 'Perifer' : undefined,
              }))}
              value={selectedLabId}
              onChange={(id) => setSelectedLabId(id)}
              placeholder="Laboratuvar seçin..."
              disabled={loading || userHospitals.length === 0}
            />
          </div>
        )}

        {/* Single-lab info banner */}
        {singleAutoLab && (
          <div className="cihaz-card p-3 sm:p-4 flex flex-col justify-center gap-1 flex-1 min-w-[200px]">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-purple-400 flex-shrink-0" />
              <span className="text-sm font-semibold text-[var(--dashboard-text)]">{singleAutoLab.name}</span>
              {singleAutoLab.perifer && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-purple-500 px-1.5 py-0.5 rounded bg-purple-500/10">
                  Perifer
                </span>
              )}
            </div>
            {singleAutoLab.defaultDepotId && !singleAutoLab.perifer && (
              <div className="flex items-center gap-1.5 text-amber-500/80">
                <Warehouse className="h-3.5 w-3.5" />
                <span className="text-[11px] font-medium">Otomatik Yönlendirme: {singleAutoLab.defaultDepotName || 'Depo'}</span>
              </div>
            )}
          </div>
        )}

        {/* Selected lab info if not single-lab but depot is auto-selected */}
        {!singleAutoLab && selectedLabId && !showDepotPicker && !isPeripheralFlow && (
          <div className="cihaz-card p-3 sm:p-4 flex flex-col justify-center gap-1 flex-1 min-w-[200px]">
            <div className="flex items-center gap-1.5 text-amber-500/80">
                <Warehouse className="h-3.5 w-3.5" />
                <span className="text-[11px] font-medium">Hedef Depo: {selectedLab?.defaultDepotName || 'Varsayılan Depo'}</span>
            </div>
            <p className="text-[10px] text-[var(--dashboard-muted)]">Laboratuvara özel varsayılan depo atandığı için seçim adımı atlandı.</p>
          </div>
        )}
      </div>


      {/* ====================== MAIN SPLIT VIEW ====================== */}
      {selectedLabId && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 sm:gap-5">

          {/* -- LEFT: Product Catalog -- */}
          <div className="cihaz-card-strong flex flex-col overflow-hidden">
            {/* Lab Group Chips + Search */}
            <div className="px-4 py-3 sm:px-5 space-y-3 border-b border-[var(--dashboard-stroke)]">
              {/* Category chips */}
              {labGroups.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setSelectedLabGroup('all')}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all",
                      selectedLabGroup === 'all'
                        ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised-soft)]"
                        : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] hover:text-[var(--dashboard-text)]"
                    )}
                  >
                    Tümü
                    <span className="ml-1 opacity-70">({availableProducts.length})</span>
                  </button>
                  {labGroups.map(group => {
                    const count = availableProducts.filter(p => p.laboratuvarGrubu === group).length;
                    return (
                      <button
                        key={group}
                        onClick={() => setSelectedLabGroup(group)}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all",
                          selectedLabGroup === group
                            ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised-soft)]"
                            : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] hover:text-[var(--dashboard-text)]"
                        )}
                      >
                        {group}
                        <span className="ml-1 opacity-70">({count})</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--dashboard-muted)]" />
                <Input
                  placeholder="Ürün ara..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="pl-9 h-10 rounded-xl bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] text-sm"
                />
                {productSearch && (
                  <button
                    onClick={() => setProductSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                  >
                    <X className="h-4 w-4 text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]" />
                  </button>
                )}
              </div>
            </div>

            {/* Product list */}
            <div className="flex-1 overflow-auto max-h-[55vh] sm:max-h-[60vh]">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--dashboard-accent)]" />
                  <span className="text-sm text-[var(--dashboard-muted)]">Ürünler yükleniyor...</span>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center px-4">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-3">
                    <Search className="h-5 w-5 text-[var(--dashboard-muted)]" />
                  </div>
                  <p className="text-sm font-medium text-[var(--dashboard-text)]">Ürün bulunamadı</p>
                  <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">
                    {productSearch ? 'Arama kriterlerinizi değiştirin' : 'Bu laboratuvar için Min-Max tanımlı ürün yok'}
                  </p>
                </div>
              ) : (
                filteredProducts.map((product) => {
                  const inCart = orderItems.find(item => item.stokKodu === product.stokKodu);
                  return (
                    <button
                      key={product.id}
                      onClick={() => handleProductClick(product)}
                      className={cn(
                        "w-full text-left px-4 sm:px-5 py-3 border-b border-[var(--dashboard-stroke)] last:border-b-0 transition-all hover:bg-[var(--dashboard-surface-2)] active:bg-[var(--dashboard-surface-2)] group",
                        inCart && "bg-[var(--dashboard-accent)]/5"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[var(--dashboard-text)] truncate group-hover:text-[var(--dashboard-accent)] transition-colors">
                            {product.stokAdi}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-[var(--dashboard-muted)]">{product.stokKodu}</span>
                            {product.laboratuvarGrubu && (
                              <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] bg-[var(--dashboard-surface-2)] px-1.5 py-0.5 rounded">
                                {product.laboratuvarGrubu}
                              </span>
                            )}
                          </div>
                        </div>
                        {inCart ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-xs font-bold text-[var(--dashboard-accent)] bg-[var(--dashboard-accent)]/10 px-2 py-1 rounded-lg">
                              {inCart.adet} adet
                            </span>
                            <Plus className="h-4 w-4 text-[var(--dashboard-accent)]" />
                          </div>
                        ) : (
                          <Plus className="h-4 w-4 text-[var(--dashboard-muted)] group-hover:text-[var(--dashboard-accent)] transition-colors shrink-0" />
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Product count footer */}
            <div className="px-4 sm:px-5 py-2 border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)]">
              <span className="text-[10px] sm:text-xs text-[var(--dashboard-muted)]">
                {filteredProducts.length} ürün
                {selectedLabGroup !== 'all' && ` · ${selectedLabGroup}`}
              </span>
            </div>
          </div>


          {/* -- RIGHT: Cart -- */}
          <div className="cihaz-card-strong flex flex-col overflow-hidden">
            {/* Cart header */}
            <div className="flex items-center gap-2 sm:gap-3 px-4 py-3 sm:px-5 border-b border-[var(--dashboard-stroke)]">
              <div className="flex-shrink-0">
                <h2 className="text-sm sm:text-base font-semibold text-[var(--dashboard-text)]">
                  Talep Kalemleri
                  <span className="ml-1.5 text-[var(--dashboard-muted)]">({totalDraftItems})</span>
                </h2>
                <p className="text-[10px] sm:text-xs text-[var(--dashboard-muted)]">
                  {totalDraftAdet} adet ürün talep edilecek
                </p>
              </div>
              <div className="flex-1" />
              {orderItems.length > 0 && (
                <button
                  onClick={() => setOrderItems([])}
                  className="cihaz-tool-item flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Temizle</span>
                </button>
              )}
            </div>

            {/* Table header (desktop) */}
            {orderItems.length > 0 && (
              <div className="hidden sm:grid grid-cols-[1fr_80px_40px] gap-1 px-4 sm:px-5 py-2 text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)]">
                <span>Ürün</span>
                <span className="text-center">Adet</span>
                <span></span>
              </div>
            )}

            {/* Cart items */}
            <div className="flex-1 overflow-auto max-h-[40vh] sm:max-h-[50vh]">
              {orderItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[30vh] sm:h-[35vh] text-center px-4">
                  <div className="w-14 h-14 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
                    <Package className="h-6 w-6 text-[var(--dashboard-muted)]" />
                  </div>
                  <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Talep listesi boş</p>
                  <p className="text-xs text-[var(--dashboard-muted)]">
                    Soldaki listeden ürün seçerek başlayın
                  </p>
                </div>
              ) : (
                orderItems.map((item) => {
                  const meta = productMetaByCode.get(item.stokKodu || '');
                  const itemAmbalaj = meta?.ambalajDegeri ?? 0;
                  const itemBirim = meta?.anaBirim || '';
                  const itemTotalUnits = itemAmbalaj > 0 ? itemAmbalaj * (item.adet ?? 0) : 0;
                  return (
                    <div key={item.id} className="border-b border-[var(--dashboard-stroke)] last:border-b-0">
                      {/* Desktop row */}
                      <div className="hidden sm:grid grid-cols-[1fr_80px_40px] gap-1 items-center px-4 sm:px-5 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[var(--dashboard-text)] truncate">{item.stokAdi}</p>
                          <p className="text-[10px] text-[var(--dashboard-muted)]">
                            {item.stokKodu}
                            {itemBirim && itemTotalUnits > 0 && (
                              <span className="ml-1.5 font-medium">
                                · {item.adet} {itemBirim} ({itemTotalUnits.toLocaleString('tr-TR')} adet)
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center justify-center">
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => {
                                const newQty = Math.max(1, (item.adet ?? 1) - 1);
                                setOrderItems(prev => prev.map(i => i.id === item.id ? { ...i, adet: newQty } : i));
                              }}
                              className="w-6 h-6 rounded-md bg-[var(--dashboard-surface-2)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-colors"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="text-center text-sm font-bold text-[var(--dashboard-text)] min-w-[32px]">{item.adet}</span>
                            <button
                              onClick={() => {
                                setOrderItems(prev => prev.map(i => i.id === item.id ? { ...i, adet: (i.adet ?? 1) + 1 } : i));
                              }}
                              className="w-6 h-6 rounded-md bg-[var(--dashboard-surface-2)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-colors"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                        <div className="flex justify-center">
                          <button
                            onClick={() => removeOrderItem(item.id)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-100 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </button>
                        </div>
                      </div>
                      {/* Mobile row */}
                      <div className="sm:hidden px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--dashboard-text)] truncate">{item.stokAdi}</p>
                            <p className="text-[11px] text-[var(--dashboard-muted)]">
                              {item.stokKodu}
                              {itemBirim && itemTotalUnits > 0 && (
                                <span className="ml-1 font-medium">
                                  · {item.adet} {itemBirim} ({itemTotalUnits.toLocaleString('tr-TR')} adet)
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => { const newQty = Math.max(1, (item.adet ?? 1) - 1); setOrderItems(prev => prev.map(i => i.id === item.id ? { ...i, adet: newQty } : i)); }} className="w-7 h-7 rounded-lg bg-[var(--dashboard-surface-2)] flex items-center justify-center">
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="text-center text-sm font-bold min-w-[28px]">{item.adet}</span>
                            <button onClick={() => { setOrderItems(prev => prev.map(i => i.id === item.id ? { ...i, adet: (i.adet ?? 1) + 1 } : i)); }} className="w-7 h-7 rounded-lg bg-[var(--dashboard-surface-2)] flex items-center justify-center">
                              <Plus className="h-3 w-3" />
                            </button>
                            <button onClick={() => removeOrderItem(item.id)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-100 ml-1">
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }))}
            </div>

            {/* Sticky CTA bar */}
            <div className="sticky bottom-0 border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] px-4 sm:px-5 py-3 flex items-center gap-3">
              <div className="flex gap-3 sm:gap-4 text-xs">
                <div>
                  <span className="text-[var(--dashboard-muted)]">Kalem</span>
                  <span className="ml-1 font-bold text-[var(--dashboard-text)]">{totalDraftItems}</span>
                </div>
                <div>
                  <span className="text-[var(--dashboard-muted)]">Adet</span>
                  <span className="ml-1 font-bold text-[var(--dashboard-text)]">{totalDraftAdet}</span>
                </div>
              </div>
              <div className="flex-1" />
              {/* Mobile CTA */}
              <button
                onClick={handleCreateClick}
                disabled={!isCreateReady || loading}
                className={cn(
                  "sm:hidden flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition-all",
                  isCreateReady && !loading
                    ? "bg-green-600 text-white shadow-[var(--dashboard-raised)] hover:shadow-[var(--dashboard-raised-soft)] active:shadow-[var(--dashboard-pressed)]"
                    : "cihaz-pressed text-[var(--dashboard-muted)] cursor-not-allowed"
                )}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                Talep Oluştur
              </button>
            </div>
          </div>

        </div>
      )}

      {/* Empty state when no lab selected */}
      {!selectedLabId && !loading && (
        <div className="cihaz-card-strong flex flex-col items-center justify-center py-16 sm:py-20 text-center px-4">
          <div className="w-16 h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
            <FlaskConical className="h-6 w-6 text-[var(--dashboard-muted)]" />
          </div>
          <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Laboratuvar seçin</p>
          <p className="text-xs text-[var(--dashboard-muted)]">Ürün listesini görmek için hedef laboratuvarı seçin.</p>
        </div>
      )}

      {/* Loading state */}
      {loading && !selectedLabId && (
        <div className="cihaz-card-strong flex flex-col items-center justify-center py-16 sm:py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)] mb-3" />
          <p className="text-sm text-[var(--dashboard-muted)]">Veriler yükleniyor...</p>
        </div>
      )}


      {/* ====================== QUANTITY DIALOG ====================== */}
      <QuantityDialog
        open={qtyDialogOpen}
        onOpenChange={setQtyDialogOpen}
        product={qtyDialogProduct}
        existingQty={qtyDialogProduct ? (orderItems.find(i => i.stokKodu === qtyDialogProduct.stokKodu)?.adet ?? 0) : 0}
        onConfirm={handleQtyConfirm}
      />

      {/* ====================== URGENCY DIALOG (peripheral) ====================== */}
      <UrgencyDialog
        open={urgencyDialogOpen}
        onOpenChange={setUrgencyDialogOpen}
        totalItems={totalDraftItems}
        totalAdet={totalDraftAdet}
        loading={loading}
        onConfirm={(urgency, note) => { submitOrderRequest(urgency, note); }}
      />
    </div>
  );
}
