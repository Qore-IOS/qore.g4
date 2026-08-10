/**
 * @fileoverview Terminal — Sipariş Toplama.
 *
 * KAPSAM: Seri numaralı kalemlerin okutularak siparişin karşılanması.
 * Web toplama ekranındaki gerekçeli FEFO aşımı, kurum bazlı özel ürün
 * sıralaması ve iki adımlı doğrulama BİLEREK dışarıda bırakıldı — terminal
 * "listeyi gör, rafa git, okut, bitir" işini yapar.
 *
 * FEFO burada bir ÖNERİDİR, engel değil: liste miadı en yakın lotu gösterir
 * ama kullanıcı başka bir kutu okutursa kabul edilir. Depoda fiziksel
 * gerçeklik önce gelir; hangi lotun alındığı zaten seri numarasıyla kayda
 * geçer.
 *
 * Yazma yolu ORTAK: stok hareketi `applyTransferItemWrites`, siparişin
 * kapanışı `applyOrderCompletionWrite` ile yapılır — web ekranıyla aynı
 * belgeler ve aynı kapanış kuralı.
 */

'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Check, Trash2 } from 'lucide-react';

import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import useHidScanner from '@/hooks/useHidScanner';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import {
  useHospitals,
  useProductCodes,
  useUnshippedDepoStokByDepot,
  useInvalidateQueries,
  touchStockMetadata,
} from '@/hooks/useFirebaseQueries';
import { useTerminalDepot } from '@/hooks/useTerminalDepot';
import { useDepots } from '@/hooks/useFirebaseQueries';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { playFeedback } from '@/lib/utils';
import { withCompanyScope } from '@/lib/company-scope';
import { queueWrite } from '@/lib/offline-write';
import { appendSerialEvents } from '@/lib/serial-ledger/client';
import type { SerialEventInput } from '@/lib/serial-ledger/core';
import {
  applyTransferItemWrites,
  buildTransferHeader,
  type TransferWriteContext,
} from '@/lib/direkt-transfer/write';
import { applyOrderCompletionWrite, buildPickingList } from '@/lib/siparisler/write';
import { getStockItemQuantity } from '@/lib/stock-quantity';
import type { DepoStokItem, Order } from '@/lib/types';
import {
  ScanFeedbackBar,
  TerminalButton,
  TerminalShell,
  TerminalStat,
  type ScanFeedback,
} from '@/components/terminal/shell';

const IDLE: ScanFeedback = {
  tone: 'idle',
  title: 'Okutmaya hazır',
  detail: 'Listedeki ürünleri okutun.',
};

function TerminalToplamaScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams?.get('order') || '';

  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId } = useAuth();
  const { data: depots = [] } = useDepots();
  const { data: hospitals = [] } = useHospitals();
  const { data: productCodes = [] } = useProductCodes();
  const { formats, parseAndResolveBarcode } = useBarcodeParser();
  const { invalidateDepoStok } = useInvalidateQueries();

  const [depotId] = useTerminalDepot();
  const { data: depotStock = [] } = useUnshippedDepoStokByDepot(depotId || null);

  const [order, setOrder] = useState<Order | null>(null);
  const [orderMissing, setOrderMissing] = useState(false);
  const [picked, setPicked] = useState<DepoStokItem[]>([]);
  const [feedback, setFeedback] = useState<ScanFeedback>(IDLE);

  const pickedIds = useRef<Set<string>>(new Set());

  const sourceDepots = useMemo(
    () => filterOperationalSourceDepots(depots, currentUserProfile),
    [depots, currentUserProfile],
  );
  const depotName = sourceDepots.find(d => d.id === depotId)?.name || '';

  // Sipariş canlı dinlenir: başka bir kullanıcı aynı siparişi kapatırsa
  // terminal bunu görür ve boşuna toplamaya devam edilmez.
  useEffect(() => {
    if (!orderId) return;
    const unsubscribe = onSnapshot(
      doc(db, 'orders', orderId),
      snap => {
        if (!snap.exists()) {
          setOrder(null);
          setOrderMissing(true);
          return;
        }
        setOrder({ id: snap.id, ...snap.data() } as Order);
        setOrderMissing(false);
      },
      () => setOrderMissing(true),
    );
    return () => unsubscribe();
  }, [orderId]);

  const targetLab = useMemo(() => {
    if (!order) return undefined;
    return order.labId
      ? hospitals.find(h => h.id === order.labId)
      : hospitals.find(h => h.name === order.kurumAdi);
  }, [order, hospitals]);

  const pickingList = useMemo(
    () => (order ? buildPickingList(order, depotStock, productCodes) : []),
    [order, depotStock, productCodes],
  );

  /** Ürün kodu → okutularak toplanan adet. */
  const pickedByCode = useMemo(() => {
    const map: Record<string, number> = {};
    picked.forEach(item => {
      const code = item.stokKodu || '';
      map[code] = (map[code] || 0) + getStockItemQuantity(item);
    });
    return map;
  }, [picked]);

  const stockBySerial = useMemo(() => {
    const index = new Map<string, DepoStokItem>();
    depotStock.forEach(item => {
      if (item.seriNumarasi) index.set(`${item.stokKodu}||${item.seriNumarasi}`, item);
    });
    return index;
  }, [depotStock]);

  const handleScan = useCallback(
    ({ raw }: { raw: string }) => {
      const code = raw.trim();
      if (!code || !order) return;

      const hit = parseAndResolveBarcode(code, formats, productCodes);
      const product = hit?.product;
      const serial = (hit?.parsed.seriNumarasi || '').trim();

      if (!product || !serial) {
        setFeedback({ tone: 'error', title: 'Ürün tanınmadı', detail: `Barkod: ${code.slice(0, 40)}` });
        playFeedback(true);
        return;
      }

      const match = stockBySerial.get(`${product.stokKodu}||${serial}`);
      if (!match) {
        setFeedback({
          tone: 'error',
          title: 'Bu ürün bu depoda değil',
          detail: `${product.stokAdi} · Seri ${serial}`,
        });
        playFeedback(true);
        return;
      }

      if (pickedIds.current.has(match.id)) {
        setFeedback({ tone: 'warning', title: 'Bu kalem zaten toplandı', detail: `Seri ${serial}` });
        playFeedback(true);
        return;
      }

      // Siparişte olmayan bir ürün okutulursa UYARILIR ama engellenmez:
      // depoda sipariş dışı bir kalemi de aynı sevkiyata koymak yaygın bir
      // ihtiyaç ve kullanıcı ne yaptığını görüyor.
      const inOrder = pickingList.some(row => row.stokKodu === product.stokKodu);

      pickedIds.current.add(match.id);
      setPicked(prev => [match, ...prev]);
      setFeedback({
        tone: inOrder ? 'success' : 'warning',
        title: match.stokAdi,
        detail: inOrder
          ? `Seri ${serial}${match.rafAdresi ? ` · Raf ${match.rafAdresi}` : ''}`
          : `Seri ${serial} · Bu ürün siparişte yok, yine de eklendi`,
      });
      playFeedback(!inOrder);
    },
    [order, parseAndResolveBarcode, formats, productCodes, stockBySerial, pickingList],
  );

  useHidScanner({ onScan: handleScan });

  const removePicked = (id: string) => {
    pickedIds.current.delete(id);
    setPicked(prev => prev.filter(i => i.id !== id));
  };

  /** Toplananları sevk et — beklemeden. */
  const handleComplete = () => {
    if (!order || picked.length === 0 || !depotId || !currentUser) return;

    const transferRef = doc(collection(db, 'transfers'));
    const ctx: TransferWriteContext = {
      transferRef,
      sourceDepotId: depotId,
      sourceDepotName: depotName,
      targetHospitalId: order.labId || targetLab?.id || null,
      targetName: order.kurumAdi,
      isBorcMode: false,
      trackingDisabled: targetLab?.consumptionTrackingEnabled === false,
      actorUid: currentUser.uid ?? null,
      actorName: currentUserProfile?.name ?? currentUser.email ?? null,
      orderId: order.id,
      productMetaByCode: new Map(
        productCodes.map(p => [
          p.stokKodu,
          { anaBirim: (p as { anaBirim?: string }).anaBirim, ambalajDegeri: p.ambalajDegeri ?? null },
        ]),
      ),
    };

    let batch;
    const ledgerEvents: SerialEventInput[] = [];
    let totalShippedAdet = 0;
    let complete = false;

    try {
      batch = writeBatch(db);
      picked.forEach(item => {
        const result = applyTransferItemWrites(batch, item, ctx, currentCompanyId);
        ledgerEvents.push(...result.ledgerEvents);
        totalShippedAdet += result.transferQty;
      });

      batch.set(
        transferRef,
        withCompanyScope(buildTransferHeader(ctx, totalShippedAdet, serverTimestamp()), currentCompanyId),
      );

      complete = applyOrderCompletionWrite(batch, {
        order,
        shippedByCode: pickedByCode,
        actorUid: ctx.actorUid,
        actorName: ctx.actorName,
      });
    } catch (error) {
      toast({
        title: 'Sevkiyat hazırlanamadı',
        description: error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.',
        variant: 'destructive',
      });
      return;
    }

    queueWrite(batch.commit());
    void appendSerialEvents(ledgerEvents, currentCompanyId).catch(() => {});
    void touchStockMetadata();
    invalidateDepoStok();

    setPicked([]);
    pickedIds.current.clear();

    toast({
      title: complete ? 'Sipariş tamamlandı' : 'Kısmi sevkiyat kaydedildi',
      description: `${totalShippedAdet} adet ürün ${order.kurumAdi} kurumuna sevk edildi.`,
    });
    router.push('/terminal/siparisler');
  };

  const totalRequested = pickingList.reduce((n, row) => n + row.istenen, 0);

  if (!orderId || orderMissing) {
    return (
      <TerminalShell title="Sipariş Toplama" onBack={() => router.push('/terminal/siparisler')}>
        <div className="flex h-full items-center justify-center px-8 text-center text-muted-foreground">
          {orderMissing
            ? 'Bu sipariş artık açık değil — başka bir kullanıcı tamamlamış olabilir.'
            : 'Sipariş seçilmedi.'}
        </div>
      </TerminalShell>
    );
  }

  return (
    <TerminalShell
      title={order ? order.kurumAdi : 'Sipariş yükleniyor…'}
      subtitle={`${depotName || 'Depo seçilmedi'} · ${totalRequested} adet isteniyor`}
      onBack={() => router.push('/terminal/siparisler')}
      right={<TerminalStat label="Toplanan" value={picked.length} />}
    >
      <div className="grid h-full min-h-0 grid-cols-1 gap-4 p-6 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-4">
          <ScanFeedbackBar feedback={feedback} />

          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Toplama listesi</th>
                  <th className="px-4 py-3">Önerilen (FEFO)</th>
                  <th className="px-4 py-3 text-right">Durum</th>
                </tr>
              </thead>
              <tbody>
                {pickingList.map(row => {
                  const done = (pickedByCode[row.stokKodu] || 0);
                  const complete = done >= row.istenen;
                  return (
                    <tr key={row.stokKodu} className="border-t border-border">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{row.stokAdi}</div>
                        <div className="text-xs text-muted-foreground">{row.stokKodu}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>Lot {row.onerilenLot}</div>
                        <div className="text-xs">
                          Raf {row.onerilenRaf} · Miad {row.onerilenMiad}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={
                            complete
                              ? 'inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300'
                              : 'tabular-nums text-foreground'
                          }
                        >
                          {complete ? <Check className="h-4 w-4" /> : null}
                          {done} / {row.istenen}
                        </span>
                        {row.mevcut < row.istenen ? (
                          <div className="text-xs text-amber-700 dark:text-amber-300">
                            Depoda {row.mevcut} adet
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
            {picked.length === 0 ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                Okutulan kalemler burada görünecek.
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Okutulan</th>
                    <th className="px-4 py-3">Seri</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {picked.map(item => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{item.stokAdi}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.lotNumarasi ? `Lot ${item.lotNumarasi}` : '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-foreground/80">{item.seriNumarasi}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => removePicked(item.id)}
                          aria-label="Kalemi çıkar"
                          className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-4">
            <TerminalButton
              variant="ghost"
              onClick={() => {
                setPicked([]);
                pickedIds.current.clear();
                setFeedback(IDLE);
              }}
              disabled={picked.length === 0}
            >
              Listeyi temizle
            </TerminalButton>

            <TerminalButton onClick={handleComplete} disabled={picked.length === 0 || !order}>
              {`Sevk et (${picked.length})`}
            </TerminalButton>
          </div>
        </div>
      </div>
    </TerminalShell>
  );
}

/**
 * `useSearchParams()` kullanan bir sayfa Next.js'te Suspense sınırı ister;
 * aksi hâlde `next build` ön-render sırasında düşer. Statik terminal
 * paketinde bu sarmalayıcı zararsızdır.
 */
export default function TerminalToplamaPage() {
  return (
    <Suspense fallback={null}>
      <TerminalToplamaScreen />
    </Suspense>
  );
}
