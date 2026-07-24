"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildActionFormPdf = exports.pngSize = exports.CLAY = void 0;
/**
 * Clay tutanak tasarım sistemi — Cloud Functions (WhatsApp/e-posta PDF) sürümü.
 * İstemci tarafındaki src/lib/pdf/clay-tutanak.ts ile aynı tasarımı üretir;
 * fark yalnızca varlık (font/logo) yükleme yöntemidir. Doküman px birimiyle
 * oluşturulur (A4 = 794×1123) ki ölçüler CSS px ile birebir eşleşsin.
 */
const jspdf_1 = require("jspdf");
const qrcode_1 = __importDefault(require("qrcode"));
exports.CLAY = {
    ink: [44, 38, 32], sub: [90, 83, 72], soft: [143, 132, 114],
    mute: [177, 154, 118], body: [74, 68, 59],
    orange: [189, 134, 57], orangeD: [165, 114, 45], orangeText: [138, 106, 47],
    beige: [247, 241, 230], beige2: [243, 231, 208], beige3: [250, 246, 238],
    line: [236, 224, 203], line2: [240, 231, 214], lineHead: [236, 220, 191],
    green: [125, 158, 99], greenD: [95, 124, 72], greenBg: [234, 241, 226], greenLine: [211, 226, 195],
    red: [176, 74, 74], redD: [150, 60, 60], redBg: [245, 232, 232], redLine: [226, 200, 200],
    sign: [203, 188, 162], footer: [182, 171, 151], white: [255, 255, 255],
};
const FOOTER_TEXT = 'Bu belge Qore sistemi tarafından oluşturulmuştur';
const PAGE = { PAD: 42, TOP: 38 };
/** PNG genişlik/yüksekliğini base64'ten (IHDR) okur. */
function pngSize(b64) {
    try {
        const buf = Buffer.from(b64.slice(0, 64), 'base64');
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    catch (_a) {
        return { w: 1, h: 1 };
    }
}
exports.pngSize = pngSize;
function setupFonts(doc, a) {
    const f = a.fonts;
    try {
        if (f.semibold && f.extrabold && f.black) {
            doc.addFileToVFS('Nunito-SemiBold.ttf', f.semibold);
            doc.addFont('Nunito-SemiBold.ttf', 'Nunito', 'normal');
            doc.addFileToVFS('Nunito-ExtraBold.ttf', f.extrabold);
            doc.addFont('Nunito-ExtraBold.ttf', 'Nunito', 'bold');
            doc.addFileToVFS('Nunito-Black.ttf', f.black);
            doc.addFont('Nunito-Black.ttf', 'NunitoBlack', 'normal');
            return { normal: ['Nunito', 'normal'], bold: ['Nunito', 'bold'], black: ['NunitoBlack', 'normal'] };
        }
    }
    catch ( /* fall through */_a) { /* fall through */ }
    if (f.noto) {
        try {
            doc.addFileToVFS('NotoSans.ttf', f.noto);
            doc.addFont('NotoSans.ttf', 'NotoSans', 'normal');
            doc.addFont('NotoSans.ttf', 'NotoSans', 'bold');
            return { normal: ['NotoSans', 'normal'], bold: ['NotoSans', 'bold'], black: ['NotoSans', 'bold'] };
        }
        catch ( /* fall through */_b) { /* fall through */ }
    }
    return { normal: ['helvetica', 'normal'], bold: ['helvetica', 'bold'], black: ['helvetica', 'bold'] };
}
function makeClay(doc, fonts) {
    const C = exports.CLAY;
    const pick = (w) => (w >= 900 ? fonts.black : w >= 800 ? fonts.bold : fonts.normal);
    const setFontW = (w, size) => { const [fn, st] = pick(w); doc.setFont(fn, st); doc.setFontSize(size); };
    const T = (str, x, y, o = {}) => {
        const { size = 12, w = 600, color = C.ink, align = 'left', baseline = 'alphabetic', spacing = 0, upper = false, maxWidth } = o;
        setFontW(w, size);
        doc.setTextColor(color[0], color[1], color[2]);
        const s = upper ? String(str).toLocaleUpperCase('tr-TR') : String(str);
        const opt = { align, baseline };
        if (spacing)
            opt.charSpace = spacing;
        if (maxWidth)
            opt.maxWidth = maxWidth;
        doc.text(s, x, y, opt);
    };
    const measure = (str, w, size, spacing = 0) => { setFontW(w, size); let t = doc.getTextWidth(String(str)); if (spacing)
        t += spacing * Math.max(0, String(str).length - 1); return t; };
    const split = (str, w, size, maxW) => { setFontW(w, size); return doc.splitTextToSize(String(str), maxW); };
    const fitSize = (str, w, size, maxW, minSize = 8.5) => {
        const measured = measure(str, w, size);
        return measured > maxW ? Math.max(minSize, (size * maxW) / measured) : size;
    };
    const card = (x, y, w, h, r, fill, stroke, lw = 1) => {
        if (fill)
            doc.setFillColor(fill[0], fill[1], fill[2]);
        if (stroke) {
            doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
            doc.setLineWidth(lw);
        }
        doc.roundedRect(x, y, w, h, r, r, fill && stroke ? 'FD' : fill ? 'F' : 'S');
    };
    const dot = (x, y, d, color, round = 3) => { doc.setFillColor(color[0], color[1], color[2]); doc.roundedRect(x, y, d, d, round, round, 'F'); };
    const hline = (x1, x2, yy, color, lw = 1) => { doc.setDrawColor(color[0], color[1], color[2]); doc.setLineWidth(lw); doc.line(x1, yy, x2, yy); };
    const section = (label, x, y, right) => {
        const lw = measure(label, 900, 10.5, 1.6);
        T(label, x, y + 9, { size: 10.5, w: 900, color: C.orangeD, upper: true, spacing: 1.6 });
        hline(x + lw + 12, right, y + 6, C.line);
        return y + 20;
    };
    const table = (x, y, W, cols, rows, o = {}) => {
        var _a, _b;
        const { headH = 32, minRowH = 38, vpad = 10, lineH = 16 } = o;
        const pageBottom = (_a = o.pageBottom) !== null && _a !== void 0 ? _a : doc.internal.pageSize.getHeight() - 40;
        const topY = (_b = o.topY) !== null && _b !== void 0 ? _b : PAGE.TOP;
        const RIGHT = x + W;
        const totalFixed = cols.filter((c) => c.w).reduce((s, c) => s + (c.w || 0), 0);
        const flexCount = cols.filter((c) => !c.w).length;
        const flexW = (W - totalFixed) / Math.max(1, flexCount);
        const colX = [];
        const colW = [];
        let cx = x;
        cols.forEach((c) => { colX.push(cx); const cw = c.w || flexW; colW.push(cw); cx += cw; });
        const wrapped = rows.map((r) => cols.map((c, ci) => {
            if (c.badge)
                return { lines: [String(r[c.key])], size: c.size || 13 };
            const raw = r[c.key] == null || r[c.key] === '' ? '-' : String(r[c.key]);
            let size = c.size || 12;
            const inner = colW[ci] - 24;
            if (c.nowrap) {
                const w0 = measure(raw, c.w2 || 700, size);
                if (w0 > inner)
                    size = Math.max(8.5, (size * inner) / w0);
                return { lines: [raw], size };
            }
            return { lines: split(raw, c.w2 || 700, size, inner), size };
        }));
        const rowHs = wrapped.map((cells) => Math.max(minRowH, Math.max(...cells.map((l) => l.lines.length)) * lineH + 2 * vpad - lineH + 8));
        const drawHead = (yy) => {
            doc.setFillColor(C.beige2[0], C.beige2[1], C.beige2[2]);
            doc.roundedRect(x, yy, W, headH, 16, 16, 'F');
            doc.rect(x, yy + 8, W, headH - 8, 'F');
            hline(x, RIGHT, yy + headH, C.lineHead);
            cols.forEach((c, i) => { const tx = c.align === 'center' ? colX[i] + colW[i] / 2 : colX[i] + 14; T(c.label, tx, yy + headH / 2 + 1, { size: 9.5, w: 900, color: C.orangeText, upper: true, spacing: 0.8, align: c.align === 'center' ? 'center' : 'left', baseline: 'middle' }); });
        };
        const drawRow = (ri, ry, first) => {
            const rh = rowHs[ri];
            if (!first)
                hline(x, RIGHT, ry, C.line2);
            cols.forEach((c, i) => {
                const cCX = colX[i] + colW[i] / 2, cLX = colX[i] + 14, midY = ry + rh / 2;
                if (c.badge) {
                    const bt = String(rows[ri][c.key]);
                    const tw = measure(bt, 900, 13);
                    const pw = Math.max(28, tw + 16), ph = 20;
                    const bx = cCX - pw / 2, by = ry + (rh - ph) / 2;
                    card(bx, by, pw, ph, 8, C.beige2, null);
                    T(bt, cCX, by + ph / 2 + 0.5, { size: 13, w: 900, color: C.ink, align: 'center', baseline: 'middle' });
                }
                else {
                    const cell = wrapped[ri][i];
                    const lines = cell.lines;
                    const startY = midY - ((lines.length - 1) * lineH) / 2;
                    lines.forEach((ln, li) => T(ln, c.align === 'center' ? cCX : cLX, startY + li * lineH, { size: cell.size, w: c.w2 || 700, color: c.color || C.sub, align: c.align === 'center' ? 'center' : 'left', baseline: 'middle' }));
                }
            });
        };
        let i = 0;
        while (i < rows.length) {
            const avail = pageBottom - (y + headH);
            let take = 0, used = 0;
            while (i + take < rows.length && used + rowHs[i + take] <= avail) {
                used += rowHs[i + take];
                take++;
            }
            if (take === 0) {
                if (y <= topY + 1) {
                    take = 1;
                    used = rowHs[i];
                }
                else {
                    doc.addPage();
                    y = topY;
                    continue;
                }
            }
            const grpH = headH + used;
            card(x, y, W, grpH, 16, C.white, C.line);
            drawHead(y);
            let ry = y + headH;
            for (let k = 0; k < take; k++) {
                drawRow(i + k, ry, k === 0);
                ry += rowHs[i + k];
            }
            y += grpH;
            i += take;
            if (i < rows.length) {
                doc.addPage();
                y = topY;
            }
        }
        return y;
    };
    return { C, T, measure, split, fitSize, card, dot, hline, section, table };
}
function badgeTone(t) {
    const C = exports.CLAY;
    if (t === 'red')
        return { bg: C.redBg, ln: C.redLine, dt: C.red, tx: C.redD };
    if (t === 'neutral')
        return { bg: C.beige, ln: C.line, dt: C.orange, tx: C.orangeD };
    return { bg: C.greenBg, ln: C.greenLine, dt: C.green, tx: C.greenD };
}
/** İşlem formu PDF'i üretir ve Buffer döner (WhatsApp/e-posta gönderimi için). */
async function buildActionFormPdf(input, assets) {
    const doc = new jspdf_1.jsPDF({ unit: 'px', format: 'a4', hotfixes: ['px_scaling'] });
    const fonts = setupFonts(doc, assets);
    const clay = makeClay(doc, fonts);
    const C = exports.CLAY;
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const PAD = PAGE.PAD, TOP = PAGE.TOP, RIGHT = PW - PAD, CW = PW - 2 * PAD;
    // header
    if (assets.invLogo) {
        const h = 30, w = h * (assets.invLogo.w / assets.invLogo.h);
        try {
            doc.addImage(`data:image/png;base64,${assets.invLogo.b64}`, 'PNG', PAD, TOP + 8, w, h, undefined, 'FAST');
        }
        catch ( /* ignore */_a) { /* ignore */ }
    }
    const qrFrame = 64, qrPad = 6, qrX = RIGHT - qrFrame, qrY = TOP;
    let qrData = '';
    try {
        qrData = await qrcode_1.default.toDataURL(input.qrPayload, { errorCorrectionLevel: 'M', margin: 0, scale: 6 });
    }
    catch ( /* ignore */_b) { /* ignore */ }
    clay.card(qrX, qrY, qrFrame, qrFrame, 10, C.white, C.line);
    if (qrData) {
        try {
            doc.addImage(qrData, 'PNG', qrX + qrPad, qrY + qrPad, qrFrame - 2 * qrPad, qrFrame - 2 * qrPad, undefined, 'FAST');
        }
        catch ( /* ignore */_c) { /* ignore */ }
    }
    const qLogo = 17, qGap = 5, label = 'QORE', qoreTextSize = 13.5;
    const lblW = clay.measure(label, 800, qoreTextSize, 1.1);
    const sX = qrX + (qrFrame - (qLogo + qGap + lblW)) / 2, rowY = qrY + qrFrame + 6;
    if (assets.qoreLogo) {
        try {
            doc.addImage(`data:image/png;base64,${assets.qoreLogo.b64}`, 'PNG', sX, rowY, qLogo, qLogo, undefined, 'FAST');
        }
        catch ( /* ignore */_d) { /* ignore */ }
    }
    clay.T(label, sX + qLogo + qGap, rowY + qLogo / 2 + 1, { size: qoreTextSize, w: 800, color: C.ink, spacing: 1.1, baseline: 'middle' });
    // title band
    let y = rowY + qLogo + 12;
    const bandH = 54;
    clay.card(PAD, y, CW, bandH, 16, C.beige, C.line);
    const chipW = 118, chipH = 38, chipX = RIGHT - 14 - chipW, chipY = y + (bandH - chipH) / 2;
    const titleMaxW = chipX - (PAD + 20) - 18;
    const titleSize = clay.fitSize(input.title, 900, 24, titleMaxW, 17);
    clay.T(input.title, PAD + 20, y + bandH / 2 + 1, { size: titleSize, w: 900, color: C.ink, baseline: 'middle' });
    clay.card(chipX, chipY, chipW, chipH, 11, C.white, C.line);
    clay.T('FORM NO', chipX + chipW - 13, chipY + 15, { size: 8, w: 800, color: C.mute, align: 'right', spacing: 1.2 });
    const formNoSize = clay.fitSize(input.formNo, 900, 14, chipW - 26, 9.5);
    clay.T(input.formNo, chipX + chipW - 13, chipY + 30, { size: formNoSize, w: 900, color: C.ink, align: 'right' });
    y += bandH + 14;
    // info cards
    const gap = 12, cardW = (CW - gap) / 2;
    const leftRows = [
        ['Laboratuvar', input.labName, null],
        ['Cihaz', input.cihaz, null],
        ['İşlemi Yapan', input.islemiYapan, input.eslikEden ? `Eşlik Eden: ${input.eslikEden}` : null],
    ];
    const infoInnerW = cardW - 32;
    const preparedLeft = leftRows.map(([label, value, sub]) => ({
        label,
        valueLines: clay.split(value || '-', 800, 13, infoInnerW),
        subLines: sub ? clay.split(sub, 700, 10.5, infoInnerW) : [],
    }));
    const fieldHeight = (valueLines, subLines = []) => 33 + Math.max(0, valueLines.length - 1) * 15 + subLines.length * 14;
    const leftH = 42 + preparedLeft.reduce((h, row) => h + fieldHeight(row.valueLines, row.subLines), 0) + 8;
    const preparedDates = [
        { label: 'Başlangıç', lines: clay.split(input.baslangic || '-', 800, 13, infoInnerW) },
        { label: 'Bitiş', lines: clay.split(input.bitis || '-', 800, 13, infoInnerW) },
    ];
    const statusTextW = Math.max(80, infoInnerW - 35);
    const statusLines = clay.split(input.cihazDurumu || '-', 800, 11.5, statusTextW);
    const statusH = Math.max(24, statusLines.length * 14 + 8);
    const rightH = 42
        + preparedDates.reduce((h, row) => h + fieldHeight(row.lines), 0)
        + 10 + statusH + 12;
    const infoH = Math.max(leftH, rightH);
    clay.card(PAD, y, cardW, infoH, 14, C.white, C.line);
    clay.dot(PAD + 16, y + 16, 7, C.orange);
    clay.T('İşlem Bilgileri', PAD + 30, y + 22, { size: 9.5, w: 900, color: C.orangeD, upper: true, spacing: 1.2 });
    let ly = y + 42;
    for (const row of preparedLeft) {
        clay.T(row.label, PAD + 16, ly, { size: 8.5, w: 800, color: C.mute, upper: true, spacing: 0.6 });
        row.valueLines.forEach((line, index) => {
            clay.T(line, PAD + 16, ly + 19 + index * 15, { size: 13, w: 800 });
        });
        ly += 33 + Math.max(0, row.valueLines.length - 1) * 15;
        row.subLines.forEach((line, index) => {
            clay.T(line, PAD + 16, ly + 1 + index * 14, { size: 10.5, w: 700, color: C.soft });
        });
        ly += row.subLines.length * 14;
    }
    const rx = PAD + cardW + gap;
    clay.card(rx, y, cardW, infoH, 14, C.white, C.line);
    clay.dot(rx + 16, y + 16, 7, C.green);
    clay.T('Zaman & Durum', rx + 30, y + 22, { size: 9.5, w: 900, color: C.greenD, upper: true, spacing: 1.2 });
    let ry = y + 42;
    preparedDates.forEach((row) => {
        clay.T(row.label, rx + 16, ry, { size: 8.5, w: 800, color: C.mute, upper: true, spacing: 0.6 });
        row.lines.forEach((line, index) => clay.T(line, rx + 16, ry + 19 + index * 15, { size: 13, w: 800 }));
        ry += fieldHeight(row.lines);
    });
    clay.T('Cihaz Durumu', rx + 16, ry, { size: 8.5, w: 800, color: C.mute, upper: true, spacing: 0.6 });
    const tn = badgeTone(input.durumTone);
    const bpadX = 11, bdot = 7, bgapd = 6;
    const widestStatusLine = Math.max(...statusLines.map((line) => clay.measure(line, 800, 11.5)));
    const bW = Math.min(infoInnerW, bpadX * 2 + bdot + bgapd + widestStatusLine);
    const bH = statusH, bY = ry + 10;
    clay.card(rx + 16, bY, bW, bH, 8, tn.bg, tn.ln);
    clay.dot(rx + 16 + bpadX, bY + (bH - bdot) / 2, bdot, tn.dt, 3.5);
    const statusStartY = bY + bH / 2 - ((statusLines.length - 1) * 14) / 2;
    statusLines.forEach((line, index) => {
        clay.T(line, rx + 16 + bpadX + bdot + bgapd, statusStartY + index * 14, { size: 11.5, w: 800, color: tn.tx, baseline: 'middle' });
    });
    y += infoH + 12;
    // chips
    const chips = input.chips.slice(0, 3);
    if (chips.length) {
        const cg = 12, chW = (CW - (chips.length - 1) * cg) / chips.length;
        const preparedChips = chips.map((chip) => (Object.assign(Object.assign({}, chip), { labelLines: clay.split(chip.label, 800, 8.5, chW - 28), valueLines: clay.split(chip.value || '—', 800, 12.5, chW - 28) })));
        const chipsH = Math.max(56, ...preparedChips.map((chip) => 16 + Math.max(0, chip.labelLines.length - 1) * 11 + 20 + Math.max(0, chip.valueLines.length - 1) * 16 + 13));
        preparedChips.forEach((ch, i) => {
            const cx = PAD + i * (chW + cg);
            clay.card(cx, y, chW, chipsH, 13, C.beige, C.line);
            ch.labelLines.forEach((line, index) => {
                clay.T(line, cx + 14, y + 16 + index * 11, { size: 8.5, w: 800, color: C.mute, upper: true, spacing: 0.45 });
            });
            const valueY = y + 16 + Math.max(0, ch.labelLines.length - 1) * 11 + 20;
            ch.valueLines.forEach((line, index) => {
                clay.T(line, cx + 14, valueY + index * 16, { size: 12.5, w: 800 });
            });
        });
        y += chipsH + 14;
    }
    // detaylar
    const details = (input.details || []).filter((d) => d.value && d.value.trim());
    if (details.length) {
        y = clay.section('İşlem Türü Detayları', PAD, y, RIGHT);
        const detailLabelW = 190, detailValueW = CW - detailLabelW - 54;
        const preparedDetails = details.map((detail) => ({
            labelLines: clay.split(detail.label, 800, 9, detailLabelW),
            valueLines: clay.split(detail.value, 700, 12.5, detailValueW),
        }));
        const detailRowHs = preparedDetails.map((row) => Math.max(row.labelLines.length * 11, row.valueLines.length * 17) + 6);
        const dH = 14 + detailRowHs.reduce((sum, height) => sum + height, 0) + 8;
        clay.card(PAD, y, CW, dH, 16, C.beige3, C.line);
        let dy = y + 22;
        preparedDetails.forEach((row, i) => {
            row.labelLines.forEach((line, index) => clay.T(line, PAD + 18, dy + index * 11, {
                size: 9, w: 800, color: C.mute, upper: true, spacing: 0.45,
            }));
            row.valueLines.forEach((line, index) => clay.T(line, PAD + 36 + detailLabelW, dy + index * 17, {
                size: 12.5, w: 700, color: C.body,
            }));
            dy += detailRowHs[i];
        });
        y += dH + 14;
    }
    // açıklama
    if (input.aciklama && input.aciklama.trim()) {
        y = clay.section('Açıklama', PAD, y, RIGHT);
        const alines = clay.split(input.aciklama, 600, 13, CW - 36);
        const aH = 12 + alines.length * 18 + 10;
        clay.card(PAD, y, CW, aH, 16, C.beige3, C.line);
        alines.forEach((ln, i) => clay.T(ln, PAD + 18, y + 24 + i * 18, { size: 13, w: 600, color: C.body }));
        y += aH + 14;
    }
    if (input.operations.length) {
        y = clay.section('Yapılan İşlemler', PAD, y, RIGHT);
        y = clay.table(PAD, y, CW, [{ key: 'ad', label: 'İşlem', size: 13, w2: 700, color: C.ink }, { key: 'adet', label: 'Adet', w: 72, align: 'center', badge: true }], input.operations, { minRowH: 34 });
        y += 14;
    }
    if (input.parts.length) {
        y = clay.section('Değişen Parçalar', PAD, y, RIGHT);
        y = clay.table(PAD, y, CW, [{ key: 'parca', label: 'Parça', size: 13.5, w2: 800, color: C.ink },
            { key: 'kod', label: 'Kod', w: 130, size: 12, w2: 700, color: C.soft, nowrap: true },
            { key: 'seri', label: 'Seri No', w: 116, size: 12, w2: 700, color: C.sub, nowrap: true },
            { key: 'adet', label: 'Adet', w: 58, align: 'center', badge: true },
            { key: 'birim', label: 'Birim', w: 76, size: 12, w2: 700, color: C.sub, nowrap: true }], input.parts, { minRowH: 40 });
        y += 14;
    }
    if (input.hucreChanges && input.hucreChanges.length) {
        y = clay.section('Hücre Değişimleri', PAD, y, RIGHT);
        y = clay.table(PAD, y, CW, [{ key: 'parca', label: 'Parça', size: 13, w2: 800, color: C.ink },
            { key: 'kod', label: 'Kod', w: 120, size: 12, w2: 700, color: C.soft, nowrap: true },
            { key: 'takilanCikan', label: 'Takılan/Çıkan', w: 150, size: 12, w2: 700, color: C.sub },
            { key: 'kanal', label: 'Kanal', w: 90, size: 12, w2: 700, color: C.sub, nowrap: true }], input.hucreChanges, { minRowH: 36 });
        y += 14;
    }
    // signatures + footer
    const footY = PH - 30, sigY = footY - 76, half = (CW - 40) / 2;
    if (y > sigY - 30)
        doc.addPage();
    const drawSide = (x, side) => {
        var _a, _b;
        if (side.sig) {
            try {
                doc.addImage(side.sig, 'PNG', x, sigY - 48, 130, 44, undefined, 'FAST');
            }
            catch ( /* ignore */_c) { /* ignore */ }
        }
        clay.hline(x, x + half, sigY, C.sign);
        clay.T(side.label, x, sigY + 16, { size: 13, w: 800 });
        const meta = `${((_a = side.name) === null || _a === void 0 ? void 0 : _a.trim()) || 'Ad soyad belirtilmedi'} · ${side.sig ? 'İmzalı' : 'İmza bekleniyor'} · ${((_b = side.date) === null || _b === void 0 ? void 0 : _b.trim()) || 'Tarih belirtilmedi'}`;
        const metaSize = clay.fitSize(meta, 700, 10, half, 7.8);
        clay.T(meta, x, sigY + 35, { size: metaSize, w: 700, color: C.mute });
    };
    drawSide(PAD, input.leftSign);
    drawSide(PAD + half + 40, input.rightSign);
    clay.hline(PAD, RIGHT, footY - 11, C.line2);
    clay.T(FOOTER_TEXT, PW / 2, footY, { size: 9.5, w: 700, color: C.footer, align: 'center', spacing: 0.5 });
    return Buffer.from(doc.output('arraybuffer'));
}
exports.buildActionFormPdf = buildActionFormPdf;
//# sourceMappingURL=clay-pdf.js.map