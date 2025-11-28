'use client';
import { db } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import type { Rack } from '@/lib/types';
import { todayYmd } from './rack-utils';

type Printer = { id: string; name: string };

/**
 * Mocks fetching a list of available label printers from the system.
 */
export async function listPrinters(): Promise<Printer[]> {
  // In a real app, this would make an API call to a local print service.
  // For now, we return a static list for demonstration.
  console.log('[Printing] Listing available printers...');
  return Promise.resolve([
    { id: 'zpl_printer_1', name: 'Zebra ZD420 (Lobi)' },
    { id: 'zpl_printer_2', name: 'Zebra GK420d (Arşiv Odası)' },
  ]);
}


/**
 * Builds a simple ZPL (Zebra Programming Language) string for a 3x4 cm label.
 * This label will only contain the rack ID as a QR code and human-readable text.
 */
export function buildZplForRack(rackId: string, opts: { widthMm?: number, heightMm?: number } = {}): string {
    const { widthMm = 30, heightMm = 40 } = opts;
    
    // Assuming 8 dpmm (203 dpi) printer
    const widthDots = Math.round(widthMm * 8);
    const heightDots = Math.round(heightMm * 8);
    const qrSize = 5; // QR code module size

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
 * Mocks sending a raw ZPL string to a selected printer.
 */
export async function sendRawZpl(printerId: string, zpl: string): Promise<void> {
  // In a real app, this would send the ZPL to the printer service API.
  console.log(`[Printing] Sending ZPL to printer "${printerId}":\n---`);
  console.log(zpl);
  console.log('---');
  
  // No new tab or UI interaction to meet the "silent printing" requirement.
  // The actual printing is handled by the printing bridge.

  return Promise.resolve();
}
