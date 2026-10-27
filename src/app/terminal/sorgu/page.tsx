/**
 * @fileoverview Terminal — Stok Sorgu (salt okunur).
 *
 * "Elimdeki kutu nerede kayıtlı?" sorusunu tek okutmada cevaplar. Hiçbir şey
 * yazmaz; depoda en sık sorulan ve en çok telefon trafiği yaratan soruyu
 * ortadan kaldırmak için vardır.
 *
 * Seri numarasız (lot/adet takipli) üründe soru değişiyor: "bu kutu nerede?"
 * değil, "bu üründen nerede ne kadar var?". O durumda ürün koduyla aranıp
 * seçili deponun stoğu lot lot gösterilir.
 */

'use client';

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDocs, where } from '../../../lib/data/client';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import useHidScanner from '@/hooks/useHidScanner';
import { parseAndResolveBarcode } from '@/lib/barcode';
import { scopedQuery } from '@/lib/document-helpers';
// Veri TEK KAYNAKTAN: önyükleme deposu. TanStack hook'ları (`useDepots` vb.)
// BİLEREK kullanılmaz — `getDocs` ile sorgu atarlar ve çevrimdışıyken panel
// geçişinde ağ beklenir (donmanın sebebi buydu). Bkz. terminal-prefetch.ts.
import { useTerminalData } from '@/components/terminal/prefetch-provider';
import type { DepoStokItem } from '@/lib/types';
import { playFeedback } from '@/lib/utils';
import { getStockItemQuantity } from '@/lib/stock-quantity';
import {
  ScanFeedbackBar,
  TerminalShell,
  type ScanFeedback,
} from '@/components/terminal/shell';
import { CameraScanButton } from '@/components/terminal/camera-scan-button';

const IDLE: ScanFeedback = {
  tone: 'idle',
  title: 'Okutmaya hazır',
  detail: 'Konumunu öğrenmek istediğiniz ürünü okutun.',
};

type LookupResult = {
  serial: string;
  productName: string;
  stokKodu: string;
  matches: DepoStokItem[];
};

export default function TerminalSorguPage() {
  const router = useRouter();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const { productCodes, barcodeFormats: formats, depotStock } = useTerminalData();

  const [feedback, setFeedback] = useState<ScanFeedback>(IDLE);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleScan = useCallback(
    async ({ raw }: { raw: string }) => {
      const code = raw.trim();
      if (!code) return;

      const hit = parseAndResolveBarcode(code, formats, productCodes);
      const serial = (hit?.parsed.seriNumarasi || '').trim();
      const lot = (hit?.parsed.lotNumarasi || '').trim();

      /**
       * SERİ NUMARASIZ ÜRÜNLER — ürün koduyla arama.
       *
       * Lot/adet takipli üründe sorulacak bir seri numarası yok; sorunun
       * kendisi de değişiyor: "bu kutu nerede?" değil, "bu üründen nerede,
       * ne kadar var?". Cevap yereldeki depo stoğundan verilir — bu ekran
       * çevrimdışıyken zaten sunucuya sorgu ATMIYOR.
       */
      if (!serial) {
        if (!hit?.product) {
          setFeedback({
            tone: 'error',
            title: 'Ürün tanınmadı',
            detail: `Barkod: ${code.slice(0, 40)}`,
          });
          setResult(null);
          playFeedback(true);
          return;
        }

        const stokKodu = hit.product.stokKodu;
        const matches = depotStock.filter(item => {
          if ((item.stokKodu || '') !== stokKodu) return false;
          return !lot || (item.lotNumarasi || '').trim() === lot;
        });

        setResult({
          serial: '',
          productName: hit.product.stokAdi || 'Bilinmeyen ürün',
          stokKodu,
          matches,
        });

        const toplam = matches.reduce((sum, item) => sum + getStockItemQuantity(item), 0);
        setFeedback(
          matches.length === 0
            ? {
                tone: 'warning',
                title: 'Bu depoda bulunamadı',
                detail: `${hit.product.stokAdi}${lot ? ` · Lot ${lot}` : ''} — seçili deponun stoğunda yok.`,
              }
            : {
                tone: 'success',
                title: `${toplam} adet`,
                detail: `${matches.length} lot${lot ? ` · Lot ${lot}` : ''}`,
              },
        );
        playFeedback(matches.length === 0);
        return;
      }

      setIsLoading(true);
      setFeedback({ tone: 'idle', title: 'Aranıyor…', detail: `Seri ${serial}` });

      try {
        // Önce YEREL: seçili deponun stoğu zaten bellekte, ağ turu gerekmez.
        const local = depotStock.filter(item => item.seriNumarasi === serial);

        /**
         * Çevrimdışıyken sunucu sorgusu ATILMAZ.
         *
         * `getDocs` ağ arayüzü "bağlı" görünüp internet yokken (depoda tipik
         * hâl) sunucu yanıtını zaman aşımına kadar bekler ve ekran donar.
         * Bu ekranın tek işi bir soruyu hızlı cevaplamak; donmak yerine
         * elindekiyle cevap verip kapsamı açıkça söyler.
         */
        const canQueryServer = typeof navigator === 'undefined' || navigator.onLine;

        let matches: DepoStokItem[] = local;
        let scopeNote = '';

        if (canQueryServer) {
          // Seri numarası üzerinden arama: ürün kodu çözümlenemese bile sonuç
          // döner, çünkü depoda asıl aranan şey elde tutulan fiziksel kutudur.
          const snap = await getDocs(
            scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('seriNumarasi', '==', serial)),
          );
          matches = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DepoStokItem);
        } else if (local.length === 0) {
          scopeNote = ' (çevrimdışı — yalnızca bu deponun stoğunda arandı)';
        }

        setResult({
          serial,
          productName: hit?.product?.stokAdi || matches[0]?.stokAdi || 'Bilinmeyen ürün',
          stokKodu: hit?.product?.stokKodu || matches[0]?.stokKodu || '',
          matches,
        });

        if (matches.length === 0) {
          setFeedback({
            tone: 'warning',
            title: 'Kayıt bulunamadı',
            detail: `Seri ${serial} sistemde görünmüyor.${scopeNote}`,
          });
          playFeedback(true);
        } else {
          setFeedback({
            tone: 'success',
            title: `${matches.length} kayıt bulundu`,
            detail: `Seri ${serial}`,
          });
          playFeedback();
        }
      } catch (error) {
        setResult(null);
        setFeedback({
          tone: 'error',
          title: 'Sorgu başarısız',
          detail: error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.',
        });
        playFeedback(true);
      } finally {
        setIsLoading(false);
      }
    },
    [formats, productCodes, currentCompanyId, isSuperAdmin, depotStock],
  );

  useHidScanner({ enabled: !isLoading, onScan: handleScan });

  return (
    <TerminalShell
      title="Stok Sorgu"
      subtitle="Salt okunur — hiçbir kayıt değiştirilmez"
      onBack={() => router.push('/terminal')}
    >
      <div className="flex h-full min-h-0 flex-col gap-4 p-6">
        <ScanFeedbackBar feedback={feedback} />
        {/* Android'de kamerayla okutma; diğer kabuklarda hiç render edilmez. */}
        <CameraScanButton onScan={handleScan} disabled={isLoading} />

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border p-6">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Aranıyor…
            </div>
          ) : !result ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Sonuçlar burada görünecek.
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <p className="text-3xl font-semibold text-foreground">{result.productName}</p>
                <p className="text-muted-foreground">
                  {result.stokKodu ? `${result.stokKodu}` : ''}
                  {result.serial ? ` · Seri ${result.serial}` : ''}
                </p>
              </div>

              {result.matches.length === 0 ? (
                <p className="text-muted-foreground">
                  {result.serial
                    ? 'Bu seri numarası için stok kaydı yok. Ürün henüz mal kabul edilmemiş ya da tüketilmiş olabilir.'
                    : 'Bu ürün seçili deponun stoğunda görünmüyor.'}
                </p>
              ) : (
                <div className="space-y-3">
                  {result.matches.map(item => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-border bg-card p-5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <p className="text-xl font-semibold">
                          {item.isShipped
                            ? `Sevk edildi → ${item.hedefKurum || 'bilinmeyen kurum'}`
                            : `Depoda → ${item.depotName || 'bilinmeyen depo'}`}
                        </p>
                        <span className="text-sm text-muted-foreground">
                          {item.isShipped ? 'Laboratuvar stoğu' : 'Merkez depo stoğu'}
                        </span>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                        <Detail label="Adet" value={String(getStockItemQuantity(item))} />
                        <Detail label="Raf" value={item.rafAdresi} />
                        <Detail label="Lot" value={item.lotNumarasi} />
                        <Detail
                          label="Miad"
                          value={typeof item.miad === 'string' ? item.miad : undefined}
                        />
                        <Detail label="İrsaliye" value={item.irsaliyeNumarasi} />
                      </dl>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </TerminalShell>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value || '—'}</dd>
    </div>
  );
}
