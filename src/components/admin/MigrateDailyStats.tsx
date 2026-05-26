'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { migrateHistoricalData } from '@/lib/dailyConsumptionStats';
import { useAuth } from '@/contexts/auth-context';
import { subDays } from 'date-fns';

interface MigrationStatus {
  isRunning: boolean;
  progress: number;
  total: number;
  currentDate: string;
  success: number;
  failed: number;
  error?: string;
}

export default function MigrateDailyStats() {
  const { currentCompanyId } = useAuth();
  const [status, setStatus] = useState<MigrationStatus>({
    isRunning: false,
    progress: 0,
    total: 0,
    currentDate: '',
    success: 0,
    failed: 0
  });

  const runMigration = async (days: number) => {
    const endDate = new Date();
    const startDate = subDays(endDate, days);

    setStatus({
      isRunning: true,
      progress: 0,
      total: days,
      currentDate: '',
      success: 0,
      failed: 0
    });

    try {
      const result = await migrateHistoricalData(
        startDate,
        endDate,
        currentCompanyId,
        (current, total, date) => {
          setStatus(prev => ({
            ...prev,
            progress: current,
            total,
            currentDate: date
          }));
        }
      );

      setStatus(prev => ({
        ...prev,
        isRunning: false,
        success: result.success,
        failed: result.failed
      }));
    } catch (error: any) {
      setStatus(prev => ({
        ...prev,
        isRunning: false,
        error: error.message || 'Migration failed'
      }));
    }
  };

  const progressPercent = status.total > 0 ? (status.progress / status.total) * 100 : 0;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Günlük Tüketim İstatistiklerini Migrate Et</CardTitle>
        <CardDescription>
          Geçmiş tüketim verilerini dailyConsumptionStats koleksiyonuna aktarın.
          Bu işlem dashboard tüketim grafiğinin geçmişe dönük verileri göstermesini sağlar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.isRunning ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Migration devam ediyor: {status.currentDate}</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
            <p className="text-sm text-muted-foreground">
              {status.progress} / {status.total} gün işlendi
            </p>
          </div>
        ) : status.success > 0 || status.failed > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-4 w-4" />
              <span>{status.success} gün başarıyla migrate edildi</span>
            </div>
            {status.failed > 0 && (
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-4 w-4" />
                <span>{status.failed} gün başarısız</span>
              </div>
            )}
          </div>
        ) : status.error ? (
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle className="h-4 w-4" />
            <span>{status.error}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => runMigration(30)}
            disabled={status.isRunning}
            variant="outline"
          >
            Son 30 Gün
          </Button>
          <Button
            onClick={() => runMigration(90)}
            disabled={status.isRunning}
            variant="outline"
          >
            Son 90 Gün
          </Button>
          <Button
            onClick={() => runMigration(365)}
            disabled={status.isRunning}
          >
            Son 1 Yıl
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Not: Migration sırasında her gün için tuketimKayitlari koleksiyonundan veriler okunup
          dailyConsumptionStats koleksiyonuna yazılır. Bu işlem birkaç dakika sürebilir.
        </p>
      </CardContent>
    </Card>
  );
}
