import {NextResponse} from 'next/server';
import {probeAdminSdk} from '../../../../lib/data/admin';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(){const status=await probeAdminSdk();if(!status.ready)console.error('Database health check failed',status.error);return NextResponse.json({ready:status.ready,provider:'postgresql'},{status:status.ready?200:503});}
