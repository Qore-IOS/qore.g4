'use client';

import React, { useEffect, useRef } from 'react';

export function CursorGlow() {
  const cursorLightRef = useRef<HTMLDivElement>(null);
  const isTouchDeviceRef = useRef(false);

  useEffect(() => {
    // Check for touch device only once
    isTouchDeviceRef.current = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    const cursorLight = cursorLightRef.current;
    if (!cursorLight || isTouchDeviceRef.current) {
        if (cursorLight) {
            cursorLight.style.display = 'none';
        }
      return;
    }

    let mouseX = 0;
    let mouseY = 0;
    let currentX = 0;
    let currentY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    document.addEventListener('mousemove', handleMouseMove);

    let animationFrameId: number;

    function animate() {
      // Smooth interpolation (lerp) for a trailing effect
      currentX += (mouseX - currentX) * 0.1;
      currentY += (mouseY - currentY) * 0.1;

      if (cursorLight) {
        cursorLight.style.left = `${currentX}px`;
        cursorLight.style.top = `${currentY}px`;
      }
      
      animationFrameId = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <div id="cursor-light" ref={cursorLightRef}></div>;
}
