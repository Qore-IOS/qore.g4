import type * as DocumentStore from '../data/admin';


import {adminDb} from '../data/admin';
import {resolveStorageBucket} from '@/lib/server/storage-bucket';
import { onSchedule } from '@/lib/jobs/runtime';
import { logger } from '@/lib/jobs/runtime';
import * as functions from '@/lib/jobs/runtime';
import { FieldValue, Timestamp } from '../data/model';
import { shortcutHandlers, type ShortcutContext, type ShortcutResult } from './shortcuts/handlers';
import { deliverShortcutResult } from './shortcuts/delivery';
import { createNotification } from './lib/notifications';


const db = adminDb;

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
  title?: string;
  params?: Record<string, unknown>;
  schedule?: ShortcutSchedule | string | null;
  timezone?: string;
  nextRunAt?: Timestamp | Date | null;
  lastRunAt?: Timestamp | Date | null;
  deliveryChannels?: string[];
  recipients?: string[];
  permissionSnapshot?: Record<string, unknown>;
  filters?: string[];
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

function snapshotMatchesCurrentUser(snapshot: Record<string, unknown> | undefined, user: DocumentStore.DocumentData): boolean {
  if (!snapshot || Object.keys(snapshot).length === 0) return true;

  // The snapshot is a point-in-time audit record captured when the shortcut was created.
  // Do not use it as the source of truth for current role/view permissions: profile
  // enrichment, default views, or legitimate role changes can make this serialized
  // snapshot differ even when the user still has access. Current access is enforced
  // below with the live user document (panelKey and scoped lab/depot checks).
  const snapshotUid = typeof snapshot.uid === 'string' ? snapshot.uid : null;
  if (snapshotUid && user.uid && snapshotUid !== user.uid) return false;

  const snapshotCompanyId = typeof snapshot.companyId === 'string' ? snapshot.companyId : null;
  if (snapshotCompanyId && user.companyId && snapshotCompanyId !== user.companyId) return false;

  return true;
}


function valueFromPath(source: Record<string, unknown> | undefined, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function scopeIdsFromShortcut(shortcut: ShortcutDoc, keys: string[]): string[] {
  const values = keys.flatMap((key) => {
    const direct = valueFromPath(shortcut.params, key) ?? valueFromPath(shortcut as Record<string, unknown>, key);
    return Array.isArray(direct) ? direct : [direct];
  });
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean).filter((value) => value !== 'all')));
}

function hasScope(currentAllowed: string[], requested: string[]): boolean {
  if (!requested.length) return true;
  // Elsewhere in the app an empty assignment list means company-wide access rather
  // than no access, so preserve that convention for background shortcut runs.
  if (!currentAllowed.length) return true;
  const allowed = new Set(currentAllowed);
  return requested.every((id) => allowed.has(id));
}

async function emitPermissionDeniedNotifications(shortcut: ShortcutDoc, runRef: DocumentStore.DocumentReference, reason: string): Promise<void> {
  if (!shortcut.createdByUid) return;
  await createNotification({
    type: 'custom',
    title: 'Kestirme yetki nedeniyle atlandı',
    message: `${shortcut.title || shortcut.actionKey || 'Kestirme'} çalıştırılmadı: ${reason}`,
    href: `/shortcut-runs/${runRef.id}`,
    actor: { uid: 'system', name: 'QORE System' },
    targets: [`user:${shortcut.createdByUid}`, 'role:admin'],
    audience: { userIds: [shortcut.createdByUid], roles: ['admin'] },
    meta: { shortcutId: shortcut.id || null, runId: runRef.id, reason },
  });
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

  const accessibleViews = normalizeStringArray(user.accessibleViews);
  if (shortcut.panelKey && !accessibleViews.includes(String(shortcut.panelKey))) {
    return { ok: false, reason: 'panelKey is no longer accessible to the shortcut creator' };
  }

  const requestedLabIds = scopeIdsFromShortcut(shortcut, ['labId', 'labIds', 'laboratoryId', 'laboratoryIds', 'hospitalId', 'hospitalIds']);
  const requestedDepotIds = scopeIdsFromShortcut(shortcut, ['depotId', 'depotIds']);
  if (!hasScope(normalizeStringArray(user.assignedLaboratories), requestedLabIds)) {
    return { ok: false, reason: 'lab filters are outside the creator current scope' };
  }
  if (!hasScope(normalizeStringArray(user.assignedDepots), requestedDepotIds)) {
    return { ok: false, reason: 'depot filters are outside the creator current scope' };
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

async function appendRunLog(runRef: DocumentStore.DocumentReference, level: string, message: string, meta: Record<string, unknown> = {}) {
  await db.collection('shortcutRunLogs').add({
    runId: runRef.id,
    level,
    message,
    meta,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function executeShortcutRun(shortcutRef: DocumentStore.DocumentReference, runRef: DocumentStore.DocumentReference, trigger: 'manual' | 'scheduled', requestedByUid?: string | null): Promise<void> {
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
    if (!permission.ok) {
      const message = permission.reason || 'Permission check failed';
      const nextRunAt = trigger === 'scheduled' ? computeNextRunAt(locked.schedule, new Date()) : toDate(locked.nextRunAt);
      await runRef.set({
        status: 'skipped_permission_denied',
        completedAt: FieldValue.serverTimestamp(),
        message,
      }, { merge: true });
      await appendRunLog(runRef, 'warn', message, { status: 'skipped_permission_denied' });
      await emitPermissionDeniedNotifications(locked, runRef, message);
      await shortcutRef.update({
        lastRunAt: FieldValue.serverTimestamp(),
        nextRunAt: nextRunAt ? Timestamp.fromDate(nextRunAt) : null,
        enabled: trigger === 'scheduled' && !nextRunAt ? false : locked.enabled,
        processingRunId: FieldValue.delete(),
        processingStartedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

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

    const delivery = await deliverShortcutResult({
      shortcut: locked,
      runRef,
      result,
    });
    const serializedResult = serializeHandlerResult(result);
    const generatedAttachments = delivery.attachments.map(({ name, contentType, storagePath, publicUrl, sizeBytes }) => ({
      name,
      contentType,
      path: storagePath,
      url: publicUrl,
      sizeBytes,
    }));

    await runRef.set({
      status,
      completedAt: FieldValue.serverTimestamp(),
      result: {
        ...serializedResult,
        deliverySummary: delivery.summary,
        generatedAttachments,
        deliveryAttempts: delivery.attempts,
      },
      message: delivery.summary || result.summaryText || null,
    }, { merge: true });
    await appendRunLog(runRef, status === 'failed' ? 'error' : 'info', result.summaryText || 'Shortcut run completed.', {
      ...serializedResult,
      generatedAttachments,
      deliveryAttempts: delivery.attempts,
    });
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

async function processShortcut(shortcutRef: DocumentStore.DocumentReference, now: Date): Promise<void> {
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
