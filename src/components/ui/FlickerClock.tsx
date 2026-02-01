'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface FlickerClockProps {
  className?: string;
}

export function FlickerClock({ className }: FlickerClockProps) {
  const [time, setTime] = useState<{ hours: string; minutes: string; seconds: string }>({
    hours: '--',
    minutes: '--',
    seconds: '--',
  });
  const [isFlipping, setIsFlipping] = useState<{ hours: boolean; minutes: boolean; seconds: boolean }>({
    hours: false,
    minutes: false,
    seconds: false,
  });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const newHours = now.getHours().toString().padStart(2, '0');
      const newMinutes = now.getMinutes().toString().padStart(2, '0');
      const newSeconds = now.getSeconds().toString().padStart(2, '0');

      setIsFlipping({
        hours: newHours !== time.hours,
        minutes: newMinutes !== time.minutes,
        seconds: newSeconds !== time.seconds,
      });

      setTime({
        hours: newHours,
        minutes: newMinutes,
        seconds: newSeconds,
      });
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [time.hours, time.minutes, time.seconds]);

  const FlipCard = ({ value, flipping }: { value: string; flipping: boolean }) => (
    <div className="relative">
      <div
        className={cn(
          "flex items-center justify-center rounded-md overflow-hidden",
          "bg-gradient-to-b from-gray-800 to-gray-900 dark:from-gray-700 dark:to-gray-800",
          "shadow-inner",
          "w-[28px] h-[36px]",
          flipping && "animate-flip"
        )}
      >
        {/* Top half */}
        <div className="absolute inset-x-0 top-0 h-1/2 bg-black/10 border-b border-black/30" />
        {/* Number */}
        <span className="text-xl font-bold text-gray-100 font-mono tracking-tight">
          {value}
        </span>
      </div>
    </div>
  );

  const Separator = () => (
    <div className="flex flex-col justify-center gap-1 mx-0.5">
      <div className="w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-500" />
      <div className="w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-500" />
    </div>
  );

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {/* Hours */}
      <div className="flex">
        <FlipCard value={time.hours[0]} flipping={isFlipping.hours} />
        <FlipCard value={time.hours[1]} flipping={isFlipping.hours} />
      </div>

      <Separator />

      {/* Minutes */}
      <div className="flex">
        <FlipCard value={time.minutes[0]} flipping={isFlipping.minutes} />
        <FlipCard value={time.minutes[1]} flipping={isFlipping.minutes} />
      </div>

      <Separator />

      {/* Seconds */}
      <div className="flex">
        <FlipCard value={time.seconds[0]} flipping={isFlipping.seconds} />
        <FlipCard value={time.seconds[1]} flipping={isFlipping.seconds} />
      </div>
    </div>
  );
}
