'use client';
// Kümülatif Operasyon Listesi (Cumulative Operation List) PDF ayrıştırıcı.
// Referans uygulamadan (batuhanue/reagent · src/lib/pdf/parse.ts) port edildi;
// QORE'nin CDN üzerinden yüklenen pdf.js örneğini (getPdfJs) kullanır.
import { getPdfJs } from '@/lib/pdf';

export type CumulativeRow = {
  test: string;
  routine: number;
  rerun: number;
  calib: number;
  control: number;
  total: number;
};

// Beklenen başlık tokenları (sıra bağımsız; x koordinatına göre sıralanır)
const HEADER_TOKENS = ['Test', 'Code', 'Routine', 'Calib.', 'Control', 'Rerun', 'Stat', 'Total'];

function toNum(v: string): number {
  const s = (v || '').replace(/[^0-9.-]/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

type LineItem = { x: number; str: string };
type Line = { y: number; items: LineItem[] };

// Bir sayfanın textContent'ini satırlara grupla (y toleransı) ve x koordinatlarını koru
function groupByLines(items: any[], yTol = 4): Line[] {
  const lines: Line[] = [];
  for (const it of items) {
    const str = it.str as string;
    if (!str || !str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let line = lines.find((L) => Math.abs(L.y - y) <= yTol);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, str });
  }
  lines.sort((A, B) => B.y - A.y);
  for (const L of lines) L.items.sort((a, b) => a.x - b.x);
  return lines;
}

// Başlık satırından sütun X sınırlarını çıkar
function detectColumns(lines: Line[]): Record<string, [number, number]> | null {
  for (const L of lines) {
    const text = L.items.map((i) => i.str.trim()).join(' ').replace(/\s+/g, ' ');
    const matchesAll = HEADER_TOKENS.every((tok) => text.includes(tok));
    if (matchesAll) {
      const xMap: Record<string, number> = {};
      for (const tok of HEADER_TOKENS) {
        const hit = L.items.find((i) => i.str.trim() === tok);
        if (hit) xMap[tok] = hit.x;
      }
      const ordered = HEADER_TOKENS.filter((t) => t in xMap)
        .map((t) => ({ t, x: xMap[t]! }))
        .sort((a, b) => a.x - b.x);
      const ranges: Record<string, [number, number]> = {};
      for (let i = 0; i < ordered.length; i++) {
        const cur = ordered[i];
        const next = ordered[i + 1];
        const right = next ? (cur.x + next.x) / 2 : cur.x + 9999;
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

// Satır türü filtreleri (başlık/total/modül/sistem satırlarını atla)
function isSkippable(textLine: string): boolean {
  const t = textLine.toLowerCase();
  if (!t) return true;
  if (t.includes('cumulative operation list')) return true;
  if (t.includes('module')) return true;
  if (t.startsWith('system name')) return true;
  if (t.startsWith('hours ') || t.includes('power on time') || t.includes('operation time')) return true;
  if (t.startsWith('total ')) return true; // bölüm/grand toplamlarını atla
  if (t.includes('no. of sample') || t.includes('no. of detection')) return true;
  if (HEADER_TOKENS.every((tok) => t.includes(tok.toLowerCase()))) return true;
  return false;
}

// Rack/modül kısa kodları (A1-A, A2-1 gibi) gerçek test değildir
function isRackOrModuleTest(testTxt: string, codeTxt: string): boolean {
  const t = testTxt.trim();
  if (/\d/.test(codeTxt)) return false; // Code alanında rakam varsa gerçek satır
  if (/^[A-H]\d?-[0-9A-Z]{1,2}$/i.test(t) && t.length <= 5) return true;
  if (/^[A-H]\d$/i.test(t)) return true;
  return false;
}

export async function parseCumulativePdfFiles(files: File[]): Promise<CumulativeRow[]> {
  const out: CumulativeRow[] = [];
  if (!files.length) return out;

  const pdfjsLib = await getPdfJs();

  for (const file of files) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines = groupByLines(content.items as any[]);

      const ranges = detectColumns(lines);
      if (!ranges) continue; // bu sayfada başlık yok

      for (const L of lines) {
        const joined = L.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
        if (!joined || isSkippable(joined)) continue;

        const testTxt = takeInRange(L.items, ranges['Test']);
        const codeTxt = takeInRange(L.items, ranges['Code']);
        const routineTxt = takeInRange(L.items, ranges['Routine']);
        const calibTxt = takeInRange(L.items, ranges['Calib.']);
        const controlTxt = takeInRange(L.items, ranges['Control']);
        const rerunTxt = takeInRange(L.items, ranges['Rerun']);
        const statTxt = takeInRange(L.items, ranges['Stat']);
        const totalTxt = takeInRange(L.items, ranges['Total']);

        if (!testTxt) continue;
        if (isRackOrModuleTest(testTxt, codeTxt)) continue;

        const numerics = [routineTxt, calibTxt, controlTxt, rerunTxt, statTxt, totalTxt].map(toNum);
        if (numerics.every((n) => n === 0)) {
          const anyDigits = /(\d)/.test([routineTxt, calibTxt, controlTxt, rerunTxt, totalTxt].join(' '));
          if (!anyDigits) continue;
        }

        const routine = toNum(routineTxt);
        const rerun = toNum(rerunTxt);
        const calib = toNum(calibTxt);
        const control = toNum(controlTxt);
        const stat = toNum(statTxt);
        let total = toNum(totalTxt);

        // Bazı sayfalarda Total hücresi satırdan kayar → 0 gelir. Güvenli geri dönüş.
        if (total === 0 && (routine || rerun || calib || control || stat)) {
          total = routine + rerun + calib + control + stat;
        }

        out.push({ test: testTxt, routine, rerun, calib, control, total });
      }
    }
  }

  return out;
}
