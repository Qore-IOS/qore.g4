
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { useAuth } from './auth-context';
import GlobalLoadingOverlay from '@/components/GlobalLoadingOverlay';

interface LoadingContextType {
  isLoading: boolean;
  finishLoading: () => void;
  isGlobalLoading: boolean;
  setGlobalLoading: (loading: boolean) => void;
  startGlobalLoading: () => void;
  stopGlobalLoading: () => void;
  suppressGlobalLoading: () => () => void;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export const LoadingProvider = ({ children }: { children: ReactNode }) => {
  const { isLoadingAuth } = useAuth();
  const [isSplashLoading, setIsSplashLoading] = useState(false);
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);
  const [suppressCount, setSuppressCount] = useState(0);

  // The app is loading if auth is loading OR the splash screen hasn't finished.
  const isLoading = isLoadingAuth || isSplashLoading;

  const finishLoading = () => {
    setIsSplashLoading(false);
  };

  const setGlobalLoading = useCallback((loading: boolean) => {
    setIsGlobalLoading(loading);
  }, []);

  const startGlobalLoading = useCallback(() => {
    setIsGlobalLoading(true);
  }, []);

  const stopGlobalLoading = useCallback(() => {
    setIsGlobalLoading(false);
  }, []);

  // Suppress global loading - returns cleanup function
  const suppressGlobalLoading = useCallback(() => {
    setSuppressCount(prev => prev + 1);
    return () => {
      setSuppressCount(prev => Math.max(0, prev - 1));
    };
  }, []);

  // Show global loading only when splash screen is finished, app is interactive, and not suppressed
  const shouldShowGlobalLoading = !isLoading && isGlobalLoading && suppressCount === 0;

  return (
    <LoadingContext.Provider
      value={{
        isLoading,
        finishLoading,
        isGlobalLoading,
        setGlobalLoading,
        startGlobalLoading,
        stopGlobalLoading,
        suppressGlobalLoading
      }}
    >
      {!isLoading && children}
      <GlobalLoadingOverlay isVisible={shouldShowGlobalLoading} />
    </LoadingContext.Provider>
  );
};

export const useLoading = () => {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error('useLoading must be used within a LoadingProvider');
  }
  return context;
};
