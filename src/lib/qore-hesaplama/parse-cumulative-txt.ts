'use client';
// Kümülatif Operasyon Listesi TXT/CSV ayrıştırıcı.
// Referans uygulamadan (batuhanue/reagent · src/lib/txt/parse_txt.ts) port edildi.
import type { CumulativeRow } from './parse-cumulative';

type HeaderMap = {
  test: number;
  code: number;
  routine: number;
  calib: number;
  control: number;
  rerun: number;
  total: number;
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
    .replaceAll('.', '')
    .replaceAll(',', '')
    .replaceAll(':', '')
    .replace(/\s+/g, ' ');

function shouldSkipLineRaw(line: string): boolean {
  const l = norm(line);
  return (
    !l ||
    l.startsWith('module ') ||
    l.includes('cumulative operation') ||
    l.includes('power on time') ||
    l.includes('operation time') ||
    l.includes('no of sample') ||
    l.includes('no of detection') ||
    l.startsWith('system name') ||
    l.startsWith('total') ||
    /^[-]{3,}$/.test(line.replace(/\s/g, '')) ||
    /^page\s+\d+/i.test(l)
  );
}

/** Ayıraç: \t, ;, ,, | yoksa 2+ boşluk */
function detectSep(line: string): RegExp {
  if (line.includes('\t')) return /\t/g;
  const cands = [';', ',', '|'];
  let best = { ch: '', cnt: 0 };
  for (const ch of cands) {
    const c = (line.match(new RegExp(`\\${ch}`, 'g')) || []).length;
    if (c > best.cnt) best = { ch, cnt: c };
  }
  return best.cnt > 0 ? new RegExp(`\\${best.ch}`) : /\s{2,}/g;
}

function split(line: string, sep: RegExp): string[] {
  if (String(sep) === String(/\s{2,}/g)) {
    return line.trim().split(/\s{2,}/).map(TRIM);
  }
  return line.split(sep).map(TRIM);
}

/** Başlığı isim tabanlı, sıra bağımsız indeksle */
function mapHeader(cells: string[]): HeaderMap | null {
  const idx: any = { test: -1, code: -1, routine: -1, calib: -1, control: -1, rerun: -1, total: -1 };
  const want: Record<keyof HeaderMap, string[]> = {
    test: ['test', 'analit', 'analyte', 'assay', 'parametre'],
    code: ['code', 'kod'],
    routine: ['routine', 'rutin'],
    calib: ['calib', 'kalib', 'calibration', 'kalibrasyon', 'calib.'],
    control: ['control', 'kontrol', 'qc'],
    rerun: ['rerun', 'repeat', 'tekrar'],
    total: ['total', 'toplam'],
  };
  const hit = (k: string, keys: string[]) => keys.some((n) => k === n || k.startsWith(n + ' '));
  cells.forEach((c, i) => {
    const k = norm(c);
    if (idx.test === -1 && hit(k, want.test)) idx.test = i;
    else if (idx.code === -1 && hit(k, want.code)) idx.code = i;
    else if (idx.routine === -1 && hit(k, want.routine)) idx.routine = i;
    else if (idx.calib === -1 && hit(k, want.calib)) idx.calib = i;
    else if (idx.control === -1 && hit(k, want.control)) idx.control = i;
    else if (idx.rerun === -1 && hit(k, want.rerun)) idx.rerun = i;
    else if (idx.total === -1 && hit(k, want.total)) idx.total = i;
  });
  const metricFound = [idx.routine, idx.calib, idx.control, idx.rerun, idx.total].some((i) => i >= 0);
  if (idx.test === -1 || !metricFound) return null;
  return idx as HeaderMap;
}

const cellNum = (cells: string[], i: number) => (i >= 0 && i < cells.length ? toInt(cells[i]) : 0);

export async function parseCumulativeTxtFiles(files: File[]): Promise<CumulativeRow[]> {
  const out: CumulativeRow[] = [];
  for (const f of files) {
    const text = (await f.text()).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    if (!lines.length) continue;

    let sep: RegExp | null = null;
    let header: HeaderMap | null = null;
    const seenRowKeys = new Set<string>(); // aynı TXT içinde birebir tekrarları önle

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = TRIM(raw);
      if (!line) continue;

      // Olası başlık satırı
      if (norm(line).includes('test')) {
        const det = detectSep(line);
        const cells = split(line, det);
        const mapped = mapHeader(cells);
        if (mapped) {
          sep = det;
          header = mapped;
          continue;
        }
      }

      if (shouldSkipLineRaw(line)) continue;
      if (!header || !sep) continue; // başlık görülmeden veri okuma

      const cells = split(line, sep);
      const test = TRIM(cells[header.test] ?? '');
      if (!test || test.toLowerCase() === 'test') continue;

      const routine = cellNum(cells, header.routine);
      const calib = cellNum(cells, header.calib);
      const control = cellNum(cells, header.control);
      const rerun = cellNum(cells, header.rerun);
      const total = routine + rerun + calib + control;

      const key = `${test}|${routine}|${rerun}|${calib}|${control}|${total}`;
      if (seenRowKeys.has(key)) continue;
      seenRowKeys.add(key);

      out.push({ test, routine, rerun, calib, control, total });
    }
  }
  return out;
}
