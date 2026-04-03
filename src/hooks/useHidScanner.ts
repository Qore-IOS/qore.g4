'use client';
import { useEffect, useRef } from 'react';

type UseHidScannerOptions = {
  enabled?: boolean;
  minLength?: number;            // minimum payload length for idle commit
  idleMs?: number;               // commit after idle
  maxScanMs?: number;            // force commit after this duration even if under minLength
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
  minLength = 10,
  idleMs = 250,
  maxScanMs = 10000,
  terminators = ['Enter', 'Tab'],
  allowDuringInputs = true,
  onScan,
}: UseHidScannerOptions) {
  const buf = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      buf.current = '';
      startedAt.current = 0;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };

    const commit = (reason: 'idle' | 'terminator') => {
      const raw = buf.current.replace(/[\x00-\x1F\x7F]/g, ''); // strip control chars
      if (!raw) {
        reset();
        return;
      }

      if (reason === 'idle' && raw.length < minLength) {
        const elapsed = startedAt.current ? (Date.now() - startedAt.current) : 0;
        if (elapsed < maxScanMs) {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit('idle'), idleMs);
          return;
        }
      }

      reset();
      onScan({ raw });
    };

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => commit('idle'), idleMs);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!allowDuringInputs && isEditable(document.activeElement)) return;

      if (terminators.includes(e.key)) {
        if (buf.current.length > 0) {
          if (e.key === 'Tab') e.preventDefault();
          commit('terminator');
        }
        return;
      }

      const nextChar = toPrintableChar(e);
      if (nextChar) {
        if (buf.current.length === 0) {
          startedAt.current = Date.now();
        }
        buf.current += nextChar;
        schedule();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, minLength, idleMs, maxScanMs, terminators, allowDuringInputs, onScan]);
}
