import {corsHeaders,preflight} from '../../../lib/server/cors';
import {NextRequest,NextResponse} from 'next/server';
import {resolveStorageBucket} from '@/lib/server/storage-bucket';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 const cors=corsHeaders(req);if(cors===null)return NextResponse.json({error:'Origin rejected'},{status:403});
 try{const path=req.nextUrl.searchParams.get('path');if(!path)return NextResponse.json({error:'Path required'},{status:400});
 const file=(await resolveStorageBucket()).file(path);const [buffer]=await file.download();const metadata=await file.metadata();const safeType=/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(metadata.contentType)?metadata.contentType:'application/octet-stream';
 return new NextResponse(new Uint8Array(buffer),{headers:{...cors,'Content-Type':safeType,'Content-Disposition':safeType==='application/octet-stream'?'attachment':'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch{return NextResponse.json({error:'File unavailable'},{status:404});}
}
export async function POST(req:NextRequest){
 const cors=corsHeaders(req);if(cors===null)return NextResponse.json({error:'Origin rejected'},{status:403});
 try{const form=await req.formData();const path=form.get('path');const file=form.get('file');
 if(typeof path!=='string'||!(file instanceof File))return NextResponse.json({error:'File and path required'},{status:400});
 if(file.size>4_000_000)return NextResponse.json({error:'Maximum file size is 4 MB'},{status:413});
 await (await resolveStorageBucket()).file(path).save(Buffer.from(await file.arrayBuffer()),{metadata:{contentType:file.type}});
 return NextResponse.json({path},{headers:cors});
 }catch{return NextResponse.json({error:'Upload failed'},{status:500});}
}
export async function DELETE(req:NextRequest){
 const cors=corsHeaders(req);if(cors===null)return NextResponse.json({error:'Origin rejected'},{status:403});
 try{const path=req.nextUrl.searchParams.get('path');if(!path)return NextResponse.json({error:'Path required'},{status:400});await (await resolveStorageBucket()).file(path).delete();return NextResponse.json({ok:true},{headers:cors});}
 catch{return NextResponse.json({error:'Deletion failed'},{status:500});}
}

export const OPTIONS=preflight;
