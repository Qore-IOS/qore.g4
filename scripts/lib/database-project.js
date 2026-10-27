const {db}=require('../db/script-store.cjs');
function initAdmin(){if(!process.env.APP_BASE_URL)throw new Error('APP_BASE_URL is required');return {db,projectId:'workspace'};}
module.exports={initAdmin,resolveProjectId:()=> 'workspace'};
