"use strict";
/**
 * Cloud Function: peripheral order delivery auto-reconciliation.
 *
 * Listens for new stock arrivals at a lab (depoStok docs created with
 * `isShipped == true` and a `hedefKurumId` set — Excel import, PDF irsaliye OCR,
 * Ceomed irsaliye, depot transfer all funnel through this collection) and
 * credits each unit against the oldest active peripheral order for that lab
 * whose `peripheralFulfillment.items[]` still has remaining demand for the
 * arriving stokKodu.
 *
 * Status transitions:
 *  - All order items fulfilled (deliveredAdet >= sentAdet) -> 'completed'.
 *  - Any item under-fulfilled -> 'eksik' (was 'toplaniyor' on save).
 *  - When more stock arrives and finally covers everything, status flips to
 *    'completed' on that final write.
 *
 * Excess stock items (no matching open order) are simply ignored — they enter
 * lab stock as normal; subsequent matching orders can consume them on later
 * arrivals.
 *
 * Idempotency: each depoStok doc id is recorded into the order's
 * `peripheralFulfillment.appliedDepoStokIds` so retries / replays do not
 * double-credit.
 */
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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onDepoStokAccepted = void 0;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const firebase_functions_1 = require("firebase-functions");
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
function pickToDate(value) {
    if (!value)
        return 0;
    if (typeof (value === null || value === void 0 ? void 0 : value.toMillis) === 'function')
        return value.toMillis();
    if (typeof (value === null || value === void 0 ? void 0 : value._seconds) === 'number')
        return value._seconds * 1000;
    if (value instanceof Date)
        return value.getTime();
    return 0;
}
exports.onDepoStokAccepted = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .firestore.document('depoStok/{stokId}')
    .onCreate(async (snap, context) => {
    const data = snap.data();
    const stokId = context.params.stokId;
    // Gate: only react when this stock entry is destined for a lab (perifer flow
    // and depot→lab transfers both flag isShipped+hedefKurumId).
    if (!(data === null || data === void 0 ? void 0 : data.isShipped))
        return;
    const hedefKurumId = data === null || data === void 0 ? void 0 : data.hedefKurumId;
    if (!hedefKurumId)
        return;
    const stokKodu = ((data === null || data === void 0 ? void 0 : data.stokKodu) || '').toString().trim();
    if (!stokKodu)
        return;
    const arrivedAdet = Math.max(1, Number(data === null || data === void 0 ? void 0 : data.adet) || 1);
    // Find active peripheral orders for this lab.
    let ordersSnap;
    try {
        ordersSnap = await db
            .collection('orders')
            .where('isPeripheral', '==', true)
            .where('labId', '==', hedefKurumId)
            .where('status', 'in', ['toplaniyor', 'eksik'])
            .get();
    }
    catch (e) {
        firebase_functions_1.logger.warn(`[peripheralReconcile] order query failed for lab ${hedefKurumId}:`, (e === null || e === void 0 ? void 0 : e.message) || e);
        return;
    }
    if (ordersSnap.empty)
        return;
    // Sort by createdAt ascending — oldest order has priority.
    const orderDocs = ordersSnap.docs.slice().sort((a, b) => {
        var _a, _b;
        const ad = pickToDate((_a = a.data()) === null || _a === void 0 ? void 0 : _a.createdAt);
        const bd = pickToDate((_b = b.data()) === null || _b === void 0 ? void 0 : _b.createdAt);
        return ad - bd;
    });
    let remainingAdet = arrivedAdet;
    for (const orderRef of orderDocs) {
        if (remainingAdet <= 0)
            break;
        try {
            const applied = await db.runTransaction(async (tx) => {
                const fresh = await tx.get(orderRef.ref);
                if (!fresh.exists)
                    return 0;
                const order = fresh.data();
                const fulfillment = order === null || order === void 0 ? void 0 : order.peripheralFulfillment;
                const items = Array.isArray(fulfillment === null || fulfillment === void 0 ? void 0 : fulfillment.items) ? fulfillment.items : [];
                if (items.length === 0)
                    return 0;
                const appliedIds = Array.isArray(fulfillment === null || fulfillment === void 0 ? void 0 : fulfillment.appliedDepoStokIds)
                    ? fulfillment.appliedDepoStokIds
                    : [];
                if (appliedIds.includes(stokId))
                    return 0;
                // Find the first matching item with remaining need.
                const idx = items.findIndex((it) => {
                    if (((it === null || it === void 0 ? void 0 : it.stokKodu) || '').toString().trim() !== stokKodu)
                        return false;
                    const sent = Number(it === null || it === void 0 ? void 0 : it.sentAdet) || 0;
                    const delivered = Number(it === null || it === void 0 ? void 0 : it.deliveredAdet) || 0;
                    return sent > delivered;
                });
                if (idx < 0)
                    return 0;
                const item = items[idx];
                const sent = Number(item.sentAdet) || 0;
                const prevDelivered = Number(item.deliveredAdet) || 0;
                const need = Math.max(0, sent - prevDelivered);
                if (need <= 0)
                    return 0;
                const credit = Math.min(need, remainingAdet);
                if (credit <= 0)
                    return 0;
                const newDelivered = prevDelivered + credit;
                const newItems = items.slice();
                newItems[idx] = Object.assign(Object.assign({}, item), { deliveredAdet: newDelivered, missingAdet: Math.max(0, sent - newDelivered), fulfilled: newDelivered >= sent && sent > 0 });
                const allFulfilled = newItems.every((m) => {
                    const s = Number(m.sentAdet) || 0;
                    const d = Number(m.deliveredAdet) || 0;
                    return s > 0 && d >= s;
                });
                const anyMissing = newItems.some((m) => {
                    const s = Number(m.sentAdet) || 0;
                    const d = Number(m.deliveredAdet) || 0;
                    return s > d;
                });
                const partialDeliveries = Array.isArray(fulfillment === null || fulfillment === void 0 ? void 0 : fulfillment.partialDeliveries)
                    ? fulfillment.partialDeliveries.slice()
                    : [];
                partialDeliveries.push({
                    at: admin.firestore.Timestamp.now(),
                    source: 'depoStok',
                    depoStokId: stokId,
                    depoStokDocPath: orderRef.ref.path,
                    actorUid: (data === null || data === void 0 ? void 0 : data.lastEditedById) || (data === null || data === void 0 ? void 0 : data.createdById) || null,
                    actorName: (data === null || data === void 0 ? void 0 : data.lastEditedBy) || (data === null || data === void 0 ? void 0 : data.createdBy) || null,
                    items: [{ stokKodu, deliveredAdet: credit, missingAdet: Math.max(0, sent - newDelivered) }],
                });
                const update = {
                    peripheralFulfillment: Object.assign(Object.assign({}, fulfillment), { items: newItems, appliedDepoStokIds: [...appliedIds, stokId], partialDeliveries, updatedAt: admin.firestore.FieldValue.serverTimestamp() }),
                };
                if (allFulfilled) {
                    update.status = 'completed';
                    update.transferredAt = admin.firestore.FieldValue.serverTimestamp();
                    update.transferredBy = 'Otomatik (Stok Girişi)';
                }
                else if (anyMissing) {
                    update.status = 'eksik';
                }
                tx.update(orderRef.ref, update);
                return credit;
            });
            if (applied > 0) {
                remainingAdet -= applied;
                firebase_functions_1.logger.info(`[peripheralReconcile] credited ${applied} of ${stokKodu} to order ${orderRef.id} (depoStok=${stokId}, lab=${hedefKurumId})`);
            }
        }
        catch (e) {
            firebase_functions_1.logger.error(`[peripheralReconcile] failed to credit order ${orderRef.id} for depoStok ${stokId}:`, (e === null || e === void 0 ? void 0 : e.message) || e);
        }
    }
});
//# sourceMappingURL=peripheralOrderReconcile.js.map