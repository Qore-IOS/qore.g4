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
import { AlertTriangle, Minus, Plus, Trash2 } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import useHidScanner from '@/hooks/useHidScanner';
// Ayrıştırıcı doğrudan lib'den: hook sürümü barkod formatlarını kendi
// sorgusuyla çeker, terminalde formatlar zaten önyükleme deposunda.
import { parseAndResolveBarcode } from '@/lib/barcode';
import { useInvalidateQueries, touchStockMetadata } from '@/hooks/useDatabaseQueries';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { useTerminalDepot } from '@/hooks/useTerminalDepot';
// Veri TEK KAYNAKTAN: önyükleme deposu. TanStack hook'ları (`useDepots` vb.)
// BİLEREK kullanılmaz — `getDocs` ile sorgu atarlar ve çevrimdışıyken panel
// geçişinde ağ beklenir (donmanın sebebi buydu). Bkz. terminal-prefetch.ts.
import { useTerminalData } from '@/components/terminal/prefetch-provider';
import { generateId, playFeedback } from '@/lib/utils';
import { recordOperation } from '@/lib/pending-operations';
import { getSerialLedgerEntries } from '@/lib/serial-ledger/client';
import { canReceiveSerial, describeSerialBlock } from '@/lib/serial-ledger/core';
import {
  collectSerialPairs,
  commitMalKabul,
  type MalKabulWriteRow,
} from '@/lib/mal-kabul/write';
// Seri numarasız (lot/adet takipli) ürünlerin okutma mantığı.
import { addQuantityScan, adjustQuantity, intakeGroupKey } from '@/lib/terminal/quantity-picking';
import {
  ScanFeedbackBar,
  TerminalButton,
  TerminalField,
  TerminalSelect,
  TerminalShell,
  TerminalStat,
  type ScanFeedback,
} from '@/components/terminal/shell';
import { CameraScanButton } from '@/components/terminal/camera-scan-button';

const IDLE: ScanFeedback = { tone: 'idle', title: 'Okutmaya hazır', detail: 'Barkodu okutun.' };

export default function TerminalMalKabulPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId } = useAuth();
  const { depots, productCodes, barcodeFormats: formats } = useTerminalData();
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

      /**
       * SERİ NUMARASIZ ÜRÜNLER.
       *
       * Tanımlı ürünlerin bir kısmı lot ya da adet takipli (`TrackingMode`).
       * Terminal eskiden bunları reddedip kullanıcıyı web paneline yolluyordu;
       * oysa aynı rafta duruyorlar ve görevlinin bir kutu için terminale,
       * diğeri için bilgisayara gitmesi anlamsız.
       *
       * Her okutma BİR ADET ekler; aynı ürün+lot+miad tek satırda toplanır.
       * "Kaç adet?" diye soran bir alan, eldiven ve barkod okuyucuyla çalışan
       * biri için sürtünmedir — düzeltme satırdaki +/- ile yapılır.
       */
      if (!serial) {
        const lot = (parsed.lotNumarasi || '').trim();
        const miad = parsed.miadFormatted || '';
        const groupKey = intakeGroupKey({ stokKodu: product.stokKodu, lotNumarasi: lot, miad });

        setRows(prev => {
          const result = addQuantityScan<MalKabulWriteRow>(
            prev,
            groupKey,
            row =>
              intakeGroupKey({
                stokKodu: row.stokKodu || '',
                lotNumarasi: row.lotNumarasi,
                miad: typeof row.miad === 'string' ? row.miad : '',
              }),
            () => ({
              id: generateId(),
              stokKodu: product.stokKodu,
              stokAdi: product.stokAdi,
              lotNumarasi: lot,
              miad,
              seriNumarasi: '',
              rafAdresi,
              irsaliyeNumarasi,
              timestamp: new Date(),
              adet: 1,
            }),
          );
          return result.rows;
        });

        setFeedback({
          tone: 'success',
          title: product.stokAdi,
          detail: lot ? `Lot ${lot} · +1 adet` : '+1 adet',
        });
        playFeedback();
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
    [depotId, formats, productCodes, rafAdresi, irsaliyeNumarasi, currentCompanyId],
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

    // İşlem deftere yazılır: çevrimdışıyken kullanıcı neyin beklediğini
    // "Bekleyen İşlemler" ekranından görebilsin.
    const operationId = recordOperation({
      id: `mk-${generateId()}`,
      kind: 'mal_kabul',
      summary: `${depotName || 'Depo'} · ${accepted.length} kalem`,
      itemCount: accepted.length,
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
      operationId,
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
      right={
        // Satır sayısı artık yeterli değil: seri numarasız kalemler tek
        // satırda toplanıyor, dolayısıyla "3 satır" 30 adet olabilir. Toplam
        // adet gösterilmezse görevli kaç kutu okuttuğunu ekrandan göremez.
        <TerminalStat
          label="Okutulan"
          value={rows.reduce((total, row) => total + Math.max(1, row.adet ?? 1), 0)}
        />
      }
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
        {/* Android'de kamerayla okutma; diğer kabuklarda hiç render edilmez. */}
        <CameraScanButton onScan={handleScan} />

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
                  <th className="px-4 py-3">Adet</th>
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
                    <td className="px-4 py-3 font-mono text-foreground/80">
                      {row.seriNumarasi || '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.lotNumarasi || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {typeof row.miad === 'string' ? row.miad || '—' : '—'}
                    </td>
                    {/*
                      Adet yalnızca seri numarasız satırlarda düzenlenebilir.
                      Seri numaralı bir kalem tanım gereği tektir; orada +/-
                      göstermek stoğu bozmaya davet olurdu.
                    */}
                    <td className="px-4 py-3">
                      {row.seriNumarasi ? (
                        <span className="text-muted-foreground">1</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setRows(prev => adjustQuantity(prev, row.id, -1))}
                            aria-label="Adedi azalt"
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground/80 hover:bg-muted"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="min-w-8 text-center font-medium tabular-nums text-foreground">
                            {row.adet ?? 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => setRows(prev => adjustQuantity(prev, row.id, 1))}
                            aria-label="Adedi artır"
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground/80 hover:bg-muted"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
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
