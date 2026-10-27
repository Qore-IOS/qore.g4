/** Shared operator identity for the deliberately login-free deployment.
 * This is not a session or credential. All visitors have the same access.
 */
export const workspaceIdentity = {
 uid:'workspace', displayName:'Çalışma Alanı', name:'Çalışma Alanı', email:null,
 role:'super_admin', companyId:'__legacy__', isAnonymous:false,
 async getIdToken(_forceRefresh?:boolean){return 'workspace';},
 async getIdTokenResult(_forceRefresh?:boolean){return {claims:{role:'super_admin',companyId:'__legacy__'}};},
};
export type User=typeof workspaceIdentity;
export const getAuth=(_app?:unknown)=>({currentUser:workspaceIdentity});
export const onAuthStateChanged=(_app:unknown,fn:(user:User)=>unknown)=>{queueMicrotask(()=>fn(workspaceIdentity));return ()=>{};};
export async function signOut(_app?:unknown){if(typeof window!=='undefined')window.location.assign('/dashboard');}
