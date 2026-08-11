/**
 * @fileoverview Kamerayla barkod okutma — YALNIZCA Android kabuğunda.
 *
 * NEDEN VAR: Terminalin okutma mantığı `useHidScanner`'a dayanır; el
 * terminallerindeki (Zebra, Honeywell, Urovo…) barkod okuyucular "keyboard
 * wedge" kipinde tuş vuruşu ürettiği için orada ek bir şeye gerek yoktur.
 * Ama aynı APK sıradan bir telefona da kurulabiliyor ve o telefonda okutacak
 * donanım yok — kamera tek yol.
 *
 * NEDEN YALNIZCA ANDROID'DE GÖRÜNÜR: Kullanıcı "aynı arayüz" istedi. Web ve
 * masaüstünde ekranlar bugünkü hâliyle kalır; düğme yalnızca gerçekten
 * gerekebileceği kabukta çıkar. Donanım okuyuculu bir el terminalinde de
 * görünür ama zararsızdır: kimse basmaz.
 *
 * Okunan kod, HID okuyucunun ürettiğiyle AYNI yoldan (`onScan({ raw })`)
 * ekrana verilir — ekranların doğrulama, ledger kontrolü ve yazma mantığı
 * tek kopya kalır.
 */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

import { isNativeApp, pushBackHandler } from '@/lib/native-shell';
import { playFeedback } from '@/lib/utils';

type CameraScanButtonProps = {
  onScan: (payload: { raw: string }) => void;
  /** Ekran meşgulken (ör. yazma sürüyor) düğme kapatılır. */
  disabled?: boolean;
};

export function CameraScanButton({ onScan, disabled }: CameraScanButtonProps) {
  // Kabuk tespiti render sırasında DEĞİL, efektte yapılır: sunucu tarafında
  // `window` yoktur ve web derlemesinde ilk boyama uyuşmazlığı çıkardı.
  const [native, setNative] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => setNative(isNativeApp()), []);

  if (!native) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="Kamerayla okut"
        className="fixed bottom-6 right-6 z-40 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg disabled:opacity-40"
      >
        <Camera className="h-7 w-7" />
      </button>

      {open ? <CameraScanSheet onScan={onScan} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Tam ekran kamera örtüsü. Açıkken ekranın kendi klavye dinleyicisi susmaz;
 *  kameradan gelen kod da aynı `onScan`'e gider, çift okuma riski yoktur —
 *  okuma başarılı olur olmaz örtü kapanır. */
function CameraScanSheet({
  onScan,
  onClose,
}: {
  onScan: (payload: { raw: string }) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    try {
      readerRef.current?.reset();
    } catch {
      /* zaten durmuş olabilir */
    }
    readerRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Donanım geri tuşu örtüyü kapatır, ekranı DEĞİŞTİRMEZ.
  useEffect(() => pushBackHandler(onClose), [onClose]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // ZXing dinamik yüklenir: kamerayı hiç açmayan kullanıcılar
        // kütüphanenin bedelini ödemesin.
        const { BrowserMultiFormatReader } = await import('@zxing/library');
        if (cancelled) return;

        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        // `undefined` cihaz kimliği = varsayılan kamera. Android'de bu arka
        // kameradır; barkod okutmak için doğru olan da odur.
        await reader.decodeFromVideoDevice(undefined as any, videoRef.current!, result => {
          if (!result) return; // her karede `NotFoundException` gelir, normal
          const raw = result.getText()?.trim();
          if (!raw) return;
          playFeedback();
          stop();
          onClose();
          onScan({ raw });
        });
      } catch (e) {
        if (cancelled) return;
        // En sık sebep: kullanıcı kamera iznini reddetti. Metni açıkça
        // yazıyoruz, yoksa siyah bir ekranla baş başa kalırlar.
        setError(
          e instanceof Error && /permission|denied|NotAllowed/i.test(e.message)
            ? 'Kamera izni verilmedi. Ayarlar → Uygulamalar → Qore Terminal → İzinler.'
            : 'Kamera açılamadı.',
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [onClose, onScan, stop]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <video ref={videoRef} className="min-h-0 flex-1 object-cover" playsInline muted />

      {/* Nişangâh: kullanıcı barkodu nereye tutacağını bilsin. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-40 w-4/5 rounded-xl border-2 border-white/80" />
      </div>

      {error ? (
        <p className="absolute inset-x-0 top-1/2 px-8 text-center text-lg text-white">{error}</p>
      ) : null}

      <button
        type="button"
        onClick={onClose}
        className="flex shrink-0 items-center justify-center gap-2 bg-white/10 py-5 text-lg font-medium text-white"
      >
        <X className="h-5 w-5" /> Kapat
      </button>
    </div>
  );
}
