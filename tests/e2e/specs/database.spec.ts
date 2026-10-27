import {test,expect} from '@playwright/test';
test('PostgreSQL API writes, reads, counts and deletes inventory records',async({request})=>{
 const path=`smoke/${crypto.randomUUID()}`;
 const send=async(body:any)=>{const response=await request.post('/api/data',{data:body});expect(response.status()).toBe(200);return response.json();};
 try{
  await send({action:'write',operations:[{kind:'set',path,data:{quantity:4,companyId:'__legacy__'}}]});
  await send({action:'write',operations:[{kind:'update',path,data:{quantity:{$operation:'increment',amount:2}}}]});
  const records=await send({action:'read',ref:{kind:'document',path}});expect(records[0].data.quantity).toBe(6);
  const count=await send({action:'count',ref:{kind:'collection',path:'smoke',constraints:[{kind:'where',field:'quantity',op:'==',value:6}]}});expect(count[0].count).toBeGreaterThan(0);
 }finally{await send({action:'write',operations:[{kind:'delete',path}]});}
});
test('database health is functional and cron requires its own credential',async({request})=>{
 expect((await request.get('/api/health/admin')).status()).toBe(200);
 expect([401,503]).toContain((await request.get('/api/jobs')).status());
});
