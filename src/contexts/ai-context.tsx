'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface AIContextType {
  isAIOpen: boolean;
  openAI: () => void;
  closeAI: () => void;
  toggleAI: () => void;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export function AIProvider({ children }: { children: React.ReactNode }) {
  const [isAIOpen, setIsAIOpen] = useState(false);

  const openAI = useCallback(() => {
    setIsAIOpen(true);
    // Haptic feedback for mobile
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([50, 30, 50]);
    }
  }, []);

  const closeAI = useCallback(() => {
    setIsAIOpen(false);
  }, []);

  const toggleAI = useCallback(() => {
    setIsAIOpen((prev) => {
      if (!prev && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([50, 30, 50]);
      }
      return !prev;
    });
  }, []);

  return (
    <AIContext.Provider value={{ isAIOpen, openAI, closeAI, toggleAI }}>
      {children}
    </AIContext.Provider>
  );
}

export function useAI() {
  const context = useContext(AIContext);
  if (context === undefined) {
    throw new Error('useAI must be used within an AIProvider');
  }
  return context;
}
