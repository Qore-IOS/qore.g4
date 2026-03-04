// src/lib/barcode.ts
import { ExpiryPattern, PositionDef, ProductCode } from './types';
import { sanitizeGS1 } from './utils';
import { parseBarcode as legacyRocheParser } from './utils';

type Fields = { reference?: number; lot?: number; expiry?: number; serial?: number; barcodeNumber?: number };

type OldPos = { start: number; length: number };
type AnyFormat = {
  id: string;
  name: string;
  priority?: number;

  pattern?: string;
  groups?: Fields;
  expiryFormat?: ExpiryPattern;
  parseTarget?: 'reference' | 'barcodeNumber';

  strategy?: 'positional' | 'regex' | 'legacy_roche';
  totalLength?: number;
  reference?: OldPos;
  lot?: OldPos;
  expiry?: (OldPos & { pattern?: ExpiryPattern }) | undefined;
  serial?: OldPos;
  trackSerial?: boolean;
  trackLot?: boolean; // Ensure trackLot is part of the type

  regex?: string;
  fields?: Fields;

  active?: boolean;
};

type Compiled = {
  f: AnyFormat;
  re: RegExp | null;
  fields: Fields;
  expiryPattern?: ExpiryPattern;
  strategy?: string;
};

export function normalizeExpiry(raw: string, pattern?: ExpiryPattern): string {
  const s = (raw || '').trim();
  if (!s) return '';
  try {
    if (pattern === 'YYYYMMDD' && /^\d{8}$/.test(s)) return `${s.slice(6,8)}.${s.slice(4,6)}.${s.slice(0,4)}`;
    if (pattern === 'YYMMDD' && /^\d{6}$/.test(s)) {
      const yy = Number(s.slice(0,2));
      const full = yy >= 70 ? `19${s.slice(0,2)}` : `20${s.slice(0,2)}`;
      return `${s.slice(4,6)}.${s.slice(2,4)}.${full}`;
    }
    if (pattern === 'DDMMYYYY' && /^\d{8}$/.test(s)) return `${s.slice(0,2)}.${s.slice(2,4)}.${s.slice(4,8)}`;
    if (pattern === 'MMYY' && /^\d{4}$/.test(s)) return `01.${s.slice(0,2)}.20${s.slice(2,4)}`;
    if (pattern === 'MMYYYY' && /^\d{6}$/.test(s)) return `01.${s.slice(0,2)}.${s.slice(2,6)}`;
  } catch {}
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
  return s;
}

export function buildRegexFromPositional(fmt: AnyFormat): { re: RegExp; fields: Fields } {
  const defs: Array<{ key: keyof Fields; start: number; length: number }> = [];
  if (fmt.reference) defs.push({ key: 'reference', ...fmt.reference });
  if (fmt.trackLot !== false && fmt.lot) defs.push({ key: 'lot', ...fmt.lot });
  if (fmt.trackLot !== false && fmt.expiry) defs.push({ key: 'expiry', start: fmt.expiry.start, length: fmt.expiry.length });
  
  // Only include serial if trackSerial is explicitly true
  if (fmt.trackSerial === true && fmt.serial) defs.push({ key: 'serial', ...fmt.serial });

  defs.sort((a,b) => a.start - b.start);

  let pattern = '^';
  let cursor = 1;
  const fields: Fields = {};
  let gi = 1;

  for (const d of defs) {
    const gap = d.start - cursor;
    if (gap > 0) pattern += `.{${gap}}`;
    pattern += `(.{${d.length}})`;
    fields[d.key] = gi++;
    cursor = d.start + d.length;
  }
  
  // If serial tracking is on but no specific position is defined, capture the rest
  if (fmt.trackSerial && !fmt.serial?.start) {
      pattern += '(.*)';
      fields['serial'] = gi;
  } else if (!fmt.trackSerial) { // if serial tracking is off, capture rest as remainder but dont assign to serial
      pattern += '(.*)';
  } else {
      pattern += '.*'; // if serial is defined, it's already in the loop
  }
  
  pattern += '$';

  return { re: new RegExp(pattern), fields };
}


export function inferSerialFromRemainder(
  fullString: string,
  takenParts: Array<PositionDef | undefined>
): string | undefined {
    const ranges = takenParts
      .filter((p): p is PositionDef => !!p && p.start > 0 && p.length > 0)
      .map(p => ({ start: p.start - 1, end: p.start - 1 + p.length }))
      .sort((a, b) => a.start - b.start);
  
    let remainder = '';
    let lastIndex = 0;
  
    for (const range of ranges) {
      if (range.start > lastIndex) {
        remainder += fullString.substring(lastIndex, range.start);
      }
      lastIndex = range.end;
    }
  
    if (lastIndex < fullString.length) {
      remainder += fullString.substring(lastIndex);
    }
  
    return remainder.trim() || undefined;
}

function compileFormat(f: AnyFormat): Compiled {
  try {
    const cleanRegex = (source: string): RegExp => {
        const m = source.match(/^\/(.+)\/([gimsuy]*)$/);
        const body = m ? m[1] : source;
        const flags = m ? m[2].replace(/[gy]/g, '') : '';
        const anchored = body.startsWith('^') ? body : `^${body}`;
        const final = anchored.endsWith('$') ? anchored : `${anchored}$`;
        return new RegExp(final, flags);
    };

    if (f.strategy === 'positional') {
      const { re, fields } = buildRegexFromPositional(f);
      return { f, re, fields, expiryPattern: f.expiry?.pattern, strategy: 'positional' };
    }
    if (f.strategy === 'regex' && f.regex) {
      return { f, re: cleanRegex(f.regex), fields: f.fields || {}, expiryPattern: f.expiry?.pattern, strategy: 'regex' };
    }
    if (f.strategy === 'legacy_roche') {
      return { f, re: null, fields: {}, strategy: 'legacy_roche' };
    }
  } catch (e) {
    console.warn('Barcode format could not be compiled:', e, f);
  }
  return { f, re: null, fields: {} };
}

export type ParsedGeneric = {
  stokKodu?: string;
  lotNumarasi?: string;
  miadFormatted?: string;
  seriNumarasi?: string;
  barcodeNumber?: string;
  matchedFormatId?: string;
  remainder?: string;
};

export type BulkSerialQrPayload = {
  t: 'serial_bulk';
  v: 1;
  barcodes: string[];
};

const BULK_SERIAL_QR_PREFIX = '/qr/serial-bulk?d=';

const toB64Url = (input: string): string => {
  const base64 = typeof window !== 'undefined'
    ? btoa(unescape(encodeURIComponent(input)))
    : Buffer.from(input, 'utf8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromB64Url = (b64url: string): string => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  if (typeof window !== 'undefined') {
    return decodeURIComponent(escape(atob(padded)));
  }
  return Buffer.from(padded, 'base64').toString('utf8');
};

export function encodeBulkSerialQrPayload(barcodes: string[]): string {
  const payload: BulkSerialQrPayload = {
    t: 'serial_bulk',
    v: 1,
    barcodes: Array.from(new Set((barcodes || []).map(b => (b || '').trim()).filter(Boolean))),
  };
  return `/qr/serial-bulk?d=${toB64Url(JSON.stringify(payload))}`;
}

export function decodeBulkSerialQrPayload(raw: string): string[] | null {
  const value = (raw || '').trim();
  if (!value) return null;
  if (!value.includes(BULK_SERIAL_QR_PREFIX)) return null;

  try {
    const url = value.startsWith('http') ? new URL(value) : new URL(value, 'https://qore.local');
    if (!url.pathname.includes('/qr/serial-bulk')) return null;
    const encoded = url.searchParams.get('d');
    if (!encoded) return null;
    const payload = JSON.parse(fromB64Url(encoded)) as BulkSerialQrPayload;
    if (payload?.t !== 'serial_bulk' || payload?.v !== 1 || !Array.isArray(payload.barcodes)) return null;
    const unique = Array.from(new Set(payload.barcodes.map(v => (v || '').trim()).filter(Boolean)));
    return unique.length > 0 ? unique : null;
  } catch {
    return null;
  }
}

export function parseAnyBarcode(rawInput: string, formats: AnyFormat[]): ParsedGeneric | null {
  const raw = (rawInput || '').trim();
  if (!raw) return null;

  const candidates = Array.from(new Set([raw, sanitizeGS1?.(raw) || raw]));
  const compiled = (formats || []).map(compileFormat);

  const results: Array<ParsedGeneric & { formatPriority?: number }> = [];

  const score = (p: ParsedGeneric & { formatPriority?: number } | null): number => {
    if (!p) return -1;
    let s = 0;

    // Priority bonus: Lower priority number = Higher score bonus
    // Priority 0 gets +1100, Priority 1 gets +1000, Priority 2 gets +900, etc.
    // This ensures user-defined priority always wins over field completeness
    // Note: Using typeof check because 0 is a valid priority (falsy in JS)
    // If priority is undefined, treat it as lowest priority (10)
    const effectivePriority = typeof p.formatPriority === 'number' ? p.formatPriority : 10;
    const priorityBonus = Math.max(0, 1100 - (effectivePriority * 100));
    s += priorityBonus;

    // Field completeness scoring (secondary to priority)
    if (p.stokKodu || p.barcodeNumber) s += 20;
    if (p.lotNumarasi) s += 20;
    if (p.seriNumarasi) s += 25;
    if (p.miadFormatted) s += 15;
    if (!p.remainder || p.remainder.length === 0) s += 10;
    if (p.lotNumarasi && p.seriNumarasi) s += 5;
    return s;
  };

  for (const candidate of candidates) {
    for (const c of compiled) {
      try {
        let parsed: (ParsedGeneric & { formatPriority?: number }) | null = null;
        if (c.strategy === 'legacy_roche') {
          if (/^\d{61}$/.test(candidate)) {
            const out = legacyRocheParser(candidate);
            if (out) {
              parsed = {
                matchedFormatId: c.f.id,
                stokKodu: out.refNo,
                lotNumarasi: out.lotNumarasi,
                miadFormatted: out.miadFormatted,
                seriNumarasi: out.seriNumarasi,
                formatPriority: c.f.priority,
              };
            }
          }
        } else if (c.re) {
          if (c.strategy === 'positional' && c.f.totalLength && candidate.length !== c.f.totalLength) {
            continue;
          }
          const m = candidate.match(c.re);
          if (m) {
            const ref = c.fields.reference ? (m[c.fields.reference] || '').trim() : undefined;
            const lot = c.f.trackLot !== false && c.fields.lot ? (m[c.fields.lot] || '').trim() : undefined;
            const expRaw = c.f.trackLot !== false && c.fields.expiry ? (m[c.fields.expiry] || '').trim() : undefined;
            const miad = expRaw ? normalizeExpiry(expRaw, c.expiryPattern) : undefined;

            let seriNumarasi: string | undefined;

            if (c.f.trackSerial === true) {
                const serialFromRegex = c.fields.serial ? (m[c.fields.serial] || '').trim() : undefined;

                if (serialFromRegex) {
                    seriNumarasi = serialFromRegex;
                } else {
                    const takenParts = [c.f.reference, c.f.lot, c.f.expiry, c.f.serial].filter(Boolean) as PositionDef[];
                    const inferredSerial = inferSerialFromRemainder(candidate, takenParts);
                    seriNumarasi = inferredSerial;
                }
            }

            const udi = c.fields.barcodeNumber ? (m[c.fields.barcodeNumber] || '').trim() : undefined;

            parsed = {
              matchedFormatId: c.f.id,
              stokKodu: c.f.parseTarget === 'barcodeNumber' ? undefined : (ref || undefined),
              barcodeNumber: c.f.parseTarget === 'barcodeNumber' ? (udi || ref || undefined) : (udi || undefined),
              lotNumarasi: lot || undefined,
              miadFormatted: miad,
              seriNumarasi: seriNumarasi || undefined,
              formatPriority: c.f.priority,
            };
          }
        }
        if (parsed) results.push(parsed);
      } catch (e) {
        console.warn(`Format error for "${c.f.name}":`, e);
      }
    }
  }
  
  if (results.length === 0) {
    return null;
  }

  // Sort by score and get the best match
  const sortedResults = results.sort((a,b) => score(b) - score(a));
  const bestMatch = sortedResults[0];

  // Debug: log all candidates with their scores
  if (sortedResults.length > 1) {
    console.log('[parseAnyBarcode] All candidates:', sortedResults.map(r => ({
      formatId: r.matchedFormatId,
      stokKodu: r.stokKodu,
      lotNumarasi: r.lotNumarasi,
      priority: r.formatPriority,
      score: score(r)
    })));
  }

  console.log('[parseAnyBarcode] Best match:', {
    formatId: bestMatch.matchedFormatId,
    stokKodu: bestMatch.stokKodu,
    lotNumarasi: bestMatch.lotNumarasi,
    seriNumarasi: bestMatch.seriNumarasi,
    priority: bestMatch.formatPriority,
    score: score(bestMatch)
  });

  // Remove formatPriority from the result as it's only used for scoring
  const { formatPriority, ...result } = bestMatch;
  return result;
}

/**
 * Parses a barcode against all formats and returns ALL matching results, sorted by score.
 * This is useful when you need to try multiple formats and pick the one that matches a product.
 */
export function parseAllBarcodes(rawInput: string, formats: AnyFormat[]): ParsedGeneric[] {
  const raw = (rawInput || '').trim();
  if (!raw) return [];

  const candidates = Array.from(new Set([raw, sanitizeGS1?.(raw) || raw]));
  const compiled = (formats || []).map(compileFormat);

  const results: Array<ParsedGeneric & { formatPriority?: number }> = [];

  const score = (p: ParsedGeneric & { formatPriority?: number } | null): number => {
    if (!p) return -1;
    let s = 0;
    const effectivePriority = typeof p.formatPriority === 'number' ? p.formatPriority : 10;
    const priorityBonus = Math.max(0, 1100 - (effectivePriority * 100));
    s += priorityBonus;
    if (p.stokKodu || p.barcodeNumber) s += 20;
    if (p.lotNumarasi) s += 20;
    if (p.seriNumarasi) s += 25;
    if (p.miadFormatted) s += 15;
    if (!p.remainder || p.remainder.length === 0) s += 10;
    if (p.lotNumarasi && p.seriNumarasi) s += 5;
    return s;
  };

  for (const candidate of candidates) {
    for (const c of compiled) {
      try {
        let parsed: (ParsedGeneric & { formatPriority?: number }) | null = null;
        if (c.strategy === 'legacy_roche') {
          if (/^\d{61}$/.test(candidate)) {
            const out = legacyRocheParser(candidate);
            if (out) {
              parsed = {
                matchedFormatId: c.f.id,
                stokKodu: out.refNo,
                lotNumarasi: out.lotNumarasi,
                miadFormatted: out.miadFormatted,
                seriNumarasi: out.seriNumarasi,
                formatPriority: c.f.priority,
              };
            }
          }
        } else if (c.re) {
          if (c.strategy === 'positional' && c.f.totalLength && candidate.length !== c.f.totalLength) {
            continue;
          }
          const m = candidate.match(c.re);
          if (m) {
            const ref = c.fields.reference ? (m[c.fields.reference] || '').trim() : undefined;
            const lot = c.f.trackLot !== false && c.fields.lot ? (m[c.fields.lot] || '').trim() : undefined;
            const expRaw = c.f.trackLot !== false && c.fields.expiry ? (m[c.fields.expiry] || '').trim() : undefined;
            const miad = expRaw ? normalizeExpiry(expRaw, c.expiryPattern) : undefined;

            let seriNumarasi: string | undefined;
            if (c.f.trackSerial === true) {
              const serialFromRegex = c.fields.serial ? (m[c.fields.serial] || '').trim() : undefined;
              if (serialFromRegex) {
                seriNumarasi = serialFromRegex;
              } else {
                const takenParts = [c.f.reference, c.f.lot, c.f.expiry, c.f.serial].filter(Boolean) as PositionDef[];
                const inferredSerial = inferSerialFromRemainder(candidate, takenParts);
                seriNumarasi = inferredSerial;
              }
            }

            const udi = c.fields.barcodeNumber ? (m[c.fields.barcodeNumber] || '').trim() : undefined;

            parsed = {
              matchedFormatId: c.f.id,
              stokKodu: c.f.parseTarget === 'barcodeNumber' ? undefined : (ref || undefined),
              barcodeNumber: c.f.parseTarget === 'barcodeNumber' ? (udi || ref || undefined) : (udi || undefined),
              lotNumarasi: lot || undefined,
              miadFormatted: miad,
              seriNumarasi: seriNumarasi || undefined,
              formatPriority: c.f.priority,
            };
          }
        }
        if (parsed) results.push(parsed);
      } catch (e) {
        console.warn(`Format error for "${c.f.name}":`, e);
      }
    }
  }

  // Sort by score and return all results (without formatPriority)
  return results
    .sort((a, b) => score(b) - score(a))
    .map(({ formatPriority, ...rest }) => rest);
}

export function resolveProductFromParsed(parsed: ParsedGeneric, productCodes: ProductCode[]) {
  let product =
    (parsed.stokKodu ? productCodes.find(p => p.stokKodu === parsed.stokKodu) : undefined) ||
    (parsed.barcodeNumber ? productCodes.find(p => (p as any).barcodeNumber === parsed.barcodeNumber) : undefined);

  if (!product && parsed.matchedFormatId) {
    // Önce çoklu format desteğini kontrol et (yeni sistem)
    product = productCodes.find(p => {
      const formatIds = (p as any).barcodeFormatIds;
      const singleFormatId = (p as any).barcodeFormatId;

      if (Array.isArray(formatIds) && formatIds.includes(parsed.matchedFormatId)) {
        return true;
      }
      // Geriye uyumluluk için tek format kontrolü (eski sistem)
      return singleFormatId === parsed.matchedFormatId;
    });
  }

  const result = { ...parsed, stokKodu: product?.stokKodu ?? parsed.stokKodu, product };
  return result;
}

export type BarcodeFormat = AnyFormat;
export type { ExpiryPattern, PositionDef };
