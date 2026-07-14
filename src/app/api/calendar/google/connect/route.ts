import { NextRequest } from 'next/server';
import { handleConnect } from '@/lib/server/calendar-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleConnect(req, 'google');
}
