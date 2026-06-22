"use strict";
/**
 * Cloud Function: peripheral order delivery auto-reconciliation.
 *
 * Listens for new stock arrivals at a lab (depoStok docs created with
 * `isShipped == true` and a `hedefKurumId` set — Excel import, PDF irsaliye OCR,
 * Ceomed irsaliye, depot transfer all funnel through this collection) or at a
 * depot (`isShipped == false` + `depotId`) and credits each unit against the oldest active peripheral/depot order for that location
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
    const isLabArrival = (data === null || data === void 0 ? void 0 : data.isShipped) === true && !!(data === null || data === void 0 ? void 0 : data.hedefKurumId);
    const isDepotArrival = (data === null || data === void 0 ? void 0 : data.isShipped) === false && !!(data === null || data === void 0 ? void 0 : data.depotId);
    if (!isLabArrival && !isDepotArrival)
        return;
    const locationId = (isDepotArrival ? data.depotId : data.hedefKurumId).toString();
    const locationKind = isDepotArrival ? 'depot' : 'lab';
    const fulfillmentField = isDepotArrival ? 'depotFulfillment' : 'peripheralFulfillment';
    const stokKodu = ((data === null || data === void 0 ? void 0 : data.stokKodu) || '').toString().trim();
    if (!stokKodu)
        return;
    const arrivedAdet = Math.max(1, Number(data === null || data === void 0 ? void 0 : data.adet) || 1);
    // Find active product requests for this lab/depot.
    let ordersSnap;
    try {
        let orderQuery = db.collection('orders');
        if (isDepotArrival) {
            orderQuery = orderQuery
                .where('isDepotRequest', '==', true)
                .where('depotId', '==', locationId)
                .where('status', 'in', ['pending', 'eksik']);
        }
        else {
            orderQuery = orderQuery
                .where('isPeripheral', '==', true)
                .where('labId', '==', locationId)
                .where('status', 'in', ['toplaniyor', 'eksik']);
        }
        ordersSnap = await orderQuery.get();
    }
    catch (e) {
        firebase_functions_1.logger.warn(`[peripheralReconcile] order query failed for ${locationKind} ${locationId}:`, (e === null || e === void 0 ? void 0 : e.message) || e);
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
                var _a, _b;
                const fresh = await tx.get(orderRef.ref);
                if (!fresh.exists)
                    return 0;
                const order = fresh.data();
                const rawFulfillment = order === null || order === void 0 ? void 0 : order[fulfillmentField];
                const fallbackItems = isDepotArrival && Array.isArray(order === null || order === void 0 ? void 0 : order.items)
                    ? order.items.map((it) => ({
                        itemId: (it === null || it === void 0 ? void 0 : it.id) || (it === null || it === void 0 ? void 0 : it.stokKodu) || '',
                        stokKodu: ((it === null || it === void 0 ? void 0 : it.stokKodu) || '').toString(),
                        requestedAdet: Number(it === null || it === void 0 ? void 0 : it.adet) || 0,
                        sentAdet: Number(it === null || it === void 0 ? void 0 : it.adet) || 0,
                        deliveredAdet: 0,
                        missingAdet: Number(it === null || it === void 0 ? void 0 : it.adet) || 0,
                        fulfilled: false,
                    }))
                    : [];
                const fulfillment = rawFulfillment || (isDepotArrival ? { items: fallbackItems, appliedDepoStokIds: [], partialDeliveries: [] } : null);
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
                    var _a;
                    if (((it === null || it === void 0 ? void 0 : it.stokKodu) || '').toString().trim() !== stokKodu)
                        return false;
                    const target = Number((_a = it === null || it === void 0 ? void 0 : it.sentAdet) !== null && _a !== void 0 ? _a : it === null || it === void 0 ? void 0 : it.requestedAdet) || 0;
                    const delivered = Number(it === null || it === void 0 ? void 0 : it.deliveredAdet) || 0;
                    return target > delivered;
                });
                if (idx < 0)
                    return 0;
                const item = items[idx];
                const targetAdet = Number((_a = item.sentAdet) !== null && _a !== void 0 ? _a : item.requestedAdet) || 0;
                const prevDelivered = Number(item.deliveredAdet) || 0;
                const need = Math.max(0, targetAdet - prevDelivered);
                if (need <= 0)
                    return 0;
                const credit = Math.min(need, remainingAdet);
                if (credit <= 0)
                    return 0;
                const newDelivered = prevDelivered + credit;
                const newItems = items.slice();
                newItems[idx] = Object.assign(Object.assign({}, item), { deliveredAdet: newDelivered, sentAdet: Number((_b = item.sentAdet) !== null && _b !== void 0 ? _b : item.requestedAdet) || 0, missingAdet: Math.max(0, targetAdet - newDelivered), fulfilled: newDelivered >= targetAdet && targetAdet > 0 });
                const allFulfilled = newItems.every((m) => {
                    var _a;
                    const s = Number((_a = m.sentAdet) !== null && _a !== void 0 ? _a : m.requestedAdet) || 0;
                    const d = Number(m.deliveredAdet) || 0;
                    return s > 0 && d >= s;
                });
                const anyMissing = newItems.some((m) => {
                    var _a;
                    const s = Number((_a = m.sentAdet) !== null && _a !== void 0 ? _a : m.requestedAdet) || 0;
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
                    depoStokDocPath: snap.ref.path,
                    actorUid: (data === null || data === void 0 ? void 0 : data.lastEditedById) || (data === null || data === void 0 ? void 0 : data.createdById) || null,
                    actorName: (data === null || data === void 0 ? void 0 : data.lastEditedBy) || (data === null || data === void 0 ? void 0 : data.createdBy) || null,
                    items: [{ stokKodu, deliveredAdet: credit, missingAdet: Math.max(0, targetAdet - newDelivered) }],
                });
                const update = {
                    [fulfillmentField]: Object.assign(Object.assign({}, fulfillment), { items: newItems, appliedDepoStokIds: [...appliedIds, stokId], partialDeliveries, updatedAt: admin.firestore.FieldValue.serverTimestamp() }),
                };
                if (allFulfilled) {
                    update.status = 'completed';
                    update.transferredAt = admin.firestore.FieldValue.serverTimestamp();
                    update.transferredBy = isDepotArrival ? 'Otomatik (Depo Mal Kabul)' : 'Otomatik (Stok Girişi)';
                }
                else if (anyMissing) {
                    update.status = 'eksik';
                }
                tx.update(orderRef.ref, update);
                return credit;
            });
            if (applied > 0) {
                remainingAdet -= applied;
                firebase_functions_1.logger.info(`[peripheralReconcile] credited ${applied} of ${stokKodu} to order ${orderRef.id} (depoStok=${stokId}, ${locationKind}=${locationId})`);
            }
        }
        catch (e) {
            firebase_functions_1.logger.error(`[peripheralReconcile] failed to credit order ${orderRef.id} for depoStok ${stokId}:`, (e === null || e === void 0 ? void 0 : e.message) || e);
        }
    }
});
//# sourceMappingURL=peripheralOrderReconcile.js.map