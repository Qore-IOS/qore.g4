import {corsHeaders,preflight} from '../../../lib/server/cors';
import { NextRequest, NextResponse } from 'next/server';
import { readDocuments, commitOperations, ConflictError } from '../../../lib/data/postgres';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req:NextRequest) {
 // With login removed, this API is a shared workspace. Protect the deployment in Vercel.
 // Same-origin checks prevent third-party browser forms from mutating the workspace.
 const headers=corsHeaders(req);
 if(headers===null)return NextResponse.json({error:'Origin rejected'},{status:403});
 if(!req.headers.get('content-type')?.includes('application/json'))return NextResponse.json({error:'JSON required'},{status:415});
 try{
  const raw=await req.text();
  if(Buffer.byteLength(raw)>4_000_000)return NextResponse.json({error:'Request too large'},{status:413});
  const body=JSON.parse(raw);
  if(body.action==='read'||body.action==='count')return NextResponse.json(await readDocuments(body.ref,undefined,body.action==='count'),{headers});
  if(body.action==='write'){await commitOperations(body.operations,body.reads);return NextResponse.json({ok:true},{headers});}
  return NextResponse.json({error:'Unknown data operation'},{status:400});
 }catch(e:any){console.error('PostgreSQL operation failed:',e.message);return NextResponse.json({error:e instanceof ConflictError?'Concurrent update; retry':'Database operation failed'},{status:e instanceof ConflictError?409:500});}
}

export const OPTIONS=preflight;
