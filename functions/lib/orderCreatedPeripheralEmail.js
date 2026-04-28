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
function esc(v) {
    return String(v !== null && v !== void 0 ? v : '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function buildExcelXml(orderId, order) {
    var _a, _b;
    const createdAt = ((_b = (_a = order.createdAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) || new Date();
    const createdAtText = createdAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const labName = order.kurumAdi || '-';
    const labId = order.labId || '-';
    const createdBy = order.createdBy || '-';
    const rows = (order.items || []).map((item, idx) => `
      <Row>
        <Cell><Data ss:Type="Number">${idx + 1}</Data></Cell>
        <Cell><Data ss:Type="String">${esc(item.stokKodu || '-')}</Data></Cell>
        <Cell><Data ss:Type="String">${esc(item.stokAdi || '-')}</Data></Cell>
        <Cell><Data ss:Type="Number">${Number(item.adet || 0)}</Data></Cell>
      </Row>`).join('');
    return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <Worksheet ss:Name="Siparis">
    <Table>
      <Row><Cell><Data ss:Type="String">Sipariş ID</Data></Cell><Cell><Data ss:Type="String">${esc(orderId)}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Laboratuvar</Data></Cell><Cell><Data ss:Type="String">${esc(labName)}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Laboratuvar ID</Data></Cell><Cell><Data ss:Type="String">${esc(labId)}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Oluşturan</Data></Cell><Cell><Data ss:Type="String">${esc(createdBy)}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Tarih</Data></Cell><Cell><Data ss:Type="String">${esc(createdAtText)}</Data></Cell></Row>
      <Row></Row>
      <Row>
        <Cell><Data ss:Type="String">#</Data></Cell>
        <Cell><Data ss:Type="String">Stok Kodu</Data></Cell>
        <Cell><Data ss:Type="String">Stok Adı</Data></Cell>
        <Cell><Data ss:Type="String">Adet</Data></Cell>
      </Row>${rows}
    </Table>
  </Worksheet>
</Workbook>`;
}
exports.onPeripheralOrderCreatedSendMail = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
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
        const xmlContent = buildExcelXml(orderId, order);
        const attachment = Buffer.from(xmlContent, 'utf-8');
        await transporter.sendMail({
            from: senderEmail,
            to: emails.join(','),
            subject: `[Perifer Talep] Yeni Sipariş - ${labName}`,
            text: `Perifer laboratuvardan yeni sipariş talebi açıldı.\nSipariş ID: ${orderId}\nLaboratuvar: ${labName}\nKalem: ${itemsCount}\nToplam Adet: ${totalQty}`,
            html: `<p>Perifer laboratuvardan yeni sipariş talebi açıldı.</p>
               <ul>
                 <li><b>Sipariş ID:</b> ${esc(orderId)}</li>
                 <li><b>Laboratuvar:</b> ${esc(labName)}</li>
                 <li><b>Kalem Sayısı:</b> ${itemsCount}</li>
                 <li><b>Toplam Adet:</b> ${totalQty}</li>
               </ul>
               <p>Sipariş detayları Excel dosyasında ektedir.</p>`,
            attachments: [
                {
                    filename: `perifer_siparis_${orderId}.xls`,
                    content: attachment,
                    contentType: 'application/vnd.ms-excel',
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