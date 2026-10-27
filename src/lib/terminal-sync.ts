'use client';
/** PostgreSQL writes require a server acknowledgement. Unconfirmed legacy
 * operations must never be marked sent merely because the network is back. */
import {listPendingOperations} from '@/lib/pending-operations';
export type SyncResult={reconciled:number;timedOut:boolean};
export async function reconcilePendingWrites():Promise<SyncResult>{
 return {reconciled:0,timedOut:listPendingOperations().some(op=>op.status==='pending')};
}
export async function forceResync():Promise<SyncResult>{
 const response=await fetch('/api/health/admin',{cache:'no-store'});
 if(!response.ok)throw new Error('Veritabanına erişilemiyor.');
 return reconcilePendingWrites();
}
