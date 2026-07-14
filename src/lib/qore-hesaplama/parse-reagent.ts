'use client';
// Cihaz Üstü Reaktif Durumu (Reagent Status) PDF ayrıştırıcı.
// Referans uygulamadan (batuhanue/reagent · src/lib/pdf/parse_reagent.ts) port edildi;
// QORE'nin CDN üzerinden yüklenen pdf.js örneğini (getPdfJs) kullanır.
import { getPdfJs } from '@/lib/pdf';

export type ReagentRow = { test: string; available: number; src: string };

const HEADER_TOKENS = ['Test', 'Reason', 'Available', 'Type', 'Pos.', 'Remaining', 'Lot ID', 'Exp. Date'];

function toNum(s: string): number {
  const t = (s || '').replace(/[^0-9.-]/g, '');
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

type LineItem = { x: number; str: string };
type Line = { y: number; items: LineItem[] };

function groupByLines(items: any[], yTol = 4): Line[] {
  const lines: Line[] = [];
  for (const it of items) {
    const str = String(it.str || '').trim();
    if (!str) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let line = lines.find((L) => Math.abs(L.y - y) <= yTol);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, str });
  }
  lines.sort((a, b) => b.y - a.y);
  for (const L of lines) L.items.sort((a, b) => a.x - b.x);
  return lines;
}

function detectColumns(lines: Line[]): Record<string, [number, number]> | null {
  for (const L of lines) {
    const text = L.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').toLowerCase();
    const hasTest = text.includes('test');
    const hasAvail = text.includes('available');
    if (hasTest && hasAvail && text.includes('reason') && (text.includes('lot') || text.includes('exp'))) {
      const map: Record<string, number> = {};
      for (const it of L.items) {
        const t = it.str.trim();
        const k = HEADER_TOKENS.find((h) => t.toLowerCase().startsWith(h.toLowerCase()));
        if (k && !(k in map)) map[k] = it.x;
        if (t.toLowerCase().startsWith('available test')) map['Available'] = it.x;
      }
      const ordered = Object.entries(map).map(([t, x]) => ({ t, x })).sort((a, b) => a.x - b.x);
      if (!ordered.length) continue;
      const ranges: Record<string, [number, number]> = {};
      for (let i = 0; i < ordered.length; i++) {
        const cur = ordered[i];
        const nxt = ordered[i + 1];
        const right = nxt ? (cur.x + nxt.x) / 2 : cur.x + 9999;
        ranges[cur.t] = [cur.x - 1, right];
      }
      return ranges;
    }
  }
  return null;
}

function takeInRange(items: LineItem[], range?: [number, number]): string {
  if (!range) return '';
  const [L, R] = range;
  return items.filter((i) => i.x >= L && i.x < R).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
}

function shouldSkipLine(joinedLower: string): boolean {
  return (
    !joinedLower ||
    joinedLower.includes('reagent status') ||
    joinedLower.startsWith('module ') ||
    joinedLower.includes('including reagent manager') ||
    joinedLower.includes('reagent manager') ||
    joinedLower.startsWith('system name') ||
    joinedLower.startsWith('page ') ||
    joinedLower.startsWith('total ')
  );
}

function sanitizeTestName(name: string): string {
  const bad = ['expired', 'yellow'];
  let t = name.trim().replace(/\s+/g, ' ');
  for (const b of bad) {
    t = t.replace(new RegExp(`\\s+${b}$`, 'i'), '');
    t = t.replace(new RegExp(`^${b}\\s+`, 'i'), '');
  }
  return t;
}

// Test sayısı dışı sıvı/sistem satırlarını (mL hacimli reaktif/temizleyici) ele.
// Gerçek testlerde "Available Tests" tam sayıdır; NACL/ECO-D/ProCell vb. mL gösterir.
function isVolumeCell(s: string): boolean {
  return /\b\d+\s*m?l\b/i.test(s) || /m?l\s*$/i.test(s.trim());
}

export async function parseReagentPdfFiles(files: File[]): Promise<ReagentRow[]> {
  const out: ReagentRow[] = [];
  if (!files.length) return out;

  const pdfjsLib = await getPdfJs();

  for (const f of files) {
    const buf = await f.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines = groupByLines(content.items as any[]);

      const ranges = detectColumns(lines);
      if (!ranges) continue;

      for (const L of lines) {
        const joinedLower = L.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
        if (shouldSkipLine(joinedLower)) continue;

        const testTxt = ranges['Test'] ? takeInRange(L.items, ranges['Test']) : '';
        const availTxt = ranges['Available'] ? takeInRange(L.items, ranges['Available']) : '';
        if (!testTxt) continue;
        if (isVolumeCell(availTxt)) continue; // sıvı/temizleyici satırı, test değil

        const available = toNum(availTxt);
        out.push({ test: sanitizeTestName(testTxt), available, src: f.name });
      }
    }
  }

  return out;
}
