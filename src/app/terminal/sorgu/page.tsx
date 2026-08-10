/**
 * @fileoverview Terminal — Stok Sorgu (salt okunur).
 *
 * "Elimdeki kutu nerede kayıtlı?" sorusunu tek okutmada cevaplar. Hiçbir şey
 * yazmaz; depoda en sık sorulan ve en çok telefon trafiği yaratan soruyu
 * ortadan kaldırmak için vardır.
 */

'use client';

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDocs, where } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import useHidScanner from '@/hooks/useHidScanner';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import { useProductCodes } from '@/hooks/useFirebaseQueries';
import { scopedQuery } from '@/lib/firestore-helpers';
import { playFeedback } from '@/lib/utils';
import type { DepoStokItem } from '@/lib/types';
import {
  ScanFeedbackBar,
  TerminalShell,
  type ScanFeedback,
} from '@/components/terminal/shell';

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
  const { data: productCodes = [] } = useProductCodes();
  // Tipli ayrıştırma yolu — bkz. mal kabul ekranındaki not.
  const { formats, parseAndResolveBarcode } = useBarcodeParser();

  const [feedback, setFeedback] = useState<ScanFeedback>(IDLE);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleScan = useCallback(
    async ({ raw }: { raw: string }) => {
      const code = raw.trim();
      if (!code) return;

      const hit = parseAndResolveBarcode(code, formats, productCodes);
      const serial = (hit?.parsed.seriNumarasi || '').trim();

      if (!serial) {
        setFeedback({
          tone: 'error',
          title: 'Seri numarası okunamadı',
          detail: `Barkod: ${code.slice(0, 40)}`,
        });
        setResult(null);
        playFeedback(true);
        return;
      }

      setIsLoading(true);
      setFeedback({ tone: 'idle', title: 'Aranıyor…', detail: `Seri ${serial}` });

      try {
        // Seri numarası üzerinden arama: ürün kodu çözümlenemese bile sonuç
        // döner, çünkü depoda asıl aranan şey elde tutulan fiziksel kutudur.
        const snap = await getDocs(
          scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('seriNumarasi', '==', serial)),
        );
        const matches = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DepoStokItem);

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
            detail: `Seri ${serial} sistemde görünmüyor.`,
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
    [parseAndResolveBarcode, formats, productCodes, currentCompanyId, isSuperAdmin],
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

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-zinc-800 p-6">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-3 text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Aranıyor…
            </div>
          ) : !result ? (
            <div className="flex h-full items-center justify-center text-zinc-600">
              Sonuçlar burada görünecek.
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <p className="text-3xl font-semibold text-zinc-100">{result.productName}</p>
                <p className="text-zinc-500">
                  {result.stokKodu ? `${result.stokKodu} · ` : ''}Seri {result.serial}
                </p>
              </div>

              {result.matches.length === 0 ? (
                <p className="text-zinc-400">
                  Bu seri numarası için stok kaydı yok. Ürün henüz mal kabul
                  edilmemiş ya da tüketilmiş olabilir.
                </p>
              ) : (
                <div className="space-y-3">
                  {result.matches.map(item => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-zinc-800 bg-zinc-900 p-5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <p className="text-xl font-semibold">
                          {item.isShipped
                            ? `Sevk edildi → ${item.hedefKurum || 'bilinmeyen kurum'}`
                            : `Depoda → ${item.depotName || 'bilinmeyen depo'}`}
                        </p>
                        <span className="text-sm text-zinc-500">
                          {item.isShipped ? 'Laboratuvar stoğu' : 'Merkez depo stoğu'}
                        </span>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
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
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-zinc-200">{value || '—'}</dd>
    </div>
  );
}
