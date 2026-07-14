'use client';
// Cihaz Üstü Reaktif Durumu (Reagent Status) TXT/CSV ayrıştırıcı.
// Sabit genişlikli cihaz çıktısı desteklenir: sütunlar başlık tokenlarının
// karakter konumlarından çıkarılır, TESTS hücresi komşu sütunlarla (LOT, SEQ,
// EXP.DATE...) sınırlandığı için yalnızca kullanılabilir test sayısı okunur.
// Eski "Test ... Available Tests ... Type" düzeni de aynı mantıkla çalışır.
import type { ReagentRow } from './parse-reagent';
import { buildColumns, expandTabs, readCells, tokenize, type FixedCol } from './fixed-width';

type Field = 'test' | 'type' | 'tests';

const TRIM = (s: string) => (s ?? '').trim().replace(/^\uFEFF/, '');
const toInt = (s: string) => {
  const t = (s ?? '').replace(/[^0-9-]/g, '');
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};
const norm = (s: string) =>
  TRIM(s).toLowerCase().replace(/[.,:*]/g, ' ').replace(/\s+/g, ' ').trim();

// "Available" ve "Tests" tokenlarının ikisi de tests alanına eşlenir; böylece
// eski biçimdeki iki kelimelik "Available Tests" başlığı tek sütun gibi davranır.
function fieldOf(token: string): Field | null {
  const k = norm(token);
  if (k === 'test') return 'test';
  if (k === 'type') return 'type';
  if (k === 'tests' || k === 'available') return 'tests';
  return null;
}

function shouldSkipLine(line: string): boolean {
  const l = norm(line);
  return (
    !l ||
    l.includes('reagent status') ||
    l.startsWith('module ') ||
    l.includes('including reagent manager') ||
    l.includes('reagent manager') ||
    l.startsWith('system name') ||
    l.startsWith('inventory') ||
    /^page\s+\d+/i.test(l) ||
    /^[-=]{3,}$/.test(line.replace(/\s/g, '')) ||
    l === 'total' ||
    l.startsWith('total ')
  );
}

// mL hacimli sıvı/temizleyici satırları test sayısı değildir
function isVolumeCell(s: string): boolean {
  return /ml$/i.test(s.replace(/[\s*]+/g, ''));
}

// ASSAY (immüno) ve R1/R1-R2/R1-R3 (kimya kiti) tipleri gerçek testtir;
// Dil/D1/D2/IS/DIL/CellCln vb. sistem sıvıları elenir.
function isTestType(typeTxt: string): boolean {
  const t = norm(typeTxt);
  return t === 'assay' || /^r1\b/.test(t) || /^r1-/.test(t);
}

function sanitizeTestName(name: string): string {
  let t = name.trim().replace(/\s+/g, ' ');
  for (const b of ['expired', 'yellow']) {
    t = t.replace(new RegExp(`\\s+${b}$`, 'i'), '');
    t = t.replace(new RegExp(`^${b}\\s+`, 'i'), '');
  }
  return t;
}

export async function parseReagentTxtFiles(files: File[]): Promise<ReagentRow[]> {
  const out: ReagentRow[] = [];

  for (const f of files) {
    const text = (await f.text()).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    if (!lines.length) continue;

    let cols: FixedCol<Field>[] | null = null;
    let lastTest = '';
    const seen = new Set<string>(); // dosya içinde (test|adet) tekrarını önle

    for (const rawLine of lines) {
      const raw = rawLine.replace(/\s+$/, '');
      const line = TRIM(raw);
      if (!line) continue;

      // Olası başlık: TEST ve TESTS/AVAILABLE sütunları birlikte bulunmalı
      const l = norm(line);
      if (l.includes('test') && (l.includes('tests') || l.includes('available'))) {
        const toks = tokenize(expandTabs(raw));
        const built = buildColumns<Field>(toks, fieldOf);
        const fields = built.map((c) => c.field);
        if (fields.includes('test') && fields.includes('tests')) {
          cols = built;
          lastTest = '';
          continue;
        }
      }

      if (!cols) continue; // başlık görülmeden veri okuma
      if (shouldSkipLine(line)) continue;

      const cells = readCells(expandTabs(raw), cols);
      const testTxt = TRIM(cells.test ?? '');
      const typeTxt = TRIM(cells.type ?? '');
      const testsTxt = TRIM(cells.tests ?? '');

      const test = sanitizeTestName(testTxt || lastTest);
      if (!test) continue;
      lastTest = test;

      if (typeTxt && !isTestType(typeTxt)) continue;
      if (isVolumeCell(testsTxt)) continue;

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
