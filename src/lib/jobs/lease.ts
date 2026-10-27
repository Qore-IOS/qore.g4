type Connection={query(sql:string,values?:any[]):Promise<{rows:Record<string,any>[]}>};
/** Ownership is stored in SQL so it survives transaction-pooler reassignment. */
export async function acquireWorkerLease(client:Connection,owner:string):Promise<boolean>{
 const result=await client.query(`INSERT INTO qore_worker_leases(name,owner,expires_at)
 VALUES('jobs',$1,now()+interval '15 minutes')
 ON CONFLICT(name) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at
 WHERE qore_worker_leases.expires_at<now() RETURNING owner`,[owner]);
 return result.rows.length===1;
}
export async function releaseWorkerLease(client:Connection,owner:string){
 await client.query("DELETE FROM qore_worker_leases WHERE name='jobs' AND owner=$1",[owner]);
}
