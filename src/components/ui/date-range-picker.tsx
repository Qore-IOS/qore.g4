
"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { addDays, format, startOfMonth, endOfMonth, subMonths } from "date-fns"
import { tr } from 'date-fns/locale'; // Turkish locale
import type { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

interface DatePickerWithRangeProps extends React.HTMLAttributes<HTMLDivElement> {
  date: DateRange | undefined;
  setDate: ((value: DateRange | undefined) => void);
  showAllOption?: boolean;
}

export function DatePickerWithRange({
  className,
  date,
  setDate,
  showAllOption = false,
}: DatePickerWithRangeProps) {

  const handlePresetChange = (value: string) => {
    const now = new Date();
    switch (value) {
      case 'all':
        setDate(undefined);
        break;
      case 'today':
        setDate({ from: now, to: now });
        break;
      case 'last7':
        setDate({ from: addDays(now, -6), to: now });
        break;
      case 'last30':
        setDate({ from: addDays(now, -29), to: now });
        break;
      case 'thisMonth':
        setDate({ from: startOfMonth(now), to: endOfMonth(now) });
        break;
      case 'lastMonth': {
        const lastMonth = subMonths(now, 1);
        setDate({ from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) });
        break;
      }
      default:
        setDate(undefined);
    }
  };

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-full justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "LLL dd, y", { locale: tr })} -{" "}
                  {format(date.to, "LLL dd, y", { locale: tr })}
                </>
              ) : (
                format(date.from, "LLL dd, y", { locale: tr })
              )
            ) : (
              <span>{showAllOption ? 'Tüm Zamanlar' : 'Tarih aralığı seçin'}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 flex" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={setDate}
            numberOfMonths={2}
            locale={tr}
          />
           <div className="flex flex-col space-y-2 border-l p-4">
              <h4 className="text-sm font-medium">Kestirmeler</h4>
              {showAllOption && (
                <Button variant="ghost" className="justify-start" onClick={() => handlePresetChange('all')}>Tümü</Button>
              )}
              <Button variant="ghost" className="justify-start" onClick={() => handlePresetChange('today')}>Bugün</Button>
              <Button variant="ghost" className="justify-start" onClick={() => handlePresetChange('last7')}>Son 7 Gün</Button>
              <Button variant="ghost" className="justify-start" onClick={() => handlePresetChange('last30')}>Son 30 Gün</Button>
              <Button variant="ghost" className="justify-start" onClick={() => handlePresetChange('thisMonth')}>Bu Ay</Button>
              <Button variant="ghost" className="justify-start" onClick={() => handlePresetChange('lastMonth')}>Geçen Ay</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
