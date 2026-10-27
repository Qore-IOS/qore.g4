import {NextRequest,NextResponse} from 'next/server';
import * as tasks from '../../../../lib/jobs';
import type {Job} from '../../../../lib/jobs/runtime';
import {corsHeaders,preflight} from '../../../../lib/server/cors';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(req:NextRequest,{params}:{params:{name:string}}){
 const headers=corsHeaders(req);if(headers===null)return NextResponse.json({error:'Origin rejected'},{status:403});
 const task=(tasks as Record<string,unknown>)[params.name] as Job|undefined;
 if(!task||task.kind!=='call')return NextResponse.json({error:'Unknown task'},{status:404});
 try{const raw=await req.text();if(Buffer.byteLength(raw)>1_000_000)return NextResponse.json({error:'Request too large'},{status:413});const data=JSON.parse(raw);return NextResponse.json(await task.handler({data}),{headers});}
 catch(e:any){console.error('Task failed',params.name,e.message);return NextResponse.json({error:'Task failed'},{status:500,headers});}
}
export const OPTIONS=preflight;
