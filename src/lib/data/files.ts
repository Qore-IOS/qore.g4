import {apiUrl} from './transport';
/** Browser file operations use private Vercel Blob through the server. */
export const storage = {};
export function ref(_storage:any,path:string){return {fullPath:path};}
export async function uploadBytes(reference:{fullPath:string},body:Blob|Uint8Array|ArrayBuffer,metadata?:{contentType?:string}){
 const form=new FormData();form.set('path',reference.fullPath);
 const file=body instanceof Blob?body:new Blob([body as ArrayBuffer],{type:metadata?.contentType});
 form.set('file',file);
 const response=await fetch(apiUrl('/api/files'),{method:'POST',body:form});
 if(!response.ok)throw new Error('File upload failed');return {ref:reference};
}
export async function getDownloadURL(reference:{fullPath:string}){return apiUrl(`/api/files?path=${encodeURIComponent(reference.fullPath)}`);}
export async function getBytes(reference:{fullPath:string}){const r=await fetch(await getDownloadURL(reference));if(!r.ok)throw new Error('File download failed');return r.arrayBuffer();}
export async function deleteObject(reference:{fullPath:string}){const r=await fetch(await getDownloadURL(reference),{method:'DELETE'});if(!r.ok)throw new Error('File deletion failed');}
