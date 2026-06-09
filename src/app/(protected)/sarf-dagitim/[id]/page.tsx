'use client';

/* Hastane Sarf Dağıtım — Ürün Transferi ekranı.
   Otomatik transfer listesinde tanımlı ürünler, tanımlanan adetlerle
   önceden doldurulmuş gelir; "Transfer Et" kabul bekleyen transfer oluşturur
   ve paket QR etiketi yazdırılır. Demo sarf-app.jsx ProductRequest karşılığı. */

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { collection, doc, getDoc, getDocs, onSnapshot, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { DepoStokItem, Depot, Hospital, MinMaxRule, ProductCode, SarfTransfer, SarfTransferItem } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope } from '@/lib/company-scope';
import { useToast } from '@/hooks/use-toast';
import {
  SarfShell, SoftBtn, SearchBox, QrBox, Stepper, sarfMono, SARF_AC, capForIndex,
} from '@/components/sarf/sarf-ui';
import { IconPackage, IconBuilding, IconBack, IconClipboard, TubeRack } from '@/components/sarf/sarf-icons';
import {
  createSarfTransfer, hospitalMahalKodu, printSarfTransferLabel, formatSarfDate, toDateSafe,
} from '@/lib/sarf-transfer';

const ROW_GRID = '64px minmax(0,2.4fr) 0.9fr 1fr 1.1fr 168px';

const nowLabel = () => {
  const d = new Date();
  const aylar = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())} ${aylar[d.getMonth()]} · ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* ——— Ürün satırı ——— */
const ProductRow = ({
  p, qty, setQty, cap, stock, last,
}: {
  p: ProductCode;
  qty: number;
  setQty: (v: number) => void;
  cap: string;
  stock: number;
  last: string;
}) => {
  const out = stock === 0;
  const active = qty > 0;
  return (
    <div className="sarf-product-row" style={{
      display: 'grid',
      gridTemplateColumns: ROW_GRID,
      gap: 16, alignItems: 'center',
      padding: '14px 24px', borderRadius: 'var(--sarf-radius)',
      background: active
        ? 'linear-gradient(180deg, var(--sarf-surface-hi) 0%, var(--sarf-surface-2) 100%)'
        : 'linear-gradient(180deg, var(--sarf-surface) 0%, var(--sarf-surface-2) 100%)',
      boxShadow: active ? `var(--sarf-clay), 0 0 0 1.5px ${SARF_AC.primary}44` : 'var(--sarf-clay)',
      transition: 'box-shadow 220ms ease',
    }}>
      <div style={{ width: 52, height: 52 }}><TubeRack cap={cap} /></div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sarf-ink-1)', lineHeight: 1.25 }}>{p.stokAdi}</div>
        <div style={{ fontSize: 12.5, color: 'var(--sarf-ink-2)', fontFamily: sarfMono, marginTop: 3 }}>{p.stokKodu}</div>
      </div>

      <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: 'var(--sarf-ink-2)' }}>{p.anaBirim || 'Adet'}</div>

      <div style={{ textAlign: 'center' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '7px 13px', borderRadius: 'var(--sarf-radius-pill)',
          background: out ? 'rgba(210,96,78,0.10)' : 'var(--sarf-surface-2)',
          boxShadow: out ? 'none' : 'var(--sarf-clay-inset)',
          fontSize: 14, fontWeight: 700,
          color: out ? 'var(--sarf-danger)' : 'var(--sarf-ink-1)',
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: out ? 'var(--sarf-danger-2)' : 'var(--sarf-sage)', boxShadow: out ? 'none' : '0 0 6px var(--sarf-sage)' }} />
          {stock}
        </span>
      </div>

      <div style={{ textAlign: 'center', fontSize: 13.5, fontWeight: 600, color: 'var(--sarf-ink-2)', fontFamily: sarfMono }}>{last}</div>

      <Stepper value={qty} onChange={setQty} />
    </div>
  );
};

/* ——— Transfer Et butonu ——— */
const CreateBtn = ({ count, onClick, busy }: { count: number; onClick: () => void; busy: boolean }) => {
  const [p, setP] = useState(false);
  const disabled = count === 0 || busy;
  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseDown={() => !disabled && setP(true)}
      onMouseUp={() => setP(false)}
      onMouseLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer', boxSizing: 'border-box',
        display: 'inline-flex', alignItems: 'center', gap: 11,
        height: 52, padding: '0 24px', borderRadius: 'var(--sarf-radius-pill)',
        background: disabled && !busy ? 'var(--sarf-surface-2)' : `radial-gradient(130% 150% at 30% 20%, ${SARF_AC.accent} 0%, ${SARF_AC.primary} 75%)`,
        boxShadow: disabled && !busy
          ? 'var(--sarf-clay-inset)'
          : (p ? `inset 0 3px 7px rgba(120,80,40,0.35), 0 4px 10px -4px ${SARF_AC.glow}` : `inset 0 2px 2px rgba(255,255,255,0.45), inset 0 -6px 12px rgba(120,80,40,0.22), 0 14px 26px -8px ${SARF_AC.glow}`),
        color: disabled && !busy ? 'var(--sarf-ink-3)' : '#fff',
        fontWeight: 800, fontSize: 15, letterSpacing: '0.01em',
        transition: 'transform 160ms ease, box-shadow 160ms ease',
        transform: p ? 'translateY(1px) scale(0.99)' : 'none',
        opacity: busy ? 0.75 : 1,
      }}
    >
      <IconClipboard />
      {busy ? 'Oluşturuluyor…' : 'Transfer Et'}
      {count > 0 && !busy && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 26, height: 26, padding: '0 8px', borderRadius: 999,
          background: 'rgba(255,255,255,0.28)', fontSize: 13, fontWeight: 800,
        }}>{count}</span>
      )}
    </button>
  );
};

export default function SarfUrunTransferiPage() {
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();
  const hospitalId = (params?.id as string) ?? '';
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [rules, setRules] = useState<MinMaxRule[]>([]);
  const [allProducts, setAllProducts] = useState<ProductCode[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotStock, setDepotStock] = useState<DepoStokItem[]>([]);
  const [lastByProduct, setLastByProduct] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [qty, setQtyState] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!hospitalId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [hospitalSnap, productsSnap, rulesSnap, depotsSnap, transfersSnap] = await Promise.all([
          getDoc(doc(db, 'hospitals', hospitalId)),
          getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
          getDocs(collection(db, 'hospitals', hospitalId, 'minMaxRules')),
          getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('sarfTransfers', currentCompanyId, isSuperAdmin, where('hospitalId', '==', hospitalId))).catch(() => null),
        ]);
        if (!alive) return;

        if (hospitalSnap.exists()) {
          setHospital({ id: hospitalSnap.id, ...hospitalSnap.data() } as Hospital);
        } else {
          toast({ title: 'Hata', description: 'Laboratuvar bulunamadı.', variant: 'destructive' });
          router.push('/sarf-dagitim');
          return;
        }

        setAllProducts(productsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ProductCode)));
        setDepots(depotsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Depot)));

        const ruleList = rulesSnap.docs.map((d) => d.data() as MinMaxRule);
        setRules(ruleList);
        // Otomatik transfer adetleri önceden girili gelir
        const initialQty: Record<string, number> = {};
        ruleList.forEach((r) => {
          if (r.stokKodu) initialQty[r.stokKodu] = Math.max(0, Number(r.otomatikTransferAdedi) || 0);
        });
        setQtyState(initialQty);

        // Ürün bazında son transfer tarihi (bu mahale)
        if (transfersSnap) {
          const lastMap: Record<string, number> = {};
          transfersSnap.docs.forEach((d) => {
            const tr = d.data() as SarfTransfer;
            const at = toDateSafe(tr.createdAt)?.getTime() || 0;
            (tr.items || []).forEach((it) => {
              if (it.stokKodu && at > (lastMap[it.stokKodu] || 0)) lastMap[it.stokKodu] = at;
            });
          });
          const lastFmt: Record<string, string> = {};
          Object.entries(lastMap).forEach(([k, v]) => { lastFmt[k] = formatSarfDate(new Date(v)); });
          setLastByProduct(lastFmt);
        }
      } catch (e) {
        console.error('Sarf transfer detail fetch error:', e);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [hospitalId, currentCompanyId, isSuperAdmin, toast, router]);

  /* Depo adedi — labın varsayılan deposu tanımlıysa o depo, değilse tüm depolar */
  const depotId = hospital?.defaultDepotId || null;
  useEffect(() => {
    const constraints = [where('isShipped', '==', false), ...(depotId ? [where('depotId', '==', depotId)] : [])];
    const unsub = onSnapshot(
      scopedQuery('depoStok', currentCompanyId, isSuperAdmin, ...constraints),
      (snap) => {
        setDepotStock(filterByCompanyScope(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as DepoStokItem)),
          currentCompanyId,
          isSuperAdmin,
        ));
      },
      (err) => console.error('depoStok listen error:', err),
    );
    return () => unsub();
  }, [depotId, currentCompanyId, isSuperAdmin]);

  const stockByCode = useMemo(() => {
    const map: Record<string, number> = {};
    depotStock.forEach((s) => { if (s.stokKodu) map[s.stokKodu] = (map[s.stokKodu] || 0) + 1; });
    return map;
  }, [depotStock]);

  const listedProducts = useMemo(() => {
    const ruleCodes = new Set(rules.map((r) => r.stokKodu));
    return allProducts
      .filter((p) => p.stokKodu && ruleCodes.has(p.stokKodu))
      .sort((a, b) => (a.stokAdi || '').localeCompare(b.stokAdi || '', 'tr'));
  }, [rules, allProducts]);

  const filtered = useMemo(() => {
    if (!q) return listedProducts;
    const lower = q.toLowerCase();
    return listedProducts.filter((p) =>
      (p.stokAdi || '').toLowerCase().includes(lower) || (p.stokKodu || '').toLowerCase().includes(lower));
  }, [listedProducts, q]);

  const setQty = (code: string, v: number) => setQtyState((s) => ({ ...s, [code]: Math.max(0, v) }));
  const totalLines = useMemo(() => listedProducts.filter((p) => (qty[p.stokKodu!] || 0) > 0).length, [listedProducts, qty]);

  const mahal = hospitalMahalKodu(hospital);

  const handleTransfer = async () => {
    if (!hospital || submitting) return;
    if (!mahal) {
      toast({ title: 'Mahal Kodu Eksik', description: 'Bu laboratuvar için yönetim panelinden mahal kodu tanımlayın.', variant: 'destructive' });
      return;
    }
    const items: SarfTransferItem[] = listedProducts
      .filter((p) => (qty[p.stokKodu!] || 0) > 0)
      .map((p) => ({ stokKodu: p.stokKodu!, stokAdi: p.stokAdi || 'Bilinmeyen Ürün', adet: qty[p.stokKodu!] }));
    if (items.length === 0) {
      toast({ title: 'Uyarı', description: 'Transfer edilecek ürün bulunmuyor.' });
      return;
    }

    setSubmitting(true);
    try {
      const depot = depots.find((d) => d.id === hospital.defaultDepotId) || depots[0];
      const tr = await createSarfTransfer({
        hospital,
        items,
        depotId: depot?.id || null,
        depotName: depot?.name || null,
        companyId: currentCompanyId,
        user: { uid: currentUser?.uid, name: currentUserProfile?.name || currentUser?.email },
      });

      toast({ title: 'Transfer Oluşturuldu', description: `${hospital.name} için ${tr.code} kabul bekleyenlere eklendi.` });
      printSarfTransferLabel(tr).catch(() => { /* yazdırma engellendiyse karttan tekrar yazdırılabilir */ });
      router.push('/sarf-dagitim?tab=pending');
    } catch (e) {
      console.error('Transfer create error:', e);
      toast({ title: 'Hata', description: 'Transfer oluşturulurken bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SarfShell>
      <div style={{ animation: 'sarfPopIn 360ms ease' }}>
        {/* üst bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 4px', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <SoftBtn round aria="Geri" onClick={() => router.push('/sarf-dagitim')}>
              <IconBack />
            </SoftBtn>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--sarf-ink-2)' }}>
              <span style={{ width: 26, height: 26, color: SARF_AC.primary, display: 'inline-flex' }}><IconPackage /></span>
              QORE<span style={{ color: SARF_AC.primary, fontWeight: 700, fontStyle: 'italic' }}>stock</span>
            </div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sarf-ink-3)', fontFamily: sarfMono }}>
            {nowLabel()}
          </div>
        </div>

        {/* başlık kartı */}
        <section style={{
          padding: '24px 28px', marginBottom: 18, borderRadius: 'var(--sarf-radius-lg)',
          background: 'linear-gradient(180deg, var(--sarf-surface) 0%, var(--sarf-surface-2) 100%)',
          boxShadow: 'var(--sarf-clay)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ width: 54, height: 54 }}><IconBuilding /></div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h1 style={{ margin: 0, fontSize: 25, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--sarf-ink-1)' }}>
                {hospital?.name || '…'} <span style={{ color: 'var(--sarf-ink-3)', fontWeight: 700 }}>· Ürün Transferi</span>
              </h1>
              <p style={{ margin: '5px 0 0', fontSize: 14, color: 'var(--sarf-ink-2)', fontWeight: 500 }}>
                Min-Max tanımı olan ürünler için transfer adedi girin. Mahal:{' '}
                <strong style={{ fontFamily: sarfMono, color: 'var(--sarf-ink-1)' }}>{mahal || 'Tanımsız'}</strong>
              </p>
            </div>
            <QrBox value={mahal} size={78} />
          </div>

          <div style={{ display: 'flex', gap: 14, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <SearchBox value={q} onChange={setQ} placeholder="Ürün adı veya kodu ile ara…" />
            </div>
            <CreateBtn count={totalLines} onClick={handleTransfer} busy={submitting} />
          </div>
        </section>

        {/* sütun başlıkları */}
        <div className="sarf-col-head" style={{
          display: 'grid', gridTemplateColumns: ROW_GRID,
          gap: 16, alignItems: 'center', padding: '0 24px 12px',
        }}>
          {['', 'Ürün', 'Birim', 'Depo Adedi', 'Son Transfer', 'Transfer Adedi'].map((h, i) => (
            <div key={i} style={{ fontSize: 12, fontWeight: 700, color: 'var(--sarf-ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: i >= 2 ? 'center' : 'left' }}>{h}</div>
          ))}
        </div>

        {/* satırlar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--sarf-ink-3)', fontStyle: 'italic' }}>Yükleniyor…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--sarf-ink-3)', fontStyle: 'italic' }}>
              {q ? 'Eşleşen ürün bulunamadı.' : 'Bu poliklinik için otomatik transfer listesinde ürün tanımlı değil.'}
            </div>
          ) : filtered.map((p, i) => (
            <ProductRow
              key={p.id || p.stokKodu}
              p={p}
              cap={capForIndex(i)}
              qty={qty[p.stokKodu!] || 0}
              setQty={(v) => setQty(p.stokKodu!, v)}
              stock={stockByCode[p.stokKodu!] || 0}
              last={lastByProduct[p.stokKodu!] || '—'}
            />
          ))}
        </div>
      </div>
    </SarfShell>
  );
}
