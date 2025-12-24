'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import {
  getAuth, onAuthStateChanged, User as FirebaseUser, signOut as firebaseSignOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider,
  signInWithPopup, signInAnonymously, signInWithCustomToken
} from 'firebase/auth';
import { app, db } from '@/lib/firebase';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import type { User, AppView } from '@/lib/types';
import { VIEWS } from '@/lib/constants';
import { safeSignOut } from '@/lib/presence-client';

type ThemePreference = 'light' | 'dark' | 'system';

type NavMode = 'dock' | 'sidebar';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  currentUserProfile: User | null;
  isLoadingAuth: boolean;
  isAdmin: boolean;
  permissions: AppView[];
  isOrbAnimationEnabled: boolean;
  toggleOrbAnimation: () => void;
  navMode: NavMode;
  toggleNavMode: () => void;
  themePreference: ThemePreference;
  setUserTheme: (theme: ThemePreference) => Promise<void>;
  login: (email: string, pass: string) => Promise<FirebaseUser | null>;
  loginWithGoogle: () => Promise<FirebaseUser | null>;
  loginAnonymously: () => Promise<FirebaseUser | null>;
  loginWithCustomToken: (token: string) => Promise<FirebaseUser | null>;
  signup: (email: string, pass: string, additionalData?: Partial<User>) => Promise<FirebaseUser | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ADMIN_USER_UID = 'fFOKsfoqjsdJsdk5I2kkYwm7lAg1'; 

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<User | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [permissions, setPermissions] = useState<AppView[]>([]);
  const [isOrbAnimationEnabled, setIsOrbAnimationEnabled] = useState(true);
  const [navMode, setNavMode] = useState<NavMode>('dock');
  const [themePreference, setThemePreference] = useState<ThemePreference>('dark');
  const router = useRouter();
  const auth = getAuth(app);
  const { setTheme, theme } = useTheme();

  useEffect(() => {
    const savedOrbState = localStorage.getItem('orb_animation_enabled');
    setIsOrbAnimationEnabled(savedOrbState === null ? true : savedOrbState === 'true');
    
    const savedNavMode = localStorage.getItem('nav_mode') as NavMode | null;
    setNavMode(savedNavMode || 'dock');

  }, []);

  const toggleOrbAnimation = () => {
    setIsOrbAnimationEnabled(prev => {
      const newState = !prev;
      localStorage.setItem('orb_animation_enabled', String(newState));
      return newState;
    });
  };
  
  const toggleNavMode = () => {
    setNavMode(prev => {
        const newMode = prev === 'dock' ? 'sidebar' : 'dock';
        localStorage.setItem('nav_mode', newMode);
        return newMode;
    });
  };

  // Save theme preference to Firestore and apply it
  const setUserTheme = useCallback(async (newTheme: ThemePreference) => {
    setTheme(newTheme);
    setThemePreference(newTheme);

    // Save to Firestore if user is logged in
    if (currentUser && !currentUser.isAnonymous) {
      try {
        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, { themePreference: newTheme });
      } catch (error) {
        console.error("Error saving theme preference to Firestore:", error);
      }
    }
  }, [currentUser, setTheme]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        if (user.isAnonymous) {
           const allViews = VIEWS.map(v => v.key) as AppView[];
           const anonymousProfile: User = { 
            uid: user.uid, 
            email: null, 
            role: 'user', 
            name: `Misafir Kullanıcı #${user.uid.substring(0,5)}`, 
            accessibleViews: allViews,
            createdAt: new Date(),
          };
          setCurrentUserProfile(anonymousProfile);
          setIsAdmin(false); // Anonymous users are never admins
          setPermissions([]); // They can't access anything by default
        } else {
            const userDocRef = doc(db, "users", user.uid);
            const userDocSnap = await getDoc(userDocRef);
            if (userDocSnap.exists()) {
              const userData = userDocSnap.data() as User;
              const userPermissions = userData.accessibleViews || [];
              if (!userPermissions.includes('arama')) {
                  userPermissions.push('arama');
              }

              setCurrentUserProfile({...userData, accessibleViews: userPermissions});
              setIsAdmin(userData.role === 'admin' || user.uid === ADMIN_USER_UID);
              setPermissions(userPermissions);

              // Apply user's theme preference from Firestore
              if (userData.themePreference) {
                setTheme(userData.themePreference);
                setThemePreference(userData.themePreference);
              }

            } else {
              const defaultRole = user.uid === ADMIN_USER_UID ? 'admin' : 'user';
              const defaultViews = VIEWS.map(v => v.key) as AppView[];
              const defaultProfile: User = {
                uid: user.uid,
                email: user.email,
                role: defaultRole,
                name: user.displayName || user.email?.split('@')[0] || 'Yeni Kullanıcı',
                accessibleViews: defaultViews,
                createdAt: new Date(),
              };
              setCurrentUserProfile(defaultProfile);
              setIsAdmin(defaultRole === 'admin');
              setPermissions(defaultViews);
              try {
                await setDoc(userDocRef, defaultProfile, { merge: true });
              } catch (error) {
                console.error("Error creating default user profile in Firestore:", error);
              }
            }
        }
      } else {
        setCurrentUser(null);
        setCurrentUserProfile(null);
        setIsAdmin(false);
        setPermissions([]);
      }
      setIsLoadingAuth(false);
    });
    return () => unsubscribe();
  }, [auth]);

  const login = async (email: string, pass: string) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, pass);
      return userCredential.user;
    } catch (error: any) { 
      if (error.code === 'auth/invalid-credential') {
        console.info("Login attempt failed (invalid credentials):", error.message);
      } else {
        console.error("Login error:", error);
      }
      throw error; 
    }
  };
  
  const loginWithCustomToken = async (token: string) => {
    try {
      const userCredential = await signInWithCustomToken(auth, token);
      return userCredential.user;
    } catch (error) {
      console.error("Custom token sign-in error:", error);
      throw error;
    }
  };

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      return result.user;
    } catch (error) {
      console.error("Google sign-in error:", error);
      throw error;
    }
  };
  
  const loginAnonymously = async () => {
    try {
      const result = await signInAnonymously(auth);
      return result.user;
    } catch (error) {
      console.error("Anonymous sign-in error:", error);
      throw error;
    }
  };

  const signup = async (email: string, pass: string, additionalData: Partial<User> = {}) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
      const user = userCredential.user;
      const userDocRef = doc(db, "users", user.uid);
      const defaultViews = VIEWS.map(v => v.key) as AppView[];
      const newUserProfile: Partial<User> = {
        uid: user.uid,
        email: user.email,
        role: additionalData.role || 'user',
        name: additionalData.name || email.split('@')[0],
        accessibleViews: defaultViews,
        assignedLaboratories: additionalData.assignedLaboratories || [],
        assignedDepots: additionalData.assignedDepots || [],
        assignedBrands: additionalData.assignedBrands || [],
        phoneNumber: additionalData.phoneNumber || '',
        nfcId: additionalData.nfcId || '',
        createdAt: new Date(),
      };
      await setDoc(userDocRef, newUserProfile);
      return user;
    } catch (error) {
      console.error("Signup error:", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await safeSignOut();
      router.push('/login'); 
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const contextValue = {
    currentUser,
    currentUserProfile,
    isLoadingAuth,
    isAdmin,
    permissions,
    isOrbAnimationEnabled,
    toggleOrbAnimation,
    navMode,
    toggleNavMode,
    themePreference,
    setUserTheme,
    login,
    signup,
    logout,
    loginWithGoogle,
    loginAnonymously,
    loginWithCustomToken,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
