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
exports.onPeripheralOrderCreatedSendMail = void 0;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const firebase_functions_1 = require("firebase-functions");
const nodemailer = __importStar(require("nodemailer"));
const exceljs = __importStar(require("exceljs"));
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
function getTransporter() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpHost || !smtpUser || !smtpPass) {
        firebase_functions_1.logger.warn('[peripheralOrderEmail] SMTP config missing. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
        return null;
    }
    return nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
    });
}
async function buildExcelBuffer(orderId, order) {
    var _a, _b, _c;
    const labId = order.labId;
    // 1. Fetch minMaxRules
    const rulesMap = {};
    if (labId) {
        try {
            const rulesSnap = await db.collection('hospitals').doc(labId).collection('minMaxRules').get();
            rulesSnap.forEach(doc => {
                const data = doc.data();
                if (data.stokKodu && data.max !== undefined) {
                    rulesMap[data.stokKodu] = Number(data.max);
                }
            });
        }
        catch (err) {
            firebase_functions_1.logger.error(`Error fetching minMaxRules for lab ${labId}:`, err);
        }
    }
    // 2. Fetch depoStok for lab stock and closest miad
    const labStokMap = {};
    const closestMiadLotMap = {};
    if (labId) {
        try {
            // isShipped == true and hedefKurumId == labId gives the lab's current stock based on QR codes
            const depoStokSnap = await db.collection('depoStok')
                .where('isShipped', '==', true)
                .where('hedefKurumId', '==', labId)
                .get();
            const items = depoStokSnap.docs.map(d => d.data());
            const groupedByStok = {};
            items.forEach(item => {
                if (!item.stokKodu)
                    return;
                if (!groupedByStok[item.stokKodu])
                    groupedByStok[item.stokKodu] = [];
                groupedByStok[item.stokKodu].push(item);
            });
            for (const [stokKodu, groupItems] of Object.entries(groupedByStok)) {
                labStokMap[stokKodu] = groupItems.length; // Count of items = Lab Stok
                const itemsWithMiad = groupItems.filter(i => i.miad);
                if (itemsWithMiad.length > 0) {
                    // Find the earliest miad
                    itemsWithMiad.sort((a, b) => {
                        var _a, _b;
                        const miadA = ((_a = a.miad) === null || _a === void 0 ? void 0 : _a.toDate) ? a.miad.toDate().getTime() : new Date(a.miad).getTime();
                        const miadB = ((_b = b.miad) === null || _b === void 0 ? void 0 : _b.toDate) ? b.miad.toDate().getTime() : new Date(b.miad).getTime();
                        return miadA - miadB;
                    });
                    const earliestTime = ((_a = itemsWithMiad[0].miad) === null || _a === void 0 ? void 0 : _a.toDate) ? itemsWithMiad[0].miad.toDate().getTime() : new Date(itemsWithMiad[0].miad).getTime();
                    // Count items that have this exact earliest miad
                    const count = itemsWithMiad.filter(i => {
                        var _a;
                        const time = ((_a = i.miad) === null || _a === void 0 ? void 0 : _a.toDate) ? i.miad.toDate().getTime() : new Date(i.miad).getTime();
                        return time === earliestTime;
                    }).length;
                    closestMiadLotMap[stokKodu] = count;
                }
                else {
                    closestMiadLotMap[stokKodu] = 0;
                }
            }
        }
        catch (err) {
            firebase_functions_1.logger.error(`Error fetching depoStok for lab ${labId}:`, err);
        }
    }
    // 3. Create Excel
    const workbook = new exceljs.Workbook();
    const sheet = workbook.addWorksheet('Siparis', { views: [{ state: 'frozen', ySplit: 7 }] });
    // Top Info
    const createdAtText = ((_c = (_b = order.createdAt) === null || _b === void 0 ? void 0 : _b.toDate) === null || _c === void 0 ? void 0 : _c.call(_b)) ? order.createdAt.toDate().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const labName = order.kurumAdi || '-';
    const createdBy = order.createdBy || '-';
    sheet.addRow(['Sipariş ID:', orderId]);
    sheet.addRow(['Laboratuvar:', labName]);
    sheet.addRow(['Laboratuvar ID:', labId || '-']);
    sheet.addRow(['Oluşturan:', createdBy]);
    sheet.addRow(['Tarih:', createdAtText]);
    sheet.addRow([]); // empty line
    // Header Row
    const headerRow = sheet.addRow([
        '#',
        'Stok Kodu',
        'Stok Adı',
        'Lab Stok',
        '30 Günlük Max',
        'Yakın Miad Lot Adedi',
        'Talep Adedi'
    ]);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F46E5' } // Indigo color
        };
        cell.border = {
            top: { style: 'thin' }, left: { style: 'thin' },
            bottom: { style: 'thin' }, right: { style: 'thin' }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    // Data Rows
    const borderStyle = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
    };
    (order.items || []).forEach((item, idx) => {
        var _a, _b, _c;
        const sKodu = item.stokKodu || '-';
        const labStok = (_a = labStokMap[sKodu]) !== null && _a !== void 0 ? _a : 0;
        const maxAdet = (_b = rulesMap[sKodu]) !== null && _b !== void 0 ? _b : 0;
        const yakinMiad = (_c = closestMiadLotMap[sKodu]) !== null && _c !== void 0 ? _c : 0;
        const talep = Number(item.adet || 0);
        const row = sheet.addRow([
            idx + 1,
            sKodu,
            item.stokAdi || '-',
            labStok,
            maxAdet,
            yakinMiad,
            talep
        ]);
        row.eachCell((cell, colNumber) => {
            cell.border = borderStyle;
            cell.alignment = { vertical: 'middle', horizontal: colNumber === 3 ? 'left' : 'center' };
            // Styling specifically for "Talep Adedi"
            if (colNumber === 7) {
                cell.font = { bold: true, size: 13, color: { argb: 'FF000000' } };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFECFCCB' } // Light green tint
                };
            }
        });
    });
    // Auto-fit columns
    sheet.columns.forEach((column, index) => {
        var _a;
        let maxLength = 0;
        (_a = column.eachCell) === null || _a === void 0 ? void 0 : _a.call(column, { includeEmpty: false }, (cell, rowNumber) => {
            if (rowNumber > 5) { // Skip the top info rows for width calculation
                const columnLength = cell.value ? cell.value.toString().length : 10;
                if (columnLength > maxLength)
                    maxLength = columnLength;
            }
        });
        // Add some padding and set min/max width
        column.width = Math.min(Math.max(maxLength + 2, 10), 60);
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}
exports.onPeripheralOrderCreatedSendMail = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 60, memory: '512MB' }) // Increased memory slightly for excel generation
    .firestore.document('orders/{orderId}')
    .onCreate(async (snap, context) => {
    const orderId = context.params.orderId;
    const order = snap.data();
    const isPeripheralRequest = (order === null || order === void 0 ? void 0 : order.isPeripheral) === true || (order === null || order === void 0 ? void 0 : order.requestSource) === 'lab_to_office';
    if (!isPeripheralRequest) {
        return;
    }
    const logEntry = {
        type: 'peripheral_order_email',
        orderId,
        status: 'processing',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        recipients: [],
    };
    try {
        const transporter = getTransporter();
        if (!transporter) {
            logEntry.status = 'skipped';
            logEntry.error = 'SMTP not configured';
            await db.collection('emailNotificationLogs').add(logEntry);
            return;
        }
        const usersSnap = await db
            .collection('users')
            .where('role', '==', 'lojistik_sorumlusu')
            .get();
        const emails = usersSnap.docs
            .map((d) => { var _a; return (((_a = d.data()) === null || _a === void 0 ? void 0 : _a.email) || '').trim(); })
            .filter((email) => !!email);
        if (emails.length === 0) {
            logEntry.status = 'skipped';
            logEntry.error = 'No email found for role=lojistik_sorumlusu';
            await db.collection('emailNotificationLogs').add(logEntry);
            return;
        }
        logEntry.recipients = emails;
        const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
        const labName = order.kurumAdi || 'Bilinmeyen Laboratuvar';
        const itemsCount = (order.items || []).length;
        const totalQty = (order.items || []).reduce((sum, item) => sum + Number(item.adet || 0), 0);
        const excelBuffer = await buildExcelBuffer(orderId, order);
        await transporter.sendMail({
            from: senderEmail,
            to: emails.join(','),
            subject: `[Perifer Talep] Yeni Sipariş - ${labName}`,
            text: `Perifer laboratuvardan yeni sipariş talebi açıldı.\nSipariş ID: ${orderId}\nLaboratuvar: ${labName}\nKalem: ${itemsCount}\nToplam Adet: ${totalQty}`,
            html: `<p>Perifer laboratuvardan yeni sipariş talebi açıldı.</p>
               <ul>
                 <li><b>Sipariş ID:</b> ${orderId}</li>
                 <li><b>Laboratuvar:</b> ${labName}</li>
                 <li><b>Kalem Sayısı:</b> ${itemsCount}</li>
                 <li><b>Toplam Adet:</b> ${totalQty}</li>
               </ul>
               <p>Sipariş detayları ve lojistik verileri Excel dosyasında ektedir.</p>`,
            attachments: [
                {
                    filename: `perifer_siparis_${orderId}.xlsx`,
                    content: excelBuffer,
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                },
            ],
        });
        logEntry.status = 'sent';
        await db.collection('emailNotificationLogs').add(logEntry);
        firebase_functions_1.logger.info(`[peripheralOrderEmail] Sent order ${orderId} email to ${emails.length} recipients.`);
    }
    catch (error) {
        logEntry.status = 'failed';
        logEntry.error = (error === null || error === void 0 ? void 0 : error.message) || String(error);
        await db.collection('emailNotificationLogs').add(logEntry);
        firebase_functions_1.logger.error(`[peripheralOrderEmail] Failed for order ${orderId}:`, error);
    }
});
//# sourceMappingURL=orderCreatedPeripheralEmail.js.map