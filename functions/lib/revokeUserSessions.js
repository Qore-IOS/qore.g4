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
exports.revokeUserSessions = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length)
    admin.initializeApp();
// Set your region once here (keep in sync with client):
const WITH_REGION = functions.region('europe-west1');
async function isAdmin(uid) {
    var _a;
    try {
        const userRec = await admin.auth().getUser(uid);
        // Prefer custom claim if present
        if (((_a = userRec.customClaims) === null || _a === void 0 ? void 0 : _a.admin) === true)
            return true;
    }
    catch ( /* ignore */_b) { /* ignore */ }
    // Fallback to Firestore role check
    try {
        const snap = await admin.firestore().doc(`users/${uid}`).get();
        const role = snap.get('role');
        return role === 'admin';
    }
    catch (_c) {
        return false;
    }
}
exports.revokeUserSessions = WITH_REGION.https.onCall(async (data, context) => {
    var _a;
    try {
        // 1) Auth check
        const callerUid = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid;
        if (!callerUid) {
            throw new functions.https.HttpsError('unauthenticated', 'Giriş gerekli.');
        }
        // 2) Admin check (claims or Firestore fallback)
        const adminOk = await isAdmin(callerUid);
        if (!adminOk) {
            throw new functions.https.HttpsError('permission-denied', 'Yalnızca adminler oturum sonlandırabilir.');
        }
        // 3) Args check
        const uids = data === null || data === void 0 ? void 0 : data.uids;
        if (!Array.isArray(uids) || uids.length === 0 || uids.some((x) => typeof x !== 'string' || !x)) {
            throw new functions.https.HttpsError('invalid-argument', 'Geçerli bir uid listesi (string[]) gönderin.');
        }
        // 4) Do work
        const failed = [];
        await Promise.all(uids.map(async (id) => {
            try {
                await admin.auth().revokeRefreshTokens(id);
            }
            catch (e) {
                failed.push(id);
            }
        }));
        return {
            success: failed.length === 0,
            processed: uids.length - failed.length,
            failed,
        };
    }
    catch (err) {
        // Known HttpsError? rethrow it.
        if (err instanceof functions.https.HttpsError)
            throw err;
        // Unknown errors -> INTERNAL with safe message
        console.error('revokeUserSessions error', err);
        throw new functions.https.HttpsError('internal', 'Sunucu hatası: revokeUserSessions tamamlanamadı.');
    }
});
//# sourceMappingURL=revokeUserSessions.js.map