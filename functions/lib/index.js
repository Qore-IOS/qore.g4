'use server';
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
exports.cleanupExpiredIrsaliyeDosyalari = exports.onNotificationCreated = exports.nfcLoginWithSerial = exports.mirrorPresenceToFirestore = exports.createCustomTokenForNfcUser = exports.revokeUserSessions = void 0;
const admin = __importStar(require("firebase-admin"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const functions = __importStar(require("firebase-functions"));
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
var revokeUserSessions_1 = require("./revokeUserSessions");
Object.defineProperty(exports, "revokeUserSessions", { enumerable: true, get: function () { return revokeUserSessions_1.revokeUserSessions; } });
var createCustomTokenForNfcUser_1 = require("./createCustomTokenForNfcUser");
Object.defineProperty(exports, "createCustomTokenForNfcUser", { enumerable: true, get: function () { return createCustomTokenForNfcUser_1.createCustomTokenForNfcUser; } });
var presence_1 = require("./presence");
Object.defineProperty(exports, "mirrorPresenceToFirestore", { enumerable: true, get: function () { return presence_1.mirrorPresenceToFirestore; } });
var nfc_login_1 = require("./nfc-login");
Object.defineProperty(exports, "nfcLoginWithSerial", { enumerable: true, get: function () { return nfc_login_1.nfcLoginWithSerial; } });
function chunk(arr, size = 500) {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
async function collectTargetUidsFromTargets(targets, actorUid) {
    const targetUids = new Set();
    const userQueries = targets.map((key) => {
        const [field, value] = key.split(':');
        if (!field || !value)
            return Promise.resolve(null);
        if (field === 'role')
            return db.collection('users').where('role', '==', value).get();
        if (field === 'lab')
            return db.collection('users').where('assignedLaboratories', 'array-contains', value).get();
        if (field === 'depot')
            return db.collection('users').where('assignedDepots', 'array-contains', value).get();
        if (field === 'view')
            return db.collection('users').where('accessibleViews', 'array-contains', value).get();
        if (field === 'user')
            return db.collection('users').where('uid', '==', value).get();
        return Promise.resolve(null);
    });
    const userSnaps = await Promise.all(userQueries);
    userSnaps.forEach((userSnap) => {
        userSnap === null || userSnap === void 0 ? void 0 : userSnap.docs.forEach((d) => {
            if (d.id && d.id !== actorUid) {
                targetUids.add(d.id);
            }
        });
    });
    return targetUids;
}
exports.onNotificationCreated = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .firestore.document('notifications/{id}')
    .onCreate(async (snap, context) => {
    var _a, _b, _c, _d, _e, _f;
    const notificationId = context.params.id;
    const data = snap.data();
    // Prepare log entry
    const logEntry = {
        notificationId,
        type: (data === null || data === void 0 ? void 0 : data.type) || 'unknown',
        channel: (data === null || data === void 0 ? void 0 : data.channel) || 'push',
        title: (data === null || data === void 0 ? void 0 : data.title) || '',
        targets: (data === null || data === void 0 ? void 0 : data.targets) || [],
        actor: (data === null || data === void 0 ? void 0 : data.actor) || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'processing',
        tokensMatched: 0,
        successCount: 0,
        failureCount: 0,
        errors: [],
    };
    try {
        if (!(data === null || data === void 0 ? void 0 : data.targets) || data.targets.length === 0) {
            logEntry.status = 'skipped';
            logEntry.errors.push('No targets specified');
            await db.collection('notificationLogs').add(logEntry);
            return;
        }
        // Skip non-push channels (e.g. sms-only notifications)
        if (data.channel && data.channel !== 'push') {
            logEntry.status = 'skipped';
            logEntry.errors.push(`Channel is "${data.channel}", skipping push delivery`);
            await db.collection('notificationLogs').add(logEntry);
            firebase_functions_1.logger.info(`[fanOut] Skipping ${notificationId}: channel=${data.channel}`);
            return;
        }
        firebase_functions_1.logger.info(`[fanOut] Processing ${notificationId}, targets: ${data.targets.join(', ')}`);
        // --- 1. Collect tokens from TWO sources ---
        const tokenMap = new Map();
        const notificationType = data.type || '';
        // Source A: pushTokens matching targets (role-based, lab-based, depot-based, user-based)
        const targetChunks = chunk(data.targets, 30);
        for (const targetChunk of targetChunks) {
            const tokensSnap = await db
                .collection('pushTokens')
                .where('membershipKeys', 'array-contains-any', targetChunk)
                .where('enabled', '==', true)
                .get();
            for (const tokenDoc of tokensSnap.docs) {
                const td = tokenDoc.data();
                if (td.token && !tokenMap.has(td.token)) {
                    tokenMap.set(td.token, { token: td.token, uid: td.uid || null, membershipKeys: td.membershipKeys || [] });
                }
            }
        }
        // Source B: Users who have this notification type in their notificationPreferences
        // This ensures non-admin users with the right preferences also receive notifications
        // BUT we must respect the target audience (e.g. only teknik_servis for teknik_servis faults)
        if (notificationType && notificationType !== 'custom') {
            // First collect target UIDs to filter Source B
            const targetUids = await collectTargetUidsFromTargets(data.targets, (_a = data.actor) === null || _a === void 0 ? void 0 : _a.uid);
            const prefsSnap = await db
                .collection('users')
                .where('notificationsEnabled', '==', true)
                .where('notificationPreferences', 'array-contains', notificationType)
                .get();
            // Collect UIDs of users who opted into this notification type AND match target audience
            const optedInUids = [];
            for (const userDoc of prefsSnap.docs) {
                // Only include if user is in target audience (role/lab/depot match)
                if (targetUids.has(userDoc.id)) {
                    optedInUids.push(userDoc.id);
                }
            }
            // Fetch their push tokens
            if (optedInUids.length > 0) {
                const uidChunks = chunk(optedInUids, 30);
                for (const uidChunk of uidChunks) {
                    const userTokensSnap = await db
                        .collection('pushTokens')
                        .where('uid', 'in', uidChunk)
                        .where('enabled', '==', true)
                        .get();
                    for (const tokenDoc of userTokensSnap.docs) {
                        const td = tokenDoc.data();
                        if (td.token && !tokenMap.has(td.token)) {
                            tokenMap.set(td.token, { token: td.token, uid: td.uid || null, membershipKeys: td.membershipKeys || [] });
                        }
                    }
                }
            }
        }
        // --- Strict filter for fault notifications ---
        // For fault_opened, a non-admin user must always match the fault role.
        // If hospitalId is provided, non-admin users must ALSO match the lab.
        if (data.type === 'fault_opened' && ((_b = data.meta) === null || _b === void 0 ? void 0 : _b.faultType)) {
            const requiredRole = `role:${data.meta.faultType}`;
            const requiredLab = ((_c = data.meta) === null || _c === void 0 ? void 0 : _c.hospitalId) ? `lab:${data.meta.hospitalId}` : null;
            let removedByStrictFilter = 0;
            for (const [key, tokenData] of tokenMap.entries()) {
                const keys = tokenData.membershipKeys || [];
                const isAdmin = keys.includes('role:admin');
                if (!isAdmin) {
                    const hasCorrectRole = keys.includes(requiredRole);
                    const hasCorrectLab = requiredLab ? keys.includes(requiredLab) : true;
                    if (!hasCorrectRole || !hasCorrectLab) {
                        tokenMap.delete(key);
                        removedByStrictFilter++;
                    }
                }
            }
            firebase_functions_1.logger.info(`[fanOut] Fault strict filter: removed ${removedByStrictFilter} tokens (require ${requiredRole}${requiredLab ? ` AND ${requiredLab}` : ''})`);
        }
        const tokens = Array.from(tokenMap.values());
        logEntry.tokensMatched = tokens.length;
        if (tokens.length === 0) {
            logEntry.status = 'no_tokens';
            logEntry.errors.push('No matching push tokens found for targets or preferences');
            await db.collection('notificationLogs').add(logEntry);
            firebase_functions_1.logger.warn(`[fanOut] No tokens matched for ${notificationId}`);
            return;
        }
        // --- 2. Filter tokens by user notification preferences ---
        // Fetch user profiles for preference-based filtering
        const uniqueUids = new Set(tokens.map(t => t.uid).filter((uid) => !!uid));
        const userPrefsMap = new Map();
        const uidArr = Array.from(uniqueUids);
        const uidBatches = chunk(uidArr, 30);
        for (const uidBatch of uidBatches) {
            const refs = uidBatch.map(uid => db.collection('users').doc(uid));
            const docs = await db.getAll(...refs);
            for (const userDoc of docs) {
                if (userDoc.exists) {
                    const ud = userDoc.data();
                    userPrefsMap.set(userDoc.id, {
                        enabled: ud.notificationsEnabled !== false,
                        prefs: ud.notificationPreferences || [],
                        name: ud.displayName || ud.name || ud.email || userDoc.id,
                        role: ud.role || 'unknown',
                    });
                }
            }
        }
        // Filter: remove tokens for users who explicitly disabled notifications or excluded this type
        const filteredTokens = tokens.filter(t => {
            if (!t.uid)
                return true; // No uid = allow (anonymous token)
            const prefs = userPrefsMap.get(t.uid);
            if (!prefs)
                return true; // No user doc found = allow
            // User explicitly disabled all notifications
            if (!prefs.enabled)
                return false;
            // If user has specific preferences set, check if this type is included
            // Empty prefs array = no preferences configured yet = allow all (backwards compat)
            if (prefs.prefs.length > 0 && notificationType !== 'custom' && !prefs.prefs.includes(notificationType)) {
                return false;
            }
            return true;
        });
        logEntry.tokensAfterPrefs = filteredTokens.length;
        logEntry.tokensFilteredByPrefs = tokens.length - filteredTokens.length;
        if (filteredTokens.length === 0) {
            logEntry.status = 'filtered_by_prefs';
            logEntry.errors.push('All tokens filtered out by user notification preferences');
            await db.collection('notificationLogs').add(logEntry);
            firebase_functions_1.logger.info(`[fanOut] All ${tokens.length} tokens filtered by preferences for ${notificationId}`);
            return;
        }
        // Build recipient list for logging
        const recipients = filteredTokens.map(t => {
            const userInfo = t.uid ? userPrefsMap.get(t.uid) : null;
            return {
                uid: t.uid || 'anonymous',
                name: (userInfo === null || userInfo === void 0 ? void 0 : userInfo.name) || 'unknown',
                role: (userInfo === null || userInfo === void 0 ? void 0 : userInfo.role) || 'unknown',
                tokenPrefix: t.token.slice(0, 8),
            };
        });
        logEntry.recipients = recipients;
        firebase_functions_1.logger.info(`[fanOut] ${notificationId}: ${filteredTokens.length}/${tokens.length} tokens. Recipients: ${recipients.map(r => `${r.name} (${r.role})`).join(', ')}`);
        // --- 3. Build FCM message ---
        // Use data-only message to prevent duplicate notifications.
        // With a 'notification' field, FCM auto-displays one notification AND
        // the service worker's onBackgroundMessage shows another = 2 notifications.
        // Data-only messages let the service worker handle display exclusively.
        const baseUrl = 'https://qorengine.com';
        const isFaultOpened = data.type === 'fault_opened';
        const deviceImageUrl = ((_d = data.meta) === null || _d === void 0 ? void 0 : _d.deviceImageUrl) || null;
        const faultReportId = ((_e = data.meta) === null || _e === void 0 ? void 0 : _e.faultReportId) || null;
        // Build webpush notification options
        const webpushNotification = {
            icon: deviceImageUrl || '/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG',
            badge: '/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG',
            tag: notificationId,
            requireInteraction: isFaultOpened, // Keep fault notifications visible until interaction
        };
        // Add image (large image in notification) for fault notifications with device image
        if (isFaultOpened && deviceImageUrl) {
            webpushNotification.image = deviceImageUrl;
        }
        // Add action buttons for fault notifications
        if (isFaultOpened && faultReportId) {
            webpushNotification.actions = [
                {
                    action: 'assign_fault',
                    title: 'Arızayı Üzerime Al',
                },
                {
                    action: 'view_fault',
                    title: 'Görüntüle',
                },
            ];
        }
        const fcmMessage = {
            tokens: filteredTokens.map(t => t.token),
            notification: Object.assign({ title: data.title, body: data.message }, (isFaultOpened && deviceImageUrl ? { imageUrl: deviceImageUrl } : {})),
            data: Object.assign(Object.assign({ notificationId, title: data.title || '', body: data.message || '', type: data.type || '', href: data.href || '/', link: data.href ? `${baseUrl}${data.href}` : baseUrl }, (faultReportId ? { faultReportId } : {})), (((_f = data.meta) === null || _f === void 0 ? void 0 : _f.faultType) ? { faultType: data.meta.faultType } : {})),
            webpush: {
                notification: webpushNotification,
                fcmOptions: {
                    link: data.href ? `${baseUrl}${data.href}` : baseUrl,
                },
            },
        };
        // --- 3. Send via FCM (in batches of 500) ---
        const tokenBatches = chunk(filteredTokens.map(t => t.token), 500);
        let totalSuccess = 0;
        let totalFailure = 0;
        const staleTokens = [];
        for (const batch of tokenBatches) {
            const batchMessage = Object.assign(Object.assign({}, fcmMessage), { tokens: batch });
            const response = await admin.messaging().sendEachForMulticast(batchMessage);
            totalSuccess += response.successCount;
            totalFailure += response.failureCount;
            // Collect stale/invalid tokens for cleanup
            response.responses.forEach((resp, idx) => {
                if (resp.error) {
                    const code = resp.error.code;
                    // These error codes indicate the token is no longer valid
                    if (code === 'messaging/registration-token-not-registered' ||
                        code === 'messaging/invalid-registration-token' ||
                        code === 'messaging/invalid-argument') {
                        staleTokens.push(batch[idx]);
                    }
                    // Log first few errors for debugging
                    if (logEntry.errors.length < 10) {
                        logEntry.errors.push(`Token ${batch[idx].slice(0, 8)}...: ${code} - ${resp.error.message}`);
                    }
                }
            });
        }
        logEntry.successCount = totalSuccess;
        logEntry.failureCount = totalFailure;
        logEntry.status = totalSuccess > 0 ? 'sent' : 'failed';
        logEntry.staleTokensRemoved = staleTokens.length;
        firebase_functions_1.logger.info(`[fanOut] ${notificationId}: sent=${totalSuccess}, failed=${totalFailure}, stale=${staleTokens.length}`);
        // --- 4. Cleanup stale tokens ---
        if (staleTokens.length > 0) {
            const cleanupBatches = chunk(staleTokens, 500);
            for (const batch of cleanupBatches) {
                const writeBatch = db.batch();
                for (const token of batch) {
                    writeBatch.delete(db.collection('pushTokens').doc(token));
                    // Also try to clean from user subcollection
                    const tokenData = tokenMap.get(token);
                    if (tokenData === null || tokenData === void 0 ? void 0 : tokenData.uid) {
                        writeBatch.delete(db.doc(`users/${tokenData.uid}/pushTokens/${token}`));
                    }
                }
                await writeBatch.commit();
            }
            firebase_functions_1.logger.info(`[fanOut] Cleaned up ${staleTokens.length} stale tokens`);
        }
    }
    catch (error) {
        logEntry.status = 'error';
        logEntry.errors.push(error.message || String(error));
        firebase_functions_1.logger.error(`[fanOut] Error processing ${notificationId}:`, error);
    }
    // --- 5. Write log entry ---
    try {
        await db.collection('notificationLogs').add(logEntry);
    }
    catch (logError) {
        firebase_functions_1.logger.error(`[fanOut] Failed to write log for ${notificationId}:`, logError);
    }
});
// --- İRSALİYE DOSYA TEMİZLEME (1 hafta sonra otomatik silme) ---
// Her gün gece yarısı çalışır (Europe/Istanbul timezone)
exports.cleanupExpiredIrsaliyeDosyalari = (0, scheduler_1.onSchedule)({
    schedule: 'every day 02:00',
    timeZone: 'Europe/Istanbul',
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '256MiB',
}, async () => {
    const now = admin.firestore.Timestamp.now();
    const bucket = admin.storage().bucket();
    try {
        const expiredDocs = await db
            .collection('irsaliyeDosyalari')
            .where('expiresAt', '<=', now)
            .get();
        if (expiredDocs.empty) {
            firebase_functions_1.logger.info('No expired invoice files found.');
            return;
        }
        firebase_functions_1.logger.info(`Found ${expiredDocs.size} expired invoice files to clean up.`);
        const batches = chunk(expiredDocs.docs);
        for (const batch of batches) {
            const writeBatch = db.batch();
            for (const docSnap of batch) {
                const data = docSnap.data();
                // Delete from Storage
                if (data.storagePath) {
                    try {
                        await bucket.file(data.storagePath).delete();
                        firebase_functions_1.logger.info(`Deleted storage file: ${data.storagePath}`);
                    }
                    catch (e) {
                        firebase_functions_1.logger.warn(`Storage file not found or already deleted: ${data.storagePath}`);
                    }
                }
                // Delete from Firestore
                writeBatch.delete(docSnap.ref);
            }
            await writeBatch.commit();
        }
        firebase_functions_1.logger.info(`Successfully cleaned up ${expiredDocs.size} expired invoice files.`);
    }
    catch (error) {
        firebase_functions_1.logger.error('Error cleaning up expired invoice files:', error);
    }
});
//# sourceMappingURL=index.js.map