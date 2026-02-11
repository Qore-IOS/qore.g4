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
exports.emitFaultClosed = exports.emitFaultOpened = exports.emitLabCountCompleted = exports.emitDepotCountCompleted = exports.emitTransferToLab = exports.emitOrderCreated = exports.emitOrderCreatedFromRequest = exports.emitFefoOverride = exports.markAsRead = exports.createNotification = exports.buildHrefForResource = void 0;
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
/**
 * Creates the initial, broad targeting keys. The Cloud Function will do the final filtering.
 */
function getTargetKeys(ctx) {
    const keys = new Set();
    if (ctx.includeAdmins)
        keys.add('role:admin');
    if (ctx.includeStockManagers)
        keys.add('view:stok-yonetimi');
    if (ctx.labId)
        keys.add(`lab:${ctx.labId}`);
    if (ctx.depotId)
        keys.add(`depot:${ctx.depotId}`);
    (ctx.extraTargets || []).forEach(k => keys.add(k));
    return Array.from(keys);
}
/** Canonical deep-link builder for known resources */
function buildHrefForResource(resource, context) {
    if (!resource)
        return undefined;
    const q = new URLSearchParams();
    if (resource.id)
        q.set('focus', resource.id);
    switch (resource.type) {
        case 'order':
            return `/siparisler?${q.toString()}`;
        case 'shipment': {
            if (context === null || context === void 0 ? void 0 : context.depotId)
                q.set('depotId', context.depotId);
            return `/siparis-gecmis/${resource.id}?${q.toString()}`;
        }
        case 'usage': {
            if (context === null || context === void 0 ? void 0 : context.labId)
                q.set('lab', context.labId);
            return `/urun-kullanim?${q.toString()}`;
        }
        case 'transfer': {
            if (context === null || context === void 0 ? void 0 : context.depotId)
                q.set('depotId', context.depotId);
            return `/transfer-gecmis?${q.toString()}`;
        }
        case 'depot_count': {
            if (context === null || context === void 0 ? void 0 : context.depotId)
                q.set('depotId', context.depotId);
            return `/depo-sayim-gecmis?${q.toString()}`;
        }
        case 'lab_count': {
            if (context === null || context === void 0 ? void 0 : context.labId)
                return `/laboratuvar/sayim/history/${context === null || context === void 0 ? void 0 : context.labId}/${resource.id}?${q.toString()}`;
            return `/laboratuvar/sayim/history/${context === null || context === void 0 ? void 0 : context.labId}?${q.toString()}`;
        }
        case 'device': {
            return `/cihaz-yonetimi-ana`; // or a more specific page
        }
        default:
            return undefined;
    }
}
exports.buildHrefForResource = buildHrefForResource;
/**
 * Creates the notification document in Firestore. The cloud function will handle the fan-out.
 */
async function createNotification(payload) {
    var _a, _b, _c;
    const href = payload.href || buildHrefForResource(payload.resource, {
        labId: (_a = payload.meta) === null || _a === void 0 ? void 0 : _a.labId,
        depotId: (_b = payload.meta) === null || _b === void 0 ? void 0 : _b.depotId,
        tab: (_c = payload.meta) === null || _c === void 0 ? void 0 : _c.tab,
    });
    const docData = Object.assign(Object.assign({}, payload), { channel: payload.channel || 'push', // Default to 'push'
        href, createdAt: admin.firestore.FieldValue.serverTimestamp(), readBy: [] });
    await admin.firestore().collection('notifications').add(docData);
}
exports.createNotification = createNotification;
async function markAsRead(notificationId, uid) {
    const ref = db.collection('notifications').doc(notificationId);
    await ref.update({
        readBy: admin.firestore.FieldValue.arrayUnion(uid)
    });
}
exports.markAsRead = markAsRead;
async function emitFefoOverride(params) {
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
        meta: Object.assign(Object.assign({}, params.product), { action: params.action, labId: params.labId, depotId: params.depotId }),
    });
}
exports.emitFefoOverride = emitFefoOverride;
async function emitOrderCreatedFromRequest(params) {
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
exports.emitOrderCreatedFromRequest = emitOrderCreatedFromRequest;
async function emitOrderCreated(params) {
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
exports.emitOrderCreated = emitOrderCreated;
async function emitTransferToLab(params) {
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
exports.emitTransferToLab = emitTransferToLab;
async function emitDepotCountCompleted(params) {
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
exports.emitDepotCountCompleted = emitDepotCountCompleted;
async function emitLabCountCompleted(params) {
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
exports.emitLabCountCompleted = emitLabCountCompleted;
async function emitFaultOpened(params) {
    const targetRole = `role:${params.faultType}`;
    // Send push notification (channel defaults to 'push')
    await createNotification({
        type: 'fault_opened',
        title: `Yeni Ariza Kaydi: ${params.deviceName}`,
        message: `${params.hospitalName || ''} hastanesindeki ${params.deviceName} cihazı için ${params.faultType.replace('_', ' ')} arızası açıldı.`,
        resource: { type: 'device', id: params.assignedDeviceId },
        actor: params.actor,
        targets: [targetRole, 'role:admin'],
        meta: { hospitalId: params.hospitalId, deviceName: params.deviceName },
    });
}
exports.emitFaultOpened = emitFaultOpened;
async function emitFaultClosed(params) {
    await createNotification({
        type: 'fault_closed',
        title: `Arıza Giderildi: ${params.deviceName}`,
        message: `${params.hospitalName || ''} hastanesindeki ${params.deviceName} cihazının arızası giderildi.`,
        resource: { type: 'device' },
        actor: params.actor,
        targets: [`user:${params.openerId}`], // Notify only the user who opened the fault
    });
}
exports.emitFaultClosed = emitFaultClosed;
//# sourceMappingURL=notifications.js.map