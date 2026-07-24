"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTransferForm = exports.renderActionForm = exports.claySignaturesFooter = exports.clayTitleBand = exports.clayHeader = exports.makeClay = exports.setupClayFonts = exports.loadClayKit = exports.FOOTER_TEXT = exports.CLAY_PAGE = exports.CLAY = void 0;
const loadPngWithSize = async () => null;
exports.CLAY = {
    ink: [44, 38, 32],
    sub: [90, 83, 72],
    soft: [143, 132, 114],
    mute: [177, 154, 118],
    body: [74, 68, 59],
    orange: [189, 134, 57],
    orangeD: [165, 114, 45],
    orangeText: [138, 106, 47],
    beige: [247, 241, 230],
    beige2: [243, 231, 208],
    beige3: [250, 246, 238],
    line: [236, 224, 203],
    line2: [240, 231, 214],
    lineHead: [236, 220, 191],
    green: [125, 158, 99],
    greenD: [95, 124, 72],
    greenBg: [234, 241, 226],
    greenLine: [211, 226, 195],
    red: [176, 74, 74],
    redD: [150, 60, 60],
    redBg: [245, 232, 232],
    redLine: [226, 200, 200],
    gradA: [211, 164, 92],
    gradB: [181, 126, 51],
    sign: [203, 188, 162],
    footer: [182, 171, 151],
    white: [255, 255, 255],
};
exports.CLAY_PAGE = { PAD: 42, TOP: 38 };
exports.FOOTER_TEXT = 'Bu belge Qore sistemi tarafından oluşturulmuştur';
let _kit = null;
async function fetchB64(url) {
    try {
        const res = await fetch(url);
        if (!res.ok)
            return null;
        const blob = await res.blob();
        return await new Promise((resolve) => {
            const r = new FileReader();
            r.onloadend = () => resolve(r.result.split(',')[1] || null);
            r.onerror = () => resolve(null);
            r.readAsDataURL(blob);
        });
    }
    catch {
        return null;
    }
}
/** Fontları ve logoları yükler (modül düzeyinde önbelleğe alınır). */
async function loadClayKit() {
    if (_kit)
        return _kit;
    const [semibold, extrabold, black, noto, invLogo, qoreLogo] = await Promise.all([
        fetchB64('/fonts/Nunito-SemiBold.ttf'),
        fetchB64('/fonts/Nunito-ExtraBold.ttf'),
        fetchB64('/fonts/Nunito-Black.ttf'),
        fetchB64('https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRA.ttf'),
        loadPngWithSize('/invlogo.png'),
        loadPngWithSize('/blk.png'),
    ]);
    _kit = { fonts: { semibold, extrabold, black, noto }, invLogo, qoreLogo };
    return _kit;
}
exports.loadClayKit = loadClayKit;
/** Fontları jsPDF'e kaydeder; Nunito yoksa NotoSans'a düşer (ikisi de Türkçe destekler). */
function setupClayFonts(doc, kit) {
    const f = kit.fonts;
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
    catch { /* fall through */ }
    if (f.noto) {
        try {
            doc.addFileToVFS('NotoSans.ttf', f.noto);
            doc.addFont('NotoSans.ttf', 'NotoSans', 'normal');
            doc.addFont('NotoSans.ttf', 'NotoSans', 'bold');
            return { normal: ['NotoSans', 'normal'], bold: ['NotoSans', 'bold'], black: ['NotoSans', 'bold'] };
        }
        catch { /* fall through */ }
    }
    return { normal: ['helvetica', 'normal'], bold: ['helvetica', 'bold'], black: ['helvetica', 'bold'] };
}
exports.setupClayFonts = setupClayFonts;
function makeClay(doc, fonts) {
    const C = exports.CLAY;
    const pick = (w) => (w >= 900 ? fonts.black : w >= 800 ? fonts.bold : fonts.normal);
    const setFontW = (w, size) => { const [fn, st] = pick(w); doc.setFont(fn, st); doc.setFontSize(size); };
    function T(str, x, y, o = {}) {
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
    }
    function measure(str, w, size, spacing = 0) {
        setFontW(w, size);
        let t = doc.getTextWidth(String(str));
        if (spacing)
            t += spacing * Math.max(0, String(str).length - 1);
        return t;
    }
    function split(str, w, size, maxW) {
        setFontW(w, size);
        return doc.splitTextToSize(String(str), maxW);
    }
    function fitSize(str, w, size, maxW, minSize = 8.5) {
        const measured = measure(str, w, size);
        return measured > maxW ? Math.max(minSize, (size * maxW) / measured) : size;
    }
    function card(x, y, w, h, r, fill, stroke, lw = 1) {
        if (fill)
            doc.setFillColor(fill[0], fill[1], fill[2]);
        if (stroke) {
            doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
            doc.setLineWidth(lw);
        }
        doc.roundedRect(x, y, w, h, r, r, fill && stroke ? 'FD' : fill ? 'F' : 'S');
    }
    function dot(x, y, d, color, round = 3) {
        doc.setFillColor(color[0], color[1], color[2]);
        doc.roundedRect(x, y, d, d, round, round, 'F');
    }
    function hline(x1, x2, yy, color, lw = 1) {
        doc.setDrawColor(color[0], color[1], color[2]);
        doc.setLineWidth(lw);
        doc.line(x1, yy, x2, yy);
    }
    function gradRoundRect(x, y, w, h, r, a, b) {
        const d = doc;
        d.saveGraphicsState();
        doc.roundedRect(x, y, w, h, r, r);
        d.clip();
        d.discardPath();
        const n = 48;
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            doc.setFillColor(Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t));
            doc.rect(x + (w / n) * i, y, w / n + 1, h, 'F');
        }
        d.restoreGraphicsState();
    }
    /** Turuncu büyük harf başlık + sağa uzanan ince çizgi. `y` başlangıç noktası, döner: yeni y. */
    function section(label, x, y, right) {
        T(label, x, y + 9, { size: 10.5, w: 900, color: C.orangeD, upper: true, spacing: 1.6 });
        hline(x, right, y + 18, C.line);
        return y + 26;
    }
    /**
     * Yuvarlak köşeli tablo: sütun kaydırma, otomatik satır yüksekliği, adet rozetleri
     * ve sayfa taşması (çok satırlı listelerde otomatik sayfa bölme). Döner: alt y.
     */
    function table(x, y, W, cols, rows, o = {}) {
        var _a, _b;
        const { headH = 32, minRowH = 38, vpad = 10, lineH = 16 } = o;
        const pageBottom = (_a = o.pageBottom) !== null && _a !== void 0 ? _a : doc.internal.pageSize.getHeight() - 40;
        const topY = (_b = o.topY) !== null && _b !== void 0 ? _b : exports.CLAY_PAGE.TOP;
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
            cols.forEach((c, i) => {
                const tx = c.align === 'center' ? colX[i] + colW[i] / 2 : colX[i] + 14;
                T(c.label, tx, yy + headH / 2 + 1, { size: 9.5, w: 900, color: C.orangeText, upper: true, spacing: 0.8, align: c.align === 'center' ? 'center' : 'left', baseline: 'middle' });
            });
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
                } // single oversized row: draw anyway
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
    }
    return { C, T, measure, split, fitSize, card, dot, hline, gradRoundRect, section, table };
}
exports.makeClay = makeClay;
/** Klasik-yuvarlak modüller, yumuşak bulucu çerçeveleri ve nokta merkezleriyle markalı QR. */
function drawStyledQr(doc, qr, x, y, size, logoData) {
    const moduleCount = qr.modules.size;
    const quiet = 4;
    const moduleSize = size / (moduleCount + quiet * 2);
    const startX = x + quiet * moduleSize;
    const startY = y + quiet * moduleSize;
    const center = Math.floor(moduleCount / 2);
    const logoClearHalf = 5;
    const inLogoClear = (row, col) => Math.abs(row - center) <= logoClearHalf && Math.abs(col - center) <= logoClearHalf;
    const inFinder = (row, col) => (row < 7 && col < 7)
        || (row < 7 && col >= moduleCount - 7)
        || (row >= moduleCount - 7 && col < 7);
    const isDrawnDark = (row, col) => row >= 0 && row < moduleCount
        && col >= 0 && col < moduleCount
        && !inFinder(row, col)
        && !inLogoClear(row, col)
        && Boolean(qr.modules.get(row, col));
    doc.setFillColor(0, 0, 0);
    const radius = moduleSize * 0.42;
    const inset = moduleSize * 0.055;
    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            if (!isDrawnDark(row, col))
                continue;
            const mx = startX + col * moduleSize;
            const my = startY + row * moduleSize;
            doc.roundedRect(mx + inset, my + inset, moduleSize - inset * 2, moduleSize - inset * 2, radius, radius, 'F');
            const bridge = moduleSize * 0.38;
            if (isDrawnDark(row, col - 1))
                doc.rect(mx, my + (moduleSize - bridge) / 2, moduleSize / 2, bridge, 'F');
            if (isDrawnDark(row, col + 1))
                doc.rect(mx + moduleSize / 2, my + (moduleSize - bridge) / 2, moduleSize / 2, bridge, 'F');
            if (isDrawnDark(row - 1, col))
                doc.rect(mx + (moduleSize - bridge) / 2, my, bridge, moduleSize / 2, 'F');
            if (isDrawnDark(row + 1, col))
                doc.rect(mx + (moduleSize - bridge) / 2, my + moduleSize / 2, bridge, moduleSize / 2, 'F');
        }
    }
    const drawFinder = (row, col) => {
        const fx = startX + col * moduleSize;
        const fy = startY + row * moduleSize;
        doc.setFillColor(0, 0, 0);
        doc.roundedRect(fx, fy, moduleSize * 7, moduleSize * 7, moduleSize * 1.9, moduleSize * 1.9, 'F');
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(fx + moduleSize, fy + moduleSize, moduleSize * 5, moduleSize * 5, moduleSize * 1.35, moduleSize * 1.35, 'F');
        doc.setFillColor(0, 0, 0);
        doc.circle(fx + moduleSize * 3.5, fy + moduleSize * 3.5, moduleSize * 1.5, 'F');
    };
    drawFinder(0, 0);
    drawFinder(0, moduleCount - 7);
    drawFinder(moduleCount - 7, 0);
    const shieldSize = moduleSize * 10.2;
    const shieldX = startX + (center + 0.5) * moduleSize - shieldSize / 2;
    const shieldY = startY + (center + 0.5) * moduleSize - shieldSize / 2;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(shieldX, shieldY, shieldSize, shieldSize, moduleSize * 1.3, moduleSize * 1.3, 'F');
    if (logoData) {
        const logoSize = moduleSize * 8.2;
        try {
            doc.addImage(logoData, 'PNG', shieldX + (shieldSize - logoSize) / 2, shieldY + (shieldSize - logoSize) / 2, logoSize, logoSize, undefined, 'FAST');
        }
        catch { /* QR, logo olmadan da okunabilir kalır. */ }
    }
}
async function clayHeader(doc, clay, kit, opts) {
    var _a;
    const { qrPayload, pad = exports.CLAY_PAGE.PAD, top = exports.CLAY_PAGE.TOP, right, qrFrame = 96 } = opts;
    const C = exports.CLAY;
    if (kit.invLogo) {
        const h = 60, w = h * (kit.invLogo.w / kit.invLogo.h);
        doc.addImage(kit.invLogo.data, 'PNG', pad, top + (qrFrame - h) / 2, w, h, undefined, 'FAST');
    }
    const qrPad = 5, qrX = right - qrFrame, qrY = top;
    clay.card(qrX, qrY, qrFrame, qrFrame, 10, C.white, C.line);
    try {
        const { default: QRCode } = await Promise.resolve().then(() => __importStar(require('qrcode')));
        const qr = QRCode.create(qrPayload, { errorCorrectionLevel: 'H' });
        drawStyledQr(doc, qr, qrX + qrPad, qrY + qrPad, qrFrame - 2 * qrPad, (_a = kit.qoreLogo) === null || _a === void 0 ? void 0 : _a.data);
    }
    catch { /* QR üretimi başarısız olsa da form oluşturulmaya devam eder. */ }
    return qrY + qrFrame;
}
exports.clayHeader = clayHeader;
/** Bej başlık bandı: büyük başlık, sağda beyaz bilgi çipi. Döner: bandın alt y'si. */
function clayTitleBand(doc, clay, o) {
    const C = exports.CLAY;
    const { x, y, w, right, eyebrow, title, titleSize = 24, rightLabel, rightValue, bandH = 54, rightWidth = 118, rightValueSize = 14, rightTextAlign = 'right', } = o;
    clay.card(x, y, w, bandH, 16, C.beige, C.line);
    const chipW = rightWidth, chipH = rightTextAlign === 'center' ? 42 : 38;
    const chipX = right - 14 - chipW, chipY = y + (bandH - chipH) / 2;
    const leftX = x + 20;
    const titleMaxW = Math.max(80, chipX - leftX - 18);
    const safeTitleSize = clay.fitSize(title, 900, titleSize, titleMaxW, 17);
    const hasEyebrow = Boolean(eyebrow.trim());
    if (hasEyebrow) {
        const safeEyebrowSize = clay.fitSize(eyebrow.toLocaleUpperCase('tr-TR'), 800, 9, titleMaxW, 7.5);
        clay.T(eyebrow, leftX, y + 21, { size: safeEyebrowSize, w: 800, color: C.mute, upper: true, spacing: 1.1 });
        clay.T(title, leftX, y + 43, { size: safeTitleSize, w: 900, color: C.ink });
    }
    else {
        clay.T(title, leftX, y + bandH / 2 + 1, { size: safeTitleSize, w: 900, color: C.ink, baseline: 'middle' });
    }
    clay.card(chipX, chipY, chipW, chipH, 11, C.white, C.line);
    const chipTextX = rightTextAlign === 'center' ? chipX + chipW / 2 : chipX + chipW - 13;
    clay.T(rightLabel, chipTextX, chipY + 12, { size: 8, w: 800, color: C.mute, align: rightTextAlign, spacing: 1.2, upper: true });
    const safeRightValueSize = clay.fitSize(rightValue, 900, rightValueSize, chipW - 26, 9.5);
    clay.T(rightValue, chipTextX, chipY + 33, { size: safeRightValueSize, w: 900, color: C.ink, align: rightTextAlign });
    return y + bandH;
}
exports.clayTitleBand = clayTitleBand;
/**
 * İki sütunlu imza alanı + alt bilgi; sayfanın altına sabitlenir.
 * İçerik alt sınırına (contentBottom) yaklaşıldıysa yeni sayfa açar.
 * Yakalanan imza görselleri ve ad-soyad varsa çizgi üzerinde gösterilir.
 */
function claySignaturesFooter(doc, clay, o) {
    const C = exports.CLAY;
    const { pad, right, pageH, left, right2 } = o;
    const CW = right - pad;
    const footY = pageH - 30, sigY = footY - 76, half = (CW - 40) / 2;
    if (o.contentBottom != null && o.contentBottom > sigY - 30) {
        doc.addPage();
    }
    const drawSide = (x, side) => {
        var _a, _b;
        if (side.sig) {
            try {
                doc.addImage(side.sig, 'PNG', x, sigY - 48, 130, 44, undefined, 'FAST');
            }
            catch { /* ignore */ }
        }
        clay.hline(x, x + half, sigY, C.sign);
        clay.T(side.label, x, sigY + 16, { size: 13, w: 800 });
        const meta = `${((_a = side.name) === null || _a === void 0 ? void 0 : _a.trim()) || 'Ad soyad belirtilmedi'} · ${side.sig ? 'İmzalı' : 'İmza bekleniyor'} · ${((_b = side.date) === null || _b === void 0 ? void 0 : _b.trim()) || 'Tarih belirtilmedi'}`;
        const metaSize = clay.fitSize(meta, 700, 10, half, 7.8);
        clay.T(meta, x, sigY + 35, { size: metaSize, w: 700, color: C.mute });
    };
    drawSide(pad, left);
    drawSide(pad + half + 40, right2);
    clay.hline(pad, right, footY - 11, C.line2);
    clay.T(exports.FOOTER_TEXT, (pad + right) / 2, footY + 6, { size: 9.5, w: 700, color: C.footer, align: 'center', spacing: 0.5 });
}
exports.claySignaturesFooter = claySignaturesFooter;
function badgeTone(t) {
    const C = exports.CLAY;
    if (t === 'red')
        return { bg: C.redBg, ln: C.redLine, dt: C.red, tx: C.redD };
    if (t === 'neutral')
        return { bg: C.beige, ln: C.line, dt: C.orange, tx: C.orangeD };
    return { bg: C.greenBg, ln: C.greenLine, dt: C.green, tx: C.greenD };
}
/** Teknik servis / aplikasyon işlem formu (WhatsApp/e-posta ile aynı tasarım). */
async function renderActionForm(kit, input) {
    const { default: JsPDF } = await Promise.resolve().then(() => __importStar(require('jspdf')));
    const doc = new JsPDF({ unit: 'px', format: 'a4', hotfixes: ['px_scaling'] });
    const fonts = setupClayFonts(doc, kit);
    const clay = makeClay(doc, fonts);
    const C = exports.CLAY;
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const PAD = exports.CLAY_PAGE.PAD, TOP = exports.CLAY_PAGE.TOP, RIGHT = PW - PAD, CW = PW - 2 * PAD;
    const headerBottom = await clayHeader(doc, clay, kit, { qrPayload: input.qrPayload, right: RIGHT });
    let y = headerBottom + 12;
    y = clayTitleBand(doc, clay, {
        x: PAD,
        y,
        w: CW,
        right: RIGHT,
        eyebrow: '',
        title: input.title,
        rightLabel: 'Form No',
        rightValue: input.formNo,
        rightTextAlign: 'center',
    });
    // info cards
    y += 14;
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
    // chips
    y += infoH + 12;
    const chips = input.chips.slice(0, 3);
    if (chips.length) {
        const cg = 12, chW = (CW - (chips.length - 1) * cg) / chips.length;
        const preparedChips = chips.map((chip) => ({
            ...chip,
            labelLines: clay.split(chip.label, 800, 8.5, chW - 28),
            valueLines: clay.split(chip.value || '—', 800, 12.5, chW - 28),
        }));
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
    // işlem türüne özel detaylar (3 çipe sığmayan periyodik bakım/test bilgileri)
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
    claySignaturesFooter(doc, clay, { pad: PAD, right: RIGHT, pageH: PH, left: input.leftSign, right2: input.rightSign, contentBottom: y });
    return doc;
}
exports.renderActionForm = renderActionForm;
/** Transfer / sarf dağıtım tutanağı. */
async function renderTransferForm(kit, input) {
    var _a;
    const { default: JsPDF } = await Promise.resolve().then(() => __importStar(require('jspdf')));
    const doc = new JsPDF({ unit: 'px', format: 'a4', hotfixes: ['px_scaling'] });
    const fonts = setupClayFonts(doc, kit);
    const clay = makeClay(doc, fonts);
    const C = exports.CLAY;
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const PAD = 44, TOP = 42, RIGHT = PW - 44, CW = PW - 88;
    const headerBottom = await clayHeader(doc, clay, kit, { qrPayload: input.qrPayload, pad: PAD, top: TOP, right: RIGHT, qrFrame: 99 });
    let y = headerBottom + 12;
    y = clayTitleBand(doc, clay, {
        x: PAD, y, w: CW, right: RIGHT, eyebrow: '', title: input.title,
        titleSize: 28, rightLabel: 'Tarih / Saat', rightValue: input.tarihSaat,
        bandH: 60, rightWidth: 186, rightValueSize: 14,
    });
    // gönderen / teslim alan packets
    y += 16;
    const gap = 14, cardW = (CW - gap) / 2, packetInnerW = cardW - 36;
    const preparePacket = (rows) => rows.map(([label, value, sign]) => ({
        label,
        sign: Boolean(sign),
        lines: sign ? [value || ''] : clay.split(value || '-', 800, 14.5, packetInnerW),
    }));
    const packetHeight = (rows) => 46 + rows.reduce((height, row) => height + (row.sign ? 40 : 36 + Math.max(0, row.lines.length - 1) * 17), 0) + 12;
    const senderRows = preparePacket([
        [input.gonderen.depoLabel || 'Depo', input.gonderen.depo],
        ['Teslim Eden', input.gonderen.teslimEden || '', true],
    ]);
    const receiverSourceRows = [[input.teslimAlan.kurumLabel || 'Kurum', input.teslimAlan.kurum]];
    if (input.teslimAlan.firma)
        receiverSourceRows.push(['Firma', input.teslimAlan.firma]);
    receiverSourceRows.push(['Teslim Alan', input.teslimAlan.teslimAlan || '', true]);
    const receiverRows = preparePacket(receiverSourceRows);
    const infoH = Math.max(packetHeight(senderRows), packetHeight(receiverRows));
    const packet = (x, dotC, titleC, title, rows) => {
        clay.card(x, y, cardW, infoH, 18, C.white, C.line);
        clay.dot(x + 18, y + 18, 8, dotC);
        clay.T(title, x + 34, y + 24, { size: 11, w: 900, color: titleC, upper: true, spacing: 1.8 });
        let py = y + 46;
        rows.forEach((row) => {
            clay.T(row.label, x + 18, py, { size: 9.5, w: 800, color: C.mute, upper: true, spacing: 0.8 });
            if (row.sign) {
                const signatureSize = clay.fitSize(row.lines[0], 700, 13, packetInnerW, 9.5);
                clay.T(row.lines[0], x + 18, py + 20, { size: signatureSize, w: 700, color: C.soft });
                clay.hline(x + 18, x + cardW - 18, py + 27, [230, 220, 203]);
                py += 40;
            }
            else {
                row.lines.forEach((line, index) => clay.T(line, x + 18, py + 20 + index * 17, {
                    size: 14.5, w: 800,
                }));
                py += 36 + Math.max(0, row.lines.length - 1) * 17;
            }
        });
    };
    packet(PAD, C.orange, C.orangeD, 'Gönderen', senderRows);
    packet(PAD + cardW + gap, C.green, C.greenD, 'Teslim Alan', receiverRows);
    // product / part table
    y += infoH + 20;
    y = clay.section(input.tableTitle || 'Ürün Bilgileri', PAD, y, RIGHT);
    const cols = input.variant === 'yedek'
        ? [{ key: 'kod', label: 'Stok Kodu', w: 104, size: 11.5, w2: 700, color: C.soft, nowrap: true },
            { key: 'urun', label: 'Parça', size: 14, w2: 800, color: C.ink },
            { key: 'seri', label: 'Seri No', w: 116, size: 12, w2: 700, color: C.sub, nowrap: true },
            { key: 'adet', label: 'Adet', w: 56, align: 'center', badge: true },
            { key: 'birim', label: 'Birim', w: 84, size: 12, w2: 700, color: C.sub, nowrap: true },
            { key: 'tarih', label: 'İşlem Tarihi', w: 112, size: 11.5, w2: 700, color: C.sub, nowrap: true }]
        : [{ key: 'kod', label: 'Stok Kodu', w: 104, size: 11.5, w2: 700, color: C.soft, nowrap: true },
            { key: 'urun', label: 'Ürün', size: 14, w2: 800, color: C.ink },
            { key: 'lot', label: 'Lot', w: 78, size: 12, w2: 700, color: C.sub, nowrap: true },
            { key: 'miad', label: 'Miad', w: 84, size: 12, w2: 700, color: C.sub, nowrap: true },
            { key: 'adet', label: 'Adet', w: 56, align: 'center', badge: true },
            { key: 'birim', label: 'Birim', w: 90, size: 12, w2: 700, color: C.sub, nowrap: true }];
    y = clay.table(PAD, y, CW, cols, input.rows, { headH: 34, minRowH: 42 });
    // totals
    y += 14;
    const tGap = 14, tW = (CW - tGap) / 2, tH = 48;
    clay.card(PAD, y, tW, tH, 16, C.beige, C.line);
    clay.T('Toplam Kalem', PAD + 20, y + tH / 2 + 1, { size: 11, w: 900, color: C.orangeD, upper: true, spacing: 1.4, baseline: 'middle' });
    clay.T(String(input.toplamKalem), PAD + tW - 20, y + tH / 2 + 1, { size: 24, w: 900, color: C.ink, align: 'right', baseline: 'middle' });
    const g2x = PAD + tW + tGap;
    clay.card(g2x, y, tW, tH, 16, C.gradB, null);
    clay.T('Toplam Adet', g2x + 20, y + tH / 2 + 1, { size: 11, w: 900, color: [253, 243, 226], upper: true, spacing: 1.4, baseline: 'middle' });
    clay.T(String(input.toplamAdet), g2x + tW - 20, y + tH / 2 + 1, { size: 24, w: 900, color: C.white, align: 'right', baseline: 'middle' });
    y += tH;
    const transferDate = ((_a = input.tarihSaat.split('·')[0]) === null || _a === void 0 ? void 0 : _a.trim()) || input.tarihSaat;
    claySignaturesFooter(doc, clay, {
        pad: PAD,
        right: RIGHT,
        pageH: PH,
        left: { label: 'Teslim Eden', name: input.gonderen.teslimEden, date: transferDate },
        right2: { label: 'Teslim Alan', name: input.teslimAlan.teslimAlan, date: transferDate },
        contentBottom: y,
    });
    return doc;
}
exports.renderTransferForm = renderTransferForm;
