import 'server-only';
import { readDocuments, commitOperations, pool, ConflictError } from './postgres';
import { decode, FieldValue, Timestamp, type Constraint, type Operation, type ReadVersion, type Ref } from './model';
export { FieldValue, Timestamp };
export type DocumentData=Record<string,any>;
export type Query<T=any>=AdminRef<'collection'|'group'>;
export type Firestore=any;
function snap(row:any,path:string):AdminDocumentSnapshot {const ref=new AdminRef('document',path);const data=row?decode(row.data):undefined;return {id:ref.id,ref,exists:!!row,data:()=>data,get:(name:string)=>name.split('.').reduce((x,k)=>x?.[k],data),_version:row?.version||null};}
function qs(rows:any[]):AdminQuerySnapshot{const docs=rows.map(r=>snap(r,r.path));return {docs,size:docs.length,empty:!docs.length,forEach:(fn:any)=>docs.forEach(fn)};}
export interface AdminDocumentSnapshot {id:string;ref:AdminRef<'document'>;exists:boolean;data():DocumentData|undefined;get(name:string):any;_version:string|null;}
export interface AdminQuerySnapshot {docs:AdminDocumentSnapshot[];size:number;empty:boolean;forEach(fn:(doc:AdminDocumentSnapshot)=>void):void;}
class AdminRef<K extends string='document'|'collection'|'group'> {
 id:string;
 constructor(public kind:K,public path:string,public constraints:Constraint[]=[]) {this.id=path.split('/').at(-1)!;}
 get parent():any{const path=this.path.split('/').slice(0,-1).join('/');return path?new AdminRef(this.kind==='document'?'collection':'document',path):null;}
 doc(id=crypto.randomUUID()):AdminRef<'document'>{return new AdminRef('document',`${this.path}/${id}`);}
 collection(name:string):AdminRef<'collection'>{return new AdminRef('collection',`${this.path}/${name}`);}
 where(field:string,op:string,value:any):AdminRef<K>{return new AdminRef(this.kind,this.path,[...this.constraints,{kind:'where',field,op,value}]);}
 orderBy(field:string,direction='asc'):AdminRef<K>{return new AdminRef(this.kind,this.path,[...this.constraints,{kind:'orderBy',field,direction}]);}
 limit(count:number):AdminRef<K>{return new AdminRef(this.kind,this.path,[...this.constraints,{kind:'limit',count}]);}
 startAfter(...values:any[]):AdminRef<K>{const s=values[0];return new AdminRef(this.kind,this.path,[...this.constraints,{kind:'startAfter',value:s?.ref?{snapshot:{path:s.ref.path,data:s.data()}}:{values}}]);}
 async get():Promise<K extends 'document'?AdminDocumentSnapshot:AdminQuerySnapshot>{const rows=await readDocuments(this);return (this.kind==='document'?snap(rows[0],this.path):qs((this as any).fields?rows.map(r=>({...r,data:Object.fromEntries((this as any).fields.filter((f:string)=>f in r.data).map((f:string)=>[f,r.data[f]]))})):rows)) as any;}
 async set(data:any,options?:{merge?:boolean}){return commitOperations([{kind:'set',path:this.path,data,merge:options?.merge}]);}
 async update(data:any){return commitOperations([{kind:'update',path:this.path,data}]);}
 async delete(){return commitOperations([{kind:'delete',path:this.path}]);}
 async add(data:any){const ref=this.doc();await ref.set(data);return ref;}
 count(){return {get:async()=>{const rows=await readDocuments(this,undefined,true);return {data:()=>({count:rows[0].count})};}};}
 withConverter(){return this;}
 select(...fields:string[]):any{const ref=new AdminRef(this.kind,this.path,this.constraints);(ref as any).fields=fields;return ref;}
}
function batch(){const operations:Operation[]=[];const b={set(ref:Ref,data:any,options?:{merge?:boolean}){operations.push({kind:'set',path:ref.path,data,merge:options?.merge});return b;},update(ref:Ref,data:any){operations.push({kind:'update',path:ref.path,data});return b;},delete(ref:Ref){operations.push({kind:'delete',path:ref.path});return b;},commit(){return commitOperations(operations);}};return b;}
export const adminDb={
 collection:(name:string)=>new AdminRef('collection',name),
 collectionGroup:(name:string)=>new AdminRef('group',name),
 doc:(path:string)=>new AdminRef('document',path),batch,
 async getAll(...refs:AdminRef<'document'>[]){return Promise.all(refs.map(r=>r.get()));},
 async runTransaction<T>(fn:(tx:any)=>Promise<T>):Promise<T>{
  for(let attempt=0;attempt<5;attempt++){
   const writes:Operation[]=[],reads:ReadVersion[]=[];
   const tx={async get(ref:AdminRef<'document'>){if(writes.length)throw new Error('Read before write required');if(ref.kind!=='document')throw new Error('Transaction query reads are unsupported');const s=await ref.get();reads.push({path:ref.path,version:s._version});return s;},set(ref:Ref,data:any,options?:{merge?:boolean}){writes.push({kind:'set',path:ref.path,data,merge:options?.merge});return tx;},update(ref:Ref,data:any){writes.push({kind:'update',path:ref.path,data});return tx;},delete(ref:Ref){writes.push({kind:'delete',path:ref.path});return tx;}};
   const result=await fn(tx);try{await commitOperations(writes,reads);return result;}catch(e){if(!(e instanceof ConflictError)||attempt===4)throw e;}
  }throw new Error('Transaction retries exhausted');
 }
};
export function getAdminSdkStatus(){return {ready:!!(process.env.DATABASE_URL || (process.env.NODE_ENV !== 'production' && process.env.QORE_LOCAL_DATABASE)),credentialSource:'postgresql',projectId:null,error:(process.env.DATABASE_URL || (process.env.NODE_ENV !== 'production' && process.env.QORE_LOCAL_DATABASE))?null:'DATABASE_URL is required'};}
export async function probeAdminSdk(){try{await pool().query('SELECT 1 FROM qore_documents LIMIT 1');return {...getAdminSdkStatus(),ready:true};}catch(e:any){return {...getAdminSdkStatus(),ready:false,error:e.message};}}
export type DocumentReference<T=any>=AdminRef<'document'>;
export type DocumentSnapshot<T=any>=AdminDocumentSnapshot;
export type QueryDocumentSnapshot<T=any>=AdminDocumentSnapshot;
export type QuerySnapshot<T=any>=AdminQuerySnapshot;
export type WriteBatch=ReturnType<typeof batch>;
export type Transaction=any;
export type UpdateData<T=any>=Partial<T>;
export type FieldPath=string;
export type WhereFilterOp=string;
export type OrderByDirection='asc'|'desc';
export const FieldPath={documentId:()=>'__name__'};
export function snapshotFromData(path:string,data:any){return snap(data?{path,data}:null,path);}
