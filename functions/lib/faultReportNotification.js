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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onDeviceFaultReportResolved = void 0;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const firebase_functions_1 = require("firebase-functions");
const nodemailer = __importStar(require("nodemailer"));
const jspdf_1 = require("jspdf");
const jspdf_autotable_1 = __importDefault(require("jspdf-autotable"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const QRCode = __importStar(require("qrcode"));
const whatsapp_1 = require("./lib/whatsapp");
const db = admin.firestore();
// --- Turkish -> ASCII transliteration (fonts available at runtime do not cover TR glyphs) ---
const TR_ASCII_MAP = {
    'ç': 'c', 'Ç': 'C',
    'ğ': 'g', 'Ğ': 'G',
    'ı': 'i', 'İ': 'I',
    'ö': 'o', 'Ö': 'O',
    'ş': 's', 'Ş': 'S',
    'ü': 'u', 'Ü': 'U',
};
function tr(s) {
    if (s === null || s === undefined)
        return '';
    return String(s).replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => { var _a; return (_a = TR_ASCII_MAP[ch]) !== null && _a !== void 0 ? _a : ch; });
}
function trRows(rows) {
    return rows.map((row) => row.map((cell) => tr(cell)));
}
// --- Asset cache ---
let _fontBase64 = null;
let _headerLogo = null;
let _sysLogo = null;
async function loadAssetBase64(url) {
    try {
        const response = await (0, node_fetch_1.default)(url);
        if (!response.ok)
            return null;
        const buffer = await response.buffer();
        return buffer.toString('base64');
    }
    catch (e) {
        firebase_functions_1.logger.warn(`[faultReport] Could not load asset from ${url}:`, e);
        return null;
    }
}
async function loadTurkishFont() {
    if (_fontBase64)
        return _fontBase64;
    _fontBase64 = await loadAssetBase64('https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRA.ttf');
    return _fontBase64;
}
async function loadHeaderLogo() {
    if (_headerLogo)
        return _headerLogo;
    _headerLogo = await loadAssetBase64('https://qorengine.com/invlogo.png');
    if (!_headerLogo) {
        _headerLogo = await loadAssetBase64('https://qorengine.com/invitrolab_LOGO__-_Kopya__1_-removebg.png');
    }
    return _headerLogo;
}
async function loadSysLogo() {
    if (_sysLogo)
        return _sysLogo;
    _sysLogo = await loadAssetBase64('https://qorengine.com/newlogoblk.png');
    return _sysLogo;
}
function setupTurkishFont(doc, fontBase64) {
    try {
        doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64);
        doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
        doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'bold');
        return true;
    }
    catch (e) {
        firebase_functions_1.logger.warn('[faultReport] Could not setup Turkish font:', e);
        return false;
    }
}
async function generateQRCodeDataUrl(text) {
    try {
        return await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 0, scale: 4 });
    }
    catch (e) {
        firebase_functions_1.logger.warn('[faultReport] Could not generate QR code:', e);
        return null;
    }
}
// --- Nodemailer transporter ---
function getTransporter() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpHost || !smtpUser || !smtpPass)
        return null;
    return nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
    });
}
// --- Labels ---
const STATUS_LABELS = {
    atama_bekliyor: 'Atama Bekliyor',
    mudahale_bekliyor: 'Müdahale Bekliyor',
    mudahale_ediliyor: 'Müdahale Ediliyor',
    cozuldu: 'Çözüldü',
    open: 'Açık',
};
function formatTs(ts) {
    if (!ts)
        return '-';
    let d = null;
    if (typeof (ts === null || ts === void 0 ? void 0 : ts.toDate) === 'function')
        d = ts.toDate();
    else if (typeof (ts === null || ts === void 0 ? void 0 : ts._seconds) === 'number')
        d = new Date(ts._seconds * 1000);
    else if (ts instanceof Date)
        d = ts;
    if (!d)
        return '-';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}
function buildPersonnelInitials(name) {
    const cleaned = String(name || '')
        .replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıİ]/g, 'i')
        .replace(/[öÖ]/g, 'o').replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u')
        .trim().split(/\s+/).filter(Boolean);
    if (cleaned.length === 0)
        return 'XX';
    return cleaned.map((p) => p.charAt(0)).join('').toUpperCase();
}
async function computeFaultFormNo(reportData, reportId) {
    try {
        const openedByUid = reportData.openedByUid;
        const faultType = reportData.faultType;
        if (!openedByUid)
            return reportId.substring(0, 8);
        const typeChar = faultType === 'aplikasyon' ? 'A' : 'T';
        const snap = await db.collection('deviceFaultReports')
            .where('openedByUid', '==', openedByUid)
            .where('faultType', '==', faultType)
            .get();
        const sorted = snap.docs.slice().sort((a, b) => {
            var _a, _b, _c, _d;
            const ta = ((_b = (_a = a.data().openedAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) || 0;
            const tb = ((_d = (_c = b.data().openedAt) === null || _c === void 0 ? void 0 : _c.toMillis) === null || _d === void 0 ? void 0 : _d.call(_c)) || 0;
            return ta - tb;
        });
        const idx = sorted.findIndex((d) => d.id === reportId);
        const ordinal = idx >= 0 ? idx + 1 : sorted.length + 1;
        const initials = buildPersonnelInitials(reportData.openedByName);
        return `${initials}-${typeChar}${String(ordinal).padStart(4, '0')}`;
    }
    catch (e) {
        firebase_functions_1.logger.warn('[faultReport] computeFormNo failed:', e);
        return reportId.substring(0, 8);
    }
}
async function resolveLabDisplayName(hospitalId, hospitalName) {
    if (!hospitalId)
        return hospitalName;
    try {
        const pools = await db.collection('labPools').where('active', '==', true).get();
        const match = pools.docs.find((d) => {
            const p = d.data();
            return Array.isArray(p.memberIds) && p.memberIds.includes(hospitalId);
        });
        if (match) {
            const p = match.data();
            if (p.mainLabId && p.mainLabId !== hospitalId) {
                const mainSnap = await db.collection('hospitals').doc(p.mainLabId).get();
                if (mainSnap.exists) {
                    const mainName = mainSnap.data().name;
                    return mainName ? `${mainName} - ${hospitalName}` : hospitalName;
                }
            }
        }
    }
    catch (e) {
        firebase_functions_1.logger.warn('[faultReport] resolveLabDisplayName failed:', e);
    }
    return hospitalName;
}
// --- PDF Generation (mirrors client src/.../ariza-yonetimi/[id]/page.tsx generatePdf) ---
async function generateFaultReportPDF(args) {
    const { reportData, reportId, formNo, labDisplayName, partChanges, hucreDegisimleri, history, deviceImageBase64 } = args;
    const pdfDoc = new jspdf_1.jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = pdfDoc.internal.pageSize.getWidth();
    const pageH = pdfDoc.internal.pageSize.getHeight();
    const padX = 40;
    const [fontBase64, headerLogo, sysLogo] = await Promise.all([
        loadTurkishFont(), loadHeaderLogo(), loadSysLogo(),
    ]);
    const useTurkish = fontBase64 ? setupTurkishFont(pdfDoc, fontBase64) : false;
    const FONT = useTurkish ? 'NotoSans' : 'helvetica';
    const ORANGE = { r: 199, g: 137, b: 65 };
    pdfDoc.setFont(FONT);
    pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    pdfDoc.setLineWidth(2);
    pdfDoc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);
    // --- HEADER ---
    const headerY = 30;
    pdfDoc.setTextColor(0, 0, 0);
    pdfDoc.setFontSize(14);
    pdfDoc.setFont(FONT, 'bold');
    pdfDoc.text(tr('Arıza Raporu'), padX, headerY + 20);
    if (headerLogo) {
        try {
            const logoWidth = 132;
            const logoHeight = 40;
            const logoX = (pageW / 2) - (logoWidth / 2);
            pdfDoc.addImage(`data:image/png;base64,${headerLogo}`, 'PNG', logoX, headerY + 5, logoWidth, logoHeight, undefined, 'FAST');
        }
        catch (e) {
            firebase_functions_1.logger.warn('[faultReport] Header logo failed', e);
        }
    }
    const recordUrl = `https://qorengine.com/ariza-yonetimi/${reportId}`;
    const qrDataUrl = await generateQRCodeDataUrl(recordUrl);
    const qrSize = 60;
    const qrX = pageW - padX - qrSize - 10;
    const qrY = headerY;
    if (qrDataUrl) {
        pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        pdfDoc.setFillColor(255, 255, 255);
        pdfDoc.setLineWidth(2);
        pdfDoc.roundedRect(qrX - 5, qrY - 5, qrSize + 10, qrSize + 10, 5, 5, 'FD');
        try {
            pdfDoc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'FAST');
        }
        catch (e) {
            firebase_functions_1.logger.warn('[faultReport] QR addImage failed', e);
        }
    }
    if (sysLogo) {
        try {
            const sysLogoSize = 28;
            const sysLogoX = qrX + (qrSize / 2) - (sysLogoSize / 2);
            pdfDoc.addImage(`data:image/png;base64,${sysLogo}`, 'PNG', sysLogoX, qrY + qrSize + 5, sysLogoSize, sysLogoSize, undefined, 'FAST');
        }
        catch (e) {
            firebase_functions_1.logger.warn('[faultReport] Sys logo failed', e);
        }
    }
    // --- FORM INFO ---
    pdfDoc.setFontSize(10);
    pdfDoc.setFont(FONT, 'normal');
    let currentY = 100;
    const statusLabel = STATUS_LABELS[reportData.status] || reportData.status || '-';
    const faultTypeLabel = reportData.faultType === 'teknik_servis'
        ? 'Teknik Servis'
        : reportData.faultType === 'aplikasyon'
            ? 'Aplikasyon'
            : (reportData.faultType || '-');
    const supportNames = Array.isArray(reportData.supportPersonnelNames) && reportData.supportPersonnelNames.length
        ? reportData.supportPersonnelNames
        : (reportData.supportPersonnelName ? [reportData.supportPersonnelName] : []);
    const openedByStr = `${reportData.openedByName || '-'}${supportNames.length ? ` (Eşlik Eden: ${supportNames.join(', ')})` : ''}`;
    const info = [
        ['Arıza No:', formNo],
        ['Laboratuvar:', labDisplayName || reportData.labName || '-'],
        ['Cihaz:', `${reportData.model || '-'} (SN: ${reportData.serial || '-'})`],
        ['Arıza Tipi:', faultTypeLabel],
        ['Durum:', statusLabel],
        ['Açan:', openedByStr],
        ['Başlangıç:', formatTs(reportData.openedAt)],
        ['Bitiş:', formatTs(reportData.closedAt)],
    ];
    (0, jspdf_autotable_1.default)(pdfDoc, {
        body: trRows(info),
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT, fontSize: 10, cellPadding: { top: 4, bottom: 4 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
    });
    currentY = pdfDoc.lastAutoTable.finalY + 15;
    // --- ACIKLAMA ---
    if (reportData.description && String(reportData.description).trim()) {
        pdfDoc.setFont(FONT, 'bold');
        pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        pdfDoc.line(padX, currentY, pageW - padX, currentY);
        pdfDoc.text(tr('Açıklama'), padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(pdfDoc, {
            body: [[tr(reportData.description)]],
            startY: currentY,
            theme: 'grid',
            styles: { font: FONT, fontSize: 10, cellPadding: { top: 6, bottom: 6 } },
            margin: { left: padX, right: padX },
        });
        currentY = pdfDoc.lastAutoTable.finalY + 15;
    }
    // --- COZUM BILGILERI (status = cozuldu) ---
    if (reportData.status === 'cozuldu') {
        pdfDoc.setFont(FONT, 'bold');
        pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        pdfDoc.line(padX, currentY, pageW - padX, currentY);
        pdfDoc.text(tr('Çözüm Bilgileri'), padX, currentY + 12);
        currentY += 18;
        const cozumRows = [];
        if (reportData.closedByName)
            cozumRows.push(['Kapatan:', reportData.closedByName]);
        if (reportData.closedAt)
            cozumRows.push(['Kapanış Tarihi:', formatTs(reportData.closedAt)]);
        const cozumSuresiMs = reportData.cozumSuresi || reportData.toplamCozumSuresi;
        if (typeof cozumSuresiMs === 'number' && cozumSuresiMs > 0) {
            const dk = Math.round(cozumSuresiMs / 60000);
            cozumRows.push(['Çözüm Süresi:', `${dk} dk`]);
        }
        if (reportData.closeDescription)
            cozumRows.push(['Çözüm Açıklaması:', reportData.closeDescription]);
        if (cozumRows.length > 0) {
            (0, jspdf_autotable_1.default)(pdfDoc, {
                body: trRows(cozumRows),
                startY: currentY,
                theme: 'plain',
                styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
                columnStyles: { 0: { fontStyle: 'bold', cellWidth: 120 } },
                margin: { left: padX, right: padX },
            });
            currentY = pdfDoc.lastAutoTable.finalY + 15;
        }
    }
    // --- DEGISEN PARCALAR ---
    if (partChanges.length > 0) {
        pdfDoc.setFont(FONT, 'bold');
        pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        pdfDoc.line(padX, currentY, pageW - padX, currentY);
        pdfDoc.text(tr('Değişen Parçalar'), padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(pdfDoc, {
            head: [[tr('Parça'), tr('Kod'), tr('Seri No'), tr('Adet')]],
            body: trRows(partChanges.map((part) => {
                const serial = (part.serialNumber || '').trim();
                const displayPartName = serial ? `${part.stokAdi || '-'} (SN: ${serial})` : (part.stokAdi || '-');
                return [
                    displayPartName,
                    part.stokKodu || '-',
                    serial || '-',
                    String(part.quantity || 1),
                ];
            })),
            startY: currentY,
            theme: 'grid',
            styles: { font: FONT, fontSize: 10 },
            headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
            margin: { left: padX, right: padX },
        });
        currentY = pdfDoc.lastAutoTable.finalY + 15;
    }
    // --- HUCRE DEGISIMLERI ---
    if (hucreDegisimleri.length > 0) {
        pdfDoc.setFont(FONT, 'bold');
        pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        pdfDoc.line(padX, currentY, pageW - padX, currentY);
        pdfDoc.text(tr('Hücre Değişimleri'), padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(pdfDoc, {
            head: [[tr('Parça'), tr('Takılan Hücre'), tr('Çıkan Hücre'), tr('Açıklama')]],
            body: trRows(hucreDegisimleri.map((h) => [
                h.stokAdi || '-',
                h.hucreNumarasi || '-',
                h.removedHucreNumarasi || '-',
                h.description || '-',
            ])),
            startY: currentY,
            theme: 'grid',
            styles: { font: FONT, fontSize: 10 },
            headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
            margin: { left: padX, right: padX },
        });
        currentY = pdfDoc.lastAutoTable.finalY + 15;
    }
    // --- CIHAZ DURUMU ---
    pdfDoc.setFont(FONT, 'bold');
    pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    pdfDoc.line(padX, currentY, pageW - padX, currentY);
    pdfDoc.text(tr('Cihaz Durumu'), padX, currentY + 12);
    currentY += 18;
    (0, jspdf_autotable_1.default)(pdfDoc, {
        body: trRows([['Durum:', statusLabel]]),
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
        margin: { left: padX, right: padX },
    });
    currentY = pdfDoc.lastAutoTable.finalY + 15;
    // --- ARIZA GECMISI ---
    if (history.length > 0) {
        pdfDoc.setFont(FONT, 'bold');
        pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        pdfDoc.line(padX, currentY, pageW - padX, currentY);
        pdfDoc.text(tr('Arıza Geçmişi'), padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(pdfDoc, {
            head: [[tr('Tarih'), tr('Tür'), tr('Kullanıcı'), tr('Açıklama')]],
            body: trRows(history.map((ev) => [
                formatTs(ev.timestamp),
                String(ev.type || '-').replace('_', ' '),
                ev.actorName || '-',
                ev.description || '-',
            ])),
            startY: currentY,
            theme: 'grid',
            styles: { font: FONT, fontSize: 10 },
            headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
            margin: { left: padX, right: padX },
        });
        currentY = pdfDoc.lastAutoTable.finalY + 15;
    }
    // --- DEVICE IMAGE ---
    if (deviceImageBase64) {
        try {
            if (currentY + 120 > pageH - padX) {
                pdfDoc.addPage();
                currentY = padX;
            }
            pdfDoc.addImage(`data:image/png;base64,${deviceImageBase64}`, 'PNG', padX, currentY, 80, 80, undefined, 'FAST');
        }
        catch (e) {
            firebase_functions_1.logger.warn('[faultReport] Device image addImage failed', e);
        }
    }
    const arrayBuffer = pdfDoc.output('arraybuffer');
    return Buffer.from(arrayBuffer);
}
// --- Trigger ---
async function handleFaultResolved(reportId, after) {
    var _a;
    const logEntry = {
        reportId,
        formNo: null,
        hospitalId: after.hospitalId || after.labId || null,
        labName: null,
        deviceModel: after.model || null,
        deviceSerial: after.serial || null,
        faultType: after.faultType || null,
        closedByUid: after.closedByUid || null,
        closedByName: after.closedByName || null,
        whatsappSent: false,
        whatsappError: null,
        emailSentTo: null,
        emailError: null,
        pdfBytes: 0,
        steps: [],
        status: 'processing',
        error: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
        firebase_functions_1.logger.info(`[faultReport] Processing resolved fault: ${reportId}`);
        const hospitalId = after.hospitalId || after.labId;
        const reportRef = db.collection('deviceFaultReports').doc(reportId);
        const [partsSnap, hucreSnap, historySnap, hospitalDoc, deviceDoc, formNo] = await Promise.all([
            reportRef.collection('partChanges').get(),
            reportRef.collection('hucreDegisimleri').get(),
            reportRef.collection('history').orderBy('timestamp').get(),
            hospitalId ? db.collection('hospitals').doc(hospitalId).get() : Promise.resolve(null),
            after.deviceId ? db.collection('devices').doc(after.deviceId).get() : Promise.resolve(null),
            computeFaultFormNo(after, reportId),
        ]);
        const partChanges = partsSnap.docs.map((d) => d.data());
        const hucreDegisimleri = hucreSnap.docs.map((d) => d.data());
        const history = historySnap.docs.map((d) => d.data());
        const hospitalData = hospitalDoc && hospitalDoc.exists ? hospitalDoc.data() : null;
        const labDisplayName = await resolveLabDisplayName(hospitalId, (hospitalData === null || hospitalData === void 0 ? void 0 : hospitalData.name) || after.labName || '');
        logEntry.formNo = formNo;
        logEntry.labName = labDisplayName;
        // Try fetching device image as base64 (best-effort)
        let deviceImageBase64 = null;
        const imageUrl = deviceDoc && deviceDoc.exists ? (_a = deviceDoc.data()) === null || _a === void 0 ? void 0 : _a.imageUrl : null;
        if (imageUrl && typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl)) {
            deviceImageBase64 = await loadAssetBase64(imageUrl);
        }
        logEntry.steps.push(`Veri toplama OK (parts=${partChanges.length}, hucre=${hucreDegisimleri.length}, history=${history.length})`);
        firebase_functions_1.logger.info('[faultReport] Generating PDF...');
        const pdfBuffer = await generateFaultReportPDF({
            reportData: after, reportId, formNo, labDisplayName,
            partChanges, hucreDegisimleri, history, deviceImageBase64,
        });
        logEntry.pdfBytes = pdfBuffer.length;
        logEntry.steps.push(`PDF olusturuldu: ${pdfBuffer.length} byte`);
        firebase_functions_1.logger.info(`[faultReport] PDF generated: ${pdfBuffer.length} bytes`);
        // --- WhatsApp ---
        const waConfig = functions.config().whatsapp;
        if (waConfig && waConfig.instance_id && waConfig.token && waConfig.group_id) {
            try {
                const bucket = admin.storage().bucket();
                const storagePath = `arizaRaporlariPDFs/${reportId}_${Date.now()}.pdf`;
                const file = bucket.file(storagePath);
                await file.save(pdfBuffer, {
                    contentType: 'application/pdf',
                    metadata: { cacheControl: 'public, max-age=3600' },
                });
                await file.makePublic();
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
                firebase_functions_1.logger.info(`[faultReport] PDF uploaded: ${publicUrl}`);
                const cihazAdi = after.model || 'Bilinmeyen Cihaz';
                const faultTypeLabel = after.faultType === 'teknik_servis' ? 'Teknik Servis' : after.faultType === 'aplikasyon' ? 'Aplikasyon' : '-';
                const personnelName = after.closedByName || 'Bilinmeyen Kullanıcı';
                const faultDescription = (after.description || after.faultDescription || '').toString().trim() || '-';
                const caption = `*Arıza Çözüldü*\n\n` +
                    `- *Kurum:* ${labDisplayName}\n` +
                    `- *Cihaz:* ${cihazAdi}\n` +
                    `- *Arıza No:* ${formNo}\n` +
                    `- *Tip:* ${faultTypeLabel}\n` +
                    `- *Arıza İçeriği:* ${faultDescription}\n` +
                    `- *Çözen:* ${personnelName}\n` +
                    `- *Cihaz Durumu:* Çalışıyor\n\n` +
                    `QORE Sistemi üzerinden detaylara ulaşabilirsiniz.`;
                const waFileName = `Ariza_Raporu_${reportId.substring(0, 8)}.pdf`;
                const waResult = await (0, whatsapp_1.sendWhatsAppDocument)(publicUrl, waFileName, caption, waConfig.group_id, waConfig.instance_id, waConfig.token);
                firebase_functions_1.logger.info(`[faultReport] WhatsApp result: ${JSON.stringify(waResult)}`);
                if (waResult.success) {
                    logEntry.whatsappSent = true;
                    logEntry.steps.push(`WhatsApp gonderildi (msgId: ${waResult.messageId})`);
                }
                else {
                    logEntry.whatsappError = waResult.error || 'Unknown error';
                    logEntry.steps.push(`WhatsApp BASARISIZ: ${waResult.error}`);
                }
                // --- Also send to parts group if fault contains part changes ---
                const partsGroupId = waConfig.parts_group_id || '905362835871-1624522639@g.us';
                if (partChanges.length > 0 && partsGroupId) {
                    firebase_functions_1.logger.info(`[faultReport] Fault has part changes; also sending to parts group: ${partsGroupId}`);
                    try {
                        const partsResult = await (0, whatsapp_1.sendWhatsAppDocument)(publicUrl, waFileName, caption, partsGroupId, waConfig.instance_id, waConfig.token);
                        firebase_functions_1.logger.info(`[faultReport] Parts group result: ${JSON.stringify(partsResult)}`);
                        if (partsResult.success) {
                            logEntry.steps.push(`WhatsApp (parca grubu) gonderildi (msgId: ${partsResult.messageId})`);
                        }
                        else {
                            logEntry.steps.push(`WhatsApp (parca grubu) BASARISIZ: ${partsResult.error}`);
                        }
                    }
                    catch (partsErr) {
                        firebase_functions_1.logger.error('[faultReport] Parts group send error', partsErr);
                        logEntry.steps.push(`WhatsApp (parca grubu) HATA: ${(partsErr === null || partsErr === void 0 ? void 0 : partsErr.message) || partsErr}`);
                    }
                }
            }
            catch (waErr) {
                firebase_functions_1.logger.error('[faultReport] WhatsApp fatal error', waErr);
                logEntry.whatsappError = (waErr === null || waErr === void 0 ? void 0 : waErr.message) || String(waErr);
                logEntry.steps.push(`WhatsApp HATA: ${(waErr === null || waErr === void 0 ? void 0 : waErr.message) || waErr}`);
            }
        }
        else {
            firebase_functions_1.logger.warn('[faultReport] WhatsApp config incomplete, skipping');
            logEntry.steps.push('WhatsApp ATLANDI (config eksik)');
        }
        // --- Email (only if hospital has sorumluEmail and SMTP is configured) ---
        const sorumluEmail = ((hospitalData === null || hospitalData === void 0 ? void 0 : hospitalData.sorumluEmail) || '').toString().trim();
        const transporter = sorumluEmail ? getTransporter() : null;
        if (sorumluEmail && transporter) {
            try {
                const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
                const cihazAdi = after.model || 'Cihaz';
                const subject = `Ariza Raporu - ${labDisplayName} - ${cihazAdi}`;
                const personnelName = after.closedByName || 'Personel';
                const body = `Sorumlusu oldugunuz ${labDisplayName} laboratuvarindaki ${cihazAdi} cihazina ait ariza ${personnelName} tarafindan giderilmistir. Ilgili rapor ektedir.`;
                await transporter.sendMail({
                    from: senderEmail,
                    to: sorumluEmail,
                    subject,
                    text: body,
                    attachments: [{
                            filename: `Ariza_Raporu_${reportId.substring(0, 8)}.pdf`,
                            content: pdfBuffer,
                            contentType: 'application/pdf',
                        }],
                });
                logEntry.emailSentTo = sorumluEmail;
                logEntry.steps.push(`Email gonderildi: ${sorumluEmail}`);
                firebase_functions_1.logger.info(`[faultReport] Email sent to ${sorumluEmail}`);
            }
            catch (mailErr) {
                logEntry.emailError = (mailErr === null || mailErr === void 0 ? void 0 : mailErr.message) || String(mailErr);
                logEntry.steps.push(`Email BASARISIZ: ${(mailErr === null || mailErr === void 0 ? void 0 : mailErr.message) || mailErr}`);
                firebase_functions_1.logger.error('[faultReport] Email send failed', mailErr);
            }
        }
        else {
            logEntry.steps.push('Email ATLANDI (sorumluEmail veya SMTP yok)');
            firebase_functions_1.logger.info('[faultReport] Email skipped (no sorumluEmail or SMTP)');
        }
        logEntry.status = logEntry.whatsappSent || logEntry.emailSentTo ? 'sent' : 'skipped';
    }
    catch (e) {
        firebase_functions_1.logger.error(`[faultReport] Unexpected error for ${reportId}`, e);
        logEntry.status = 'error';
        logEntry.error = (e === null || e === void 0 ? void 0 : e.message) || String(e);
        logEntry.steps.push(`HATA: ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
    }
    try {
        await db.collection('faultReportNotificationLogs').add(logEntry);
    }
    catch (logErr) {
        firebase_functions_1.logger.error('[faultReport] Failed to write log', logErr);
    }
}
exports.onDeviceFaultReportResolved = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .firestore.document('deviceFaultReports/{reportId}')
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after)
        return;
    // Fire only on transition into 'cozuldu'
    if (before.status === 'cozuldu' || after.status !== 'cozuldu')
        return;
    await handleFaultResolved(context.params.reportId, after);
});
//# sourceMappingURL=faultReportNotification.js.map