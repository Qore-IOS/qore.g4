'use client';
/** Individual user presence is unavailable in a shared workspace. */
export function startPresence(){return ()=>{};}
export async function safeSignOut(){window.location.assign('/dashboard');}
