/**
 * @fileoverview Terminal — Direkt Transfer (hızlı akış).
 *
 * KAPSAM: Depoda fiilen duran, seri numaralı kalemlerin laboratuvara sevki.
 * Borç deposu modu, lot/adet tahsisi (FEFO ile kısmi dağıtım), şablonlar ve
 * tutanak basımı BİLEREK dışarıda bırakıldı — bunlar web panelinde kalır.
 *
 * Yazma `@/lib/direkt-transfer/write` üzerinden yapılır; web paneliyle aynı
 * belgeler üretilir.
 */

'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { FileDown, Loader2, Trash2 } from 'lucide-react';

import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import useHidScanner from '@/hooks/useHidScanner';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import {
  useDepots,
  useHospitals,
  useProductCodes,
  useUnshippedDepoStokByDepot,
  useInvalidateQueries,
  touchStockMetadata,
} from '@/hooks/useFirebaseQueries';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { useTerminalDepot } from '@/hooks/useTerminalDepot';
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
import { getStockItemQuantity } from '@/lib/stock-quantity';
import type { DepoStokItem } from '@/lib/types';
// Tutanak, transfer geçmişi detay sayfasının kullandığı ÜRETİCİNİN AYNISIYLA
// oluşturulur — tasarım birebir aynı olsun diye ikinci bir şablon yazılmadı.
import { generateTransferTutanakPDF } from '@/components/exports/TransferTutanakPDFButton';
import {
  ScanFeedbackBar,
  TerminalButton,
  TerminalSelect,
  TerminalShell,
  TerminalStat,
  type ScanFeedback,
} from '@/components/terminal/shell';

const IDLE: ScanFeedback = {
  tone: 'idle',
  title: 'Okutmaya hazır',
  detail: 'Sevk edilecek ürünü okutun.',
};

/**
 * Tutanak için saklanan son transfer.
 *
 * Firestore'dan yeniden okumak yerine bellekte tutulur: transfer henüz
 * kuyrukta olabilir ve çevrimdışıyken sunucudan okunamaz. Tutanağın
 * çevrimdışı da basılabilmesi gerekir.
 */
type LastTransfer = {
  transferId: string;
  depotName: string;
  labName: string;
  at: Date;
  items: Array<{
    stokKodu: string;
    urun: string;
    lot?: string;
    miad?: string;
    adet: number;
    anaBirim?: string;
    ambalajDegeri?: number | null;
    seriNo?: string;
  }>;
};

export default function TerminalTransferPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId } = useAuth();
  const { data: depots = [] } = useDepots();
  const { data: hospitals = [] } = useHospitals();
  const { data: productCodes = [] } = useProductCodes();
  // Tipli ayrıştırma yolu — bkz. mal kabul ekranındaki not.
  const { formats, parseAndResolveBarcode } = useBarcodeParser();
  const { invalidateDepoStok } = useInvalidateQueries();

  const [depotId, setDepotId] = useTerminalDepot();
  const [labId, setLabId] = useState('');
  const [items, setItems] = useState<DepoStokItem[]>([]);
  const [feedback, setFeedback] = useState<ScanFeedback>(IDLE);
  const [lastTransfer, setLastTransfer] = useState<LastTransfer | null>(null);
  const [tutanakBusy, setTutanakBusy] = useState(false);


  const { data: depotStock = [], isPending: stockPending } = useUnshippedDepoStokByDepot(
    depotId || null,
  );

  const sourceDepots = useMemo(
    () => filterOperationalSourceDepots(depots, currentUserProfile),
    [depots, currentUserProfile],
  );
  const depotName = sourceDepots.find(d => d.id === depotId)?.name || '';
  const targetLab = hospitals.find(h => h.id === labId);

  /**
   * Depoda duran seri numaralarının dizini.
   *
   * Okutma anında Firestore'a sorgu ATILMAZ: depo stoğu zaten önbellekte ve
   * her okutmada ağ turu beklemek, saniyede birkaç kutu okutan bir kullanıcıyı
   * tamamen durdurur. Doğrulama yazma anında Firestore kuralları ve belge
   * durumu tarafından zaten yeniden yapılır.
   */
  const stockBySerial = useMemo(() => {
    const index = new Map<string, DepoStokItem>();
    depotStock.forEach(item => {
      if (item.seriNumarasi) index.set(`${item.stokKodu}||${item.seriNumarasi}`, item);
    });
    return index;
  }, [depotStock]);

  const pickedIds = useRef<Set<string>>(new Set());

  const handleScan = useCallback(
    ({ raw }: { raw: string }) => {
      const code = raw.trim();
      if (!code) return;

      if (!depotId || !labId) {
        setFeedback({
          tone: 'error',
          title: 'Kaynak ve hedef seçilmedi',
          detail: 'Önce depo ve laboratuvarı seçin.',
        });
        playFeedback(true);
        return;
      }

      const hit = parseAndResolveBarcode(code, formats, productCodes);
      const product = hit?.product;
      const serial = (hit?.parsed.seriNumarasi || '').trim();
      if (!product || !serial) {
        setFeedback({
          tone: 'error',
          title: 'Ürün tanınmadı',
          detail: `Barkod: ${code.slice(0, 40)}`,
        });
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
        setFeedback({
          tone: 'warning',
          title: 'Bu kalem zaten listede',
          detail: `${match.stokAdi} · Seri ${serial}`,
        });
        playFeedback(true);
        return;
      }
      pickedIds.current.add(match.id);

      setItems(prev => [match, ...prev]);
      setFeedback({
        tone: 'success',
        title: match.stokAdi,
        detail: `Seri ${serial}${match.rafAdresi ? ` · Raf ${match.rafAdresi}` : ''}`,
      });
      playFeedback();
    },
    [depotId, labId, parseAndResolveBarcode, formats, productCodes, stockBySerial],
  );

  useHidScanner({ onScan: handleScan });

  const removeItem = (id: string) => {
    pickedIds.current.delete(id);
    setItems(prev => prev.filter(i => i.id !== id));
  };

  /**
   * Transferi tamamla — BEKLEMEDEN.
   *
   * Liste anında temizlenir; Firestore yazımı yerel önbelleğe senkron
   * uygulandığı için veri o an doğrudur ve gönderim arka planda yürür.
   */
  const handleCommit = () => {
    if (items.length === 0 || !depotId || !labId || !currentUser) return;

    const transferRef = doc(collection(db, 'transfers'));
    const ctx: TransferWriteContext = {
      transferRef,
      sourceDepotId: depotId,
      sourceDepotName: depotName,
      targetHospitalId: labId,
      targetName: targetLab?.name || '',
      isBorcMode: false,
      trackingDisabled: targetLab?.consumptionTrackingEnabled === false,
      actorUid: currentUser.uid ?? null,
      actorName: currentUserProfile?.name ?? currentUser.email ?? null,
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

    try {
      batch = writeBatch(db);
      items.forEach(item => {
        const result = applyTransferItemWrites(batch, item, ctx, currentCompanyId);
        ledgerEvents.push(...result.ledgerEvents);
        totalShippedAdet += result.transferQty;
      });
      batch.set(
        transferRef,
        withCompanyScope(buildTransferHeader(ctx, totalShippedAdet, serverTimestamp()), currentCompanyId),
      );
    } catch (error) {
      // Yalnızca yazım HAZIRLANIRKEN oluşan hatalar (geçersiz veri gibi).
      // Ağ sorunları buraya düşmez; onlar kuyrukta bekler.
      toast({
        title: 'Transfer hazırlanamadı',
        description: error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.',
        variant: 'destructive',
      });
      setFeedback({ tone: 'error', title: 'Transfer hazırlanamadı', detail: 'Liste korundu.' });
      return;
    }

    // Tutanak için gereken her şey ŞİMDİ saklanır: liste birazdan
    // temizlenecek ve kullanıcı tutanağı sonradan indirmek isteyebilir.
    setLastTransfer({
      transferId: transferRef.id,
      depotName,
      labName: ctx.targetName,
      at: new Date(),
      items: items.map(item => ({
        stokKodu: item.stokKodu,
        urun: item.stokAdi,
        lot: item.lotNumarasi || '',
        miad: typeof item.miad === 'string' ? item.miad : '',
        // `getStockItemQuantity` gevşek tipli bir kayıttan okuduğu için
        // `unknown` dönebiliyor; tutanak satırı sayı bekler.
        adet: Number(item.transferAdet ?? getStockItemQuantity(item)) || 0,
        anaBirim: ctx.productMetaByCode?.get(item.stokKodu || '')?.anaBirim,
        ambalajDegeri: ctx.productMetaByCode?.get(item.stokKodu || '')?.ambalajDegeri ?? null,
        seriNo: item.seriNumarasi || '',
      })),
    });

    queueWrite(batch.commit());

    // Defter yazımı stok yazımından AYRI ve beklenmez; hata olsa bile
    // transfer geri alınmaz (ürünler gerçekten taşındı) ve defter yönetim
    // panelinden yeniden kurulabilir.
    void appendSerialEvents(ledgerEvents, currentCompanyId).catch(() => {});
    void touchStockMetadata();
    invalidateDepoStok();

    setItems([]);
    pickedIds.current.clear();
    setFeedback({
      tone: 'success',
      title: `${totalShippedAdet} adet sevk edildi`,
      detail: `Hedef: ${ctx.targetName} · Tutanak sağ üstten indirilebilir.`,
    });
    toast({
      title: 'Transfer tamamlandı',
      description: `${totalShippedAdet} adet ürün ${ctx.targetName} kurumuna transfer edildi.`,
    });
  };

  /**
   * Son transferin tutanağını indirir.
   *
   * Veri Firestore'dan DEĞİL, işlem anında saklanan bellekten gelir —
   * çevrimdışıyken de çalışması gerekir.
   */
  const handleDownloadTutanak = async () => {
    if (!lastTransfer || tutanakBusy) return;
    setTutanakBusy(true);
    try {
      await generateTransferTutanakPDF(
        {
          shipmentId: lastTransfer.transferId,
          depotName: lastTransfer.depotName,
          kurumAdi: lastTransfer.labName,
          tarih: lastTransfer.at.toLocaleDateString('tr-TR'),
          saat: lastTransfer.at.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          olusturan: currentUserProfile?.name || currentUser?.email || '',
        },
        lastTransfer.items,
      );
    } catch (error) {
      toast({
        title: 'Tutanak oluşturulamadı',
        description: error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setTutanakBusy(false);
    }
  };

  return (
    <TerminalShell
      title="Direkt Transfer"
      subtitle={depotName ? `${depotName} → ${targetLab?.name || 'hedef seçilmedi'}` : 'Depo seçilmedi'}
      onBack={() => router.push('/terminal')}
      right={
        <div className="flex items-center gap-3">
          {lastTransfer ? (
            <button
              type="button"
              onClick={handleDownloadTutanak}
              disabled={tutanakBusy}
              className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-5 py-3 text-left transition hover:bg-primary/20 disabled:opacity-60"
            >
              {tutanakBusy ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <FileDown className="h-5 w-5 text-primary" />
              )}
              <span>
                <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                  Son işlem
                </span>
                <span className="block text-sm font-semibold">Tutanağı indir</span>
              </span>
            </button>
          ) : null}
          <TerminalStat label="Kalem" value={items.length} />
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-4 p-6">
        <div className="grid shrink-0 grid-cols-1 gap-4 md:grid-cols-2">
          <TerminalSelect
            label="Kaynak depo"
            value={depotId}
            onChange={id => {
              setDepotId(id);
              setItems([]);
              pickedIds.current.clear();
            }}
            options={sourceDepots}
            placeholder="Depo seç"
          />
          <TerminalSelect
            label="Hedef laboratuvar"
            value={labId}
            onChange={setLabId}
            options={hospitals}
            placeholder="Laboratuvar seç"
          />
        </div>

        {depotId && stockPending ? (
          <p className="shrink-0 text-sm text-amber-700 dark:text-amber-300">
            Depo stoğu yükleniyor — okutmaya başlamadan önce bekleyin, aksi hâlde
            depodaki ürünler «bu depoda değil» görünür.
          </p>
        ) : null}

        <ScanFeedbackBar feedback={feedback} />

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
          {items.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Henüz kalem okutulmadı.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Ürün</th>
                  <th className="px-4 py-3">Seri</th>
                  <th className="px-4 py-3">Lot</th>
                  <th className="px-4 py-3">Raf</th>
                  <th className="px-4 py-3 text-right">Adet</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{item.stokAdi}</div>
                      <div className="text-xs text-muted-foreground">{item.stokKodu}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-foreground/80">{item.seriNumarasi}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.lotNumarasi || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.rafAdresi || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground/80">
                      {getStockItemQuantity(item)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label="Satırı sil"
                        className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-red-400"
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
              setItems([]);
              pickedIds.current.clear();
              setFeedback(IDLE);
            }}
            disabled={items.length === 0}
          >
            Listeyi temizle
          </TerminalButton>

          <TerminalButton onClick={handleCommit} disabled={items.length === 0 || !depotId || !labId}>
            {`Transfer et (${items.length})`}
          </TerminalButton>
        </div>
      </div>
    </TerminalShell>
  );
}
