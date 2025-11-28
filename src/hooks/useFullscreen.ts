
'use client';
import { useState, useLayoutEffect, useCallback } from 'react';

const isBrowser = typeof window !== 'undefined';

const docEl = isBrowser ? document.documentElement : ({} as HTMLElement);

const requestFullscreen = () => {
  if ("requestFullscreen" in docEl) return docEl.requestFullscreen();
  if ("mozRequestFullScreen" in docEl) return (docEl as any).mozRequestFullScreen();
  if ("webkitRequestFullscreen" in docEl) return (docEl as any).webkitRequestFullscreen();
  if ("msRequestFullscreen" in docEl) return (docEl as any).msRequestFullscreen();
};

const exitFullscreen = () => {
    if ("exitFullscreen" in document) return document.exitFullscreen();
    if ("mozCancelFullScreen" in document) return (document as any).mozCancelFullScreen();
    if ("webkitExitFullscreen" in document) return (document as any).webkitExitFullscreen();
    if ("msExitFullscreen" in document) return (document as any).msExitFullscreen();
};

const getIsFullscreen = () => {
  if (!isBrowser) return false;
  return Boolean(
    document.fullscreenElement ||
    (document as any).mozFullScreenElement ||
    (document as any).webkitFullscreenElement ||
    (document as any).msFullscreenElement
  );
};

export const useFullscreen = () => {
  const [isFullscreen, setIsFullscreen] = useState(getIsFullscreen());

  const toggle = useCallback(() => {
    if (getIsFullscreen()) {
      exitFullscreen();
    } else {
      requestFullscreen().catch(() => {});
    }
  }, []);

  useLayoutEffect(() => {
    const handleChange = () => {
      setIsFullscreen(getIsFullscreen());
    };

    if (!isBrowser) return;

    document.addEventListener('fullscreenchange', handleChange);
    document.addEventListener('webkitfullscreenchange', handleChange);
    document.addEventListener('mozfullscreenchange', handleChange);
    document.addEventListener('msfullscreenchange', handleChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleChange);
      document.removeEventListener('webkitfullscreenchange', handleChange);
      document.removeEventListener('mozfullscreenchange', handleChange);
      document.removeEventListener('msfullscreenchange', handleChange);
    };
  }, []);

  return {
    isFullscreen,
    toggle,
    isSupported: isBrowser && (
        "fullscreenEnabled" in document ||
        "mozFullScreenEnabled" in document ||
        "webkitFullscreenEnabled" in document ||
        "msFullscreenEnabled" in document
    ),
  };
};
