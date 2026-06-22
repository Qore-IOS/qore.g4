'use client';
// Sabit genişlikli (boşluk hizalı) metin tabloları için ortak yardımcılar.
// Sütun sınırları başlık tokenlarının karakter konumlarından türetilir;
// PDF ayrıştırıcılardaki x-koordinatı mantığının karakter ofseti karşılığıdır.

export type Tok = { text: string; start: number };
export type FixedCol<F extends string> = { field: F | null; start: number; end: number };

export function expandTabs(s: string, tabSize = 8): string {
  if (!s.includes('\t')) return s;
  let out = '';
  for (const ch of s) {
    if (ch === '\t') out += ' '.repeat(tabSize - (out.length % tabSize));
    else out += ch;
  }
  return out;
}

export function tokenize(line: string): Tok[] {
  const toks: Tok[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) toks.push({ text: m[0], start: m.index });
  return toks;
}

// Başlık tokenlarından sütun aralıkları üret. Sağa hizalı sayısal değerler
// başlık başlangıcından birkaç karakter önce başlayabildiği için pay (slack)
// bırakılır; ilk sütun satır başından itibaren kabul edilir.
export function buildColumns<F extends string>(
  headerToks: Tok[],
  fieldOf: (token: string) => F | null,
  slack = 2
): FixedCol<F>[] {
  const cols: FixedCol<F>[] = headerToks.map((t, i) => ({
    field: fieldOf(t.text),
    start: Math.max(0, t.start - slack),
    end: i + 1 < headerToks.length ? Math.max(0, headerToks[i + 1].start - slack) : Number.MAX_SAFE_INTEGER,
  }));
  if (cols.length) cols[0].start = 0;
  return cols;
}

// Veri satırındaki her tokenı, başlangıç konumuna göre ait olduğu sütuna ata.
// Aynı alana düşen birden çok token (ör. çok kelimeli test adı, "39 mL")
// boşlukla birleştirilir.
export function readCells<F extends string>(
  line: string,
  cols: FixedCol<F>[]
): Partial<Record<F, string>> {
  const cells: Partial<Record<F, string>> = {};
  for (const t of tokenize(line)) {
    const col = cols.find((c) => t.start >= c.start && t.start < c.end);
    if (!col || !col.field) continue;
    cells[col.field] = cells[col.field] ? `${cells[col.field]} ${t.text}` : t.text;
  }
  return cells;
}
