'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

interface AIContextType {
  isAIOpen: boolean;
  openAI: () => void;
  closeAI: () => void;
  toggleAI: () => void;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

// Preload audio for instant playback
const useAISound = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Create and preload audio
    audioRef.current = new Audio('/ai-open.mp3');
    audioRef.current.volume = 0.5;
    audioRef.current.preload = 'auto';
  }, []);

  const play = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        // Ignore autoplay errors (user hasn't interacted yet)
      });
    }
  }, []);

  return play;
};

export function AIProvider({ children }: { children: React.ReactNode }) {
  const [isAIOpen, setIsAIOpen] = useState(false);
  const playSound = useAISound();

  const openAI = useCallback(() => {
    setIsAIOpen(true);
    playSound();
    // Haptic feedback for mobile
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([50, 30, 50]);
    }
  }, [playSound]);

  const closeAI = useCallback(() => {
    setIsAIOpen(false);
  }, []);

  const toggleAI = useCallback(() => {
    setIsAIOpen((prev) => {
      if (!prev) {
        playSound();
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([50, 30, 50]);
        }
      }
      return !prev;
    });
  }, [playSound]);

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
