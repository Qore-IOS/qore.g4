'use client';

/* Sarf Dağıtım — teslimat doğrulama sheet'i (demo sarf-verify.jsx karşılığı).
   Adımlı QR okutma: ör. 1) paket/ID kodu, 2) mahal kodu.
   Demo'daki simüle taramanın yerini @zxing ile gerçek kamera önizlemesi alır;
   manuel giriş de desteklenir. */

import React from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { IconPackage, IconQr, IconCheck, IconX } from './sarf-icons';
import { SARF_AC, sarfMono } from './sarf-ui';

export interface SarfSheetStep {
  label: string;
  instruction: string;
  placeholder: string;
  /** Eşleşirse null, aksi halde hata mesajı döner. */
  validate: (text: string) => string | null;
}

/* Mobil cihazlarda okutma geri bildirimi (Android Chrome; iOS web titreşimi desteklemez). */
const haptic = (pattern: number | number[]) => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch { /* yoksay */ }
};
export const hapticSuccess = () => haptic(50);
export const hapticError = () => haptic([60, 40, 60]);

/* ——— Kamera önizlemeli tarama alanı ——— */
const ScanViewport = ({
  ok, value, cameraOn, onScan,
}: {
  ok: boolean;
  value: string;
  cameraOn: boolean;
  onScan: (text: string) => void;
}) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const readerRef = React.useRef<BrowserMultiFormatReader | null>(null);
  const lastScanRef = React.useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const onScanRef = React.useRef(onScan);
  onScanRef.current = onScan;
  const [cameraReady, setCameraReady] = React.useState(false);

  React.useEffect(() => {
    if (!cameraOn || ok) {
      setCameraReady(false);
      return;
    }
    let cancelled = false;
    const video = videoRef.current;
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    (async () => {
      try {
        if (!video) return;
        await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          video,
          (result, err) => {
            if (cancelled) return;
            setCameraReady(true);
            if (result) {
              const text = result.getText();
              const now = Date.now();
              // Aynı kodun art arda tetiklenmesini yumuşat
              if (text === lastScanRef.current.text && now - lastScanRef.current.at < 1500) return;
              lastScanRef.current = { text, at: now };
              onScanRef.current(text);
            }
            if (err && !(err instanceof NotFoundException)) {
              // sürekli decode akışında diğer hatalar yoksayılır
            }
          },
        );
        if (!cancelled) setCameraReady(true);
      } catch {
        if (!cancelled) setCameraReady(false);
      }
    })();

    return () => {
      cancelled = true;
      try { reader.reset(); } catch { /* noop */ }
      readerRef.current = null;
      if (video && video.srcObject) {
        (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      }
      setCameraReady(false);
    };
  }, [cameraOn, ok]);

  return (
    <div style={{
      position: 'relative', width: '100%', aspectRatio: '1 / 1', maxWidth: 220, margin: '0 auto',
      borderRadius: 'var(--sarf-radius)', overflow: 'hidden',
      background: 'radial-gradient(120% 120% at 50% 30%, #2A2620 0%, #15120D 100%)',
      boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.6)',
      display: 'grid', placeItems: 'center',
    }}>
      {/* kamera önizleme */}
      {!ok && (
        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', opacity: cameraReady ? 1 : 0, transition: 'opacity 240ms ease',
          }}
        />
      )}
      {/* köşe braketleri */}
      {[0, 1, 2, 3].map((i) => (
        <span key={i} style={{
          position: 'absolute', zIndex: 2,
          top: i < 2 ? 14 : 'auto', bottom: i >= 2 ? 14 : 'auto',
          left: i % 2 === 0 ? 14 : 'auto', right: i % 2 === 1 ? 14 : 'auto',
          width: 30, height: 30,
          borderTop: i < 2 ? `3px solid ${ok ? 'var(--sarf-sage)' : SARF_AC.accent}` : 'none',
          borderBottom: i >= 2 ? `3px solid ${ok ? 'var(--sarf-sage)' : SARF_AC.accent}` : 'none',
          borderLeft: i % 2 === 0 ? `3px solid ${ok ? 'var(--sarf-sage)' : SARF_AC.accent}` : 'none',
          borderRight: i % 2 === 1 ? `3px solid ${ok ? 'var(--sarf-sage)' : SARF_AC.accent}` : 'none',
          borderRadius: 6,
          transition: 'border-color 200ms ease',
        }} />
      ))}
      {/* tarama çizgisi */}
      {!ok && (
        <span style={{
          position: 'absolute', zIndex: 2, left: '14%', right: '14%', height: 2,
          background: `linear-gradient(90deg, transparent, ${SARF_AC.accent}, transparent)`,
          boxShadow: `0 0 12px ${SARF_AC.accent}`,
          animation: 'sarfScanline 1.8s ease-in-out infinite',
        }} />
      )}
      {/* içerik */}
      {ok ? (
        <div style={{ position: 'relative', zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #B6E2A8, var(--sarf-sage))',
            boxShadow: '0 0 0 6px rgba(143,166,126,0.25), 0 8px 16px -2px rgba(94,122,78,0.6)',
            display: 'grid', placeItems: 'center', color: '#fff',
          }}>
            <IconCheck s={26} w={3.2} />
          </span>
          <span style={{ color: '#E9E2D2', fontFamily: sarfMono, fontSize: 13, fontWeight: 700, maxWidth: 180, textAlign: 'center', wordBreak: 'break-all' }}>{value}</span>
        </div>
      ) : (
        !cameraReady && <span style={{ position: 'relative', zIndex: 1, color: 'rgba(233,226,210,0.4)' }}><IconQr s={48} /></span>
      )}
    </div>
  );
};

/* ——— Adımlı doğrulama sheet'i ——— */
export function SarfVerifySheet({
  open, title, subtitle, steps, startStep = 0, finishLabel = 'Teslimatı Tamamla',
  busy, autoCompleteOnScan, onClose, onStepMatched, onComplete,
}: {
  open: boolean;
  title: string;
  subtitle?: React.ReactNode;
  steps: SarfSheetStep[];
  startStep?: number;
  finishLabel?: string;
  busy?: boolean;
  /** Son adım kamerayla okutulduğunda buton beklemeden tamamla. */
  autoCompleteOnScan?: boolean;
  onClose: () => void;
  /** Bir adım doğrulandığında (ileri geçmeden hemen önce) çağrılır. */
  onStepMatched?: (stepIndex: number, value: string) => void;
  /** Tüm adımlar doğrulandığında çağrılır. */
  onComplete: () => void;
}) {
  const [step, setStep] = React.useState(startStep);
  const [values, setValues] = React.useState<string[]>([]);
  const [oks, setOks] = React.useState<boolean[]>([]);
  const [err, setErr] = React.useState('');
  const autoFiredRef = React.useRef(false);

  React.useEffect(() => {
    if (open) {
      setStep(startStep);
      setValues([]);
      setOks([]);
      setErr('');
      autoFiredRef.current = false;
    }
  }, [open, startStep]);

  if (!open) return null;

  const cur = steps[step];
  const curValue = values[step] || '';
  const curOk = !!oks[step];

  const setValue = (v: string) => {
    setValues((prev) => { const n = [...prev]; n[step] = v; return n; });
    setErr('');
  };

  const markOk = (v: string) => {
    setValues((prev) => { const n = [...prev]; n[step] = v; return n; });
    setOks((prev) => { const n = [...prev]; n[step] = true; return n; });
    setErr('');
    onStepMatched?.(step, v);
  };

  const handleScan = (text: string) => {
    if (curOk) return;
    const e = cur.validate(text);
    if (e === null) {
      hapticSuccess();
      markOk(text);
      // Okuma akışını kesintisiz kılmak için son adımda otomatik tamamla
      // (yeşil onayın görünmesi için kısa bir gecikmeyle).
      if (autoCompleteOnScan && step === steps.length - 1 && !autoFiredRef.current) {
        autoFiredRef.current = true;
        setTimeout(() => onComplete(), 450);
      }
    } else {
      hapticError();
      setValues((prev) => { const n = [...prev]; n[step] = text; return n; });
      setErr(e);
    }
  };

  // Tamamlama başarısız olursa (busy true→false) buton ile tekrar denenebilsin.
  React.useEffect(() => {
    if (!busy) autoFiredRef.current = false;
  }, [busy]);

  const next = () => {
    if (busy) return;
    let ok = curOk;
    if (!ok) {
      const e = cur.validate(curValue);
      if (e !== null) { hapticError(); setErr(e); return; }
      hapticSuccess();
      markOk(curValue);
      ok = true;
    }
    if (step < steps.length - 1) {
      setStep(step + 1);
      setErr('');
    } else {
      if (autoFiredRef.current) return; // otomatik tamamlama zaten tetiklendi
      autoFiredRef.current = true;
      onComplete();
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 20, animation: 'sarfSheetFade 240ms ease' }}>
      <div onClick={busy ? undefined : onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(40,32,20,0.4)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }} />
      <div style={{
        position: 'relative', width: 'min(560px, 100%)', maxHeight: '92vh', overflowY: 'auto',
        background: 'linear-gradient(180deg, var(--sarf-surface) 0%, var(--sarf-surface-2) 100%)',
        borderRadius: 'var(--sarf-radius-lg)', boxShadow: '0 40px 80px -20px rgba(120,100,70,0.5), var(--sarf-clay)',
        animation: 'sarfPopIn 320ms cubic-bezier(.2,.8,.2,1.1)',
      }}>
        {/* başlık */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px 24px', borderBottom: '1px solid var(--sarf-line)' }}>
          <div style={{ width: 42, height: 42 }}><IconPackage /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sarf-ink-1)' }}>{title}</h2>
            {subtitle && (
              <div style={{ fontSize: 13, color: 'var(--sarf-ink-2)', fontWeight: 600, marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          <button onClick={busy ? undefined : onClose} aria-label="Kapat" style={{
            all: 'unset', cursor: 'pointer', width: 38, height: 38, borderRadius: '50%',
            background: 'linear-gradient(180deg, var(--sarf-surface-hi), var(--sarf-surface-2))', boxShadow: 'var(--sarf-clay)',
            display: 'grid', placeItems: 'center', color: 'var(--sarf-ink-1)', flexShrink: 0,
          }}>
            <IconX />
          </button>
        </div>

        {/* adım göstergesi */}
        {steps.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 24px 4px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {steps.map((s, i) => (
              <React.Fragment key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{
                    width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center',
                    background: i < step ? 'radial-gradient(circle at 30% 30%, #B6E2A8, var(--sarf-sage))'
                      : i === step ? `radial-gradient(circle at 30% 30%, ${SARF_AC.accent}, ${SARF_AC.primary})` : 'var(--sarf-surface-2)',
                    boxShadow: i <= step ? '0 4px 10px -2px rgba(0,0,0,0.2)' : 'var(--sarf-clay-inset)',
                    color: i <= step ? '#fff' : 'var(--sarf-ink-3)', fontSize: 13, fontWeight: 800,
                  }}>
                    {i < step ? <IconCheck s={14} /> : i + 1}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: i === step ? 'var(--sarf-ink-1)' : 'var(--sarf-ink-3)' }}>{s.label}</span>
                </div>
                {i < steps.length - 1 && (
                  <span style={{ width: 30, height: 2, borderRadius: 2, background: step > i ? 'var(--sarf-sage)' : 'var(--sarf-ink-3)', opacity: step > i ? 1 : 0.3 }} />
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* gövde */}
        <div style={{ padding: '14px 24px 0' }}>
          <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--sarf-ink-2)', textAlign: 'center', lineHeight: 1.5 }}>
            {cur.instruction}
          </p>

          <ScanViewport ok={curOk} value={curValue} cameraOn={open && !curOk} onScan={handleScan} />

          {/* manuel giriş */}
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <input
              value={curValue}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
              placeholder={cur.placeholder}
              disabled={curOk}
              style={{
                flex: 1, boxSizing: 'border-box', height: 50, padding: '0 18px', minWidth: 0,
                borderRadius: 'var(--sarf-radius-sm)', border: 'none', background: 'var(--sarf-surface-2)',
                boxShadow: 'var(--sarf-clay-inset)', color: 'var(--sarf-ink-1)', fontSize: 15, fontWeight: 700,
                fontFamily: sarfMono, outline: 'none', opacity: curOk ? 0.6 : 1,
              }}
            />
            <button
              onClick={next}
              style={{
                all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
                height: 50, padding: '0 18px', borderRadius: 'var(--sarf-radius-sm)', flexShrink: 0,
                background: 'linear-gradient(180deg, var(--sarf-surface-hi), var(--sarf-surface-2))', boxShadow: 'var(--sarf-clay)',
                color: 'var(--sarf-ink-1)', fontWeight: 700, fontSize: 14,
              }}
            >
              <IconQr s={16} /> Tara
            </button>
          </div>

          {err && <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: 'var(--sarf-danger)', textAlign: 'center' }}>{err}</div>}
        </div>

        {/* alt butonlar */}
        <div style={{ display: 'flex', gap: 10, padding: '20px 24px' }}>
          <button onClick={busy ? undefined : onClose} style={{
            all: 'unset', cursor: 'pointer', flex: 1, textAlign: 'center', height: 52,
            display: 'grid', placeItems: 'center', borderRadius: 'var(--sarf-radius-sm)',
            background: 'linear-gradient(180deg, var(--sarf-surface-hi), var(--sarf-surface-2))', boxShadow: 'var(--sarf-clay)',
            color: 'var(--sarf-ink-1)', fontWeight: 700, fontSize: 14, opacity: busy ? 0.5 : 1,
          }}>Vazgeç</button>
          <button onClick={next} style={{
            all: 'unset', cursor: busy ? 'wait' : 'pointer', flex: 1.5, textAlign: 'center', height: 52,
            display: 'grid', placeItems: 'center', borderRadius: 'var(--sarf-radius-sm)',
            background: `radial-gradient(130% 150% at 30% 20%, ${SARF_AC.accent} 0%, ${SARF_AC.primary} 75%)`,
            boxShadow: `inset 0 2px 2px rgba(255,255,255,0.4), 0 12px 24px -8px ${SARF_AC.glow}`,
            color: '#fff', fontWeight: 800, fontSize: 15, opacity: busy ? 0.7 : 1,
          }}>
            {busy ? 'İşleniyor…' : (step < steps.length - 1 ? 'Devam Et' : finishLabel)}
          </button>
        </div>
      </div>
    </div>
  );
}
