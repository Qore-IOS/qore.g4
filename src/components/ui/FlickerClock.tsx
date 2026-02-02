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
    <div className={cn("flex items-center gap-1", className)}>
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
  const prevDigitRef = useRef(digit);
  const [flipKey, setFlipKey] = useState(0);
  const [isFlipping, setIsFlipping] = useState(false);
  const [oldDigit, setOldDigit] = useState(digit);

  useEffect(() => {
    const prevDigit = prevDigitRef.current;

    if (digit !== prevDigit && prevDigit !== '-') {
      // Store old digit for animation
      setOldDigit(prevDigit);
      // Increment key to force remount of animation elements
      setFlipKey(k => k + 1);
      // Start animation
      setIsFlipping(true);

      // End animation after it completes
      const timer = setTimeout(() => {
        setIsFlipping(false);
      }, 600);

      return () => clearTimeout(timer);
    }

    // Update ref for next comparison
    prevDigitRef.current = digit;
  }, [digit]);

  // Update ref when digit changes (for cases where effect cleanup happens)
  useEffect(() => {
    prevDigitRef.current = digit;
  });

  return (
    <div
      className="relative w-[24px] h-[36px] text-base font-bold font-mono"
      style={{ perspective: '200px' }}
    >
      {/* Top Half - Static background showing NEW digit */}
      <div className="absolute inset-x-0 top-0 h-1/2 overflow-hidden rounded-t-[3px] bg-gradient-to-b from-[#4a4a4a] to-[#3a3a3a]">
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-gray-100 leading-none translate-y-[9px]">{digit}</span>
        </div>
      </div>

      {/* Bottom Half - Static background showing NEW digit */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden rounded-b-[3px] bg-gradient-to-b from-[#2d2d2d] to-[#1f1f1f]">
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-gray-100 leading-none -translate-y-[9px]">{digit}</span>
        </div>
      </div>

      {/* Center divider line */}
      <div className="absolute inset-x-0 top-1/2 h-[1px] bg-black/60 z-30 -translate-y-[0.5px]" />

      {/* Flip Animation - Top card falling down (shows OLD digit) */}
      {isFlipping && (
        <div
          key={`top-${flipKey}`}
          className="absolute inset-x-0 top-0 h-1/2 overflow-hidden rounded-t-[3px] z-20 bg-gradient-to-b from-[#4a4a4a] to-[#3a3a3a]"
          style={{
            transformOrigin: 'bottom center',
            animation: 'flipDown 0.3s ease-in forwards',
            backfaceVisibility: 'hidden',
          }}
        >
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-gray-100 leading-none translate-y-[9px]">{oldDigit}</span>
          </div>
        </div>
      )}

      {/* Flip Animation - Bottom card rising up (shows NEW digit) */}
      {isFlipping && (
        <div
          key={`bottom-${flipKey}`}
          className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden rounded-b-[3px] z-20 bg-gradient-to-b from-[#2d2d2d] to-[#1f1f1f]"
          style={{
            transformOrigin: 'top center',
            animation: 'flipUp 0.3s ease-out 0.3s forwards',
            backfaceVisibility: 'hidden',
            transform: 'rotateX(90deg)',
          }}
        >
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-gray-100 leading-none -translate-y-[9px]">{digit}</span>
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
