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
import { AlertTriangle, Trash2 } from 'lucide-react';

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
  /**
   * Seri No Defteri'nde "kabul edilemez" görünen seriler ve gerekçeleri.
   *
   * Kontrol OKUTMA ANINDA, arka planda yapılır — kaydetme anında değil.
   * Sebebi iki yönlü: kullanıcı sorunu kutuyu elindeyken öğrenir (rafa
   * koyduktan sonra değil), ve "Stoğa al" düğmesi hiçbir ağ turu beklemez.
   */
  const [blockedSerials, setBlockedSerials] = useState<Map<string, string>>(new Map());

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

      // Geçmiş seri kontrolü ARKA PLANDA. Okutma yolunu bloke etmez; sonuç
      // gelince satır işaretlenir. Çevrimdışıysa istek sessizce başarısız
      // olur ve kabul engellenmez — defter koruyucu bir ek, kritik yol değil.
      void getSerialLedgerEntries([{ stokKodu: product.stokKodu, seriNumarasi: serial }], currentCompanyId)
        .then(ledger => {
          const entry = ledger.get(`${product.stokKodu}||${serial}`);
          if (!entry || canReceiveSerial(entry)) return;
          setBlockedSerials(prev => new Map(prev).set(key, describeSerialBlock(entry)));
        })
        .catch(() => {
          /* defter okunamadı — kabul engellenmez */
        });
    },
    [depotId, parseAndResolveBarcode, formats, productCodes, rafAdresi, irsaliyeNumarasi, currentCompanyId],
  );

  useHidScanner({ onScan: handleScan });

  const removeRow = (id: string) => {
    setRows(prev => {
      const target = prev.find(r => r.id === id);
      if (target?.stokKodu && target.seriNumarasi) {
        scannedSerials.current.delete(`${target.stokKodu}||${target.seriNumarasi}`);
      }
      return prev.filter(r => r.id !== id);
    });
  };

  /**
   * Kaydet — BEKLEMEDEN.
   *
   * Liste anında temizlenir ve kullanıcı bir sonraki irsaliyeye geçebilir.
   * Firestore yazımı yerel önbelleğe senkron uygulandığı için veri o an
   * zaten doğrudur; sunucuya gönderim arka planda yürür ve üst şeritteki
   * göstergeden izlenir.
   *
   * `async` DEĞİL: içinde beklenen hiçbir şey yok. Bir `await` eklenecekse,
   * önce onun okutma akışını durdurup durdurmayacağı düşünülmelidir.
   */
  const handleCommit = () => {
    if (rows.length === 0 || !depotId) return;

    const accepted = rows.filter(r => !blockedSerials.has(`${r.stokKodu}||${r.seriNumarasi}`));
    const skipped = rows.length - accepted.length;

    if (accepted.length === 0) {
      toast({
        title: 'Hiçbir kalem kabul edilemedi',
        description:
          Array.from(new Set(blockedSerials.values())).join(' ') ||
          'Okutulan serilerin tamamı geçmişte işlem görmüş.',
        variant: 'destructive',
      });
      return;
    }

    // Liste ÖNCE temizlenir: kullanıcı yazımın sonucunu beklemez.
    setRows([]);
    scannedSerials.current.clear();
    setBlockedSerials(new Map());
    setFeedback({
      tone: 'success',
      title: `${accepted.length} kalem stoğa alındı`,
      detail: skipped > 0 ? `${skipped} seri atlandı (geçmişte işlem görmüş).` : 'Gönderim arka planda sürüyor.',
    });

    void commitMalKabul({
      rows: accepted,
      ctx: {
        depotId,
        depotName,
        createdByName: currentUserProfile?.name || currentUser?.email || 'Unknown',
        createdByUid: currentUser?.uid || null,
      },
      companyId: currentCompanyId,
      sync: 'queue',
    })
      .then(() => {
        void touchStockMetadata();
        invalidateDepoStok();
      })
      .catch(error => {
        // Buraya yalnızca yazım HAZIRLANIRKEN oluşan hatalar düşer (geçersiz
        // veri gibi). Ağ sorunları kuyrukta beklediği için buraya gelmez.
        toast({
          title: 'Kayıt hazırlanamadı',
          description: error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.',
          variant: 'destructive',
        });
      });
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

        <p className="shrink-0 text-xs text-muted-foreground">
          Raf ve irsaliye bilgisi, YAZILDIKTAN SONRA okutulan kalemlere işlenir.
          Önce bu alanları doldurun, sonra okutmaya başlayın.
        </p>

        <ScanFeedbackBar feedback={feedback} />

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
          {rows.length === 0 ? (
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
                  <th className="px-4 py-3">Miad</th>
                  <th className="px-4 py-3">Raf</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const blockReason = blockedSerials.get(`${row.stokKodu}||${row.seriNumarasi}`);
                  return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{row.stokAdi}</div>
                      <div className="text-xs text-muted-foreground">{row.stokKodu}</div>
                      {blockReason ? (
                        <div className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {blockReason} — bu satır kaydedilmeyecek
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-foreground/80">{row.seriNumarasi}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.lotNumarasi || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.miad || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.rafAdresi || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        aria-label="Satırı sil"
                        className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                  );
                })}
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
            disabled={rows.length === 0}
          >
            Listeyi temizle
          </TerminalButton>

          <TerminalButton onClick={handleCommit} disabled={rows.length === 0 || !depotId}>
            {`Stoğa al (${rows.length})`}
          </TerminalButton>
        </div>
      </div>
    </TerminalShell>
  );
}
