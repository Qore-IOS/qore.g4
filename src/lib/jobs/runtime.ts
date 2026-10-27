/** Job declarations consumed by the PostgreSQL outbox worker and Vercel Cron. */
export type Job={kind:'create'|'update'|'write'|'delete'|'schedule'|'call';path?:string;schedule?:string;timeZone?:string;handler:(...args:any[])=>Promise<any>};
export const logger=console;
export class HttpsError extends Error {constructor(public code:string,message:string){super(message);}}
class Builder {
 constructor(private path?:string){}
 region(_region:string){return this;}
 runWith(_options:any){return this;}
 get firestore(){return this;}
 document(path:string){return new Builder(path);}
 onCreate(handler:any):Job{return {kind:'create',path:this.path,handler};}
 onUpdate(handler:any):Job{return {kind:'update',path:this.path,handler};}
 onWrite(handler:any):Job{return {kind:'write',path:this.path,handler};}
 onDelete(handler:any):Job{return {kind:'delete',path:this.path,handler};}
}
export const region=(name:string)=>new Builder().region(name);
export const firestore=new Builder();
export function onDocumentWritten(options:any,handler:any):Job{return {kind:'write',path:typeof options==='string'?options:options.document,handler:async(change:any,context:any)=>handler({data:change,params:context.params})};}
export function onSchedule(options:any,handler:any):Job{return {kind:'schedule',schedule:options.schedule,timeZone:options.timeZone||'UTC',handler};}
export function onCall(_options:any,handler:any):Job{return {kind:'call',handler};}
