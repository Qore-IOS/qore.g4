import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import { sendWhatsAppText } from './lib/whatsapp';
import {
  buildItemGroupMap,
  loadLabGroupNamesByDocId,
  loadLojistikUsers,
  filterItemsForUserGroups,
  resolveUserGroupNames,
  RawOrderItem,
} from './lib/peripheralRecipients';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type OrderDoc = {
  labId?: string;
  kurumAdi?: string;
  items?: RawOrderItem[];
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
  if (digits.length === 10 && digits.startsWith('5')) return `90${digits}`;
  return digits;
}

function buildMessage(
  order: OrderDoc,
  labName: string,
  filteredItems: RawOrderItem[],
  itemGroupMap: Map<string, string>,
): string {
  const urgency = URGENCY_LABELS[order.urgency || 'normal'] || 'Normal';
  const totalAdet = filteredItems.reduce((s, it) => s + (Number(it.adet) || 0), 0);

  const lines: string[] = [];
  lines.push('*Yeni Perifer Ürün Talebi*');
  lines.push('');
  lines.push(`• *Kurum:* ${labName}`);
  lines.push(`• *Kalem Sayısı:* ${filteredItems.length}`);
  lines.push(`• *Toplam Adet:* ${totalAdet}`);
  lines.push(`• *Aciliyet:* ${urgency}`);
  if (order.createdBy) lines.push(`• *Talep Eden:* ${order.createdBy}`);
  lines.push('');

  // Group items by laboratuvarGrubu for a more readable layout
  const itemsByGroup = new Map<string, RawOrderItem[]>();
  for (const it of filteredItems) {
    const g = itemGroupMap.get((it.stokKodu || '').trim()) || 'Diğer';
    if (!itemsByGroup.has(g)) itemsByGroup.set(g, []);
    itemsByGroup.get(g)!.push(it);
  }
  for (const [groupName, groupItems] of itemsByGroup) {
    lines.push(`*${groupName}:*`);
    for (const it of groupItems.slice(0, 30)) {
      const name = it.stokAdi || it.stokKodu || '-';
      const adet = it.adet ?? 1;
      const birim = it.anaBirim ? ` ${it.anaBirim}` : '';
      lines.push(`- ${name} x ${adet}${birim}`);
    }
    if (groupItems.length > 30) lines.push(`...ve ${groupItems.length - 30} kalem daha`);
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

      const waConfig = functions.config().whatsapp;
      if (!waConfig?.instance_id || !waConfig?.token) {
        logEntry.status = 'skipped';
        logEntry.steps.push('WhatsApp config kontrolü: BAŞARISIZ (instance_id/token eksik)');
        await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
        logger.warn('[peripheralOrderWA] WhatsApp config missing');
        return;
      }

      const items: RawOrderItem[] = Array.isArray(order.items) ? order.items : [];
      if (items.length === 0) {
        logEntry.status = 'skipped';
        logEntry.steps.push('Kalem kontrolü: ATLANDI (sipariş boş)');
        await db.collection('peripheralOrderWhatsAppLogs').add(logEntry);
        return;
      }

      const [itemGroupMap, labGroupNamesById, users] = await Promise.all([
        buildItemGroupMap(items),
        loadLabGroupNamesByDocId(),
        loadLojistikUsers(),
      ]);
      logEntry.steps.push(`Veri yükleme OK (kalem grup eşlemesi: ${itemGroupMap.size}, def_labGroups: ${labGroupNamesById.size}, lojistik kullanıcı: ${users.length})`);

      const orderGroups = new Set(Array.from(itemGroupMap.values()));
      logEntry.orderGroups = Array.from(orderGroups);

      const labName = order.kurumAdi || 'Bilinmeyen Laboratuvar';

      for (const user of users) {
        const userGroupNames = resolveUserGroupNames(user, labGroupNamesById);
        const filtered = filterItemsForUserGroups(items, itemGroupMap, userGroupNames);
        const phone = normalizePhoneForWa(user.phoneNumber);

        const baseResult: any = {
          uid: user.uid,
          name: user.name,
          email: user.email,
          assignedGroups: Array.from(userGroupNames),
          matchedItemCount: filtered.length,
        };

        if (filtered.length === 0) {
          baseResult.status = 'no_matching_items';
          logEntry.results.push(baseResult);
          logEntry.steps.push(`${user.name || user.uid}: ATLANDI (eşleşen kalem yok)`);
          continue;
        }
        if (!phone) {
          baseResult.status = 'no_phone';
          logEntry.results.push(baseResult);
          logEntry.steps.push(`${user.name || user.uid}: ATLANDI (telefon yok)`);
          continue;
        }

        const to = `${phone}@c.us`;
        const messageBody = buildMessage(order, labName, filtered, itemGroupMap);
        baseResult.to = to;
        baseResult.messagePreview = messageBody.substring(0, 200);
        try {
          const r = await sendWhatsAppText(to, messageBody, waConfig.instance_id, waConfig.token);
          baseResult.success = r.success;
          baseResult.messageId = r.messageId || null;
          baseResult.error = r.error || null;
          logEntry.results.push(baseResult);
          if (r.success) {
            logEntry.steps.push(`${user.name || user.uid} (${to}): OK (msgId=${r.messageId})`);
          } else {
            logEntry.steps.push(`${user.name || user.uid} (${to}): BAŞARISIZ - ${r.error}`);
          }
        } catch (e: any) {
          baseResult.success = false;
          baseResult.error = e?.message || String(e);
          logEntry.results.push(baseResult);
          logEntry.steps.push(`${user.name || user.uid} (${to}): HATA - ${e?.message || e}`);
          logger.error(`[peripheralOrderWA] send error for ${user.uid}`, e);
        }
      }

      const anySent = logEntry.results.some((r: any) => r.success === true);
      logEntry.status = anySent ? 'sent' : 'skipped';
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
