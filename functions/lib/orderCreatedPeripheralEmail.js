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
const THIN_BORDER = {
    top: { style: 'thin', color: { argb: 'FF94A3B8' } },
    left: { style: 'thin', color: { argb: 'FF94A3B8' } },
    bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
    right: { style: 'thin', color: { argb: 'FF94A3B8' } },
};
const MEDIUM_BORDER = {
    top: { style: 'medium', color: { argb: 'FF1E293B' } },
    left: { style: 'medium', color: { argb: 'FF1E293B' } },
    bottom: { style: 'medium', color: { argb: 'FF1E293B' } },
    right: { style: 'medium', color: { argb: 'FF1E293B' } },
};
// Each column gets its own dedicated colour palette (header + body tint)
const COLUMN_PALETTE = [
    { header: 'FF334155', body: 'FFF1F5F9', text: 'FF0F172A' },
    { header: 'FF0EA5E9', body: 'FFE0F2FE', text: 'FF0C4A6E' },
    { header: 'FF6366F1', body: 'FFE0E7FF', text: 'FF312E81' },
    { header: 'FF14B8A6', body: 'FFCCFBF1', text: 'FF134E4A' },
    { header: 'FFF59E0B', body: 'FFFEF3C7', text: 'FF78350F' },
    { header: 'FFEF4444', body: 'FFFEE2E2', text: 'FF7F1D1D' },
    { header: 'FF16A34A', body: 'FFDCFCE7', text: 'FF14532D' }, // Talep Adedi — green
];
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
    // 1. Fetch minMaxRules (max amount per stokKodu)
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
    // 2. Fetch depoStok for lab stock and closest miad lot count
    const labStokMap = {};
    const closestMiadLotMap = {};
    if (labId) {
        try {
            const depoStokSnap = await db
                .collection('depoStok')
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
                labStokMap[stokKodu] = groupItems.length;
                const itemsWithMiad = groupItems.filter(i => i.miad);
                if (itemsWithMiad.length > 0) {
                    itemsWithMiad.sort((a, b) => {
                        var _a, _b;
                        const miadA = ((_a = a.miad) === null || _a === void 0 ? void 0 : _a.toDate) ? a.miad.toDate().getTime() : new Date(a.miad).getTime();
                        const miadB = ((_b = b.miad) === null || _b === void 0 ? void 0 : _b.toDate) ? b.miad.toDate().getTime() : new Date(b.miad).getTime();
                        return miadA - miadB;
                    });
                    const earliestTime = ((_a = itemsWithMiad[0].miad) === null || _a === void 0 ? void 0 : _a.toDate)
                        ? itemsWithMiad[0].miad.toDate().getTime()
                        : new Date(itemsWithMiad[0].miad).getTime();
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
    // 3. Build Excel
    const workbook = new exceljs.Workbook();
    workbook.creator = 'INV-zen';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Perifer Talep', {
        views: [{ state: 'frozen', ySplit: 8 }],
        properties: { defaultRowHeight: 18 },
    });
    const createdAtText = ((_c = (_b = order.createdAt) === null || _b === void 0 ? void 0 : _b.toDate) === null || _c === void 0 ? void 0 : _c.call(_b))
        ? order.createdAt.toDate().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
        : new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const labName = order.kurumAdi || '-';
    const createdBy = order.createdBy || '-';
    const totalQty = (order.items || []).reduce((s, it) => s + Number(it.adet || 0), 0);
    // --- Title row (merged across columns) ---
    sheet.mergeCells('A1:G1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'PERİFER LABORATUVAR ÜRÜN TALEBİ';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' },
    };
    titleCell.border = MEDIUM_BORDER;
    sheet.getRow(1).height = 28;
    // --- Info rows: label + value, both bordered with distinct colours ---
    const infoRows = [
        { label: 'Sipariş ID', value: orderId, labelFill: 'FFE0F2FE', valueFill: 'FFFFFFFF' },
        { label: 'Laboratuvar', value: labName, labelFill: 'FFE0E7FF', valueFill: 'FFFFFFFF' },
        { label: 'Laboratuvar ID', value: labId || '-', labelFill: 'FFCCFBF1', valueFill: 'FFFFFFFF' },
        { label: 'Talep Eden', value: createdBy, labelFill: 'FFFEF3C7', valueFill: 'FFFFFFFF' },
        { label: 'Tarih', value: createdAtText, labelFill: 'FFFEE2E2', valueFill: 'FFFFFFFF' },
        { label: 'Toplam Kalem / Toplam Adet', value: `${(order.items || []).length} kalem  ·  ${totalQty} adet`, labelFill: 'FFDCFCE7', valueFill: 'FFFFFFFF' },
    ];
    infoRows.forEach((info, idx) => {
        const rowIdx = idx + 2; // start at row 2
        const row = sheet.getRow(rowIdx);
        row.height = 20;
        const labelCell = row.getCell(1);
        labelCell.value = info.label;
        labelCell.font = { bold: true, color: { argb: 'FF0F172A' } };
        labelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: info.labelFill } };
        labelCell.border = THIN_BORDER;
        sheet.mergeCells(rowIdx, 2, rowIdx, 7);
        const valueCell = row.getCell(2);
        valueCell.value = info.value;
        valueCell.font = { size: 11, color: { argb: 'FF0F172A' } };
        valueCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: info.valueFill } };
        valueCell.border = THIN_BORDER;
    });
    // --- Header row (row 8) ---
    const HEADER_ROW = 8;
    const headers = ['#', 'Stok Kodu', 'Stok Adı', 'Lab Stok', '30 Günlük Max', 'Yakın Miad Lot Adedi', 'Talep Adedi'];
    const headerRow = sheet.getRow(HEADER_ROW);
    headerRow.height = 32;
    headers.forEach((label, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = label;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: COLUMN_PALETTE[i].header },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = MEDIUM_BORDER;
    });
    // --- Data rows ---
    const items = order.items || [];
    items.forEach((item, idx) => {
        var _a, _b, _c;
        const sKodu = item.stokKodu || '-';
        const labStok = (_a = labStokMap[sKodu]) !== null && _a !== void 0 ? _a : 0;
        const maxAdet = (_b = rulesMap[sKodu]) !== null && _b !== void 0 ? _b : 0;
        const yakinMiad = (_c = closestMiadLotMap[sKodu]) !== null && _c !== void 0 ? _c : 0;
        const talep = Number(item.adet || 0);
        const row = sheet.getRow(HEADER_ROW + 1 + idx);
        row.height = 30;
        const values = [
            idx + 1,
            sKodu,
            item.stokAdi || '-',
            labStok,
            maxAdet,
            yakinMiad,
            talep,
        ];
        values.forEach((value, colIdx) => {
            const cell = row.getCell(colIdx + 1);
            cell.value = value;
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: COLUMN_PALETTE[colIdx].body },
            };
            cell.border = THIN_BORDER;
            cell.alignment = {
                vertical: 'middle',
                horizontal: colIdx === 2 ? 'left' : 'center',
                indent: colIdx === 2 ? 1 : 0,
            };
            // Talep Adedi (last column) — large, bold, vivid
            if (colIdx === 6) {
                cell.font = { bold: true, size: 18, color: { argb: COLUMN_PALETTE[6].text } };
                cell.border = MEDIUM_BORDER;
            }
            else if (colIdx === 0) {
                cell.font = { bold: true, size: 11, color: { argb: COLUMN_PALETTE[colIdx].text } };
            }
            else {
                cell.font = { size: 11, color: { argb: COLUMN_PALETTE[colIdx].text } };
            }
        });
    });
    // --- Totals row (sum of Talep Adedi) ---
    const totalRowIdx = HEADER_ROW + 1 + items.length;
    const totalRow = sheet.getRow(totalRowIdx);
    totalRow.height = 28;
    sheet.mergeCells(totalRowIdx, 1, totalRowIdx, 6);
    const totalLabelCell = totalRow.getCell(1);
    totalLabelCell.value = 'TOPLAM TALEP ADEDİ';
    totalLabelCell.font = { bold: true, size: 12, color: { argb: 'FF14532D' } };
    totalLabelCell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
    totalLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
    totalLabelCell.border = MEDIUM_BORDER;
    const totalValueCell = totalRow.getCell(7);
    totalValueCell.value = totalQty;
    totalValueCell.font = { bold: true, size: 18, color: { argb: 'FF14532D' } };
    totalValueCell.alignment = { vertical: 'middle', horizontal: 'center' };
    totalValueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBBF7D0' } };
    totalValueCell.border = MEDIUM_BORDER;
    // --- Column widths (manually tuned for readability) ---
    const widths = [6, 18, 42, 12, 16, 22, 16];
    widths.forEach((w, i) => {
        sheet.getColumn(i + 1).width = w;
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}
async function resolveLogisticsRecipients() {
    const debug = {};
    const emailSet = new Set();
    // Primary: users with role === 'lojistik_sorumlusu'
    try {
        const usersSnap = await db
            .collection('users')
            .where('role', '==', 'lojistik_sorumlusu')
            .get();
        debug.lojistikSorumlusuFound = usersSnap.size;
        usersSnap.docs.forEach((d) => {
            var _a;
            const email = (((_a = d.data()) === null || _a === void 0 ? void 0 : _a.email) || '').trim();
            if (email)
                emailSet.add(email.toLowerCase());
        });
    }
    catch (err) {
        debug.primaryQueryError = (err === null || err === void 0 ? void 0 : err.message) || String(err);
    }
    debug.emailsFromPrimary = emailSet.size;
    return { emails: Array.from(emailSet), debug };
}
exports.onPeripheralOrderCreatedSendMail = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .firestore.document('orders/{orderId}')
    .onCreate(async (snap, context) => {
    var _a, _b;
    const orderId = context.params.orderId;
    const order = snap.data();
    const isPeripheralRequest = (order === null || order === void 0 ? void 0 : order.isPeripheral) === true || (order === null || order === void 0 ? void 0 : order.requestSource) === 'lab_to_office';
    const logEntry = {
        type: 'peripheral_order_email',
        orderId,
        labId: (order === null || order === void 0 ? void 0 : order.labId) || null,
        labName: (order === null || order === void 0 ? void 0 : order.kurumAdi) || null,
        isPeripheral: (_a = order === null || order === void 0 ? void 0 : order.isPeripheral) !== null && _a !== void 0 ? _a : null,
        requestSource: (_b = order === null || order === void 0 ? void 0 : order.requestSource) !== null && _b !== void 0 ? _b : null,
        itemsCount: ((order === null || order === void 0 ? void 0 : order.items) || []).length,
        status: 'processing',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        recipients: [],
        steps: [],
    };
    const steps = logEntry.steps;
    if (!isPeripheralRequest) {
        logEntry.status = 'skipped';
        logEntry.error = `Order is not peripheral (isPeripheral=${order === null || order === void 0 ? void 0 : order.isPeripheral}, requestSource=${order === null || order === void 0 ? void 0 : order.requestSource})`;
        steps.push('isPeripheral kontrolü: ATLAND - perifer talep değil');
        try {
            await db.collection('emailNotificationLogs').add(logEntry);
        }
        catch (e) {
            firebase_functions_1.logger.error('[peripheralOrderEmail] Could not write skip-log:', e);
        }
        return;
    }
    steps.push('isPeripheral kontrolü: OK');
    try {
        const transporter = getTransporter();
        if (!transporter) {
            logEntry.status = 'failed';
            logEntry.error =
                'SMTP yapılandırması eksik. SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS ortam değişkenlerini kontrol edin.';
            steps.push('SMTP yapılandırma kontrolü: BAŞARISIZ');
            await db.collection('emailNotificationLogs').add(logEntry);
            firebase_functions_1.logger.error(`[peripheralOrderEmail] SMTP not configured for order ${orderId}.`);
            return;
        }
        steps.push('SMTP yapılandırma kontrolü: OK');
        const { emails, debug } = await resolveLogisticsRecipients();
        logEntry.recipientLookup = debug;
        if (emails.length === 0) {
            logEntry.status = 'skipped';
            logEntry.error =
                "role='lojistik_sorumlusu' olan kullanıcı bulunamadı veya hiçbirinin e-posta adresi tanımlı değil.";
            steps.push('Alıcı sorgusu: BAŞARISIZ - lojistik sorumlusu kullanıcı/email yok');
            await db.collection('emailNotificationLogs').add(logEntry);
            firebase_functions_1.logger.warn(`[peripheralOrderEmail] No lojistik_sorumlusu recipients for order ${orderId}.`);
            return;
        }
        logEntry.recipients = emails;
        steps.push(`Alıcı sorgusu: OK (${emails.length} alıcı)`);
        const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
        const labName = order.kurumAdi || 'Bilinmeyen Laboratuvar';
        const itemsCount = (order.items || []).length;
        const totalQty = (order.items || []).reduce((sum, item) => sum + Number(item.adet || 0), 0);
        steps.push('Excel oluşturma: başladı');
        const excelBuffer = await buildExcelBuffer(orderId, order);
        steps.push(`Excel oluşturma: OK (${excelBuffer.length} byte)`);
        await transporter.sendMail({
            from: senderEmail,
            to: emails.join(','),
            subject: `[Perifer Talep] Yeni Sipariş — ${labName} (${totalQty} adet)`,
            text: `Perifer laboratuvardan yeni sipariş talebi açıldı.\n` +
                `Sipariş ID: ${orderId}\n` +
                `Laboratuvar: ${labName}\n` +
                `Kalem Sayısı: ${itemsCount}\n` +
                `Toplam Adet: ${totalQty}\n\n` +
                `Detaylar ekteki Excel dosyasındadır.`,
            html: `
          <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color:#0f172a;">
            <h2 style="margin:0 0 12px 0; color:#1e293b;">Perifer Laboratuvar Ürün Talebi</h2>
            <p style="margin:0 0 12px 0;">Aşağıdaki perifer laboratuvardan yeni bir ürün talebi açıldı:</p>
            <table style="border-collapse:collapse; font-size:14px;">
              <tr><td style="padding:6px 12px; background:#e0f2fe; border:1px solid #94a3b8;"><b>Sipariş ID</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${orderId}</td></tr>
              <tr><td style="padding:6px 12px; background:#e0e7ff; border:1px solid #94a3b8;"><b>Laboratuvar</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${labName}</td></tr>
              <tr><td style="padding:6px 12px; background:#fef3c7; border:1px solid #94a3b8;"><b>Talep Eden</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${order.createdBy || '-'}</td></tr>
              <tr><td style="padding:6px 12px; background:#fee2e2; border:1px solid #94a3b8;"><b>Kalem Sayısı</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${itemsCount}</td></tr>
              <tr><td style="padding:6px 12px; background:#dcfce7; border:1px solid #94a3b8;"><b>Toplam Adet</b></td><td style="padding:6px 12px; border:1px solid #94a3b8; font-weight:bold; font-size:16px;">${totalQty}</td></tr>
            </table>
            <p style="margin:16px 0 0 0;">Sipariş detayları (lab stok, max adet, talep adedi) ekteki Excel dosyasındadır.</p>
          </div>`,
            attachments: [
                {
                    filename: `perifer_siparis_${orderId}.xlsx`,
                    content: excelBuffer,
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                },
            ],
        });
        logEntry.status = 'sent';
        steps.push(`Email gönderimi: BAŞARILI (${emails.length} alıcı)`);
        await db.collection('emailNotificationLogs').add(logEntry);
        firebase_functions_1.logger.info(`[peripheralOrderEmail] Sent order ${orderId} email to ${emails.length} recipients.`);
    }
    catch (error) {
        logEntry.status = 'failed';
        logEntry.error = (error === null || error === void 0 ? void 0 : error.message) || String(error);
        steps.push(`Beklenmeyen hata: ${(error === null || error === void 0 ? void 0 : error.message) || error}`);
        try {
            await db.collection('emailNotificationLogs').add(logEntry);
        }
        catch (logErr) {
            firebase_functions_1.logger.error('[peripheralOrderEmail] Could not write failure-log:', logErr);
        }
        firebase_functions_1.logger.error(`[peripheralOrderEmail] Failed for order ${orderId}:`, error);
    }
});
//# sourceMappingURL=orderCreatedPeripheralEmail.js.map