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
exports.shortcutScheduler = void 0;
const admin = __importStar(require("firebase-admin"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const firestore_1 = require("firebase-admin/firestore");
const handlers_1 = require("./shortcuts/handlers");
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
function toDate(value) {
    if (!value)
        return null;
    if (value instanceof firestore_1.Timestamp)
        return value.toDate();
    if (value instanceof Date)
        return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
}
function snapshotMatchesCurrentUser(snapshot, user) {
    if (!snapshot || Object.keys(snapshot).length === 0)
        return true;
    const snapshotCompanyId = typeof snapshot.companyId === 'string' ? snapshot.companyId : null;
    if (snapshotCompanyId && user.companyId && snapshotCompanyId !== user.companyId)
        return false;
    const snapshotRole = typeof snapshot.role === 'string' ? snapshot.role : null;
    if (snapshotRole && user.role && snapshotRole !== user.role)
        return false;
    const snapshotRoles = normalizeStringArray(snapshot.roles);
    if (snapshotRoles.length) {
        const currentRoles = new Set([...normalizeStringArray(user.roles), ...(user.role ? [String(user.role)] : [])]);
        if (!snapshotRoles.every((role) => currentRoles.has(role)))
            return false;
    }
    const snapshotPermissions = normalizeStringArray(snapshot.permissions);
    if (snapshotPermissions.length) {
        const currentPermissions = new Set([
            ...normalizeStringArray(user.permissions),
            ...normalizeStringArray(user.permissionKeys),
            ...normalizeStringArray(user.accessibleViews),
        ]);
        if (!snapshotPermissions.every((permission) => currentPermissions.has(permission)))
            return false;
    }
    return true;
}
async function verifyShortcutPermissions(shortcut) {
    const uid = String(shortcut.createdByUid || '').trim();
    if (!uid)
        return { ok: false, reason: 'createdByUid is missing' };
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists)
        return { ok: false, reason: 'creator user document was not found' };
    const user = userSnap.data() || {};
    if (user.disabled === true || user.enabled === false)
        return { ok: false, reason: 'creator user is disabled' };
    if (shortcut.companyId && user.companyId && shortcut.companyId !== user.companyId) {
        return { ok: false, reason: 'creator companyId does not match shortcut companyId' };
    }
    if (!snapshotMatchesCurrentUser(shortcut.permissionSnapshot, user)) {
        return { ok: false, reason: 'permission snapshot no longer matches current user permissions' };
    }
    return { ok: true };
}
function resolveHandler(shortcut) {
    const actionKey = String(shortcut.actionKey || '').trim();
    return (actionKey && handlers_1.shortcutHandlers[actionKey]) || null;
}
function serializeHandlerResult(result) {
    return {
        summaryText: result.summaryText,
        rows: result.rows || [],
        metrics: result.metrics || {},
        attachments: result.attachments || [],
        warnings: result.warnings || [],
        deepLink: result.deepLink || null,
    };
}
function computeNextRunAt(schedule, from) {
    if (!schedule)
        return null;
    if (typeof schedule === 'string')
        return null;
    if (schedule.type === 'once')
        return null;
    const intervalMinutes = Number(schedule.intervalMinutes || 0);
    const intervalHours = Number(schedule.intervalHours || 0);
    const intervalDays = Number(schedule.intervalDays || 0);
    const intervalMs = intervalMinutes * 60 * 1000 +
        intervalHours * 60 * 60 * 1000 +
        intervalDays * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0)
        return null;
    return new Date(from.getTime() + intervalMs);
}
async function appendRunLog(runRef, level, message, meta = {}) {
    await db.collection('shortcutRunLogs').add({
        runId: runRef.id,
        level,
        message,
        meta,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
}
async function processShortcut(shortcutRef, now) {
    const runRef = db.collection('shortcutRuns').doc();
    const locked = await db.runTransaction(async (tx) => {
        const snap = await tx.get(shortcutRef);
        if (!snap.exists)
            return null;
        const shortcut = Object.assign({ id: snap.id }, snap.data());
        const nextRunAt = toDate(shortcut.nextRunAt);
        if (shortcut.enabled !== true || !nextRunAt || nextRunAt.getTime() > now.getTime())
            return null;
        tx.update(shortcutRef, {
            processingRunId: runRef.id,
            processingStartedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        tx.set(runRef, {
            shortcutId: snap.id,
            companyId: shortcut.companyId || null,
            panelKey: shortcut.panelKey || null,
            actionKey: shortcut.actionKey || null,
            status: 'processing',
            startedAt: firestore_1.FieldValue.serverTimestamp(),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            createdByUid: shortcut.createdByUid || null,
            createdByName: shortcut.createdByName || null,
        });
        return shortcut;
    });
    if (!locked)
        return;
    try {
        await appendRunLog(runRef, 'info', 'Shortcut run started.');
        const permission = await verifyShortcutPermissions(locked);
        if (!permission.ok)
            throw new Error(permission.reason || 'Permission check failed');
        const handler = resolveHandler(locked);
        if (!handler)
            throw new Error(`No shortcut handler registered for actionKey: ${locked.actionKey || '(empty)'}`);
        const result = await handler.handle(locked.params || {}, {
            shortcutId: shortcutRef.id,
            runId: runRef.id,
            companyId: locked.companyId || null,
            createdByUid: locked.createdByUid || null,
            createdByName: locked.createdByName || null,
            now: new Date(),
        });
        const completedAt = new Date();
        const nextRunAt = computeNextRunAt(locked.schedule, completedAt);
        const status = result.status || 'success';
        await runRef.set({
            status,
            completedAt: firestore_1.FieldValue.serverTimestamp(),
            result: serializeHandlerResult(result),
            message: result.summaryText || null,
        }, { merge: true });
        await appendRunLog(runRef, status === 'failed' ? 'error' : 'info', result.summaryText || 'Shortcut run completed.', serializeHandlerResult(result));
        await shortcutRef.update({
            lastRunAt: firestore_1.FieldValue.serverTimestamp(),
            nextRunAt: nextRunAt ? firestore_1.Timestamp.fromDate(nextRunAt) : null,
            enabled: nextRunAt ? locked.enabled : false,
            processingRunId: firestore_1.FieldValue.delete(),
            processingStartedAt: firestore_1.FieldValue.delete(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const retryAt = computeNextRunAt(locked.schedule, new Date());
        firebase_functions_1.logger.error('Shortcut run failed', { shortcutId: shortcutRef.id, runId: runRef.id, err });
        await runRef.set({
            status: 'failed',
            completedAt: firestore_1.FieldValue.serverTimestamp(),
            error: message,
        }, { merge: true });
        await appendRunLog(runRef, 'error', message);
        await shortcutRef.update({
            lastRunAt: firestore_1.FieldValue.serverTimestamp(),
            nextRunAt: retryAt ? firestore_1.Timestamp.fromDate(retryAt) : null,
            enabled: retryAt ? locked.enabled : false,
            processingRunId: firestore_1.FieldValue.delete(),
            processingStartedAt: firestore_1.FieldValue.delete(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
}
exports.shortcutScheduler = (0, scheduler_1.onSchedule)({
    schedule: 'every 1 minutes',
    region: 'europe-west1',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 540,
    memory: '512MiB',
}, async () => {
    const now = new Date();
    const dueSnap = await db
        .collection('shortcuts')
        .where('enabled', '==', true)
        .where('nextRunAt', '<=', firestore_1.Timestamp.fromDate(now))
        .orderBy('nextRunAt', 'asc')
        .limit(50)
        .get();
    firebase_functions_1.logger.info('Shortcut scheduler found due shortcuts', { count: dueSnap.size });
    for (const doc of dueSnap.docs) {
        await processShortcut(doc.ref, now);
    }
});
//# sourceMappingURL=shortcutScheduler.js.map