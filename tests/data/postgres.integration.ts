import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {readDocuments,commitOperations,ConflictError} from '../../src/lib/data/postgres';
import {Timestamp,encode,decode,increment,arrayUnion,arrayRemove,serverTimestamp,deleteField} from '../../src/lib/data/model';

const db=new PGlite();
const connection:any={connect:async()=>({query:(sql:string,params:any[])=>db.query(sql,params),release(){}})};
const read=(path:string,constraints:any[]=[])=>readDocuments({kind:'collection',path,constraints},db as any);
const write=(operations:any[],reads:any[]=[])=>commitOperations(operations,reads,connection);
before(async()=>{await db.exec(readFileSync('scripts/db/schema.sql','utf8'));});
after(async()=>{await db.close();});
test('schema migration is repeatable',async()=>{await db.exec(readFileSync('scripts/db/schema.sql','utf8'));assert.equal((await read('users')).length,1);});
test('round trips nested records, arrays, timestamps and dates',async()=>{
 await write([{kind:'set',path:'inventory/a',data:{quantity:2,nested:{code:'K1'},tags:['x'],received:Timestamp.fromMillis(1000),date:new Date(2000)}}]);
 const rows=await read('inventory');assert.equal(rows.length,1);const data=decode(rows[0].data);assert.equal(data.received.toMillis(),1000);assert.equal(data.date.toDate().getTime(),2000);assert.deepEqual(data.tags,['x']);
});
test('atomic increments, array transforms, dotted updates and field deletion',async()=>{
 await write([{kind:'update',path:'inventory/a',data:{quantity:increment(3),tags:arrayUnion('x','y'),'nested.value':42,obsolete:'remove'}}]);
 await write([{kind:'update',path:'inventory/a',data:{tags:arrayRemove('x'),obsolete:deleteField(),updatedAt:serverTimestamp()}}]);
 const [row]=await read('inventory');assert.equal(row.data.quantity,5);assert.deepEqual(row.data.tags,['y']);assert.equal(row.data.nested.value,42);assert.ok(!('obsolete'in row.data));assert.ok(row.data.updatedAt.$timestamp>0);
});
test('queries filter, sort and paginate in SQL',async()=>{
 await write([1,2,3].map(n=>({kind:'set',path:`products/${n}`,data:{companyId:n===3?'other':'main',price:n,tags:['kit']}})));
 const rows=await read('products',[{kind:'where',field:'companyId',op:'==',value:'main'},{kind:'orderBy',field:'price',direction:'desc'},{kind:'limit',count:1}]);
 assert.equal(rows[0].data.price,2);
 const next=await read('products',[{kind:'orderBy',field:'price',direction:'asc'},{kind:'startAfter',value:{snapshot:{path:'products/1',data:{price:1}}}}]);assert.deepEqual(next.map(r=>r.data.price),[2,3]);
 const tags=await read('products',[{kind:'where',field:'tags',op:'array-contains-any',value:['kit','tube']}]);assert.equal(tags.length,3);
});
test('query values and field names cannot inject SQL',async()=>{
 assert.equal((await read('products',[{kind:'where',field:"price') OR true --",op:'==',value:"' OR true --"}])).length,0);
 assert.equal((await read('products')).length,3);
});
test('batches roll back every write on error',async()=>{
 await assert.rejects(write([{kind:'set',path:'atomic/new',data:{ok:true}},{kind:'update',path:'atomic/missing',data:{no:true}}]));
 assert.equal((await read('atomic')).length,0);
});
test('optimistic transactions reject stale and missing-document reads',async()=>{
 const [row]=await read('inventory');await write([{kind:'update',path:'inventory/a',data:{quantity:8}}]);
 await assert.rejects(write([{kind:'update',path:'inventory/a',data:{quantity:9}}],[{path:'inventory/a',version:row.version}]),ConflictError);
 await write([{kind:'set',path:'newRecords/a',data:{n:1}}]);
 await assert.rejects(write([],[{path:'newRecords/a',version:null}]),ConflictError);
 assert.equal((await read('inventory'))[0].data.quantity,8);
});
test('committed mutations produce durable outbox events; rollback does not',async()=>{
 const before=(await db.query('SELECT count(*)::int AS n FROM qore_outbox')).rows[0] as any;
 await write([{kind:'set',path:'events/a',data:{n:1}},{kind:'delete',path:'events/a'}]);
 const events=(await db.query('SELECT before_data,after_data FROM qore_outbox WHERE path=$1 ORDER BY id',['events/a'])).rows as any[];
 assert.equal(events.length,2);assert.equal(events[0].before_data,null);assert.equal(events[1].after_data,null);
 await assert.rejects(write([{kind:'set',path:'events/b',data:{n:2}},{kind:'update',path:'events/missing',data:{n:3}}]));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM qore_outbox')).rows[0].n,before.n+2);
});
test('collection groups and timestamp comparisons work',async()=>{
 await write([{kind:'set',path:'parents/a/items/one',data:{at:Timestamp.fromMillis(1000)}},{kind:'set',path:'parents/b/items/two',data:{at:Timestamp.fromMillis(3000)}}]);
 const rows=await readDocuments({kind:'group',path:'items',constraints:[{kind:'where',field:'at',op:'>=',value:Timestamp.fromMillis(2000)}]},db as any);
 assert.deepEqual(rows.map(r=>r.path),['parents/b/items/two']);
});
test('rejects malformed paths and unsupported operations',async()=>{
 await assert.rejects(write([{kind:'set',path:'products/../invalid',data:{}}]));
 await assert.rejects(read('products',[{kind:'where',field:'price',op:'DROP TABLE',value:1}]));
 assert.equal(JSON.stringify(encode(decode({$timestamp:1000}))),'{"$timestamp":1000}');
});
test('SQL counts and document ID filters do not materialize full records',async()=>{
 const rows=await readDocuments({kind:'collection',path:'products',constraints:[{kind:'where',field:'__name__',op:'in',value:['1','2']}]},db as any,true);
 assert.equal(rows[0].count,2);
});
test('updating a map replaces it; merge-set preserves existing nested keys',async()=>{
 await write([{kind:'set',path:'maps/a',data:{nested:{a:1,b:2}}}]);
 await write([{kind:'update',path:'maps/a',data:{nested:{c:3}}}]);
 assert.deepEqual((await read('maps'))[0].data.nested,{c:3});
 await write([{kind:'set',path:'maps/a',merge:true,data:{nested:{d:4}}}]);
 assert.deepEqual((await read('maps'))[0].data.nested,{c:3,d:4});
});
test('shared document API preserves converters and reference parents',async()=>{
 const {createDocumentClient}=await import('../../src/lib/data/factory');
 const client=createDocumentClient(async(body:any)=>body.action==='read'||body.action==='count'?readDocuments(body.ref,db as any,body.action==='count'):write(body.operations,body.reads));
 const ref=client.doc(client.db,'protocol','one');await client.setDoc(ref,{at:new Date(4000),n:1});
 const converted=await client.getDoc(ref.withConverter({fromFirestore:(s:any)=>({...s.data(),at:s.data().at.toDate()})}));
 assert.equal(converted.data().at.getTime(),4000);assert.equal(converted.ref.parent.id,'protocol');
 const result=await client.getCountFromServer(client.collection(client.db,'protocol'));assert.equal(result.data().count,1);
});
test('shared transaction API commits acknowledged stock changes',async()=>{
 const {createDocumentClient}=await import('../../src/lib/data/factory');
 const client=createDocumentClient(async(body:any)=>body.action==='read'?readDocuments(body.ref,db as any):write(body.operations,body.reads));
 const ref=client.doc(client.db,'protocol','one');
 await client.runTransaction(client.db,async(tx:any)=>{const s=await tx.get(ref);tx.update(ref,{n:s.data().n+3});});
 assert.equal((await client.getDoc(ref)).data().n,4);
});
test('array transforms compare nested objects independent of JSON key order',async()=>{
 await write([{kind:'set',path:'transforms/a',data:{values:[{a:1,b:2}]}}]);
 await write([{kind:'update',path:'transforms/a',data:{values:arrayUnion({b:2,a:1},{c:3},{c:3})}}]);
 assert.equal((await read('transforms'))[0].data.values.length,2);
 await write([{kind:'update',path:'transforms/a',data:{values:arrayRemove({b:2,a:1})}}]);
 assert.deepEqual((await read('transforms'))[0].data.values,[{c:3}]);
});
test('worker leases remain exclusive across pooled connections and stale owners',async()=>{
 const {acquireWorkerLease,releaseWorkerLease}=await import('../../src/lib/jobs/lease');
 assert.equal(await acquireWorkerLease(db as any,'owner-a'),true);
 assert.equal(await acquireWorkerLease(db as any,'owner-b'),false);
 await releaseWorkerLease(db as any,'owner-b');
 assert.equal(await acquireWorkerLease(db as any,'owner-b'),false);
 await db.query("UPDATE qore_worker_leases SET expires_at=now()-interval '1 second'");
 assert.equal(await acquireWorkerLease(db as any,'owner-b'),true);
 await releaseWorkerLease(db as any,'owner-a');
 assert.equal((await db.query('SELECT owner FROM qore_worker_leases')).rows[0].owner,'owner-b');
 await releaseWorkerLease(db as any,'owner-b');
});
