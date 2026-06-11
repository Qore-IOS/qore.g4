'use client';
// Cihaz Üstü Reaktif Durumu (Reagent Status) TXT/CSV ayrıştırıcı.
// Referans uygulamadan (batuhanue/reagent · src/lib/txt/parse_reagent_txt.ts) port edildi.
import type { ReagentRow } from './parse-reagent';

type HeaderRanges = {
  test?: [number, number];
  type?: [number, number];
  tests?: [number, number]; // "Available Tests"
};

const TRIM = (s: string) => (s ?? '').trim().replace(/^\uFEFF/, '');
const toInt = (s: string) => {
  const t = (s ?? '').replace(/[^0-9-]/g, '');
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};
const norm = (s: string) =>
  TRIM(s)
    .toLowerCase()
    .replaceAll('\t', ' ')
    .replaceAll('.', '')
    .replaceAll(',', '')
    .replaceAll(':', '')
    .replace(/\s+/g, ' ');

function shouldSkipLine(line: string): boolean {
  const l = norm(line);
  return (
    !l ||
    l.includes('reagent status') ||
    l.startsWith('module ') ||
    l.includes('including reagent manager') ||
    /^page\s+\d+/i.test(l) ||
    /^[-]{3,}$/.test(line.replace(/\s/g, '')) ||
    l === 'total' ||
    l.startsWith('total ')
  );
}

function indexOfWord(lc: string, word: string): number {
  for (let i = 0; i <= lc.length - word.length; i++) {
    if (lc.slice(i, i + word.length) !== word) continue;
    const pre = i === 0 ? ' ' : lc[i - 1];
    const post = i + word.length >= lc.length ? ' ' : lc[i + word.length];
    if (!/[a-z]/.test(pre) && !/[a-z]/.test(post)) return i;
  }
  return -1;
}

function makeHeaderRanges(headerLine: string): HeaderRanges | null {
  const lc = headerLine.toLowerCase();
  const starts: { key: keyof HeaderRanges; x: number }[] = [];
  const posTest = indexOfWord(lc, 'test');
  const posType = indexOfWord(lc, 'type');
  const posTests = indexOfWord(lc, 'tests');

  if (posTest >= 0) starts.push({ key: 'test', x: posTest });
  if (posType >= 0) starts.push({ key: 'type', x: posType });
  if (posTests >= 0) starts.push({ key: 'tests', x: posTests });

  if (!starts.find((s) => s.key === 'test') || !starts.find((s) => s.key === 'tests')) {
    return null;
  }

  starts.sort((a, b) => a.x - b.x);
  const ranges: HeaderRanges = {};
  for (let i = 0; i < starts.length; i++) {
    const cur = starts[i];
    const next = starts[i + 1];
    const L = cur.x;
    const R = next ? Math.floor((cur.x + next.x) / 2) : 10000;
    (ranges as any)[cur.key] = [L, R] as [number, number];
  }
  return ranges;
}

const sliceField = (line: string, rg?: [number, number]) =>
  rg ? line.slice(rg[0], Math.min(rg[1], line.length)).trim() : '';

export async function parseReagentTxtFiles(files: File[]): Promise<ReagentRow[]> {
  const out: ReagentRow[] = [];

  for (const f of files) {
    const text = (await f.text()).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    if (!lines.length) continue;

    let header: HeaderRanges | null = null;
    let lastTest = '';
    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const raw = TRIM(lines[i]);
      if (!raw) continue;

      if (!header && i < 50 && norm(raw).includes('test') && norm(raw).includes('tests')) {
        const r = makeHeaderRanges(raw);
        if (r) {
          header = r;
          lastTest = '';
          continue;
        }
      }

      if (!header) continue;
      if (shouldSkipLine(raw)) continue;

      const testTxt = sliceField(raw, header.test);
      const typeTxt = sliceField(raw, header.type);
      const testsTxt = sliceField(raw, header.tests);

      const test = (testTxt || lastTest).trim();
      if (!test) continue;
      lastTest = test;

      if (typeTxt && norm(typeTxt) !== 'assay') continue;

      const available = toInt(testsTxt);
      if (available <= 0) continue;

      const key = `${test}|${available}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ test, available, src: f.name });
    }
  }

  return out;
}
