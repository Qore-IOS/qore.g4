import { readDocuments, commitOperations } from './postgres';
export async function request(body:any):Promise<any>{
 return body.action==='read'||body.action==='count'?readDocuments(body.ref,undefined,body.action==='count'):commitOperations(body.operations,body.reads);
}

export const apiUrl=(path:string)=>(process.env.NEXT_PUBLIC_API_BASE_URL || '')+path;
