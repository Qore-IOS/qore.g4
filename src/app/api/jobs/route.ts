import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {runJobs} from '@/lib/jobs/worker';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(req:NextRequest){
 const secret=process.env.CRON_SECRET;
 if(!secret)return NextResponse.json({error:'CRON_SECRET is required'},{status:503});
 const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(req.headers.get('authorization')||'');
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return NextResponse.json({error:'Unauthorized'},{status:401});
 return NextResponse.json(await runJobs());
}
