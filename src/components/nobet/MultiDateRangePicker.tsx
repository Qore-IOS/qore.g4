'use client';

import React, { useState, useMemo } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWithinInterval, isBefore, isAfter, startOfWeek, endOfWeek, getDay, addDays, isSameMonth } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, X, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShiftDateRange } from '@/lib/types';

interface MultiDateRangePickerProps {
  selectedRanges: ShiftDateRange[];
  onRangesChange: (ranges: ShiftDateRange[]) => void;
  className?: string;
}

export default function MultiDateRangePicker({
  selectedRanges,
  onRangesChange,
  className
}: MultiDateRangePickerProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectionStart, setSelectionStart] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  // Generate calendar days for the current month view
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday start
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [currentMonth]);

  // Check if a date is within any selected range
  const isDateInRange = (date: Date): boolean => {
    return selectedRanges.some(range => {
      const start = new Date(range.startDate);
      const end = new Date(range.endDate);
      return isWithinInterval(date, { start, end });
    });
  };

  // Check if a date is a range start
  const isRangeStart = (date: Date): boolean => {
    return selectedRanges.some(range => isSameDay(new Date(range.startDate), date));
  };

  // Check if a date is a range end
  const isRangeEnd = (date: Date): boolean => {
    return selectedRanges.some(range => isSameDay(new Date(range.endDate), date));
  };

  // Check if date is in the current selection preview
  const isInSelectionPreview = (date: Date): boolean => {
    if (!selectionStart || !hoverDate) return false;
    const start = isBefore(selectionStart, hoverDate) ? selectionStart : hoverDate;
    const end = isAfter(selectionStart, hoverDate) ? selectionStart : hoverDate;
    return isWithinInterval(date, { start, end });
  };

  // Handle day click
  const handleDayClick = (date: Date) => {
    if (!selectionStart) {
      // Start new selection
      setSelectionStart(date);
    } else {
      // Complete selection
      const start = isBefore(selectionStart, date) ? selectionStart : date;
      const end = isAfter(selectionStart, date) ? selectionStart : date;

      const newRange: ShiftDateRange = {
        startDate: format(start, 'yyyy-MM-dd'),
        endDate: format(end, 'yyyy-MM-dd')
      };

      // Check for overlaps and merge if needed
      const mergedRanges = mergeRanges([...selectedRanges, newRange]);
      onRangesChange(mergedRanges);
      setSelectionStart(null);
      setHoverDate(null);
    }
  };

  // Merge overlapping ranges
  const mergeRanges = (ranges: ShiftDateRange[]): ShiftDateRange[] => {
    if (ranges.length <= 1) return ranges;

    // Sort by start date
    const sorted = [...ranges].sort((a, b) =>
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

    const merged: ShiftDateRange[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];

      const lastEnd = new Date(last.endDate);
      const currentStart = new Date(current.startDate);

      // Check if ranges overlap or are adjacent
      if (addDays(lastEnd, 1) >= currentStart) {
        // Merge: extend the last range if current extends beyond
        const currentEnd = new Date(current.endDate);
        if (currentEnd > lastEnd) {
          merged[merged.length - 1] = {
            startDate: last.startDate,
            endDate: current.endDate
          };
        }
      } else {
        merged.push(current);
      }
    }

    return merged;
  };

  // Remove a specific range
  const removeRange = (index: number) => {
    const newRanges = selectedRanges.filter((_, i) => i !== index);
    onRangesChange(newRanges);
  };

  // Calculate total days in all ranges
  const totalDays = useMemo(() => {
    return selectedRanges.reduce((total, range) => {
      const start = new Date(range.startDate);
      const end = new Date(range.endDate);
      const days = eachDayOfInterval({ start, end }).length;
      return total + days;
    }, 0);
  }, [selectedRanges]);

  // Week days header
  const weekDays = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Nöbet Tarih Aralıkları
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[120px] text-center">
              {format(currentMonth, 'MMMM yyyy', { locale: tr })}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardDescription>
          {selectionStart
            ? `Seçim başlangıcı: ${format(selectionStart, 'd MMMM yyyy', { locale: tr })} - Bitiş tarihini seçin`
            : 'Takvimde başlangıç tarihine tıklayarak yeni bir aralık ekleyin'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Calendar Grid */}
        <div className="border rounded-lg p-3">
          {/* Week day headers */}
          <div className="grid grid-cols-7 mb-2">
            {weekDays.map((day) => (
              <div key={day} className="text-center text-xs font-medium text-muted-foreground py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, index) => {
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isSelected = isDateInRange(day);
              const isStart = isRangeStart(day);
              const isEnd = isRangeEnd(day);
              const isPreview = isInSelectionPreview(day);
              const isSelectionStartDay = selectionStart && isSameDay(day, selectionStart);
              const isToday = isSameDay(day, new Date());

              return (
                <button
                  key={index}
                  onClick={() => handleDayClick(day)}
                  onMouseEnter={() => selectionStart && setHoverDate(day)}
                  className={cn(
                    "h-9 w-full text-sm rounded-md transition-all duration-150",
                    "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
                    !isCurrentMonth && "text-muted-foreground/40",
                    isCurrentMonth && "text-foreground",
                    isToday && !isSelected && "font-bold border border-primary",
                    // Selection states
                    isSelected && "bg-primary text-primary-foreground",
                    isStart && "rounded-l-md",
                    isEnd && "rounded-r-md",
                    isSelected && !isStart && !isEnd && "rounded-none",
                    // Preview states
                    isPreview && !isSelected && "bg-primary/30",
                    isSelectionStartDay && "ring-2 ring-primary"
                  )}
                >
                  {format(day, 'd')}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Ranges Display */}
        {selectedRanges.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Seçilen Aralıklar ({totalDays} gün)</h4>
              {selectedRanges.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onRangesChange([])}
                >
                  Tümünü Temizle
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedRanges.map((range, index) => {
                const start = new Date(range.startDate);
                const end = new Date(range.endDate);
                const days = eachDayOfInterval({ start, end }).length;

                return (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="pl-3 pr-1 py-1 flex items-center gap-2"
                  >
                    <span>
                      {format(start, 'd MMM', { locale: tr })} - {format(end, 'd MMM yyyy', { locale: tr })}
                      <span className="ml-1 text-muted-foreground">({days} gün)</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 hover:bg-destructive/20"
                      onClick={() => removeRange(index)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* Cancel selection button */}
        {selectionStart && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectionStart(null);
              setHoverDate(null);
            }}
          >
            Seçimi İptal Et
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
