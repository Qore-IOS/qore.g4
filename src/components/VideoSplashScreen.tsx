
'use client';
import React, { useEffect, useRef } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useLoading } from '@/contexts/loading-context';

export default function VideoSplashScreen() {
  const { finishLoading } = useLoading();
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMobile = useIsMobile();
  const videoSrc = isMobile ? "/output_HD1080.mp4" : "/16.9.mp4";


  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      // Attempt to play the video.
      video.play().catch(error => {
        console.warn("Video autoplay was prevented. User interaction might be required.", error);
        // Don't call finishLoading() here. Wait for the 'ended' event.
        // Some mobile browsers will not play until a user interaction.
      });

      const handleVideoEnd = () => {
        finishLoading();
      };
      
      video.addEventListener('ended', handleVideoEnd);

      return () => {
        // Cleanup the event listener when the component unmounts.
        if (video) {
          video.removeEventListener('ended', handleVideoEnd);
        }
      };
    } else {
        // If the video element isn't even there, don't block the app.
        finishLoading();
    }
  }, [finishLoading]);


  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black">
      <video
        ref={videoRef}
        key={videoSrc} // Add key to force re-render when src changes
        src={videoSrc}
        className="absolute top-0 left-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
        preload="auto"
      />
    </div>
  );
}
