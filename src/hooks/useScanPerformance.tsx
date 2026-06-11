'use client';

import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

export type ScanPerformanceSample = {
  /** Synchronous barcode handler duration, excluding React render/commit. */
  jsMs: number;
  /** Time from scan handler entry until React commits its urgent update. */
  commitMs: number;
};

type ActiveMeasurement = {
  sequence: number;
  startedAt: number;
  jsMs: number | null;
};

export type ScanPerformanceController = {
  begin: () => void;
  commit: () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ScanPerformanceSample | null;
};

function createScanPerformanceController(): ScanPerformanceController {
  let sequence = 0;
  let active: ActiveMeasurement | null = null;
  let sample: ScanPerformanceSample | null = null;
  const listeners = new Set<() => void>();

  const publish = (nextSample: ScanPerformanceSample) => {
    sample = nextSample;
    listeners.forEach((listener) => listener());
  };

  return {
    begin() {
      if (typeof performance === 'undefined') return;
      const currentSequence = ++sequence;
      const startedAt = performance.now();
      active = { sequence: currentSequence, startedAt, jsMs: null };

      // Runs after the synchronous scan handler returns. Unlike the previous
      // implementation this does not set state on the large parent panel and
      // therefore does not create the commit it is trying to measure.
      queueMicrotask(() => {
        if (active?.sequence === currentSequence && active.jsMs === null) {
          active.jsMs = performance.now() - startedAt;
        }
      });
    },
    commit() {
      const measurement = active;
      if (!measurement || typeof performance === 'undefined') return;
      active = null;
      const commitMs = performance.now() - measurement.startedAt;
      const nextSample = {
        jsMs: measurement.jsMs ?? commitMs,
        commitMs,
      };
      // Keep the badge update outside the measured parent commit.
      queueMicrotask(() => publish(nextSample));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return sample;
    },
  };
}

/**
 * Non-intrusive scan timing controller.
 *
 * Measurement state lives outside React. `begin()` never re-renders the large
 * panel. A zero-DOM layout-effect probe observes the next real business-state
 * commit and only the tiny badge subscribes to the resulting sample.
 */
export function useScanPerformance() {
  const controllerRef = useRef<ScanPerformanceController | null>(null);
  if (!controllerRef.current) controllerRef.current = createScanPerformanceController();
  const controller = controllerRef.current;

  const startScanMeasurement = useCallback(() => {
    controller.begin();
  }, [controller]);

  return {
    startScanMeasurement,
    controller,
  };
}


export function ScanCommitProbe({ controller }: { controller: ScanPerformanceController }) {
  // No dependency array by design: this runs after every parent business-state
  // commit. `controller.commit()` is a no-op unless a scan is being measured.
  useLayoutEffect(() => {
    controller.commit();
  });
  return null;
}

export function ScanPerformanceBadge({
  controller,
  className,
}: {
  controller: ScanPerformanceController;
  className?: string;
}) {
  const sample = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (!sample) return null;

  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tabular-nums',
        sample.commitMs < 10
          ? 'bg-green-500/15 text-green-600'
          : sample.commitMs < 16.7
            ? 'bg-amber-500/15 text-amber-600'
            : 'bg-red-500/15 text-red-600',
        className,
      )}
      title="JS = barkod handler süresi. UI = gerçek iş güncellemesinin React commit süresi."
    >
      <span className="font-normal opacity-60">JS {Math.round(sample.jsMs)} · </span>
      UI {Math.round(sample.commitMs)} ms
    </span>
  );
}
