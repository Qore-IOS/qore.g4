import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as nodemailer from 'nodemailer';
import * as exceljs from 'exceljs';

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

async function buildExcelBuffer(orderId: string, order: OrderDoc): Promise<Buffer> {
  const labId = order.labId;
  
  // 1. Fetch minMaxRules
  const rulesMap: Record<string, number> = {};
  if (labId) {
    try {
      const rulesSnap = await db.collection('hospitals').doc(labId).collection('minMaxRules').get();
      rulesSnap.forEach(doc => {
        const data = doc.data();
        if (data.stokKodu && data.max !== undefined) {
          rulesMap[data.stokKodu] = Number(data.max);
        }
      });
    } catch (err) {
      logger.error(`Error fetching minMaxRules for lab ${labId}:`, err);
    }
  }

  // 2. Fetch depoStok for lab stock and closest miad
  const labStokMap: Record<string, number> = {};
  const closestMiadLotMap: Record<string, number> = {};
  
  if (labId) {
    try {
      // isShipped == true and hedefKurumId == labId gives the lab's current stock based on QR codes
      const depoStokSnap = await db.collection('depoStok')
        .where('isShipped', '==', true)
        .where('hedefKurumId', '==', labId)
        .get();
      
      const items = depoStokSnap.docs.map(d => d.data());
      const groupedByStok: Record<string, any[]> = {};
      
      items.forEach(item => {
        if (!item.stokKodu) return;
        if (!groupedByStok[item.stokKodu]) groupedByStok[item.stokKodu] = [];
        groupedByStok[item.stokKodu].push(item);
      });
      
      for (const [stokKodu, groupItems] of Object.entries(groupedByStok)) {
        labStokMap[stokKodu] = groupItems.length; // Count of items = Lab Stok
        
        const itemsWithMiad = groupItems.filter(i => i.miad);
        if (itemsWithMiad.length > 0) {
          // Find the earliest miad
          itemsWithMiad.sort((a, b) => {
            const miadA = a.miad?.toDate ? a.miad.toDate().getTime() : new Date(a.miad).getTime();
            const miadB = b.miad?.toDate ? b.miad.toDate().getTime() : new Date(b.miad).getTime();
            return miadA - miadB;
          });
          
          const earliestTime = itemsWithMiad[0].miad?.toDate ? itemsWithMiad[0].miad.toDate().getTime() : new Date(itemsWithMiad[0].miad).getTime();
          
          // Count items that have this exact earliest miad
          const count = itemsWithMiad.filter(i => {
            const time = i.miad?.toDate ? i.miad.toDate().getTime() : new Date(i.miad).getTime();
            return time === earliestTime;
          }).length;
          
          closestMiadLotMap[stokKodu] = count;
        } else {
          closestMiadLotMap[stokKodu] = 0;
        }
      }
    } catch (err) {
      logger.error(`Error fetching depoStok for lab ${labId}:`, err);
    }
  }

  // 3. Create Excel
  const workbook = new exceljs.Workbook();
  const sheet = workbook.addWorksheet('Siparis', { views: [{ state: 'frozen', ySplit: 7 }] });

  // Top Info
  const createdAtText = order.createdAt?.toDate?.() ? order.createdAt.toDate().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
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
  const borderStyle: Partial<exceljs.Borders> = {
    top: { style: 'thin' }, left: { style: 'thin' },
    bottom: { style: 'thin' }, right: { style: 'thin' }
  };

  (order.items || []).forEach((item, idx) => {
    const sKodu = item.stokKodu || '-';
    const labStok = labStokMap[sKodu] ?? 0;
    const maxAdet = rulesMap[sKodu] ?? 0;
    const yakinMiad = closestMiadLotMap[sKodu] ?? 0;
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
    let maxLength = 0;
    column.eachCell?.({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber > 5) { // Skip the top info rows for width calculation
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) maxLength = columnLength;
      }
    });
    // Add some padding and set min/max width
    column.width = Math.min(Math.max(maxLength + 2, 10), 60);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as Buffer;
}

export const onPeripheralOrderCreatedSendMail = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 60, memory: '512MB' }) // Increased memory slightly for excel generation
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
      logger.info(`[peripheralOrderEmail] Sent order ${orderId} email to ${emails.length} recipients.`);
    } catch (error: any) {
      logEntry.status = 'failed';
      logEntry.error = error?.message || String(error);
      await db.collection('emailNotificationLogs').add(logEntry);
      logger.error(`[peripheralOrderEmail] Failed for order ${orderId}:`, error);
    }
  });
