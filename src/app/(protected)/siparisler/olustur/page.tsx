'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection, doc, setDoc, getDocs, Timestamp,
} from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { useDepots, useHospitals, useProductCodes, useDepoStokForOrders } from '@/hooks/useFirebaseQueries';
import { useToast } from '@/hooks/use-toast';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { getStockItemQuantity } from '@/lib/stock-quantity';
import { withCompanyScope } from '@/lib/company-scope';
import { generateId } from '@/lib/utils';
import { LabSelector } from '@/components/common/LabSelector';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatUnitMultiplier, normalizeUnitLabel } from '@/lib/product-unit';
import type { OrderItem, ProductCode, MinMaxRule } from '@/lib/types';
import {
  ChevronLeft, Plus, Minus, Trash2, Check, ChevronsUpDown,
  Calculator, Loader2, Send, Package,
} from 'lucide-react';

// ─── Design tokens (exact match to demo) ─────────────────────────────────────
const C = {
  surface: '#FCFAF5',
  surface2: '#F5F1E8',
  surfaceHi: '#FFFFFF',
  bg: '#EFEAE0',
  ink1: '#3D382F',
  ink2: '#908872',
  ink3: '#BBB2A0',
  line: 'rgba(90,72,40,0.07)',
  accent: '#C98A57',
  accentLight: '#E0B776',
  accentGlow: 'rgba(201,138,87,0.24)',
  water: 'rgba(124,191,140,0.30)',
  waterSolid: '#6FB585',
  amber: '#E0A33E',
  clay: 'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16)',
  clayInset: 'inset 0 2px 5px rgba(178,160,128,0.30), inset 0 -1px 0 rgba(255,255,255,0.55)',
  clayFlat: 'inset 0 1px 1px rgba(255,255,255,0.85), 0 4px 12px -7px rgba(150,128,96,0.28)',
  ease: 'cubic-bezier(.22, 1, .36, 1)',
  r: '24px',
  rsm: '16px',
  rpill: '999px',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, color: C.ink3, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
      {children}
    </p>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      borderRadius: C.r,
      background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
      boxShadow: C.clay,
      padding: '20px 22px',
      ...style,
    }}>
      {children}
    </div>
  );
}

function PrimaryBtn({
  onClick, disabled, loading, children,
}: {
  onClick?: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
        width: '100%', height: 52, borderRadius: C.rsm,
        background: disabled
          ? C.surface2
          : `linear-gradient(180deg, ${C.accentLight} 0%, ${C.accent} 100%)`,
        boxShadow: disabled
          ? C.clayInset
          : pressed ? 'inset 0 3px 7px rgba(120,80,30,0.28)' : `inset 0 1px 0 rgba(255,255,255,0.4), 0 12px 22px -10px ${C.accentGlow}`,
        color: disabled ? C.ink3 : '#fff',
        fontWeight: 800, fontSize: 14.5,
        transition: `all 240ms ${C.ease}`,
        transform: pressed ? 'translateY(1px)' : 'none',
      }}
    >
      {loading ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : children}
    </button>
  );
}

function GreenBtn({
  onClick, disabled, loading, children,
}: {
  onClick?: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
        height: 52, padding: '0 24px', borderRadius: C.rsm,
        background: disabled
          ? C.surface2
          : `linear-gradient(180deg, #8FD3A6 0%, ${C.waterSolid} 100%)`,
        boxShadow: disabled ? C.clayInset : pressed
          ? 'inset 0 3px 7px rgba(30,100,60,0.28)'
          : 'inset 0 1px 0 rgba(255,255,255,0.4), 0 12px 22px -10px rgba(111,181,133,0.5)',
        color: disabled ? C.ink3 : '#fff',
        fontWeight: 800, fontSize: 14.5,
        transition: `all 240ms ${C.ease}`,
        transform: pressed ? 'translateY(1px)' : 'none',
      }}
    >
      {loading ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : children}
    </button>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function SiparisOlusturPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin, isLoadingAuth } = useAuth();

  const { data: allDepotsData = [] } = useDepots();
  const { data: rawHospitals = [] } = useHospitals();
  const { data: rawProductCodes = [] } = useProductCodes();
  const { data: depoStok = [] } = useDepoStokForOrders();

  // Geçersiz id'li kayıtları ele — Radix Select / cmdk boş ("") value ile patlar.
  const hospitals = useMemo(() => rawHospitals.filter(h => !!h.id), [rawHospitals]);
  const productCodes = useMemo(() => rawProductCodes.filter(p => !!p.stokKodu), [rawProductCodes]);

  const depots = useMemo(
    () => filterOperationalSourceDepots(allDepotsData, currentUserProfile).filter(d => !!d.id),
    [allDepotsData, currentUserProfile],
  );

  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [manualStockCode, setManualStockCode] = useState('');
  const [manualQty, setManualQty] = useState<number | string>(1);
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMinMaxLoading, setIsMinMaxLoading] = useState(false);

  // ── Computed ──
  const totalDraftItems = orderItems.length;
  const totalDraftAdet = orderItems.reduce((s, i) => s + (Number(i.adet) || 0), 0);
  const isCreateReady = !!selectedDepotId && !!selectedLabId && orderItems.length > 0;

  const stepperState = useMemo(() => ({
    hasDepot: !!selectedDepotId,
    hasLab: !!selectedLabId,
    hasItems: orderItems.length > 0,
  }), [selectedDepotId, selectedLabId, orderItems]);

  const productMetaByCode = useMemo(() => {
    const map = new Map<string, ProductCode>();
    productCodes.forEach(p => { if (p.stokKodu) map.set(p.stokKodu, p); });
    return map;
  }, [productCodes]);

  // Stock quantity helpers (deduped map for O(1) lookup)
  const { depotQtyMap, labQtyByIdMap, labQtyByNameMap } = useMemo(() => {
    const depotMap = new Map<string, number>();
    const labById = new Map<string, number>();
    const labByName = new Map<string, number>();
    for (const st of depoStok) {
      if (!st.stokKodu) continue;
      const qty = getStockItemQuantity(st);
      if (!st.isShipped) {
        if (st.depotId) { const k = `${st.depotId}|${st.stokKodu}`; depotMap.set(k, (depotMap.get(k) ?? 0) + qty); }
      } else if (st.hedefKurumId) {
        const k = `${st.hedefKurumId}|${st.stokKodu}`; labById.set(k, (labById.get(k) ?? 0) + qty);
      } else if (st.hedefKurum) {
        const k = `${st.hedefKurum}|${st.stokKodu}`; labByName.set(k, (labByName.get(k) ?? 0) + qty);
      }
    }
    return { depotQtyMap: depotMap, labQtyByIdMap: labById, labQtyByNameMap: labByName };
  }, [depoStok]);

  const getDepotStockQty = (depotId: string | undefined, stokKodu: string) =>
    depotId ? (depotQtyMap.get(`${depotId}|${stokKodu}`) ?? 0) : 0;

  const getLabStockQty = (labId: string | undefined, labName: string | undefined | null, stokKodu: string) =>
    (labId ? (labQtyByIdMap.get(`${labId}|${stokKodu}`) ?? 0) : 0) +
    (labName ? (labQtyByNameMap.get(`${labName}|${stokKodu}`) ?? 0) : 0);

  // ── Handlers ──
  const addManualItem = useCallback(() => {
    if (!manualStockCode || !(Number(manualQty) > 0)) {
      toast({ title: 'Hata', description: 'Stok kodu ve geçerli bir adet girin.', variant: 'destructive' });
      return;
    }
    const prod = productCodes.find(p => p.stokKodu === manualStockCode);
    if (!prod) {
      toast({ title: 'Hata', description: 'Geçersiz stok kodu.', variant: 'destructive' });
      return;
    }
    setOrderItems(prev => {
      const existing = prev.find(i => i.stokKodu === manualStockCode);
      if (existing) {
        return prev.map(i => i.stokKodu === manualStockCode ? { ...i, adet: (i.adet ?? 0) + Number(manualQty) } : i);
      }
      return [...prev, { id: generateId(), stokKodu: manualStockCode, stokAdi: prod.stokAdi, adet: Number(manualQty) }];
    });
    setManualStockCode('');
    setManualQty(1);
  }, [manualStockCode, manualQty, productCodes, toast]);

  const removeItem = useCallback((id: string) => {
    setOrderItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const handleMinMaxOrder = useCallback(async () => {
    if (!selectedLabId) {
      toast({ title: 'Hata', description: 'Lütfen hedef laboratuvarı seçin.', variant: 'destructive' });
      return;
    }
    const hospital = hospitals.find(h => h.id === selectedLabId);
    if (!hospital?.id) return;

    setIsMinMaxLoading(true);
    try {
      const rulesSnap = await getDocs(collection(db, 'hospitals', hospital.id, 'minMaxRules'));
      const neededItems: OrderItem[] = [];

      rulesSnap.forEach(docSnap => {
        const rule = docSnap.data() as MinMaxRule;
        const stokKodu = rule.stokKodu;
        if (!stokKodu) return;
        const labStock = getLabStockQty(hospital.id, hospital.name, stokKodu);
        const maxValue = rule.max ?? 0;
        const need = maxValue - labStock;
        if (need > 0) {
          // Ürün katalogda yoksa bile min/max sipariş kalemini ekle — kural
          // sipariş gerektiriyorsa katalog eşleşmesi koşuluyla satır düşürmeyiz
          // (katalog şirket kapsamıyla sınırlı olabilir, kural geçerlidir).
          const product = productCodes.find(p => p.stokKodu === stokKodu);
          const depotStock = getDepotStockQty(selectedDepotId, stokKodu);
          const adi = product?.stokAdi ?? (rule as any).stokAdi ?? stokKodu;
          neededItems.push({
            id: generateId(),
            stokKodu,
            stokAdi: `${adi} (Depo: ${depotStock})`,
            adet: need,
          });
        }
      });

      if (neededItems.length === 0) {
        toast({ title: 'Sipariş Gerekmiyor', description: 'Min/Max kurallarına göre sipariş gerektiren ürün bulunamadı.' });
        return;
      }

      setOrderItems(prev => {
        const consolidated: Record<string, OrderItem> = {};
        [...prev, ...neededItems].forEach(item => {
          const key = item.stokKodu;
          if (!key) return;
          if (consolidated[key]) {
            consolidated[key] = { ...consolidated[key], adet: (consolidated[key].adet ?? 0) + (item.adet ?? 0) };
          } else {
            consolidated[key] = { ...item };
          }
        });
        return Object.values(consolidated);
      });
      toast({ title: 'Eklendi', description: `${neededItems.length} kalem Min/Max kurallarına göre eklendi.` });
    } finally {
      setIsMinMaxLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLabId, selectedDepotId, hospitals, productCodes, toast, getLabStockQty, getDepotStockQty]);

  const prepareOrder = useCallback(async () => {
    if (!isCreateReady) return;
    const selectedHospital = hospitals.find(h => h.id === selectedLabId);
    const hospitalName = selectedHospital?.name || 'Bilinmeyen Kurum';
    const orderId = generateId();

    setIsProcessing(true);
    try {
      await setDoc(doc(db, 'orders', orderId), withCompanyScope({
        id: orderId,
        depotId: selectedDepotId,
        labId: selectedLabId,
        kurumAdi: hospitalName,
        items: orderItems,
        createdAt: Timestamp.fromDate(new Date()),
        status: 'pending',
        isPeripheral: selectedHospital?.perifer ?? false,
        createdBy: currentUserProfile?.name || currentUser?.email || 'Bilinmeyen',
        createdById: currentUser?.uid || 'unknown',
        transferredAt: null,
      }, currentCompanyId));

      const totalAdet = orderItems.reduce((s, i) => s + (Number(i.adet) || 0), 0);
      const preview = orderItems.slice(0, 3).map(i => `${i.stokAdi} x${i.adet}`).join(', ');
      const extra = orderItems.length > 3 ? ` (+${orderItems.length - 3} kalem)` : '';

      const { emitOrderCreatedFromRequest } = await import('@/lib/notifications');
      await emitOrderCreatedFromRequest({
        actor: { uid: currentUserProfile?.uid ?? '', name: currentUserProfile?.name ?? '' },
        orderId,
        labId: selectedLabId,
        labName: hospitalName,
        depotId: selectedDepotId,
        isPeripheral: selectedHospital?.perifer ?? false,
        itemsSummary: `${preview}${extra}`,
        itemsCount: orderItems.length,
        totalAdet,
        audienceHint: {
          userId: currentUserProfile?.uid ?? undefined,
          role: currentUserProfile?.role ?? undefined,
          views: currentUserProfile?.accessibleViews ?? undefined,
          labIds: currentUserProfile?.assignedLaboratories ?? undefined,
          depotIds: currentUserProfile?.assignedDepots ?? undefined,
        },
      });

      toast({ title: 'Sipariş Oluşturuldu', description: `${hospitalName} için ${orderItems.length} kalem sipariş eklendi.` });
      router.push('/siparisler');
    } catch {
      toast({ title: 'Hata', description: 'Sipariş oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  }, [isCreateReady, selectedDepotId, selectedLabId, orderItems, hospitals, currentUser, currentUserProfile, currentCompanyId, router, toast]);

  // Auth çözülene kadar render etme — profil/şirket bilgisi null iken alt
  // bileşenlerin (Select / cmdk) erken render'ı kırılgan; kısa bir yükleme göster.
  if (isLoadingAuth) {
    return (
      <>
        <div aria-hidden style={{ position: 'fixed', inset: 0, background: C.surface2, zIndex: 0 }} />
        <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
          <Loader2 style={{ width: 30, height: 30, color: C.accent, animation: 'spin 1s linear infinite' }} />
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`
        @keyframes olusturSpin { to { transform: rotate(360deg); } }
        @keyframes olusturIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div aria-hidden style={{ position: 'fixed', inset: 0, background: 'linear-gradient(120deg, #F6F2EA 0%, transparent 55%), linear-gradient(225deg, #E8E1D2 0%, transparent 55%), #EFEAE0', zIndex: 0 }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1280, margin: '0 auto', padding: `24px clamp(16px, 3vw, 40px) 100px`, minHeight: '100vh' }}>

        {/* ── Back ── */}
        <button
          onClick={() => router.push('/siparisler')}
          style={{
            all: 'unset', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', marginBottom: 20, borderRadius: C.rpill,
            background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`,
            boxShadow: C.clayFlat,
            color: C.ink2, fontSize: 13, fontWeight: 700,
          }}
        >
          <ChevronLeft style={{ width: 16, height: 16 }} />
          Siparişler
        </button>

        {/* ── Title ── */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: C.ink1 }}>
            Yeni Sipariş Oluştur
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: C.ink2, fontWeight: 600 }}>
            Lab seçin, ürün ekleyin ve siparişi başlatın
          </p>
        </div>

        {/* ── Stepper ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 0, marginBottom: 30,
          padding: '18px 24px', borderRadius: C.r,
          background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
          boxShadow: C.clay,
        }}>
          {[
            { label: 'Lab Seç', done: stepperState.hasLab, active: !stepperState.hasLab, num: 1 },
            { label: 'Ürün Ekle', done: stepperState.hasItems, active: stepperState.hasLab && !stepperState.hasItems, num: 2 },
            { label: 'Oluştur', done: false, active: stepperState.hasItems, num: 3 },
          ].map((step, i) => (
            <React.Fragment key={step.num}>
              {i > 0 && (
                <div style={{
                  flex: 1, maxWidth: 72, height: 3, borderRadius: 99,
                  background: (i === 1 && stepperState.hasLab) || step.done ? `linear-gradient(90deg, ${C.accentLight}, ${C.accent})` : C.surface2,
                  boxShadow: (i === 1 && stepperState.hasLab) || step.done ? `0 2px 8px -3px ${C.accentGlow}` : C.clayInset,
                  transition: `all 450ms ${C.ease}`,
                }} />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 800,
                  background: step.done
                    ? `linear-gradient(180deg, ${C.accentLight}, ${C.accent})`
                    : step.active
                      ? `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`
                      : C.surface2,
                  boxShadow: step.done
                    ? `inset 0 1px 0 rgba(255,255,255,0.4), 0 8px 18px -6px ${C.accentGlow}`
                    : step.active ? C.clay : C.clayInset,
                  color: step.done ? '#fff' : step.active ? C.accent : C.ink3,
                  transition: `all 380ms ${C.ease}`,
                }}>
                  {step.done ? <Check style={{ width: 17, height: 17 }} /> : step.num}
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: step.active ? C.accent : step.done ? C.ink2 : C.ink3, textTransform: 'uppercase', letterSpacing: '0.06em', transition: `color 380ms ${C.ease}` }}>
                  {step.label}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* ── Depot selector ── */}
        <div style={{ marginBottom: 18 }}>
          <SectionLabel>Çalışma Deposu</SectionLabel>
          <div style={{ background: C.surface2, boxShadow: C.clayInset, borderRadius: C.rsm, overflow: 'hidden' }}>
            <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
              <SelectTrigger className="w-full border-0 shadow-none bg-transparent h-11 text-sm font-semibold">
                <SelectValue placeholder="Depo seçin..." />
              </SelectTrigger>
              <SelectContent>
                {depots.map(d => <SelectItem key={d.id} value={d.id ?? ''}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── 2-column layout ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>

          {/* LEFT: Lab + product add */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Lab selector card */}
            <Card>
              <SectionLabel>Hedef Laboratuvar</SectionLabel>
              <LabSelector
                labs={hospitals.map(h => ({ id: h.id ?? '', name: h.name, kod: h.kod }))}
                value={selectedLabId}
                onChange={setSelectedLabId}
                placeholder="Laboratuvar seçin..."
                disabled={!selectedDepotId || hospitals.length === 0}
              />

              {/* Min/Max button */}
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={handleMinMaxOrder}
                  disabled={!selectedLabId || isMinMaxLoading}
                  style={{
                    all: 'unset', cursor: !selectedLabId ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    width: '100%', height: 44, borderRadius: C.rsm,
                    background: selectedLabId ? `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})` : C.surface2,
                    boxShadow: selectedLabId ? C.clayFlat : C.clayInset,
                    color: selectedLabId ? C.ink1 : C.ink3,
                    fontSize: 13.5, fontWeight: 700,
                    transition: `all 240ms ${C.ease}`,
                    boxSizing: 'border-box',
                  }}
                >
                  {isMinMaxLoading
                    ? <Loader2 style={{ width: 15, height: 15, animation: 'olusturSpin 1s linear infinite' }} />
                    : <Calculator style={{ width: 15, height: 15, color: C.accent }} />
                  }
                  Min/Max'a Göre Hesapla
                </button>
              </div>
            </Card>

            {/* Product add card */}
            <Card>
              <SectionLabel>Ürün Ekle</SectionLabel>

              {/* Product combobox */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: C.ink3, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                  Ürün Seç
                </label>
                <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      style={{
                        all: 'unset', cursor: 'pointer', boxSizing: 'border-box',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', height: 44, padding: '0 14px', borderRadius: C.rsm,
                        background: manualStockCode ? C.surface : C.surface2,
                        boxShadow: manualStockCode ? C.clay : C.clayInset,
                        color: manualStockCode ? C.ink1 : C.ink3,
                        fontSize: 14, fontWeight: 600,
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {manualStockCode ? productMetaByCode.get(manualStockCode)?.stokAdi : 'Ürün seçin...'}
                      </span>
                      <ChevronsUpDown style={{ width: 15, height: 15, flexShrink: 0, opacity: 0.5 }} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command>
                      <CommandInput placeholder="Ürün ara..." />
                      <CommandList>
                        <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                        <CommandGroup>
                          {productCodes
                            .slice()
                            .sort((a, b) => (a.stokAdi ?? '').localeCompare(b.stokAdi ?? ''))
                            .map(p => (
                              <CommandItem
                                key={p.id ?? p.stokKodu}
                                value={`${p.stokAdi ?? ''} ${p.stokKodu ?? ''}`}
                                onSelect={() => { setManualStockCode(p.stokKodu ?? ''); setIsProductPopoverOpen(false); }}
                              >
                                <Check className={cn('mr-2 h-4 w-4', manualStockCode === p.stokKodu ? 'opacity-100' : 'opacity-0')} />
                                <div>
                                  <p className="text-sm">{p.stokAdi}</p>
                                  <p className="text-[10px] text-muted-foreground">{p.stokKodu}</p>
                                </div>
                              </CommandItem>
                            ))
                          }
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Qty stepper + Add button */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: C.ink3, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                    Adet
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button
                      onClick={() => setManualQty(Math.max(1, Number(manualQty) - 1))}
                      style={{
                        all: 'unset', cursor: 'pointer',
                        width: 36, height: 44, borderRadius: `${C.rsm} 0 0 ${C.rsm}`,
                        background: C.surface2, boxShadow: C.clayInset,
                        display: 'grid', placeItems: 'center', color: C.ink2,
                        flexShrink: 0,
                      }}
                    >
                      <Minus style={{ width: 13, height: 13 }} />
                    </button>
                    <Input
                      type="number"
                      min="1"
                      value={manualQty}
                      onChange={e => setManualQty(e.target.value)}
                      style={{
                        height: 44, borderRadius: 0, border: 'none',
                        background: C.surface, boxShadow: 'none',
                        textAlign: 'center', fontWeight: 800, fontSize: 15, color: C.ink1,
                      }}
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      onClick={() => setManualQty(Number(manualQty) + 1)}
                      style={{
                        all: 'unset', cursor: 'pointer',
                        width: 36, height: 44, borderRadius: `0 ${C.rsm} ${C.rsm} 0`,
                        background: C.surface2, boxShadow: C.clayInset,
                        display: 'grid', placeItems: 'center', color: C.ink2,
                        flexShrink: 0,
                      }}
                    >
                      <Plus style={{ width: 13, height: 13 }} />
                    </button>
                  </div>
                </div>
                <button
                  onClick={addManualItem}
                  disabled={!manualStockCode || !(Number(manualQty) > 0)}
                  style={{
                    all: 'unset',
                    cursor: !manualStockCode || !(Number(manualQty) > 0) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 7,
                    height: 44, padding: '0 16px', borderRadius: C.rsm,
                    background: manualStockCode && Number(manualQty) > 0
                      ? `linear-gradient(180deg, ${C.accentLight}, ${C.accent})`
                      : C.surface2,
                    boxShadow: manualStockCode && Number(manualQty) > 0
                      ? `0 6px 14px -4px ${C.accentGlow}`
                      : C.clayInset,
                    color: manualStockCode && Number(manualQty) > 0 ? '#fff' : C.ink3,
                    fontSize: 13, fontWeight: 800,
                    flexShrink: 0,
                    transition: `all 240ms ${C.ease}`,
                  }}
                >
                  <Plus style={{ width: 14, height: 14 }} />
                  Ekle
                </button>
              </div>
            </Card>
          </div>

          {/* RIGHT: Draft list */}
          <Card style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 380 }}>
            {/* Header */}
            <div style={{
              padding: '16px 22px', borderBottom: `1px solid ${C.line}`,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.ink1 }}>
                  Sipariş Kalemleri
                  <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 700, color: C.ink2 }}>
                    ({totalDraftItems})
                  </span>
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: C.ink2 }}>
                  {totalDraftAdet} adet ürün sipariş edilecek
                </p>
              </div>
              {orderItems.length > 0 && (
                <button
                  onClick={() => setOrderItems([])}
                  style={{
                    all: 'unset', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '6px 12px', borderRadius: C.rpill,
                    background: C.surface2, boxShadow: C.clayFlat,
                    color: '#C0796A', fontSize: 12, fontWeight: 700,
                  }}
                >
                  <Trash2 style={{ width: 12, height: 12 }} />
                  Temizle
                </button>
              )}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: 380 }}>
              {orderItems.length === 0 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  height: '100%', minHeight: 280, gap: 12, padding: 24, textAlign: 'center',
                }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: '28%',
                    background: C.surface2, boxShadow: C.clayInset,
                    display: 'grid', placeItems: 'center',
                  }}>
                    <Package style={{ width: 22, height: 22, color: C.ink3 }} />
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.ink2 }}>Sipariş listesi boş</p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: C.ink3 }}>Sol panelden ürün ekleyin veya Min/Max hesaplatın</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: C.ink3 }}>
                    {[
                      { done: stepperState.hasDepot, text: 'Depo seçin' },
                      { done: stepperState.hasLab, text: 'Laboratuvar seçin' },
                      { done: stepperState.hasItems, text: 'Ürün ekleyin' },
                    ].map((s, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          width: 20, height: 20, borderRadius: '50%',
                          display: 'grid', placeItems: 'center',
                          fontSize: 10, fontWeight: 800,
                          background: s.done ? `linear-gradient(180deg, ${C.accentLight}, ${C.accent})` : C.surface2,
                          boxShadow: s.done ? `0 4px 10px -3px ${C.accentGlow}` : C.clayInset,
                          color: s.done ? '#fff' : C.ink3, flexShrink: 0,
                        }}>
                          {s.done ? <Check style={{ width: 10, height: 10 }} /> : i + 1}
                        </span>
                        <span style={{ textDecoration: s.done ? 'line-through' : 'none' }}>{s.text}</span>
                        {s.done && <Check style={{ width: 11, height: 11, color: C.waterSolid }} />}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                orderItems.map(item => {
                  const meta = productMetaByCode.get(item.stokKodu || '');
                  const multiplier = formatUnitMultiplier(meta);
                  const unitLabel = `${normalizeUnitLabel(meta?.anaBirim)}${multiplier ? ` (${multiplier})` : ''}`;
                  return (
                    <div
                      key={item.id}
                      style={{
                        borderBottom: `1px solid ${C.line}`,
                        padding: '12px 22px',
                        display: 'flex', alignItems: 'center', gap: 10,
                        animation: 'olusturIn 260ms var(--olustr-ease, cubic-bezier(.22,1,.36,1))',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.stokAdi}
                        </p>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: C.ink3 }}>
                          {item.stokKodu} · {unitLabel}
                        </p>
                      </div>

                      {/* Qty stepper inline */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
                        <button
                          onClick={() => setOrderItems(prev => prev.map(i => i.id === item.id ? { ...i, adet: Math.max(1, (i.adet ?? 1) - 1) } : i))}
                          style={{
                            all: 'unset', cursor: 'pointer',
                            width: 28, height: 28, borderRadius: `${C.rsm} 0 0 ${C.rsm}`,
                            background: C.surface2, boxShadow: C.clayInset,
                            display: 'grid', placeItems: 'center', color: C.ink2,
                          }}
                        >
                          <Minus style={{ width: 11, height: 11 }} />
                        </button>
                        <div style={{
                          width: 42, height: 28,
                          background: C.surface, boxShadow: 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 13, fontWeight: 800, color: C.ink1,
                        }}>
                          {item.adet}
                        </div>
                        <button
                          onClick={() => setOrderItems(prev => prev.map(i => i.id === item.id ? { ...i, adet: (i.adet ?? 1) + 1 } : i))}
                          style={{
                            all: 'unset', cursor: 'pointer',
                            width: 28, height: 28, borderRadius: `0 ${C.rsm} ${C.rsm} 0`,
                            background: C.surface2, boxShadow: C.clayInset,
                            display: 'grid', placeItems: 'center', color: C.ink2,
                          }}
                        >
                          <Plus style={{ width: 11, height: 11 }} />
                        </button>
                      </div>

                      <button
                        onClick={() => removeItem(item.id ?? '')}
                        style={{
                          all: 'unset', cursor: 'pointer',
                          width: 30, height: 30, borderRadius: '50%',
                          display: 'grid', placeItems: 'center',
                          color: '#C0796A', flexShrink: 0,
                        }}
                      >
                        <Trash2 style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Sticky CTA footer */}
            <div style={{
              borderTop: `1px solid ${C.line}`,
              padding: '14px 22px',
              display: 'flex', alignItems: 'center', gap: 16,
              background: C.surface,
            }}>
              <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                <span style={{ color: C.ink2 }}>Kalem <strong style={{ color: C.ink1 }}>{totalDraftItems}</strong></span>
                <span style={{ color: C.ink2 }}>Adet <strong style={{ color: C.ink1 }}>{totalDraftAdet}</strong></span>
              </div>
              <div style={{ flex: 1 }} />
              <GreenBtn
                onClick={prepareOrder}
                disabled={!isCreateReady}
                loading={isProcessing}
              >
                <Send style={{ width: 15, height: 15 }} />
                Siparişi Oluştur
              </GreenBtn>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
