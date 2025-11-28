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
exports.mirrorPresenceToFirestore = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length) {
    admin.initializeApp();
}
/**
 * Mirrors RTDB /status/{uid} -> Firestore /presence/{uid}.
 * This is triggered whenever a user's connection state changes in the Realtime Database.
 */
exports.mirrorPresenceToFirestore = functions
    .region('europe-west1')
    .database.ref('/status/{uid}')
    .onWrite(async (change, context) => {
    const uid = context.params.uid;
    // If the data is deleted (e.g., user logs out cleanly), mark as offline.
    const val = change.after.exists() ? change.after.val() : null;
    const state = (val === null || val === void 0 ? void 0 : val.state) === 'online' ? 'online' : 'offline';
    const lastChangedMs = typeof (val === null || val === void 0 ? void 0 : val.lastChanged) === 'number' ? val.lastChanged : Date.now();
    const fsRef = admin.firestore().doc(`presence/${uid}`);
    try {
        await fsRef.set({
            state,
            lastChanged: admin.firestore.Timestamp.fromMillis(lastChangedMs),
        }, { merge: true });
        console.log(`Presence for ${uid} mirrored to Firestore: ${state}`);
    }
    catch (error) {
        console.error(`Error mirroring presence for ${uid} to Firestore:`, error);
    }
    return null;
});
//# sourceMappingURL=presence.js.map