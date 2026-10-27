import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const directory=process.env.QORE_LOCAL_DATABASE;
if(!directory)throw new Error('QORE_LOCAL_DATABASE is required');
(async()=>{const db=new PGlite(directory);try{await db.exec(readFileSync('scripts/db/schema.sql','utf8'));console.log('Local PostgreSQL initialized');}finally{await db.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
