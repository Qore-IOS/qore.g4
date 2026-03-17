'use client';

/**
 * CompanyContext - Multi-Tenancy Core
 *
 * Bu context, aktif şirketi (tenant) yönetir.
 * - Normal kullanıcılar: sadece kendi companyId'leri ile erişir
 * - Super Admin: tüm şirketleri görebilir ve aralarında geçiş yapabilir
 *
 * Her Firebase sorgusu bu context'ten activeCompanyId alır ve
 * o şirkete ait verileri filtreler. Ortak veriler (productCodes,
 * barcodeFormats) companyId filtresi UYGULANMAZ.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Company, User } from '@/lib/types';

// Collections that are SHARED across all companies (no companyId filter)
export const SHARED_COLLECTIONS = new Set([
  'productCodes',
  'barcodeFormats',
]);

// Collections that are TENANT-SCOPED (require companyId filter)
export const TENANT_COLLECTIONS = new Set([
  'hospitals',
  'depots',
  'depoStok',
  'devices',
  'deviceFaultReports',
  'tuketimKayitlari',
  'orders',
  'shipments',
  'transfers',
  'borcTransfers',
  'borcDepots',
  'labPools',
  'deviceLabPools',
  'personalStock',
  'poolWarehouseStock',
  'consumableRequests',
  'purchasingTasks',
  'purchasingTaskDefinitions',
  'stockCounts',
  'depotCountSessions',
  'depotBrandCountSessions',
  'notifications',
  'addressDefinitions',
  'deviceActionForms',
  'teknikServisActionForms',
  'aplikasyonActionForms',
  'ejectedKitRecords',
  'destroyedKitsReports',
  'trashBinRecords',
  'effecticiencyHistory',
  'totalEfficiencyRecords',
  'cihazUstuGecmisi',
  'yedekParcaDepoStok',
  'yedek_parca',
  'partChanges',
  'periodicPartChangeLogs',
  'draftActionForms',
  'minMaxHistory',
  'archiveRacks',
  'faultDefinitions',
  'assetCategories',
  'assets',
  'assetHistory',
  'config_hospitals',
  'def_brands',
  'def_deviceGroups',
  'def_labGroups',
  'def_mainUnits',
  'def_productGroups',
  'def_testGroups',
  'overtimeRequests',
  'dutyShifts',
  'shiftSchedules',
  'personnelAvailability',
  'personnelHistoryLogs',
  'personelGruplari',
  'routes',
  'notificationLogs',
  'users',
]);

// The legacy company ID assigned to all pre-existing data
export const LEGACY_COMPANY_ID = 'ISLAB2';

interface CompanyContextType {
  // Current active company (the one queries filter by)
  activeCompanyId: string | null;
  activeCompany: Company | null;

  // All companies (visible to super admin; normal users only see their own)
  companies: Company[];
  isLoadingCompanies: boolean;

  // Super admin can switch between companies
  switchCompany: (companyId: string) => void;

  // Create a new company (super admin or admin)
  createCompany: (data: Omit<Company, 'id' | 'createdAt'>) => Promise<string>;

  // Update company info
  updateCompany: (companyId: string, data: Partial<Company>) => Promise<void>;

  // Promote current user to super admin
  promoteSelfToSuperAdmin: (currentUserId: string) => Promise<void>;

  // Whether current user is super admin
  isSuperAdmin: boolean;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

interface CompanyProviderProps {
  children: ReactNode;
  currentUserProfile: User | null;
}

export const CompanyProvider = ({ children, currentUserProfile }: CompanyProviderProps) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);
  // Super admin selected company override (stored in localStorage per session)
  const [superAdminCompanyOverride, setSuperAdminCompanyOverride] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('superAdminActiveCompany');
    }
    return null;
  });

  const isSuperAdmin = currentUserProfile?.isSuperAdmin === true;

  // Active company: super admin can override, normal user uses their companyId
  const activeCompanyId: string | null = isSuperAdmin
    ? (superAdminCompanyOverride || currentUserProfile?.companyId || LEGACY_COMPANY_ID)
    : (currentUserProfile?.companyId || LEGACY_COMPANY_ID);

  const activeCompany = companies.find(c => c.id === activeCompanyId) || null;

  // Load companies from Firestore
  useEffect(() => {
    if (!currentUserProfile) {
      setCompanies([]);
      setIsLoadingCompanies(false);
      return;
    }

    let q;
    if (isSuperAdmin) {
      // Super admin sees all companies
      q = collection(db, 'companies');
    } else {
      // Regular user sees only their company
      q = query(
        collection(db, 'companies'),
        where('__name__', '==', currentUserProfile.companyId || LEGACY_COMPANY_ID)
      );
    }

    const unsub = onSnapshot(q, (snap) => {
      const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() } as Company));
      setCompanies(loaded);
      setIsLoadingCompanies(false);
    }, (err) => {
      console.error('CompanyContext: error loading companies', err);
      setIsLoadingCompanies(false);
    });

    return () => unsub();
  }, [currentUserProfile?.uid, currentUserProfile?.companyId, isSuperAdmin]);

  const switchCompany = useCallback((companyId: string) => {
    if (!isSuperAdmin) return;
    setSuperAdminCompanyOverride(companyId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('superAdminActiveCompany', companyId);
    }
  }, [isSuperAdmin]);

  const createCompany = useCallback(async (data: Omit<Company, 'id' | 'createdAt'>): Promise<string> => {
    const newId = data.name.toUpperCase().replace(/\s+/g, '_');
    const companyRef = doc(db, 'companies', newId);
    await setDoc(companyRef, {
      ...data,
      id: newId,
      createdAt: serverTimestamp(),
      isActive: true,
    });
    return newId;
  }, []);

  const updateCompany = useCallback(async (companyId: string, data: Partial<Company>) => {
    const companyRef = doc(db, 'companies', companyId);
    await updateDoc(companyRef, data);
  }, []);

  const promoteSelfToSuperAdmin = useCallback(async (currentUserId: string) => {
    const userRef = doc(db, 'users', currentUserId);
    await updateDoc(userRef, { isSuperAdmin: true });
  }, []);

  const value: CompanyContextType = {
    activeCompanyId,
    activeCompany,
    companies,
    isLoadingCompanies,
    switchCompany,
    createCompany,
    updateCompany,
    promoteSelfToSuperAdmin,
    isSuperAdmin,
  };

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
};
