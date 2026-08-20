'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import {
  getAuth, onAuthStateChanged, User as FirebaseUser, signOut as firebaseSignOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider,
  signInWithPopup, signInAnonymously, signInWithCustomToken
} from 'firebase/auth';
import { app, db } from '@/lib/firebase';
import { doc, setDoc, getDoc, updateDoc, onSnapshot, collection, query, where, getDocs, deleteField } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import type { User, AppView } from '@/lib/types';
import { LEGACY_COMPANY_ID } from '@/lib/types';
import { normalizeCompanyId } from '@/lib/company-scope';
import { VIEWS } from '@/lib/constants';
import { safeSignOut } from '@/lib/presence-client';
import { scopedQuery } from '@/lib/firestore-helpers';

type ThemePreference = 'light' | 'dark' | 'system';

type NavMode = 'dock' | 'sidebar';

type DockStyle = 'hover' | 'liquid';

interface WallpaperSettings {
  light: string | null;
  dark: string | null;
}

interface AuthContextType {
  currentUser: FirebaseUser | null;
  currentUserProfile: User | null;
  isLoadingAuth: boolean;
  isAdmin: boolean;
  isAdminDeveloper: boolean;
  isSuperAdmin: boolean;
  currentCompanyId: string;
  permissions: AppView[];
  isOrbAnimationEnabled: boolean;
  toggleOrbAnimation: () => void;
  navMode: NavMode;
  toggleNavMode: () => void;
  dockStyle: DockStyle;
  setDockStyle: (style: DockStyle) => void;
  themePreference: ThemePreference;
  setUserTheme: (theme: ThemePreference) => Promise<void>;
  wallpaper: WallpaperSettings;
  setWallpaper: (mode: 'light' | 'dark', path: string | null) => void;
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
  const [isAdminDeveloper, setIsAdminDeveloper] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>(LEGACY_COMPANY_ID);
  const [permissions, setPermissions] = useState<AppView[]>([]);
  const [isOrbAnimationEnabled, setIsOrbAnimationEnabled] = useState(true);
  const [navMode, setNavMode] = useState<NavMode>('dock');
  const [dockStyle, setDockStyleState] = useState<DockStyle>('hover');
  const [themePreference, setThemePreference] = useState<ThemePreference>('dark');
  const [wallpaper, setWallpaperState] = useState<WallpaperSettings>({ light: null, dark: null });
  const router = useRouter();
  const auth = getAuth(app);
  const { setTheme, theme } = useTheme();

  useEffect(() => {
    const savedOrbState = localStorage.getItem('orb_animation_enabled');
    setIsOrbAnimationEnabled(savedOrbState === null ? true : savedOrbState === 'true');

    const savedNavMode = localStorage.getItem('nav_mode') as NavMode | null;
    setNavMode(savedNavMode || 'dock');

    const savedDockStyle = localStorage.getItem('dock_style') as DockStyle | null;
    setDockStyleState(savedDockStyle || 'hover');

    const savedWallpaper = localStorage.getItem('wallpaper_settings');
    if (savedWallpaper) {
      try {
        setWallpaperState(JSON.parse(savedWallpaper));
      } catch { /* ignore parse errors */ }
    }
  }, []);

  const toggleOrbAnimation = useCallback(() => {
    setIsOrbAnimationEnabled(prev => {
      const newState = !prev;
      localStorage.setItem('orb_animation_enabled', String(newState));
      return newState;
    });
  }, []);

  const toggleNavMode = useCallback(() => {
    setNavMode(prev => {
        const newMode = prev === 'dock' ? 'sidebar' : 'dock';
        localStorage.setItem('nav_mode', newMode);
        return newMode;
    });
  }, []);

  const setDockStyle = useCallback((style: DockStyle) => {
    setDockStyleState(style);
    localStorage.setItem('dock_style', style);
  }, []);

  const setWallpaper = useCallback((mode: 'light' | 'dark', path: string | null) => {
    setWallpaperState(prev => {
      const next = { ...prev, [mode]: path };
      localStorage.setItem('wallpaper_settings', JSON.stringify(next));
      return next;
    });
  }, []);

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
          setIsAdmin(false);
          setIsAdminDeveloper(false);
          setIsSuperAdmin(false);
          setPermissions([]);
        } else {
            const userDocRef = doc(db, "users", user.uid);
            // PERF (Faz 1): Doküman okuması ve (cache'li) token claim'lerini PARALEL
            // çalıştır. Cache'li token önce alınır; claim eksikse veya Firestore user
            // doc'undaki companyId ile uyuşmuyorsa (org taşıması senaryosu) UI açılmadan
            // önce force-refresh beklenir — aksi hâlde Firestore Security Rules token'daki
            // stale companyId ile tüm sorguları reddeder ve uygulama çöker.
            const [userDocSnap, tokenResult] = await Promise.all([
              getDoc(userDocRef),
              user.getIdTokenResult().catch(() => null),
            ]);
            if (userDocSnap.exists()) {
              const userData = userDocSnap.data() as User;
              const userPermissions = userData.accessibleViews || [];
              if (!userPermissions.includes('arama')) {
                  userPermissions.push('arama');
              }

              const claimCompanyId = tokenResult?.claims.companyId as string | undefined;
              const claimIsSuperAdmin = tokenResult?.claims.isSuperAdmin as boolean | undefined;
              const firestoreCompanyId = userData.companyId;

              // Token'daki companyId ile Firestore user doc'undaki companyId karşılaştırılır.
              // Fark varsa (org taşıması) ya da claim yoksa token yenilemek gerekir;
              // aksi hâlde Firestore Security Rules tüm sorguları reddeder çünkü
              // request.auth.token.companyId dokümanlarla eşleşmez.
              const companyIdMismatch =
                !!firestoreCompanyId && !!claimCompanyId && claimCompanyId !== firestoreCompanyId;
              const claimsMissing = !claimCompanyId && !!firestoreCompanyId;
              const superAdminMismatch = userData.role === 'super_admin' && !claimIsSuperAdmin;
              const needsTokenRefresh = claimsMissing || companyIdMismatch || superAdminMismatch;

              let effectiveCompanyId = claimCompanyId || firestoreCompanyId || LEGACY_COMPANY_ID;
              let effectiveIsSuperAdmin = claimIsSuperAdmin ?? userData.role === 'super_admin';

              if (needsTokenRefresh) {
                // Yanlış/eksik claim ile Firestore sorgularının başlamasını engellemek için
                // token yenilemesi UI'ı açmadan önce tamamlanır (blocking).
                try {
                  const fresh = await user.getIdTokenResult(true);
                  const freshCompanyId = fresh.claims.companyId as string | undefined;
                  const freshIsSuperAdmin = fresh.claims.isSuperAdmin as boolean | undefined;
                  effectiveCompanyId = freshCompanyId || firestoreCompanyId || LEGACY_COMPANY_ID;
                  if (freshIsSuperAdmin !== undefined) effectiveIsSuperAdmin = freshIsSuperAdmin;
                } catch {
                  // Token yenilenemedi (silinmiş/devre dışı hesap, geçersiz credential).
                  // Kullanıcıyı çıkış yaptırarak login sayfasına yönlendir.
                  console.error('Token yenilemesi başarısız; kullanıcı çıkış yapıyor.');
                  await firebaseSignOut(auth);
                  return;
                }
              }

              setCurrentUserProfile({...userData, accessibleViews: userPermissions});
              setIsSuperAdmin(effectiveIsSuperAdmin);
              setIsAdmin(userData.role === 'super_admin' || userData.role === 'admin' || userData.role === 'admin_developer' || user.uid === ADMIN_USER_UID);
              setIsAdminDeveloper(userData.role === 'super_admin' || userData.role === 'admin_developer' || user.uid === ADMIN_USER_UID);
              setCurrentCompanyId(effectiveCompanyId);
              setPermissions(userPermissions);

              // Force dark mode for 'user' role, otherwise apply user's preference
              if (userData.role === 'user') {
                setTheme('dark');
                setThemePreference('dark');
              } else if (userData.themePreference) {
                setTheme(userData.themePreference);
                setThemePreference(userData.themePreference);
              }

            } else {
              const defaultRole: string = user.uid === ADMIN_USER_UID ? 'admin' : 'user';
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
              setIsSuperAdmin(defaultRole === 'super_admin');
              setIsAdmin(defaultRole === 'super_admin' || defaultRole === 'admin' || defaultRole === 'admin_developer');
              setIsAdminDeveloper(defaultRole === 'super_admin' || defaultRole === 'admin_developer');
              setPermissions(defaultViews);
              // Force dark mode for 'user' role
              if (defaultRole === 'user') {
                setTheme('dark');
                setThemePreference('dark');
              }
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
        setIsAdminDeveloper(false);
        setIsSuperAdmin(false);
        setPermissions([]);
      }
      setIsLoadingAuth(false);
    });
    return () => unsubscribe();
  }, [auth]);

  const login = useCallback(async (email: string, pass: string) => {
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
  }, [auth]);

  const loginWithCustomToken = useCallback(async (token: string) => {
    try {
      const userCredential = await signInWithCustomToken(auth, token);
      return userCredential.user;
    } catch (error) {
      console.error("Custom token sign-in error:", error);
      throw error;
    }
  }, [auth]);

  const loginWithGoogle = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      return result.user;
    } catch (error) {
      console.error("Google sign-in error:", error);
      throw error;
    }
  }, [auth]);

  const loginAnonymously = useCallback(async () => {
    try {
      const result = await signInAnonymously(auth);
      return result.user;
    } catch (error) {
      console.error("Anonymous sign-in error:", error);
      throw error;
    }
  }, [auth]);

  const signup = useCallback(async (email: string, pass: string, additionalData: Partial<User> = {}) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
      const user = userCredential.user;
      const userDocRef = doc(db, "users", user.uid);
      const selectedViews = additionalData.accessibleViews ?? [];
      const newUserProfile: Partial<User> = {
        uid: user.uid,
        email: user.email,
        role: additionalData.role || 'user',
        name: additionalData.name || email.split('@')[0],
        companyId: additionalData.companyId || LEGACY_COMPANY_ID,
        accessibleViews: selectedViews as AppView[],
        assignedLaboratories: additionalData.assignedLaboratories || [],
        primaryLaboratories: additionalData.primaryLaboratories || [],
        assignedDepots: additionalData.assignedDepots || [],
        assignedBrands: additionalData.assignedBrands || [],
        assignedLabGroups: additionalData.assignedLabGroups || [],
        phoneNumber: additionalData.phoneNumber || '',
        nfcId: additionalData.nfcId || '',
        notificationsEnabled: additionalData.notificationsEnabled ?? false,
        notificationPreferences: additionalData.notificationPreferences || [],
        createdAt: new Date(),
      };
      await setDoc(userDocRef, newUserProfile);
      return user;
    } catch (error) {
      console.error("Signup error:", error);
      throw error;
    }
  }, [auth]);

  const logout = useCallback(async () => {
    try {
      await safeSignOut();
      router.push('/login');
    } catch (error) {
      console.error("Logout error:", error);
    }
  }, [router]);

  // Listen for forceLogout flag and auto-logout time from personnel groups
  useEffect(() => {
    if (!currentUser || currentUser.isAnonymous) return;

    const userDocRef = doc(db, 'users', currentUser.uid);
    let lastForceLogoutTime: number | null = null;

    // Listen for forceLogout changes
    const unsubForceLogout = onSnapshot(userDocRef, async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();

      // Check forceLogout field
      if (data.forceLogout) {
        const forceLogoutTime = data.forceLogout.toMillis ? data.forceLogout.toMillis() : data.forceLogout;

        // Only logout if this is a new forceLogout (not the one we've already processed)
        if (lastForceLogoutTime === null || forceLogoutTime > lastForceLogoutTime) {
          lastForceLogoutTime = forceLogoutTime;
          console.log('Force logout triggered by admin');

          // Clear the forceLogout flag to prevent re-triggering
          try {
            await updateDoc(userDocRef, { forceLogout: deleteField() });
          } catch (e) {
            console.error('Failed to clear forceLogout flag:', e);
          }

          // Perform logout
          await logout();
        }
      }
    }, (err) => {
      console.error('forceLogout listener error:', err);
    });

    return () => {
      unsubForceLogout();
    };
  }, [currentUser]);

  // Auto-logout based on personnel group's autoLogoutTime
  //
  // BAĞIMLILIKLAR ÖNEMLİ. Bu etki eskiden yalnızca `[currentUser]`'a bağlıydı ve
  // dinleyici, şirket kimliği HENÜZ YERLEŞMEDEN kuruluyordu: `onAuthStateChanged`
  // geri çağrısı ilk iş olarak `setCurrentUser(user)` yapıyor, `companyId` ise
  // ancak `await getDoc(...)` bittikten sonra geliyor. Aradaki commit'te
  // `currentCompanyId` hâlâ başlangıç değeri `__legacy__` olduğu için
  // `scopedQuery` FİLTRESİZ bir koleksiyon sorgusu üretiyordu — güvenlik
  // kuralları bunu `list` için reddediyor:
  //
  //   Error listening to personnel groups: FirebaseError:
  //   Missing or insufficient permissions.
  //
  // Bağımlılık listesi eksik olduğu için gerçek şirket kimliği geldiğinde
  // dinleyici YENİDEN KURULMUYOR; oturum boyunca reddedilmiş kalıyor ve
  // otomatik çıkış saati hiç uygulanmıyordu. Artık scope yerleşmeden sorgu
  // açılmaz ve yerleştiğinde dinleyici yeniden kurulur.
  useEffect(() => {
    if (isLoadingAuth) return;
    if (!currentUser || currentUser.isAnonymous) return;
    // Süper admin filtresiz okuyabilir; diğerleri için şirket kimliği şart.
    if (!isSuperAdmin && normalizeCompanyId(currentCompanyId) === LEGACY_COMPANY_ID) return;

    let intervalId: NodeJS.Timeout | null = null;
    let currentAutoLogoutTime: string | null = null;
    let hasLoggedOut = false;

    // Listen to user's personnel groups for autoLogoutTime changes (realtime)
    const groupsQuery = query(
      scopedQuery('personelGruplari', currentCompanyId, isSuperAdmin),
      where('memberIds', 'array-contains', currentUser.uid)
    );

    const unsubGroups = onSnapshot(groupsQuery, (snap) => {
      currentAutoLogoutTime = null;
      for (const groupDoc of snap.docs) {
        const groupData = groupDoc.data();
        if (groupData.autoLogoutTime) {
          currentAutoLogoutTime = groupData.autoLogoutTime;
          break;
        }
      }
    }, (err) => {
      console.error('Error listening to personnel groups:', err);
    });

    // Check time every minute (lightweight local comparison only)
    const checkAndLogout = () => {
      if (!currentAutoLogoutTime || hasLoggedOut) return;

      const now = new Date();
      const [targetHours, targetMinutes] = currentAutoLogoutTime.split(':').map(Number);
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();

      if (currentHours === targetHours && currentMinutes === targetMinutes) {
        hasLoggedOut = true;
        console.log(`Auto-logout triggered at ${currentAutoLogoutTime}`);
        logout();
      }
    };

    // Check every minute (60 seconds is sufficient for minute-level precision)
    intervalId = setInterval(checkAndLogout, 60000);
    // Also check immediately
    checkAndLogout();

    return () => {
      if (intervalId) clearInterval(intervalId);
      unsubGroups();
    };
  }, [currentUser, currentCompanyId, isSuperAdmin, isLoadingAuth]);

  // PERF (Faz 1): AuthProvider tüm uygulamayı sarıyor. Daha önce bu obje her
  // render'da yeniden oluşuyordu (fonksiyonlar da dahil), bu yüzden alakasız bir
  // render bile tüm context tüketicilerini yeniden render ediyordu. Artık değer ve
  // fonksiyonlar memoize; obje yalnızca gerçek auth/UI state değişiminde değişir.
  const contextValue = useMemo(() => ({
    currentUser,
    currentUserProfile,
    isLoadingAuth,
    isAdmin,
    isAdminDeveloper,
    isSuperAdmin,
    currentCompanyId,
    permissions,
    isOrbAnimationEnabled,
    toggleOrbAnimation,
    navMode,
    toggleNavMode,
    dockStyle,
    setDockStyle,
    themePreference,
    setUserTheme,
    wallpaper,
    setWallpaper,
    login,
    signup,
    logout,
    loginWithGoogle,
    loginAnonymously,
    loginWithCustomToken,
  }), [
    currentUser, currentUserProfile, isLoadingAuth, isAdmin, isAdminDeveloper,
    isSuperAdmin, currentCompanyId, permissions, isOrbAnimationEnabled,
    toggleOrbAnimation, navMode, toggleNavMode, dockStyle, setDockStyle,
    themePreference, setUserTheme, wallpaper, setWallpaper, login, signup,
    logout, loginWithGoogle, loginAnonymously, loginWithCustomToken,
  ]);

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
