import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import * as nodemailer from 'nodemailer';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { sendWhatsAppDocument, sendWhatsAppText } from '../lib/whatsapp';
import type { ShortcutResult } from './handlers';

const db = admin.firestore();

export type ShortcutDeliveryChannel = 'inApp' | 'email' | 'whatsapp' | 'pdf' | 'excel';

export type ShortcutDeliveryShortcut = {
  id?: string;
  companyId?: string;
  createdByUid?: string;
  createdByName?: string;
  panelKey?: string;
  actionKey?: string;
  deliveryChannels?: string[];
  recipients?: string[];
  params?: Record<string, unknown>;
};

type GeneratedAttachment = {
  name: string;
  contentType: string;
  buffer: Buffer;
  storagePath: string;
  publicUrl: string;
  sizeBytes: number;
};

type DeliveryAttempt = {
  channel: ShortcutDeliveryChannel;
  status: 'sent' | 'skipped' | 'failed';
  message: string;
  recipients?: string[];
  attachmentNames?: string[];
  meta?: Record<string, unknown>;
};

const CHANNELS = new Set<ShortcutDeliveryChannel>(['inApp', 'email', 'whatsapp', 'pdf', 'excel']);

function normalizeChannels(value: unknown): ShortcutDeliveryChannel[] {
  const raw = Array.isArray(value) ? value : [];
  const channels = raw
    .map((channel) => String(channel).trim())
    .map((channel) => channel === 'app' ? 'inApp' : channel)
    .filter((channel): channel is ShortcutDeliveryChannel => CHANNELS.has(channel as ShortcutDeliveryChannel));
  return Array.from(new Set(channels.length ? channels : ['inApp']));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function normalizePhoneForWhatsApp(value: unknown): string | null {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  const withCountryCode = digits.length === 10 ? `90${digits}` : digits.startsWith('0') && digits.length === 11 ? `9${digits}` : digits;
  return withCountryCode.length >= 11 ? `${withCountryCode}@c.us` : null;
}

async function recipientList(shortcut: ShortcutDeliveryShortcut): Promise<string[]> {
  const recipients = [
    ...stringArray(shortcut.recipients),
    ...stringArray(shortcut.params?.alicilar),
  ];

  if (shortcut.createdByUid) {
    const userSnap = await db.collection('users').doc(shortcut.createdByUid).get();
    const user = userSnap.exists ? userSnap.data() || {} : {};
    if (typeof user.email === 'string' && user.email.trim()) recipients.push(user.email.trim());
    const whatsappRecipient = normalizePhoneForWhatsApp(user.phoneNumber);
    if (whatsappRecipient) recipients.push(whatsappRecipient);
  }

  return Array.from(new Set(recipients));
}

function whatsappRecipients(recipients: string[]): string[] {
  return recipients.filter((recipient) => recipient.endsWith('@c.us') || recipient.endsWith('@g.us'));
}

function emailRecipients(recipients: string[]): string[] {
  return recipients.filter((recipient) => recipient.includes('@') && !whatsappRecipients([recipient]).length);
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function buildShortcutDeliverySummary(result: ShortcutResult, shortcut: ShortcutDeliveryShortcut): string {
  const parts = [result.summaryText || 'Shortcut çalışması tamamlandı.'];
  const metrics = result.metrics || {};
  if (typeof metrics.rowCount !== 'undefined') parts.push(`Satır sayısı: ${metrics.rowCount}.`);
  if (result.warnings?.length) parts.push(`Uyarı: ${result.warnings.join(' | ')}`);
  if (result.deepLink) parts.push(`Detay: ${result.deepLink}`);
  if (shortcut.actionKey) parts.push(`Aksiyon: ${shortcut.actionKey}.`);
  return parts.join('\n');
}

function buildPdf(result: ShortcutResult, summary: string, runId: string): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(16);
  doc.text('Shortcut Run Ozeti', 40, 45);
  doc.setFontSize(10);
  doc.text(`Run ID: ${runId}`, 40, 65);
  doc.setFontSize(11);
  const lines = doc.splitTextToSize(summary, 515);
  doc.text(lines, 40, 95);

  const rows = result.rows || [];
  if (rows.length) {
    const columns = Array.from(rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()));
    autoTable(doc, {
      startY: 125 + lines.length * 12,
      head: [columns],
      body: rows.slice(0, 500).map((row) => columns.map((column) => textValue(row[column]))),
      styles: { fontSize: 8, overflow: 'linebreak' },
      headStyles: { fillColor: [199, 137, 65] },
    });
  }

  return Buffer.from(doc.output('arraybuffer'));
}

async function buildExcel(result: ShortcutResult, summary: string, runId: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QORE Shortcut Delivery';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Ozet');
  summarySheet.addRows([
    ['Run ID', runId],
    ['Ozet', summary],
    ['Durum', result.status || 'success'],
  ]);
  Object.entries(result.metrics || {}).forEach(([key, value]) => summarySheet.addRow([key, textValue(value)]));
  summarySheet.columns = [{ width: 24 }, { width: 90 }];

  const rows = result.rows || [];
  if (rows.length) {
    const dataSheet = workbook.addWorksheet('Veri');
    const columns = Array.from(rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()));
    dataSheet.columns = columns.map((key) => ({ header: key, key, width: 24 }));
    rows.forEach((row) => dataSheet.addRow(row));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function uploadAttachment(buffer: Buffer, storagePath: string, contentType: string): Promise<string> {
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    contentType,
    metadata: { cacheControl: 'public, max-age=3600' },
  });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
}

async function ensureGeneratedAttachments(args: {
  channels: ShortcutDeliveryChannel[];
  result: ShortcutResult;
  summary: string;
  shortcut: ShortcutDeliveryShortcut;
  runId: string;
}): Promise<GeneratedAttachment[]> {
  const needsPdf = args.channels.some((channel) => ['pdf', 'email', 'whatsapp'].includes(channel));
  const needsExcel = args.channels.some((channel) => ['excel', 'email'].includes(channel));
  const attachments: GeneratedAttachment[] = [];
  const basePath = `shortcutReports/${args.shortcut.companyId || 'global'}/${args.runId}`;
  const baseName = `${args.shortcut.actionKey || 'shortcut'}_${args.runId}`.replace(/[^a-zA-Z0-9_.-]/g, '_');

  if (needsPdf) {
    const buffer = buildPdf(args.result, args.summary, args.runId);
    const storagePath = `${basePath}/${baseName}.pdf`;
    attachments.push({
      name: `${baseName}.pdf`,
      contentType: 'application/pdf',
      buffer,
      storagePath,
      publicUrl: await uploadAttachment(buffer, storagePath, 'application/pdf'),
      sizeBytes: buffer.length,
    });
  }

  if (needsExcel) {
    const buffer = await buildExcel(args.result, args.summary, args.runId);
    const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const storagePath = `${basePath}/${baseName}.xlsx`;
    attachments.push({
      name: `${baseName}.xlsx`,
      contentType,
      buffer,
      storagePath,
      publicUrl: await uploadAttachment(buffer, storagePath, contentType),
      sizeBytes: buffer.length,
    });
  }

  return attachments;
}

function getTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpHost || !smtpUser || !smtpPass) return null;
  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
}

async function logDelivery(runRef: FirebaseFirestore.DocumentReference, attempt: DeliveryAttempt) {
  await db.collection('shortcutRunLogs').add({
    runId: runRef.id,
    level: attempt.status === 'failed' ? 'error' : attempt.status === 'skipped' ? 'warn' : 'info',
    message: `Delivery ${attempt.channel}: ${attempt.message}`,
    meta: attempt,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function sendInApp(shortcut: ShortcutDeliveryShortcut, runId: string, summary: string, result: ShortcutResult): Promise<DeliveryAttempt> {
  const targets = shortcut.createdByUid ? [`user:${shortcut.createdByUid}`] : [];
  await db.collection('notifications').add({
    type: 'custom',
    title: 'Shortcut raporu hazır',
    message: summary,
    href: result.deepLink || `/shortcut-runs/${runId}`,
    createdAt: FieldValue.serverTimestamp(),
    targets,
    actor: { uid: shortcut.createdByUid || 'system', name: shortcut.createdByName || 'QORE System' },
    meta: { shortcutId: shortcut.id || null, runId, actionKey: shortcut.actionKey || null },
    readBy: [],
    channel: 'push',
    audience: shortcut.createdByUid ? { userIds: [shortcut.createdByUid] } : undefined,
  });
  return { channel: 'inApp', status: 'sent', message: 'Uygulama içi bildirim oluşturuldu.', recipients: targets };
}

async function sendEmail(recipients: string[], summary: string, attachments: GeneratedAttachment[], shortcut: ShortcutDeliveryShortcut): Promise<DeliveryAttempt> {
  const to = emailRecipients(recipients);
  if (!to.length) return { channel: 'email', status: 'skipped', message: 'E-posta alıcısı bulunamadı.' };
  const transporter = getTransporter();
  if (!transporter) return { channel: 'email', status: 'skipped', message: 'SMTP yapılandırması eksik.', recipients: to };

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: `Shortcut raporu - ${shortcut.actionKey || shortcut.id || 'QORE'}`,
    text: summary,
    attachments: attachments.map((attachment) => ({
      filename: attachment.name,
      content: attachment.buffer,
      contentType: attachment.contentType,
    })),
  });
  return { channel: 'email', status: 'sent', message: 'E-posta gönderildi.', recipients: to, attachmentNames: attachments.map((a) => a.name) };
}

async function sendWhatsapp(recipients: string[], summary: string, attachments: GeneratedAttachment[]): Promise<DeliveryAttempt> {
  const waConfig = functions.config().whatsapp;
  if (!waConfig?.instance_id || !waConfig?.token) {
    return { channel: 'whatsapp', status: 'skipped', message: 'WhatsApp yapılandırması eksik.' };
  }
  const to = whatsappRecipients(recipients);
  if (!to.length && waConfig.group_id) to.push(waConfig.group_id);
  if (!to.length) return { channel: 'whatsapp', status: 'skipped', message: 'WhatsApp alıcısı bulunamadı.' };

  const pdf = attachments.find((attachment) => attachment.contentType === 'application/pdf');
  const results = [];
  for (const recipient of to) {
    if (pdf) {
      results.push(await sendWhatsAppDocument(pdf.publicUrl, pdf.name, summary, recipient, waConfig.instance_id, waConfig.token));
    } else {
      results.push(await sendWhatsAppText(recipient, summary, waConfig.instance_id, waConfig.token));
    }
  }
  const failed = results.filter((item) => !item.success);
  if (failed.length) {
    return { channel: 'whatsapp', status: 'failed', message: failed.map((item) => item.error).filter(Boolean).join(' | ') || 'WhatsApp gönderimi başarısız.', recipients: to };
  }
  return { channel: 'whatsapp', status: 'sent', message: 'WhatsApp gönderildi.', recipients: to, attachmentNames: pdf ? [pdf.name] : [] };
}

export async function deliverShortcutResult(args: {
  shortcut: ShortcutDeliveryShortcut;
  runRef: FirebaseFirestore.DocumentReference;
  result: ShortcutResult;
}): Promise<{ summary: string; attachments: GeneratedAttachment[]; attempts: DeliveryAttempt[] }> {
  const channels = normalizeChannels(args.shortcut.deliveryChannels);
  const recipients = await recipientList(args.shortcut);
  const summary = buildShortcutDeliverySummary(args.result, args.shortcut);
  await logDelivery(args.runRef, { channel: 'inApp', status: 'sent', message: 'Kısa özet üretildi.', meta: { summary } });

  const attachments = await ensureGeneratedAttachments({
    channels,
    result: args.result,
    summary,
    shortcut: args.shortcut,
    runId: args.runRef.id,
  });

  if (attachments.length) {
    await logDelivery(args.runRef, {
      channel: channels.includes('pdf') ? 'pdf' : channels.includes('excel') ? 'excel' : 'email',
      status: 'sent',
      message: 'Dosya ekleri üretildi.',
      attachmentNames: attachments.map((attachment) => attachment.name),
      meta: { attachments: attachments.map(({ name, contentType, storagePath, publicUrl, sizeBytes }) => ({ name, contentType, storagePath, publicUrl, sizeBytes })) },
    });
  }

  const attempts: DeliveryAttempt[] = [];
  for (const channel of channels) {
    let attempt: DeliveryAttempt;
    if (channel === 'inApp') attempt = await sendInApp(args.shortcut, args.runRef.id, summary, args.result);
    else if (channel === 'email') attempt = await sendEmail(recipients, summary, attachments, args.shortcut);
    else if (channel === 'whatsapp') attempt = await sendWhatsapp(recipients, summary, attachments);
    else attempt = { channel, status: 'sent', message: `${channel.toUpperCase()} çıktısı Storage'a yazıldı.`, attachmentNames: attachments.filter((a) => channel === 'pdf' ? a.contentType === 'application/pdf' : a.name.endsWith('.xlsx')).map((a) => a.name) };
    attempts.push(attempt);
    await logDelivery(args.runRef, attempt);
  }

  return { summary, attachments, attempts };
}
