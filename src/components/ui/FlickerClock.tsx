'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface FlickerClockProps {
  className?: string;
}

export function FlickerClock({ className }: FlickerClockProps) {
  const [time, setTime] = useState({ hours: '--', minutes: '--', seconds: '--' });
  const prevTimeRef = useRef({ hours: '--', minutes: '--', seconds: '--' });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const newTime = {
        hours: now.getHours().toString().padStart(2, '0'),
        minutes: now.getMinutes().toString().padStart(2, '0'),
        seconds: now.getSeconds().toString().padStart(2, '0'),
      };

      prevTimeRef.current = time;
      setTime(newTime);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [time]);

  return (
    <div className={cn("flex items-center gap-1", className)} style={{ perspective: '400px' }}>
      <FlipUnit value={time.hours} prevValue={prevTimeRef.current.hours} />
      <Colon />
      <FlipUnit value={time.minutes} prevValue={prevTimeRef.current.minutes} />
      <Colon />
      <FlipUnit value={time.seconds} prevValue={prevTimeRef.current.seconds} />
    </div>
  );
}

function FlipUnit({ value, prevValue }: { value: string; prevValue: string }) {
  return (
    <div className="flex gap-[2px]">
      <FlipDigit digit={value[0]} prevDigit={prevValue[0]} />
      <FlipDigit digit={value[1]} prevDigit={prevValue[1]} />
    </div>
  );
}

function FlipDigit({ digit, prevDigit }: { digit: string; prevDigit: string }) {
  const [isFlipping, setIsFlipping] = useState(false);
  const [displayDigit, setDisplayDigit] = useState(digit);
  const [flipFromDigit, setFlipFromDigit] = useState(prevDigit);
  const animationRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (digit !== prevDigit && prevDigit !== '-') {
      // Start flip animation
      setFlipFromDigit(prevDigit);
      setIsFlipping(true);

      // Clear any existing timeout
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }

      // Update display digit at halfway point
      animationRef.current = setTimeout(() => {
        setDisplayDigit(digit);
      }, 300);

      // End flip animation
      animationRef.current = setTimeout(() => {
        setIsFlipping(false);
      }, 600);
    } else {
      setDisplayDigit(digit);
    }

    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
    };
  }, [digit, prevDigit]);

  return (
    <div
      className="relative w-[24px] h-[36px] text-base font-bold font-mono"
      style={{ perspective: '200px', perspectiveOrigin: 'center center' }}
    >
      {/* Top Half - Static (shows current digit) */}
      <div className="absolute inset-x-0 top-0 h-1/2 overflow-hidden rounded-t-[3px]">
        <div
          className="w-full h-full flex items-end justify-center pb-[1px]"
          style={{
            background: 'linear-gradient(180deg, #4a4a4a 0%, #3a3a3a 100%)',
          }}
        >
          <span className="text-gray-100 leading-none translate-y-[9px]">{displayDigit}</span>
        </div>
      </div>

      {/* Bottom Half - Static (shows current digit) */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden rounded-b-[3px]">
        <div
          className="w-full h-full flex items-start justify-center pt-[1px]"
          style={{
            background: 'linear-gradient(180deg, #2d2d2d 0%, #1f1f1f 100%)',
          }}
        >
          <span className="text-gray-100 leading-none -translate-y-[9px]">{displayDigit}</span>
        </div>
      </div>

      {/* Center divider line */}
      <div className="absolute inset-x-0 top-1/2 h-[1px] bg-black/50 z-30" style={{ transform: 'translateY(-0.5px)' }} />

      {/* Flip Card - Top part (flips down) */}
      {isFlipping && (
        <div
          className="absolute inset-x-0 top-0 h-1/2 overflow-hidden rounded-t-[3px] z-20 flip-card-top"
          style={{
            transformOrigin: 'bottom center',
            backfaceVisibility: 'hidden',
            transformStyle: 'preserve-3d',
          }}
        >
          <div
            className="w-full h-full flex items-end justify-center pb-[1px]"
            style={{
              background: 'linear-gradient(180deg, #4a4a4a 0%, #3a3a3a 100%)',
            }}
          >
            <span className="text-gray-100 leading-none translate-y-[9px]">{flipFromDigit}</span>
          </div>
        </div>
      )}

      {/* Flip Card - Bottom part (flips up) */}
      {isFlipping && (
        <div
          className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden rounded-b-[3px] z-20 flip-card-bottom"
          style={{
            transformOrigin: 'top center',
            backfaceVisibility: 'hidden',
            transformStyle: 'preserve-3d',
          }}
        >
          <div
            className="w-full h-full flex items-start justify-center pt-[1px]"
            style={{
              background: 'linear-gradient(180deg, #2d2d2d 0%, #1f1f1f 100%)',
            }}
          >
            <span className="text-gray-100 leading-none -translate-y-[9px]">{displayDigit}</span>
          </div>
        </div>
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
