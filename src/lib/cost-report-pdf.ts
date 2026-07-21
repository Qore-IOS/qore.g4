/**
 * Anlık maliyet PDF raporu — 10 sayfalık (16:9) vektör rapor, jsPDF ile çizilir.
 * Demodaki "QORE Genel Maliyet Dağılım Raporu" şablonunu birebir üretir:
 * kapak, yönetici özeti, genel dağılım (donut), lider marka kırılımı (yatay bar),
 * marka sıralaması (çok renkli bar), marka alan haritası (treemap), lokasyon
 * bazlı stacked bar, lab/hastane dağılımı, detay tablosu, özet & yöntem.
 *
 * Türkçe için repo'daki loadTurkishFont() (Noto Sans) kullanılır; yüklenemezse
 * helvetica + ASCII sadeleştirmeye düşülür.
 */
import type { jsPDF } from 'jspdf';
import { CostReportModel, fmtM, fmtFull, fmtPct, ANCHOR_COLOR, OTHER_COLOR } from './cost-report';

type RGB = [number, number, number];
const INK: RGB = [42, 37, 64];
const INK2: RGB = [138, 131, 152];
const INK3: RGB = [176, 171, 189];
const CREAM: RGB = [241, 236, 226];
const VIOLET: RGB = ANCHOR_COLOR;
const VIOLET_L: RGB = [139, 124, 240];
const WHITE: RGB = [255, 255, 255];
const TEAL: RGB = [45, 199, 166];
const ORANGE: RGB = [249, 180, 94];
const CORAL: RGB = [249, 128, 128];
const TRACK: RGB = [234, 231, 242];

const W = 720, H = 405;
const PAD = 48;

const TR_MAP: Record<string, string> = { 'ş': 's', 'Ş': 'S', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ü': 'u', 'Ü': 'U', 'ç': 'c', 'Ç': 'C', '₺': ' TL', '—': '-', '–': '-', '…': '...' };
// Fallback only (font yüklenemediğinde): WinAnsi'de olmayan glifleri sadeleştir.
const asciiTr = (s: string) => s.replace(/[şŞğĞıİöÖüÜçÇ₺—–…]/g, (c) => TR_MAP[c] || c);

interface Ctx { doc: jsPDF; fontName: string; sanitize: boolean; }

function makeDraw(ctx: Ctx) {
  const { doc } = ctx;
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const ink = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const S = (t: string) => (ctx.sanitize ? asciiTr(t) : t);

  function setFont(size: number, weight: 'normal' | 'bold' = 'normal') {
    doc.setFontSize(size);
    if (ctx.fontName === 'helvetica') doc.setFont('helvetica', weight);
    else doc.setFont(ctx.fontName, 'normal');
  }
  // faux-bold when single-weight embedded font is used
  function txt(x: number, y: number, t: string, opt: { size?: number; weight?: 'normal' | 'bold'; color?: RGB; align?: 'left' | 'center' | 'right'; maxW?: number } = {}) {
    const { size = 11, weight = 'normal', color = INK, align = 'left', maxW } = opt;
    setFont(size, weight);
    ink(color);
    const bold = weight === 'bold';
    const faux = bold && ctx.fontName !== 'helvetica';
    if (faux) { stroke(color); doc.setLineWidth(size * 0.022); }
    const str = S(t);
    doc.text(str, x, y, { align, maxWidth: maxW, renderingMode: faux ? 'fillThenStroke' : 'fill' } as any);
    if (faux) doc.setLineWidth(0.2);
  }
  const tw = (t: string, size: number, weight: 'normal' | 'bold' = 'normal') => { setFont(size, weight); return doc.getTextWidth(S(t)); };

  function opacity(o: number) { try { (doc as any).setGState(new (doc as any).GState({ opacity: o })); } catch { /* noop */ } }

  function rrect(x: number, y: number, w: number, h: number, r: number, c: RGB) {
    fill(c); doc.roundedRect(x, y, w, h, r, r, 'F');
  }
  function card(x: number, y: number, w: number, h: number, r = 16, c: RGB = WHITE) {
    opacity(0.5); fill([210, 203, 222]); doc.roundedRect(x + 2, y + 5, w, h, r, r, 'F'); opacity(1); // soft shadow
    rrect(x, y, w, h, r, c);
  }
  function pageBg(tint: RGB = [236, 232, 244]) {
    fill(CREAM); doc.rect(0, 0, W, H, 'F');
    opacity(0.5); fill(tint); doc.circle(W - 40, 60, 150, 'F'); opacity(1);
  }
  function eyebrow(label: string, color: RGB = VIOLET) {
    txt(PAD, 70, label.toUpperCase(), { size: 10.5, weight: 'bold', color, align: 'left' });
    // letter-spacing emulation not available; keep as-is
  }
  function pageTitle(title: string) {
    txt(PAD, 105, title, { size: 30, weight: 'bold', color: INK });
  }
  function watermark() {
    opacity(0.5);
    rrect(W - 92, 34, 40, 40, 12, [230, 227, 238]);
    fill(VIOLET_L); doc.circle(W - 72, 54, 7, 'F');
    opacity(1);
  }

  // 2-segment donut (anchor violet + rest teal), with white hole and center text
  function donut(cx: number, cy: number, R: number, rIn: number, anchorShare: number, cAnchor: RGB, cRest: RGB) {
    fill(cRest); doc.circle(cx, cy, R, 'F');
    const a0 = -Math.PI / 2;
    const a1 = a0 + Math.max(0, Math.min(1, anchorShare)) * Math.PI * 2;
    const steps = Math.max(2, Math.round(anchorShare * 80));
    fill(cAnchor);
    for (let k = 0; k < steps; k++) {
      const t0 = a0 + (a1 - a0) * (k / steps);
      const t1 = a0 + (a1 - a0) * ((k + 1) / steps);
      doc.triangle(cx, cy, cx + R * Math.cos(t0), cy + R * Math.sin(t0), cx + R * Math.cos(t1), cy + R * Math.sin(t1), 'F');
    }
    fill(WHITE); doc.circle(cx, cy, rIn, 'F');
  }

  // horizontal bar with light track
  function hbar(x: number, y: number, w: number, h: number, frac: number, c: RGB) {
    rrect(x, y, w, h, h / 2, TRACK);
    const bw = Math.max(h, w * Math.max(0, Math.min(1, frac)));
    rrect(x, y, bw, h, h / 2, c);
  }

  return { doc, fill, stroke, ink, txt, tw, opacity, rrect, card, pageBg, eyebrow, pageTitle, watermark, donut, hbar, S, setFont };
}

type Draw = ReturnType<typeof makeDraw>;

/* ── PAGE 1 · Cover ───────────────────────────────────────────────── */
function pCover(d: Draw, m: CostReportModel) {
  d.pageBg([234, 228, 246]);
  // logo tile
  d.rrect(PAD, 40, 62, 62, 16, [246, 244, 250]);
  d.fill(VIOLET_L); d.doc.circle(PAD + 31, 71, 11, 'F');
  d.fill(WHITE); d.doc.circle(PAD + 31, 71, 4, 'F');
  d.txt(PAD + 78, 66, 'Q O R E', { size: 20, weight: 'bold', color: INK });
  d.txt(PAD + 78, 84, 'LABORATUVAR HİZMETLERİ', { size: 9, weight: 'normal', color: INK2 });

  d.txt(PAD, 150, 'STOK MALİYET ÇALIŞMASI', { size: 12, weight: 'bold', color: VIOLET });
  d.txt(PAD, 205, 'Genel Maliyet', { size: 46, weight: 'bold', color: INK });
  d.txt(PAD, 250, 'Dağılım Raporu', { size: 46, weight: 'bold', color: INK });
  d.txt(PAD, 288, 'Marka, kurum ve lokasyon bazında stok maliyetlerinin', { size: 13, color: INK2 });
  d.txt(PAD, 306, 'genelden detaya analizi.', { size: 13, color: INK2 });

  // stat cards
  d.rrect(PAD, 330, 190, 52, 14, VIOLET);
  d.txt(PAD + 18, 350, 'TOPLAM STOK MALİYETİ', { size: 8.5, weight: 'bold', color: [230, 224, 250] });
  d.txt(PAD + 18, 372, fmtM(m.totalTRY), { size: 20, weight: 'bold', color: WHITE });
  d.card(PAD + 205, 330, 200, 52, 14, WHITE);
  d.txt(PAD + 223, 350, 'RAPOR DÖNEMİ', { size: 8.5, weight: 'bold', color: INK3 });
  d.txt(PAD + 223, 372, m.periodLabel, { size: 16, weight: 'bold', color: INK });
}

/* ── PAGE 2 · Yönetici Özeti ─────────────────────────────────────── */
function pExec(d: Draw, m: CostReportModel) {
  d.pageBg(); d.watermark();
  d.eyebrow('01 · Genel Bakış'); d.pageTitle('Yönetici Özeti');
  const y = 135, cw = (W - PAD * 2 - 3 * 14) / 4, ch = 96;
  // anchor kpi (violet)
  d.rrect(PAD, y, cw, ch, 16, VIOLET);
  d.txt(PAD + 18, y + 30, 'Toplam Maliyet', { size: 12, color: [230, 224, 250] });
  d.txt(PAD + 18, y + 62, fmtM(m.totalTRY), { size: 26, weight: 'bold', color: WHITE });
  d.txt(PAD + 18, y + 82, `${fmtFull(m.totalTRY)} toplam stok değeri`, { size: 9.5, color: [222, 214, 248] });
  const kpis: { label: string; value: string; sub: string; color: RGB }[] = [
    { label: 'Marka / Tedarikçi', value: String(m.brandCount), sub: `${m.anchorBrand} + ${Math.max(0, m.brandCount - 1)} diğer`, color: TEAL },
    { label: 'Kurum & Birim', value: String(m.locationCount), sub: 'Depo ve laboratuvarlar', color: ORANGE },
    { label: `${m.anchorBrand} Payı`, value: fmtPct(m.anchorShare), sub: `Diğer pay ${fmtPct(m.restShare)}`, color: CORAL },
  ];
  kpis.forEach((k, i) => {
    const x = PAD + (cw + 14) * (i + 1);
    d.card(x, y, cw, ch, 16, WHITE);
    d.txt(x + 18, y + 30, k.label, { size: 12, color: INK2 });
    d.txt(x + 18, y + 62, k.value, { size: 28, weight: 'bold', color: k.color });
    d.txt(x + 18, y + 82, k.sub, { size: 9.5, color: INK3 });
  });
  // insight card
  d.card(PAD, 250, W - PAD * 2, 110, 18, WHITE);
  d.rrect(PAD + 26, 285, 42, 42, 12, [237, 233, 250]);
  d.fill(VIOLET); d.doc.roundedRect(PAD + 39, 298, 16, 16, 5, 5, 'F');
  d.txt(PAD + 86, 296, m.insightTitle, { size: 14.5, weight: 'bold', color: INK });
  d.txt(PAD + 86, 318, m.insightBody, { size: 12.5, color: INK2, maxW: W - PAD * 2 - 120 });
}

/* ── PAGE 3 · Genel Dağılım (donut) ──────────────────────────────── */
function pDist(d: Draw, m: CostReportModel) {
  d.pageBg(); d.watermark();
  d.eyebrow('02 · Genel Dağılım'); d.pageTitle(`${m.anchorBrand} & Diğerleri Payı`);
  const cx = 190, cy = 250, R = 108, rIn = 62;
  d.donut(cx, cy, R, rIn, m.anchorShare, VIOLET, TEAL);
  d.txt(cx, cy - 6, 'Toplam', { size: 11, color: INK2, align: 'center' });
  d.txt(cx, cy + 18, fmtM(m.totalTRY).replace(' ₺', ''), { size: 22, weight: 'bold', color: INK, align: 'center' });
  d.txt(cx, cy + 36, '₺', { size: 11, color: INK2, align: 'center' });
  // rows
  const rx = 380, rw = W - PAD - rx, rh = 78;
  const rows = [
    { name: m.anchorBrand, share: m.anchorShare, total: m.anchorTotal, c: VIOLET, sub: `${fmtFull(m.anchorTotal)} — en büyük maliyet kalemi` },
    { name: 'Diğer markalar', share: m.restShare, total: m.restTotal, c: TEAL, sub: `${fmtFull(m.restTotal)} — ${Math.max(0, m.brandCount - 1)} tedarikçi` },
  ];
  rows.forEach((r, i) => {
    const y = 190 + i * (rh + 18);
    d.rrect(rx - 8, y, 12, rh, 6, r.c);
    d.card(rx, y, rw, rh, 16, WHITE);
    d.txt(rx + 22, y + 32, r.name, { size: 17, weight: 'bold', color: INK });
    d.txt(rx + 22, y + 56, r.sub, { size: 11.5, color: INK2 });
    d.txt(rx + rw - 22, y + 40, fmtPct(r.share), { size: 22, weight: 'bold', color: r.c, align: 'right' });
  });
}

/* generic labeled horizontal bar chart page */
function barPage(d: Draw, opts: { eyebrow: string; ec: RGB; title: string; total?: { label: string; value: string; c: RGB }; rows: { label: string; value: number; c: RGB }[]; valueFmt?: (v: number) => string }) {
  d.pageBg();
  d.eyebrow(opts.eyebrow, opts.ec); d.pageTitle(opts.title);
  if (opts.total) {
    d.rrect(W - PAD - 172, 40, 172, 56, 14, opts.total.c);
    d.txt(W - PAD - 16, 62, opts.total.label.toUpperCase(), { size: 8.5, weight: 'bold', color: WHITE, align: 'right' });
    d.txt(W - PAD - 16, 84, opts.total.value, { size: 20, weight: 'bold', color: WHITE, align: 'right' });
  }
  d.card(PAD, 130, W - PAD * 2, 230, 20, WHITE);
  const rows = opts.rows;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const labelW = 170, barX = PAD + 40 + labelW, barW = W - PAD - 110 - barX, valX = W - PAD - 30;
  const n = rows.length, top = 165, gap = Math.min(40, (330 - top) / Math.max(1, n));
  const fmt = opts.valueFmt || fmtM;
  rows.forEach((r, i) => {
    const y = top + i * gap;
    d.txt(barX - 16, y + 4, r.label, { size: 12.5, weight: 'bold', color: r.c[0] === OTHER_COLOR[0] ? INK3 : INK, align: 'right' });
    d.hbar(barX, y - 8, barW, 16, r.value / max, r.c);
    d.txt(valX, y + 4, fmt(r.value), { size: 13, weight: 'bold', color: r.c[0] === OTHER_COLOR[0] ? INK3 : INK, align: 'right' });
  });
}

/* ── PAGE 4 · Lider marka kırılımı ───────────────────────────────── */
function pAnchorDetail(d: Draw, m: CostReportModel) {
  barPage(d, {
    eyebrow: `03 · ${m.anchorBrand} Detayı`, ec: VIOLET,
    title: `${m.anchorBrand} Maliyet Kırılımı`,
    total: { label: `${m.anchorBrand} Toplamı`, value: fmtM(m.anchorTotal), c: VIOLET },
    rows: m.anchorByLocation.map((l) => ({ label: l.name, value: l.tryTotal, c: VIOLET })),
  });
}

/* ── PAGE 5 · Marka bazlı sıralama ───────────────────────────────── */
function pBrandRank(d: Draw, m: CostReportModel) {
  const rows = m.nonAnchorBrands.map((b) => ({ label: b.brand, value: b.tryTotal, c: b.color }));
  if (m.nonAnchorDiğer) rows.push({ label: `Diğer ${m.nonAnchorDiğer.count} tedarikçi`, value: m.nonAnchorDiğer.tryTotal, c: OTHER_COLOR });
  barPage(d, {
    eyebrow: '04 · Diğer Markalar', ec: TEAL,
    title: 'Marka Bazlı Sıralama',
    total: { label: 'Diğer Toplamı', value: fmtM(m.restTotal), c: TEAL },
    rows,
  });
}

/* ── PAGE 6 · Treemap ────────────────────────────────────────────── */
function pTreemap(d: Draw, m: CostReportModel) {
  d.pageBg();
  d.eyebrow('05 · Bütünsel Görünüm'); d.pageTitle('Marka Alan Haritası');
  d.txt(W - PAD, 60, 'Kutu alanları her markanın toplam maliyet payıyla orantılıdır', { size: 11, color: INK2, align: 'right' });
  const area = { x: PAD, y: 130, w: W - PAD * 2, h: 235 };
  const items = m.treemap.filter((t) => t.tryTotal > 0);
  const sum = items.reduce((a, t) => a + t.tryTotal, 0) || 1;
  // anchor big box left; rest squarified right
  const anchor = items[0];
  const rest = items.slice(1);
  const anchorFrac = Math.max(0.42, Math.min(0.55, anchor.tryTotal / sum));
  const aw = area.w * anchorFrac;
  drawTile(d, area.x, area.y, aw - 8, area.h, anchor, true);
  squarify(d, rest, { x: area.x + aw + 4, y: area.y, w: area.w - aw - 4, h: area.h });
}
function drawTile(d: Draw, x: number, y: number, w: number, h: number, t: { brand: string; tryTotal: number; share: number; color: RGB }, big = false) {
  if (w < 10 || h < 10) return;
  d.rrect(x, y, w, h, Math.min(14, w / 4, h / 4), t.color);
  const pad = big ? 22 : 10;
  const showName = w > 46 && h > 24;
  const showVal = w > 58 && h > 42;
  if (big) {
    d.txt(x + pad, y + h - 40, t.brand, { size: 22, weight: 'bold', color: WHITE, maxW: w - pad * 2 });
    d.txt(x + pad, y + h - 16, `${fmtM(t.tryTotal)} · ${fmtPct(t.share)}`, { size: 15, weight: 'bold', color: WHITE, maxW: w - pad * 2 });
    return;
  }
  if (showName) d.txt(x + pad, y + h - (showVal ? 24 : 10), t.brand, { size: w > 100 ? 13 : 10.5, weight: 'bold', color: WHITE, maxW: w - pad * 2 });
  if (showVal) d.txt(x + pad, y + h - 10, fmtM(t.tryTotal), { size: 9.5, weight: 'normal', color: WHITE, maxW: w - pad * 2 });
}
// squarified treemap (simplified row-based)
function squarify(d: Draw, items: { brand: string; tryTotal: number; share: number; color: RGB }[], rect: { x: number; y: number; w: number; h: number }) {
  const total = items.reduce((a, t) => a + t.tryTotal, 0) || 1;
  let { x, y, w, h } = rect;
  let remaining = items.slice();
  const area = w * h;
  while (remaining.length) {
    const horizontal = w >= h;
    const side = horizontal ? h : w;
    // greedily take items into a row until aspect worsens
    let row: typeof remaining = [];
    let best = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining.slice(0, i + 1);
      const s = cand.reduce((a, t) => a + t.tryTotal, 0);
      const rowArea = (s / total) * area;
      const rowThick = rowArea / side;
      const worst = Math.max(...cand.map((t) => {
        const a = (t.tryTotal / total) * area;
        const len = a / rowThick;
        return Math.max(rowThick / len, len / rowThick);
      }));
      if (worst <= best) { best = worst; row = cand; } else break;
    }
    const s = row.reduce((a, t) => a + t.tryTotal, 0);
    const rowArea = (s / total) * area;
    const rowThick = Math.max(1, rowArea / side);
    let off = 0;
    row.forEach((t) => {
      const a = (t.tryTotal / total) * area;
      const len = Math.max(1, a / rowThick);
      if (horizontal) drawTile(d, x + 0, y + off, rowThick - 6, len - 6, t);
      else drawTile(d, x + off, y + 0, len - 6, rowThick - 6, t);
      off += len;
    });
    if (horizontal) { x += rowThick; w -= rowThick; } else { y += rowThick; h -= rowThick; }
    remaining = remaining.slice(row.length);
    if (w < 2 || h < 2) break;
  }
}

/* ── PAGE 7 · Lokasyon bazlı stacked ─────────────────────────────── */
function pLocations(d: Draw, m: CostReportModel) {
  d.pageBg();
  d.eyebrow('06 · Kurum Dağılımı', ORANGE); d.pageTitle('Lokasyon Bazlı Maliyet');
  // legend
  d.fill(VIOLET); d.doc.circle(W - 205, 56, 5, 'F'); d.txt(W - 195, 60, m.anchorBrand, { size: 11, color: INK2 });
  d.fill(TEAL); d.doc.circle(W - 110, 56, 5, 'F'); d.txt(W - 100, 60, 'Diğer', { size: 11, color: INK2 });
  d.card(PAD, 120, W - PAD * 2, 245, 20, WHITE);
  const locs = m.locations.slice(0, 3);
  const max = Math.max(1, ...locs.map((l) => l.tryTotal));
  const colW = 130, gap = (W - PAD * 2 - 60 - colW * locs.length) / (locs.length + 1);
  const baseY = 330, maxH = 175;
  locs.forEach((l, i) => {
    const x = PAD + 30 + gap + i * (colW + gap);
    const barH = maxH * (l.tryTotal / max);
    const y = baseY - barH;
    const anchorH = barH * (l.tryTotal > 0 ? l.anchorTotal / l.tryTotal : 0);
    const restH = barH - anchorH;
    // total on top
    d.txt(x + colW / 2, y - 14, fmtM(l.tryTotal), { size: 14, weight: 'bold', color: INK, align: 'center' });
    // rest (teal) top, anchor (violet) bottom
    d.rrect(x, y, colW, restH, 12, TEAL);
    d.rrect(x, y + restH, colW, Math.max(0, anchorH), 12, VIOLET);
    if (restH > 22) d.txt(x + colW / 2, y + restH / 2 + 4, fmtM(l.restTotal).replace(' ₺', ''), { size: 12, weight: 'bold', color: WHITE, align: 'center' });
    if (anchorH > 22) d.txt(x + colW / 2, y + restH + anchorH / 2 + 4, fmtM(l.anchorTotal).replace(' ₺', ''), { size: 12, weight: 'bold', color: WHITE, align: 'center' });
    // label
    d.txt(x + colW / 2, baseY + 22, l.name, { size: 12, weight: 'bold', color: INK, align: 'center', maxW: colW + gap * 0.6 });
    d.txt(x + colW / 2, baseY + 40, fmtPct(l.share), { size: 12, weight: 'bold', color: ORANGE, align: 'center' });
  });
}

/* ── PAGE 8 · Lab/Hastane bazlı iki kolon ────────────────────────── */
function pHospitals(d: Draw, m: CostReportModel) {
  d.pageBg();
  d.eyebrow('07 · Kurum Detayı', ORANGE); d.pageTitle(`${m.anchorBrand} · Lab Dağılımı`);
  d.txt(W - PAD, 60, `${m.anchorBrand} lab kit + sarf maliyeti · ${fmtM(m.anchorByHospital.reduce((a, h) => a + h.tryTotal, 0))}`, { size: 11, color: INK2, align: 'right' });
  d.card(PAD, 120, W - PAD * 2, 250, 20, WHITE);
  const rows = m.anchorByHospital;
  if (!rows.length) { d.txt(W / 2, 250, 'Laboratuvar dağılım verisi bulunamadı.', { size: 13, color: INK3, align: 'center' }); return; }
  const max = Math.max(1, ...rows.map((r) => r.tryTotal));
  const left = rows.slice(0, 8), right = rows.slice(8, 16);
  const clip = (t: string, w: number): string => {
    if (d.tw(t, 10.5, 'bold') <= w) return t;
    let s = t;
    while (s.length > 1 && d.tw(s + '…', 10.5, 'bold') > w) s = s.slice(0, -1);
    return s + '…';
  };
  const drawCol = (items: typeof rows, colX: number, colW: number, c: RGB) => {
    const labelW = 132, barX = colX + labelW, barW = colW - labelW - 70, valX = colX + colW - 8;
    const top = 165, gap = 24;
    items.forEach((r, i) => {
      const y = top + i * gap;
      d.txt(barX - 10, y + 4, clip(r.name, labelW - 14), { size: 10.5, weight: 'bold', color: INK, align: 'right' });
      d.hbar(barX, y - 5, barW, 12, r.tryTotal / max, c);
      d.txt(valX, y + 4, fmtM(r.tryTotal), { size: 10.5, weight: 'bold', color: INK, align: 'right' });
    });
  };
  const colW = (W - PAD * 2 - 60) / 2;
  drawCol(left, PAD + 20, colW, VIOLET);
  if (right.length) drawCol(right, PAD + 40 + colW, colW, TEAL);
}

/* ── PAGE 9 · Detay tablosu ──────────────────────────────────────── */
function pTable(d: Draw, m: CostReportModel) {
  d.pageBg(); d.watermark();
  d.eyebrow('08 · Detay Tablosu'); d.pageTitle('Marka Maliyet Özeti');
  d.card(PAD, 130, W - PAD * 2, 240, 20, WHITE);
  const x0 = PAD + 24, xLoc = PAD + 250, xCost = W - PAD - 140, xPay = W - PAD - 24, top = 175;
  const locW = xCost - 96 - xLoc; // maliyet değeri için 96px pay bırak
  const clip = (t: string, w: number): string => {
    if (d.tw(t, 11.5) <= w) return t;
    let s = t;
    while (s.length > 1 && d.tw(s + '…', 11.5) > w) s = s.slice(0, -1);
    return s + '…';
  };
  d.txt(x0 + 24, top - 12, 'MARKA / TEDARİKÇİ', { size: 10, weight: 'bold', color: INK3 });
  d.txt(xLoc, top - 12, 'ANA LOKASYON', { size: 10, weight: 'bold', color: INK3 });
  d.txt(xCost, top - 12, 'MALİYET (₺)', { size: 10, weight: 'bold', color: INK3, align: 'right' });
  d.txt(xPay, top - 12, 'PAY', { size: 10, weight: 'bold', color: INK3, align: 'right' });
  const rh = 21;
  m.tableRows.forEach((r, i) => {
    const y = top + 8 + i * rh;
    if (i % 2 === 1) { d.opacity(0.6); d.rrect(x0, y - 12, W - PAD * 2 - 48, rh, 5, [246, 244, 250]); d.opacity(1); }
    d.fill(r.color); d.doc.roundedRect(x0 + 4, y - 6, 11, 11, 3, 3, 'F');
    d.txt(x0 + 24, y + 3, r.brand, { size: 12, weight: 'bold', color: r.muted ? INK3 : INK });
    d.txt(xLoc, y + 3, clip(r.mainLocation, locW), { size: 11.5, color: r.muted ? INK3 : INK2 });
    d.txt(xCost, y + 3, fmtFull(r.tryTotal).replace(' ₺', ''), { size: 12, weight: 'bold', color: r.muted ? INK3 : INK, align: 'right' });
    d.txt(xPay, y + 3, fmtPct(r.share), { size: 12, weight: 'bold', color: r.muted ? INK3 : (i === 0 ? VIOLET : INK2), align: 'right' });
  });
}

/* ── PAGE 10 · Özet & Yöntem ─────────────────────────────────────── */
function pClosing(d: Draw, m: CostReportModel) {
  d.pageBg([234, 228, 246]);
  d.txt(PAD, 110, 'ÖZET & YÖNTEM', { size: 12, weight: 'bold', color: VIOLET });
  d.txt(PAD, 160, 'Genelden detaya, tek', { size: 40, weight: 'bold', color: INK });
  d.txt(PAD, 202, 'bakışta stok maliyeti', { size: 40, weight: 'bold', color: INK });
  const y = 240, cw = (W - PAD * 2 - 2 * 16) / 3, ch = 96;
  const cards: { head: string; c: RGB; body: string }[] = [
    { head: fmtM(m.totalTRY), c: VIOLET, body: `Toplam stok maliyeti · ${m.brandCount} marka, ${m.locationCount} kurum` },
    { head: m.locations[0] ? fmtPct(m.locations[0].share) + ' ' + m.locations[0].name.split(' ')[0] : '—', c: TEAL, body: m.locations[0] ? `Maliyetin büyük kısmı ${m.locations[0].name}'da` : '—' },
    { head: `${m.anchorBrand} ${fmtPct(m.anchorShare)}`, c: ORANGE, body: 'Tek tedarikçi olarak en büyük maliyet kalemi' },
  ];
  cards.forEach((c, i) => {
    const x = PAD + (cw + 16) * i;
    d.card(x, y, cw, ch, 16, WHITE);
    d.txt(x + 18, y + 40, c.head, { size: 20, weight: 'bold', color: c.c, maxW: cw - 36 });
    d.txt(x + 18, y + 66, c.body, { size: 11.5, color: INK2, maxW: cw - 36 });
  });
  // footer
  d.rrect(PAD, 356, 30, 30, 9, [246, 244, 250]);
  d.fill(VIOLET_L); d.doc.circle(PAD + 15, 371, 5, 'F');
  d.txt(PAD + 44, 368, 'QORE', { size: 13, weight: 'bold', color: INK });
  d.txt(PAD + 44, 382, 'Tüm tutarlar TL bazındadır · Anlık maliyet snapshot verisinden üretilmiştir', { size: 9.5, color: INK2 });
}

/** Modeli 10 sayfalık PDF'e çizer (doc çağırana ait). */
export function drawCostReport(doc: jsPDF, model: CostReportModel, opts: { fontName: string; sanitize: boolean }) {
  const d = makeDraw({ doc, fontName: opts.fontName, sanitize: opts.sanitize });
  const pages = [pCover, pExec, pDist, pAnchorDetail, pBrandRank, pTreemap, pLocations, pHospitals, pTable, pClosing];
  pages.forEach((fn, i) => { if (i > 0) doc.addPage([W, H], 'landscape'); fn(d, model); });
}

/** Türkçe fontu (varsa) yükleyip 10 sayfalık raporu üretir, jsPDF döner. */
export async function generateCostReportPdf(model: CostReportModel): Promise<jsPDF> {
  const { default: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: [W, H] });
  let fontName = 'helvetica', sanitize = true;
  try {
    const { loadTurkishFont } = await import('./pdf-assets');
    const b64 = await loadTurkishFont();
    if (b64) {
      doc.addFileToVFS('NotoTR.ttf', b64);
      doc.addFont('NotoTR.ttf', 'NotoTR', 'normal');
      fontName = 'NotoTR'; sanitize = false;
    }
  } catch { /* helvetica fallback */ }
  drawCostReport(doc, model, { fontName, sanitize });
  return doc;
}
