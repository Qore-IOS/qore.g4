/**
 * @fileoverview Terminal — Mal Kabul (hızlı akış).
 *
 * KAPSAM: Seri numarası okutularak yapılan kabul. Lot/adet grupları, irsaliye
 * OCR'ı, Excel içe aktarma ve toplu QR devri BİLEREK dışarıda bırakıldı —
 * bunlar web panelinde (`/mal-kabul`) kalır. Terminal, deponun %90 durumu olan
 * "kutuyu al, okut, rafa koy" işini tek ekranda bitirir.
 *
 * Firestore'a yazma `@/lib/mal-kabul/write` üzerinden yapılır; web paneliyle
 * TAM OLARAK aynı belge şeması üretilir.
 */

'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import useHidScanner from '@/hooks/useHidScanner';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import {
  useDepots,
  useProductCodes,
  useInvalidateQueries,
  touchStockMetadata,
} from '@/hooks/useFirebaseQueries';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { useTerminalDepot } from '@/hooks/useTerminalDepot';
import { generateId, playFeedback } from '@/lib/utils';
import { getSerialLedgerEntries } from '@/lib/serial-ledger/client';
import { canReceiveSerial, describeSerialBlock } from '@/lib/serial-ledger/core';
import {
  collectSerialPairs,
  commitMalKabul,
  type MalKabulWriteRow,
} from '@/lib/mal-kabul/write';
import {
  ScanFeedbackBar,
  TerminalButton,
  TerminalField,
  TerminalSelect,
  TerminalShell,
  TerminalStat,
  type ScanFeedback,
} from '@/components/terminal/shell';

const IDLE: ScanFeedback = { tone: 'idle', title: 'Okutmaya hazır', detail: 'Barkodu okutun.' };

export default function TerminalMalKabulPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId } = useAuth();
  const { data: depots = [] } = useDepots();
  const { data: productCodes = [] } = useProductCodes();
  // `parseAuto` gevşek tipli `ParsedBarcode`'a döner (index signature: unknown).
  // `parseAndResolveBarcode` ise `ParsedGeneric` döndürür — alanlar gerçekten
  // string olarak tiplenir, bu yüzden terminal bu yolu kullanır.
  const { formats, parseAndResolveBarcode } = useBarcodeParser();
  const { invalidateDepoStok } = useInvalidateQueries();

  const [depotId, setDepotId] = useTerminalDepot();
  const [rafAdresi, setRafAdresi] = useState('');
  const [irsaliyeNumarasi, setIrsaliyeNumarasi] = useState('');
  const [rows, setRows] = useState<MalKabulWriteRow[]>([]);
  const [feedback, setFeedback] = useState<ScanFeedback>(IDLE);
  const [isSaving, setIsSaving] = useState(false);

  const sourceDepots = useMemo(
    () => filterOperationalSourceDepots(depots, currentUserProfile),
    [depots, currentUserProfile],
  );
  const depotName = sourceDepots.find(d => d.id === depotId)?.name || '';

  /**
   * Oturum içi mükerrer kontrolü.
   *
   * `rows` yerine ref kullanılır: okutma sırasında state güncellemesi
   * asenkrondur ve arka arkaya hızlı iki okutmada ikinci okutma, birincinin
   * henüz işlenmemiş state'ini görüp aynı seriyi ikinci kez eklerdi.
   */
  const scannedSerials = useRef<Set<string>>(new Set());

  const handleScan = useCallback(
    ({ raw }: { raw: string }) => {
      const code = raw.trim();
      if (!code) return;

      if (!depotId) {
        setFeedback({ tone: 'error', title: 'Depo seçilmedi', detail: 'Önce depoyu seçin.' });
        playFeedback(true);
        return;
      }

      const hit = parseAndResolveBarcode(code, formats, productCodes);
      const parsed = hit?.parsed;
      const product = hit?.product;
      if (!parsed || !product) {
        setFeedback({
          tone: 'error',
          title: 'Ürün tanınmadı',
          detail: `Barkod: ${code.slice(0, 40)}`,
        });
        playFeedback(true);
        return;
      }

      const serial = (parsed.seriNumarasi || '').trim();
      if (!serial) {
        setFeedback({
          tone: 'warning',
          title: 'Seri numarası okunamadı',
          detail: 'Bu ürün için web panelindeki mal kabul ekranını kullanın.',
        });
        playFeedback(true);
        return;
      }

      const key = `${product.stokKodu}||${serial}`;
      if (scannedSerials.current.has(key)) {
        setFeedback({
          tone: 'warning',
          title: 'Bu seri zaten listede',
          detail: `${product.stokAdi} · ${serial}`,
        });
        playFeedback(true);
        return;
      }
      scannedSerials.current.add(key);

      const row: MalKabulWriteRow = {
        id: generateId(),
        stokKodu: product.stokKodu,
        stokAdi: product.stokAdi,
        lotNumarasi: parsed.lotNumarasi || '',
        miad: parsed.miadFormatted || '',
        seriNumarasi: serial,
        rafAdresi,
        irsaliyeNumarasi,
        timestamp: new Date(),
        adet: 1,
      };

      setRows(prev => [row, ...prev]);
      setFeedback({
        tone: 'success',
        title: product.stokAdi,
        detail: `Seri ${serial}${parsed.lotNumarasi ? ` · Lot ${parsed.lotNumarasi}` : ''}`,
      });
      playFeedback();
    },
    [depotId, parseAndResolveBarcode, formats, productCodes, rafAdresi, irsaliyeNumarasi],
  );

  useHidScanner({ enabled: !isSaving, onScan: handleScan });

  const removeRow = (id: string) => {
    setRows(prev => {
      const target = prev.find(r => r.id === id);
      if (target?.stokKodu && target.seriNumarasi) {
        scannedSerials.current.delete(`${target.stokKodu}||${target.seriNumarasi}`);
      }
      return prev.filter(r => r.id !== id);
    });
  };

  const handleCommit = async () => {
    if (rows.length === 0 || !depotId || isSaving) return;
    setIsSaving(true);

    try {
      // Geçmiş seri kontrolü — web paneliyle aynı kaynak (Seri No Defteri).
      // Daha önce tüketilmiş/imha edilmiş bir seri sessizce yeniden stoğa
      // girerse, o serinin geçmişi iki kere "kabul" görür ve sayım tutmaz.
      const blocked = new Map<string, string>();
      try {
        const ledger = await getSerialLedgerEntries(
          collectSerialPairs(rows).map(({ serial, stokKodu }) => ({
            stokKodu,
            seriNumarasi: serial,
          })),
          currentCompanyId,
        );
        ledger.forEach((entry, key) => {
          if (!canReceiveSerial(entry)) blocked.set(key, describeSerialBlock(entry));
        });
      } catch {
        // Defter okunamadıysa kabul engellenmez: stok yazımı kritik yoldur,
        // defter kontrolü ise koruyucu bir ek. Web paneli de böyle davranır.
      }

      const accepted = rows.filter(
        r => !blocked.has(`${r.stokKodu}||${r.seriNumarasi}`),
      );
      const skipped = rows.length - accepted.length;

      if (accepted.length === 0) {
        toast({
          title: 'Hiçbir kalem kabul edilemedi',
          description: Array.from(new Set(blocked.values())).join(' ') || 'Seriler geçmişte işlem görmüş.',
          variant: 'destructive',
        });
        return;
      }

      const result = await commitMalKabul({
        rows: accepted,
        ctx: {
          depotId,
          depotName,
          createdByName: currentUserProfile?.name || currentUser?.email || 'Unknown',
          createdByUid: currentUser?.uid || null,
        },
        companyId: currentCompanyId,
      });

      await touchStockMetadata();
      invalidateDepoStok();

      setRows([]);
      scannedSerials.current.clear();
      setFeedback({
        tone: 'success',
        title: `${result.writtenDocs} kalem stoğa alındı`,
        detail: `İşlem no ${result.transactionId}`,
      });
      toast({
        title: 'Mal kabul tamamlandı',
        description:
          `${result.writtenDocs} kalem kaydedildi.` +
          (skipped > 0 ? ` ${skipped} seri geçmişte işlem gördüğü için atlandı.` : ''),
      });
    } catch (error) {
      // Rollback'e gerek yok: `commitMalKabul` başarısız olursa liste ekranda
      // kalır, kullanıcı aynı listeyle tekrar deneyebilir. Belge kimlikleri
      // satır kimliğinden türetildiği için tekrar deneme çift kayıt yaratmaz.
      toast({
        title: 'Kayıt başarısız',
        description: error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.',
        variant: 'destructive',
      });
      setFeedback({ tone: 'error', title: 'Kayıt başarısız', detail: 'Liste korundu, tekrar deneyin.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <TerminalShell
      title="Mal Kabul"
      subtitle={depotName || 'Depo seçilmedi'}
      onBack={() => router.push('/terminal')}
      right={<TerminalStat label="Okutulan" value={rows.length} />}
    >
      <div className="flex h-full min-h-0 flex-col gap-4 p-6">
        <div className="grid shrink-0 grid-cols-1 gap-4 md:grid-cols-3">
          <TerminalSelect
            label="Depo"
            value={depotId}
            onChange={setDepotId}
            options={sourceDepots}
            placeholder="Depo seç"
          />
          <TerminalField
            label="Raf adresi (opsiyonel)"
            value={rafAdresi}
            onChange={setRafAdresi}
            placeholder="Örn. A-01-03"
          />
          <TerminalField
            label="İrsaliye no (opsiyonel)"
            value={irsaliyeNumarasi}
            onChange={setIrsaliyeNumarasi}
            placeholder="Örn. IRS-2026-114"
          />
        </div>

        <p className="shrink-0 text-xs text-zinc-500">
          Raf ve irsaliye bilgisi, YAZILDIKTAN SONRA okutulan kalemlere işlenir.
          Önce bu alanları doldurun, sonra okutmaya başlayın.
        </p>

        <ScanFeedbackBar feedback={feedback} />

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-zinc-800">
          {rows.length === 0 ? (
            <div className="flex h-full items-center justify-center text-zinc-600">
              Henüz kalem okutulmadı.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-zinc-900 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Ürün</th>
                  <th className="px-4 py-3">Seri</th>
                  <th className="px-4 py-3">Lot</th>
                  <th className="px-4 py-3">Miad</th>
                  <th className="px-4 py-3">Raf</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-t border-zinc-800">
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-100">{row.stokAdi}</div>
                      <div className="text-xs text-zinc-500">{row.stokKodu}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-300">{row.seriNumarasi}</td>
                    <td className="px-4 py-3 text-zinc-400">{row.lotNumarasi || '—'}</td>
                    <td className="px-4 py-3 text-zinc-400">{row.miad || '—'}</td>
                    <td className="px-4 py-3 text-zinc-400">{row.rafAdresi || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        aria-label="Satırı sil"
                        className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
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
              setRows([]);
              scannedSerials.current.clear();
              setFeedback(IDLE);
            }}
            disabled={rows.length === 0 || isSaving}
          >
            Listeyi temizle
          </TerminalButton>

          <TerminalButton onClick={handleCommit} disabled={rows.length === 0 || !depotId || isSaving}>
            {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {isSaving ? 'Kaydediliyor…' : `Stoğa al (${rows.length})`}
          </TerminalButton>
        </div>
      </div>
    </TerminalShell>
  );
}
