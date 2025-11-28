
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './auth-context';
import VideoSplashScreen from '@/components/VideoSplashScreen'; // Changed import

interface LoadingContextType {
  isLoading: boolean;
  finishLoading: () => void;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export const LoadingProvider = ({ children }: { children: ReactNode }) => {
  const { isLoadingAuth } = useAuth();
  const [isSplashLoading, setIsSplashLoading] = useState(true);

  // The app is loading if auth is loading OR the splash screen hasn't finished.
  const isLoading = isLoadingAuth || isSplashLoading;

  const finishLoading = () => {
    setIsSplashLoading(false);
  };

  return (
    <LoadingContext.Provider value={{ isLoading, finishLoading }}>
      {isSplashLoading && <VideoSplashScreen />}
      {!isLoading && children}
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
