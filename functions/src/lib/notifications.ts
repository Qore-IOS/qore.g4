
import * as admin from 'firebase-admin';

type NotificationType =
  | 'order_created'
  | 'order_created_from_request'
  | 'transfer_to_lab'
  | 'fefo_override'
  | 'fault_report'
  | 'stock_threshold'
  | 'depot_count_completed'
  | 'lab_count_completed'
  | 'fault_opened'
  | 'fault_closed'
  | 'custom';

export type ResourceType =
  | 'order'
  | 'shipment'
  | 'usage'
  | 'transfer'
  | 'depot_count'
  | 'lab_count'
  | 'device';

export type NotificationResource = {
  type: ResourceType;
  id?: string;
};

export type NotificationDoc = {
  type: NotificationType;
  title: string;
  message: string;
  href?: string;
  resource?: NotificationResource;
  createdAt: any;
  targets: string[]; // Group keys like 'role:admin' or 'depot:xyz'
  actor: { uid: string; name: string };
  meta?: Record<string, any>;
  readBy: string[];
  channel?: 'push' | 'sms'; // ** ADDED CHANNEL **
  audience?: Audience;
};

export type Audience = {
  // Optional targeting – use any that apply.
  roles?: string[];                 // e.g. ['admin', 'warehouse']
  userIds?: string[];               // force include specific user ids
  assignedHospitals?: string[];     // match user's assignedHospitals
  assignedDepots?: string[];        // match user's assignedDepots
};

const db = admin.firestore();

/**
 * Creates the initial, broad targeting keys. The Cloud Function will do the final filtering.
 */
function getTargetKeys(ctx: {
  includeAdmins?: boolean;
  includeStockManagers?: boolean;
  labId?: string;
  depotId?: string;
  extraTargets?: string[];
}): string[] {
  const keys = new Set<string>();
  if (ctx.includeAdmins) keys.add('role:admin');
  if (ctx.includeStockManagers) keys.add('view:stok-yonetimi');
  if (ctx.labId) keys.add(`lab:${ctx.labId}`);
  if (ctx.depotId) keys.add(`depot:${ctx.depotId}`);
  (ctx.extraTargets || []).forEach(k => keys.add(k));
  return Array.from(keys);
}


/** Canonical deep-link builder for known resources */
export function buildHrefForResource(
  resource?: NotificationResource,
  context?: { labId?: string; depotId?: string; tab?: string }
): string | undefined {
  if (!resource) return undefined;
  const q = new URLSearchParams();
  if (resource.id) q.set('focus', resource.id);
  switch (resource.type) {
    case 'order':
      return `/siparisler?${q.toString()}`;
    case 'shipment': {
       if (context?.depotId) q.set('depotId', context.depotId);
      return `/siparis-gecmis/${resource.id}?${q.toString()}`;
    }
    case 'usage': {
      if (context?.labId) q.set('lab', context.labId);
      return `/urun-kullanim?${q.toString()}`;
    }
    case 'transfer': {
      if (context?.depotId) q.set('depotId', context.depotId);
      return `/transfer-gecmis?${q.toString()}`;
    }
    case 'depot_count': {
      if (context?.depotId) q.set('depotId', context.depotId);
      return `/depo-sayim-gecmis?${q.toString()}`;
    }
    case 'lab_count': {
      if (context?.labId) return `/laboratuvar/sayim/history/${context?.labId}/${resource.id}?${q.toString()}`;
      return `/laboratuvar/sayim/history/${context?.labId}?${q.toString()}`;
    }
    case 'device': {
        return `/cihaz-yonetimi-ana`; // or a more specific page
    }
    default:
      return undefined;
  }
}

/**
 * Creates the notification document in Firestore. The cloud function will handle the fan-out.
 */
export async function createNotification(payload: Omit<NotificationDoc, 'createdAt' | 'readBy'>) {
  const href = payload.href || buildHrefForResource(payload.resource, {
    labId: payload.meta?.labId,
    depotId: payload.meta?.depotId,
    tab: payload.meta?.tab,
  });
  const docData: NotificationDoc = {
    ...payload,
    channel: payload.channel || 'push', // Default to 'push'
    href,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    readBy: [],
  };
  await admin.firestore().collection('notifications').add(docData);
}


export async function markAsRead(notificationId: string, uid: string) {
  const ref = db.collection('notifications').doc(notificationId);
  await ref.update({
    readBy: admin.firestore.FieldValue.arrayUnion(uid)
  });
}

type Actor = { uid: string; name: string };
type AudienceHint = any; // Assuming type from client-side might not be available server-side.

export async function emitFefoOverride(params: {
  actor: Actor;
  action: 'direct_transfer' | 'product_usage';
  product: { stokKodu: string; stokAdi: string; lot?: string; miad?: string; adet?: number };
  usageId?: string;
  shipmentId?: string;
  labId?: string;
  depotId?: string;
}) {
  const title = params.action === 'product_usage'
    ? 'FEFO Uyarısı Yoksayıldı (Kullanım)'
    : 'FEFO Uyarısı Yoksayıldı (Direkt Transfer)';
  const message = `${params.product.stokAdi} (${params.product.stokKodu}) için FEFO ilkesine uyulmadı.`;

  await createNotification({
    type: 'fefo_override',
    title,
    message,
    resource: params.action === 'product_usage' ? { type: 'usage', id: params.usageId } : { type: 'shipment', id: params.shipmentId },
    actor: params.actor,
    targets: getTargetKeys({ includeAdmins: true }),
    meta: { ...params.product, action: params.action, labId: params.labId, depotId: params.depotId },
  });
}

export async function emitOrderCreatedFromRequest(params: {
  actor: Actor;
  orderId: string;
  labId?: string;
  depotId?: string;
  audienceHint?: AudienceHint;
}) {
  await createNotification({
    type: 'order_created_from_request',
    title: 'Ürün Talebinden Sipariş Oluşturuldu',
    message: `Talep sepetinden bir sipariş oluşturuldu. ID: ${params.orderId}`,
    resource: { type: 'order', id: params.orderId },
    actor: params.actor,
    targets: getTargetKeys({ includeAdmins: true, depotId: params.depotId }),
    meta: { orderId: params.orderId, labId: params.labId, depotId: params.depotId },
  });
}

export async function emitOrderCreated(params: {
  actor: Actor;
  orderId: string;
  labId?: string;
  depotId?: string;
  audienceHint?: AudienceHint;
}) {
  await createNotification({
    type: 'order_created',
    title: 'Yeni Sipariş Oluşturuldu',
    message: `Yeni sipariş oluşturuldu. ID: ${params.orderId}`,
    resource: { type: 'order', id: params.orderId },
    actor: params.actor,
    targets: getTargetKeys({ includeAdmins: true, depotId: params.depotId }),
    meta: { orderId: params.orderId, labId: params.labId, depotId: params.depotId },
  });
}

export async function emitTransferToLab(params: {
  actor: Actor;
  shipmentId?: string;
  labId: string;
  audienceHint?: AudienceHint;
}) {
  await createNotification({
    type: 'transfer_to_lab',
    title: 'Laboratuvarınıza Transfer Tamamlandı',
    message: `Seçili kalemler laboratuvara transfer edildi.`,
    resource: { type: 'shipment', id: params.shipmentId },
    actor: params.actor,
    targets: getTargetKeys({ labId: params.labId }),
    meta: { shipmentId: params.shipmentId, labId: params.labId, tab: 'direkt-transfer' },
  });
}

export async function emitDepotCountCompleted(params: {
  actor: Actor;
  depotId: string;
  depotName?: string;
  countId?: string;
  audienceHint?: AudienceHint;
}) {
  await createNotification({
    type: 'depot_count_completed',
    title: 'Depo Sayımı Tamamlandı',
    message: `${params.depotName || 'Depo'} sayımı tamamlandı.`,
    resource: { type: 'depot_count', id: params.countId },
    actor: params.actor,
    targets: getTargetKeys({ includeAdmins: true, depotId: params.depotId }),
    meta: { depotId: params.depotId, depotName: params.depotName },
  });
}

export async function emitLabCountCompleted(params: {
  actor: Actor;
  labId: string;
  labName?: string;
  countId?: string;
  audienceHint?: AudienceHint;
}) {
  await createNotification({
    type: 'lab_count_completed',
    title: 'Laboratuvar Sayımı Tamamlandı',
    message: `${params.labName || 'Laboratuvar'} sayımı tamamlandı.`,
    resource: { type: 'lab_count', id: params.countId },
    actor: params.actor,
    targets: getTargetKeys({ includeAdmins: true, labId: params.labId }),
    meta: { labId: params.labId, labName: params.labName },
  });
}

export async function emitFaultOpened(params: {
  actor: Actor;
  faultReportId: string;
  assignedDeviceId: string;
  deviceName: string;
  faultType: 'teknik_servis' | 'aplikasyon';
  hospitalName?: string;
  hospitalId?: string;
  description?: string;
}) {
  const targetRole = `role:${params.faultType}`;
  const faultTypeLabel = params.faultType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon';
  const normalizedDescription = (params.description || '').trim();
  const descriptionSuffix = normalizedDescription ? ` • Açıklama: ${normalizedDescription}` : '';

  // Send push notification (channel defaults to 'push')
  await createNotification({
    type: 'fault_opened',
    title: `Yeni Ariza Kaydi: ${params.deviceName}`,
    message: `${params.actor.name}, ${params.hospitalName || ''} hastanesindeki ${params.deviceName} cihazı için ${faultTypeLabel} arızası açtı${descriptionSuffix}`,
    href: `/ariza-yonetimi/${params.faultReportId}`,
    resource: { type: 'device', id: params.assignedDeviceId },
    actor: params.actor,
    targets: [targetRole], // Target only the related fault unit
    meta: {
      hospitalId: params.hospitalId,
      deviceName: params.deviceName,
      faultReportId: params.faultReportId,
      faultType: params.faultType,
      description: normalizedDescription,
      openedByName: params.actor.name,
    },
  });
}

export async function emitFaultClosed(params: {
  actor: Actor;
  openerId: string; // The UID of the user who originally opened the fault
  deviceName: string;
  hospitalName?: string;
}) {
  await createNotification({
    type: 'fault_closed',
    title: `Arıza Giderildi: ${params.deviceName}`,
    message: `${params.hospitalName || ''} hastanesindeki ${params.deviceName} cihazının arızası giderildi.`,
    resource: { type: 'device' },
    actor: params.actor,
    targets: [`user:${params.openerId}`], // Notify only the user who opened the fault
  });
}
