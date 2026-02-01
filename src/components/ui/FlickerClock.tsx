'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface FlickerClockProps {
  className?: string;
}

export function FlickerClock({ className }: FlickerClockProps) {
  const [time, setTime] = useState({ hours: '--', minutes: '--', seconds: '--' });
  const prevTimeRef = useRef({ hours: '--', minutes: '--', seconds: '--' });
  const [flipping, setFlipping] = useState({ hours: false, minutes: false, seconds: false });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const newTime = {
        hours: now.getHours().toString().padStart(2, '0'),
        minutes: now.getMinutes().toString().padStart(2, '0'),
        seconds: now.getSeconds().toString().padStart(2, '0'),
      };

      // Check what changed
      const newFlipping = {
        hours: newTime.hours !== prevTimeRef.current.hours,
        minutes: newTime.minutes !== prevTimeRef.current.minutes,
        seconds: newTime.seconds !== prevTimeRef.current.seconds,
      };

      setFlipping(newFlipping);
      prevTimeRef.current = time;
      setTime(newTime);

      // Reset flipping after animation
      setTimeout(() => {
        setFlipping({ hours: false, minutes: false, seconds: false });
      }, 500);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [time]);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <FlipUnit value={time.hours} prevValue={prevTimeRef.current.hours} flipping={flipping.hours} />
      <Colon />
      <FlipUnit value={time.minutes} prevValue={prevTimeRef.current.minutes} flipping={flipping.minutes} />
      <Colon />
      <FlipUnit value={time.seconds} prevValue={prevTimeRef.current.seconds} flipping={flipping.seconds} />
    </div>
  );
}

function FlipUnit({ value, prevValue, flipping }: { value: string; prevValue: string; flipping: boolean }) {
  return (
    <div className="flex gap-[2px]">
      <FlipDigit digit={value[0]} prevDigit={prevValue[0]} flipping={flipping} />
      <FlipDigit digit={value[1]} prevDigit={prevValue[1]} flipping={flipping} />
    </div>
  );
}

function FlipDigit({ digit, prevDigit, flipping }: { digit: string; prevDigit: string; flipping: boolean }) {
  const shouldFlip = flipping && digit !== prevDigit;

  return (
    <div className="relative w-[22px] h-[32px] text-lg font-bold font-mono" style={{ perspective: '200px' }}>
      {/* Static bottom half (new number) */}
      <div className="absolute inset-0 flex items-end justify-center overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1/2 overflow-hidden">
          <div className="w-full h-[200%] flex items-center justify-center bg-gradient-to-b from-gray-700 to-gray-800 dark:from-gray-600 dark:to-gray-700 rounded-t-sm">
            <span className="text-gray-100 translate-y-1/4">{digit}</span>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden">
          <div className="w-full h-[200%] flex items-center justify-center bg-gradient-to-b from-gray-800 to-gray-900 dark:from-gray-700 dark:to-gray-800 rounded-b-sm -translate-y-1/2">
            <span className="text-gray-100">{digit}</span>
          </div>
        </div>
        {/* Center line */}
        <div className="absolute inset-x-0 top-1/2 h-[1px] bg-black/40 z-10" />
      </div>

      {/* Flipping card */}
      {shouldFlip && (
        <>
          {/* Top flip (old number falling) */}
          <div
            className="absolute inset-x-0 top-0 h-1/2 overflow-hidden origin-bottom animate-flip-top z-20"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="w-full h-[200%] flex items-center justify-center bg-gradient-to-b from-gray-700 to-gray-800 dark:from-gray-600 dark:to-gray-700 rounded-t-sm">
              <span className="text-gray-100 translate-y-1/4">{prevDigit}</span>
            </div>
          </div>

          {/* Bottom flip (new number rising) */}
          <div
            className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden origin-top animate-flip-bottom z-20"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="w-full h-[200%] flex items-center justify-center bg-gradient-to-b from-gray-800 to-gray-900 dark:from-gray-700 dark:to-gray-800 rounded-b-sm -translate-y-1/2">
              <span className="text-gray-100">{digit}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Colon() {
  return (
    <div className="flex flex-col justify-center gap-1.5 px-0.5">
      <div className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
      <div className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
    </div>
  );
}
