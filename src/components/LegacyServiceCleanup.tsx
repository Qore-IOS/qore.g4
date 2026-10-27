'use client';
import {useEffect} from 'react';
/** Remove the retired push worker from browsers that visited the previous app. */
export default function LegacyServiceCleanup(){
 useEffect(()=>{
  if('serviceWorker'in navigator){
   void navigator.serviceWorker.getRegistrations().then(registrations=>Promise.all(registrations.filter(registration=>[registration.active,registration.waiting,registration.installing].some(worker=>worker&&new URL(worker.scriptURL).pathname==='/firebase-messaging-sw.js')).map(registration=>registration.unregister()))).catch(()=>{});
  }
  // Authentication/push caches only. Never erase offline stock drafts or their ledger.
  for(const name of ['firebaseLocalStorageDb','firebase-messaging-database','firebase-installations-database']){
   try{indexedDB.deleteDatabase(name);}catch{}
  }
 },[]);
 return null;
}
