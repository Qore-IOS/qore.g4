'use client';
// Kümülatif Operasyon Listesi TXT/CSV ayrıştırıcı. İki biçim desteklenir:
//  1) Ayraçlı dışa aktarımlar (tab/;/,/|) — hücreler indeksle okunur.
//  2) Sabit genişlikli (boşluk hizalı) cihaz çıktıları — sütunlar başlık
//     tokenlarının karakter konumlarından çıkarılır; tek boşlukla ayrılmış
//     başlıklar (ör. "CODE ROUTINE") ve sağa hizalı sayılar doğru okunur.
import type { CumulativeRow } from './parse-cumulative';
import { buildColumns, expandTabs, readCells, tokenize, type FixedCol } from './fixed-width';

type Field = 'test' | 'code' | 'routine' | 'calib' | 'control' | 'rerun' | 'stat' | 'total';

type DelimHeader = Partial<Record<Field, number>>;

const TRIM = (s: string) => (s ?? '').trim().replace(/^\uFEFF/, '');
const toInt = (s: string) => {
  const t = (s ?? '').replace(/[^0-9-]/g, '');
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};
// Noktalama karakterlerini boşluğa çevirir: "4.NO. OF SAMPLE" → "4 no of sample",
// "CALIB." → "calib" gibi varyasyonlar tek biçime iner.
const norm = (s: string) =>
  TRIM(s).toLowerCase().replace(/[.,:*]/g, ' ').replace(/\s+/g, ' ').trim();

const FIELD_ALIASES: Record<Field, string[]> = {
  test: ['test', 'analit', 'analyte', 'assay', 'parametre'],
  code: ['code', 'kod'],
  routine: ['routine', 'rutin'],
  calib: ['calib', 'calibration', 'kalib', 'kalibrasyon'],
  control: ['control', 'kontrol', 'qc'],
  rerun: ['rerun', 'repeat', 'tekrar'],
  stat: ['stat'],
  total: ['total', 'toplam'],
};

function fieldOf(token: string): Field | null {
  const k = norm(token);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [Field, string[]][]) {
    if (aliases.some((a) => k === a || k.startsWith(a + ' '))) return field;
  }
  return null;
}

function hasTestAndMetric(fields: (Field | null)[]): boolean {
  const metrics: Field[] = ['routine', 'calib', 'control', 'rerun', 'total'];
  return fields.includes('test') && metrics.some((m) => fields.includes(m));
}

function shouldSkipLine(line: string): boolean {
  const l = norm(line);
  return (
    !l ||
    l.startsWith('module ') ||
    l.includes('cumulative operation') ||
    l.includes('power on time') ||
    l.includes('operation time') ||
    l.includes('test count') ||
    l.startsWith('system name') ||
    l.startsWith('total') ||
    /^\d+\s*operation\b/.test(l) ||
    /^[-=]{3,}$/.test(line.replace(/\s/g, '')) ||
    /^page\s+\d+/i.test(l)
  );
}

// "4.NO. OF SAMPLE" / "5.NO. OF DETECTION CH." bölümleri test tablosu değildir;
// bu başlık görülünce yeni bir TEST başlığı gelene dek ayrıştırma kapatılır.
function isSectionBreak(line: string): boolean {
  const l = norm(line);
  return l.includes('no of sample') || l.includes('no of detection');
}

// Rack/modül kısa kodları (C1, A1-A, A2-1 gibi) gerçek test değildir
function isRackOrModuleTest(testTxt: string, codeTxt: string): boolean {
  const t = testTxt.trim();
  if (/\d/.test(codeTxt)) return false;
  if (/^[A-H]\d?-[0-9A-Z]{1,2}$/i.test(t) && t.length <= 5) return true;
  if (/^[A-H]\d$/i.test(t)) return true;
  return false;
}

// Ayraçlı biçim: başlıkta belirgin ayraç var mı?
function detectDelim(line: string): RegExp | null {
  if (line.includes('\t')) return /\t/;
  for (const ch of [';', '|', ',']) {
    const cnt = (line.match(new RegExp(`\\${ch}`, 'g')) || []).length;
    if (cnt >= 3) return new RegExp(`\\${ch}`);
  }
  return null;
}

function mapDelimHeader(cells: string[]): DelimHeader | null {
  const idx: DelimHeader = {};
  cells.forEach((c, i) => {
    const f = fieldOf(c);
    if (f && idx[f] === undefined) idx[f] = i;
  });
  if (!hasTestAndMetric(Object.keys(idx) as Field[])) return null;
  return idx;
}

const delimCell = (cells: string[], i?: number) => (i !== undefined && i < cells.length ? TRIM(cells[i]) : '');

// Cihaz TXT çıktılarında metrik kolonları sağa hizalıdır. Bazı satırlarda
// özellikle CALIB./CONTROL/RERUN orta kolonlarındaki sayılar başlık başlangıç
// offsetlerinden birkaç karakter sola taşabildiği için fixed-width token
// ataması orta kolonları kaydırabilir (örn. CONTROL değeri RERUN'a düşer).
// TEST + 4 haneli CODE + 6 sayısal metrik yapısı sabit olduğundan veri
// satırlarında önce satır sonundan sayısal alanları yakalamak daha güvenlidir.
function parseMetricLine(line: string): Partial<Record<Field, string>> | null {
  const m = expandTabs(line).match(/^\s*(.+?)\s+(\d{4})\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/);
  if (!m) return null;
  return {
    test: TRIM(m[1]),
    code: m[2],
    routine: m[3],
    calib: m[4],
    control: m[5],
    rerun: m[6],
    stat: m[7],
    total: m[8],
  };
}

export async function parseCumulativeTxtFiles(files: File[]): Promise<CumulativeRow[]> {
  const out: CumulativeRow[] = [];

  for (const f of files) {
    const text = (await f.text()).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    if (!lines.length) continue;

    let delimSep: RegExp | null = null;
    let delimHeader: DelimHeader | null = null;
    let fixedCols: FixedCol<Field>[] | null = null;
    const seenRowKeys = new Set<string>(); // aynı TXT içinde birebir tekrarları önle

    for (const rawLine of lines) {
      const raw = rawLine.replace(/\s+$/, '');
      const line = TRIM(raw);
      if (!line) continue;

      // Olası başlık satırı: TEST + en az bir metrik sütunu eşleşmeli
      if (norm(line).includes('test')) {
        const sep = detectDelim(line);
        if (sep) {
          const mapped = mapDelimHeader(line.split(sep).map(TRIM));
          if (mapped) {
            delimSep = sep;
            delimHeader = mapped;
            fixedCols = null;
            continue;
          }
        }
        const toks = tokenize(expandTabs(raw));
        const cols = buildColumns<Field>(toks, fieldOf);
        if (hasTestAndMetric(cols.map((c) => c.field))) {
          fixedCols = cols;
          delimSep = null;
          delimHeader = null;
          continue;
        }
      }

      if (isSectionBreak(line)) {
        delimSep = null;
        delimHeader = null;
        fixedCols = null;
        continue;
      }

      if (shouldSkipLine(line)) continue;

      let cells: Partial<Record<Field, string>> | null = null;
      if (delimHeader && delimSep) {
        const parts = line.split(delimSep).map(TRIM);
        cells = {
          test: delimCell(parts, delimHeader.test),
          code: delimCell(parts, delimHeader.code),
          routine: delimCell(parts, delimHeader.routine),
          calib: delimCell(parts, delimHeader.calib),
          control: delimCell(parts, delimHeader.control),
          rerun: delimCell(parts, delimHeader.rerun),
          stat: delimCell(parts, delimHeader.stat),
          total: delimCell(parts, delimHeader.total),
        };
      } else if (fixedCols) {
        cells = parseMetricLine(raw) ?? readCells(expandTabs(raw), fixedCols);
      }
      if (!cells) continue; // başlık görülmeden veri okuma

      const test = TRIM(cells.test ?? '');
      if (!test || norm(test) === 'test') continue;
      if (isRackOrModuleTest(test, cells.code ?? '')) continue;

      // Metrik sütunlarının hiçbirinde rakam yoksa veri satırı değildir
      const metricTexts = [cells.routine, cells.calib, cells.control, cells.rerun, cells.stat, cells.total];
      if (!metricTexts.some((t) => t && /\d/.test(t))) continue;

      const routine = toInt(cells.routine ?? '');
      const calib = toInt(cells.calib ?? '');
      const control = toInt(cells.control ?? '');
      const rerun = toInt(cells.rerun ?? '');
      const stat = toInt(cells.stat ?? '');
      let total = toInt(cells.total ?? '');
      // Dosyadaki TOTAL boş/0 ise PDF motoruyla aynı güvenli geri dönüş
      if (total === 0 && (routine || rerun || calib || control || stat)) {
        total = routine + rerun + calib + control + stat;
      }

      const key = `${test}|${routine}|${rerun}|${calib}|${control}|${stat}|${total}`;
      if (seenRowKeys.has(key)) continue;
      seenRowKeys.add(key);

      out.push({ test, routine, rerun, calib, control, total });
    }
  }

  return out;
}
