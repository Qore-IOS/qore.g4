import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * Triggered when a new stock item is added to depoStok.
 * If the item is marked as shipped to a hospital (isShipped: true),
 * it checks if any open logistics orders for that hospital can now be completed.
 */
export const onStockItemCreatedReconcileOrders = functions
  .region('europe-west1')
  .firestore.document('depoStok/{id}')
  .onCreate(async (snap, context) => {
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
        const orderCreatedAt = order.createdAt?.toDate?.() || new Date(0);

        // For each item in the order, check if we have enough stock added AFTER order creation
        let allItemsFulfilled = true;
        
        // We need to fetch current stock for this lab added after the order was created
        const stockSnap = await db.collection('depoStok')
          .where('hedefKurumId', '==', labId)
          .where('isShipped', '==', true)
          .where('eklenmeTarihi', '>=', admin.firestore.Timestamp.fromDate(orderCreatedAt))
          .get();

        const stockCounts = new Map<string, number>();
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
    } catch (error) {
      console.error('Error in onStockItemCreatedReconcileOrders:', error);
    }
  });
