const {Pool}=require('pg');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
(async()=>{
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
 try{await pool.query(readFileSync(join(__dirname,'schema.sql'),'utf8'));console.log('PostgreSQL schema is ready');}finally{await pool.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
