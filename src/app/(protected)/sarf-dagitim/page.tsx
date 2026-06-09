'use client';

/* Hastane Sarf Dağıtım — sekmeli ana panel.
   Poliklinikler (mahaller) · Kabul Bekleyenler · Teslim Edilenler.
   Krem/bej claymorphism — demo sarf-app.jsx Home ekranının uygulama içi karşılığı. */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs, onSnapshot, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Hospital, SarfTransfer } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope } from '@/lib/company-scope';
import { useToast } from '@/hooks/use-toast';
import {
  SarfShell, SearchBox, TabBar, QrBox, Metric, SarfEmpty, SarfSuccessOverlay,
  capForIndex, sarfMono, SARF_AC,
} from '@/components/sarf/sarf-ui';
import { IconPackage, IconBuilding, IconChevron, IconQr } from '@/components/sarf/sarf-icons';
import { SarfTransferCard } from '@/components/sarf/SarfTransferCard';
import { SarfVerifySheet } from '@/components/sarf/SarfVerifySheet';
import {
  hospitalMahalKodu, matchesTransferCode, matchesMahal, confirmSarfDelivery,
  printSarfTransferLabel, formatSarfDate, toDateSafe,
} from '@/lib/sarf-transfer';

type SarfTabId = 'clinics' | 'pending' | 'delivered';

const initialTab = (): SarfTabId => {
  if (typeof window === 'undefined') return 'clinics';
  const t = new URLSearchParams(window.location.search).get('tab');
  return t === 'pending' || t === 'delivered' ? t : 'clinics';
};

/* ——— Poliklinik (mahal) kartı ——— */
const ClinicCard = ({
  clinic, cap, items, last, onClick,
}: {
  clinic: Hospital;
  cap: string;
  items: number;
  last: string;
  onClick: () => void;
}) => {
  const [p, setP] = useState(false);
  const mahal = hospitalMahalKodu(clinic);
  return (
    <button
      onClick={onClick}
      onMouseDown={() => setP(true)}
      onMouseUp={() => setP(false)}
      onMouseLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: 'pointer', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 16,
        padding: 20, borderRadius: 'var(--sarf-radius)',
        background: 'linear-gradient(180deg, var(--sarf-surface) 0%, var(--sarf-surface-2) 100%)',
        boxShadow: p ? 'var(--sarf-clay-press)' : 'var(--sarf-clay)',
        transition: 'transform 200ms cubic-bezier(.2,.7,.2,1.2), box-shadow 200ms ease',
        transform: p ? 'translateY(2px) scale(0.99)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%' }}>
        <div style={{ width: 56, height: 56, flexShrink: 0 }}><IconBuilding /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--sarf-ink-1)', letterSpacing: '-0.01em', lineHeight: 1.15 }}>{clinic.name}</div>
          <div style={{ fontSize: 13, color: 'var(--sarf-ink-2)', fontWeight: 600, fontFamily: sarfMono, marginTop: 3 }}>{mahal || 'Mahal kodu tanımsız'}</div>
        </div>
        <span style={{ color: 'var(--sarf-ink-3)', display: 'inline-flex' }}><IconChevron /></span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%' }}>
        <QrBox value={mahal} size={92} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
            padding: '6px 12px', borderRadius: 'var(--sarf-radius-pill)',
            background: 'var(--sarf-surface-2)', boxShadow: 'var(--sarf-clay-inset)',
            fontSize: 12, fontWeight: 700, color: SARF_AC.primary,
          }}>
            <IconQr /> Mahal QR
          </span>
          <Metric label="Tanımlı ürün" value={items} cap={cap} />
          <Metric label="Son transfer" value={last} mono />
        </div>
      </div>
    </button>
  );
};

export default function SarfDagitimPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  const [tab, setTab] = useState<SarfTabId>(initialTab);
  const [q, setQ] = useState('');
  const [labs, setLabs] = useState<Hospital[]>([]);
  const [ruleCounts, setRuleCounts] = useState<Record<string, number>>({});
  const [transfers, setTransfers] = useState<SarfTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyTr, setVerifyTr] = useState<SarfTransfer | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [successCode, setSuccessCode] = useState<string | null>(null);

  /* Hastane Sarf labları + tanımlı ürün sayıları */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin, where('isConsumablesHospital', '==', true)));
        const list = filterByCompanyScope(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)),
          currentCompanyId,
          isSuperAdmin,
        ).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
        if (!alive) return;
        setLabs(list);

        const counts: Record<string, number> = {};
        await Promise.all(list.filter((l) => l.id).map(async (lab) => {
          try {
            const rules = await getDocs(collection(db, 'hospitals', lab.id, 'minMaxRules'));
            counts[lab.id] = rules.size;
          } catch {
            counts[lab.id] = 0;
          }
        }));
        if (alive) setRuleCounts(counts);
      } catch (e) {
        console.error('Sarf labs fetch error:', e);
        toast({ title: 'Hata', description: 'Poliklinikler yüklenemedi.', variant: 'destructive' });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [currentCompanyId, isSuperAdmin, toast]);

  /* Transferler — canlı dinleme (sıralı sorgu indeks beklerken sırasıza düşer) */
  useEffect(() => {
    const sortDesc = (arr: SarfTransfer[]) =>
      [...arr].sort((a, b) => (toDateSafe(b.createdAt)?.getTime() || 0) - (toDateSafe(a.createdAt)?.getTime() || 0));

    let unsubFallback: (() => void) | null = null;
    const unsub = onSnapshot(
      scopedQuery('sarfTransfers', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc')),
      (snap) => setTransfers(sortDesc(snap.docs.map((d) => ({ ...d.data(), id: d.id } as SarfTransfer)))),
      (err) => {
        console.warn('sarfTransfers ordered listen failed, falling back:', err?.message);
        unsubFallback = onSnapshot(
          scopedQuery('sarfTransfers', currentCompanyId, isSuperAdmin),
          (snap) => setTransfers(sortDesc(snap.docs.map((d) => ({ ...d.data(), id: d.id } as SarfTransfer)))),
        );
      },
    );
    return () => { unsub(); unsubFallback?.(); };
  }, [currentCompanyId, isSuperAdmin]);

  const lastTransferByLab = useMemo(() => {
    const map: Record<string, string> = {};
    for (const tr of transfers) {
      if (tr.hospitalId && !map[tr.hospitalId]) map[tr.hospitalId] = formatSarfDate(tr.createdAt);
    }
    return map;
  }, [transfers]);

  const filteredLabs = useMemo(() => {
    if (!q) return labs;
    const lower = q.toLowerCase();
    return labs.filter((l) =>
      (l.name || '').toLowerCase().includes(lower) || hospitalMahalKodu(l).toLowerCase().includes(lower));
  }, [labs, q]);

  const filterTransfers = useCallback((status: 'pending' | 'delivered') => {
    const lower = q.toLowerCase();
    return transfers.filter((t) => t.status === status && (
      !q ||
      t.code.toLowerCase().includes(lower) ||
      (t.mahalKodu || '').toLowerCase().includes(lower) ||
      (t.kurumAdi || '').toLowerCase().includes(lower)
    ));
  }, [transfers, q]);

  const pendingList = useMemo(() => filterTransfers('pending'), [filterTransfers]);
  const deliveredList = useMemo(() => filterTransfers('delivered'), [filterTransfers]);
  const pendingCount = useMemo(() => transfers.filter((t) => t.status === 'pending').length, [transfers]);
  const deliveredCount = useMemo(() => transfers.filter((t) => t.status === 'delivered').length, [transfers]);

  const handleConfirmDelivery = async () => {
    if (!verifyTr || verifying) return;
    setVerifying(true);
    try {
      await confirmSarfDelivery({
        transfer: verifyTr,
        companyId: currentCompanyId,
        isSuperAdmin,
        user: { uid: currentUser?.uid, name: currentUserProfile?.name || currentUser?.email },
      });
      setVerifyTr(null);
      setTab('delivered');
      setSuccessCode(verifyTr.code);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Teslimat tamamlanırken bir sorun oluştu.';
      toast({ title: 'Teslimat Tamamlanamadı', description: msg, variant: 'destructive' });
    } finally {
      setVerifying(false);
    }
  };

  const placeholder = tab === 'clinics' ? 'Poliklinik veya mahal kodu ara…' : 'Transfer ID, mahal veya poliklinik ara…';

  return (
    <SarfShell>
      <div style={{ animation: 'sarfPopIn 360ms ease' }}>
        {/* hero */}
        <section style={{
          position: 'relative', overflow: 'hidden',
          padding: '28px 30px', marginBottom: 22, borderRadius: 'var(--sarf-radius-lg)',
          background: 'linear-gradient(180deg, var(--sarf-surface) 0%, var(--sarf-surface-2) 100%)',
          boxShadow: 'var(--sarf-clay)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ width: 58, height: 58 }}><IconPackage /></div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--sarf-ink-1)' }}>
                Hastane Sarf Dağıtım
              </h1>
              <p style={{ margin: '6px 0 0', fontSize: 15, color: 'var(--sarf-ink-2)', fontWeight: 500 }}>
                Poliklinige transfer oluştur, kabul bekleyenleri QR ile takip et, teslimatı doğrula.
              </p>
            </div>
            <div style={{ minWidth: 280, flex: '0 1 360px' }}>
              <SearchBox value={q} onChange={setQ} placeholder={placeholder} />
            </div>
          </div>
        </section>

        <TabBar
          tabs={[
            { id: 'clinics', label: 'Poliklinikler' },
            { id: 'pending', label: 'Kabul Bekleyenler', count: pendingCount, dot: SARF_AC.primary },
            { id: 'delivered', label: 'Teslim Edilenler', count: deliveredCount, dot: 'var(--sarf-sage)' },
          ]}
          tab={tab}
          setTab={(v) => { setTab(v as SarfTabId); setQ(''); }}
        />

        {/* sekme içeriği */}
        {tab === 'clinics' && (
          loading ? (
            <SarfEmpty icon={<IconBuilding />} text="Poliklinikler yükleniyor…" />
          ) : (
            <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {filteredLabs.filter((l) => l.id).map((lab, i) => (
                <ClinicCard
                  key={lab.id}
                  clinic={lab}
                  cap={capForIndex(i)}
                  items={ruleCounts[lab.id] ?? 0}
                  last={lastTransferByLab[lab.id] || '—'}
                  onClick={() => router.push(`/sarf-dagitim/${lab.id}`)}
                />
              ))}
              {filteredLabs.length === 0 && (
                <div style={{ gridColumn: '1 / -1', padding: 40, textAlign: 'center', color: 'var(--sarf-ink-3)', fontStyle: 'italic' }}>
                  {q ? 'Eşleşen poliklinik bulunamadı.' : '"Hastane Sarf" olarak işaretlenmiş laboratuvar bulunamadı.'}
                </div>
              )}
            </div>
          )
        )}

        {tab === 'pending' && (
          pendingList.length === 0 ? (
            <SarfEmpty icon={<IconPackage />} text="Kabul bekleyen transfer yok." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'sarfPopIn 320ms ease' }}>
              {pendingList.map((tr) => (
                <SarfTransferCard
                  key={tr.id}
                  tr={tr}
                  actionLabel="Teslimatı Doğrula"
                  onAction={setVerifyTr}
                  onPrint={(t) => { printSarfTransferLabel(t).catch(() => toast({ title: 'Hata', description: 'Etiket oluşturulamadı.', variant: 'destructive' })); }}
                />
              ))}
            </div>
          )
        )}

        {tab === 'delivered' && (
          deliveredList.length === 0 ? (
            <SarfEmpty icon={<IconBuilding />} text="Henüz teslim edilen transfer yok." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'sarfPopIn 320ms ease' }}>
              {deliveredList.map((tr) => <SarfTransferCard key={tr.id} tr={tr} />)}
            </div>
          )
        )}
      </div>

      {/* teslimat doğrulama — 1) ID kodu 2) mahal kodu */}
      {verifyTr && (
        <SarfVerifySheet
          open={!!verifyTr}
          title="Teslimatı Doğrula"
          subtitle={<>{verifyTr.kurumAdi} · <span style={{ fontFamily: sarfMono }}>{verifyTr.code}</span></>}
          steps={[
            {
              label: 'ID Kodunu Okut',
              instruction: 'Teslimat üzerindeki QR’daki transfer ID kodunu okutun.',
              placeholder: 'TRF-XXXXX',
              validate: (text) => (matchesTransferCode(text, verifyTr) ? null : 'ID kodu bu transferle eşleşmiyor.'),
            },
            {
              label: 'Mahal Kodunu Okut',
              instruction: 'Ardından mahalin QR’ını okutarak teslimatı tamamlayın.',
              placeholder: 'Mahal kodu',
              validate: (text) => (matchesMahal(text, verifyTr) ? null : 'Mahal kodu bu transferle eşleşmiyor.'),
            },
          ]}
          busy={verifying}
          onClose={() => setVerifyTr(null)}
          onComplete={handleConfirmDelivery}
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
