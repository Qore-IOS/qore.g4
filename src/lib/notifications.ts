
"use client";

import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  serverTimestamp,
  updateDoc,
  doc,
  arrayUnion,
} from "firebase/firestore";

export type NotificationType =
  | "order_created"
  | "order_created_from_request"
  | "transfer_to_lab"
  | "spare_part_transfer"
  | "fefo_override"
  | "fault_report"
  | "stock_threshold"
  | "lab_count_completed"
  | "fault_opened"
  | "fault_transferred"
  | "fault_closed"
  | "maliyet_sayim_davet"
  | "user_request_created"
  | "user_request_completed"
  | "fault_reminder"
  | "maintenance_reminder"
  | "external_stock_usage"
  | "weekly_plan_approval_requested"
  | "weekly_plan_approved"
  | "weekly_plan_rejected"
  | "custom";

export type ResourceType =
  | "order"
  | "shipment"
  | "usage"
  | "transfer"
  | "lab_count"
  | "device";

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
  channel?: "push" | "sms";
};

export type AudienceHint = {
  userId?: string;
  role?: string;
  views?: string[];
  labIds?: string[];
  depotIds?: string[];
};

/**
 * Removes properties with `undefined` values from an object.
 * This is useful for cleaning data before sending it to Firestore.
 */
function cleanFirestoreData<T extends Record<string, any>>(
  data: T
): Partial<T> {
  if (!data) return {};
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

/**
 * Creates the initial, broad targeting keys. The Cloud Function will handle the final filtering.
 */
function getTargetKeys(ctx: {
  includeAdmins?: boolean;
  includeStockManagers?: boolean;
  labId?: string;
  depotId?: string;
  extraTargets?: string[];
}): string[] {
  const keys = new Set<string>();
  if (ctx.includeAdmins) keys.add("role:admin");
  if (ctx.includeStockManagers) keys.add("view:stok-yonetimi");
  if (ctx.labId) keys.add(`lab:${ctx.labId}`);
  if (ctx.depotId) keys.add(`depot:${ctx.depotId}`);
  (ctx.extraTargets || []).forEach((k) => keys.add(k));
  return Array.from(keys);
}

/** Canonical deep-link builder for known resources */
export function buildHrefForResource(
  resource?: NotificationResource,
  context?: { labId?: string; depotId?: string; tab?: string }
): string | undefined {
  if (!resource) return undefined;
  const q = new URLSearchParams();
  if (resource.id) q.set("focus", resource.id);
  switch (resource.type) {
    case "order":
      return `/siparisler?${q.toString()}`;
    case "shipment": {
      if (context?.depotId) q.set("depotId", context.depotId);
      return `/siparis-gecmis/${resource.id}?${q.toString()}`;
    }
    case "usage": {
      if (context?.labId) q.set("lab", context.labId);
      return `/urun-kullanim?${q.toString()}`;
    }
    case "transfer": {
      if (context?.depotId) q.set("depotId", context.depotId);
      return `/transfer-gecmis?${q.toString()}`;
    }
    case "lab_count": {
      if (context?.labId)
        return `/laboratuvar/sayim/history/${context?.labId}/${
          resource.id
        }?${q.toString()}`;
      return `/laboratuvar/sayim/history/${context?.labId}?${q.toString()}`;
    }
    case "device": {
      return `/cihaz-yonetimi-ana`; // or a more specific page
    }
    default:
      return undefined;
  }
}

/**
 * Creates the notification document in Firestore. The cloud function will handle the fan-out.
 */
export async function createNotification(
  payload: Omit<NotificationDoc, "createdAt" | "readBy">
) {
  const href =
    payload.href ||
    buildHrefForResource(payload.resource, {
      labId: payload.meta?.labId,
      depotId: payload.meta?.depotId,
      tab: payload.meta?.tab,
    }) ||
    "/"; // Default to home page if no href

  const docData: NotificationDoc = {
    ...payload,
    meta: cleanFirestoreData(payload.meta || {}), // Clean meta object here
    channel: payload.channel || "push",
    href,
    createdAt: serverTimestamp(),
    readBy: [],
  };
  await addDoc(collection(db, "notifications"), docData as any);
}

export async function markAsRead(notificationId: string, uid: string) {
  const ref = doc(db, "notifications", notificationId);
  await updateDoc(ref, {
    readBy: arrayUnion(uid),
  });
}

type Actor = { uid: string; name: string };

export async function emitFefoOverride(params: {
  actor: Actor;
  action: "direct_transfer" | "product_usage";
  product: {
    stokKodu: string;
    stokAdi: string;
    lot?: string;
    miad?: string;
    adet?: number;
  };
  usageId?: string;
  shipmentId?: string;
  labId?: string;
  depotId?: string;
}) {
  const title =
    params.action === "product_usage"
      ? "FEFO Uyarısı Yoksayıldı (Kullanım)"
      : "FEFO Uyarısı Yoksayıldı (Direkt Transfer)";
  const message = `${params.product.stokAdi} (${params.product.stokKodu}) için FEFO ilkesine uyulmadı.`;

  await createNotification({
    type: "fefo_override",
    title,
    message,
    resource:
      params.action === "product_usage"
        ? { type: "usage", id: params.usageId }
        : { type: "shipment", id: params.shipmentId },
    actor: params.actor,
    targets: getTargetKeys({ includeAdmins: true }),
    meta: {
      ...params.product,
      action: params.action,
      labId: params.labId,
      depotId: params.depotId,
    },
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
    type: "order_created_from_request",
    title: "Ürün Talebinden Sipariş Oluşturuldu",
    message: `Talep sepetinden bir sipariş oluşturuldu. ID: ${params.orderId}`,
    resource: { type: "order", id: params.orderId },
    actor: params.actor,
    targets: getTargetKeys({ includeAdmins: true, depotId: params.depotId }),
    meta: {
      orderId: params.orderId,
      labId: params.labId,
      depotId: params.depotId,
    },
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
    type: "order_created",
    title: "Yeni Sipariş Oluşturuldu",
    message: `Yeni sipariş oluşturuldu. ID: ${params.orderId}`,
    resource: { type: "order", id: params.orderId },
    actor: params.actor,
    targets: getTargetKeys({ includeAdmins: true, depotId: params.depotId }),
    meta: {
      orderId: params.orderId,
      labId: params.labId,
      depotId: params.depotId,
    },
  });
}

export async function emitTransferToLab(params: {
  actor: Actor;
  shipmentId?: string;
  labId: string;
  audienceHint?: AudienceHint;
}) {
  await createNotification({
    type: "transfer_to_lab",
    title: "Laboratuvarınıza Transfer Tamamlandı",
    message: `Seçili kalemler laboratuvara transfer edildi.`,
    resource: { type: "shipment", id: params.shipmentId },
    actor: params.actor,
    targets: getTargetKeys({ labId: params.labId }),
    meta: {
      shipmentId: params.shipmentId,
      labId: params.labId,
      tab: "direkt-transfer",
    },
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
    type: "lab_count_completed",
    title: "Laboratuvar Sayımı Tamamlandı",
    message: `${params.labName || "Laboratuvar"} sayımı tamamlandı.`,
    resource: { type: "lab_count", id: params.countId },
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
  faultType: "teknik_servis" | "aplikasyon";
  hospitalName?: string;
  hospitalId?: string;
  description?: string;
  deviceImageUrl?: string;
}) {
  const targetRole = `role:${params.faultType}`;
  const faultTypeLabel = params.faultType === "teknik_servis" ? "Teknik Servis" : "Aplikasyon";
  // Build targets: role-specific + lab-specific
  // Cloud Function will compute intersection of role AND lab
  const targets: string[] = [targetRole];
  if (params.hospitalId) {
    targets.push(`lab:${params.hospitalId}`);
  }
  // Convert image path to full URL for push notifications.
  // After migration, deviceImageUrl is already a full Storage URL.
  let fullDeviceImageUrl: string | null = null;
  if (params.deviceImageUrl) {
    if (/^https?:\/\//i.test(params.deviceImageUrl)) {
      fullDeviceImageUrl = params.deviceImageUrl;
    } else {
      const imgPath = params.deviceImageUrl.startsWith("/")
        ? params.deviceImageUrl
        : `/${params.deviceImageUrl}`;
      fullDeviceImageUrl = `https://qorengine.com${imgPath}`;
    }
  }
  await createNotification({
    type: "fault_opened",
    title: `Yeni Arıza Kaydı: ${params.deviceName}`,
    message: `${params.hospitalName || ""} - ${params.deviceName} cihazı için ${faultTypeLabel} arızası açıldı.${params.description ? ` Açıklama: ${params.description}` : ""} (Açan: ${params.actor.name})`,
    href: `/ariza-yonetimi/${params.faultReportId}`,
    resource: { type: "device", id: params.assignedDeviceId },
    actor: params.actor,
    targets,
    meta: {
      hospitalId: params.hospitalId,
      deviceName: params.deviceName,
      faultReportId: params.faultReportId,
      faultType: params.faultType,
      description: params.description || null,
      deviceImageUrl: fullDeviceImageUrl,
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
    type: "fault_closed",
    title: `Arıza Giderildi: ${params.deviceName}`,
    message: `${params.hospitalName || ""} hastanesindeki ${
      params.deviceName
    } cihazının arızası giderildi.`,
    resource: { type: "device" },
    actor: params.actor,
    targets: [`user:${params.openerId}`], // Notify only the user who opened the fault
  });
}

export async function emitFaultTransferred(params: {
  actor: Actor;
  faultReportId: string;
  assignedDeviceId?: string;
  deviceName: string;
  toFaultType: "teknik_servis" | "aplikasyon";
  hospitalName?: string;
  hospitalId?: string;
  description?: string;
  deviceImageUrl?: string;
}) {
  const targetRole = `role:${params.toFaultType}`;
  const faultTypeLabel = params.toFaultType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon';
  const targets: string[] = [targetRole];

  if (params.hospitalId) {
    targets.push(`lab:${params.hospitalId}`);
  }

  // Convert image path to full URL for push notifications
  let fullDeviceImageUrl: string | null = null;
  if (params.deviceImageUrl) {
    if (/^https?:\/\//i.test(params.deviceImageUrl)) {
      fullDeviceImageUrl = params.deviceImageUrl;
    } else {
      const imgPath = params.deviceImageUrl.startsWith("/")
        ? params.deviceImageUrl
        : `/${params.deviceImageUrl}`;
      fullDeviceImageUrl = `https://qorengine.com${imgPath}`;
    }
  }

  // fault_opened tipi kullanıyoruz ki Cloud Function'daki strict role filtresi,
  // push bildirim action butonları ve deviceImageUrl desteği çalışsın.
  // Hedef birim personeline yeni arıza açılmış gibi bildirim gider.
  await createNotification({
    type: 'fault_opened',
    title: `Arıza Aktarıldı: ${params.deviceName}`,
    message: `${params.hospitalName || ''} - ${params.deviceName} cihaz arızası ${faultTypeLabel} birimine aktarıldı.${params.description ? ` Açıklama: ${params.description}` : ''} (Aktaran: ${params.actor.name})`,
    href: `/ariza-yonetimi/${params.faultReportId}`,
    resource: { type: 'device', id: params.assignedDeviceId },
    actor: params.actor,
    targets,
    meta: {
      hospitalId: params.hospitalId,
      deviceName: params.deviceName,
      faultReportId: params.faultReportId,
      faultType: params.toFaultType,
      description: params.description || null,
      deviceImageUrl: fullDeviceImageUrl,
      openedByName: params.actor.name,
      isTransfer: true,
    },
  });
}

export async function emitSparePartTransfer(params: {
  actor: Actor;
  targetUid: string;
  targetName: string;
  items: { stokKodu: string; stokAdi: string; quantity: number }[];
}) {
  const itemSummary = params.items
    .map(i => `${i.stokAdi} (${i.stokKodu}) x${i.quantity}`)
    .join(', ');
  const totalQty = params.items.reduce((s, i) => s + i.quantity, 0);

  await createNotification({
    type: 'spare_part_transfer',
    channel: 'push',
    title: 'Yedek Parça Transfer Edildi',
    message: `${params.actor.name} tarafından ${totalQty} adet yedek parça transfer edildi: ${itemSummary}`,
    href: '/direkt-transfer/yedek-parca-transfer',
    actor: params.actor,
    targets: [`user:${params.targetUid}`],
    meta: {
      targetUid: params.targetUid,
      targetName: params.targetName,
      items: params.items,
    },
  });
}

export async function emitUserRequestCreated(params: {
  actor: Actor;
  requestId: string;
  title: string;
  assignedToUid: string;
  assignedToName: string;
  category: string;
  priority: string;
}) {
  await createNotification({
    type: "user_request_created",
    title: "Yeni Kullanıcı Talebi",
    message: `${params.actor.name} size bir talep gönderdi: "${params.title}"`,
    href: "/kullanici-talepleri",
    actor: params.actor,
    targets: [`user:${params.assignedToUid}`],
    meta: {
      requestId: params.requestId,
      requestTitle: params.title,
      assignedToUid: params.assignedToUid,
      assignedToName: params.assignedToName,
      category: params.category,
      priority: params.priority,
    },
  });
}

export async function emitUserRequestCompleted(params: {
  actor: Actor;
  requestId: string;
  title: string;
  requestCreatorUid: string;
  requestCreatorName: string;
}) {
  const targets = Array.from(
    new Set([`user:${params.requestCreatorUid}`, `user:${params.actor.uid}`])
  );

  await createNotification({
    type: "user_request_completed",
    title: "Talebiniz Tamamlandı",
    message: `"${params.title}" başlıklı talebiniz ${params.actor.name} tarafından tamamlandı.`,
    href: "/kullanici-talepleri",
    actor: params.actor,
    targets,
    meta: {
      requestId: params.requestId,
      requestTitle: params.title,
      requestCreatorUid: params.requestCreatorUid,
      requestCreatorName: params.requestCreatorName,
    },
  });
}

export async function emitMaliyetSayimDavet(params: {
  actor: Actor;
  targetUid: string;
  targetName: string;
  locationName: string;
  sessionId?: string;
}) {
  await createNotification({
    type: "maliyet_sayim_davet",
    channel: "push",
    title: "Maliyet Sayımına Davet Edildiniz",
    message: `${params.actor.name} sizi "${params.locationName}" için maliyet sayımına davet etti.`,
    href: "/maliyet-sayim",
    actor: params.actor,
    targets: [`user:${params.targetUid}`],
    meta: {
      targetUid: params.targetUid,
      targetName: params.targetName,
      locationName: params.locationName,
      sessionId: params.sessionId,
    },
  });
}

/**
 * Sends a notification to all technical staff when a part is used from external stocks (Depot or Pool).
 */
export async function emitExternalStockUsage(params: {
  actor: Actor;
  sourceType: 'depot' | 'pool' | 'depo' | 'havuz';
  sourceName: string;
  stokKodu: string;
  stokAdi: string;
  serialNumber?: string;
  quantity: number;
  deviceName?: string;
  hospitalName?: string;
  labName?: string;
}) {
  const sourceLabel = (params.sourceType === 'depot' || params.sourceType === 'depo') ? 'Depo' : 'Havuz';
  const targetRoles = ['role:teknik_servis', 'role:aplikasyon', 'role:teknik_lojistik', 'role:admin'];

  await createNotification({
    type: 'external_stock_usage',
    channel: 'push',
    title: `${sourceLabel} Stok Kullanımı`,
    message: `${params.actor.name}, ${params.sourceName} kaynağından ${params.stokAdi} (${params.stokKodu}${params.serialNumber ? `, SN: ${params.serialNumber}` : ''}) ${params.quantity} adet ürün kullandı.`,
    href: '/direkt-transfer/yedek-parca-transfer',
    actor: params.actor,
    targets: targetRoles,
    meta: {
      ...params,
    },
  });
}

/**
 * Satın Alma haftalık planı oluşturulduğunda firma sorumlusuna onay bildirimi gönderir.
 * Hem sistem içi bildirim hem de push notification olarak iletilir.
 */
export async function emitWeeklyPlanApprovalRequested(params: {
  actor: Actor;
  responsibleUid: string;
  responsibleName?: string;
  weeklyPlanGroupId: string;
  weekStart: string;
  weekEnd: string;
  taskCount: number;
  companyName?: string;
}) {
  await createNotification({
    type: "weekly_plan_approval_requested",
    channel: "push",
    title: "Haftalık Plan Onayı Bekliyor",
    message: `${params.actor.name}, ${params.weekStart} - ${params.weekEnd} tarihleri için ${params.taskCount} görevlik haftalık plan oluşturdu. Onayınız bekleniyor.`,
    href: `/satin-alma?planApproval=${params.weeklyPlanGroupId}`,
    actor: params.actor,
    // Hedefe özel: sadece firma sorumlusu bu bildirimi görsün
    targets: [`user:${params.responsibleUid}`],
    meta: {
      weeklyPlanGroupId: params.weeklyPlanGroupId,
      weekStart: params.weekStart,
      weekEnd: params.weekEnd,
      taskCount: params.taskCount,
      companyName: params.companyName,
      responsibleUid: params.responsibleUid,
      responsibleName: params.responsibleName,
    },
  });
}

export async function emitWeeklyPlanApproved(params: {
  actor: Actor;
  createdByUid: string;
  weeklyPlanGroupId: string;
  weekStart: string;
  weekEnd: string;
  taskCount: number;
}) {
  await createNotification({
    type: "weekly_plan_approved",
    channel: "push",
    title: "Haftalık Planınız Onaylandı",
    message: `${params.weekStart} - ${params.weekEnd} için haftalık planınız ${params.actor.name} tarafından onaylandı. Plan artık takvimde aktif.`,
    href: `/satin-alma?week=${params.weekStart}`,
    actor: params.actor,
    targets: [`user:${params.createdByUid}`],
    meta: {
      weeklyPlanGroupId: params.weeklyPlanGroupId,
      weekStart: params.weekStart,
      weekEnd: params.weekEnd,
      taskCount: params.taskCount,
    },
  });
}

export async function emitWeeklyPlanRejected(params: {
  actor: Actor;
  createdByUid: string;
  weeklyPlanGroupId: string;
  weekStart: string;
  weekEnd: string;
  reason?: string;
}) {
  await createNotification({
    type: "weekly_plan_rejected",
    channel: "push",
    title: "Haftalık Planınız Onaylanmadı",
    message: `${params.weekStart} - ${params.weekEnd} için oluşturduğunuz haftalık plan ${params.actor.name} tarafından reddedildi.${params.reason ? ` Sebep: ${params.reason}` : ''}`,
    href: `/satin-alma?week=${params.weekStart}`,
    actor: params.actor,
    targets: [`user:${params.createdByUid}`],
    meta: {
      weeklyPlanGroupId: params.weeklyPlanGroupId,
      weekStart: params.weekStart,
      weekEnd: params.weekEnd,
      reason: params.reason,
    },
  });
}
