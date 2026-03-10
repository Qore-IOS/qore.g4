
'use client';

import React, { createContext, useContext, ReactNode, useCallback } from 'react';

interface LoadingContextType {
  isLoading: boolean;
  finishLoading: () => void;
  isGlobalLoading: boolean;
  setGlobalLoading: (loading: boolean) => void;
  startGlobalLoading: () => void;
  stopGlobalLoading: () => void;
  suppressGlobalLoading: () => () => void;
}

const noop = () => {};
const noopReturn = () => noop;

const LoadingContext = createContext<LoadingContextType>({
  isLoading: false,
  finishLoading: noop,
  isGlobalLoading: false,
  setGlobalLoading: noop,
  startGlobalLoading: noop,
  stopGlobalLoading: noop,
  suppressGlobalLoading: noopReturn,
});

export const LoadingProvider = ({ children }: { children: ReactNode }) => {
  const finishLoading = useCallback(() => {}, []);
  const setGlobalLoading = useCallback((_loading: boolean) => {}, []);
  const startGlobalLoading = useCallback(() => {}, []);
  const stopGlobalLoading = useCallback(() => {}, []);
  const suppressGlobalLoading = useCallback(() => () => {}, []);

  return (
    <LoadingContext.Provider
      value={{
        isLoading: false,
        finishLoading,
        isGlobalLoading: false,
        setGlobalLoading,
        startGlobalLoading,
        stopGlobalLoading,
        suppressGlobalLoading
      }}
    >
      {children}
    </LoadingContext.Provider>
  );
};

export const useLoading = () => {
  return useContext(LoadingContext);
};
