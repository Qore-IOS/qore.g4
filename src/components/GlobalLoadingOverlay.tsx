'use client';

import React from 'react';
import GlobalLoader from './ui/GlobalLoader';

interface GlobalLoadingOverlayProps {
  isVisible: boolean;
}

export default function GlobalLoadingOverlay({ isVisible }: GlobalLoadingOverlayProps) {
  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={{
        animation: 'fadeIn 0.2s ease-in-out',
      }}
    >
      <GlobalLoader />
      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
