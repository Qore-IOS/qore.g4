'use server';

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import * as functions from 'firebase-functions';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { shortcutHandlers, type ShortcutContext, type ShortcutResult } from './shortcuts/handlers';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export type ShortcutRunMode = 'manual' | 'scheduled' | 'manual_and_scheduled';

export type ShortcutSchedule = {
  type?: 'once' | 'interval';
  intervalMinutes?: number;
  intervalHours?: number;
  intervalDays?: number;
};

export type ShortcutDoc = {
  id?: string;
  companyId?: string;
  createdByUid?: string;
  createdByName?: string;
  enabled?: boolean;
  runMode?: ShortcutRunMode;
  panelKey?: string;
  actionKey?: string;
  params?: Record<string, unknown>;
  schedule?: ShortcutSchedule | string | null;
  timezone?: string;
  nextRunAt?: Timestamp | Date | null;
  lastRunAt?: Timestamp | Date | null;
  deliveryChannels?: string[];
  recipients?: string[];
  permissionSnapshot?: Record<string, unknown>;
  createdAt?: Timestamp | Date | null;
  updatedAt?: Timestamp | Date | null;
  processingRunId?: string | null;
  processingStartedAt?: Timestamp | Date | null;
};


function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
}

function snapshotMatchesCurrentUser(snapshot: Record<string, unknown> | undefined, user: FirebaseFirestore.DocumentData): boolean {
  if (!snapshot || Object.keys(snapshot).length === 0) return true;

  const snapshotCompanyId = typeof snapshot.companyId === 'string' ? snapshot.companyId : null;
  if (snapshotCompanyId && user.companyId && snapshotCompanyId !== user.companyId) return false;

  const snapshotRole = typeof snapshot.role === 'string' ? snapshot.role : null;
  if (snapshotRole && user.role && snapshotRole !== user.role) return false;

  const snapshotRoles = normalizeStringArray(snapshot.roles);
  if (snapshotRoles.length) {
    const currentRoles = new Set([...normalizeStringArray(user.roles), ...(user.role ? [String(user.role)] : [])]);
    if (!snapshotRoles.every((role) => currentRoles.has(role))) return false;
  }

  const snapshotPermissions = normalizeStringArray(snapshot.permissions);
  if (snapshotPermissions.length) {
    const currentPermissions = new Set([
      ...normalizeStringArray(user.permissions),
      ...normalizeStringArray(user.permissionKeys),
      ...normalizeStringArray(user.accessibleViews),
    ]);
    if (!snapshotPermissions.every((permission) => currentPermissions.has(permission))) return false;
  }

  return true;
}

async function verifyShortcutPermissions(shortcut: ShortcutDoc): Promise<{ ok: boolean; reason?: string }> {
  const uid = String(shortcut.createdByUid || '').trim();
  if (!uid) return { ok: false, reason: 'createdByUid is missing' };

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return { ok: false, reason: 'creator user document was not found' };

  const user = userSnap.data() || {};
  if (user.disabled === true || user.enabled === false) return { ok: false, reason: 'creator user is disabled' };
  if (shortcut.companyId && user.companyId && shortcut.companyId !== user.companyId) {
    return { ok: false, reason: 'creator companyId does not match shortcut companyId' };
  }
  if (!snapshotMatchesCurrentUser(shortcut.permissionSnapshot, user)) {
    return { ok: false, reason: 'permission snapshot no longer matches current user permissions' };
  }

  return { ok: true };
}

function resolveHandler(shortcut: ShortcutDoc) {
  const actionKey = String(shortcut.actionKey || '').trim();
  return (actionKey && shortcutHandlers[actionKey as keyof typeof shortcutHandlers]) || null;
}

function serializeHandlerResult(result: ShortcutResult): Record<string, unknown> {
  return {
    summaryText: result.summaryText,
    rows: result.rows || [],
    metrics: result.metrics || {},
    attachments: result.attachments || [],
    warnings: result.warnings || [],
    deepLink: result.deepLink || null,
  };
}

function computeNextRunAt(schedule: ShortcutDoc['schedule'], from: Date): Date | null {
  if (!schedule) return null;
  if (typeof schedule === 'string') return null;
  if (schedule.type === 'once') return null;

  const intervalMinutes = Number(schedule.intervalMinutes || 0);
  const intervalHours = Number(schedule.intervalHours || 0);
  const intervalDays = Number(schedule.intervalDays || 0);
  const intervalMs =
    intervalMinutes * 60 * 1000 +
    intervalHours * 60 * 60 * 1000 +
    intervalDays * 24 * 60 * 60 * 1000;

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  return new Date(from.getTime() + intervalMs);
}

async function appendRunLog(runRef: FirebaseFirestore.DocumentReference, level: string, message: string, meta: Record<string, unknown> = {}) {
  await db.collection('shortcutRunLogs').add({
    runId: runRef.id,
    level,
    message,
    meta,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function executeShortcutRun(shortcutRef: FirebaseFirestore.DocumentReference, runRef: FirebaseFirestore.DocumentReference, trigger: 'manual' | 'scheduled', requestedByUid?: string | null): Promise<void> {
  const locked = await db.runTransaction(async (tx) => {
    const snap = await tx.get(shortcutRef);
    if (!snap.exists) return null;
    const shortcut = { id: snap.id, ...(snap.data() as ShortcutDoc) };
    const mode = shortcut.runMode || (shortcut.nextRunAt ? 'scheduled' : 'manual');
    const allowsManual = mode === 'manual' || mode === 'manual_and_scheduled';
    const allowsScheduled = mode === 'scheduled' || mode === 'manual_and_scheduled';
    if (shortcut.enabled !== true) return null;
    if (trigger === 'manual' && !allowsManual) throw new Error('Shortcut does not allow manual runs');
    if (trigger === 'scheduled' && !allowsScheduled) return null;

    tx.update(shortcutRef, {
      processingRunId: runRef.id,
      processingStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(runRef, {
      shortcutId: snap.id,
      companyId: shortcut.companyId || null,
      panelKey: shortcut.panelKey || null,
      actionKey: shortcut.actionKey || null,
      trigger,
      requestedByUid: requestedByUid || null,
      status: 'processing',
      startedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: shortcut.createdByUid || null,
      createdByName: shortcut.createdByName || null,
    }, { merge: true });
    return shortcut;
  });

  if (!locked) return;

  try {
    await appendRunLog(runRef, 'info', `Shortcut ${trigger} run started.`);

    const permission = await verifyShortcutPermissions(locked);
    if (!permission.ok) throw new Error(permission.reason || 'Permission check failed');

    const handler = resolveHandler(locked);
    if (!handler) throw new Error(`No shortcut handler registered for actionKey: ${locked.actionKey || '(empty)'}`);

    const result = await handler.handle(locked.params || {}, {
      shortcutId: shortcutRef.id,
      runId: runRef.id,
      companyId: locked.companyId || null,
      createdByUid: locked.createdByUid || null,
      createdByName: locked.createdByName || null,
      now: new Date(),
    } satisfies ShortcutContext);
    const completedAt = new Date();
    const nextRunAt = trigger === 'scheduled' ? computeNextRunAt(locked.schedule, completedAt) : toDate(locked.nextRunAt);
    const status = result.status || 'success';

    await runRef.set({
      status,
      completedAt: FieldValue.serverTimestamp(),
      result: serializeHandlerResult(result),
      message: result.summaryText || null,
    }, { merge: true });
    await appendRunLog(runRef, status === 'failed' ? 'error' : 'info', result.summaryText || 'Shortcut run completed.', serializeHandlerResult(result));
    await shortcutRef.update({
      lastRunAt: FieldValue.serverTimestamp(),
      nextRunAt: nextRunAt ? Timestamp.fromDate(nextRunAt) : null,
      enabled: trigger === 'scheduled' && !nextRunAt ? false : locked.enabled,
      processingRunId: FieldValue.delete(),
      processingStartedAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryAt = trigger === 'scheduled' ? computeNextRunAt(locked.schedule, new Date()) : toDate(locked.nextRunAt);
    logger.error('Shortcut run failed', { shortcutId: shortcutRef.id, runId: runRef.id, trigger, err });
    await runRef.set({
      status: 'failed',
      completedAt: FieldValue.serverTimestamp(),
      error: message,
    }, { merge: true });
    await appendRunLog(runRef, 'error', message);
    await shortcutRef.update({
      lastRunAt: FieldValue.serverTimestamp(),
      nextRunAt: retryAt ? Timestamp.fromDate(retryAt) : null,
      enabled: trigger === 'scheduled' && !retryAt ? false : locked.enabled,
      processingRunId: FieldValue.delete(),
      processingStartedAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

async function processShortcut(shortcutRef: FirebaseFirestore.DocumentReference, now: Date): Promise<void> {
  const snap = await shortcutRef.get();
  if (!snap.exists) return;
  const shortcut = { id: snap.id, ...(snap.data() as ShortcutDoc) };
  const nextRunAt = toDate(shortcut.nextRunAt);
  const mode = shortcut.runMode || (nextRunAt ? 'scheduled' : 'manual');
  if (shortcut.enabled !== true || !nextRunAt || nextRunAt.getTime() > now.getTime()) return;
  if (mode !== 'scheduled' && mode !== 'manual_and_scheduled') return;
  await executeShortcutRun(shortcutRef, db.collection('shortcutRuns').doc(), 'scheduled');
}

export const onShortcutRunRequestCreated = functions
  .region('europe-west1')
  .firestore.document('shortcutRunRequests/{requestId}')
  .onCreate(async (snap) => {
    const request = snap.data() || {};
    const shortcutId = String(request.shortcutId || '').trim();
    if (!shortcutId) {
      await snap.ref.set({ status: 'failed', error: 'shortcutId is required', completedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }
    const runRef = db.collection('shortcutRuns').doc();
    await snap.ref.set({ status: 'processing', runId: runRef.id, startedAt: FieldValue.serverTimestamp() }, { merge: true });
    try {
      await executeShortcutRun(db.collection('shortcuts').doc(shortcutId), runRef, 'manual', request.requestedByUid || null);
      await snap.ref.set({ status: 'completed', completedAt: FieldValue.serverTimestamp() }, { merge: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await snap.ref.set({ status: 'failed', error: message, completedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });

export const shortcutScheduler = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'europe-west1',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const now = new Date();
    const dueSnap = await db
      .collection('shortcuts')
      .where('enabled', '==', true)
      .where('nextRunAt', '<=', Timestamp.fromDate(now))
      .orderBy('nextRunAt', 'asc')
      .limit(50)
      .get();

    logger.info('Shortcut scheduler found due shortcuts', { count: dueSnap.size });

    for (const doc of dueSnap.docs) {
      await processShortcut(doc.ref, now);
    }
  },
);
