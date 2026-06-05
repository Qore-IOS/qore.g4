'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

interface AIContextType {
  isAIOpen: boolean;
  /** Open Qore AI. Pass a prompt to auto-send it once the panel mounts. */
  openAI: (prompt?: string) => void;
  closeAI: () => void;
  toggleAI: () => void;
  /** Read-and-clear a prompt queued by the launcher (e.g. Start menu search). */
  consumePendingPrompt: () => string | null;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

// Lazy loaded audio
const useAISound = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(() => {
    if (!audioRef.current && typeof window !== 'undefined') {
      audioRef.current = new Audio('/ai-open.mp3');
      audioRef.current.volume = 0.5;
    }
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
  // A prompt queued by an external launcher (Start menu search bar). The
  // chatbot reads it via consumePendingPrompt() right after it opens and sends
  // it automatically, then clears it so it doesn't replay on the next open.
  const pendingPromptRef = useRef<string | null>(null);
  const playSound = useAISound();

  const openAI = useCallback((prompt?: string) => {
    if (typeof prompt === 'string' && prompt.trim()) {
      pendingPromptRef.current = prompt.trim();
    }
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

  const consumePendingPrompt = useCallback(() => {
    const p = pendingPromptRef.current;
    pendingPromptRef.current = null;
    return p;
  }, []);

  return (
    <AIContext.Provider value={{ isAIOpen, openAI, closeAI, toggleAI, consumePendingPrompt }}>
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
