// hooks/useBarcodeParser.ts
'use client';

import { useMemo } from 'react';
import type { BarcodeFormat } from '@/lib/barcode';
import type { ParsedBarcode, ProductCode } from '@/lib/types';
import { useSafeBarcodeFormats } from './useSafeBarcodeFormats';
import { parseAnyBarcode, parseAllBarcodes, resolveProductFromParsed, parseAndResolveBarcode } from '@/lib/barcode';


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
   * This function tries all formats and picks the one that actually matches a product.
   * If no product match is found, it falls back to the highest scoring format.
   * @param codeRaw The raw barcode string.
   * @returns The best matching ParsedBarcode object or null.
   */
  function parseAuto(codeRaw: string, products: ProductCode[]): (ParsedBarcode & { product?: ProductCode | undefined; }) | null {
    const code = codeRaw?.trim() ?? '';
    if (!code) return null;

    // Get all possible parse results, sorted by score
    const allResults = parseAllBarcodes(code, formats);
    if (allResults.length === 0) return null;

    // Try each result and return the first one that matches a product
    for (const parsed of allResults) {
      const resolved = resolveProductFromParsed(parsed, products);
      if (resolved.product) {
        console.log('[parseAuto] Found product match with format:', parsed.matchedFormatId);
        return resolved;
      }
    }

    // No product found, fall back to highest scoring result
    console.log('[parseAuto] No product match found, using highest scoring format:', allResults[0].matchedFormatId);
    return resolveProductFromParsed(allResults[0], products);
  }

  return { parseAuto, parseWithFormat, formats, loading, parseAnyBarcode, resolveProductFromParsed, parseAndResolveBarcode };
}
