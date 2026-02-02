'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface FlickerClockProps {
  className?: string;
}

export function FlickerClock({ className }: FlickerClockProps) {
  const [time, setTime] = useState({ hours: '--', minutes: '--', seconds: '--' });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime({
        hours: now.getHours().toString().padStart(2, '0'),
        minutes: now.getMinutes().toString().padStart(2, '0'),
        seconds: now.getSeconds().toString().padStart(2, '0'),
      });
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={cn("flex items-center gap-1", className)} style={{ perspective: '400px' }}>
      <FlipUnit value={time.hours} />
      <Colon />
      <FlipUnit value={time.minutes} />
      <Colon />
      <FlipUnit value={time.seconds} />
    </div>
  );
}

function FlipUnit({ value }: { value: string }) {
  return (
    <div className="flex gap-[2px]">
      <FlipDigit digit={value[0]} />
      <FlipDigit digit={value[1]} />
    </div>
  );
}

function FlipDigit({ digit }: { digit: string }) {
  const [isFlipping, setIsFlipping] = useState(false);
  const [currentDigit, setCurrentDigit] = useState(digit);
  const [previousDigit, setPreviousDigit] = useState(digit);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip animation on first render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      setCurrentDigit(digit);
      setPreviousDigit(digit);
      return;
    }

    // Only animate if digit actually changed
    if (digit !== currentDigit) {
      // Store the old digit for the flip animation
      setPreviousDigit(currentDigit);
      // Start flipping
      setIsFlipping(true);

      // Update to new digit at midpoint of animation
      const midTimer = setTimeout(() => {
        setCurrentDigit(digit);
      }, 300);

      // End animation
      const endTimer = setTimeout(() => {
        setIsFlipping(false);
      }, 600);

      return () => {
        clearTimeout(midTimer);
        clearTimeout(endTimer);
      };
    }
  }, [digit, currentDigit]);

  return (
    <div
      className="relative w-[24px] h-[36px] text-base font-bold font-mono"
      style={{ perspective: '200px', perspectiveOrigin: 'center center' }}
    >
      {/* Top Half - Static (shows current digit) */}
      <div className="absolute inset-x-0 top-0 h-1/2 overflow-hidden rounded-t-[3px]">
        <div
          className="w-full h-full flex items-end justify-center"
          style={{
            background: 'linear-gradient(180deg, #4a4a4a 0%, #3a3a3a 100%)',
          }}
        >
          <span className="text-gray-100 leading-none translate-y-[9px]">{currentDigit}</span>
        </div>
      </div>

      {/* Bottom Half - Static (shows current digit) */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden rounded-b-[3px]">
        <div
          className="w-full h-full flex items-start justify-center"
          style={{
            background: 'linear-gradient(180deg, #2d2d2d 0%, #1f1f1f 100%)',
          }}
        >
          <span className="text-gray-100 leading-none -translate-y-[9px]">{currentDigit}</span>
        </div>
      </div>

      {/* Center divider line */}
      <div className="absolute inset-x-0 top-1/2 h-[1px] bg-black/50 z-30" style={{ transform: 'translateY(-0.5px)' }} />

      {/* Flip Animation Cards */}
      {isFlipping && (
        <>
          {/* Top half flipping down - shows OLD digit */}
          <div
            className="absolute inset-x-0 top-0 h-1/2 overflow-hidden rounded-t-[3px] z-20"
            style={{
              transformOrigin: 'bottom center',
              backfaceVisibility: 'hidden',
              animation: 'flipTopDown 0.3s ease-in forwards',
            }}
          >
            <div
              className="w-full h-full flex items-end justify-center"
              style={{
                background: 'linear-gradient(180deg, #4a4a4a 0%, #3a3a3a 100%)',
              }}
            >
              <span className="text-gray-100 leading-none translate-y-[9px]">{previousDigit}</span>
            </div>
          </div>

          {/* Bottom half flipping up - shows NEW digit */}
          <div
            className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden rounded-b-[3px] z-20"
            style={{
              transformOrigin: 'top center',
              backfaceVisibility: 'hidden',
              animation: 'flipBottomUp 0.3s ease-out 0.3s forwards',
              opacity: 0,
            }}
          >
            <div
              className="w-full h-full flex items-start justify-center"
              style={{
                background: 'linear-gradient(180deg, #2d2d2d 0%, #1f1f1f 100%)',
              }}
            >
              <span className="text-gray-100 leading-none -translate-y-[9px]">{digit}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Colon() {
  return (
    <div className="flex flex-col justify-center gap-1.5 px-0.5 h-[36px]">
      <div className="w-[5px] h-[5px] rounded-full bg-gray-500" />
      <div className="w-[5px] h-[5px] rounded-full bg-gray-500" />
    </div>
  );
}
