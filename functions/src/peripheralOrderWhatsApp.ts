import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import { sendWhatsAppText } from './lib/whatsapp';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type OrderItem = {
  stokKodu?: string;
  stokAdi?: string;
  adet?: number;
  anaBirim?: string;
};

type OrderDoc = {
  labId?: string;
  kurumAdi?: string;
  items?: OrderItem[];
  isPeripheral?: boolean;
  requestSource?: string;
  urgency?: 'normal' | 'acil' | 'cok_acil';
  note?: string;
  createdBy?: string;
};

const URGENCY_LABELS: Record<string, string> = {
  normal: 'Normal',
  acil: 'Acil',
  cok_acil: 'Çok Acil',
};

function normalizePhoneForWa(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // Turkish mobile numbers are 10 digits (5xxxxxxxxx); add 90 country prefix.
  if (digits.length === 10 && digits.startsWith('5')) return `90${digits}`;
  // Already prefixed (905...) or international form
  return digits;
}

function buildMessage(order: OrderDoc, labName: string): string {
  const items = Array.isArray(order.items) ? order.items : [];
  const urgency = URGENCY_LABELS[order.urgency || 'normal'] || 'Normal';

  const lines: string[] = [];
  lines.push('*Yeni Perifer Ürün Talebi*');
  lines.push('');
  lines.push(`• *Kurum:* ${labName}`);
  lines.push(`• *Kalem Sayısı:* ${items.length}`);
  lines.push(`• *Aciliyet:* ${urgency}`);
  if (order.createdBy) lines.push(`• *Talep Eden:* ${order.createdBy}`);
  lines.push('');
  if (items.length > 0) {
    lines.push('*Ürünler:*');
    for (const it of items.slice(0, 25)) {
      const name = it.stokAdi || it.stokKodu || '-';
      const adet = it.adet ?? 1;
      const birim = it.anaBirim ? ` ${it.anaBirim}` : '';
      lines.push(`- ${name} x ${adet}${birim}`);
    }
    if (items.length > 25) {
      lines.push(`...ve ${items.length - 25} kalem daha`);
    }
    lines.push('');
  }
  if (order.note && order.note.trim()) {
    lines.push(`*Not:* ${order.note.trim()}`);
    lines.push('');
  }
  lines.push('QORE Sistemi üzerinden detaylara ulaşabilirsiniz.');
  return lines.join('\n');
}

export const onPeripheralOrderCreatedSendWhatsApp = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .firestore.document('orders/{orderId}')
  .onCreate(async (snap, context) => {
    const orderId = context.params.orderId as string;
    const order = snap.data() as OrderDoc;

    const logEntry: Record<string, any> = {
      orderId,
      labId: order?.labId || null,
      labName: order?.kurumAdi || null,
      labGroupId: null as string | null,
      itemsCount: Array.isArray(order?.items) ? order.items.length : 0,
      isPeripheral: order?.isPeripheral ?? null,
      requestSource: order?.requestSource ?? null,
      results: [] as any[],
      status: 'processing',
      steps: [] as string[],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    try {
      const isPeripheralRequest = order?.isPeripheral === true || order?.requestSource === 'lab_to_office';
      if (!isPeripheralRequest) {
        logEntry.status = 'skipped';
        logEntry.steps.push('Perifer kontrolü: ATLANDI (perifer talep değil)');
        await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
        return;
      }
      logEntry.steps.push('Perifer kontrolü: OK');

      const waConfig = functions.config().whatsapp;
      if (!waConfig?.instance_id || !waConfig?.token) {
        logEntry.status = 'skipped';
        logEntry.steps.push('WhatsApp config kontrolü: BAŞARISIZ (instance_id/token eksik)');
        await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
        logger.warn('[peripheralOrderWA] WhatsApp config missing');
        return;
      }
      logEntry.steps.push('WhatsApp config kontrolü: OK');

      const labId = order.labId;
      if (!labId) {
        logEntry.status = 'skipped';
        logEntry.steps.push('Lab kontrolü: BAŞARISIZ (labId yok)');
        await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
        return;
      }

      const hospitalSnap = await db.collection('hospitals').doc(labId).get();
      const hospitalData = hospitalSnap.exists ? hospitalSnap.data() : null;
      const labGroupId: string | undefined = hospitalData?.labGroupId;
      const labName = hospitalData?.name || order.kurumAdi || 'Bilinmeyen Laboratuvar';
      logEntry.labGroupId = labGroupId || null;
      logEntry.labName = labName;

      if (!labGroupId) {
        logEntry.status = 'skipped';
        logEntry.steps.push(`Lab grubu kontrolü: ATLANDI (hospital ${labId} için labGroupId atanmamış)`);
        await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
        logger.info(`[peripheralOrderWA] hospital ${labId} has no labGroupId; skipping`);
        return;
      }
      logEntry.steps.push(`Lab grubu kontrolü: OK (${labGroupId})`);

      const usersSnap = await db.collection('users')
        .where('role', '==', 'lojistik_sorumlusu')
        .where('assignedLabGroups', 'array-contains', labGroupId)
        .get();

      if (usersSnap.empty) {
        logEntry.status = 'skipped';
        logEntry.steps.push(`Alıcı sorgusu: BAŞARISIZ - bu lab grubuna atanmış lojistik sorumlusu yok`);
        await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
        logger.info(`[peripheralOrderWA] no lojistik_sorumlusu for labGroup ${labGroupId}`);
        return;
      }
      logEntry.steps.push(`Alıcı sorgusu: OK (${usersSnap.size} kullanıcı bulundu)`);

      const messageBody = buildMessage(order, labName);
      logEntry.messagePreview = messageBody.substring(0, 240);

      for (const userDoc of usersSnap.docs) {
        const user = userDoc.data() as any;
        const phone = normalizePhoneForWa(user?.phoneNumber);
        const baseResult: any = {
          uid: userDoc.id,
          name: user?.name || null,
          email: user?.email || null,
          rawPhone: user?.phoneNumber || null,
        };

        if (!phone) {
          baseResult.status = 'no_phone';
          logEntry.results.push(baseResult);
          logEntry.steps.push(`${user?.name || userDoc.id}: ATLANDI (telefon yok)`);
          continue;
        }

        const to = `${phone}@c.us`;
        try {
          const r = await sendWhatsAppText(to, messageBody, waConfig.instance_id, waConfig.token);
          baseResult.to = to;
          baseResult.success = r.success;
          baseResult.messageId = r.messageId || null;
          baseResult.error = r.error || null;
          logEntry.results.push(baseResult);
          if (r.success) {
            logEntry.steps.push(`${user?.name || userDoc.id} (${to}): OK (msgId=${r.messageId})`);
          } else {
            logEntry.steps.push(`${user?.name || userDoc.id} (${to}): BAŞARISIZ - ${r.error}`);
          }
        } catch (e: any) {
          baseResult.success = false;
          baseResult.error = e?.message || String(e);
          logEntry.results.push(baseResult);
          logEntry.steps.push(`${user?.name || userDoc.id} (${to}): HATA - ${e?.message || e}`);
          logger.error(`[peripheralOrderWA] send error for ${userDoc.id}`, e);
        }
      }

      const anySent = logEntry.results.some((r: any) => r.success === true);
      logEntry.status = anySent ? 'sent' : 'failed';
    } catch (e: any) {
      logger.error(`[peripheralOrderWA] Unexpected error for order ${orderId}`, e);
      logEntry.status = 'error';
      logEntry.error = e?.message || String(e);
      logEntry.steps.push(`HATA: ${e?.message || e}`);
    }

    try {
      await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
    } catch (logErr) {
      logger.error('[peripheralOrderWA] Failed to write log', logErr);
    }
  });
