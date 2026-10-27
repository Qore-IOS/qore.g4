import type {Unsubscribe,DocumentSnapshot,QuerySnapshot,QueryDocumentSnapshot,DocumentReference,Query,FirestoreDataConverter} from './types';
import {decode,encode,Timestamp,type Ref,type Constraint,type Operation,type ReadVersion,type DocumentData} from './model';
export function createDocumentClient(request:(body:any)=>Promise<any>){
const db = { kind: 'database', path: '' };
const make = (kind: string, path: string): any => ({kind,path,id:path.split('/').at(-1),get parent(){const parent=path.split('/').slice(0,-1).join('/');return parent?make(kind==='document'?'collection':'document',parent):null;},withConverter(converter:any){return {...this,converter};}});
function collection(base: any, ...parts: string[]): Query { return make('collection',[base?.path,...parts].filter(Boolean).join('/')); }
function doc<T=DocumentData>(base: {path?:string;converter?:FirestoreDataConverter<T>}, ...parts: string[]): DocumentReference<T> { return {...make('document',[base?.path,...(parts.length ? parts : [crypto.randomUUID()])].filter(Boolean).join('/')),converter:base?.converter}; }
function collectionGroup(_db: any, name: string): Query { return make('group',name); }
const documentId = () => '__name__';
const where = (field: string, op: string, value: any): Constraint => ({kind:'where',field,op,value});
const orderBy = (field: string, direction = 'asc'): Constraint => ({kind:'orderBy',field,direction});
const limit = (count: number): Constraint => ({kind:'limit',count});
function startAfter(...args:any[]): Constraint {
 const first=args[0]; return {kind:'startAfter',value:first?.ref ? {snapshot:{path:first.ref.path,data:first.data()}} : {values:args}};
}
function query<T=DocumentData>(ref: Query<T>,...constraints: Constraint[]): Query<T> { return {...ref,constraints:[...(ref.constraints || []),...constraints]}; }
function snapshot<T=DocumentData>(row:any, path?: string, converter?:FirestoreDataConverter<T>): QueryDocumentSnapshot<T> {
 const ref={...make('document',row?.path || path!),converter};
 const data=row ? decode(row.data) : undefined;
 const raw:QueryDocumentSnapshot={id:ref.id,ref,exists:()=>Boolean(row),data:()=>data,get:(name:string)=>name.split('.').reduce((v,k)=>v?.[k],data),_version:row?.version || null,metadata:{fromCache:false,hasPendingWrites:false}};
 return {...raw,ref:ref as DocumentReference<T>,data:()=>converter&&row?converter.fromFirestore(raw):data};
}
function querySnapshot<T=DocumentData>(rows:any[],converter?:FirestoreDataConverter<T>): QuerySnapshot<T> {
 const docs=rows.map(r=>snapshot(r,undefined,converter));
 return {docs,empty:!docs.length,size:docs.length,forEach:(fn:any)=>docs.forEach(fn),docChanges:()=>docs.map(d=>({type:'added',doc:d})),metadata:{fromCache:false,hasPendingWrites:false}};
}
async function getDoc<T=DocumentData>(ref:DocumentReference<T>):Promise<DocumentSnapshot<T>> { const rows=await request({action:'read',ref});return snapshot<T>(rows[0],ref.path,ref.converter); }
const getDocFromServer=getDoc;
async function getDocs<T=DocumentData>(ref:Query<T>):Promise<QuerySnapshot<T>> { return querySnapshot<T>(await request({action:'read',ref}),ref.converter); }
const getDocsFromServer=getDocs;
async function getCountFromServer(ref:Ref) { const rows=await request({action:'count',ref});return {data:()=>({count:rows[0].count})}; }
async function setDoc(ref:Ref,data:any,options?:{merge?:boolean}) { await request({action:'write',operations:[{kind:'set',path:ref.path,data:(ref as any).converter?.toFirestore?.(data)??data,merge:options?.merge}]}); }
async function updateDoc(ref:Ref,data:any) { await request({action:'write',operations:[{kind:'update',path:ref.path,data}]}); }
async function deleteDoc(ref:Ref) { await request({action:'write',operations:[{kind:'delete',path:ref.path}]}); }
async function addDoc(ref:Ref,data:any) { const d=doc(ref);await setDoc(d,data);return d; }
function writeBatch(_db?:any) {
 const operations:Operation[]=[];
 const batch={
  set(ref:Ref,data:any,options?:{merge?:boolean}){operations.push({kind:'set',path:ref.path,data,merge:options?.merge});return batch;},
  update(ref:Ref,data:any){operations.push({kind:'update',path:ref.path,data});return batch;},
  delete(ref:Ref){operations.push({kind:'delete',path:ref.path});return batch;},
  async commit(){await request({action:'write',operations});}
 };return batch;
}
async function runTransaction<T>(_db:any,fn:(tx:any)=>Promise<T>):Promise<T> {
 for(let attempt=0;attempt<5;attempt++) {
  const operations:Operation[]=[],reads:ReadVersion[]=[];
  const tx={
   async get(ref:DocumentReference){if(operations.length)throw new Error('Transaction reads must precede writes');const s=await getDoc(ref);reads.push({path:ref.path,version:s._version});return s;},
   set(ref:Ref,data:any,options?:{merge?:boolean}){operations.push({kind:'set',path:ref.path,data,merge:options?.merge});return tx;},
   update(ref:Ref,data:any){operations.push({kind:'update',path:ref.path,data});return tx;},
   delete(ref:Ref){operations.push({kind:'delete',path:ref.path});return tx;}
  };
  const result=await fn(tx);
  try {await request({action:'write',operations,reads});return result;}
  catch(e:any){if((e.code!=='conflict' && e.constructor.name!=='ConflictError')||attempt===4)throw e;}
 }
 throw new Error('Transaction retries exhausted');
}
/** Vercel functions cannot retain listeners. Poll only while the page is visible. */
function onSnapshot<T=DocumentData>(ref:DocumentReference<T>,next:(snapshot:DocumentSnapshot<T>)=>unknown,error?:(error:Error & {code?:string})=>unknown):Unsubscribe;
function onSnapshot<T=DocumentData>(ref:Query<T>,next:(snapshot:QuerySnapshot<T>)=>unknown,error?:(error:Error & {code?:string})=>unknown):Unsubscribe;
function onSnapshot(ref:Ref,options:object,next:(snapshot:any)=>unknown,error?:(error:Error & {code?:string})=>unknown):Unsubscribe;
function onSnapshot(ref:Ref, ...args:any[]): Unsubscribe {
 const observer=args.find(x=>typeof x==='function'||x?.next);
 const next=typeof observer==='function'?observer:observer?.next;
 const error=args.filter(x=>typeof x==='function')[1] || observer?.error;
 let active=true,timer:ReturnType<typeof setTimeout>,previous='';
 async function poll(){
  if(!active)return;
  if(typeof document==='undefined'||document.visibilityState!=='hidden')try{
   const rows=await request({action:'read',ref});const signature=JSON.stringify(rows);
   if(active&&signature!==previous){
    const oldRows=previous?JSON.parse(previous):[];previous=signature;
    if(ref.kind==='document')next?.(snapshot(rows[0],ref.path,(ref as any).converter));
    else {const result=querySnapshot(rows,(ref as any).converter);result.docChanges=()=>[
     ...rows.filter((r:any)=>!oldRows.some((o:any)=>o.path===r.path&&o.version===r.version)).map((r:any)=>({type:oldRows.some((o:any)=>o.path===r.path)?'modified':'added',doc:snapshot(r)})),
     ...oldRows.filter((r:any)=>!rows.some((n:any)=>n.path===r.path)).map((r:any)=>({type:'removed',doc:snapshot(r)}))
    ];next?.(result);}
   }
  }catch(e){if(active)error?.(e);}
  if(active)timer=setTimeout(poll,15000);
 }
 void poll();return ()=>{active=false;clearTimeout(timer);};
}

return {db,collection,doc,collectionGroup,documentId,where,orderBy,limit,startAfter,query,snapshot,querySnapshot,getDoc,getDocFromServer,getDocs,getDocsFromServer,getCountFromServer,setDoc,updateDoc,deleteDoc,addDoc,writeBatch,runTransaction,onSnapshot};
}
