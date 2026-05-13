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
const peripheralRecipients_1 = require("./lib/peripheralRecipients");
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
const URGENCY_META = {
    normal: { label: 'Normal', emailBg: '#dcfce7', emailText: '#14532d', xlBg: 'FFDCFCE7', xlText: 'FF14532D', emailBadgeBorder: '#16a34a' },
    acil: { label: 'Acil', emailBg: '#fef3c7', emailText: '#78350f', xlBg: 'FFFEF3C7', xlText: 'FF78350F', emailBadgeBorder: '#f59e0b' },
    cok_acil: { label: 'Çok Acil', emailBg: '#fee2e2', emailText: '#7f1d1d', xlBg: 'FFFEE2E2', xlText: 'FF7F1D1D', emailBadgeBorder: '#ef4444' },
};
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
async function buildExcelBuffer(orderId, order, itemInfoMap) {
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
        properties: { defaultRowHeight: 18 },
    });
    const createdAtText = ((_c = (_b = order.createdAt) === null || _b === void 0 ? void 0 : _b.toDate) === null || _c === void 0 ? void 0 : _c.call(_b))
        ? order.createdAt.toDate().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
        : new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const labName = order.kurumAdi || '-';
    const createdBy = order.createdBy || '-';
    const totalQty = (order.items || []).reduce((s, it) => s + Number(it.adet || 0), 0);
    const urgencyKey = (order.urgency && URGENCY_META[order.urgency] ? order.urgency : 'normal');
    const urgencyMeta = URGENCY_META[urgencyKey];
    const noteText = (order.note || '').trim();
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
    const infoRows = [
        { label: 'Sipariş ID', value: orderId, labelFill: 'FFE0F2FE', valueFill: 'FFFFFFFF' },
        { label: 'Laboratuvar', value: labName, labelFill: 'FFE0E7FF', valueFill: 'FFFFFFFF' },
        { label: 'Laboratuvar ID', value: labId || '-', labelFill: 'FFCCFBF1', valueFill: 'FFFFFFFF' },
        { label: 'Talep Eden', value: createdBy, labelFill: 'FFFEF3C7', valueFill: 'FFFFFFFF' },
        { label: 'Tarih', value: createdAtText, labelFill: 'FFFEE2E2', valueFill: 'FFFFFFFF' },
        {
            label: 'Aciliyet',
            value: urgencyMeta.label.toLocaleUpperCase('tr-TR'),
            labelFill: urgencyMeta.xlBg,
            valueFill: urgencyMeta.xlBg,
            valueBold: true,
            valueColor: urgencyMeta.xlText,
            valueSize: 13,
        },
        { label: 'Toplam Kalem / Toplam Adet', value: `${(order.items || []).length} kalem  ·  ${totalQty} adet`, labelFill: 'FFDCFCE7', valueFill: 'FFFFFFFF' },
    ];
    if (noteText) {
        infoRows.push({
            label: 'Açıklama',
            value: noteText,
            labelFill: 'FFF1F5F9',
            valueFill: 'FFFFFFFF',
        });
    }
    infoRows.forEach((info, idx) => {
        var _a, _b, _c;
        const rowIdx = idx + 2; // start at row 2
        const row = sheet.getRow(rowIdx);
        row.height = info.label === 'Açıklama' ? 36 : 20;
        const labelCell = row.getCell(1);
        labelCell.value = info.label;
        labelCell.font = { bold: true, color: { argb: 'FF0F172A' } };
        labelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: info.labelFill } };
        labelCell.border = THIN_BORDER;
        sheet.mergeCells(rowIdx, 2, rowIdx, 7);
        const valueCell = row.getCell(2);
        valueCell.value = info.value;
        valueCell.font = {
            size: (_a = info.valueSize) !== null && _a !== void 0 ? _a : 11,
            bold: (_b = info.valueBold) !== null && _b !== void 0 ? _b : false,
            color: { argb: (_c = info.valueColor) !== null && _c !== void 0 ? _c : 'FF0F172A' },
        };
        valueCell.alignment = {
            vertical: 'middle',
            horizontal: 'left',
            indent: 1,
            wrapText: info.label === 'Açıklama',
        };
        valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: info.valueFill } };
        valueCell.border = THIN_BORDER;
    });
    // --- Header row sits right after info rows ---
    const HEADER_ROW = 2 + infoRows.length;
    sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW }];
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
        const info = itemInfoMap === null || itemInfoMap === void 0 ? void 0 : itemInfoMap.get(sKodu);
        const anaBirim = ((info === null || info === void 0 ? void 0 : info.anaBirim) || '').trim();
        const ambalaj = info === null || info === void 0 ? void 0 : info.ambalajDegeri;
        const talepCellValue = typeof ambalaj === 'number' && ambalaj > 0
            ? `${talep}${anaBirim ? ` ${anaBirim}` : ''} (${talep * ambalaj} adet)`
            : (anaBirim ? `${talep} ${anaBirim}` : talep);
        const row = sheet.getRow(HEADER_ROW + 1 + idx);
        row.height = 30;
        const values = [
            idx + 1,
            sKodu,
            item.stokAdi || '-',
            labStok,
            maxAdet,
            yakinMiad,
            talepCellValue,
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
    var _a, _b, _c;
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
        urgency: (_c = order === null || order === void 0 ? void 0 : order.urgency) !== null && _c !== void 0 ? _c : null,
        hasNote: !!((order === null || order === void 0 ? void 0 : order.note) && order.note.trim().length > 0),
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
        const orderItems = Array.isArray(order.items) ? order.items : [];
        if (orderItems.length === 0) {
            logEntry.status = 'skipped';
            logEntry.error = 'Siparişte kalem yok.';
            steps.push('Kalem kontrolü: ATLANDI - sipariş boş');
            await db.collection('emailNotificationLogs').add(logEntry);
            return;
        }
        const [itemInfoMap, labGroupNamesById, users] = await Promise.all([
            (0, peripheralRecipients_1.buildItemInfoMap)(orderItems),
            (0, peripheralRecipients_1.loadLabGroupNamesByDocId)(),
            (0, peripheralRecipients_1.loadLojistikUsers)(),
        ]);
        const itemGroupMap = (0, peripheralRecipients_1.groupMapFromInfo)(itemInfoMap);
        steps.push(`Grup/kullanıcı yüklemesi: OK (kalem grup eşlemesi=${itemGroupMap.size}, def_labGroups=${labGroupNamesById.size}, lojistik kullanıcı=${users.length})`);
        logEntry.orderGroups = Array.from(new Set(Array.from(itemGroupMap.values())));
        // Build per-user filtered recipient list
        const recipients = users.map((user) => {
            const groupNames = (0, peripheralRecipients_1.resolveUserGroupNames)(user, labGroupNamesById);
            const filtered = (0, peripheralRecipients_1.filterItemsForUserGroups)(orderItems, itemGroupMap, groupNames);
            return { user, groupNames, filtered };
        });
        const sendable = recipients.filter((r) => r.user.email && r.filtered.length > 0);
        logEntry.recipients = sendable.map((r) => r.user.email);
        if (sendable.length === 0) {
            logEntry.status = 'skipped';
            logEntry.error = 'Eşleşen grup/kalem yok ya da hiçbir alıcının e-postası tanımlı değil.';
            steps.push('Alıcı sorgusu: BAŞARISIZ - eşleşen lojistik sorumlusu yok');
            await db.collection('emailNotificationLogs').add(logEntry);
            firebase_functions_1.logger.warn(`[peripheralOrderEmail] No matching lojistik_sorumlusu recipients for order ${orderId}.`);
            return;
        }
        steps.push(`Alıcı sorgusu: OK (${sendable.length} alıcı eşleşti)`);
        const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
        const labName = order.kurumAdi || 'Bilinmeyen Laboratuvar';
        const urgencyKey = (order.urgency && URGENCY_META[order.urgency] ? order.urgency : 'normal');
        const urgencyMeta = URGENCY_META[urgencyKey];
        const noteText = (order.note || '').trim();
        const subjectPrefix = urgencyKey === 'cok_acil' ? '[ÇOK ACİL] ' :
            urgencyKey === 'acil' ? '[ACİL] ' : '';
        const noteHtml = noteText
            ? `<tr><td style="padding:6px 12px; background:#f1f5f9; border:1px solid #94a3b8; vertical-align:top;"><b>Açıklama</b></td><td style="padding:6px 12px; border:1px solid #94a3b8; white-space:pre-wrap;">${noteText.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c))}</td></tr>`
            : '';
        const perUserResults = [];
        logEntry.perUserResults = perUserResults;
        let sentCount = 0;
        for (const r of sendable) {
            const filtered = r.filtered;
            const filteredOrder = Object.assign(Object.assign({}, order), { items: filtered });
            const filteredItemCount = filtered.length;
            const filteredTotalQty = filtered.reduce((sum, item) => sum + Number(item.adet || 0), 0);
            const groupsForUser = Array.from(r.groupNames);
            const groupsLine = groupsForUser.length ? groupsForUser.join(', ') : '-';
            let excelBuffer;
            try {
                excelBuffer = await buildExcelBuffer(orderId, filteredOrder, itemInfoMap);
            }
            catch (excelErr) {
                perUserResults.push({
                    uid: r.user.uid,
                    email: r.user.email,
                    matchedItemCount: filteredItemCount,
                    success: false,
                    error: `Excel hata: ${(excelErr === null || excelErr === void 0 ? void 0 : excelErr.message) || excelErr}`,
                });
                steps.push(`${r.user.email}: Excel HATA - ${(excelErr === null || excelErr === void 0 ? void 0 : excelErr.message) || excelErr}`);
                continue;
            }
            try {
                await transporter.sendMail({
                    from: senderEmail,
                    to: r.user.email,
                    subject: `${subjectPrefix}[Perifer Talep] ${labName} — ${filteredTotalQty} adet (${urgencyMeta.label})`,
                    text: `Perifer laboratuvardan yeni sipariş talebi açıldı.\n` +
                        `Aciliyet: ${urgencyMeta.label}\n` +
                        `Sipariş ID: ${orderId}\n` +
                        `Laboratuvar: ${labName}\n` +
                        `Talep Eden: ${order.createdBy || '-'}\n` +
                        `Atanan Grup(lar): ${groupsLine}\n` +
                        `Kalem Sayısı: ${filteredItemCount}\n` +
                        `Toplam Adet: ${filteredTotalQty}\n` +
                        (noteText ? `Açıklama: ${noteText}\n` : '') +
                        `\nDetaylar ekteki Excel dosyasındadır.`,
                    html: `
              <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color:#0f172a;">
                <h2 style="margin:0 0 8px 0; color:#1e293b;">Perifer Laboratuvar Ürün Talebi</h2>
                <div style="display:inline-block; margin:0 0 14px 0; padding:6px 14px; border-radius:999px; background:${urgencyMeta.emailBg}; color:${urgencyMeta.emailText}; border:2px solid ${urgencyMeta.emailBadgeBorder}; font-weight:bold; font-size:13px; letter-spacing:0.5px;">
                  ACİLİYET: ${urgencyMeta.label.toLocaleUpperCase('tr-TR')}
                </div>
                <p style="margin:0 0 12px 0;">Aşağıdaki perifer laboratuvardan size atanan grup(lar)a ait yeni bir ürün talebi açıldı:</p>
                <table style="border-collapse:collapse; font-size:14px;">
                  <tr><td style="padding:6px 12px; background:#e0f2fe; border:1px solid #94a3b8;"><b>Sipariş ID</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${orderId}</td></tr>
                  <tr><td style="padding:6px 12px; background:#e0e7ff; border:1px solid #94a3b8;"><b>Laboratuvar</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${labName}</td></tr>
                  <tr><td style="padding:6px 12px; background:#fef3c7; border:1px solid #94a3b8;"><b>Talep Eden</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${order.createdBy || '-'}</td></tr>
                  <tr><td style="padding:6px 12px; background:#ccfbf1; border:1px solid #94a3b8;"><b>Atanan Grup(lar)</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${groupsLine}</td></tr>
                  <tr><td style="padding:6px 12px; background:${urgencyMeta.emailBg}; border:1px solid #94a3b8;"><b>Aciliyet</b></td><td style="padding:6px 12px; border:1px solid #94a3b8; color:${urgencyMeta.emailText}; font-weight:bold;">${urgencyMeta.label}</td></tr>
                  <tr><td style="padding:6px 12px; background:#fee2e2; border:1px solid #94a3b8;"><b>Kalem Sayısı</b></td><td style="padding:6px 12px; border:1px solid #94a3b8;">${filteredItemCount}</td></tr>
                  <tr><td style="padding:6px 12px; background:#dcfce7; border:1px solid #94a3b8;"><b>Toplam Adet</b></td><td style="padding:6px 12px; border:1px solid #94a3b8; font-weight:bold; font-size:16px;">${filteredTotalQty}</td></tr>
                  ${noteHtml}
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
                sentCount += 1;
                perUserResults.push({
                    uid: r.user.uid,
                    email: r.user.email,
                    groups: groupsForUser,
                    matchedItemCount: filteredItemCount,
                    success: true,
                });
                steps.push(`${r.user.email}: OK (${filteredItemCount} kalem, ${groupsLine})`);
            }
            catch (sendErr) {
                perUserResults.push({
                    uid: r.user.uid,
                    email: r.user.email,
                    groups: groupsForUser,
                    matchedItemCount: filteredItemCount,
                    success: false,
                    error: (sendErr === null || sendErr === void 0 ? void 0 : sendErr.message) || String(sendErr),
                });
                steps.push(`${r.user.email}: BAŞARISIZ - ${(sendErr === null || sendErr === void 0 ? void 0 : sendErr.message) || sendErr}`);
            }
        }
        logEntry.status = sentCount > 0 ? 'sent' : 'failed';
        logEntry.sentCount = sentCount;
        await db.collection('emailNotificationLogs').add(logEntry);
        firebase_functions_1.logger.info(`[peripheralOrderEmail] Sent order ${orderId} email to ${sentCount}/${sendable.length} recipients.`);
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