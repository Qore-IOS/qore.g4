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
exports.onBankTransactionWritten = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
/**
 * Otomatik Mutabakat Trigger'ı:
 * Yeni bir cariBankTransactions belgesi eklendiğinde veya güncellendiğinde,
 * durumu "eslesmemis" ise sistemdeki faturalar, ödemeler veya tahsilatlarla
 * tutar ve tarih bazlı bir "fuzzy match" dener.
 *
 * (Gelişmiş eşleşme algoritması buraya eklenebilir. Şu an temel bir loglama ve
 * altyapı iskeleti kurulmuştur.)
 */
exports.onBankTransactionWritten = (0, firestore_1.onDocumentWritten)({
    document: 'cariBankTransactions/{txId}',
    region: 'europe-west1',
}, async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const afterData = snap.after.exists ? snap.after.data() : null;
    const beforeData = snap.before.exists ? snap.before.data() : null;
    if (!afterData) {
        // Belge silindi
        firebase_functions_1.logger.info(`[cariReconciliation] BankTransaction deleted: ${event.params.txId}`);
        return;
    }
    // Yalnızca yeni eklenen veya durumu hala "eslesmemis" olan işlemler için çalış
    if (!beforeData && afterData.reconciliationStatus === 'eslesmemis') {
        firebase_functions_1.logger.info(`[cariReconciliation] New unmatched BankTransaction detected: ${event.params.txId}. Starting auto-match logic...`);
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
        }
        catch (error) {
            firebase_functions_1.logger.error(`[cariReconciliation] Error auto-matching txId ${event.params.txId}:`, error);
        }
    }
});
//# sourceMappingURL=cariReconciliation.js.map