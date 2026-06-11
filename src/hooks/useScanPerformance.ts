'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export type ScanPerformanceSample = {
  /** Synchronous barcode parse and tracking-mode resolution duration. */
  jsMs: number;
  /** Time from scan handler entry until React commits the urgent UI update. */
  commitMs: number;
};

/**
 * Measures the part of barcode handling the application can keep below 10 ms.
 *
 * A paint-based double requestAnimationFrame measurement always includes one or
 * two display frames (about 16.7-33.4 ms on a 60 Hz screen), so it cannot be
 * used as a sub-10 ms application target. This hook reports synchronous JS and
 * React commit latency instead. The browser's physical paint remains bounded by
 * the display refresh rate and should be inspected separately with INP traces.
 */
export function useScanPerformance() {
  const [commitSequence, setCommitSequence] = useState(0);
  const [sample, setSample] = useState<ScanPerformanceSample | null>(null);
  const activeMeasurementRef = useRef<{
    sequence: number;
    startedAt: number;
    jsMs: number | null;
  } | null>(null);
  const nextSequenceRef = useRef(0);

  const beginScanMeasurement = useCallback(() => {
    if (typeof performance === 'undefined') return () => {};

    const sequence = ++nextSequenceRef.current;
    const startedAt = performance.now();
    activeMeasurementRef.current = { sequence, startedAt, jsMs: null };

    // This update is batched with the scan's urgent state updates. The layout
    // effect therefore runs immediately after that same React commit.
    setCommitSequence(sequence);

    // Call after barcode parsing and tracking-mode resolution, before stock
    // lookup and React state updates.
    return () => {
      const active = activeMeasurementRef.current;
      if (active?.sequence === sequence && active.jsMs === null) {
        active.jsMs = performance.now() - startedAt;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (commitSequence === 0 || typeof performance === 'undefined') return;
    const active = activeMeasurementRef.current;
    if (!active || active.sequence !== commitSequence) return;

    const commitMs = performance.now() - active.startedAt;
    setSample({
      jsMs: active.jsMs ?? commitMs,
      commitMs,
    });
  }, [commitSequence]);

  return {
    beginScanMeasurement,
    sample,
  };
}
