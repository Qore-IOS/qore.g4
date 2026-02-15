
'use client';
import React, { useEffect, useRef } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useLoading } from '@/contexts/loading-context';

export default function VideoSplashScreen() {
  const { finishLoading } = useLoading();
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    // Skip video on mobile — PWA splash screen handles it
    if (isMobile) {
      finishLoading();
      return;
    }

    const video = videoRef.current;
    if (video) {
      video.play().catch(error => {
        console.warn("Video autoplay was prevented. User interaction might be required.", error);
      });

      const handleVideoEnd = () => {
        finishLoading();
      };

      video.addEventListener('ended', handleVideoEnd);

      return () => {
        if (video) {
          video.removeEventListener('ended', handleVideoEnd);
        }
      };
    } else {
        finishLoading();
    }
  }, [finishLoading, isMobile]);

  // Don't render video on mobile
  if (isMobile) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black">
      <video
        ref={videoRef}
        src="/16.9.mp4"
        className="absolute top-0 left-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
        preload="auto"
      />
    </div>
  );
}
