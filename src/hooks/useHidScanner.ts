'use client';
import { useEffect, useRef } from 'react';

type UseHidScannerOptions = {
  enabled?: boolean;
  minLength?: number;            // minimum payload length accepted on terminator
  idleMs?: number;               // clear stale buffer after this much silence
  maxScanMs?: number;            // cap on a single scan's buffer duration
  terminators?: string[];        // e.g. ['Enter', 'Tab']
  allowDuringInputs?: boolean;   // allow scan even if an input is focused
  onScan: (payload: { raw: string }) => void;
};

function toPrintableChar(e: KeyboardEvent): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;

  if (e.key && e.key.length === 1) return e.key;

  switch (e.code) {
    case 'Numpad0': return '0';
    case 'Numpad1': return '1';
    case 'Numpad2': return '2';
    case 'Numpad3': return '3';
    case 'Numpad4': return '4';
    case 'Numpad5': return '5';
    case 'Numpad6': return '6';
    case 'Numpad7': return '7';
    case 'Numpad8': return '8';
    case 'Numpad9': return '9';
    case 'NumpadDecimal': return '.';
    case 'NumpadDivide': return '/';
    case 'NumpadMultiply': return '*';
    case 'NumpadSubtract': return '-';
    case 'NumpadAdd': return '+';
    default: return null;
  }
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = (el as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable) return true;
  // Treat dialogs/modals as editable by default
  if ((el as HTMLElement).closest?.('[role="dialog"]')) return true;
  return false;
}

export default function useHidScanner({
  enabled = true,
  minLength = 4,
  idleMs = 1500,
  maxScanMs = 10000,
  terminators,
  allowDuringInputs = true,
  onScan,
}: UseHidScannerOptions) {
  const buf = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number>(0);

  // All options go through refs so the effect that owns the window listener
  // does NOT re-run on every parent render (which was tearing down the
  // listener and dropping keystrokes from slow HID scanners like the
  // Sunlux XL-9610). Only `enabled` toggles the effect.
  const onScanRef = useRef(onScan);
  const minLengthRef = useRef(minLength);
  const idleMsRef = useRef(idleMs);
  const maxScanMsRef = useRef(maxScanMs);
  const terminatorsRef = useRef<string[]>(terminators ?? ['Enter', 'Tab']);
  const allowDuringInputsRef = useRef(allowDuringInputs);

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { minLengthRef.current = minLength; }, [minLength]);
  useEffect(() => { idleMsRef.current = idleMs; }, [idleMs]);
  useEffect(() => { maxScanMsRef.current = maxScanMs; }, [maxScanMs]);
  useEffect(() => {
    terminatorsRef.current = terminators ?? ['Enter', 'Tab'];
  }, [terminators]);
  useEffect(() => { allowDuringInputsRef.current = allowDuringInputs; }, [allowDuringInputs]);

  useEffect(() => {
    if (!enabled) return;

    const clearBuffer = () => {
      buf.current = '';
      startedAt.current = 0;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };

    const commitOnTerminator = () => {
      const raw = buf.current.replace(/[\x00-\x1F\x7F]/g, ''); // strip control chars
      clearBuffer();
      if (raw && raw.length >= minLengthRef.current) {
        onScanRef.current({ raw });
      }
    };

    // Slow HID scanners can take several hundred ms between characters.
    // We never commit on idle — only on an explicit terminator (Enter/Tab).
    // The idle timer just clears a stale buffer so it can't bleed into
    // the next scan. maxScanMs caps a single scan's total duration.
    const scheduleIdleClear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { clearBuffer(); }, idleMsRef.current);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!allowDuringInputsRef.current && isEditable(document.activeElement)) return;

      if (terminatorsRef.current.includes(e.key)) {
        if (buf.current.length > 0) {
          if (e.key === 'Tab') e.preventDefault();
          commitOnTerminator();
        }
        return;
      }

      const nextChar = toPrintableChar(e);
      if (nextChar) {
        const now = Date.now();
        if (buf.current.length === 0) {
          startedAt.current = now;
        }
        if (startedAt.current && now - startedAt.current > maxScanMsRef.current) {
          clearBuffer();
          startedAt.current = now;
        }
        buf.current += nextChar;
        scheduleIdleClear();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled]);
}
