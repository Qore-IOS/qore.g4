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
const db = admin.firestore();
// --- Turkish font cache ---
let turkishFontBase64 = null;
async function loadTurkishFont() {
    if (turkishFontBase64)
        return turkishFontBase64;
    try {
        const fontUrl = 'https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRA.ttf';
        const response = await (0, node_fetch_1.default)(fontUrl);
        if (!response.ok)
            return null;
        const buffer = await response.buffer();
        turkishFontBase64 = buffer.toString('base64');
        return turkishFontBase64;
    }
    catch (e) {
        firebase_functions_1.logger.warn('[actionFormEmail] Could not load Turkish font:', e);
        return null;
    }
}
function setupTurkishFont(doc, fontBase64) {
    try {
        doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64);
        doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
        return true;
    }
    catch (e) {
        firebase_functions_1.logger.warn('[actionFormEmail] Could not setup Turkish font:', e);
        return false;
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
    // Load Turkish font for proper ş, ğ, ü, ö, ç, ı, İ support
    const fontBase64 = await loadTurkishFont();
    const useTurkish = fontBase64 ? setupTurkishFont(doc, fontBase64) : false;
    const FONT = useTurkish ? 'NotoSans' : 'helvetica';
    const ORANGE = { r: 199, g: 137, b: 65 };
    doc.setFont(FONT);
    // --- Orange page border ---
    doc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    doc.setLineWidth(2);
    doc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);
    // --- HEADER ---
    const headerY = 30;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont(FONT, 'bold');
    const title = formType === 'teknik_servis' ? 'Teknik Servis Formu' : 'Aplikasyon Formu';
    doc.text(title, padX, headerY + 20);
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
        ['Form No:', formId],
        ['Laboratuvar:', data.labName || '-'],
        ['Cihaz:', `${data.cihazAdi || '-'} (SN: ${data.seriNumarasi || '-'})`],
        ['İşlemi Yapan:', personnelStr],
        ['Tarih / Saat:', dateStr],
    ];
    (0, jspdf_autotable_1.default)(doc, {
        body: info,
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
        doc.text('Açıklama', padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(doc, {
            body: [[data.aciklama]],
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
        doc.text('İşlem Türüne Özel Detaylar', padX, currentY + 12);
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
            body: detailRows,
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
    doc.text('İşlem Tipi ve Türü', padX, currentY + 12);
    currentY += 18;
    doc.setFont(FONT, 'normal');
    const islemRows = [];
    if (formType === 'teknik_servis' && data.islemTipi) {
        islemRows.push(['İşlem Tipi:', TEKNIK_ISLEM_TIPI_LABELS[data.islemTipi] || data.islemTipi]);
    }
    const turuLabels = formType === 'teknik_servis' ? TEKNIK_ISLEM_TURU_LABELS : APLIKASYON_ISLEM_TURU_LABELS;
    islemRows.push(['İşlem Türü:', turuLabels[data.islemTuru || ''] || data.islemTuru || '-']);
    (0, jspdf_autotable_1.default)(doc, {
        body: islemRows,
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
        doc.text('Yapılan İşlemler', padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(doc, {
            head: [['İşlem', 'Adet']],
            body: operations.map((act) => [
                operationLabels[act.action] || act.action,
                String(act.quantity),
            ]),
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
        doc.text('Değişen Parçalar', padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(doc, {
            head: [['Parça', 'Kod', 'Adet', 'Birim']],
            body: parts.map((act) => {
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
            }),
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
    doc.text('Cihaz Durumu', padX, currentY + 12);
    currentY += 18;
    let cihazDurumuStr = CIHAZ_DURUMU_LABELS[data.cihazDurumu || ''] || '-';
    if (data.cihazDurumu === 'diger' && data.cihazDurumuAciklama) {
        cihazDurumuStr += ` (${data.cihazDurumuAciklama})`;
    }
    (0, jspdf_autotable_1.default)(doc, {
        body: [['Durum:', cihazDurumuStr]],
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
        doc.text('İmzalar', padX, signatureY - 3);
        doc.setFont(FONT, 'normal');
        doc.setFontSize(10);
        // Personnel signature with name
        doc.text('İşlemi Yapan Personel', padX, signatureY + 15);
        doc.setFont(FONT, 'bold');
        doc.text(data.createdByName || '-', padX, signatureY + 28);
        doc.setFont(FONT, 'normal');
        doc.line(padX, signatureY + 32, padX + 150, signatureY + 32);
        if (data.personnelSignature) {
            try {
                doc.addImage(data.personnelSignature, 'PNG', padX, signatureY + 37, 150, 40, undefined, 'FAST');
            }
            catch (e) { /* signature image may fail in server context */ }
        }
        // Technician signature with name
        doc.text('Teknisyen', pageW / 2 + 20, signatureY + 15);
        doc.setFont(FONT, 'bold');
        doc.text(data.technicianName || '-', pageW / 2 + 20, signatureY + 28);
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
        smtpConfigured: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
        // 1. Get hospital's sorumluEmail
        const hospitalId = data.hospitalId;
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
        const sorumluEmail = hospitalData.sorumluEmail;
        logEntry.labName = hospitalData.name || data.labName || null;
        if (!sorumluEmail || !sorumluEmail.trim()) {
            logEntry.status = 'skipped';
            logEntry.error = `Hospital ${hospitalId} için sorumluEmail tanımlı değil`;
            logEntry.steps.push('sorumluEmail kontrolü: BAŞARISIZ - email tanımlı değil');
            firebase_functions_1.logger.info(`[actionFormEmail] No sorumluEmail for hospital ${hospitalId}, skipping email.`);
            await db.collection('emailNotificationLogs').add(logEntry);
            return;
        }
        logEntry.steps.push(`sorumluEmail kontrolü: OK (${sorumluEmail.trim()})`);
        logEntry.emailSentTo = sorumluEmail.trim();
        // 2. Get transporter
        const transporter = getTransporter();
        if (!transporter) {
            logEntry.status = 'failed';
            logEntry.smtpConfigured = false;
            logEntry.error = 'SMTP yapılandırması eksik. SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS ortam değişkenlerini kontrol edin.';
            logEntry.steps.push('SMTP yapılandırma kontrolü: BAŞARISIZ - ortam değişkenleri eksik');
            firebase_functions_1.logger.error(`[actionFormEmail] SMTP not configured, cannot send email for form ${formId}.`);
            await db.collection('emailNotificationLogs').add(logEntry);
            return;
        }
        logEntry.smtpConfigured = true;
        logEntry.steps.push('SMTP yapılandırma kontrolü: OK');
        // 3. Generate PDF
        logEntry.steps.push('PDF oluşturma: başladı');
        const pdfBuffer = await generateActionFormPDF(data, formType, formId);
        logEntry.steps.push(`PDF oluşturma: OK (${pdfBuffer.length} byte)`);
        // 4. Compose email
        const labName = hospitalData.name || data.labName || 'Bilinmeyen Laboratuvar';
        const cihazAdi = data.cihazAdi || 'Bilinmeyen Cihaz';
        const personnelName = data.createdByName || 'Bilinmeyen Kullanici';
        const formTypeLabel = formType === 'teknik_servis' ? 'teknik servis' : 'aplikasyon';
        const subject = `Islem Formu - ${labName} - ${cihazAdi}`;
        const body = `Sorumlusu oldugunuz ${labName} laboratuvarindaki ${cihazAdi} cihazina ${formTypeLabel} personeli ${personnelName} tarafindan islem formu kaydedilmistir. Ilgili belge ektedir.`;
        const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
        const pdfFileName = `IslemFormu_${formType === 'teknik_servis' ? 'TeknikServis' : 'Aplikasyon'}_${formId.substring(0, 8)}.pdf`;
        logEntry.steps.push(`Email hazırlandı: from=${senderEmail}, to=${sorumluEmail.trim()}, subject=${subject}`);
        try {
            await transporter.sendMail({
                from: senderEmail,
                to: sorumluEmail.trim(),
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