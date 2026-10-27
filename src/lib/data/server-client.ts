import 'server-only';
export * from './types';
export {Timestamp,serverTimestamp,deleteField,increment,arrayUnion,arrayRemove} from './model';
import {createDocumentClient} from './factory';
import {request} from './transport.server';
export const {db,collection,doc,collectionGroup,documentId,where,orderBy,limit,startAfter,query,snapshot,querySnapshot,getDoc,getDocFromServer,getDocs,getDocsFromServer,getCountFromServer,setDoc,updateDoc,deleteDoc,addDoc,writeBatch,runTransaction,onSnapshot}=createDocumentClient(request);
