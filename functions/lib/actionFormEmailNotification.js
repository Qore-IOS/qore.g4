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
const db = admin.firestore();
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
    periyodik_bakim: 'Periyodik Bakim',
    cihaz_kurulumu: 'Cihaz Kurulumu',
    ariza: 'Ariza',
    sw_update: 'SW Update',
    alis: 'ALIS',
    roche_bilgisayar_arizasi: 'Roche Bilgisayar Arizasi',
};
const APLIKASYON_ISLEM_TURU_LABELS = {
    '': '-',
    rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
    periyodik_bakim: 'Periyodik Bakim',
    ariza: 'Ariza',
    alis: 'ALIS',
    roche_bilgisayar_arizasi: 'Roche Bilgisayar Arizasi',
};
const TEKNIK_OPERATION_LABELS = {
    genel_temizlik_yaglama: 'Genel Temizlik & Yaglama',
    temel_fonksiyon_testleri: 'Temel Fonksiyon Testleri',
    mekanik_ayarlar_kontrol: 'Mekanik Ayarlar & Kontrol',
    optik_ayarlar_kontrol: 'Optik Ayarlar & Kontrol',
    pipetleme_transfer_ayarlari: 'Pipetleme / Transfer Ayarlari & Kontrol',
};
const APLIKASYON_OPERATION_LABELS = {
    aplikasyon_kontrol: 'Aplikasyon Kontrol',
    kalibrasyon_kontrol: 'Kalibrasyon Kontrol',
    qc_materyal_kontrol: 'QC Materyal Kontrol',
    ornek_sonucu_karsilastirma: 'Ornek Sonucu Karsilastirma',
    reaktif_yenileme: 'Reaktif Yenileme',
    kalibrator_yenileme: 'Kalibrator Yenileme',
    qc_yenileme: 'QC Yenileme',
    cv_calismasi: 'CV Calismasi',
    diger: 'Diger',
};
const CIHAZ_DURUMU_LABELS = {
    '': '-',
    calisiyor: 'Calisiyor',
    arizali: 'Arizali',
    denemede: 'Denemede',
    diger: 'Diger',
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
// --- PDF Generation ---
function generateActionFormPDF(data, formType) {
    var _a, _b, _c;
    const doc = new jspdf_1.jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const padX = 40;
    doc.setFont('helvetica');
    // --- Header ---
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    const title = formType === 'teknik_servis' ? 'Teknik Servis Formu' : 'Aplikasyon Formu';
    doc.text(title, padX, 40);
    // --- Form Info ---
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    let currentY = 60;
    // Build personnel string
    let personnelStr = data.createdByName || '-';
    if (data.eslikEdenPersonel && data.eslikEdenPersonel.length > 0) {
        const eslikNames = data.eslikEdenPersonel.map((p) => p.name).join(', ');
        personnelStr += ` (Eslik Eden: ${eslikNames})`;
    }
    const createdAtStr = ((_a = data.createdAt) === null || _a === void 0 ? void 0 : _a.toDate)
        ? formatDate(data.createdAt.toDate())
        : (((_b = data.createdAt) === null || _b === void 0 ? void 0 : _b._seconds) ? formatDate(new Date(data.createdAt._seconds * 1000)) : '-');
    const info = [
        ['Laboratuvar:', data.labName || '-'],
        ['Cihaz:', `${data.cihazAdi || '-'} (SN: ${data.seriNumarasi || '-'})`],
        ['Islemi Yapan:', personnelStr],
        ['Tarih / Saat:', createdAtStr],
    ];
    if (data.baslangicTarihi && data.baslangicSaati) {
        info.push(['Baslangic:', `${data.baslangicTarihi} ${data.baslangicSaati}`]);
    }
    if (data.bitisTarihi && data.bitisSaati) {
        info.push(['Bitis:', `${data.bitisTarihi} ${data.bitisSaati}`]);
    }
    (0, jspdf_autotable_1.default)(doc, {
        body: info,
        startY: currentY,
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 10, cellPadding: { top: 4, bottom: 4 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
    });
    currentY = doc.lastAutoTable.finalY + 15;
    // --- Aciklama ---
    if ((_c = data.aciklama) === null || _c === void 0 ? void 0 : _c.trim()) {
        doc.setFont('helvetica', 'bold');
        doc.text('Aciklama', padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(doc, {
            body: [[data.aciklama]],
            startY: currentY,
            theme: 'grid',
            styles: { font: 'helvetica', fontSize: 10, cellPadding: { top: 6, bottom: 6 } },
            margin: { left: padX, right: padX },
        });
        currentY = doc.lastAutoTable.finalY + 15;
    }
    // --- Islem Tipi ve Turu ---
    doc.setFont('helvetica', 'bold');
    doc.text('Islem Tipi ve Turu', padX, currentY + 12);
    currentY += 18;
    doc.setFont('helvetica', 'normal');
    const islemRows = [];
    if (formType === 'teknik_servis' && data.islemTipi) {
        islemRows.push(['Islem Tipi:', TEKNIK_ISLEM_TIPI_LABELS[data.islemTipi] || data.islemTipi]);
    }
    const turuLabels = formType === 'teknik_servis' ? TEKNIK_ISLEM_TURU_LABELS : APLIKASYON_ISLEM_TURU_LABELS;
    islemRows.push(['Islem Turu:', turuLabels[data.islemTuru || ''] || data.islemTuru || '-']);
    (0, jspdf_autotable_1.default)(doc, {
        body: islemRows,
        startY: currentY,
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
        margin: { left: padX, right: padX },
    });
    currentY = doc.lastAutoTable.finalY + 15;
    // --- Yapilan Islemler ---
    const operationLabels = formType === 'teknik_servis' ? TEKNIK_OPERATION_LABELS : APLIKASYON_OPERATION_LABELS;
    const operations = (data.actions || []).filter((a) => a.type === 'operation');
    if (operations.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.text('Yapilan Islemler', padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(doc, {
            head: [['Islem', 'Adet']],
            body: operations.map((act) => [
                operationLabels[act.action] || act.action,
                String(act.quantity),
            ]),
            startY: currentY,
            theme: 'grid',
            styles: { font: 'helvetica', fontSize: 10 },
            headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
            margin: { left: padX, right: padX },
        });
        currentY = doc.lastAutoTable.finalY + 15;
    }
    // --- Degisen Parcalar ---
    const parts = (data.actions || []).filter((a) => a.type === 'part_change');
    if (parts.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.text('Degisen Parcalar', padX, currentY + 12);
        currentY += 18;
        (0, jspdf_autotable_1.default)(doc, {
            head: [['Parca', 'Kod', 'Adet']],
            body: parts.map((act) => [
                act.stokAdi || act.action,
                act.stokKodu || '-',
                String(act.quantity),
            ]),
            startY: currentY,
            theme: 'grid',
            styles: { font: 'helvetica', fontSize: 10 },
            headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
            margin: { left: padX, right: padX },
        });
        currentY = doc.lastAutoTable.finalY + 15;
    }
    // --- Cihaz Durumu ---
    doc.setFont('helvetica', 'bold');
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
        styles: { font: 'helvetica', fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
        margin: { left: padX, right: padX },
    });
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
    // 1. Get hospital's sorumluEmail
    const hospitalId = data.hospitalId;
    if (!hospitalId) {
        firebase_functions_1.logger.info(`[actionFormEmail] No hospitalId on form ${formId}, skipping email.`);
        return;
    }
    const hospitalDoc = await db.collection('hospitals').doc(hospitalId).get();
    if (!hospitalDoc.exists) {
        firebase_functions_1.logger.info(`[actionFormEmail] Hospital ${hospitalId} not found, skipping email.`);
        return;
    }
    const hospitalData = hospitalDoc.data();
    const sorumluEmail = hospitalData.sorumluEmail;
    if (!sorumluEmail || !sorumluEmail.trim()) {
        firebase_functions_1.logger.info(`[actionFormEmail] No sorumluEmail for hospital ${hospitalId}, skipping email.`);
        return;
    }
    // 2. Get transporter
    const transporter = getTransporter();
    if (!transporter) {
        firebase_functions_1.logger.error(`[actionFormEmail] SMTP not configured, cannot send email for form ${formId}.`);
        return;
    }
    // 3. Generate PDF
    const pdfBuffer = generateActionFormPDF(data, formType);
    // 4. Compose email
    const labName = hospitalData.name || data.labName || 'Bilinmeyen Laboratuvar';
    const cihazAdi = data.cihazAdi || 'Bilinmeyen Cihaz';
    const personnelName = data.createdByName || 'Bilinmeyen Kullanici';
    const formTypeLabel = formType === 'teknik_servis' ? 'teknik servis' : 'aplikasyon';
    const subject = `Islem Formu - ${labName} - ${cihazAdi}`;
    const body = `Sorumlusu oldugunuz ${labName} laboratuvarindaki ${cihazAdi} cihazina ${formTypeLabel} personeli ${personnelName} tarafindan islem formu kaydedilmistir. Ilgili belge ektedir.`;
    const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    const pdfFileName = `IslemFormu_${formType === 'teknik_servis' ? 'TeknikServis' : 'Aplikasyon'}_${formId.substring(0, 8)}.pdf`;
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
        firebase_functions_1.logger.info(`[actionFormEmail] Email sent to ${sorumluEmail} for form ${formId}`);
    }
    catch (error) {
        firebase_functions_1.logger.error(`[actionFormEmail] Failed to send email for form ${formId}:`, (error === null || error === void 0 ? void 0 : error.message) || error);
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