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
exports.onStockItemCreatedReconcileOrders = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
/**
 * Triggered when a new stock item is added to depoStok.
 * If the item is marked as shipped to a hospital (isShipped: true),
 * it checks if any open logistics orders for that hospital can now be completed.
 */
exports.onStockItemCreatedReconcileOrders = functions
    .region('europe-west1')
    .firestore.document('depoStok/{id}')
    .onCreate(async (snap, context) => {
    var _a, _b;
    const newItem = snap.data();
    // Only process items that are shipped to a specific laboratory
    if (!newItem.isShipped || !newItem.hedefKurumId) {
        return;
    }
    const labId = newItem.hedefKurumId;
    const db = admin.firestore();
    try {
        // Find active peripheral orders for this lab
        // We check pending, toplaniyor (Hazırlanıyor), and eksik statuses.
        const ordersSnap = await db.collection('orders')
            .where('labId', '==', labId)
            .where('isPeripheral', '==', true)
            .where('status', 'in', ['pending', 'toplaniyor', 'eksik'])
            .get();
        if (ordersSnap.empty) {
            return;
        }
        for (const orderDoc of ordersSnap.docs) {
            const order = orderDoc.data();
            const orderId = orderDoc.id;
            const orderCreatedAt = ((_b = (_a = order.createdAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) || new Date(0);
            // For each item in the order, check if we have enough stock added AFTER order creation
            let allItemsFulfilled = true;
            // We need to fetch current stock for this lab added after the order was created
            const stockSnap = await db.collection('depoStok')
                .where('hedefKurumId', '==', labId)
                .where('isShipped', '==', true)
                .where('eklenmeTarihi', '>=', admin.firestore.Timestamp.fromDate(orderCreatedAt))
                .get();
            const stockCounts = new Map();
            stockSnap.docs.forEach(d => {
                const s = d.data();
                const code = s.stokKodu;
                const qty = Number(s.adet || s.quantity || 1);
                if (code) {
                    stockCounts.set(code, (stockCounts.get(code) || 0) + qty);
                }
            });
            for (const item of order.items || []) {
                const requested = Number(item.adet || 0);
                const inStock = stockCounts.get(item.stokKodu) || 0;
                if (inStock < requested) {
                    allItemsFulfilled = false;
                    break;
                }
            }
            if (allItemsFulfilled && (order.items || []).length > 0) {
                console.log(`Order ${orderId} is now fully reconciled with stock. Marking as completed.`);
                await db.collection('orders').doc(orderId).update({
                    status: 'completed',
                    completedAt: admin.firestore.FieldValue.serverTimestamp(),
                    reconciledByStockId: snap.id,
                    reconciliationNote: 'Otomatik stok eşleşmesi ile tamamlandı.'
                });
            }
        }
    }
    catch (error) {
        console.error('Error in onStockItemCreatedReconcileOrders:', error);
    }
});
//# sourceMappingURL=stockReconciliation.js.map