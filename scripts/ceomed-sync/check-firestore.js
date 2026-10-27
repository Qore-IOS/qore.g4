const {db}=require('../db/script-store.cjs');
(async()=>{const snap=await db.collection('depoStok').limit(1).get();console.log(`PostgreSQL API bağlantısı başarılı (${snap.size} kayıt)`);})().catch(e=>{console.error(e.message);process.exitCode=1;});
