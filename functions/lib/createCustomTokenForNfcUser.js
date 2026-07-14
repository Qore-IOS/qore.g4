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
exports.createCustomTokenForNfcUser = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const auth = admin.auth();
const REGION = 'europe-west1';
/**
 * Creates a custom authentication token for a user identified by an NFC ID.
 * This function can be called by an unauthenticated client.
 */
exports.createCustomTokenForNfcUser = functions
    .region(REGION)
    .https.onCall(async (data, context) => {
    // 1. Validate Input
    const nfcId = data.nfcId;
    if (typeof nfcId !== 'string' || !nfcId.trim()) {
        throw new functions.https.HttpsError('invalid-argument', 'Geçerli bir NFC ID (nfcId) sağlanmalıdır.');
    }
    // 2. Find User by NFC ID
    const usersRef = db.collection('users');
    const query = usersRef.where('nfcId', '==', nfcId.trim()).limit(1);
    const snapshot = await query.get();
    if (snapshot.empty) {
        throw new functions.https.HttpsError('not-found', 'Bu NFC kartıyla eşleşen bir kullanıcı bulunamadı.');
    }
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    const uid = userDoc.id; // The document ID is the user's UID
    // 3. Create Custom Token
    try {
        const customToken = await auth.createCustomToken(uid);
        // 4. Return the token and user data to the client
        return {
            token: customToken,
            user: {
                uid: uid,
                name: userData.name || null,
                email: userData.email || null,
                role: userData.role || 'user',
            }
        };
    }
    catch (error) {
        console.error('Error creating custom token:', error);
        throw new functions.https.HttpsError('internal', 'Kullanıcı oturumu oluşturulurken bir sunucu hatası oluştu.');
    }
});
//# sourceMappingURL=createCustomTokenForNfcUser.js.map