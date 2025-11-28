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
exports.nfcLoginWithSerial = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const firebase_functions_1 = require("firebase-functions");
if (!admin.apps.length) {
    admin.initializeApp();
}
/**
 * Normalizes NFC serials by removing non-alphanumeric chars and uppercasing.
 */
function normalizeNfcId(raw) {
    if (typeof raw !== 'string')
        return '';
    return raw.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}
/**
 * Callable function to get a custom auth token for a given NFC serial.
 * This function can be called by an unauthenticated (anonymous) user.
 */
exports.nfcLoginWithSerial = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const rawSerial = data === null || data === void 0 ? void 0 : data.serial;
    if (!rawSerial || typeof rawSerial !== 'string' || rawSerial.length < 4) {
        throw new functions.https.HttpsError('invalid-argument', 'Geçerli bir seri numarası (serial) sağlanmalıdır.');
    }
    const serial = normalizeNfcId(rawSerial);
    try {
        const db = admin.firestore();
        const qs = await db
            .collection('users')
            .where('nfcId', '==', serial)
            .limit(1)
            .get();
        if (qs.empty) {
            throw new functions.https.HttpsError('not-found', 'Bu NFC kartıyla eşleşen bir kullanıcı bulunamadı.');
        }
        const userDoc = qs.docs[0];
        const uid = userDoc.id; // Doc ID is the UID
        const userData = userDoc.data() || {};
        const token = await admin.auth().createCustomToken(uid, { nfcLogin: true });
        return {
            token,
            uid,
            email: userData.email || null,
            name: userData.name || null,
        };
    }
    catch (e) {
        firebase_functions_1.logger.warn('nfcLoginWithSerial error', { serial, code: e === null || e === void 0 ? void 0 : e.code, msg: e === null || e === void 0 ? void 0 : e.message });
        if (e instanceof functions.https.HttpsError)
            throw e;
        firebase_functions_1.logger.error('nfcLoginWithSerial internal', { msg: e === null || e === void 0 ? void 0 : e.message, stack: e === null || e === void 0 ? void 0 : e.stack });
        throw new functions.https.HttpsError('internal', (e === null || e === void 0 ? void 0 : e.message) || 'Beklenmeyen hata');
    }
});
//# sourceMappingURL=nfc-login.js.map