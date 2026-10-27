import {acquireWorkerLease,releaseWorkerLease} from './lease';
import 'server-only';
import * as declarations from './index';
import {pool} from '../data/postgres';
import {snapshotFromData} from '../data/admin';
import type {Job} from './runtime';

function paramsFor(pattern:string,path:string){
 const expected=pattern.split('/'),actual=path.split('/');if(expected.length!==actual.length)return null;
 const params:Record<string,string>={};
 for(let i=0;i<expected.length;i++){const part=expected[i];if(part.startsWith('{')&&part.endsWith('}'))params[part.slice(1,-1)]=actual[i];else if(part!==actual[i])return null;}
 return params;
}
export function scheduleSlot(schedule:string,zone:string,now=new Date()):string|null{
 const interval=schedule.match(/^every (\d+) (minutes?|hours?)$/);
 if(interval){const ms=Number(interval[1])*(interval[2].startsWith('hour')?3600000:60000);return String(Math.floor(now.getTime()/ms));}
 const daily=schedule.match(/^every day (\d\d):(\d\d)$/)||schedule.match(/^(\d+) (\d+) \* \* \*$/)?.map((v,i,a)=>i===1?a[2]:i===2?a[1]:v);
 if(!daily)throw new Error(`Unsupported job schedule: ${schedule}`);
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 if(Number(parts.hour)*60+Number(parts.minute)<Number(daily[1])*60+Number(daily[2]))return null;
 return `${parts.year}-${parts.month}-${parts.day}`;
}
export async function runJobs(){
 const owner=crypto.randomUUID();let ownsLease=false;
 try{
  ownsLease=await acquireWorkerLease(pool(),owner);
  if(!ownsLease)return {busy:true};
  const started=Date.now();let processed=0,failed=0;
  const jobs=Object.entries(declarations).filter(([,j])=>j && typeof j==='object' && 'handler' in j) as [string,Job][];
  const events=(await pool().query('SELECT * FROM qore_outbox WHERE available_at<=now() ORDER BY id LIMIT 500')).rows;
  for(const event of events){
   if(Date.now()-started>200000)break;
   const done=new Set<string>(event.completed_handlers||[]);
   try{
    for(const [name,job] of jobs){
     if(!job.path||done.has(name))continue;
     const params=paramsFor(job.path,event.path);if(!params)continue;
     const created=!event.before_data&&!!event.after_data,deleted=!!event.before_data&&!event.after_data;
     if(job.kind==='create'&&!created||job.kind==='delete'&&!deleted||job.kind==='update'&&(created||deleted))continue;
     const before=snapshotFromData(event.path,event.before_data),after=snapshotFromData(event.path,event.after_data);
     await job.handler(job.kind==='create'?after:job.kind==='delete'?before:{before,after},{params,eventId:String(event.id),timestamp:event.created_at});
     done.add(name);await pool().query('UPDATE qore_outbox SET completed_handlers=$2::jsonb WHERE id=$1',[event.id,JSON.stringify([...done])]);
    }
    await pool().query('DELETE FROM qore_outbox WHERE id=$1',[event.id]);processed++;
   }catch(e:any){failed++;await pool().query("UPDATE qore_outbox SET attempts=attempts+1,error=$2,available_at=now()+interval '5 minutes' WHERE id=$1",[event.id,String(e.message).slice(0,1000)]);}
  }
  for(const [name,job] of jobs){
   if(job.kind!=='schedule'||Date.now()-started>200000)continue;
   const slot=scheduleSlot(job.schedule!,job.timeZone!);if(!slot)continue;
   const run=(await pool().query('SELECT completed FROM qore_job_runs WHERE name=$1 AND slot=$2',[name,slot])).rows[0];
   if(run?.completed)continue;
   await pool().query('INSERT INTO qore_job_runs(name,slot) VALUES($1,$2) ON CONFLICT DO NOTHING',[name,slot]);
   try{await job.handler();await pool().query('UPDATE qore_job_runs SET completed=true WHERE name=$1 AND slot=$2',[name,slot]);processed++;}catch(e){failed++;console.error('Scheduled job failed',name,e);}
  }
  return {processed,failed};
 }finally{if(ownsLease)await releaseWorkerLease(pool(),owner);}
}
