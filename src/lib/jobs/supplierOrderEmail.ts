import {adminDb,FieldValue,Timestamp} from '../data/admin';
import {resolveStorageBucket} from '@/lib/server/storage-bucket';
import * as functions from '@/lib/jobs/runtime';
import { logger } from '@/lib/jobs/runtime';
import * as nodemailer from 'nodemailer';
import * as exceljs from 'exceljs';


const db = adminDb;

type SupplierOrderItem = {
  stokKodu?: string;
  stokAdi?: string;
  anaDepoStok?: number;
  gerekliAdet?: number;
  siparisAdedi?: number;
};

type SupplierOrderDoc = {
  markaId?: string;
  markaAdi?: string;
  markaMail?: string;
  donem?: string;
  yeterlilikGun?: number;
  anaDepoAdi?: string;
  items?: SupplierOrderItem[];
  toplamKalem?: number;
  toplamAdet?: number;
  createdBy?: string;
  createdAt?: Timestamp;
};

const THIN_BORDER: Partial<exceljs.Borders> = {
  top: { style: 'thin', color: { argb: 'FF94A3B8' } },
  left: { style: 'thin', color: { argb: 'FF94A3B8' } },
  bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
  right: { style: 'thin', color: { argb: 'FF94A3B8' } },
};

const COLUMN_PALETTE: Array<{ header: string; body: string; text: string }> = [
  { header: 'FF334155', body: 'FFF1F5F9', text: 'FF0F172A' }, // #
  { header: 'FF0EA5E9', body: 'FFE0F2FE', text: 'FF0C4A6E' }, // Stok Kodu
  { header: 'FF6366F1', body: 'FFE0E7FF', text: 'FF312E81' }, // Stok Adı
  { header: 'FF14B8A6', body: 'FFCCFBF1', text: 'FF134E4A' }, // Ana Depo Stok
  { header: 'FFF59E0B', body: 'FFFEF3C7', text: 'FF78350F' }, // Gerekli Adet
  { header: 'FF16A34A', body: 'FFDCFCE7', text: 'FF14532D' }, // Sipariş Adedi
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
}

function getTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    logger.warn('[supplierOrderEmail] SMTP config missing. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
    return null;
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
}

async function buildExcelBuffer(orderId: string, order: SupplierOrderDoc): Promise<Buffer> {
  const workbook = new exceljs.Workbook();
  workbook.creator = 'INV-zen';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Tedarikçi Sipariş', { properties: { defaultRowHeight: 18 } });

  const createdAtText = order.createdAt?.toDate?.()
    ? order.createdAt.toDate().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
    : new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const items = Array.isArray(order.items) ? order.items : [];
  const totalQty = items.reduce((s, it) => s + Number(it.siparisAdedi || 0), 0);

  sheet.mergeCells('A1:F1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'TEDARİKÇİ SİPARİŞ';
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  sheet.getRow(1).height = 28;

  const infoRows: Array<{ label: string; value: string; fill: string }> = [
    { label: 'Marka', value: order.markaAdi || '-', fill: 'FFE0E7FF' },
    { label: 'Dönem', value: order.donem || '-', fill: 'FFE0F2FE' },
    { label: 'Ana Depo', value: order.anaDepoAdi || '-', fill: 'FFCCFBF1' },
    { label: 'Yeterlilik Gün', value: String(order.yeterlilikGun ?? '-'), fill: 'FFFEF3C7' },
    { label: 'Oluşturan', value: order.createdBy || '-', fill: 'FFFEE2E2' },
    { label: 'Tarih', value: createdAtText, fill: 'FFF1F5F9' },
    { label: 'Toplam Kalem / Adet', value: `${items.length} kalem  ·  ${totalQty} adet`, fill: 'FFDCFCE7' },
  ];

  infoRows.forEach((info, idx) => {
    const rowIdx = idx + 2;
    const row = sheet.getRow(rowIdx);
    row.height = 20;
    const labelCell = row.getCell(1);
    labelCell.value = info.label;
    labelCell.font = { bold: true, color: { argb: 'FF0F172A' } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: info.fill } };
    labelCell.border = THIN_BORDER;
    sheet.mergeCells(rowIdx, 2, rowIdx, 6);
    const valueCell = row.getCell(2);
    valueCell.value = info.value;
    valueCell.font = { size: 11, color: { argb: 'FF0F172A' } };
    valueCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    valueCell.border = THIN_BORDER;
  });

  const HEADER_ROW = 2 + infoRows.length;
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW }];
  const headers = ['#', 'Stok Kodu', 'Stok Adı', 'Ana Depo Stok', 'Gerekli Adet', 'Sipariş Adedi'];
  const headerRow = sheet.getRow(HEADER_ROW);
  headerRow.height = 28;
  headers.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLUMN_PALETTE[i].header } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });

  items.forEach((item, idx) => {
    const row = sheet.getRow(HEADER_ROW + 1 + idx);
    row.height = 24;
    const values: Array<string | number> = [
      idx + 1,
      item.stokKodu || '-',
      item.stokAdi || '-',
      Number(item.anaDepoStok || 0),
      Number(item.gerekliAdet || 0),
      Number(item.siparisAdedi || 0),
    ];
    values.forEach((value, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = value;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLUMN_PALETTE[colIdx].body } };
      cell.border = THIN_BORDER;
      cell.alignment = { vertical: 'middle', horizontal: colIdx === 2 ? 'left' : 'center', indent: colIdx === 2 ? 1 : 0 };
      if (colIdx === 5) {
        cell.font = { bold: true, size: 14, color: { argb: COLUMN_PALETTE[5].text } };
      } else {
        cell.font = { size: 11, color: { argb: COLUMN_PALETTE[colIdx].text } };
      }
    });
  });

  const widths = [6, 18, 44, 16, 16, 16];
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as unknown as Buffer;
}

export const onSupplierOrderCreatedSendMail = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .firestore.document('supplierOrders/{orderId}')
  .onCreate(async (snap, context) => {
    const orderId = context.params.orderId as string;
    const order = snap.data() as SupplierOrderDoc;

    const setMailStatus = async (status: 'sent' | 'failed' | 'skipped', extra: Record<string, unknown> = {}) => {
      try {
        await snap.ref.set({ mailStatus: status, mailStatusAt: FieldValue.serverTimestamp(), ...extra }, { merge: true });
      } catch (e) {
        logger.error('[supplierOrderEmail] Could not update mailStatus:', e);
      }
    };

    // Resolve recipient e-mail: prefer the value stored on the order, fall back
    // to the current def_brands definition.
    let recipient = String(order.markaMail || '').trim();
    if (!recipient && order.markaId) {
      try {
        const brandSnap = await db.collection('def_brands').doc(order.markaId).get();
        recipient = String(brandSnap.data()?.mail || '').trim();
      } catch (e) {
        logger.warn(`[supplierOrderEmail] Could not read brand ${order.markaId}:`, e);
      }
    }

    if (!recipient) {
      logger.warn(`[supplierOrderEmail] No brand e-mail for order ${orderId}. Skipping.`);
      await setMailStatus('skipped', { mailError: 'Markanın mail adresi tanımlı değil.' });
      return;
    }

    const items = Array.isArray(order.items) ? order.items : [];
    if (items.length === 0) {
      await setMailStatus('skipped', { mailError: 'Siparişte kalem yok.' });
      return;
    }

    const transporter = getTransporter();
    if (!transporter) {
      await setMailStatus('failed', { mailError: 'SMTP yapılandırması eksik.' });
      return;
    }

    try {
      const excelBuffer = await buildExcelBuffer(orderId, order);
      const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
      const totalQty = items.reduce((s, it) => s + Number(it.siparisAdedi || 0), 0);
      const markaAdi = order.markaAdi || 'Marka';

      const rowsHtml = items
        .map(
          (it, i) => `
            <tr>
              <td style="padding:4px 8px; border:1px solid #cbd5e1; text-align:center;">${i + 1}</td>
              <td style="padding:4px 8px; border:1px solid #cbd5e1;">${escapeHtml(it.stokKodu || '-')}</td>
              <td style="padding:4px 8px; border:1px solid #cbd5e1;">${escapeHtml(it.stokAdi || '-')}</td>
              <td style="padding:4px 8px; border:1px solid #cbd5e1; text-align:center;">${Number(it.anaDepoStok || 0)}</td>
              <td style="padding:4px 8px; border:1px solid #cbd5e1; text-align:center;">${Number(it.gerekliAdet || 0)}</td>
              <td style="padding:4px 8px; border:1px solid #cbd5e1; text-align:center; font-weight:bold;">${Number(it.siparisAdedi || 0)}</td>
            </tr>`,
        )
        .join('');

      await transporter.sendMail({
        from: senderEmail,
        to: recipient,
        subject: `[Sipariş] ${markaAdi} — ${totalQty} adet (${order.donem || ''})`,
        text:
          `${markaAdi} için yeni sipariş.\n` +
          `Dönem: ${order.donem || '-'}\n` +
          `Kalem: ${items.length}\n` +
          `Toplam Adet: ${totalQty}\n\n` +
          `Sipariş detayları ekteki Excel dosyasındadır.`,
        html: `
          <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif; color:#0f172a;">
            <h2 style="margin:0 0 8px 0; color:#1e293b;">Yeni Sipariş — ${escapeHtml(markaAdi)}</h2>
            <p style="margin:0 0 12px 0;">Aşağıdaki ürünler için sipariş talebimizi iletiyoruz.</p>
            <table style="border-collapse:collapse; font-size:13px; margin-bottom:12px;">
              <tr><td style="padding:4px 10px; background:#e0e7ff; border:1px solid #94a3b8;"><b>Dönem</b></td><td style="padding:4px 10px; border:1px solid #94a3b8;">${escapeHtml(order.donem || '-')}</td></tr>
              <tr><td style="padding:4px 10px; background:#dcfce7; border:1px solid #94a3b8;"><b>Toplam Adet</b></td><td style="padding:4px 10px; border:1px solid #94a3b8; font-weight:bold;">${totalQty}</td></tr>
            </table>
            <table style="border-collapse:collapse; font-size:12px;">
              <thead>
                <tr style="background:#1e293b; color:#fff;">
                  <th style="padding:6px 8px; border:1px solid #cbd5e1;">#</th>
                  <th style="padding:6px 8px; border:1px solid #cbd5e1;">Stok Kodu</th>
                  <th style="padding:6px 8px; border:1px solid #cbd5e1;">Stok Adı</th>
                  <th style="padding:6px 8px; border:1px solid #cbd5e1;">Ana Depo Stok</th>
                  <th style="padding:6px 8px; border:1px solid #cbd5e1;">Gerekli Adet</th>
                  <th style="padding:6px 8px; border:1px solid #cbd5e1;">Sipariş Adedi</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <p style="margin:14px 0 0 0; font-size:12px; color:#64748b;">Detaylar ekteki Excel dosyasındadır.</p>
          </div>`,
        attachments: [
          {
            filename: `tedarikci_siparis_${orderId}.xlsx`,
            content: excelBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ],
      });

      logger.info(`[supplierOrderEmail] Sent order ${orderId} to ${recipient}.`);
      await setMailStatus('sent', { mailTo: recipient });
    } catch (error: any) {
      logger.error(`[supplierOrderEmail] Failed for order ${orderId}:`, error);
      await setMailStatus('failed', { mailError: error?.message || String(error) });
    }
  });
