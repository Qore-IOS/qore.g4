'use client';
import React,{createContext,useContext,useState,useEffect,useMemo} from 'react';
import {useTheme} from 'next-themes';
import {workspaceIdentity} from '../lib/workspace';
import {VIEWS} from '@/lib/constants';
import type {User,AppView} from '@/lib/types';

const WorkspaceContext=createContext<any>(undefined);
export function AuthProvider({children}:{children:React.ReactNode}){
 const {setTheme}=useTheme();
 const [isOrbAnimationEnabled,setOrb]=useState(true);
 const [navMode,setNav]=useState<'dock'|'sidebar'>('dock');
 const [dockStyle,setDock]=useState<'hover'|'liquid'>('hover');
 const [themePreference,setPreference]=useState<'light'|'dark'|'system'>('dark');
 const [wallpaper,setWallpaperState]=useState<{light:string|null;dark:string|null}>({light:null,dark:null});
 useEffect(()=>{
  setOrb(localStorage.getItem('orb_animation_enabled')!=='false');
  const nav=localStorage.getItem('nav_mode');if(nav==='dock'||nav==='sidebar')setNav(nav);
  const dock=localStorage.getItem('dock_style');if(dock==='hover'||dock==='liquid')setDock(dock);
  try{const w=localStorage.getItem('wallpaper_settings');if(w)setWallpaperState(JSON.parse(w));}catch{}
 },[]);
 const value=useMemo(()=>({
  currentUser:workspaceIdentity,
  currentUserProfile:{...workspaceIdentity,name:'Çalışma Alanı',accessibleViews:VIEWS.map(v=>v.key),createdAt:new Date(0)} as unknown as User,
  isLoadingAuth:false,isAdmin:true,isAdminDeveloper:true,isSuperAdmin:true,currentCompanyId:'__legacy__',permissions:VIEWS.map(v=>v.key) as AppView[],
  isOrbAnimationEnabled,navMode,dockStyle,themePreference,wallpaper,
  toggleOrbAnimation(){setOrb(v=>{localStorage.setItem('orb_animation_enabled',String(!v));return !v;});},
  toggleNavMode(){setNav(v=>{const next=v==='dock'?'sidebar':'dock';localStorage.setItem('nav_mode',next);return next;});},
  setDockStyle(v:'hover'|'liquid'){setDock(v);localStorage.setItem('dock_style',v);},
  async setUserTheme(v:'light'|'dark'|'system'){setTheme(v);setPreference(v);},
  setWallpaper(mode:'light'|'dark',path:string|null){setWallpaperState(old=>{const next={...old,[mode]:path};localStorage.setItem('wallpaper_settings',JSON.stringify(next));return next;});},
  async logout(){window.location.assign('/dashboard');}
 }),[isOrbAnimationEnabled,navMode,dockStyle,themePreference,wallpaper,setTheme]);
 return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export function useAuth(){const value=useContext(WorkspaceContext);if(!value)throw new Error('Workspace provider missing');return value;}
