'use client';

/* Sarf Teslimat — sarf dağıtım personelinin tek ekranı.
   Kabul bekleyen transferleri görür; büyük "Ürün Teslim Al" butonuyla
   kamera önizlemeli QR okutarak paketi üzerine alır, ardından (hemen ya da
   "Teslim Aldıklarım" sekmesinden "Teslim Et" ile) mahal QR'ını okutup
   teslimatı tamamlar. */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { onSnapshot } from 'firebase/firestore';
import type { SarfTransfer } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import {
  SarfShell, TabBar, SarfEmpty, SarfSuccessOverlay, SoftBtn, sarfMono, SARF_AC,
} from '@/components/sarf/sarf-ui';
import { IconPackage, IconQr, IconLogout } from '@/components/sarf/sarf-icons';
import { SarfTransferCard } from '@/components/sarf/SarfTransferCard';
import { SarfVerifySheet } from '@/components/sarf/SarfVerifySheet';
import {
  matchesTransferCode, matchesMahal, receiveSarfTransfer, confirmSarfDelivery, toDateSafe,
} from '@/lib/sarf-transfer';

type TeslimatTab = 'pending' | 'mine';

export default function SarfTeslimatPage() {
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin, logout } = useAuth();

  const [tab, setTab] = useState<TeslimatTab>('pending');
  const [transfers, setTransfers] = useState<SarfTransfer[]>([]);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [deliverTr, setDeliverTr] = useState<SarfTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [successCode, setSuccessCode] = useState<string | null>(null);
  const [bigPressed, setBigPressed] = useState(false);

  /* "Ürün Teslim Al" akışında 1. adımda eşleşen transfer */
  const receiveTrRef = useRef<SarfTransfer | null>(null);
  const [receiveTr, setReceiveTr] = useState<SarfTransfer | null>(null);

  useEffect(() => {
    const sortDesc = (arr: SarfTransfer[]) =>
      [...arr].sort((a, b) => (toDateSafe(b.createdAt)?.getTime() || 0) - (toDateSafe(a.createdAt)?.getTime() || 0));
    const unsub = onSnapshot(
      scopedQuery('sarfTransfers', currentCompanyId, isSuperAdmin),
      (snap) => setTransfers(sortDesc(snap.docs.map((d) => ({ ...d.data(), id: d.id } as SarfTransfer)))),
      (err) => console.error('sarfTransfers listen error:', err),
    );
    return () => unsub();
  }, [currentCompanyId, isSuperAdmin]);

  const pending = useMemo(() => transfers.filter((t) => t.status === 'pending'), [transfers]);
  const poolList = useMemo(() => pending.filter((t) => !t.receivedById || t.receivedById !== currentUser?.uid), [pending, currentUser?.uid]);
  const mineList = useMemo(() => pending.filter((t) => t.receivedById === currentUser?.uid), [pending, currentUser?.uid]);

  const userInfo = { uid: currentUser?.uid, name: currentUserProfile?.name || currentUser?.email };

  /* — Ürün Teslim Al: 1) paket QR (üzerine al) 2) mahal QR (teslimi bitir) — */
  const receiveSteps = [
    {
      label: 'Paket QR Okut',
      instruction: 'Ürün poşetindeki transfer QR kodunu okutarak paketi üzerinize alın.',
      placeholder: 'TRF-XXXXX',
      validate: (text: string) => {
        const found = pending.find((t) => matchesTransferCode(text, t));
        if (!found) return 'QR kodu kabul bekleyen bir transferle eşleşmiyor.';
        if (found.receivedById && found.receivedById !== currentUser?.uid) {
          return `Bu paket ${found.receivedBy || 'başka bir personel'} üzerinde.`;
        }
        receiveTrRef.current = found;
        setReceiveTr(found);
        return null;
      },
    },
    {
      label: 'Mahal Kodunu Okut',
      instruction: 'Teslim noktasındaki mahal QR kodunu okutarak teslimatı tamamlayın.',
      placeholder: 'Mahal kodu',
      validate: (text: string) => {
        const tr = receiveTrRef.current;
        if (!tr) return 'Önce paket QR kodunu okutun.';
        return matchesMahal(text, tr) ? null : 'Mahal kodu bu transferle eşleşmiyor.';
      },
    },
  ];

  const handleReceiveStepMatched = (stepIndex: number) => {
    const tr = receiveTrRef.current;
    if (stepIndex !== 0 || !tr) return;
    if (tr.receivedById === currentUser?.uid) return; // zaten üzerinde
    receiveSarfTransfer(tr.id, userInfo)
      .then(() => toast({ title: 'Paket Üzerinize Alındı', description: `${tr.code} · ${tr.kurumAdi}` }))
      .catch(() => toast({ title: 'Hata', description: 'Paket üzerinize alınamadı.', variant: 'destructive' }));
  };

  const completeDelivery = async (tr: SarfTransfer | null, closeFn: () => void) => {
    if (!tr || busy) return;
    setBusy(true);
    try {
      await confirmSarfDelivery({ transfer: tr, companyId: currentCompanyId, isSuperAdmin, user: userInfo });
      closeFn();
      setSuccessCode(tr.code);
      setTab('pending');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Teslimat tamamlanırken bir sorun oluştu.';
      toast({ title: 'Teslimat Tamamlanamadı', description: msg, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SarfShell maxWidth={1080}>
      <div style={{ animation: 'sarfPopIn 360ms ease' }}>
        {/* üst bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 4px', marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--sarf-ink-2)' }}>
            <span style={{ width: 26, height: 26, color: SARF_AC.primary, display: 'inline-flex' }}><IconPackage /></span>
            QORE<span style={{ color: SARF_AC.primary, fontWeight: 700, fontStyle: 'italic' }}>stock</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              padding: '8px 14px', borderRadius: 'var(--sarf-radius-pill)',
              background: 'var(--sarf-surface-2)', boxShadow: 'var(--sarf-clay-inset)',
              fontSize: 13, fontWeight: 700, color: 'var(--sarf-ink-2)',
            }}>{currentUserProfile?.name || currentUser?.email}</span>
            <SoftBtn round aria="Çıkış Yap" onClick={() => logout()}>
              <IconLogout />
            </SoftBtn>
          </div>
        </div>

        {/* hero + büyük teslim al butonu */}
        <section style={{
          padding: '28px 30px', marginBottom: 22, borderRadius: 'var(--sarf-radius-lg)',
          background: 'linear-gradient(180deg, var(--sarf-surface) 0%, var(--sarf-surface-2) 100%)',
          boxShadow: 'var(--sarf-clay)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ width: 58, height: 58 }}><IconPackage /></div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--sarf-ink-1)' }}>
                Sarf Teslimat
              </h1>
              <p style={{ margin: '6px 0 0', fontSize: 14.5, color: 'var(--sarf-ink-2)', fontWeight: 500 }}>
                Paket QR’ını okutup ürünü üzerine al, mahal QR’ı ile teslimatı tamamla.
              </p>
            </div>
          </div>

          <button
            onClick={() => { receiveTrRef.current = null; setReceiveTr(null); setReceiveOpen(true); }}
            onMouseDown={() => setBigPressed(true)}
            onMouseUp={() => setBigPressed(false)}
            onMouseLeave={() => setBigPressed(false)}
            style={{
              all: 'unset', cursor: 'pointer', boxSizing: 'border-box',
              marginTop: 22, width: '100%', height: 76,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
              borderRadius: 'var(--sarf-radius)',
              background: `radial-gradient(130% 150% at 30% 20%, ${SARF_AC.accent} 0%, ${SARF_AC.primary} 75%)`,
              boxShadow: bigPressed
                ? `inset 0 3px 7px rgba(120,80,40,0.35), 0 4px 10px -4px ${SARF_AC.glow}`
                : `inset 0 2px 2px rgba(255,255,255,0.45), inset 0 -8px 16px rgba(120,80,40,0.22), 0 18px 32px -10px ${SARF_AC.glow}`,
              color: '#fff', fontWeight: 800, fontSize: 19, letterSpacing: '0.01em',
              transition: 'transform 160ms ease, box-shadow 160ms ease',
              transform: bigPressed ? 'translateY(1px) scale(0.995)' : 'none',
            }}
          >
            <IconQr s={26} /> Ürün Teslim Al
          </button>
        </section>

        <TabBar
          tabs={[
            { id: 'pending', label: 'Kabul Bekleyenler', count: poolList.length, dot: SARF_AC.primary },
            { id: 'mine', label: 'Teslim Aldıklarım', count: mineList.length, dot: 'var(--sarf-sage)' },
          ]}
          tab={tab}
          setTab={(v) => setTab(v as TeslimatTab)}
        />

        {tab === 'pending' && (
          poolList.length === 0 ? (
            <SarfEmpty icon={<IconPackage />} text="Kabul bekleyen transfer yok." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'sarfPopIn 320ms ease' }}>
              {poolList.map((tr) => <SarfTransferCard key={tr.id} tr={tr} />)}
            </div>
          )
        )}

        {tab === 'mine' && (
          mineList.length === 0 ? (
            <SarfEmpty icon={<IconPackage />} text="Üzerinize aldığınız paket yok. Ürün Teslim Al ile paket QR’ı okutun." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'sarfPopIn 320ms ease' }}>
              {mineList.map((tr) => (
                <SarfTransferCard
                  key={tr.id}
                  tr={tr}
                  pendingLabel="Üzerimde"
                  actionLabel="Teslim Et"
                  onAction={setDeliverTr}
                />
              ))}
            </div>
          )
        )}
      </div>

      {/* Ürün Teslim Al — paket QR + mahal QR */}
      <SarfVerifySheet
        open={receiveOpen}
        title="Ürün Teslim Al"
        subtitle={receiveTr
          ? <>{receiveTr.kurumAdi} · <span style={{ fontFamily: sarfMono }}>{receiveTr.code}</span></>
          : 'Kabul bekleyen paketin QR kodunu okutun'}
        steps={receiveSteps}
        busy={busy}
        finishLabel="Teslimatı Tamamla"
        onClose={() => setReceiveOpen(false)}
        onStepMatched={handleReceiveStepMatched}
        onComplete={() => completeDelivery(receiveTrRef.current, () => setReceiveOpen(false))}
      />

      {/* Teslim Et — yalnızca mahal QR */}
      {deliverTr && (
        <SarfVerifySheet
          open={!!deliverTr}
          title="Teslim Et"
          subtitle={<>{deliverTr.kurumAdi} · <span style={{ fontFamily: sarfMono }}>{deliverTr.code}</span></>}
          steps={[{
            label: 'Mahal Kodunu Okut',
            instruction: 'Teslim noktasındaki mahal QR kodunu okutarak teslimatı tamamlayın.',
            placeholder: 'Mahal kodu',
            validate: (text: string) => (matchesMahal(text, deliverTr) ? null : 'Mahal kodu bu transferle eşleşmiyor.'),
          }]}
          busy={busy}
          finishLabel="Teslimatı Tamamla"
          onClose={() => setDeliverTr(null)}
          onComplete={() => completeDelivery(deliverTr, () => setDeliverTr(null))}
        />
      )}

      <SarfSuccessOverlay
        show={!!successCode}
        code={successCode}
        label="Teslimat Tamamlandı"
        onDone={() => setSuccessCode(null)}
      />
    </SarfShell>
  );
}
