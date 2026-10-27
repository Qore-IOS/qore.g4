export const apiUrl=(path:string)=>(process.env.NEXT_PUBLIC_API_BASE_URL || '')+path;
import { encode } from './model';
export async function request(body:any):Promise<any>{
 const response=await fetch(apiUrl('/api/data'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(encode(body)),cache:'no-store'});
 const result=await response.json();
 if(!response.ok){const error:any=new Error(result.error || 'Database request failed');error.code=response.status===409?'conflict':'database';throw error;}
 return result;
}
