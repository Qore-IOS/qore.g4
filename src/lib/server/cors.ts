import {NextRequest,NextResponse} from 'next/server';
/** Only configured packaged-client origins may read the shared workspace cross-origin. */
export function corsHeaders(req:NextRequest):HeadersInit|null{
 const origin=req.headers.get('origin');
 if(!origin)return {};
 const configured=(process.env.QORE_ALLOWED_ORIGINS || '').split(',').map(v=>v.trim()).filter(Boolean);
 let sameOrigin=false;try{sameOrigin=new URL(origin).host===req.headers.get('host');}catch{}
 if(!sameOrigin&&!configured.includes(origin))return null;
 return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'};
}
export function preflight(req:NextRequest){const headers=corsHeaders(req);return headers?new NextResponse(null,{status:204,headers}):NextResponse.json({error:'Origin rejected'},{status:403});}
