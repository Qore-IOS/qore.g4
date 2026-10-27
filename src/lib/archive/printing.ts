'use client';

import { db } from '../data/client';
import { addDoc, collection, serverTimestamp } from '../data/client';
import type { Rack } from '@/lib/types';
import { todayYmd } from './rack-utils';

/**
 * Builds a simple ZPL (Zebra Programming Language) string for a 3x4 cm label.
 */
export function buildZplForRack(rackId: string, opts: { widthMm?: number, heightMm?: number } = {}): string {
    const { widthMm = 30, heightMm = 40 } = opts;
    const widthDots = Math.round(widthMm * 8);
    const heightDots = Math.round(heightMm * 8);
    const qrSize = 5;

    const zpl = `
^XA
^PW${widthDots}
^LL${heightDots}
^LS0
^FO30,30^A0N,30,30^FD${rackId}^FS
^FO60,80^BQN,2,${qrSize}^FDQA,${rackId}^FS
^XZ
`;
    console.log(`[Printing] Generated ZPL for Rack ID: ${rackId}`);
    return zpl.trim();
}

/**
 * Opens an HTML document in a new tab for printing.
 * Useful for non-ZPL printers or as a fallback.
 */
export async function openHtmlTag(htmlContent: string, toast: any) {
  try {
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    URL.revokeObjectURL(url);
  } catch (e: any) {
    toast({
      title: 'Yazdırma Hatası',
      description: 'Yeni sekme açılamadı. Tarayıcınızın pop-up engelleyicisini kontrol edin.',
      variant: 'destructive',
    });
  }
}
