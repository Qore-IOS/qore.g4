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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupExpiredIrsaliyeDosyalari = exports.sendFaultReportEmail = exports.onNotificationCreated = exports.nfcLoginWithSerial = exports.mirrorPresenceToFirestore = exports.createCustomTokenForNfcUser = exports.revokeUserSessions = void 0;
const admin = __importStar(require("firebase-admin"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const functions = __importStar(require("firebase-functions"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const nodemailer = __importStar(require("nodemailer"));
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
const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com",
    port: 465,
    secure: true,
    auth: {
        user: ((_a = functions.config().smtp) === null || _a === void 0 ? void 0 : _a.email) || "batuhan@qorengine.com",
        pass: (_b = functions.config().smtp) === null || _b === void 0 ? void 0 : _b.password,
    },
});
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
    var _a;
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
                    tokenMap.set(td.token, { token: td.token, uid: td.uid || null });
                }
            }
        }
        // Source B: Users who have this notification type in their notificationPreferences
        // This ensures non-admin users with the right preferences also receive notifications
        if (notificationType && notificationType !== 'custom') {
            const prefsSnap = await db
                .collection('users')
                .where('notificationsEnabled', '==', true)
                .where('notificationPreferences', 'array-contains', notificationType)
                .get();
            // Collect UIDs of users who opted into this notification type
            const optedInUids = [];
            for (const userDoc of prefsSnap.docs) {
                optedInUids.push(userDoc.id);
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
                            tokenMap.set(td.token, { token: td.token, uid: td.uid || null });
                        }
                    }
                }
            }
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
                        prefs: ud.notificationPreferences || [], // empty = all allowed
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
        logEntry.tokensFilteredByPrefs = resolvedTokens.length - filteredTokens.length;
        if (filteredTokens.length === 0) {
            logEntry.status = 'filtered_by_prefs';
            logEntry.errors.push('All tokens filtered out by user notification preferences');
            await db.collection('notificationLogs').add(logEntry);
            firebase_functions_1.logger.info(`[fanOut] All ${resolvedTokens.length} tokens filtered by preferences for ${notificationId}`);
            return;
        }
        firebase_functions_1.logger.info(`[fanOut] ${filteredTokens.length}/${resolvedTokens.length} tokens after preference filtering for ${notificationId}`);
        // --- 2. Build FCM message ---
        const baseUrl = 'https://qorengine.com';
        const fcmMessage = {
            tokens: filteredTokens.map(t => t.token),
            notification: {
                title: data.title,
                body: data.message,
            },
            data: {
                notificationId,
                type: data.type || '',
                href: data.href || '/',
                link: data.href ? `${baseUrl}${data.href}` : baseUrl,
            },
            webpush: {
                notification: {
                    icon: '/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG',
                    badge: '/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG',
                    tag: notificationId,
                    requireInteraction: false,
                },
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
// --- GUNCEL ARIZA MAİL FONKSİYONU ---
exports.sendFaultReportEmail = functions
    .region('europe-west1')
    .firestore.document('deviceFaultReports/{reportId}')
    .onCreate(async (snap, context) => {
    const faultData = snap.data();
    const docId = context.params.reportId;
    if (!faultData)
        return;
    const { labName, model, title, description, faultType, openedByName } = faultData;
    // 1. Webhook
    const webhookUrl = 'https://btbsr.app.n8n.cloud/webhook/6d024c9f-12f1-4801-8456-4a99a18d69b3';
    try {
        await (0, node_fetch_1.default)(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(faultData),
        });
    }
    catch (e) {
        firebase_functions_1.logger.warn('Webhook error', e);
    }
    // 2. ALICI LİSTELERİ (YENİ)
    let recipients = [];
    const teknikServisListesi = [
        'ysahan@nukleus.com.tr',
        'dkilic@nukleus.com.tr',
        'bbasar@nukleus.com.tr',
        'aturhan@nukleus.com.tr',
        'bkahraman@nukleus.com.tr'
    ];
    const aplikasyonListesi = [
        'iertugrul@nukleus.com.tr',
        'ehoscanli@nukleus.com.tr',
        'helkoca@nukleus.com.tr',
        'bbasar@nukleus.com.tr',
        'aturhan@nukleus.com.tr'
    ];
    // Kucuk harf kontrolu ile eslestirme yapalim
    const type = (faultType || '').toLowerCase();
    if (type.includes('teknik') || type === 'teknik_servis') {
        recipients = teknikServisListesi;
    }
    else if (type.includes('aplikasyon')) {
        recipients = aplikasyonListesi;
    }
    else {
        // Eger tip tanimsizsa veya baska bir seyse Adminlere gonder
        recipients = ['bbasar@nukleus.com.tr',
            'aturhan@nukleus.com.tr', 'btubasar@gmail.com'];
    }
    // 3. İÇERİK VE LİNK (YENİ)
    const reportLink = `https://qorengine.com/ariza-yonetimi/${docId}`;
    const htmlContent = `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; color: #333; max-width: 600px;">
            <h2 style="color: #d32f2f; margin-top: 0;">🔧 Yeni Arıza Kaydı (#${docId.substring(0, 5)})</h2>
            
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <tr style="background-color: #f9f9f9;">
                    <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #eee; width: 30%;">Cihaz:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${model || title || 'Belirtilmemiş'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #eee;">Laboratuvar:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${labName || 'Belirtilmemiş'}</td>
                </tr>
                <tr style="background-color: #f9f9f9;">
                    <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #eee;">Arıza Tipi:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${faultType || 'Belirtilmemiş'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #eee;">Açan Kişi:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${openedByName || 'Belirtilmemiş'}</td>
                </tr>
            </table>

            <div style="margin-top: 20px; background-color: #fff3e0; padding: 15px; border-radius: 5px; border-left: 4px solid #ff9800;">
                <p style="font-weight: bold; margin: 0 0 5px 0; color: #e65100;">Açıklama:</p>
                <p style="margin: 0;">${description || 'Açıklama girilmedi.'}</p>
            </div>

            <div style="margin-top: 30px; text-align: center;">
                <a href="${reportLink}" style="background-color: #d32f2f; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; font-size: 16px;">
                    Arızayı Görüntüle
                </a>
                <p style="margin-top: 15px; font-size: 12px; color: #888;">
                    Linke tıklayamıyorsanız: <br>
                    <a href="${reportLink}" style="color: #d32f2f;">${reportLink}</a>
                </p>
            </div>
          </div>
        `;
    const mailOptions = {
        from: '"Qore Arıza Sistemi" <batuhan@qorengine.com>',
        to: recipients.join(', '),
        subject: `Yeni Arıza: ${title || model} (${labName})`,
        html: htmlContent,
    };
    try {
        await transporter.sendMail(mailOptions);
        firebase_functions_1.logger.info(`Mail successfully sent to [${recipients.length}] people. ID: ${docId}`);
    }
    catch (error) {
        firebase_functions_1.logger.error('Mail sending failed', error);
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