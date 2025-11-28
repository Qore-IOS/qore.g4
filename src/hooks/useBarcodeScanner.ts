
'use client';

import { RefObject, useEffect, useCallback } from 'react';

type Options = {
  enabled?: boolean;
  submitKey?: 'Enter' | 'Tab'; // default 'Enter'
};

export function useBarcodeScanner(
  onScan: (value: string) => void,
  inputRef: RefObject<HTMLInputElement>,
  opts: Options = {}
) {
  const { enabled = true, submitKey = 'Enter' } = opts;

  const handleManualKeyUp = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === submitKey) {
        const value = e.currentTarget.value.trim();
        if (value) {
            onScan(value);
            e.currentTarget.value = '';
        }
    }
  }, [onScan, submitKey]);
  
  const handleCameraScanSuccess = useCallback((scannedBarcode: string) => {
    if (scannedBarcode) {
        onScan(scannedBarcode);
    }
  }, [onScan]);

  useEffect(() => {
    const el = inputRef?.current;
    if (!enabled || !el) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== submitKey || e.target !== el) return;
      const value = (el as HTMLInputElement).value.trim();
      if (!value) return;
      e.preventDefault();
      onScan(value);
      (el as HTMLInputElement).value = '';
    };
    
    // The type assertion for addEventListener is needed because the specific KeyboardEvent type
    // for the listener is more specific than the general EventListener type.
    el.addEventListener('keydown', handler as EventListener);
    return () => el.removeEventListener('keydown', handler as EventListener);
  }, [enabled, inputRef, onScan, submitKey]);


  return { handleManualKeyUp, handleCameraScanSuccess };
}

export default useBarcodeScanner;
