
// src/lib/pdfOcrCumulativeExtractor.ts
// Deterministic OCR-based cumulative extractor (no LLM).
// Renders PDF pages → crops lower table → OCR → rebuild rows → aggregate-ready rows.

export type SummaryRow = {
  test: string;
  routine: number;
  rerun: number;
  calib: number;
  control: number;
  total: number;
};

type PdfJsTextItem = { str: string; transform: number[] };

type ExtractOptions = {
  /** Page render scale (higher → better OCR, slower). Default: 2.8 */
  scale?: number;
  /** Start of bottom crop as fraction of page height (0–1). Default: 0.55 (keep lower 45%) */
  tableTopRatio?: number;
  /** OCR word confidence threshold (0–100). Default: 60 */
  minConfidence?: number;
  /** Y-banding tolerance (px). Default: 10 */
  epsY?: number;
  /** Numeric column cluster tolerance (px). Default: 22 */
  epsX?: number;
  /** Enable debug logs */
  debug?: boolean;
  /** Optional progress callback */
  onProgress?: (info: { page: number; pages: number; fileIndex: number; files: number }) => void;
};

// ---- pdf.js loader ----
async function loadPdfJs() {
  if (typeof window === 'undefined' || !(window as any).pdfjsLib) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (!(window as any).pdfjsLib) {
      throw new Error("pdf.js library not found on window object.");
    }
  }
  const pdfjsLib = (window as any).pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  return pdfjsLib;
}

// ---- Tesseract worker (singleton) ----
let _worker: any | null = null;
async function getTesseractWorker(minConfidence = 60) {
  if (_worker) return _worker;
  const tesseract = await import('tesseract.js');
  const worker = await tesseract.createWorker({});
  await worker.loadLanguage('eng');
  await worker.initialize('eng');
  // Reasonable defaults for dense table text
  await worker.setParameters({
    tessedit_pageseg_mode: '6',            // assume a single uniform block
    preserve_interword_spaces: '1',
    // digits+letters; commas and dots will be stripped in parsing anyway
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-+/().,',
  });
  (worker as any).__minConfidence = minConfidence;
  _worker = worker;
  return worker;
}

// ---- Helpers ----
const isLikelyInt = (s: string) => /^(?:\d{1,3}(?:,\d{3})*|\d+)$/.test(s.trim());
const toInt = (s: string) => {
  const t = s.replace(/[^\d]/g, '');
  return t ? parseInt(t, 10) : 0;
};

type OcrWord = { text: string; conf: number; x: number; y: number; w: number; h: number; cx: number; cy: number };

function wordsFromTesseract(data: any, minConf: number): OcrWord[] {
  const out: OcrWord[] = [];
  const words = data?.words ?? [];
  for (const w of words) {
    const text = String(w.text || '').trim();
    const conf = Number(w.confidence ?? w.conf ?? 0);
    if (!text || conf < minConf) continue;

    const x0 = w.bbox?.x0 ?? w.bbox?.x ?? 0;
    const y0 = w.bbox?.y0 ?? w.bbox?.y ?? 0;
    const x1 = w.bbox?.x1 ?? (w.x ?? 0) + (w.width ?? 0);
    const y1 = w.bbox?.y1 ?? (w.y ?? 0) + (w.height ?? 0);
    const wdt = Math.max(1, x1 - x0);
    const hgt = Math.max(1, y1 - y0);

    out.push({ text, conf, x: x0, y: y0, w: wdt, h: hgt, cx: x0 + wdt / 2, cy: y0 + hgt / 2 });
  }
  return out;
}

function bandLines(words: OcrWord[], epsY: number) {
  const sorted = [...words].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const lines: OcrWord[][] = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(w.cy - last[0].cy) > epsY) lines.push([w]);
    else last.push(w);
  }
  for (const line of lines) line.sort((a, b) => a.cx - b.cx);
  return lines;
}

function clusterNumericColumns(words: OcrWord[], epsX: number): number[] {
  const nums = words.filter(w => isLikelyInt(w.text)).sort((a, b) => a.cx - b.cx);
  if (!nums.length) return [];
  const centers: number[] = [];
  for (const w of nums) {
    const last = centers[centers.length - 1];
    if (!last || Math.abs(w.cx - last) > epsX) centers.push(w.cx);
    else centers[centers.length - 1] = (last + w.cx) / 2;
  }
  const cols = centers.slice(-6).sort((a, b) => a - b);
  return cols.length === 6 ? cols : [];
}

// Parse one line by nearest-number mapping to column centers
function parseRowFromLine(line: OcrWord[], colCenters: number[]) {
  if (line.length < 8) return null;
  const joined = line.map(w => w.text).join(' ');
  if (/^\s*(grand\s+)?total\b/i.test(joined) || /module/i.test(joined)) return null;

  const leftMostNumX = Math.min(...colCenters);
  const codeThresholdX = leftMostNumX - 16;

  const left = line.filter(w => w.cx < codeThresholdX);
  if (left.length < 2) return null;

  const leftSorted = [...left].sort((a, b) => a.cx - b.cx);
  // last = Code, rest = Test
  const testText = leftSorted.slice(0, -1).map(w => w.text).join(' ').trim();
  if (!testText || /^test$/i.test(testText)) return null;

  const rightNums = line.filter(w => w.cx >= codeThresholdX && isLikelyInt(w.text));
  const pickNearest = (center: number) => {
    let best: OcrWord | null = null;
    let bestDist = Infinity;
    for (const w of rightNums) {
      const d = Math.abs(w.cx - center);
      if (d < bestDist) { best = w; bestDist = d; }
    }
    return best ? toInt(best.text) : 0;
  };

  // Default order: Routine, Rerun, Stat, Calib, Control, Total
  const routine = pickNearest(colCenters[0]);
  const rerun   = pickNearest(colCenters[1]);
  /* const stat = */ pickNearest(colCenters[2]); // ignored
  const calib   = pickNearest(colCenters[3]);
  const control = pickNearest(colCenters[4]);
  const total   = pickNearest(colCenters[5]);

  if ([routine, rerun, calib, control, total].every(v => v === 0)) return null;

  return { test: testText, routine, rerun, calib, control, total } as SummaryRow;
}

// Render a PDF page to canvas, crop bottom area, run OCR, return parsed rows
async function rowsFromPageCanvas(page: any, opts: Required<ExtractOptions>): Promise<SummaryRow[]> {
  const viewport = page.getViewport({ scale: opts.scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx as any, viewport }).promise;

  // crop lower fraction (configurable)
  const cutY = Math.floor(canvas.height * opts.tableTopRatio);
  const cropH = canvas.height - cutY;
  const crop = document.createElement('canvas');
  crop.width = canvas.width; crop.height = cropH;
  crop.getContext('2d')!.drawImage(canvas, 0, cutY, canvas.width, cropH, 0, 0, canvas.width, cropH);

  const worker = await getTesseractWorker(opts.minConfidence);
  const { data } = await worker.recognize(crop);
  const words = wordsFromTesseract(data, opts.minConfidence);
  if (!words.length) return [];

  const lines = bandLines(words, opts.epsY);
  const centers = clusterNumericColumns(words, opts.epsX);
  if (!centers.length) return [];

  const rows: SummaryRow[] = [];
  for (const ln of lines) {
    const parsed = parseRowFromLine(ln, centers);
    if (parsed) rows.push(parsed);
  }

  if (opts.debug) {
    // eslint-disable-next-line no-console
    console.debug('[OCR] rows:', rows.length, 'words:', words.length, 'centers:', centers);
  }

  return rows;
}

// Public: extract from a single File
export async function extractSummaryRowsFromFileOCR(file: File, options?: ExtractOptions): Promise<SummaryRow[]> {
  const opts: Required<ExtractOptions> = {
    scale: options?.scale ?? 2.8,
    tableTopRatio: options?.tableTopRatio ?? 0.55,
    minConfidence: options?.minConfidence ?? 60,
    epsY: options?.epsY ?? 10,
    epsX: options?.epsX ?? 22,
    debug: options?.debug ?? false,
    onProgress: options?.onProgress ?? (() => {}),
  };

  const pdfjs = await loadPdfJs();
  const buf = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  const rows: SummaryRow[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    opts.onProgress({ page: p, pages: doc.numPages, fileIndex: 0, files: 1 });
    const r = await rowsFromPageCanvas(page, opts);
    rows.push(...r);
  }
  return rows;
}

// Public: extract from multiple Files
export async function extractSummaryRowsFromFilesOCR(files: File[], options?: ExtractOptions): Promise<SummaryRow[]> {
  const opts = options ?? {};
  const all: SummaryRow[] = [];
  let fileIndex = 0;

  for (const f of files) {
    fileIndex++;
    const pdfjs = await loadPdfJs();
    const buf = new Uint8Array(await f.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: buf }).promise;

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      opts.onProgress?.({ page: p, pages: doc.numPages, fileIndex, files: files.length });
      const r = await rowsFromPageCanvas(page, {
        scale: opts.scale ?? 2.8,
        tableTopRatio: opts.tableTopRatio ?? 0.55,
        minConfidence: opts.minConfidence ?? 60,
        epsY: opts.epsY ?? 10,
        epsX: opts.epsX ?? 22,
        debug: opts.debug ?? false,
        onProgress: opts.onProgress ?? (() => {}),
      } as Required<ExtractOptions>);
      all.push(...r);
    }
  }
  return all;
}
