
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useAuth } from './auth-context';
import VideoSplashScreen from '@/components/VideoSplashScreen'; // Changed import
import GlobalLoadingOverlay from '@/components/GlobalLoadingOverlay';

interface LoadingContextType {
  isLoading: boolean;
  finishLoading: () => void;
  isGlobalLoading: boolean;
  setGlobalLoading: (loading: boolean) => void;
  startGlobalLoading: () => void;
  stopGlobalLoading: () => void;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export const LoadingProvider = ({ children }: { children: ReactNode }) => {
  const { isLoadingAuth } = useAuth();
  const [isSplashLoading, setIsSplashLoading] = useState(true);
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);

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

  // Show global loading only when splash screen is finished and app is interactive
  const shouldShowGlobalLoading = !isLoading && isGlobalLoading;

  return (
    <LoadingContext.Provider
      value={{
        isLoading,
        finishLoading,
        isGlobalLoading,
        setGlobalLoading,
        startGlobalLoading,
        stopGlobalLoading
      }}
    >
      {isSplashLoading && <VideoSplashScreen />}
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
