'use client';

import { useState } from 'react';
import { AlertTriangle, Database, Loader2, PlayCircle, Search } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import type { AktarimOzeti } from '@/actions/labPeriodActions';

const PANEL_CLASS =
  'rounded-2xl border border-border bg-card p-5 shadow-sm';

/**
 * Geriye dönük lab-dönem aktarımı.
 *
 * Sayım, cihaz üstü ve kümülatif verileri bugüne kadar beş ayrı koleksiyonda
 * tutuluyordu. Bu panel eski kayıtları tarayıp tek doğruluk kaynağı olan
 * lab-dönem snapshot'larına yazar.
 *
 * Aktarım elle tetiklenir ve tekrar çalıştırılabilir: her kaynak kaydın
 * kimliği snapshot'ta saklandığı için ikinci geçişte atlanır, aradaki canlı
 * düzenlemeler geri alınmaz. Yazmadan önce önizleme alınması önerilir.
 */
export default function LabDonemAktarimPanel() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [calisiyor, setCalisiyor] = useState<'onizleme' | 'aktarim' | null>(null);
  const [ozet, setOzet] = useState<AktarimOzeti | null>(null);

  const calistir = async (onizleme: boolean) => {
    setCalisiyor(onizleme ? 'onizleme' : 'aktarim');
    setOzet(null);
    try {
      const { backfillLabPeriodSnapshots } = await import('@/actions/labPeriodActions');
      const sonuc = await backfillLabPeriodSnapshots(currentCompanyId, isSuperAdmin, {
        onizleme,
      });
      setOzet(sonuc);
      toast({
        title: onizleme ? 'Önizleme tamamlandı' : 'Aktarım tamamlandı',
        description: onizleme
          ? `${sonuc.eklenen} ölçüm eklenecek, ${sonuc.guncellenen} ölçüm güncellenecek.`
          : `${sonuc.etkilenenSnapshot} lab-dönem kaydı güncellendi.`,
      });
    } catch (err) {
      console.error('[lab-donem-aktarim]', err);
      toast({
        title: 'Aktarım başarısız',
        description: (err as Error)?.message || 'Beklenmeyen bir hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setCalisiyor(null);
    }
  };

  const mesgul = calisiyor !== null;

  return (
    <section className={PANEL_CLASS}>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
          <Database className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold">Geçmiş sayım verilerini aktar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Lab sayım, maliyet sayım, total verimlilik, cihaz üstü ve kümülatif hesaplama
            kayıtlarındaki stok / cihaz üstü / kümülatif verilerini tek lab-dönem kaynağına
            taşır. Tekrar çalıştırmak güvenlidir — daha önce aktarılmış kayıtlar atlanır ve
            aradaki düzenlemeleriniz korunur.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => calistir(true)}
          disabled={mesgul}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {calisiyor === 'onizleme' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Önizle (hiçbir şey yazılmaz)
        </button>
        <button
          type="button"
          onClick={() => calistir(false)}
          disabled={mesgul}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {calisiyor === 'aktarim' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
          Aktarımı çalıştır
        </button>
      </div>

      {ozet && (
        <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-sm font-bold">
            {ozet.onizleme ? 'Önizleme sonucu — hiçbir şey yazılmadı' : 'Aktarım sonucu'}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { etiket: 'Etkilenen lab-dönem', deger: ozet.etkilenenSnapshot },
              { etiket: 'İlk kez yazılan ölçüm', deger: ozet.eklenen },
              { etiket: 'Güncellenen ölçüm', deger: ozet.guncellenen },
              { etiket: 'Değişmeyen ölçüm', deger: ozet.degismeyen },
            ].map(k => (
              <div key={k.etiket}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {k.etiket}
                </dt>
                <dd className="text-xl font-black tabular-nums">{k.deger}</dd>
              </div>
            ))}
          </dl>

          {Object.keys(ozet.taranan).length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Taranan kaynak kayıtları
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(ozet.taranan).map(([ad, adet]) => (
                  <li
                    key={ad}
                    className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-semibold"
                  >
                    {ad}: {adet}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ozet.hatalar.length > 0 && (
            <ul className="mt-4 space-y-1">
              {ozet.hatalar.map((hata, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {hata}
                </li>
              ))}
            </ul>
          )}

          {ozet.guncellenen > 0 && (
            <p className="mt-4 text-xs font-semibold text-muted-foreground">
              Güncellenen ölçümler, aynı lab-dönem-ürün için birden çok kaynakta farklı değer
              bulunduğu anlamına gelir. Bu durumda en eski kayıt ilk sayım kabul edilir, sonraki
              kayıtlar düzenleme olarak uygulanır.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
