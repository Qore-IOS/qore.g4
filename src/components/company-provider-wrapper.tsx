'use client';

/**
 * CompanyProviderWrapper
 *
 * AuthProvider ve CompanyProvider arasındaki köprü.
 * AuthProvider'dan currentUserProfile alır ve CompanyProvider'a iletir.
 * layout.tsx server component olduğundan, bu ayrı bir client wrapper gerektirir.
 */

import React from 'react';
import { useAuth } from '@/contexts/auth-context';
import { CompanyProvider } from '@/contexts/company-context';

export function CompanyProviderWrapper({ children }: { children: React.ReactNode }) {
  const { currentUserProfile } = useAuth();

  return (
    <CompanyProvider currentUserProfile={currentUserProfile}>
      {children}
    </CompanyProvider>
  );
}
