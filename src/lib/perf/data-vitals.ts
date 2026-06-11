/**
 * DATA vital — "panel açıldığında veri ne kadar sürede geldi?" metriği
 * (perf planı Faz 5).
 *
 * Web Vitals (LCP/INP/...) sayfa iskeletini ölçer ama bu uygulamada asıl
 * kullanıcı deneyimi Firestore verisinin ekrana gelme süresidir. Bu modül,
 * cache-first veri yolundaki (src/lib/firestore-fetch.ts) her ön-plan
 * servisini örnekler ve WebVitalsReporter'ın kullandığı kanala yazar:
 *
 *  - window.__QORE_VITALS__ buffer'ına `name: 'DATA'` örneği eklenir
 *    (kaynak bilgisi `source: 'cache' | 'server'` alanında).
 *  - `qore:vital` CustomEvent'i yayınlanır; overlay (?vitals=1) canlı günceller.
 *
 * Kullanıcı şikayeti geldiğinde HAR istemek yerine: kullanıcıya ?vitals=1
 * açtırın veya konsolda window.__qoreVitals__() çağırtın — DATA satırı
 * cache'in mi sunucunun mu servis ettiğini ve süreyi gösterir.
 */

type Rating = 'good' | 'needs-improvement' | 'poor';

export type DataVitalSample = {
  name: 'DATA';
  value: number;
  rating: Rating;
  path: string;
  ts: number;
  source: 'cache' | 'server';
};

/** Buffer'ın sınırsız büyümesini engelle (uzun oturumlar). */
const MAX_BUFFER = 500;

function rate(ms: number): Rating {
  if (ms < 120) return 'good';
  if (ms < 800) return 'needs-improvement';
  return 'poor';
}

export type DataIssueKind =
  | 'read-timeout'
  | 'channel-recovery'
  | 'query-retry'
  | 'query-error'
  | 'bg-revalidate-error';

export type DataIssueSample = {
  name: 'DATA-ISSUE';
  kind: DataIssueKind;
  detail: string;
  path: string;
  ts: number;
};

/** Aynı kind için konsol uyarısını boğmamak adına kısma penceresi. */
const ISSUE_LOG_THROTTLE_MS = 5_000;
const lastIssueLogAt = new Map<DataIssueKind, number>();

/**
 * Veri yolu problemi telemetrisi: timeout, kanal kurtarma, retry ve yutulmuş
 * arka plan hataları artık görünmez değil. Örnekler window.__QORE_VITALS__
 * buffer'ına yazılır (destek "konsolda window.__QORE_VITALS__'a bak" diyebilir)
 * ve kind başına 5sn'de bir konsola structured uyarı düşer.
 */
export function recordDataIssue(kind: DataIssueKind, detail?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const sample: DataIssueSample = {
      name: 'DATA-ISSUE',
      kind,
      detail: detail ?? '',
      path: window.location.pathname,
      ts: Date.now(),
    };
    const w = window as unknown as { __QORE_VITALS__?: unknown[] };
    if (!w.__QORE_VITALS__) w.__QORE_VITALS__ = [];
    w.__QORE_VITALS__.push(sample);
    if (w.__QORE_VITALS__.length > MAX_BUFFER) {
      w.__QORE_VITALS__.splice(0, w.__QORE_VITALS__.length - MAX_BUFFER);
    }
    window.dispatchEvent(new CustomEvent('qore:vital', { detail: sample }));

    const lastAt = lastIssueLogAt.get(kind) ?? 0;
    if (Date.now() - lastAt > ISSUE_LOG_THROTTLE_MS) {
      lastIssueLogAt.set(kind, Date.now());
      console.warn(`[qore-telemetry] ${kind}`, detail ?? '', `(${sample.path})`);
    }
  } catch {
    // Telemetri asla veri yolunu bozmamalı.
  }
}

export function recordDataServe(ms: number, source: 'cache' | 'server'): void {
  if (typeof window === 'undefined') return;
  try {
    const sample: DataVitalSample = {
      name: 'DATA',
      value: Math.round(ms * 10) / 10,
      rating: rate(ms),
      path: window.location.pathname,
      ts: Date.now(),
      source,
    };
    const w = window as unknown as { __QORE_VITALS__?: unknown[] };
    if (!w.__QORE_VITALS__) w.__QORE_VITALS__ = [];
    w.__QORE_VITALS__.push(sample);
    if (w.__QORE_VITALS__.length > MAX_BUFFER) {
      w.__QORE_VITALS__.splice(0, w.__QORE_VITALS__.length - MAX_BUFFER);
    }
    window.dispatchEvent(new CustomEvent('qore:vital', { detail: sample }));
  } catch {
    // Telemetri asla veri yolunu bozmamalı.
  }
}
