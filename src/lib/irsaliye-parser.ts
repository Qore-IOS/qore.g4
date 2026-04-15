'use client';
import type { ProductCode } from '@/lib/types';
import { normalizeMiad } from './date';

export interface IrsaliyeParseResult {
  stokKodu: string;
  quantity: number;
  lot?: string;
  miad?: string;
  rawLine: string;
}

type TableHeaderInfo = {
  hasLotColumn: boolean;
};

function looksLikeUtsCode(value?: string): boolean {
  if (!value) return false;
  const compact = value.replace(/\s+/g, '');
  return /^\d{11,16}$/.test(compact);
}

function sanitizeLotValue(value?: string): string | undefined {
  if (!value) return undefined;
  const token = value
    .replace(/[|;]/g, ' ')
    .match(/\b([A-Za-z0-9-]{3,})\b/)?.[1]
    ?.trim();
  if (!token) return undefined;
  if (looksLikeUtsCode(token)) return undefined;
  return token.toUpperCase();
}

function detectTableHeaderInfo(headerLine: string): TableHeaderInfo {
  return {
    hasLotColumn: /\blot\b/i.test(headerLine),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractLotByRowContext(line: string, stokKodu: string, productName?: string): string | undefined {
  const miadMatch = line.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/);
  if (!miadMatch || miadMatch.index == null) return undefined;

  let beforeMiad = line.slice(0, miadMatch.index).trim();
  beforeMiad = beforeMiad.replace(/^\s*\d{1,3}\s+/, ''); // sıra no

  const stokIdx = beforeMiad.indexOf(stokKodu);
  if (stokIdx >= 0) {
    beforeMiad = beforeMiad.slice(stokIdx + stokKodu.length).trim();
  }

  const firstToken = beforeMiad.split(/\s+/)[0];
  if (looksLikeUtsCode(firstToken)) {
    beforeMiad = beforeMiad.slice(firstToken.length).trim();
  }

  if (productName) {
    const productRegex = new RegExp(escapeRegExp(productName), 'i');
    beforeMiad = beforeMiad.replace(productRegex, ' ').trim();
  }

  const tokens = beforeMiad.match(/[A-Za-z0-9-]{3,}/g) || [];
  if (tokens.length === 0) return undefined;
  const candidate = tokens[tokens.length - 1];
  if (looksLikeUtsCode(candidate)) return undefined;
  if (productName && productName.toUpperCase().includes(candidate.toUpperCase()) && candidate.length <= 4) return undefined;
  return candidate.toUpperCase();
}

/**
 * Parses invoice text extracted from PDF or OCR.
 *
 * Strategy:
 * 1. Detect table header row (Stok Kodu, Lot, Miat, Miktar columns)
 * 2. Parse data rows after header using column-aware logic
 * 3. Fallback: line-by-line product code matching with contextual extraction
 */
export function parseIrsaliyeText(text: string, productCodes: ProductCode[]): IrsaliyeParseResult[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const results: IrsaliyeParseResult[] = [];
  const productMap = new Map(productCodes.map(p => [p.stokKodu, p]));

  console.log('[İrsaliye Parser] Total lines:', lines.length);
  console.log('[İrsaliye Parser] Lines:\n', lines.map((l, i) => `  ${i}: "${l}"`).join('\n'));

  // --- Phase 1: Try table-based parsing ---
  const tableResults = parseAsTable(lines, productCodes);
  if (tableResults.length > 0) {
    console.log('[İrsaliye Parser] Table parsing found', tableResults.length, 'items');
    return tableResults;
  }

  // --- Phase 2: Fallback line-by-line parsing ---
  console.log('[İrsaliye Parser] Table parsing failed, trying line-by-line...');
  return parseLineByLine(lines, productCodes);
}

/**
 * Table-based parsing: detects header row and parses structured data rows.
 * Typical Turkish e-irsaliye table:
 * Sıra No | Stok Kodu | UTS Kodu | Stok Adı | Lot | Miat | Ana Birim | Miktar
 */
function parseAsTable(lines: string[], productCodes: ProductCode[]): IrsaliyeParseResult[] {
  const results: IrsaliyeParseResult[] = [];

  // Find table header line
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    // Header must contain "stok kodu" or "stok adı" + some quantity/lot indicator
    if (
      (lower.includes('stok kodu') || lower.includes('stok kod')) &&
      (lower.includes('miktar') || lower.includes('adet') || lower.includes('lot') || lower.includes('miat'))
    ) {
      headerIdx = i;
      console.log('[İrsaliye Parser] Table header found at line', i, ':', lines[i]);
      break;
    }
  }

  if (headerIdx === -1) {
    console.log('[İrsaliye Parser] No table header found');
    return [];
  }

  const headerInfo = detectTableHeaderInfo(lines[headerIdx]);

  // Parse data rows after header
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];

    // Stop at footer sections
    const lowerLine = line.toLowerCase();
    if (
      lowerLine.includes('açıklama') ||
      lowerLine.includes('teslim eden') ||
      lowerLine.includes('teslim alan') ||
      lowerLine.includes('taşıyıcı') ||
      lowerLine.startsWith('not:')
    ) {
      console.log('[İrsaliye Parser] Table footer detected at line', i, ', stopping');
      break;
    }

    // Try to find a product code in this line
    const rowResult = parseTableRow(line, productCodes, headerInfo);
    if (rowResult) {
      console.log('[İrsaliye Parser] Parsed row:', JSON.stringify(rowResult));
      results.push(rowResult);
    }
  }

  return results;
}

/**
 * Parse a single table data row.
 * Expected row pattern: [sıra_no] [stok_kodu] [uts_kodu?] [stok_adı] [lot] [miat] [ana_birim?] [miktar] [birim]
 */
function parseTableRow(line: string, productCodes: ProductCode[], headerInfo: TableHeaderInfo): IrsaliyeParseResult | null {
  let stokKodu: string | undefined;
  let matchedProduct: ProductCode | undefined;

  // Find product code in the line
  for (const product of productCodes) {
    if (line.includes(product.stokKodu)) {
      stokKodu = product.stokKodu;
      matchedProduct = product;
      break;
    }
  }

  // Try matching by product name if code not found
  if (!stokKodu) {
    for (const product of productCodes) {
      if (product.stokAdi && line.toLowerCase().includes(product.stokAdi.toLowerCase())) {
        stokKodu = product.stokKodu;
        matchedProduct = product;
        break;
      }
    }
  }

  if (!stokKodu) return null;

  console.log(`[İrsaliye Parser] Found product ${stokKodu} in line: "${line}"`);

  // Remove the stok kodu and stok adı from the line to isolate remaining fields
  let remaining = line;

  // Remove sıra no from beginning (single or double digit number at start)
  remaining = remaining.replace(/^\s*\d{1,3}\s+/, '');

  // Remove stok kodu
  remaining = remaining.replace(stokKodu, ' ');

  // Remove stok adı if matched
  if (matchedProduct?.stokAdi) {
    // Escape special regex chars in product name
    const escapedName = matchedProduct.stokAdi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    remaining = remaining.replace(new RegExp(escapedName, 'i'), ' ');
  }

  console.log(`[İrsaliye Parser] Remaining after product removal: "${remaining.trim()}"`);

  // Extract all dates (dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy)
  const dateRegex = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/g;
  const dates: string[] = [];
  let dateMatch;
  while ((dateMatch = dateRegex.exec(remaining)) !== null) {
    dates.push(dateMatch[1]);
  }

  // Extract quantity: number followed by ADET/KUTU/AD or preceded by comma (e.g., "180,0 ADET")
  const qtyRegex = /(\d+[.,]\d+|\d+)\s*(?:adet|kutu|ad\b|box|pcs|ea|koli|paket)/i;
  const qtyMatch = remaining.match(qtyRegex);

  let quantity = 0;
  if (qtyMatch) {
    // Handle comma as decimal separator (180,0 -> 180)
    const qtyStr = qtyMatch[1].replace(',', '.');
    quantity = Math.round(parseFloat(qtyStr));
  }

  if (quantity <= 0) {
    // Fallback: look for standalone numbers that could be quantity (typically at end)
    const numberMatches = remaining.match(/\b(\d+[.,]\d+|\d+)\b/g);
    if (numberMatches) {
      // Take the last number that looks like a reasonable quantity
      for (let i = numberMatches.length - 1; i >= 0; i--) {
        const numStr = numberMatches[i].replace(',', '.');
        const num = Math.round(parseFloat(numStr));
        // Reasonable quantity: 1-99999, and not a lot number (lots are typically 7+ digits or alphanumeric)
        if (num > 0 && num < 100000) {
          quantity = num;
          break;
        }
      }
    }
  }

  // Extract lot: ONLY from LOT column when available
  // In table rows, lot typically appears as a number like 2509431
  let lot: string | undefined;
  let miad: string | undefined;

  // The miad is the date in the row
  if (dates.length > 0) {
    miad = normalizeMiad(dates[0]);
  }

  if (headerInfo.hasLotColumn) {
    lot = sanitizeLotValue(extractLotByRowContext(line, stokKodu, matchedProduct?.stokAdi));
  }

  // Never allow UTS code to be used as lot
  if (looksLikeUtsCode(lot)) lot = undefined;

  console.log(`[İrsaliye Parser] Extracted -> qty: ${quantity}, lot: ${lot}, miad: ${miad}`);

  if (quantity <= 0) {
    console.log(`[İrsaliye Parser] Skipping ${stokKodu}: no valid quantity found`);
    return null;
  }

  return {
    stokKodu,
    quantity,
    lot,
    miad,
    rawLine: line.trim(),
  };
}

/**
 * Fallback: line-by-line parsing for non-table or OCR text
 */
function parseLineByLine(lines: string[], productCodes: ProductCode[]): IrsaliyeParseResult[] {
  const results: IrsaliyeParseResult[] = [];
  const dateRegex = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/g;
  const qtyRegex = /(\d+[.,]?\d*)\s*(?:adet|kutu|ad\b|box|pcs|ea|koli|paket)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let stokKodu: string | undefined;

    // Find known product code
    for (const product of productCodes) {
      if (line.includes(product.stokKodu)) {
        stokKodu = product.stokKodu;
        break;
      }
    }

    if (!stokKodu) {
      for (const product of productCodes) {
        if (product.stokAdi && line.toLowerCase().includes(product.stokAdi.toLowerCase())) {
          stokKodu = product.stokKodu;
          break;
        }
      }
    }

    if (!stokKodu) continue;

    // Search this line + next 2 lines for context (lot, miad, quantity may span lines)
    const contextLines = lines.slice(i, Math.min(i + 3, lines.length)).join(' ');

    const dateMatch = contextLines.match(dateRegex);
    const qtyMatch = contextLines.match(qtyRegex);

    const miad = dateMatch ? normalizeMiad(dateMatch[0]) : undefined;

    let quantity = 0;
    if (qtyMatch) {
      quantity = Math.round(parseFloat(qtyMatch[1].replace(',', '.')));
    } else {
      // Try trailing number
      const trailingMatch = contextLines.match(/(\d+)\s*$/);
      if (trailingMatch) {
        const num = parseInt(trailingMatch[1], 10);
        if (num > 0 && num < 100000) quantity = num;
      }
    }

    // LOT başlığı zorunlu olduğundan line-by-line fallback'te lot üretme.
    let lot: string | undefined;

    if (stokKodu && quantity > 0) {
      results.push({ stokKodu, quantity, lot, miad, rawLine: line.trim() });
    }
  }

  return results;
}
