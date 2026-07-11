import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { providerConfigured, type CalendarProvider } from '@/lib/server/calendar-oauth';
import { getConnectionStatus, deleteConnection } from '@/lib/server/calendar-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireUid(req: NextRequest): Promise<string | null> {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

/** Kullanıcının takvim bağlantı durumu (token içermez). */
export async function GET(req: NextRequest) {
  const uid = await requireUid(req);
  if (!uid) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const status = await getConnectionStatus(uid);
  return NextResponse.json({
    ok: true,
    configured: {
      google: providerConfigured('google'),
      microsoft: providerConfigured('microsoft'),
    },
    connections: status,
  });
}

/** Bir sağlayıcı bağlantısını kaldırır. Body: { provider } */
export async function DELETE(req: NextRequest) {
  const uid = await requireUid(req);
  if (!uid) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let provider: CalendarProvider;
  try {
    provider = (await req.json()).provider;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }
  if (provider !== 'google' && provider !== 'microsoft') {
    return NextResponse.json({ ok: false, error: 'invalid provider' }, { status: 400 });
  }

  await deleteConnection(uid, provider);
  return NextResponse.json({ ok: true });
}
