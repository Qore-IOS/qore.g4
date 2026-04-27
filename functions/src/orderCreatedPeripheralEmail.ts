import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as nodemailer from 'nodemailer';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type OrderItem = {
  stokKodu?: string;
  stokAdi?: string;
  adet?: number;
};

type OrderDoc = {
  id?: string;
  labId?: string;
  kurumAdi?: string;
  items?: OrderItem[];
  createdAt?: admin.firestore.Timestamp;
  createdBy?: string;
  createdById?: string;
  requestSource?: string;
  isPeripheral?: boolean;
};

function getTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    logger.warn('[peripheralOrderEmail] SMTP config missing. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
    return null;
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildExcelXml(orderId: string, order: OrderDoc): string {
  const createdAt = order.createdAt?.toDate?.() || new Date();
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

export const onPeripheralOrderCreatedSendMail = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .firestore.document('orders/{orderId}')
  .onCreate(async (snap, context) => {
    const orderId = context.params.orderId as string;
    const order = snap.data() as OrderDoc;

    const isPeripheralRequest = order?.isPeripheral === true || order?.requestSource === 'lab_to_office';
    if (!isPeripheralRequest) {
      return;
    }

    const logEntry: Record<string, unknown> = {
      type: 'peripheral_order_email',
      orderId,
      status: 'processing',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      recipients: [] as string[],
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
        .map((d) => (d.data()?.email || '').trim())
        .filter((email: string) => !!email);

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
      logger.info(`[peripheralOrderEmail] Sent order ${orderId} email to ${emails.length} recipients.`);
    } catch (error: any) {
      logEntry.status = 'failed';
      logEntry.error = error?.message || String(error);
      await db.collection('emailNotificationLogs').add(logEntry);
      logger.error(`[peripheralOrderEmail] Failed for order ${orderId}:`, error);
    }
  });
