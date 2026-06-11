'use client';

/**
 * WebVitalsReporter — Faz 0 ölçüm aracı (Performans Optimizasyon Programı)
 *
 * Gerçek kullanıcı ortamında (prod dahil, mobil dahil) Core Web Vitals'ı yakalar:
 * LCP, INP, CLS, FCP, TTFB. Değerler her zaman `window.__QORE_VITALS__` dizisine
 * yazılır; istenirse ekranın köşesinde küçük bir canlı panelde gösterilir.
 *
 * KONSOL'A BAĞIMLI DEĞİL: Faz 1'de `next.config` `removeConsole` log'ları sileceği
 * için ölçüm konsola değil, window buffer + opsiyonel overlay üzerinden raporlanır.
 *
 * Overlay'i açmak:
 *   - URL'ye `?vitals=1` ekle (kalıcı olur), kapatmak için `?vitals=0`
 *   - veya konsolda: localStorage.setItem('qoreVitals','1'); location.reload()
 * Özet almak (her ortamda): window.__qoreVitals?.()  →  konsola tablo basar.
 *
 * `web-vitals` dinamik import edilir; kritik bundle'a girmez.
 */

import { useEffect, useRef, useState } from 'react';

type Rating = 'good' | 'needs-improvement' | 'poor';
type VitalSample = {
  name: string;
  value: number;
  rating: Rating;
  path: string;
  ts: number;
};

declare global {
  interface Window {
    __QORE_VITALS__?: VitalSample[];
    __qoreVitals__?: () => void;
  }
}

// DATA: Firestore veri yolunun ön-plan servis süresi (cache veya sunucu) —
// src/lib/perf/data-vitals.ts üzerinden `qore:vital` olayıyla beslenir.
const ORDER = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB', 'DATA'] as const;

function fmt(name: string, value: number): string {
  if (name === 'CLS') return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)} sn`;
  return `${Math.round(value)} ms`;
}

function ratingColor(rating: Rating): string {
  if (rating === 'good') return '#22c55e';
  if (rating === 'needs-improvement') return '#f59e0b';
  return '#ef4444';
}

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get('vitals');
    if (q === '1') {
      localStorage.setItem('qoreVitals', '1');
      return true;
    }
    if (q === '0') {
      localStorage.removeItem('qoreVitals');
      return false;
    }
    return localStorage.getItem('qoreVitals') === '1';
  } catch {
    return false;
  }
}

export default function WebVitalsReporter() {
  const [enabled, setEnabled] = useState(false);
  const [samples, setSamples] = useState<Record<string, VitalSample>>({});
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (typeof window !== 'undefined' && !window.__QORE_VITALS__) {
      window.__QORE_VITALS__ = [];
    }
    setEnabled(isEnabled());

    // Her ortamda kullanılabilir özet yardımcısı.
    if (typeof window !== 'undefined') {
      window.__qoreVitals__ = () => {
        const rows = (window.__QORE_VITALS__ ?? []).reduce(
          (acc: Record<string, VitalSample>, s) => {
            // her metrik için en son örnek
            acc[s.name] = s;
            return acc;
          },
          {},
        );
        // eslint-disable-next-line no-console
        console.table(
          ORDER.map((n) => rows[n]).filter(Boolean).map((s) => ({
            Metrik: s.name,
            Değer: fmt(s.name, s.value),
            Durum: s.rating,
            Sayfa: s.path,
          })),
        );
      };
    }

    const record = (metric: {
      name: string;
      value: number;
      rating: Rating;
    }) => {
      const sample: VitalSample = {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        path:
          typeof window !== 'undefined'
            ? window.location.pathname
            : '',
        ts: Date.now(),
      };
      window.__QORE_VITALS__?.push(sample);
      setSamples((prev) => ({ ...prev, [metric.name]: sample }));
    };

    // Dinamik import: kritik bundle'a girmesin.
    import('web-vitals')
      .then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => {
        onLCP(record);
        onINP(record);
        onCLS(record);
        onFCP(record);
        onTTFB(record);
      })
      .catch(() => {
        /* web-vitals yüklenemezse sessizce geç */
      });
  }, []);

  // DATA örnekleri buffer'a data-vitals.ts'te yazılır; burada yalnızca
  // overlay'in canlı güncellenmesi için dinlenir. startedRef korumasının
  // DIŞINDA: StrictMode'un mount-unmount-mount döngüsünde dinleyicinin
  // kaybolmaması için kendi effect'inde yaşar.
  useEffect(() => {
    const onDataVital = (e: Event) => {
      const sample = (e as CustomEvent<VitalSample>).detail;
      if (!sample?.name) return;
      setSamples((prev) => ({ ...prev, [sample.name]: sample }));
    };
    window.addEventListener('qore:vital', onDataVital);
    return () => window.removeEventListener('qore:vital', onDataVital);
  }, []);

  if (!enabled) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        left: 8,
        zIndex: 2147483647,
        background: 'rgba(0,0,0,0.82)',
        color: '#fff',
        font: '600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
        padding: '8px 10px',
        borderRadius: 8,
        pointerEvents: 'none',
        minWidth: 132,
        boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
      }}
      aria-hidden
    >
      <div style={{ opacity: 0.6, marginBottom: 4, letterSpacing: 0.5 }}>
        WEB VITALS
      </div>
      {ORDER.map((name) => {
        const s = samples[name];
        return (
          <div
            key={name}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ opacity: 0.7 }}>{name}</span>
            <span style={{ color: s ? ratingColor(s.rating) : '#666' }}>
              {s ? fmt(name, s.value) : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
