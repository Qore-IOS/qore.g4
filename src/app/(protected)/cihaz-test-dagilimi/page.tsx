'use client';

/**
 * Cihaz Test Dağılımı — Sürükle-bırak ile lab'daki cihazlara test/ürün atama.
 *
 * Akış:
 * 1. Lab seçilir.
 * 2. Sol panel: lab'a MinMax tanımlı ürünler (drag source).
 * 3. Sağ panel: lab'a atanmış cihazlar — her cihaz bir drop target.
 * 4. Bir ürün birden fazla cihaza atanabilir (kit paylaşımı).
 *
 * Atama verisi `hospitalDeviceAssignments` koleksiyonundaki `assignedStokKodlari`
 * alanında tutulur. Test maliyet motorundaki CAWC algoritması bu veriyi kullanır.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocs, onSnapshot, updateDoc, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import type { ProductCode, Hospital, Device, AssignedDevice, MinMaxRule } from '@/lib/types';
import { useIsMobile } from '@/components/maliyet-gozlem/useIsMobile';
import { ArrowLeft, ChevronsUpDown, Search, Check, X, Loader2, Package, Cpu, Trash2, Layers } from 'lucide-react';

const COLLECTION_ASSIGNMENTS = 'hospitalDeviceAssignments';

interface LabPickerProps {
  labs: Hospital[];
  selectedId: string | null;
  onChange: (id: string) => void;
}

function LabPicker({ labs, selectedId, onChange }: LabPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return labs;
    const s = q.toLowerCase();
    return labs.filter((l) => (l.name as string).toLowerCase().includes(s));
  }, [labs, q]);

  const selected = labs.find((l) => l.id === selectedId);

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 320 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: 12,
          background: 'var(--mg-surface)',
          border: '1px solid ' + (selected ? 'var(--mg-accent)' : 'var(--mg-border)'),
          color: 'var(--mg-text)',
          fontFamily: 'inherit',
          fontSize: 14,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Lab
          </span>
          <span>{selected ? selected.name : 'Laboratuvar seçin…'}</span>
        </span>
        <ChevronsUpDown size={14} style={{ color: 'var(--mg-muted)' }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'var(--mg-surface)',
            border: '1px solid var(--mg-border-strong)',
            borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            zIndex: 100,
            maxHeight: 360,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--mg-border)' }}>
            <Search size={14} style={{ color: 'var(--mg-muted)' }} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Lab ara…"
              style={{
                background: 'none',
                border: 'none',
                outline: 'none',
                flex: 1,
                color: 'var(--mg-text)',
                fontSize: 13,
                fontFamily: 'inherit',
                fontWeight: 500,
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', padding: 6 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--mg-muted)', fontSize: 12 }}>
                Lab bulunamadı
              </div>
            ) : (
              filtered.map((l) => {
                const isSel = l.id === selectedId;
                return (
                  <button
                    key={l.id}
                    onClick={() => {
                      onChange(l.id);
                      setOpen(false);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: isSel ? 'var(--mg-accent-soft)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--mg-text)',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    {isSel && <Check size={12} color="var(--mg-accent)" />}
                    <span>{l.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CihazTestDagilimiPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [labs, setLabs] = useState<Hospital[]>([]);
  const [selectedLabId, setSelectedLabId] = useState<string | null>(null);

  const [products, setProducts] = useState<ProductCode[]>([]);
  const [minMaxRules, setMinMaxRules] = useState<MinMaxRule[]>([]);
  const [devices, setDevices] = useState<Map<string, Device>>(new Map());
  const [assignedDevices, setAssignedDevices] = useState<AssignedDevice[]>([]);

  const [dragging, setDragging] = useState<string | null>(null); // stokKodu
  const [dropTarget, setDropTarget] = useState<string | null>(null); // assignedDevice id
  const [productSearch, setProductSearch] = useState('');

  // Master data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [labsSnap, productsSnap, devicesSnap] = await Promise.all([
          getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin, orderBy('name', 'asc'))),
          getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin, orderBy('stokAdi', 'asc'))),
          getDocs(scopedQuery('devices', currentCompanyId, isSuperAdmin)),
        ]);
        if (cancelled) return;
        setLabs(
          filterByCompanyScope(
            labsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)),
            currentCompanyId,
            isSuperAdmin,
          ),
        );
        setProducts(productsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ProductCode)));
        const devMap = new Map<string, Device>();
        devicesSnap.docs.forEach((d) => devMap.set(d.id, { id: d.id, ...d.data() } as Device));
        setDevices(devMap);
      } catch (e) {
        console.error('master data fetch', e);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast, currentCompanyId, isSuperAdmin]);

  // Lab değişince MinMax kuralları + atanmış cihazlar yenilenir
  useEffect(() => {
    if (!selectedLabId) {
      setMinMaxRules([]);
      setAssignedDevices([]);
      return;
    }

    const unsubRules = onSnapshot(
      collection(db, 'hospitals', selectedLabId, 'minMaxRules'),
      (snap) => {
        setMinMaxRules(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MinMaxRule & { id: string })));
      },
      (e) => console.error('minmax sub', e),
    );

    const unsubAssigned = onSnapshot(
      collection(db, COLLECTION_ASSIGNMENTS),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as AssignedDevice))
          .filter((d) => d.hastaneId === selectedLabId);
        setAssignedDevices(list);
      },
      (e) => console.error('assigned sub', e),
    );

    return () => {
      unsubRules();
      unsubAssigned();
    };
  }, [selectedLabId]);

  // MinMax kuralından ürünleri çıkar
  const labProducts = useMemo(() => {
    const codes = new Set(minMaxRules.map((r) => r.stokKodu).filter(Boolean));
    return products
      .filter((p) => codes.has(p.stokKodu))
      .filter((p) => {
        if (!productSearch.trim()) return true;
        const s = productSearch.toLowerCase();
        return (
          p.stokAdi.toLowerCase().includes(s) ||
          p.stokKodu.toLowerCase().includes(s) ||
          ((p.testAdi as string) || '').toLowerCase().includes(s)
        );
      })
      .sort((a, b) => a.stokAdi.localeCompare(b.stokAdi, 'tr'));
  }, [minMaxRules, products, productSearch]);

  // Drag-drop handlers
  const handleDragStart = (stokKodu: string) => (e: React.DragEvent) => {
    setDragging(stokKodu);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', stokKodu);
  };
  const handleDragOver = (deviceId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTarget(deviceId);
  };
  const handleDragLeave = () => setDropTarget(null);
  const handleDrop = (assignedDev: AssignedDevice) => async (e: React.DragEvent) => {
    e.preventDefault();
    const stokKodu = e.dataTransfer.getData('text/plain') || dragging;
    setDropTarget(null);
    setDragging(null);
    if (!stokKodu) return;

    const current: string[] = (assignedDev as any).assignedStokKodlari || [];
    if (current.includes(stokKodu)) {
      toast({ title: 'Zaten atalı', description: 'Bu ürün cihaza zaten atanmış.' });
      return;
    }
    try {
      await updateDoc(doc(db, COLLECTION_ASSIGNMENTS, assignedDev.id), {
        assignedStokKodlari: [...current, stokKodu],
      });
      toast({ title: 'Atandı', description: `${stokKodu} → ${assignedDev.name}` });
    } catch (err) {
      console.error('assignment update', err);
      toast({ title: 'Hata', description: 'Atama kaydedilemedi.', variant: 'destructive' });
    }
  };

  const removeAssignment = async (assignedDev: AssignedDevice, stokKodu: string) => {
    const current: string[] = (assignedDev as any).assignedStokKodlari || [];
    try {
      await updateDoc(doc(db, COLLECTION_ASSIGNMENTS, assignedDev.id), {
        assignedStokKodlari: current.filter((k) => k !== stokKodu),
      });
    } catch (err) {
      console.error('removeAssignment', err);
      toast({ title: 'Hata', description: 'Atama kaldırılamadı.', variant: 'destructive' });
    }
  };

  // Cihaz başına atama yüküne göre özet
  const totalAssignments = assignedDevices.reduce((s, d) => s + (((d as any).assignedStokKodlari as string[] | undefined)?.length || 0), 0);

  return (
    <div
      className="mg-root"
      style={{
        minHeight: '100vh',
        padding: isMobile ? '12px 12px 24px' : '20px 24px 32px',
        background: `radial-gradient(ellipse at 0% 0%, rgba(251,146,60,0.06) 0%, transparent 50%),
                     radial-gradient(ellipse at 100% 100%, rgba(167,139,250,0.04) 0%, transparent 50%),
                     var(--mg-bg)`,
        color: 'var(--mg-text)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Üst başlık + geri butonu + lab seçici */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => router.back()}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'var(--mg-surface)',
            border: '1px solid var(--mg-border)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--mg-text-2)',
          }}
        >
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1 }}>
            Cihaz Test Dağılımı
          </h1>
          <p style={{ fontSize: 12, color: 'var(--mg-muted)', margin: '4px 0 0', fontWeight: 500 }}>
            Lab'a tanımlı ürünleri cihazlara sürükle-bırak ile atayın. CAWC algoritması bu atamayı maliyet hesabında kullanır.
          </p>
        </div>
        <LabPicker labs={labs} selectedId={selectedLabId} onChange={setSelectedLabId} />
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--mg-muted)' }}>
          <Loader2 size={28} className="animate-spin" style={{ display: 'inline-block', marginBottom: 12 }} />
          <div style={{ fontSize: 13 }}>Yükleniyor…</div>
        </div>
      ) : !selectedLabId ? (
        <div
          style={{
            padding: 60,
            textAlign: 'center',
            background: 'var(--mg-surface)',
            border: '1px solid var(--mg-border)',
            borderRadius: 18,
            color: 'var(--mg-muted)',
          }}
        >
          <Layers size={32} style={{ display: 'inline-block', marginBottom: 12, opacity: 0.5 }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>Bir laboratuvar seçin</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Cihaz dağılımını görüntülemek için üstteki "Lab" seçiciden bir laboratuvar seçin.
          </div>
        </div>
      ) : (
        <>
          {/* Özet rozetler */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Pill label="Ürün" value={labProducts.length} />
            <Pill label="Cihaz" value={assignedDevices.length} />
            <Pill label="Atama" value={totalAssignments} accent />
          </div>

          {/* Ana 2 sütun: ürünler | cihazlar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(0, 1.6fr)',
              gap: 16,
            }}
          >
            {/* Sol: Ürün listesi */}
            <div
              style={{
                background: 'var(--mg-surface)',
                border: '1px solid var(--mg-border)',
                borderRadius: 18,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                maxHeight: isMobile ? 360 : 680,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Package size={14} style={{ color: 'var(--mg-accent)' }} />
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Ürünler
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: 6,
                    background: 'var(--mg-surface-2)',
                    color: 'var(--mg-muted)',
                  }}
                >
                  {labProducts.length}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  background: 'var(--mg-surface-2)',
                  border: '1px solid var(--mg-border)',
                  borderRadius: 10,
                }}
              >
                <Search size={13} style={{ color: 'var(--mg-muted)' }} />
                <input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Ürün ara…"
                  style={{
                    background: 'none',
                    border: 'none',
                    outline: 'none',
                    flex: 1,
                    color: 'var(--mg-text)',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    fontWeight: 500,
                  }}
                />
              </div>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
                {labProducts.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--mg-muted)', fontSize: 12 }}>
                    Bu lab'a MinMax tanımlı ürün yok.
                  </div>
                ) : (
                  labProducts.map((p) => (
                    <div
                      key={p.stokKodu}
                      draggable
                      onDragStart={handleDragStart(p.stokKodu)}
                      onDragEnd={() => setDragging(null)}
                      style={{
                        padding: '8px 12px',
                        background: dragging === p.stokKodu ? 'var(--mg-accent-soft)' : 'var(--mg-surface-2)',
                        border: '1px solid ' + (dragging === p.stokKodu ? 'var(--mg-accent)' : 'var(--mg-border)'),
                        borderRadius: 10,
                        cursor: 'grab',
                        userSelect: 'none',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mg-text)' }}>{p.stokAdi}</div>
                      <div style={{ fontSize: 10, color: 'var(--mg-muted)', marginTop: 2, fontFamily: 'monospace' }}>
                        {p.stokKodu}
                        {p.marka && <span> · {String(p.marka)}</span>}
                        {p.testAdi && <span> · {String(p.testAdi)}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Sağ: Cihaz kartları (drop target) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Cpu size={14} style={{ color: 'var(--mg-accent)' }} />
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Cihazlar
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: 6,
                    background: 'var(--mg-surface-2)',
                    color: 'var(--mg-muted)',
                  }}
                >
                  {assignedDevices.length} cihaz
                </span>
              </div>

              {assignedDevices.length === 0 ? (
                <div
                  style={{
                    padding: 40,
                    textAlign: 'center',
                    background: 'var(--mg-surface)',
                    border: '1px dashed var(--mg-border-strong)',
                    borderRadius: 18,
                    color: 'var(--mg-muted)',
                    fontSize: 13,
                  }}
                >
                  Bu lab'a atanmış cihaz yok.
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 12,
                  }}
                >
                  {assignedDevices.map((ad) => {
                    const def = devices.get(ad.deviceId) || devices.get(ad.cihazId);
                    const isTarget = dropTarget === ad.id;
                    const assigned: string[] = (ad as any).assignedStokKodlari || [];
                    const tph = Number(def?.testKapasiteSaatBasi) || 0;
                    return (
                      <div
                        key={ad.id}
                        onDragOver={handleDragOver(ad.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop(ad)}
                        style={{
                          background: isTarget ? 'var(--mg-accent-soft)' : 'var(--mg-surface)',
                          border: '1px solid ' + (isTarget ? 'var(--mg-accent)' : 'var(--mg-border)'),
                          borderRadius: 16,
                          padding: 14,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                          transition: 'all 0.15s',
                          minHeight: 200,
                        }}
                      >
                        {/* Cihaz başlığı + görsel */}
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          {def?.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={def.imageUrl}
                              alt={`${def.brand} ${def.model}`}
                              style={{
                                width: 48,
                                height: 48,
                                borderRadius: 10,
                                objectFit: 'cover',
                                background: 'var(--mg-surface-2)',
                                border: '1px solid var(--mg-border)',
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 48,
                                height: 48,
                                borderRadius: 10,
                                background: 'var(--mg-surface-2)',
                                border: '1px solid var(--mg-border)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--mg-muted)',
                                flexShrink: 0,
                              }}
                            >
                              <Cpu size={20} />
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mg-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {def ? `${def.brand} ${def.model}` : ad.name}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--mg-muted)', marginTop: 2 }}>
                              {ad.serial ? `Seri: ${ad.serial}` : ad.cihazId}
                              {tph > 0 && <span> · {tph} test/saat</span>}
                            </div>
                          </div>
                        </div>

                        {/* Atanmış ürün chip'leri */}
                        <div
                          style={{
                            flex: 1,
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 4,
                            alignContent: 'flex-start',
                            minHeight: 60,
                            padding: 8,
                            background: 'var(--mg-surface-2)',
                            border: '1px dashed ' + (isTarget ? 'var(--mg-accent)' : 'var(--mg-border)'),
                            borderRadius: 10,
                          }}
                        >
                          {assigned.length === 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--mg-muted)', fontStyle: 'italic', width: '100%', textAlign: 'center', padding: '12px 0' }}>
                              Ürün sürükleyip bırakın
                            </div>
                          ) : (
                            assigned.map((kodu) => {
                              const prod = products.find((p) => p.stokKodu === kodu);
                              return (
                                <div
                                  key={kodu}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '4px 4px 4px 8px',
                                    background: 'var(--mg-surface)',
                                    border: '1px solid var(--mg-border)',
                                    borderRadius: 100,
                                    fontSize: 11,
                                  }}
                                >
                                  <span style={{ color: 'var(--mg-text)', fontWeight: 600 }}>{prod?.stokAdi || kodu}</span>
                                  <button
                                    onClick={() => removeAssignment(ad, kodu)}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      color: 'var(--mg-muted)',
                                      width: 18,
                                      height: 18,
                                      borderRadius: '50%',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    }}
                                    aria-label={`${kodu} kaldır`}
                                  >
                                    <X size={11} />
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* Footer KPI'lar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--mg-muted)' }}>
                          <span>
                            <b style={{ color: 'var(--mg-text)' }}>{assigned.length}</b> ürün atalı
                          </span>
                          {tph > 0 && (
                            <span>
                              Kapasite: <b style={{ color: 'var(--mg-text)' }}>{tph}</b> t/sa
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Pill({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        background: accent ? 'var(--mg-accent-soft)' : 'var(--mg-surface-2)',
        border: '1px solid ' + (accent ? 'rgba(251,146,60,0.3)' : 'var(--mg-border)'),
        borderRadius: 100,
        fontSize: 12,
        fontWeight: 600,
        color: accent ? 'var(--mg-accent)' : 'var(--mg-text-2)',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--mg-muted)' }}>
        {label}
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{value}</span>
    </div>
  );
}
