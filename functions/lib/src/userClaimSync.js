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
exports.onUserClaimSync = void 0;
/**
 * Multi-tenancy custom claim sync (Faz 2).
 *
 * Firestore `users/{uid}` dokümanına her yazma sonrası, ilgili Firebase Auth
 * kullanıcısının custom claim'lerini (`companyId`, `role`, `isSuperAdmin`)
 * günceller. Bu claim'ler Firestore Security Rules (Faz 6) için kritiktir —
 * Rules'ta `request.auth.token.companyId` ve `request.auth.token.isSuperAdmin`
 * okunur.
 *
 * Idempotent: ilgili alanlar değişmediyse no-op.
 */
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const firebase_functions_1 = require("firebase-functions");
function buildClaim(data) {
    if (!data) {
        return { companyId: null, role: null, isSuperAdmin: false };
    }
    const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
    const role = typeof data.role === 'string' ? data.role : null;
    return {
        companyId: companyId || null,
        role,
        isSuperAdmin: role === 'super_admin',
    };
}
function claimsEqual(a, b) {
    return a.companyId === b.companyId && a.role === b.role && a.isSuperAdmin === b.isSuperAdmin;
}
exports.onUserClaimSync = functions.firestore
    .document('users/{uid}')
    .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const after = change.after.exists ? change.after.data() : null;
    if (!after) {
        // Doc silindi — Auth user'ı zaten silinmiş olabilir. Claim sync yapmıyoruz.
        return;
    }
    const before = change.before.exists ? change.before.data() : null;
    const beforeClaim = buildClaim(before);
    const afterClaim = buildClaim(after);
    if (before && claimsEqual(beforeClaim, afterClaim)) {
        // İlgili alanlar değişmedi.
        return;
    }
    try {
        await admin.auth().setCustomUserClaims(uid, afterClaim);
        firebase_functions_1.logger.info(`Custom claims updated for ${uid}`, afterClaim);
    }
    catch (err) {
        if (err && err.code === 'auth/user-not-found') {
            firebase_functions_1.logger.warn(`Auth user not found for uid=${uid}; skipping claim sync.`);
            return;
        }
        firebase_functions_1.logger.error(`Failed to set custom claims for ${uid}:`, err);
        throw err;
    }
});
//# sourceMappingURL=userClaimSync.js.map