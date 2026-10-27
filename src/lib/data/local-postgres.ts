/** Development-only PostgreSQL WASM engine. Production always requires Neon. */
import {PGlite} from '@electric-sql/pglite';
export function createLocalPool(directory:string):any{
 const database=new PGlite(directory);
 let tail=Promise.resolve();
 async function connect(){
  let unlock!:()=>void;const previous=tail;tail=new Promise<void>(resolve=>{unlock=resolve;});await previous;
  return {query:(sql:string,params?:any[])=>database.query(sql,params),release:unlock};
 }
 return {connect,async query(sql:string,params?:any[]){const client=await connect();try{return await client.query(sql,params);}finally{client.release();}}};
}
