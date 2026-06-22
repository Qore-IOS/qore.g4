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
exports.cleanupExpiredIrsaliyeDosyalari = exports.maintenanceUpcomingReminder = exports.faultInterventionReminder = exports.onNotificationCreated = exports.onShortcutRunRequestCreated = exports.shortcutScheduler = exports.onBankTransactionWritten = exports.backfillCompanyStats = exports.dailyStatsRollover = exports.onFaultWritten = exports.onShipmentWritten = exports.onTuketimWritten = exports.onDepoStokWritten = exports.onUserClaimSync = exports.onDepoStokAccepted = exports.onPeripheralOrderCreatedSendWhatsApp = exports.onPeripheralOrderCreatedSendMail = exports.onDeviceFaultReportResolved = exports.onAplikasyonFormCreated = exports.onTeknikServisFormCreated = exports.nfcLoginWithSerial = exports.mirrorPresenceToFirestore = exports.createCustomTokenForNfcUser = exports.revokeUserSessions = void 0;
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
var actionFormEmailNotification_1 = require("./actionFormEmailNotification");
Object.defineProperty(exports, "onTeknikServisFormCreated", { enumerable: true, get: function () { return actionFormEmailNotification_1.onTeknikServisFormCreated; } });
Object.defineProperty(exports, "onAplikasyonFormCreated", { enumerable: true, get: function () { return actionFormEmailNotification_1.onAplikasyonFormCreated; } });
var faultReportNotification_1 = require("./faultReportNotification");
Object.defineProperty(exports, "onDeviceFaultReportResolved", { enumerable: true, get: function () { return faultReportNotification_1.onDeviceFaultReportResolved; } });
var orderCreatedPeripheralEmail_1 = require("./orderCreatedPeripheralEmail");
Object.defineProperty(exports, "onPeripheralOrderCreatedSendMail", { enumerable: true, get: function () { return orderCreatedPeripheralEmail_1.onPeripheralOrderCreatedSendMail; } });
var peripheralOrderWhatsApp_1 = require("./peripheralOrderWhatsApp");
Object.defineProperty(exports, "onPeripheralOrderCreatedSendWhatsApp", { enumerable: true, get: function () { return peripheralOrderWhatsApp_1.onPeripheralOrderCreatedSendWhatsApp; } });
var peripheralOrderReconcile_1 = require("./peripheralOrderReconcile");
Object.defineProperty(exports, "onDepoStokAccepted", { enumerable: true, get: function () { return peripheralOrderReconcile_1.onDepoStokAccepted; } });
var userClaimSync_1 = require("./userClaimSync");
Object.defineProperty(exports, "onUserClaimSync", { enumerable: true, get: function () { return userClaimSync_1.onUserClaimSync; } });
var companyStatsAggregation_1 = require("./companyStatsAggregation");
Object.defineProperty(exports, "onDepoStokWritten", { enumerable: true, get: function () { return companyStatsAggregation_1.onDepoStokWritten; } });
Object.defineProperty(exports, "onTuketimWritten", { enumerable: true, get: function () { return companyStatsAggregation_1.onTuketimWritten; } });
Object.defineProperty(exports, "onShipmentWritten", { enumerable: true, get: function () { return companyStatsAggregation_1.onShipmentWritten; } });
Object.defineProperty(exports, "onFaultWritten", { enumerable: true, get: function () { return companyStatsAggregation_1.onFaultWritten; } });
Object.defineProperty(exports, "dailyStatsRollover", { enumerable: true, get: function () { return companyStatsAggregation_1.dailyStatsRollover; } });
Object.defineProperty(exports, "backfillCompanyStats", { enumerable: true, get: function () { return companyStatsAggregation_1.backfillCompanyStats; } });
var cariReconciliation_1 = require("./cariReconciliation");
Object.defineProperty(exports, "onBankTransactionWritten", { enumerable: true, get: function () { return cariReconciliation_1.onBankTransactionWritten; } });
var shortcutScheduler_1 = require("./shortcutScheduler");
Object.defineProperty(exports, "shortcutScheduler", { enumerable: true, get: function () { return shortcutScheduler_1.shortcutScheduler; } });
Object.defineProperty(exports, "onShortcutRunRequestCreated", { enumerable: true, get: function () { return shortcutScheduler_1.onShortcutRunRequestCreated; } });
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
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
        // Multi-tenancy: only deliver to users in the same company as the source.
        // If the notification has no companyId (legacy), don't filter on company.
        const sourceCompanyId = typeof data.companyId === 'string' && data.companyId.trim()
            ? data.companyId.trim()
            : null;
        // Source A: pushTokens matching targets (role-based, lab-based, depot-based, user-based).
        // pushTokens may carry companyId (Faz 1 backfill); if available, prefilter by it to
        // avoid cross-tenant token reads. We still re-check in the final filter via the user doc.
        const targetChunks = chunk(data.targets, 30);
        for (const targetChunk of targetChunks) {
            let pushTokensQuery = db
                .collection('pushTokens')
                .where('membershipKeys', 'array-contains-any', targetChunk)
                .where('enabled', '==', true);
            if (sourceCompanyId) {
                pushTokensQuery = pushTokensQuery.where('companyId', '==', sourceCompanyId);
            }
            const tokensSnap = await pushTokensQuery.get();
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
            let prefsQuery = db
                .collection('users')
                .where('notificationsEnabled', '==', true)
                .where('notificationPreferences', 'array-contains', notificationType);
            if (sourceCompanyId) {
                prefsQuery = prefsQuery.where('companyId', '==', sourceCompanyId);
            }
            const prefsSnap = await prefsQuery.get();
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
        // Collect user-specific targets (user:uid) — these are direct messages that
        // must be delivered regardless of the recipient's preference settings.
        const directTargetUids = new Set(data.targets
            .filter((t) => t.startsWith('user:'))
            .map((t) => t.split(':')[1])
            .filter(Boolean));
        // --- 2. Filter tokens by user notification preferences + companyId ---
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
                    const userCompanyId = typeof ud.companyId === 'string' && ud.companyId.trim()
                        ? ud.companyId.trim()
                        : null;
                    userPrefsMap.set(userDoc.id, {
                        enabled: ud.notificationsEnabled !== false,
                        prefs: ud.notificationPreferences || [],
                        name: ud.displayName || ud.name || ud.email || userDoc.id,
                        role: ud.role || 'unknown',
                        companyId: userCompanyId,
                    });
                }
            }
        }
        // Filter: remove tokens for users who explicitly disabled notifications,
        // excluded this type, or belong to a different tenant than the source.
        let removedByCompanyFilter = 0;
        const filteredTokens = tokens.filter(t => {
            if (!t.uid)
                return true; // No uid = allow (anonymous token)
            const prefs = userPrefsMap.get(t.uid);
            if (!prefs)
                return true; // No user doc found = allow
            // Multi-tenancy isolation: if both source and user carry a companyId,
            // they must match. Either side missing → fall through (legacy compat).
            if (sourceCompanyId && prefs.companyId && prefs.companyId !== sourceCompanyId) {
                removedByCompanyFilter++;
                return false;
            }
            // User explicitly disabled all notifications
            if (!prefs.enabled)
                return false;
            // Direct user-specific notifications (user:uid target) bypass preference filtering.
            // These are personal messages (e.g. spare_part_transfer, maliyet_sayim_davet) that
            // should always reach the intended recipient as long as notifications are enabled.
            if (directTargetUids.has(t.uid))
                return true;
            // If user has specific preferences set, check if this type is included
            // Empty prefs array = no preferences configured yet = allow all (backwards compat)
            if (prefs.prefs.length > 0 && notificationType !== 'custom' && !prefs.prefs.includes(notificationType)) {
                return false;
            }
            return true;
        });
        if (removedByCompanyFilter > 0) {
            firebase_functions_1.logger.info(`[fanOut] Company filter removed ${removedByCompanyFilter} tokens for ${notificationId} (sourceCompanyId=${sourceCompanyId})`);
        }
        logEntry.tokensFilteredByCompany = removedByCompanyFilter;
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
            data: Object.assign(Object.assign(Object.assign({ notificationId, title: data.title || '', body: data.message || '', type: data.type || '', href: data.href || '/', link: data.href ? `${baseUrl}${data.href}` : baseUrl }, (faultReportId ? { faultReportId } : {})), (((_f = data.meta) === null || _f === void 0 ? void 0 : _f.faultType) ? { faultType: data.meta.faultType } : {})), (data.type === 'external_stock_usage' ? {
                sourceType: ((_g = data.meta) === null || _g === void 0 ? void 0 : _g.sourceType) || '',
                sourceName: ((_h = data.meta) === null || _h === void 0 ? void 0 : _h.sourceName) || '',
                stokKodu: ((_j = data.meta) === null || _j === void 0 ? void 0 : _j.stokKodu) || '',
                stokAdi: ((_k = data.meta) === null || _k === void 0 ? void 0 : _k.stokAdi) || '',
                quantity: String(((_l = data.meta) === null || _l === void 0 ? void 0 : _l.quantity) || ''),
            } : {})),
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
// --- ARIZA HATIRLATICI (4 saat+ müdahale bekleyen arızalar) ---
// Her saat çalışır, mudahale_bekliyor veya mudahale_ediliyor durumunda 4+ saat kalan
// arızalar için üzerine alan personele bildirim gönderir.
exports.faultInterventionReminder = (0, scheduler_1.onSchedule)({
    schedule: 'every 1 hours',
    timeZone: 'Europe/Istanbul',
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '256MiB',
}, async () => {
    var _a, _b;
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const now = Date.now();
    const fourHoursAgo = admin.firestore.Timestamp.fromMillis(now - FOUR_HOURS_MS);
    try {
        // Query faults that are in mudahale_bekliyor or mudahale_ediliyor status
        // and have been assigned more than 4 hours ago
        const [bekleyenSnap, ediliyorSnap] = await Promise.all([
            db.collection('deviceFaultReports')
                .where('status', '==', 'mudahale_bekliyor')
                .where('assignedAt', '<=', fourHoursAgo)
                .get(),
            db.collection('deviceFaultReports')
                .where('status', '==', 'mudahale_ediliyor')
                .where('assignedAt', '<=', fourHoursAgo)
                .get(),
        ]);
        const allDocs = [...bekleyenSnap.docs, ...ediliyorSnap.docs];
        if (allDocs.length === 0) {
            firebase_functions_1.logger.info('[faultReminder] No faults awaiting intervention for 4+ hours.');
            return;
        }
        firebase_functions_1.logger.info(`[faultReminder] Found ${allDocs.length} faults awaiting intervention for 4+ hours.`);
        // Check which faults have already been reminded recently (within last 4 hours)
        // to avoid spamming the same person every hour
        const REMINDER_COOLDOWN_MS = 4 * 60 * 60 * 1000;
        const cooldownThreshold = admin.firestore.Timestamp.fromMillis(now - REMINDER_COOLDOWN_MS);
        for (const faultDoc of allDocs) {
            const data = faultDoc.data();
            const assignedToUid = data.assignedToUid;
            const assignedToName = data.assignedToName || 'Personel';
            if (!assignedToUid) {
                firebase_functions_1.logger.warn(`[faultReminder] Fault ${faultDoc.id} has no assignedToUid, skipping.`);
                continue;
            }
            // Check cooldown - skip if reminder was sent recently
            const lastReminderAt = data.lastFaultReminderAt;
            if (lastReminderAt && lastReminderAt.toMillis() > cooldownThreshold.toMillis()) {
                firebase_functions_1.logger.info(`[faultReminder] Fault ${faultDoc.id} already reminded recently, skipping.`);
                continue;
            }
            // Calculate how long the fault has been waiting
            const assignedAtMs = ((_b = (_a = data.assignedAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) || now;
            const waitingHours = Math.floor((now - assignedAtMs) / (60 * 60 * 1000));
            const statusLabel = data.status === 'mudahale_bekliyor'
                ? 'müdahale bekliyor'
                : 'müdahale ediliyor';
            const deviceName = data.model || data.deviceName || 'Bilinmeyen Cihaz';
            const labName = data.labName || '';
            const faultId = faultDoc.id;
            // Create notification for the assigned personnel.
            // Propagate companyId from the source fault so the notification
            // stays scoped to the same tenant (Faz 6 Security Rules need this).
            const sourceCompanyId = typeof data.companyId === 'string' && data.companyId.trim()
                ? data.companyId.trim()
                : null;
            const notificationData = {
                type: 'fault_reminder',
                title: `Arıza Hatırlatma: ${deviceName}`,
                message: `${labName ? labName + ' - ' : ''}${deviceName} cihazı için açılan arıza ${waitingHours} saattir "${statusLabel}" durumunda bekliyor. Lütfen arızayı kontrol ediniz.`,
                href: `/ariza-yonetimi/${faultId}`,
                resource: { type: 'device', id: data.deviceId || '' },
                actor: { uid: 'system', name: 'Sistem' },
                targets: [`user:${assignedToUid}`],
                meta: {
                    faultReportId: faultId,
                    assignedToUid,
                    assignedToName,
                    deviceName,
                    labName,
                    waitingHours,
                    status: data.status,
                },
                channel: 'push',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                readBy: [],
            };
            if (sourceCompanyId)
                notificationData.companyId = sourceCompanyId;
            await db.collection('notifications').add(notificationData);
            // Update the fault document to track last reminder time
            await faultDoc.ref.update({
                lastFaultReminderAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            firebase_functions_1.logger.info(`[faultReminder] Sent reminder for fault ${faultId} to ${assignedToName} (${assignedToUid}), waiting ${waitingHours}h in "${statusLabel}".`);
        }
        firebase_functions_1.logger.info(`[faultReminder] Completed. Processed ${allDocs.length} faults.`);
    }
    catch (error) {
        firebase_functions_1.logger.error('[faultReminder] Error processing fault reminders:', error);
    }
});
// --- PERİYODİK BAKIM HATIRLATICI (7 gün kala) ---
// Her gün sabah 08:00 çalışır. Bir cihaza tanımlı bakım planının bir sonraki
// planlanan tarihine 7 gün veya daha az kalmışsa, plan.type (teknik_servis /
// aplikasyon) rolündeki ve cihazın bulunduğu laboratuvara atanmış personellere
// hem sistem içi hem de push bildirim gönderir. Tek bir bakım için tekrar
// bildirim göndermemek üzere her plan dokümanına lastMaintenanceReminderAt
// yazılır ve bu alanı 6 gün içinde güncellenmiş planlar atlanır.
exports.maintenanceUpcomingReminder = (0, scheduler_1.onSchedule)({
    schedule: 'every day 08:00',
    timeZone: 'Europe/Istanbul',
    region: 'europe-west1',
    timeoutSeconds: 300,
    memory: '256MiB',
}, async () => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const SIX_DAYS_MS = 6 * MS_PER_DAY;
    const now = Date.now();
    const cooldownCutoff = admin.firestore.Timestamp.fromMillis(now - SIX_DAYS_MS);
    try {
        const plansSnap = await db.collection('maintenancePlans').get();
        if (plansSnap.empty) {
            firebase_functions_1.logger.info('[maintReminder] No maintenance plans found.');
            return;
        }
        // Preload all maintenance logs and bucket latest per planId
        const logsSnap = await db.collection('maintenanceLogs').get();
        const latestLogByPlanId = new Map();
        for (const logDoc of logsSnap.docs) {
            const ld = logDoc.data();
            if (!ld.planId || !ld.nextDueDate)
                continue;
            const current = latestLogByPlanId.get(ld.planId);
            const thisCompleted = ((_b = (_a = ld.completedAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) || 0;
            const curCompleted = ((_d = (_c = current === null || current === void 0 ? void 0 : current.completedAt) === null || _c === void 0 ? void 0 : _c.toMillis) === null || _d === void 0 ? void 0 : _d.call(_c)) || 0;
            if (!current || thisCompleted > curCompleted) {
                latestLogByPlanId.set(ld.planId, ld);
            }
        }
        // Caches
        const usersByRole = new Map();
        const loadUsersByRole = async (role) => {
            if (usersByRole.has(role))
                return usersByRole.get(role);
            const usersSnap = await db.collection('users').where('role', '==', role).get();
            const list = usersSnap.docs.map((d) => {
                const ud = d.data();
                return {
                    uid: d.id,
                    assignedLaboratories: ud.assignedLaboratories || [],
                    name: ud.displayName || ud.name || ud.email || d.id,
                };
            });
            usersByRole.set(role, list);
            return list;
        };
        const deviceCache = new Map();
        const loadDevice = async (deviceId) => {
            if (deviceCache.has(deviceId))
                return deviceCache.get(deviceId);
            const snap = await db.collection('devices').doc(deviceId).get();
            const data = snap.exists ? snap.data() : null;
            deviceCache.set(deviceId, data);
            return data;
        };
        let processed = 0;
        let notified = 0;
        for (const planDoc of plansSnap.docs) {
            processed++;
            const plan = planDoc.data();
            const planId = planDoc.id;
            if (!plan.deviceId)
                continue;
            const role = plan.type;
            if (role !== 'teknik_servis' && role !== 'aplikasyon')
                continue;
            // Cooldown: skip plans already reminded within the last 6 days
            const lastReminderAt = plan.lastMaintenanceReminderAt;
            if (lastReminderAt && typeof lastReminderAt.toMillis === 'function' &&
                lastReminderAt.toMillis() > cooldownCutoff.toMillis()) {
                continue;
            }
            // Determine next due date
            const latestLog = latestLogByPlanId.get(planId);
            let nextDue = null;
            if (latestLog === null || latestLog === void 0 ? void 0 : latestLog.nextDueDate) {
                nextDue = ((_f = (_e = latestLog.nextDueDate).toDate) === null || _f === void 0 ? void 0 : _f.call(_e)) ||
                    (typeof latestLog.nextDueDate === 'string' ? new Date(latestLog.nextDueDate) : null);
            }
            else if (plan.createdAt) {
                const created = ((_h = (_g = plan.createdAt).toDate) === null || _h === void 0 ? void 0 : _h.call(_g)) ||
                    (typeof plan.createdAt === 'string' ? new Date(plan.createdAt) : null);
                if (created) {
                    nextDue = new Date(created);
                    const pv = Number(plan.periodValue) || 0;
                    if (pv > 0) {
                        if (plan.periodUnit === 'hafta')
                            nextDue.setDate(nextDue.getDate() + pv * 7);
                        else if (plan.periodUnit === 'ay')
                            nextDue.setMonth(nextDue.getMonth() + pv);
                        else if (plan.periodUnit === 'yil')
                            nextDue.setFullYear(nextDue.getFullYear() + pv);
                    }
                }
            }
            if (!nextDue || isNaN(nextDue.getTime()))
                continue;
            const daysUntilDue = Math.ceil((nextDue.getTime() - now) / MS_PER_DAY);
            // Only remind when maintenance is due within the next 7 days (and not overdue)
            if (daysUntilDue > 7 || daysUntilDue <= 0)
                continue;
            // Resolve device → hospitalId
            const device = await loadDevice(plan.deviceId);
            const hospitalId = device === null || device === void 0 ? void 0 : device.hospitalId;
            // Find personnel with matching role assigned to the device's lab
            const users = await loadUsersByRole(role);
            const targets = [];
            for (const u of users) {
                // If we don't know the device's hospital, notify everyone with the matching role
                if (!hospitalId || u.assignedLaboratories.includes(hospitalId)) {
                    targets.push(`user:${u.uid}`);
                }
            }
            if (targets.length === 0) {
                firebase_functions_1.logger.info(`[maintReminder] Plan ${planId} due in ${daysUntilDue}d but no matching personnel.`);
                continue;
            }
            const deviceName = (device === null || device === void 0 ? void 0 : device.model) || (device === null || device === void 0 ? void 0 : device.deviceName) || (device === null || device === void 0 ? void 0 : device.name) || 'Bilinmeyen Cihaz';
            const labName = (device === null || device === void 0 ? void 0 : device.labName) || '';
            const roleLabel = role === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon';
            const dueDateStr = nextDue.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
            const taskName = plan.taskName || 'Periyodik bakım';
            const planCompanyId = typeof plan.companyId === 'string' && plan.companyId.trim()
                ? plan.companyId.trim()
                : null;
            const maintNotification = {
                type: 'maintenance_reminder',
                title: `Bakım Hatırlatma: ${deviceName}`,
                message: `${labName ? labName + ' - ' : ''}${deviceName} cihazı için "${taskName}" (${roleLabel}) görevi ${daysUntilDue} gün içinde (${dueDateStr}) planlanmış durumda. Lütfen kontrol ediniz.`,
                href: `/cihaz-tanimlamalari/periyodik-bakim-yonetimi?deviceId=${plan.deviceId}&planId=${planId}`,
                resource: { type: 'device', id: plan.deviceId },
                actor: { uid: 'system', name: 'Sistem' },
                targets,
                meta: {
                    planId,
                    deviceId: plan.deviceId,
                    deviceName,
                    hospitalId: hospitalId || null,
                    labName,
                    taskName,
                    role,
                    roleLabel,
                    dueAt: admin.firestore.Timestamp.fromMillis(nextDue.getTime()),
                    daysUntilDue,
                },
                channel: 'push',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                readBy: [],
            };
            if (planCompanyId)
                maintNotification.companyId = planCompanyId;
            await db.collection('notifications').add(maintNotification);
            await planDoc.ref.update({
                lastMaintenanceReminderAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            notified++;
            firebase_functions_1.logger.info(`[maintReminder] Plan ${planId} (${taskName}) → ${targets.length} personnel (${roleLabel}). Due in ${daysUntilDue}d (${dueDateStr}).`);
        }
        firebase_functions_1.logger.info(`[maintReminder] Completed. Processed ${processed} plans, notified on ${notified}.`);
    }
    catch (error) {
        firebase_functions_1.logger.error('[maintReminder] Error processing maintenance reminders:', error);
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