'use client';

import React from 'react';
import { Check, Circle, MapPin, Navigation } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { Timestamp } from 'firebase/firestore';

type RouteStop = {
  order: number;
  hospitalId: string;
  name: string;
  lat: number;
  lng: number;
  departedAt?: Timestamp | null;
  arrivedAt?: Timestamp | null;
};

type Props = {
  stops: RouteStop[];
  segmentStates: ('completed' | 'current' | 'future')[];
  status?: 'open' | 'in_progress' | 'completed';
};

export default function RouteProgressView({ stops, segmentStates, status }: Props) {
  if (!stops || stops.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <MapPin className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Henüz rota seçilmedi</p>
        </div>
      </div>
    );
  }

  const sortedStops = [...stops].sort((a, b) => a.order - b.order);

  // Her durak için durum hesapla
  const getStopStatus = (index: number): 'completed' | 'current' | 'future' => {
    const stop = sortedStops[index];

    // İlk durak için özel durum
    if (index === 0) {
      if (stop.departedAt) return 'completed';
      if (status === 'in_progress' || status === 'open') return 'current';
      return 'future';
    }

    // Diğer duraklar için
    if (stop.arrivedAt) return 'completed';

    // Bir önceki segmentin durumuna göre
    const prevSegmentState = segmentStates[index - 1];
    if (prevSegmentState === 'current') return 'current';

    return 'future';
  };

  // Tamamlanan durak sayısı
  const completedCount = sortedStops.filter(s => s.arrivedAt || (s.order === 1 && s.departedAt)).length;
  const progressPercent = stops.length > 1 ? Math.round((completedCount / stops.length) * 100) : 0;

  return (
    <div className="h-full flex flex-col p-3 sm:p-4 overflow-hidden">
      {/* Progress Header */}
      <div className="flex-shrink-0 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Rota İlerlemesi</span>
          <span className="text-xs text-muted-foreground">
            {completedCount} / {stops.length} durak
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Metro Style Progress */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="relative">
          {sortedStops.map((stop, index) => {
            const stopStatus = getStopStatus(index);
            const isFirst = index === 0;
            const isLast = index === sortedStops.length - 1;
            const segmentState = !isLast ? segmentStates[index] : null;

            return (
              <div key={stop.hospitalId} className="relative">
                {/* Stop Node */}
                <div className="flex items-start gap-3 sm:gap-4">
                  {/* Metro Line & Node */}
                  <div className="flex flex-col items-center flex-shrink-0">
                    {/* Node */}
                    <div
                      className={cn(
                        "relative z-10 flex items-center justify-center rounded-full transition-all duration-300",
                        stopStatus === 'completed' && "w-8 h-8 sm:w-10 sm:h-10 bg-green-500 text-white shadow-lg shadow-green-500/30",
                        stopStatus === 'current' && "w-10 h-10 sm:w-12 sm:h-12 bg-blue-500 text-white shadow-lg shadow-blue-500/40 animate-pulse",
                        stopStatus === 'future' && "w-7 h-7 sm:w-8 sm:h-8 bg-muted border-2 border-border"
                      )}
                    >
                      {stopStatus === 'completed' && (
                        <Check className="h-4 w-4 sm:h-5 sm:w-5" />
                      )}
                      {stopStatus === 'current' && (
                        <Navigation className="h-4 w-4 sm:h-5 sm:w-5" />
                      )}
                      {stopStatus === 'future' && (
                        <span className="text-xs sm:text-sm font-medium text-muted-foreground">{stop.order}</span>
                      )}
                    </div>

                    {/* Connecting Line */}
                    {!isLast && (
                      <div
                        className={cn(
                          "w-1 sm:w-1.5 flex-1 min-h-[40px] sm:min-h-[50px] transition-all duration-300",
                          segmentState === 'completed' && "bg-gradient-to-b from-green-500 to-green-500",
                          segmentState === 'current' && "bg-gradient-to-b from-blue-500 via-blue-400 to-muted animate-pulse",
                          segmentState === 'future' && "bg-muted"
                        )}
                      />
                    )}
                  </div>

                  {/* Stop Info */}
                  <div className={cn(
                    "flex-1 pb-4 sm:pb-6 min-w-0",
                    !isLast && "pb-6 sm:pb-8"
                  )}>
                    <div className={cn(
                      "rounded-xl p-3 sm:p-4 transition-all duration-300",
                      stopStatus === 'completed' && "bg-green-500/10 border border-green-500/20",
                      stopStatus === 'current' && "bg-blue-500/10 border border-blue-500/30 shadow-md",
                      stopStatus === 'future' && "bg-muted/50 border border-border/50"
                    )}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className={cn(
                            "font-medium truncate text-sm sm:text-base",
                            stopStatus === 'current' && "text-blue-600 dark:text-blue-400"
                          )}>
                            {stop.name}
                          </h4>

                          {/* Status Badge */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            {isFirst && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-primary/10 text-primary">
                                <MapPin className="h-3 w-3 mr-1" />
                                Başlangıç
                              </span>
                            )}
                            {isLast && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400">
                                🏁 Bitiş
                              </span>
                            )}

                            {stopStatus === 'current' && !isFirst && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-blue-500/20 text-blue-600 dark:text-blue-400">
                                <Navigation className="h-3 w-3 mr-1 animate-bounce" />
                                Hedefe gidiliyor
                              </span>
                            )}
                            {stopStatus === 'current' && isFirst && !sortedStops[0].departedAt && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-blue-500/20 text-blue-600 dark:text-blue-400">
                                Çıkış bekleniyor
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Order Badge */}
                        <div className={cn(
                          "flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold",
                          stopStatus === 'completed' && "bg-green-500/20 text-green-600 dark:text-green-400",
                          stopStatus === 'current' && "bg-blue-500/20 text-blue-600 dark:text-blue-400",
                          stopStatus === 'future' && "bg-muted text-muted-foreground"
                        )}>
                          {stop.order}
                        </div>
                      </div>

                      {/* Timestamps */}
                      {(stop.arrivedAt || stop.departedAt) && (
                        <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                          {stop.arrivedAt && (
                            <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                              Varış: {format(stop.arrivedAt.toDate(), 'HH:mm', { locale: tr })}
                            </div>
                          )}
                          {stop.departedAt && (
                            <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                              Çıkış: {format(stop.departedAt.toDate(), 'HH:mm', { locale: tr })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary Footer */}
      <div className="flex-shrink-0 mt-3 pt-3 border-t border-border">
        <div className="flex items-center justify-between text-xs sm:text-sm text-muted-foreground">
          <span>Toplam {stops.length} durak</span>
          <span className={cn(
            "px-2 py-1 rounded-full text-xs font-medium",
            status === 'completed' && "bg-green-500/10 text-green-600",
            status === 'in_progress' && "bg-blue-500/10 text-blue-600",
            status === 'open' && "bg-muted text-muted-foreground"
          )}>
            {status === 'completed' ? 'Tamamlandı' : status === 'in_progress' ? 'Devam Ediyor' : 'Bekliyor'}
          </span>
        </div>
      </div>
    </div>
  );
}
