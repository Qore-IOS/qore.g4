import { NextRequest } from 'next/server';
import { handleCallback } from '@/lib/server/calendar-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleCallback(req, 'microsoft');
}
