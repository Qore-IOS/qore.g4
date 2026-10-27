/** HTTP document client for external ERP workers; no database password is shipped. */
class Timestamp {
 constructor(seconds,nanoseconds=0){this.seconds=seconds;this.nanoseconds=nanoseconds;}
 static fromMillis(ms){const s=Math.floor(ms/1000);return new Timestamp(s,(ms-s*1000)*1e6);}
 static now(){return this.fromMillis(Date.now());}static fromDate(d){return this.fromMillis(d.getTime());}
 toMillis(){return this.seconds*1000+this.nanoseconds/1e6;}toDate(){return new Date(this.toMillis());}toJSON(){return {$timestamp:this.toMillis()};}
}
const FieldValue={serverTimestamp:()=>({$operation:'timestamp'}),increment:amount=>({$operation:'increment',amount}),delete:()=>({$operation:'delete'}),arrayUnion:(...values)=>({$operation:'union',values}),arrayRemove:(...values)=>({$operation:'remove',values})};
function decode(v){if(v&&typeof v==='object'&&typeof v.$timestamp==='number')return Timestamp.fromMillis(v.$timestamp);if(Array.isArray(v))return v.map(decode);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)]));return v;}
function encode(v){if(v instanceof Date)return {$timestamp:v.getTime()};if(v instanceof Timestamp)return v.toJSON();if(Array.isArray(v))return v.map(encode);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]));return v;}
async function request(body){
 if(!process.env.APP_BASE_URL)throw new Error('APP_BASE_URL is required');
 const headers={'Content-Type':'application/json'};
 if(process.env.VERCEL_AUTOMATION_BYPASS_SECRET)headers['x-vercel-protection-bypass']=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
 const response=await fetch(new URL('/api/data',process.env.APP_BASE_URL),{method:'POST',headers,body:JSON.stringify(encode(body))});
 if(!response.ok)throw new Error(`Database API failed: ${response.status}`);return response.json();
}
function snapshot(row,path){return {id:path.split('/').at(-1),ref:new Ref('document',path),exists:!!row,data:()=>row?decode(row.data):undefined,get:key=>row?.data?.[key]};}
class Ref{
 constructor(kind,path,constraints=[]){this.kind=kind;this.path=path;this.id=path.split('/').at(-1);this.constraints=constraints;}
 doc(id=require('node:crypto').randomUUID()){return new Ref('document',`${this.path}/${id}`);}
 collection(name){return new Ref('collection',`${this.path}/${name}`);}
 where(field,op,value){return new Ref(this.kind,this.path,[...this.constraints,{kind:'where',field,op,value}]);}
 orderBy(field,direction='asc'){return new Ref(this.kind,this.path,[...this.constraints,{kind:'orderBy',field,direction}]);}
 limit(count){return new Ref(this.kind,this.path,[...this.constraints,{kind:'limit',count}]);}
 startAfter(s){return new Ref(this.kind,this.path,[...this.constraints,{kind:'startAfter',value:{snapshot:{path:s.ref.path,data:s.data()}}}]);}
 async get(){const rows=await request({action:'read',ref:this});if(this.kind==='document')return snapshot(rows[0],this.path);const docs=rows.map(r=>snapshot(r,r.path));return {docs,size:docs.length,empty:!docs.length,forEach:fn=>docs.forEach(fn)};}
 async set(data,options){return request({action:'write',operations:[{kind:'set',path:this.path,data,merge:options?.merge}]});}
 async update(data){return request({action:'write',operations:[{kind:'update',path:this.path,data}]});}
 async delete(){return request({action:'write',operations:[{kind:'delete',path:this.path}]});}
 async add(data){const ref=this.doc();await ref.set(data);return ref;}
 onSnapshot(next,error){let active=true,timer,previous=new Map();const poll=async()=>{try{const snap=await this.get();const current=new Map(snap.docs.map(d=>[d.id,JSON.stringify(d.data())]));snap.docChanges=()=>snap.docs.filter(d=>current.get(d.id)!==previous.get(d.id)).map(d=>({doc:d,type:previous.has(d.id)?'modified':'added'}));if(active)next(snap);previous=current;}catch(e){if(active)error?.(e);}if(active)timer=setTimeout(poll,15000);};void poll();return ()=>{active=false;clearTimeout(timer);};}
}
const db={collection:name=>new Ref('collection',name),collectionGroup:name=>new Ref('group',name),doc:path=>new Ref('document',path),batch(){const operations=[];const b={set(ref,data,options){operations.push({kind:'set',path:ref.path,data,merge:options?.merge});return b;},update(ref,data){operations.push({kind:'update',path:ref.path,data});return b;},delete(ref){operations.push({kind:'delete',path:ref.path});return b;},commit(){return request({action:'write',operations});}};return b;}};
const firestore=()=>db;Object.assign(firestore,{Timestamp,FieldValue,FieldPath:{documentId:()=>'__name__'}});
module.exports={firestore,apps:[],initializeApp(){if(!process.env.APP_BASE_URL)throw new Error('APP_BASE_URL is required');},db};
