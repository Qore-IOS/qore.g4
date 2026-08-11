/**
 * @fileoverview Kamerayla barkod okutma — YEREL motor (Google ML Kit).
 *
 * NEDEN TARAYICI MOTORU DEĞİL
 *
 * İlk sürüm `@zxing/library` ile WebView içinde çözüyordu: kareler JavaScript'e
 * kopyalanıyor, çözümleme tek bir iş parçacığında yapılıyordu. Depo koşullarında
 * bu yetersiz — buruşuk etiket, küçük DataMatrix, loş raf arası. Uygulama artık
 * yerel bir kabukta çalıştığına göre cihazın kendi gücünü kullanmamak için sebep
 * yok: ML Kit çözümlemeyi kamera akışının üstünde, yerel kodda ve donanım
 * hızlandırmasıyla yapar.
 *
 * Kazanılanlar: bütün barkod biçimleri (varsayılan olarak hepsi açık), 1080p
 * kare, sürekli otomatik odak, flaş ve gerçek zamanlı okuma hızı.
 *
 * ÖNİZLEME NEDEN "DELİK" OLARAK YAPILIYOR
 *
 * Eklentinin `startScan()` kipi kamerayı WebView'ın ARKASINA, tam ekran çizer;
 * önizlemeyi bir bölgeye sığdıran bir seçenek YOK. Bu yüzden ekranı 2×3 kareye
 * bölüp sol üst karenin dışında kalan her yeri opak boyuyoruz: geriye kalan
 * saydam kare, kameranın göründüğü "delik" oluyor.
 *
 * Bunun bir sonucu var ve bilinerek kabul edildi: delikte, tam ekran görüntünün
 * SOL ÜST BÖLGESİ görünür (küçültülmüş tamamı değil). Buna karşılık ALGILAMA
 * karenin tamamını kullanır — yani delikte görünmeyen bir barkod da okunur.
 * Delik nişan almak için, kadraj için değil.
 *
 * OKUTMA SÜREKLİDİR
 *
 * İlk barkodda kapanmaz. Depo görevlisi arka arkaya kutu geçirir ve okuttuğu
 * ürünlerin listede birikmesini görmek ister; ekranın kalan beş karesi tam da
 * bunun için boş bırakılıyor.
 */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Flashlight, X } from 'lucide-react';

import { isNativeApp, pushBackHandler } from '@/lib/native-shell';
import { playFeedback } from '@/lib/utils';

type CameraScanButtonProps = {
  onScan: (payload: { raw: string }) => void;
  /** Ekran meşgulken (ör. yazma sürüyor) düğme kapatılır. */
  disabled?: boolean;
};

/**
 * Aynı barkodun art arda okunmasını engelleyen süre.
 *
 * ML Kit saniyede onlarca kare çözer; elde tutulan tek bir kutu, düşünmeden
 * bırakılırsa listeye onlarca kez düşerdi.
 */
const DUPLICATE_WINDOW_MS = 1500;

export function CameraScanButton({ onScan, disabled }: CameraScanButtonProps) {
  // Kabuk tespiti render sırasında DEĞİL, efektte yapılır: sunucu tarafında
  // `window` yoktur ve web derlemesinde ilk boyama uyuşmazlığı çıkardı.
  const [native, setNative] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => setNative(isNativeApp()), []);

  if (!native) return null;

  return (
    <>
      {!active ? (
        <button
          type="button"
          onClick={() => setActive(true)}
          disabled={disabled}
          aria-label="Kamerayla okut"
          className="fixed bottom-6 right-6 z-40 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg disabled:opacity-40"
        >
          <Camera className="h-7 w-7" />
        </button>
      ) : (
        <CameraScanSession onScan={onScan} onClose={() => setActive(false)} />
      )}
    </>
  );
}

function CameraScanSession({
  onScan,
  onClose,
}: {
  onScan: (payload: { raw: string }) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [count, setCount] = useState(0);

  // Son okunan değer ve zamanı — tekrar filtresi için.
  const lastScan = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  // `onScan` her render'da yeni referans olabilir; efektin yeniden kurulup
  // kamerayı kapatıp açmaması için ref üzerinden okunur.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  // Donanım geri tuşu kamerayı kapatır, ekranı DEĞİŞTİRMEZ.
  useEffect(() => pushBackHandler(onClose), [onClose]);

  useEffect(() => {
    let cancelled = false;
    let removeListeners: Array<() => void> = [];
    let plugin: typeof import('@capacitor-mlkit/barcode-scanning') | null = null;

    (async () => {
      try {
        // Eklenti dinamik yüklenir: kamerayı hiç açmayan kullanıcılar ve
        // masaüstü paketi bu kodun bedelini ödemesin.
        const mod = await import('@capacitor-mlkit/barcode-scanning');
        if (cancelled) return;
        plugin = mod;

        const { BarcodeScanner, LensFacing, Resolution } = mod;

        const { supported } = await BarcodeScanner.isSupported();
        if (!supported) throw new Error('unsupported');

        const permission = await BarcodeScanner.requestPermissions();
        if (permission.camera !== 'granted' && permission.camera !== 'limited') {
          throw new Error('permission');
        }
        if (cancelled) return;

        const scanned = await BarcodeScanner.addListener('barcodesScanned', event => {
          const raw = event.barcodes?.[0]?.rawValue?.trim();
          if (!raw) return;

          const now = Date.now();
          if (raw === lastScan.current.value && now - lastScan.current.at < DUPLICATE_WINDOW_MS) {
            return;
          }
          lastScan.current = { value: raw, at: now };

          playFeedback();
          setCount(n => n + 1);
          onScanRef.current({ raw });
        });
        removeListeners.push(() => scanned.remove());

        const failed = await BarcodeScanner.addListener('scanError', event => {
          setError(event.message || 'Tarama hatası');
        });
        removeListeners.push(() => failed.remove());

        // Arayüzü saydamlaştıran sınıf, kamera BAŞLAMADAN önce eklenir;
        // aksi hâlde bir kare boyunca opak zeminin altında görüntü kaybolur.
        document.documentElement.classList.add('qore-scanning');

        await BarcodeScanner.startScan({
          lensFacing: LensFacing.Back,
          /**
           * Biçim listesi VERİLMEZ — eklenti o zaman desteklediği bütün
           * biçimleri arar. Depoda hangi tedarikçinin ne bastığı önceden
           * bilinmiyor; listeyi daraltmak okunamayan bir kutu demek.
           */
          /**
           * 1080p bilinçli seçim. 4K kare ML Kit'i belirgin biçimde yavaşlatır
           * ve okuma hızını düşürür; barkodda sınırlayıcı etken çözünürlük
           * değil odak ve ışıktır.
           */
          resolution: Resolution['1920x1080'],
        });

        // Flaş yalnızca gerçekten varsa gösterilir; olmayan cihazda ölü bir
        // düğme kullanıcıyı yanıltır.
        const { available } = await BarcodeScanner.isTorchAvailable();
        if (!cancelled) setTorchAvailable(available);
      } catch (e) {
        if (cancelled) return;
        document.documentElement.classList.remove('qore-scanning');
        const reason = e instanceof Error ? e.message : '';
        setError(
          reason === 'permission'
            ? 'Kamera izni verilmedi. Ayarlar → Uygulamalar → Qore Terminal → İzinler.'
            : reason === 'unsupported'
              ? 'Bu cihazda kamerayla okutma desteklenmiyor.'
              : 'Kamera açılamadı.',
        );
      }
    })();

    return () => {
      cancelled = true;
      document.documentElement.classList.remove('qore-scanning');
      removeListeners.forEach(remove => {
        try {
          remove();
        } catch {
          /* zaten kaldırılmış olabilir */
        }
      });
      void plugin?.BarcodeScanner.stopScan().catch(() => {});
    };
  }, []);

  const toggleTorch = useCallback(async () => {
    try {
      const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
      if (torchOn) await BarcodeScanner.disableTorch();
      else await BarcodeScanner.enableTorch();
      setTorchOn(!torchOn);
    } catch {
      /* flaş açılamadıysa okutma yine sürer */
    }
  }, [torchOn]);

  return (
    <>
      {/*
        Kabuğun kendi zeminini ve başlık şeridini yalnızca tarama sürerken
        devre dışı bırakan kurallar. Satır içi `<style>`, kuralları kullandıkları
        bileşenin yanında tutuyor — ayrı bir CSS dosyasında dururlarsa hangi
        ekranı etkilediklerini kimse bulamaz.
      */}
      <style>{`
        html.qore-scanning,
        html.qore-scanning body,
        html.qore-scanning [data-terminal-shell] { background: transparent !important; }
        /* Başlık şeridi sol üst kareyi kapatırdı; kamera açıkken yerini
           aşağıdaki denetim şeridi alır. */
        html.qore-scanning [data-terminal-header] { display: none !important; }
        /* İçerik ilk satırın ALTINDAN başlar: üstteki iki kare kameraya ve
           denetimlere ayrıldı. */
        html.qore-scanning [data-terminal-main] {
          position: relative;
          z-index: 1;
          padding-top: 33.34vh;
        }
      `}</style>

      {/*
        Opak zemin: sol üst kare DIŞINDA kalan her yer. İki dikdörtgen yeterli —
        sağ üst kare ve alttaki iki satırın tamamı.
      */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-1/2 top-0 h-1/3 w-1/2 bg-background" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-background" />
      </div>

      {/* Nişan çerçevesi — deliğin sınırını görünür kılar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-10 h-1/3 w-1/2 border-2 border-primary/70"
      />

      {/* Denetim şeridi: sağ üst kare. */}
      <div className="fixed right-0 top-0 z-10 flex h-1/3 w-1/2 flex-col justify-between p-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            {error ? 'Kamera hatası' : 'Kamera açık'}
          </p>
          <p className="text-xs text-muted-foreground">
            {error || (count > 0 ? `${count} okuma` : 'Barkodu sol üstteki kareye tutun')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {torchAvailable ? (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={torchOn ? 'Flaşı kapat' : 'Flaşı aç'}
              className={
                torchOn
                  ? 'flex h-12 flex-1 items-center justify-center rounded-lg bg-primary text-primary-foreground'
                  : 'flex h-12 flex-1 items-center justify-center rounded-lg border border-border text-foreground'
              }
            >
              <Flashlight className="h-5 w-5" />
            </button>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            aria-label="Kamerayı kapat"
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg border border-border text-foreground"
          >
            <X className="h-5 w-5" /> Kapat
          </button>
        </div>
      </div>
    </>
  );
}
