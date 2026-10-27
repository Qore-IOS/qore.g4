import 'server-only';
import {put,del,head,get} from '@vercel/blob';
function validate(path:string){if(!path||path.length>1500||path.split('/').some(s=>!s||s==='.'||s==='..')||path.startsWith('http'))throw new Error('Invalid file path');}
export async function resolveStorageBucket(){
 return {file(path:string){
  validate(path);
  return {
   async save(buffer:Buffer,options?:any){await put(path,buffer,{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:options?.metadata?.contentType || 'application/octet-stream'});},
   async getSignedUrl(_options?:any){return [`/api/files?path=${encodeURIComponent(path)}`];},
   async metadata(){return head(path);},
   async exists(){try{await head(path);return [true];}catch(e:any){if(e.name==='BlobNotFoundError')return [false];throw e;}},
   async download(){const result=await get(path,{access:'private'});if(!result||result.statusCode!==200)throw new Error('File not found');return [Buffer.from(await new Response(result.stream).arrayBuffer())];},
   async delete(_options?:any){await del(path);},
  };
 }};
}
