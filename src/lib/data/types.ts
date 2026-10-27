import type {Constraint,DocumentData} from './model';
export type {DocumentData} from './model';
export type Unsubscribe=()=>void;
export type OrderByDirection='asc'|'desc';
export type WhereFilterOp='=='|'!='|'<'|'<='|'>'|'>='|'array-contains'|'array-contains-any'|'in'|'not-in';
export type QueryConstraint=Constraint;
export interface DocumentReference<T=DocumentData>{kind:string;path:string;id:string;parent:any;withConverter<U>(converter:FirestoreDataConverter<U>):DocumentReference<U>;converter?:FirestoreDataConverter<T>;}
export interface DocumentSnapshot<T=DocumentData>{id:string;ref:DocumentReference<T>;exists():boolean;data(options?:unknown):T|undefined;get(name:string):any;_version:string|null;metadata:{fromCache:boolean;hasPendingWrites:boolean};}
export interface QueryDocumentSnapshot<T=DocumentData> extends DocumentSnapshot<T>{data(options?:unknown):T;}
export interface QuerySnapshot<T=DocumentData>{docs:QueryDocumentSnapshot<T>[];empty:boolean;size:number;forEach(fn:(snapshot:QueryDocumentSnapshot<T>)=>void):void;docChanges():{type:string;doc:QueryDocumentSnapshot<T>}[];metadata:{fromCache:boolean;hasPendingWrites:boolean};}
export interface Query<T=DocumentData>{kind:string;path:string;constraints?:Constraint[];converter?:FirestoreDataConverter<T>;withConverter<U>(converter:FirestoreDataConverter<U>):Query<U>;}
export interface FirestoreDataConverter<T>{toFirestore(value:T):DocumentData;fromFirestore(snapshot:QueryDocumentSnapshot,options?:unknown):T;}
export type Firestore={kind:string;path:string};
export interface WriteBatch{set(ref:DocumentReference,data:DocumentData,options?:{merge?:boolean}):WriteBatch;update(ref:DocumentReference,data:DocumentData):WriteBatch;delete(ref:DocumentReference):WriteBatch;commit():Promise<void>;}
