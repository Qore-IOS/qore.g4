
'use client';
import { useEffect, useRef } from 'react';

type UseHidScannerOptions = {
  enabled?: boolean;
  minLength?: number;            // e.g. 61 for Roche
  idleMs?: number;               // commit after idle
  terminators?: string[];        // e.g. ['Enter', 'Tab']
  allowDuringInputs?: boolean;   // allow scan even if an input is focused
  onScan: (payload: { raw: string }) => void;
};

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
  terminators = ['Enter', 'Tab'],
  allowDuringInputs = true,
  onScan,
}: UseHidScannerOptions) {
  const buf = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      buf.current = '';
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };

    const commit = () => {
      const raw = buf.current.replace(/[\x00-\x1F\x7F]/g, ''); // strip control chars
      reset();
      if (!raw) return;
      
      if (raw.length > 0) {
        onScan({ raw });
      }
    };

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(commit, idleMs);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!allowDuringInputs && isEditable(document.activeElement)) return;

      if (terminators.includes(e.key)) {
        if(buf.current.length > 0) {
          if (e.key === 'Tab') e.preventDefault();
          commit();
        }
        return;
      }
      
      if (!e.key) {
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buf.current += e.key;
        schedule();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, idleMs, terminators, allowDuringInputs, onScan]);
}
