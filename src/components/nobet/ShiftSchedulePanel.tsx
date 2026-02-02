'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CalendarClock, Plus, History, ArrowLeft, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import CreateShiftPanel from './CreateShiftPanel';
import ShiftHistoryPanel from './ShiftHistoryPanel';
import ActiveShiftsPanel from './ActiveShiftsPanel';
import type { Hospital, User } from '@/lib/types';

interface ShiftSchedulePanelProps {
  hospitals: Hospital[];
  users: User[];
  onBack?: () => void;
}

type ViewMode = 'main' | 'create' | 'history' | 'active';

const ModernButton = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button> & { icon?: React.ElementType }>(
  ({ className, children, icon: Icon, ...props }, ref) => (
    <Button
      ref={ref}
      className={cn(
        "h-auto p-8 text-lg font-headline rounded-xl transition-all duration-200 ease-in-out",
        "bg-card text-card-foreground hover:bg-accent/10 hover:text-accent-foreground",
        "shadow-lg hover:shadow-xl",
        className
      )}
      {...props}
    >
      <div className="flex flex-col items-center justify-center">
        {Icon && <Icon className="h-12 w-12 mb-3 text-primary" />}
        {children}
      </div>
    </Button>
  )
);
ModernButton.displayName = "ModernButton";

export default function ShiftSchedulePanel({ hospitals, users, onBack }: ShiftSchedulePanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('main');

  const handleBack = () => {
    if (viewMode === 'main' && onBack) {
      onBack();
    } else {
      setViewMode('main');
    }
  };

  if (viewMode === 'create') {
    return (
      <CreateShiftPanel
        hospitals={hospitals}
        users={users}
        onBack={() => setViewMode('main')}
        onSuccess={() => setViewMode('main')}
      />
    );
  }

  if (viewMode === 'history') {
    return (
      <ShiftHistoryPanel
        hospitals={hospitals}
        users={users}
        onBack={() => setViewMode('main')}
      />
    );
  }

  if (viewMode === 'active') {
    return (
      <ActiveShiftsPanel
        hospitals={hospitals}
        users={users}
        onBack={() => setViewMode('main')}
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-full p-4 sm:p-8">
      <Card className={cn(
        "w-full max-w-3xl p-6 sm:p-10 rounded-3xl",
        "shadow-2xl relative"
      )}>
        {onBack && (
          <Button
            variant="ghost"
            onClick={handleBack}
            className="absolute top-4 left-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Geri
          </Button>
        )}
        <CardHeader className="text-center mb-8">
          <CardTitle className="text-3xl sm:text-4xl font-headline text-primary flex items-center justify-center gap-3">
            <CalendarClock className="h-10 w-10" />
            Nöbet Vardiyası Yönetimi
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
          <ModernButton onClick={() => setViewMode('create')} icon={Plus}>
            Vardiya Oluştur
          </ModernButton>
          <ModernButton onClick={() => setViewMode('active')} icon={Calendar}>
            Aktif Vardiyalar
          </ModernButton>
          <ModernButton onClick={() => setViewMode('history')} icon={History}>
            Geçmiş
          </ModernButton>
        </CardContent>
      </Card>
    </div>
  );
}
