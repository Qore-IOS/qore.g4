import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

/**
 * Otomatik Mutabakat Trigger'ı:
 * Yeni bir cariBankTransactions belgesi eklendiğinde veya güncellendiğinde,
 * durumu "eslesmemis" ise sistemdeki faturalar, ödemeler veya tahsilatlarla
 * tutar ve tarih bazlı bir "fuzzy match" dener.
 *
 * (Gelişmiş eşleşme algoritması buraya eklenebilir. Şu an temel bir loglama ve 
 * altyapı iskeleti kurulmuştur.)
 */
export const onBankTransactionWritten = onDocumentWritten(
  {
    document: 'cariBankTransactions/{txId}',
    region: 'europe-west1',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const afterData = snap.after.exists ? snap.after.data() : null;
    const beforeData = snap.before.exists ? snap.before.data() : null;

    if (!afterData) {
      // Belge silindi
      logger.info(`[cariReconciliation] BankTransaction deleted: ${event.params.txId}`);
      return;
    }

    // Yalnızca yeni eklenen veya durumu hala "eslesmemis" olan işlemler için çalış
    if (!beforeData && afterData.reconciliationStatus === 'eslesmemis') {
      logger.info(`[cariReconciliation] New unmatched BankTransaction detected: ${event.params.txId}. Starting auto-match logic...`);

      const db = admin.firestore();
      
      // Örnek: Aynı tutardaki "bekleyen" bir ödeme veya tahsilatla eşleşme denemesi yapılabilir.
      // const targetCollection = afterData.type === 'cikis' ? 'cariPayments' : 'cariInvoices/cariReceipts';
      
      try {
        // Otomatik eşleşme mantığı eklenecek alan:
        // const paymentsSnap = await db.collection('cariPayments').where('amount', '==', afterData.amount).get();
        // if (!paymentsSnap.empty) {
        //   await snap.after.ref.update({
        //     reconciliationStatus: 'eslesmis',
        //     matchedDocType: 'payment',
        //     matchedDocId: paymentsSnap.docs[0].id
        //   });
        // }
      } catch (error) {
        logger.error(`[cariReconciliation] Error auto-matching txId ${event.params.txId}:`, error);
      }
    }
  }
);
