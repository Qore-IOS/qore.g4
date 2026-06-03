'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface StartMenuContextType {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const StartMenuContext = createContext<StartMenuContextType | undefined>(undefined);

/**
 * Global state for the Qore "Start" menu (the Windows-vari launcher that the
 * dock's start button opens). Kept deliberately small — the panel itself owns
 * its content; this only tracks visibility so the dock button and the panel
 * can talk to each other without prop drilling.
 */
export function StartMenuProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <StartMenuContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </StartMenuContext.Provider>
  );
}

export function useStartMenu() {
  const context = useContext(StartMenuContext);
  if (context === undefined) {
    throw new Error('useStartMenu must be used within a StartMenuProvider');
  }
  return context;
}
