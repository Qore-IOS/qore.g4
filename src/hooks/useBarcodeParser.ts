// hooks/useBarcodeParser.ts
'use client';

import { useMemo } from 'react';
import type { BarcodeFormat } from '@/lib/barcode';
import type { ParsedBarcode, ProductCode } from '@/lib/types';
import { useSafeBarcodeFormats } from './useSafeBarcodeFormats';
import { parseAnyBarcode, resolveProductFromParsed } from '@/lib/barcode';


/** ---------- Public Hook ---------- **/

export function useBarcodeParser() {
  const { formats, loading } = useSafeBarcodeFormats();

  /**
   * Parses a barcode string against a specific format ID.
   * This is now a thin wrapper around the new centralized parser.
   * @param codeRaw The raw barcode string.
   * @param fmtId The specific format ID to use.
   * @returns A ParsedBarcode object or null if it doesn't match.
   */
  function parseWithFormat(codeRaw: string, fmtId: string, products: ProductCode[]): (ParsedBarcode & { product?: ProductCode | undefined; }) | null {
    const code = codeRaw?.trim() ?? '';
    const fmt = formats.find(f => f.id === fmtId);
    if (!fmt || !code) return null;

    // Use the robust parser but force it to use only one format.
    const parsed = parseAnyBarcode(code, [fmt]);
    if (!parsed) return null;

    return resolveProductFromParsed(parsed, products);
  }

  /**
   * Automatically determines the best format for a given barcode.
   * This is now the primary function to use for parsing.
   * @param codeRaw The raw barcode string.
   * @returns The best matching ParsedBarcode object or null.
   */
  function parseAuto(codeRaw: string, products: ProductCode[]): (ParsedBarcode & { product?: ProductCode | undefined; }) | null {
    const code = codeRaw?.trim() ?? '';
    if (!code) return null;
    
    const parsed = parseAnyBarcode(code, formats);
    if (!parsed) return null;

    return resolveProductFromParsed(parsed, products);
  }

  return { parseAuto, parseWithFormat, formats, loading, parseAnyBarcode, resolveProductFromParsed };
}
