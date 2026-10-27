import {workspaceIdentity} from '../../../../lib/workspace';
import { NextRequest, NextResponse } from 'next/server';

import {
  type CalendarProvider,
  type CalendarTask,
  upsertEvent,
  deleteEvent,
} from '@/lib/server/calendar-oauth';
import {
  connectedProviders,
  getFreshAccessToken,
  getTaskEventIds,
  setTaskEventId,
  clearTaskEventIds,
} from '@/lib/server/calendar-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bir görevi kullanıcının bağlı takvimleriyle senkronize eder.
 * Body: { action: 'upsert' | 'delete', task: CalendarTask }
 * Auth: Authorization: Bearer <firebase id token>
 */
export async function POST(req: NextRequest) {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  if (!token) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let uid: string;
  try {
    uid = (workspaceIdentity).uid;
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let action: 'upsert' | 'delete';
  let task: CalendarTask;
  try {
    const body = await req.json();
    action = body.action;
    task = body.task;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }
  if ((action !== 'upsert' && action !== 'delete') || !task?.id) {
    return NextResponse.json({ ok: false, error: 'invalid request' }, { status: 400 });
  }

  const providers = await connectedProviders(uid);
  if (providers.length === 0) {
    return NextResponse.json({ ok: true, synced: [] }); // bağlı takvim yok → no-op
  }

  const existing = await getTaskEventIds(uid, task.id);
  const synced: CalendarProvider[] = [];
  const errors: Record<string, string> = {};

  await Promise.all(
    providers.map(async (provider) => {
      try {
        const accessToken = await getFreshAccessToken(uid, provider);
        if (!accessToken) return;

        if (action === 'delete') {
          if (existing[provider]) await deleteEvent(provider, accessToken, existing[provider]!);
        } else {
          const eventId = await upsertEvent(provider, accessToken, task, existing[provider]);
          if (eventId && eventId !== existing[provider]) {
            await setTaskEventId(uid, task.id, provider, eventId);
          }
        }
        synced.push(provider);
      } catch (e) {
        errors[provider] = (e as Error).message;
        console.error(`[calendar] sync ${provider} failed:`, (e as Error).message);
      }
    }),
  );

  if (action === 'delete') await clearTaskEventIds(uid, task.id);

  return NextResponse.json({ ok: true, synced, errors });
}
