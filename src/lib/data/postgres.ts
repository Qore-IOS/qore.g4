import 'server-only';
import { Pool, type PoolClient } from 'pg';
import {createLocalPool} from './local-postgres';
import { applyPatch, encode, validPath, type Operation, type ReadVersion, type Ref } from './model';

const globalPool = globalThis as typeof globalThis & { qorePool?: Pool };
export function pool() {
  if (process.env.NODE_ENV === 'development' && process.env.QORE_LOCAL_DATABASE) return globalPool.qorePool ||= createLocalPool(process.env.QORE_LOCAL_DATABASE);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Connect Neon PostgreSQL in Vercel Marketplace.');
  return globalPool.qorePool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 20000, connectionTimeoutMillis: 10000 });
}
export class ConflictError extends Error {}
const json = (v: any) => JSON.stringify(encode(v));
export async function readDocuments(ref: Ref, client: Pick<PoolClient, 'query'> = pool(), countOnly = false) {
  const params: any[] = [];
  const bind = (v: any) => { params.push(v); return `$${params.length}`; };
  if (ref.kind === 'document') {
    validPath(ref.path);
    return (await client.query('SELECT path,data,version::text FROM qore_documents WHERE path=$1', [ref.path])).rows;
  }
  const group = ref.kind === 'group';
  if (group) { if (!ref.path || ref.path.includes('/')) throw new Error('Invalid collection group'); }
  else validPath(ref.path, false);
  const clauses = [`${group ? 'collection_id' : 'collection_path'}=${bind(ref.path)}`];
  const ordering: string[] = [];
  let cap = '';
  const constraints = ref.constraints || [];
  if (constraints.length > 30) throw new Error('Too many query constraints');
  const field = (name = '') => name === '__name__' ? 'to_jsonb(path)' : `(data #> ${bind(name.split('.'))}::text[])`;
  for (const c of constraints) {
    if (c.kind === 'where') {
      const f = field(c.field);
      const nameValue=(v:any)=>typeof v==='string'&&!v.includes('/')&&!group?`${ref.path}/${v}`:v;
      const val=c.field==='__name__'?(Array.isArray(c.value)?c.value.map(nameValue):nameValue(c.value)):c.value;
      const v = bind(json(val));
      const ops: Record<string,string> = { '==': '=', '!=': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
      if (ops[c.op!]) {
        clauses.push(`${f} ${ops[c.op!]} ${v}::jsonb`);
        if(c.op==='=='&&c.field!=='__name__'){
          const containment=c.field!.split('.').reverse().reduce((nested:any,key:string)=>({[key]:nested}),val);
          clauses.push(`data @> ${bind(json(containment))}::jsonb`);
        }
      }
      else if (c.op === 'array-contains') clauses.push(`${f} @> jsonb_build_array(${v}::jsonb)`);
      else if (c.op === 'in') clauses.push(`${f} IN (SELECT value FROM jsonb_array_elements(${v}::jsonb))`);
      else if (c.op === 'not-in') clauses.push(`${f} NOT IN (SELECT value FROM jsonb_array_elements(${v}::jsonb))`);
      else if (c.op === 'array-contains-any') clauses.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(${v}::jsonb) AS candidate WHERE ${f} @> jsonb_build_array(candidate.value))`);
      else throw new Error('Unsupported query operator');
    } else if (c.kind === 'orderBy') {
      const f = field(c.field);
      clauses.push(`${f} IS NOT NULL`);
      ordering.push(`${f} ${c.direction === 'desc' ? 'DESC' : 'ASC'}`);
    } else if (c.kind === 'limit') {
      if (!Number.isInteger(c.count) || c.count! < 1 || c.count! > 100000) throw new Error('Invalid query limit');
      cap = ` LIMIT ${bind(c.count)}`;
    } else if (c.kind !== 'startAfter') throw new Error('Unsupported query constraint');
  }
  const cursor = constraints.find(c => c.kind === 'startAfter');
  if (cursor) {
    const order = constraints.filter(c => c.kind === 'orderBy');
    const values = cursor.value?.values;
    const snap = cursor.value?.snapshot;
    const terms: string[] = [];
    const equal: string[] = [];
    for (let i=0; i<order.length; i++) {
      const o = order[i];
      const raw = snap ? o.field==='__name__'?snap.path:o.field!.split('.').reduce((a:any,k:string)=>a?.[k], snap.data) : values?.[i];
      if (raw === undefined) throw new Error('Cursor lacks ordered field');
      const f=field(o.field), v=`${bind(json(raw))}::jsonb`;
      terms.push(`(${[...equal, `${f} ${o.direction === 'desc' ? '<' : '>'} ${v}`].join(' AND ')})`);
      equal.push(`${f}=${v}`);
    }
    if (snap?.path) terms.push(`(${[...equal, `path>${bind(snap.path)}`].join(' AND ')})`);
    if (!terms.length) throw new Error('Cursor requires ordering or snapshot');
    clauses.push(`(${terms.join(' OR ')})`);
  }
  const statement=`SELECT path,data,version::text FROM qore_documents WHERE ${clauses.join(' AND ')} ORDER BY ${[...ordering,'path ASC'].join(',')}${cap}`;
  return (await client.query(countOnly?`SELECT count(*)::int AS count FROM (${statement}) AS counted`:statement, params)).rows;
}
export async function commitOperations(operations: Operation[], reads: ReadVersion[] = [], connection: Pick<Pool, 'connect'> = pool()) {
  if (!Array.isArray(operations) || operations.length > 500 || !Array.isArray(reads) || reads.length > 500) throw new Error('Invalid transaction size');
  for (const op of operations) { validPath(op.path); if (!['set','update','delete'].includes(op.kind)) throw new Error('Invalid write operation'); }
  const client = await connection.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const paths = [...new Set([...operations.map(o=>o.path), ...reads.map(r=>r.path)])].sort();
    // Advisory locks also serialize competing inserts into previously absent paths.
    for (const path of paths) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[path]);
    for (const read of reads) {
      validPath(read.path);
      const row = (await client.query('SELECT version::text FROM qore_documents WHERE path=$1',[read.path])).rows[0];
      if ((row?.version || null) !== read.version) throw new ConflictError('Concurrent document change');
    }
    const now = Date.now();
    for (const op of operations) {
      if (op.kind === 'delete') {
        const old=(await client.query('DELETE FROM qore_documents WHERE path=$1 RETURNING data',[op.path])).rows[0];
        if(old)await client.query('INSERT INTO qore_outbox(path,before_data) VALUES($1,$2::jsonb)',[op.path,json(old.data)]);
        continue;
      }
      if (!op.data || typeof op.data !== 'object' || Array.isArray(op.data)) throw new Error('Document must be an object');
      const old = (await client.query('SELECT data FROM qore_documents WHERE path=$1',[op.path])).rows[0];
      if (op.kind === 'update' && !old) throw new Error(`Document not found: ${op.path}`);
      const data = applyPatch(op.kind === 'update' || op.merge ? old?.data : {}, encode(op.data), op.kind === 'update', now);
      const parts = op.path.split('/');
      await client.query(`INSERT INTO qore_documents(path,collection_path,collection_id,data) VALUES($1,$2,$3,$4::jsonb)
        ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data, version=qore_documents.version+1, updated_at=now()`,[op.path,parts.slice(0,-1).join('/'),parts.at(-2),json(data)]);
      if(json(old?.data)!==json(data))await client.query('INSERT INTO qore_outbox(path,before_data,after_data) VALUES($1,$2::jsonb,$3::jsonb)',[op.path,old?json(old.data):null,json(data)]);
    }
    await client.query('COMMIT');
  } catch(error:any) {
    await client.query('ROLLBACK');
    if (error.code === '40001' || error.code === '40P01') throw new ConflictError('Concurrent document change');
    throw error;
  } finally { client.release(); }
}
