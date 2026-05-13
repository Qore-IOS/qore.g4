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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onAplikasyonFormCreated = exports.onTeknikServisFormCreated = void 0;
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
// --- Turkish -> ASCII transliteration for PDF (font does not support TR glyphs) ---
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
// --- Assets cache ---
let turkishFontBase64 = null;
let headerLogoBase64 = null;
let systemLogoBase64 = null;
async function loadAssetBase64(url) {
    try {
        const response = await (0, node_fetch_1.default)(url);
        if (!response.ok)
            return null;
        const buffer = await response.buffer();
        return buffer.toString('base64');
    }
    catch (e) {
        firebase_functions_1.logger.warn(`[actionFormEmail] Could not load asset from ${url}:`, e);
        return null;
    }
}
async function loadTurkishFont() {
    if (turkishFontBase64)
        return turkishFontBase64;
    turkishFontBase64 = await loadAssetBase64('https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRA.ttf');
    return turkishFontBase64;
}
async function loadHeaderLogo() {
    if (headerLogoBase64)
        return headerLogoBase64;
    // Fallback chain for logos
    headerLogoBase64 = await loadAssetBase64('https://qorengine.com/invlogo.png');
    if (!headerLogoBase64) {
        headerLogoBase64 = await loadAssetBase64('https://qorengine.com/invitrolab_LOGO__-_Kopya__1_-removebg.png');
    }
    return headerLogoBase64;
}
async function loadSystemLogo() {
    if (systemLogoBase64)
        return systemLogoBase64;
    systemLogoBase64 = await loadAssetBase64('https://qorengine.com/newlogoblk.png');
    return systemLogoBase64;
}
function setupTurkishFont(doc, fontBase64) {
    try {
        doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64);
        doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
        doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'bold');
        return true;
    }
    catch (e) {
        firebase_functions_1.logger.warn('[actionFormEmail] Could not setup Turkish font:', e);
        return false;
    }
}
async function generateQRCodeDataUrl(text) {
    try {
        return await QRCode.toDataURL(text, { margin: 1, width: 200 });
    }
    catch (e) {
        firebase_functions_1.logger.warn('[actionFormEmail] Could not generate QR code:', e);
        return null;
    }
}
// --- Labels ---
const TEKNIK_ISLEM_TIPI_LABELS = {
    '': '-',
    cihaz: 'Cihaz',
    ups: 'UPS',
    su_sistemi: 'Su Sistemi',
};
const TEKNIK_ISLEM_TURU_LABELS = {
    '': '-',
    kontrol: 'Kontrol',
    rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
    periyodik_bakim: 'Periyodik Bakım',
    cihaz_kurulumu: 'Cihaz Kurulumu',
    ariza: 'Arıza',
    sw_update: 'SW Update',
    alis: 'ALIS',
    roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
};
const APLIKASYON_ISLEM_TURU_LABELS = {
    '': '-',
    rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
    periyodik_bakim: 'Periyodik Bakım',
    ariza: 'Arıza',
    alis: 'ALIS',
    roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
};
const TEKNIK_OPERATION_LABELS = {
    genel_temizlik_yaglama: 'Genel Temizlik & Yağlama',
    temel_fonksiyon_testleri: 'Temel Fonksiyon Testleri',
    mekanik_ayarlar_kontrol: 'Mekanik Ayarlar & Kontrol',
    optik_ayarlar_kontrol: 'Optik Ayarlar & Kontrol',
    pipetleme_transfer_ayarlari: 'Pipetleme / Transfer Ayarları & Kontrol',
};
const APLIKASYON_OPERATION_LABELS = {
    aplikasyon_kontrol: 'Aplikasyon Kontrol',
    kalibrasyon_kontrol: 'Kalibrasyon Kontrol',
    qc_materyal_kontrol: 'QC Materyal Kontrol',
    ornek_sonucu_karsilastirma: 'Örnek Sonucu Karşılaştırma',
    reaktif_yenileme: 'Reaktif Yenileme',
    kalibrator_yenileme: 'Kalibratör Yenileme',
    qc_yenileme: 'QC Yenileme',
    cv_calismasi: 'CV Çalışması',
    diger: 'Diğer',
};
const CIHAZ_DURUMU_LABELS = {
    '': '-',
    calisiyor: 'Çalışıyor',
    arizali: 'Arızalı',
    denemede: 'Denemede',
    diger: 'Diğer',
};
// --- Nodemailer transporter ---
function getTransporter() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpHost || !smtpUser || !smtpPass) {
        firebase_functions_1.logger.warn('[actionFormEmail] SMTP config missing. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in functions/.env');
        return null;
    }
    return nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });
}
// --- PDF Generation (matching client-side template) ---
async function generateActionFormPDF(data, formType, formId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const doc = new jspdf_1.jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const padX = 40;
    // --- PREFETCH ASSETS ---
    const [fontBase64, headerLogo, sysLogo] = await Promise.all([
        loadTurkishFont(),
        loadHeaderLogo(),
        loadSystemLogo()
    ]);
    const useTurkish = fontBase64 ? setupTurkishFont(doc, fontBase64) : false;
    const FONT = useTurkish ? 'NotoSans' : 'helvetica';
    const ORANGE = { r: 199, g: 137, b: 65 };
    doc.setFont(FONT);
    // --- Orange page border ---
    doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    doc.setLineWidth(1.5);
    doc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);
    // --- HEADER SECTION ---
    const headerY = 50;
    // Left: Title
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont(FONT, 'bold');
    const title = formType === 'teknik_servis' ? 'Teknik Servis Formu' : 'Aplikasyon Formu';
    doc.text(tr(title), padX, headerY);
    // Center: Company Logo
    if (headerLogo) {
        try {
            doc.addImage(`data:image/png;base64,${headerLogo}`, 'PNG', pageW / 2 - 60, headerY - 25, 120, 45, undefined, 'FAST');
        }
        catch (e) {
            firebase_functions_1.logger.warn('Header logo addImage failed', e);
        }
    }
    // Right: QR Code
    const detailUrl = `https://qorengine.com/forms/${formType === 'teknik_servis' ? 'technical' : 'application'}/${formId}`;
    const qrBase64 = await generateQRCodeDataUrl(detailUrl);
    if (qrBase64) {
        try {
            doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
            doc.rect(pageW - padX - 70, headerY - 25, 70, 70);
            doc.addImage(qrBase64, 'PNG', pageW - padX - 68, headerY - 23, 66, 66, undefined, 'FAST');
        }
        catch (e) {
            firebase_functions_1.logger.warn('QR code addImage failed', e);
        }
    }
    // System Logo below QR
    if (sysLogo) {
        try {
            doc.addImage(`data:image/png;base64,${sysLogo}`, 'PNG', pageW - padX - 55, headerY + 48, 40, 30, undefined, 'FAST');
        }
        catch (e) {
            firebase_functions_1.logger.warn('System logo addImage failed', e);
        }
    }
    // --- FORM INFO SECTION ---
    doc.setFontSize(10);
    doc.setFont(FONT, 'normal');
    let currentY = 100;
    // Build personnel string with accompanying personnel
    let personnelStr = data.createdByName || '-';
    if (data.eslikEdenPersonel && data.eslikEdenPersonel.length > 0) {
        const eslikNames = data.eslikEdenPersonel.map((p) => p.name).join(', ');
        personnelStr += ` (Eşlik Eden: ${eslikNames})`;
    }
    // Use baslangicTarihi if available, otherwise createdAt
    let dateStr;
    if (data.baslangicTarihi && data.baslangicSaati) {
        const parts = data.baslangicTarihi.split('-');
        dateStr = `${parts[2]}.${parts[1]}.${parts[0]} ${data.baslangicSaati}`;
    }
    else {
        dateStr = ((_a = data.createdAt) === null || _a === void 0 ? void 0 : _a.toDate)
            ? formatDate(data.createdAt.toDate())
            : (((_b = data.createdAt) === null || _b === void 0 ? void 0 : _b._seconds) ? formatDate(new Date(data.createdAt._seconds * 1000)) : '-');
    }
    const info = [
        ['Form No:', data.formNo || formId],
        ['Laboratuvar:', data.labName || '-'],
        ['Cihaz:', `${data.cihazAdi || '-'} (SN: ${data.seriNumarasi || '-'})`],
        ['İşlemi Yapan:', personnelStr],
        ['Başlangıç:', data.baslangicTarihi ? `${data.baslangicTarihi.split('-').reverse().join('.')} ${data.baslangicSaati || ''}` : '-'],
        ['Bitiş:', data.bitisTarihi ? `${data.bitisTarihi.split('-').reverse().join('.')} ${data.bitisSaati || ''}` : dateStr],
    ];
    (0, jspdf_autotable_1.default)(doc, {
        body: trRows(info),
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT, fontSize: 10, cellPadding: { top: 4, bottom: 4 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
    });
    currentY = doc.lastAutoTable.finalY + 15;
    // --- ACIKLAMA SECTION ---
    if ((_c = data.aciklama) === null || _c === void 0 ? void 0 : _c.trim()) {
        doc.setFont(FONT, 'bold');
        doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        doc.line(padX, currentY, pageW - padX, currentY);
        doc.text(tr('Açıklama'), padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(doc, {
            body: [[tr(data.aciklama)]],
            startY: currentY,
            theme: 'grid',
            styles: { font: FONT, fontSize: 10, cellPadding: { top: 6, bottom: 6 } },
            margin: { left: padX, right: padX },
        });
        currentY = doc.lastAutoTable.finalY + 15;
    }
    // --- ISLEM TURUNE OZEL DETAYLAR ---
    const hasPeriyodikDetay = data.islemTuru === 'periyodik_bakim' && ((_e = (_d = data.selectedMaintenanceTasks) === null || _d === void 0 ? void 0 : _d.length) !== null && _e !== void 0 ? _e : 0) > 0;
    const hasArizaDetay = data.islemTuru === 'ariza' && (Boolean(data.selectedFaultName) || ((_g = (_f = data.selectedTests) === null || _f === void 0 ? void 0 : _f.length) !== null && _g !== void 0 ? _g : 0) > 0);
    if (hasPeriyodikDetay || hasArizaDetay) {
        doc.setFont(FONT, 'bold');
        doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        doc.line(padX, currentY, pageW - padX, currentY);
        doc.text(tr('İşlem Türüne Özel Detaylar'), padX, currentY + 12);
        currentY += 18;
        const detailRows = [];
        if (hasPeriyodikDetay) {
            detailRows.push([
                'Periyodik Bakım İşleri',
                data.selectedMaintenanceTasks.map((task) => task.taskName).join(', '),
            ]);
        }
        if (hasArizaDetay) {
            detailRows.push([
                'Tespit Edilen Arıza',
                data.selectedFaultName || '-',
            ]);
            if (((_j = (_h = data.selectedTests) === null || _h === void 0 ? void 0 : _h.length) !== null && _j !== void 0 ? _j : 0) > 0) {
                detailRows.push([
                    'Arıza ile İlişkili Testler',
                    data.selectedTests.join(', '),
                ]);
            }
        }
        (0, jspdf_autotable_1.default)(doc, {
            body: trRows(detailRows),
            startY: currentY,
            theme: 'grid',
            styles: { font: FONT, fontSize: 10, cellPadding: { top: 5, bottom: 5 } },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 160 } },
            margin: { left: padX, right: padX },
        });
        currentY = doc.lastAutoTable.finalY + 15;
    }
    // --- ISLEM TIPI & TURU SECTION ---
    doc.setFont(FONT, 'bold');
    doc.setFontSize(10);
    doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    doc.line(padX, currentY, pageW - padX, currentY);
    doc.text(tr('İşlem Tipi ve Türü'), padX, currentY + 12);
    currentY += 18;
    doc.setFont(FONT, 'normal');
    const islemRows = [];
    if (formType === 'teknik_servis' && data.islemTipi) {
        islemRows.push(['İşlem Tipi:', TEKNIK_ISLEM_TIPI_LABELS[data.islemTipi] || data.islemTipi]);
    }
    const turuLabels = formType === 'teknik_servis' ? TEKNIK_ISLEM_TURU_LABELS : APLIKASYON_ISLEM_TURU_LABELS;
    islemRows.push(['İşlem Türü:', turuLabels[data.islemTuru || ''] || data.islemTuru || '-']);
    (0, jspdf_autotable_1.default)(doc, {
        body: trRows(islemRows),
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
        margin: { left: padX, right: padX },
    });
    currentY = doc.lastAutoTable.finalY + 15;
    // --- YAPILAN ISLEMLER SECTION ---
    const operationLabels = formType === 'teknik_servis' ? TEKNIK_OPERATION_LABELS : APLIKASYON_OPERATION_LABELS;
    const operations = (data.actions || []).filter((a) => a.type === 'operation');
    if (operations.length > 0) {
        doc.setFont(FONT, 'bold');
        doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        doc.line(padX, currentY, pageW - padX, currentY);
        doc.text(tr('Yapılan İşlemler'), padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(doc, {
            head: [[tr('İşlem'), tr('Adet')]],
            body: trRows(operations.map((act) => [
                operationLabels[act.action] || act.action,
                String(act.quantity),
            ])),
            startY: currentY,
            theme: 'grid',
            styles: { font: FONT, fontSize: 10 },
            headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
            margin: { left: padX, right: padX },
        });
        currentY = doc.lastAutoTable.finalY + 15;
    }
    // --- DEGISEN PARCALAR SECTION ---
    const parts = (data.actions || []).filter((a) => a.type === 'part_change');
    if (parts.length > 0) {
        doc.setFont(FONT, 'bold');
        doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        doc.line(padX, currentY, pageW - padX, currentY);
        doc.text(tr('Değişen Parçalar'), padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(doc, {
            head: [[tr('Parça'), tr('Kod'), tr('Adet'), tr('Birim')]],
            body: trRows(parts.map((act) => {
                let partName = act.stokAdi || act.action;
                if (act.isManualEntry && act.stokKodu && act.stokAdi) {
                    partName = `${act.stokKodu} - ${act.stokAdi}`;
                }
                return [
                    partName,
                    act.stokKodu || '-',
                    String(act.quantity),
                    act.anaBirim ? act.anaBirim.toLowerCase() : 'adet',
                ];
            })),
            startY: currentY,
            theme: 'grid',
            styles: { font: FONT, fontSize: 10 },
            headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
            margin: { left: padX, right: padX },
        });
        currentY = doc.lastAutoTable.finalY + 15;
    }
    // --- CIHAZ DURUMU SECTION ---
    doc.setFont(FONT, 'bold');
    doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    doc.line(padX, currentY, pageW - padX, currentY);
    doc.text(tr('Cihaz Durumu'), padX, currentY + 12);
    currentY += 18;
    let cihazDurumuStr = CIHAZ_DURUMU_LABELS[data.cihazDurumu || ''] || '-';
    if (data.cihazDurumu === 'diger' && data.cihazDurumuAciklama) {
        cihazDurumuStr += ` (${data.cihazDurumuAciklama})`;
    }
    (0, jspdf_autotable_1.default)(doc, {
        body: trRows([['Durum:', cihazDurumuStr]]),
        startY: currentY,
        theme: 'plain',
        styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
        margin: { left: padX, right: padX },
    });
    const finalY = doc.lastAutoTable.finalY;
    // --- IMZALAR (SIGNATURES) SECTION ---
    const signatureY = finalY + 40;
    if (signatureY < pageH - 140) {
        doc.setFont(FONT, 'bold');
        doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
        doc.line(padX, signatureY - 15, pageW - padX, signatureY - 15);
        doc.text(tr('İmzalar'), padX, signatureY - 3);
        doc.setFont(FONT, 'normal');
        doc.setFontSize(10);
        // Personnel signature with name
        doc.text(tr('İşlemi Yapan Personel'), padX, signatureY + 15);
        doc.setFont(FONT, 'bold');
        doc.text(tr(data.createdByName || '-'), padX, signatureY + 28);
        doc.setFont(FONT, 'normal');
        doc.line(padX, signatureY + 32, padX + 150, signatureY + 32);
        if (data.personnelSignature) {
            try {
                doc.addImage(data.personnelSignature, 'PNG', padX, signatureY + 37, 150, 40, undefined, 'FAST');
            }
            catch (e) { /* signature image may fail in server context */ }
        }
        // Technician signature with name
        doc.text(tr('Teknisyen'), pageW / 2 + 20, signatureY + 15);
        doc.setFont(FONT, 'bold');
        doc.text(tr(data.technicianName || '-'), pageW / 2 + 20, signatureY + 28);
        doc.setFont(FONT, 'normal');
        doc.line(pageW / 2 + 20, signatureY + 32, pageW / 2 + 170, signatureY + 32);
        if (data.technicianSignature) {
            try {
                doc.addImage(data.technicianSignature, 'PNG', pageW / 2 + 20, signatureY + 37, 150, 40, undefined, 'FAST');
            }
            catch (e) { /* signature image may fail in server context */ }
        }
    }
    // Return as Buffer
    const arrayBuffer = doc.output('arraybuffer');
    return Buffer.from(arrayBuffer);
}
function formatDate(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${d}.${m}.${y} ${h}:${min}`;
}
// --- Main handler for both collections ---
async function handleActionFormCreated(snap, context, formType) {
    const data = snap.data();
    const formId = context.params.formId;
    firebase_functions_1.logger.info(`[actionFormEmail] Processing ${formType} form: ${formId}`);
    // Prepare log entry for Firestore
    const logEntry = {
        formId,
        formType,
        deviceId: data.deviceId || null,
        cihazAdi: data.cihazAdi || null,
        labName: data.labName || null,
        hospitalId: data.hospitalId || null,
        createdByName: data.createdByName || null,
        createdByUid: data.createdByUid || null,
        status: 'processing',
        steps: [],
        error: null,
        emailSentTo: null,
        whatsappSent: false,
        whatsappError: null,
        smtpConfigured: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
        // 1. Get hospital's sorumluEmail
        const hospitalId = data.hospitalId;
        firebase_functions_1.logger.info(`[actionFormEmail] hospitalId: ${hospitalId}`);
        if (!hospitalId) {
            logEntry.status = 'skipped';
            logEntry.error = 'Form üzerinde hospitalId bulunamadı';
            logEntry.steps.push('hospitalId kontrolü: BAŞARISIZ - hospitalId yok');
            firebase_functions_1.logger.info(`[actionFormEmail] No hospitalId on form ${formId}, skipping email.`);
            await db.collection('emailNotificationLogs').add(logEntry);
            return;
        }
        logEntry.steps.push(`hospitalId kontrolü: OK (${hospitalId})`);
        const hospitalDoc = await db.collection('hospitals').doc(hospitalId).get();
        if (!hospitalDoc.exists) {
            logEntry.status = 'skipped';
            logEntry.error = `Hospital dokümanı bulunamadı: ${hospitalId}`;
            logEntry.steps.push(`Hospital dokümanı sorgusu: BAŞARISIZ - ${hospitalId} bulunamadı`);
            firebase_functions_1.logger.info(`[actionFormEmail] Hospital ${hospitalId} not found, skipping email.`);
            await db.collection('emailNotificationLogs').add(logEntry);
            return;
        }
        logEntry.steps.push('Hospital dokümanı sorgusu: OK');
        const hospitalData = hospitalDoc.data();
        const sorumluEmailRaw = hospitalData.sorumluEmail;
        const sorumluEmail = (sorumluEmailRaw && typeof sorumluEmailRaw === 'string') ? sorumluEmailRaw.trim() : '';
        logEntry.labName = hospitalData.name || data.labName || null;
        let emailEnabled = true;
        if (!sorumluEmail) {
            emailEnabled = false;
            logEntry.steps.push('sorumluEmail kontrolü: ATLANDI - email tanımlı değil (WhatsApp denenecek)');
            firebase_functions_1.logger.info(`[actionFormEmail] No sorumluEmail for hospital ${hospitalId}, skipping email but continuing with WhatsApp.`);
        }
        else {
            logEntry.steps.push(`sorumluEmail kontrolü: OK (${sorumluEmail})`);
            logEntry.emailSentTo = sorumluEmail;
            firebase_functions_1.logger.info(`[actionFormEmail] sorumluEmail: ${sorumluEmail}`);
        }
        // 2. Get transporter (only required for email; WhatsApp still proceeds without SMTP)
        const transporter = emailEnabled ? getTransporter() : null;
        if (emailEnabled && !transporter) {
            emailEnabled = false;
            logEntry.smtpConfigured = false;
            logEntry.steps.push('SMTP yapılandırma kontrolü: BAŞARISIZ - ortam değişkenleri eksik (WhatsApp denenecek)');
            firebase_functions_1.logger.error(`[actionFormEmail] SMTP not configured, skipping email for form ${formId} but continuing with WhatsApp.`);
        }
        else if (transporter) {
            logEntry.smtpConfigured = true;
            logEntry.steps.push('SMTP yapılandırma kontrolü: OK');
        }
        // 3. Generate PDF
        logEntry.steps.push('PDF oluşturma: başladı');
        firebase_functions_1.logger.info('[actionFormEmail] PDF generation starting...');
        const pdfBuffer = await generateActionFormPDF(data, formType, formId);
        logEntry.steps.push(`PDF oluşturma: OK (${pdfBuffer.length} byte)`);
        firebase_functions_1.logger.info(`[actionFormEmail] PDF generation OK: ${pdfBuffer.length} bytes`);
        // 4. WhatsApp Notification
        const waConfig = functions.config().whatsapp;
        firebase_functions_1.logger.info('[WhatsApp] Config check...', {
            hasConfig: !!waConfig,
            hasInstanceId: !!(waConfig === null || waConfig === void 0 ? void 0 : waConfig.instance_id),
            hasToken: !!(waConfig === null || waConfig === void 0 ? void 0 : waConfig.token),
            hasGroupId: !!(waConfig === null || waConfig === void 0 ? void 0 : waConfig.group_id)
        });
        if (waConfig && waConfig.instance_id && waConfig.token && waConfig.group_id) {
            logEntry.steps.push('WhatsApp gönderimi: başladı');
            firebase_functions_1.logger.info(`[WhatsApp] Attempting to send to: ${waConfig.group_id}`);
            const labName = data.labName || 'Bilinmeyen Laboratuvar';
            const cihazAdi = data.cihazAdi || 'Bilinmeyen Cihaz';
            const personnelName = data.createdByName || 'Bilinmeyen Kullanıcı';
            const formTypeLabel = formType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon';
            const caption = `*${formTypeLabel} İşlemi Tamamlandı*\n\n` +
                `- *Kurum:* ${labName}\n` +
                `- *Cihaz:* ${cihazAdi}\n` +
                `- *Form No:* ${data.formNo || formId}\n` +
                `- *Personel:* ${personnelName}\n\n` +
                `QORE Sistemi üzerinden detaylara ulaşabilirsiniz.`;
            const waFileName = `IslemFormu_${formType === 'teknik_servis' ? 'Teknik' : 'Aplikasyon'}_${formId.substring(0, 8)}.pdf`;
            try {
                // --- 4.1 Upload to Storage to get a URL ---
                firebase_functions_1.logger.info('[WhatsApp] Uploading PDF to storage for URL-based sending...');
                const bucket = admin.storage().bucket();
                const storagePath = `actionFormPDFs/${formId}_${Date.now()}.pdf`;
                const file = bucket.file(storagePath);
                await file.save(pdfBuffer, {
                    contentType: 'application/pdf',
                    metadata: {
                        cacheControl: 'public, max-age=3600',
                    },
                });
                // Make the file public so UltraMsg can access it
                await file.makePublic();
                // Construct the public URL
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
                firebase_functions_1.logger.info(`[WhatsApp] PDF uploaded and made public. URL: ${publicUrl}`);
                // --- 4.2 Send via WhatsApp ---
                const waResult = await (0, whatsapp_1.sendWhatsAppDocument)(publicUrl, waFileName, caption, waConfig.group_id, waConfig.instance_id, waConfig.token);
                firebase_functions_1.logger.info(`[WhatsApp] Result: ${JSON.stringify(waResult)}`);
                if (waResult.success) {
                    logEntry.whatsappSent = true;
                    logEntry.steps.push(`WhatsApp gönderimi: OK (MsgID: ${waResult.messageId})`);
                }
                else {
                    logEntry.whatsappError = waResult.error || 'Unknown error';
                    logEntry.steps.push(`WhatsApp gönderimi: BAŞARISIZ - ${waResult.error}`);
                }
                // --- 4.3 Send to parts group too if form contains part changes ---
                const hasPartChanges = Array.isArray(data.actions) && data.actions.some((a) => (a === null || a === void 0 ? void 0 : a.type) === 'part_change');
                const partsGroupId = waConfig.parts_group_id || '905362835871-1624522639@g.us';
                if (hasPartChanges && partsGroupId) {
                    firebase_functions_1.logger.info(`[WhatsApp] Form has part changes; also sending to parts group: ${partsGroupId}`);
                    try {
                        const partsResult = await (0, whatsapp_1.sendWhatsAppDocument)(publicUrl, waFileName, caption, partsGroupId, waConfig.instance_id, waConfig.token);
                        firebase_functions_1.logger.info(`[WhatsApp] Parts group result: ${JSON.stringify(partsResult)}`);
                        if (partsResult.success) {
                            logEntry.steps.push(`WhatsApp (parça grubu) gönderimi: OK (MsgID: ${partsResult.messageId})`);
                        }
                        else {
                            logEntry.steps.push(`WhatsApp (parça grubu) gönderimi: BAŞARISIZ - ${partsResult.error}`);
                        }
                    }
                    catch (partsErr) {
                        firebase_functions_1.logger.error('[WhatsApp] Parts group send error', partsErr);
                        logEntry.steps.push(`WhatsApp (parça grubu) gönderimi: HATA - ${(partsErr === null || partsErr === void 0 ? void 0 : partsErr.message) || partsErr}`);
                    }
                }
            }
            catch (waErr) {
                firebase_functions_1.logger.error('[WhatsApp] Fatal error in notification flow:', waErr);
                logEntry.whatsappError = waErr.message || String(waErr);
                logEntry.steps.push(`WhatsApp gönderimi: HATA - ${waErr.message}`);
            }
        }
        else {
            firebase_functions_1.logger.warn('[WhatsApp] Skipping: Configuration is incomplete.');
            logEntry.steps.push('WhatsApp gönderimi: ATLADI (Yapılandırma eksik)');
        }
        // 5. Compose email (only if email is enabled)
        if (emailEnabled && transporter) {
            const labName = hospitalData.name || data.labName || 'Bilinmeyen Laboratuvar';
            const cihazAdi = data.cihazAdi || 'Bilinmeyen Cihaz';
            const personnelName = data.createdByName || 'Bilinmeyen Kullanici';
            const formTypeLabel = formType === 'teknik_servis' ? 'teknik servis' : 'aplikasyon';
            const subject = `Islem Formu - ${labName} - ${cihazAdi}`;
            const body = `Sorumlusu oldugunuz ${labName} laboratuvarindaki ${cihazAdi} cihazina ${formTypeLabel} personeli ${personnelName} tarafindan islem formu kaydedilmistir. Ilgili belge ektedir.`;
            const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
            const pdfFileName = `IslemFormu_${formType === 'teknik_servis' ? 'TeknikServis' : 'Aplikasyon'}_${formId.substring(0, 8)}.pdf`;
            logEntry.steps.push(`Email hazırlandı: from=${senderEmail}, to=${sorumluEmail}, subject=${subject}`);
            try {
                await transporter.sendMail({
                    from: senderEmail,
                    to: sorumluEmail,
                    subject,
                    text: body,
                    attachments: [
                        {
                            filename: pdfFileName,
                            content: pdfBuffer,
                            contentType: 'application/pdf',
                        },
                    ],
                });
                logEntry.status = 'sent';
                logEntry.steps.push('Email gönderimi: BAŞARILI');
                firebase_functions_1.logger.info(`[actionFormEmail] Email sent to ${sorumluEmail} for form ${formId}`);
            }
            catch (error) {
                logEntry.status = 'failed';
                logEntry.error = (error === null || error === void 0 ? void 0 : error.message) || String(error);
                logEntry.steps.push(`Email gönderimi: BAŞARISIZ - ${(error === null || error === void 0 ? void 0 : error.message) || error}`);
                firebase_functions_1.logger.error(`[actionFormEmail] Failed to send email for form ${formId}:`, (error === null || error === void 0 ? void 0 : error.message) || error);
            }
        }
        else {
            // Email skipped; reflect final status based on WhatsApp result
            if (logEntry.whatsappSent) {
                logEntry.status = 'sent';
                logEntry.steps.push('Email gönderimi: ATLANDI (sorumluEmail/SMTP yok), WhatsApp ile bildirildi');
            }
            else {
                logEntry.status = 'skipped';
                logEntry.steps.push('Email gönderimi: ATLANDI (sorumluEmail/SMTP yok)');
            }
            firebase_functions_1.logger.info(`[actionFormEmail] Email step skipped for form ${formId} (emailEnabled=false).`);
        }
    }
    catch (outerError) {
        logEntry.status = 'error';
        logEntry.error = (outerError === null || outerError === void 0 ? void 0 : outerError.message) || String(outerError);
        logEntry.steps.push(`Beklenmeyen hata: ${(outerError === null || outerError === void 0 ? void 0 : outerError.message) || outerError}`);
        firebase_functions_1.logger.error(`[actionFormEmail] Unexpected error for form ${formId}:`, (outerError === null || outerError === void 0 ? void 0 : outerError.message) || outerError);
    }
    // Always write log entry
    try {
        await db.collection('emailNotificationLogs').add(logEntry);
    }
    catch (logError) {
        firebase_functions_1.logger.error(`[actionFormEmail] Failed to write log for form ${formId}:`, logError);
    }
}
// --- Firestore Triggers ---
exports.onTeknikServisFormCreated = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .firestore.document('teknikServisActionForms/{formId}')
    .onCreate(async (snap, context) => {
    await handleActionFormCreated(snap, context, 'teknik_servis');
});
exports.onAplikasyonFormCreated = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .firestore.document('aplikasyonActionForms/{formId}')
    .onCreate(async (snap, context) => {
    await handleActionFormCreated(snap, context, 'aplikasyon');
});
//# sourceMappingURL=actionFormEmailNotification.js.map