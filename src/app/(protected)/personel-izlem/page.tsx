'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Users, TrendingUp, TrendingDown, Clock, Phone, Building, Wrench, FlaskConical, AlertTriangle, CheckCircle, Calendar, Package, Timer, Filter, X, UserCircle, ArrowUp, ArrowDown, Minus, GitCompare, FileDown, HeartHandshake } from 'lucide-react';
import BackButton from '@/components/BackButton';
import {
  calculateAllPerformances,
  getScoreColor,
  formatDuration,
  type PersonnelPerformance,
  type PerformanceFilters,
} from '@/lib/performance-calculator';
import { cn, exportPersonnelToPdf } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Hospital } from '@/lib/types';

// Neumorphic score circle component
function ScoreCircle({ score }: { score: number }) {
  const colors = getScoreColor(score);
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="relative w-24 h-24">
      {/* Neumorphic background */}
      <div
        className={cn(
          "absolute inset-0 rounded-full",
          "bg-gradient-to-br from-background to-muted",
          "shadow-[inset_4px_4px_8px_rgba(0,0,0,0.1),inset_-4px_-4px_8px_rgba(255,255,255,0.1)]",
          "dark:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.3),inset_-4px_-4px_8px_rgba(255,255,255,0.05)]"
        )}
      />

      {/* SVG Progress Ring */}
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-muted-foreground/20"
        />
        {/* Progress circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={colors.text}
          style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
        />
      </svg>

      {/* Score text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn("text-2xl font-bold", colors.text)}>
          {Math.round(score)}
        </span>
      </div>
    </div>
  );
}

// Metric item component
function MetricItem({
  icon: Icon,
  label,
  value,
  subValue,
  score,
  tooltip,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  score: number;
  tooltip?: string;
}) {
  const isNegative = score < 0;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-help">
            <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground truncate">{label}</p>
              <p className="text-sm font-medium truncate">{value}</p>
              {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
            </div>
            <Badge
              variant={isNegative ? 'destructive' : 'secondary'}
              className={cn(
                "text-xs flex-shrink-0",
                score >= 10 && "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
                score >= 5 && score < 10 && "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
                score > 0 && score < 5 && "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
                score === 0 && "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
              )}
            >
              {isNegative ? score : `+${score.toFixed(1)}`}
            </Badge>
          </div>
        </TooltipTrigger>
        {tooltip && (
          <TooltipContent>
            <p className="max-w-xs text-xs">{tooltip}</p>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

// Personnel card component
function PersonnelCard({ performance }: { performance: PersonnelPerformance }) {
  const { user, metrics } = performance;
  const isAplikasyon = user.role === 'aplikasyon';

  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-200",
      "hover:shadow-lg",
      "border-l-4",
      isAplikasyon ? "border-l-purple-500" : "border-l-blue-500"
    )}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Left side: Name and role */}
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold truncate">{user.name || user.email}</h3>
            <div className="flex items-center gap-2 mt-1">
              {isAplikasyon ? (
                <Badge variant="outline" className="bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                  <FlaskConical className="h-3 w-3 mr-1" />
                  Aplikasyon
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  <Wrench className="h-3 w-3 mr-1" />
                  Teknik Servis
                </Badge>
              )}
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <MetricItem
                icon={TrendingUp}
                label="Arıza Üstlenme"
                value={`${metrics.faultsAssigned} / ${metrics.expectedFaults > 0 ? metrics.expectedFaults.toFixed(1) : metrics.avgFaultsAssignedForRole.toFixed(1)}`}
                subValue={metrics.expectedFaults > 0
                  ? `%${((metrics.faultsAssigned / metrics.expectedFaults) * 100).toFixed(0)} beklenen`
                  : metrics.avgFaultsAssignedForRole > 0
                  ? `ort: ${metrics.avgFaultsAssignedForRole.toFixed(1)}`
                  : 'beklenti yok'}
                score={metrics.faultAssignmentScore}
                tooltip="İş yükü puanı (maks 30): Beklenen arıza payı karşılama (20pt) + hacim bonusu (10pt). Ortalamaya göre daha fazla arıza = daha yüksek puan."
              />
              <MetricItem
                icon={Clock}
                label="Müdahale Başlatma"
                value={formatDuration(metrics.avgInterventionStartTimeMinutes)}
                subValue="ortalama süre"
                score={metrics.interventionTimeScore}
                tooltip="Müdahale başlatma hızı (maks 10): 0dk=10pt, 2saat=0pt. Doğrusal ölçek."
              />
              <MetricItem
                icon={CheckCircle}
                label="Çözüm Süresi"
                value={formatDuration(metrics.avgResolutionTimeMinutes)}
                subValue={`${metrics.faultsResolved} arıza çözüldü`}
                score={metrics.resolutionTimeScore}
                tooltip="Çözüm kalitesi (10pt) + çözüm hacmi (5pt). Hızlı çözüm ve çok arıza = yüksek puan."
              />
              <MetricItem
                icon={Building}
                label="Kurum Ziyareti"
                value={metrics.institutionVisits}
                subValue={`ort: ${metrics.avgInstitutionVisits.toFixed(1)}`}
                score={metrics.visitFrequencyScore}
                tooltip="Form oluşturma + kurumda müdahale sayısı. Ortalama üstü = yüksek puan."
              />
              <MetricItem
                icon={Phone}
                label="Kurumda Müdahale"
                value={`${metrics.onsiteInterventions} / ${metrics.onsiteInterventions + metrics.phoneInterventions}`}
                subValue={metrics.onsiteInterventions + metrics.phoneInterventions > 0
                  ? `%${((metrics.onsiteInterventions / (metrics.onsiteInterventions + metrics.phoneInterventions)) * 100).toFixed(0)} kurumda`
                  : 'veri yok'}
                score={metrics.onsiteRatioScore}
                tooltip="Telefon vs kurumda müdahale oranı. Kurumda müdahale daha değerlidir."
              />
              <MetricItem
                icon={Calendar}
                label="Periyodik Bakım"
                value={`${metrics.periodicMaintenanceForms} / ${metrics.totalPeriodicMaintenanceForms}`}
                subValue={metrics.totalPeriodicMaintenanceForms > 0
                  ? `%${((metrics.periodicMaintenanceForms / metrics.totalPeriodicMaintenanceForms) * 100).toFixed(1)} katkı`
                  : 'veri yok'}
                score={metrics.maintenanceContributionScore}
                tooltip="Toplam periyodik bakım formlarındaki pay. Yüksek katkı = yüksek puan."
              />
              {metrics.supportCount > 0 && (
                <MetricItem
                  icon={HeartHandshake}
                  label="Destek Puanı"
                  value={`${metrics.supportCount} destek`}
                  subValue="arıza çözümünde"
                  score={metrics.supportScore}
                  tooltip="Arıza çözümünde destek personeli olarak seçilme sayısı. Her destek +2 puan, maks 10."
                />
              )}
              {metrics.recurrenceCount > 0 && (
                <MetricItem
                  icon={AlertTriangle}
                  label="Tekrar Arıza"
                  value={`${metrics.recurrenceCount} adet`}
                  subValue="7 gün içinde"
                  score={metrics.recurrencePenalty}
                  tooltip="Çözümden sonra 7 gün içinde aynı cihazda tekrar arıza. Her tekrar -2 puan ceza."
                />
              )}
              {(metrics.overdueMaintenanceTasks > 0 || metrics.overduePeriodicParts > 0) && (
                <MetricItem
                  icon={Timer}
                  label="Gecikmiş Bakım"
                  value={`${metrics.overdueMaintenanceTasks + metrics.overduePeriodicParts} adet`}
                  subValue={`${metrics.overdueMaintenanceTasks} iş, ${metrics.overduePeriodicParts} parça`}
                  score={metrics.overduePenalty}
                  tooltip="Ana sorumluluk laboratuvarlarındaki gecikmiş periyodik bakım işleri ve parça değişimleri. Her gecikme -3 puan ceza."
                />
              )}
            </div>
          </div>

          {/* Right side: Score circle */}
          <div className="flex-shrink-0">
            <ScoreCircle score={metrics.totalScore} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Large score circle component for detailed view
function LargeScoreCircle({ score }: { score: number }) {
  const colors = getScoreColor(score);
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="relative w-40 h-40">
      {/* Neumorphic background */}
      <div
        className={cn(
          "absolute inset-0 rounded-full",
          "bg-gradient-to-br from-background to-muted",
          "shadow-[inset_6px_6px_12px_rgba(0,0,0,0.1),inset_-6px_-6px_12px_rgba(255,255,255,0.1)]",
          "dark:shadow-[inset_6px_6px_12px_rgba(0,0,0,0.3),inset_-6px_-6px_12px_rgba(255,255,255,0.05)]"
        )}
      />

      {/* SVG Progress Ring */}
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-muted-foreground/20"
        />
        {/* Progress circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={colors.text}
          style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
        />
      </svg>

      {/* Score text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-4xl font-bold", colors.text)}>
          {Math.round(score)}
        </span>
        <span className="text-xs text-muted-foreground">PUAN</span>
      </div>
    </div>
  );
}

// Detailed metric row for large KPI card
function DetailedMetricRow({
  icon: Icon,
  label,
  value,
  subValue,
  score,
  maxScore,
  tooltip,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  score: number;
  maxScore: number;
  tooltip?: string;
}) {
  const isNegative = score < 0;
  const percentage = maxScore > 0 ? Math.max(0, (score / maxScore) * 100) : 0;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors cursor-help">
            <div className={cn(
              "p-3 rounded-xl",
              isNegative ? "bg-red-100 dark:bg-red-950" : "bg-primary/10"
            )}>
              <Icon className={cn(
                "h-6 w-6",
                isNegative ? "text-red-600 dark:text-red-400" : "text-primary"
              )} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">{label}</p>
                <Badge
                  variant={isNegative ? 'destructive' : 'secondary'}
                  className={cn(
                    "text-sm font-bold",
                    score >= maxScore * 0.7 && "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
                    score >= maxScore * 0.4 && score < maxScore * 0.7 && "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
                    score > 0 && score < maxScore * 0.4 && "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
                    score === 0 && "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                  )}
                >
                  {isNegative ? score : `+${score.toFixed(1)}`} / {maxScore}
                </Badge>
              </div>
              <p className="text-xl font-bold">{value}</p>
              {subValue && <p className="text-sm text-muted-foreground">{subValue}</p>}
              {!isNegative && (
                <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", getScoreColor(percentage).bg)}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </TooltipTrigger>
        {tooltip && (
          <TooltipContent>
            <p className="max-w-xs text-sm">{tooltip}</p>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

// Detailed KPI Card for single personnel view
function DetailedKPICard({
  performance,
  onCompare,
  showCompareButton = true
}: {
  performance: PersonnelPerformance;
  onCompare?: () => void;
  showCompareButton?: boolean;
}) {
  const { user, metrics } = performance;
  const isAplikasyon = user.role === 'aplikasyon';

  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-200",
      "border-l-4",
      isAplikasyon ? "border-l-purple-500" : "border-l-blue-500"
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-2xl">{user.name || user.email}</CardTitle>
            <div className="flex items-center gap-2 mt-2">
              {isAplikasyon ? (
                <Badge variant="outline" className="bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                  <FlaskConical className="h-3 w-3 mr-1" />
                  Aplikasyon
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  <Wrench className="h-3 w-3 mr-1" />
                  Teknik Servis
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {showCompareButton && onCompare && (
              <Button onClick={onCompare} variant="outline" className="gap-2">
                <GitCompare className="h-4 w-4" />
                Karşılaştır
              </Button>
            )}
            <LargeScoreCircle score={metrics.totalScore} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DetailedMetricRow
            icon={TrendingUp}
            label="Arıza Üstlenme & İş Yükü"
            value={`${metrics.faultsAssigned} / ${metrics.expectedFaults > 0 ? metrics.expectedFaults.toFixed(1) : metrics.avgFaultsAssignedForRole.toFixed(1)}`}
            subValue={metrics.expectedFaults > 0
              ? `Beklenen arıza sayısının %${((metrics.faultsAssigned / metrics.expectedFaults) * 100).toFixed(0)}'i karşılandı`
              : metrics.avgFaultsAssignedForRole > 0
              ? `Rol ortalaması: ${metrics.avgFaultsAssignedForRole.toFixed(1)} arıza`
              : 'Beklenen arıza yok'}
            score={metrics.faultAssignmentScore}
            maxScore={30}
            tooltip="Beklenen pay karşılama (20pt) + hacim bonusu (10pt). Ortalamadan fazla arıza üstlenmek ekstra puan kazandırır."
          />
          <DetailedMetricRow
            icon={Clock}
            label="Müdahale Başlatma Süresi"
            value={formatDuration(metrics.avgInterventionStartTimeMinutes)}
            subValue="Ortalama müdahale başlama süresi"
            score={metrics.interventionTimeScore}
            maxScore={10}
            tooltip="Doğrusal ölçek: 0dk=10pt, 1saat=5pt, 2saat=0pt. Hızlı müdahale sürekli ödüllendirilir."
          />
          <DetailedMetricRow
            icon={CheckCircle}
            label="Çözüm Süresi & Başarısı"
            value={formatDuration(metrics.avgResolutionTimeMinutes)}
            subValue={`Toplam ${metrics.faultsResolved} arıza çözüldü (ort: ${metrics.avgFaultsResolvedForRole.toFixed(1)})`}
            score={metrics.resolutionTimeScore}
            maxScore={15}
            tooltip="Çözüm kalitesi (10pt): 0dk=10pt, 8saat=0pt doğrusal. Çözüm hacmi (5pt): Ortalama kadar çözüm=2.5pt, 2x ortalama=5pt."
          />
          <DetailedMetricRow
            icon={Building}
            label="Kurum Ziyareti"
            value={`${metrics.institutionVisits} ziyaret`}
            subValue={`Rol ortalaması: ${metrics.avgInstitutionVisits.toFixed(1)} ziyaret`}
            score={metrics.visitFrequencyScore}
            maxScore={10}
            tooltip="Ortalama kadar ziyaret=5pt, 2x ortalama=10pt. Form + kurumda müdahale sayısı."
          />
          <DetailedMetricRow
            icon={Phone}
            label="Kurumda Müdahale Oranı"
            value={`${metrics.onsiteInterventions} / ${metrics.onsiteInterventions + metrics.phoneInterventions}`}
            subValue={metrics.onsiteInterventions + metrics.phoneInterventions > 0
              ? `Müdahalelerin %${((metrics.onsiteInterventions / (metrics.onsiteInterventions + metrics.phoneInterventions)) * 100).toFixed(0)}'i kurumda yapıldı`
              : 'Müdahale verisi yok'}
            score={metrics.onsiteRatioScore}
            maxScore={10}
            tooltip="Kurumda müdahale oranı × 10pt. 3'ten az müdahale varsa örneklem küçüklüğü nedeniyle oransal düşürülür."
          />
          <DetailedMetricRow
            icon={Calendar}
            label="Periyodik Bakım Katkısı"
            value={`${metrics.periodicMaintenanceForms} / ${metrics.totalPeriodicMaintenanceForms}`}
            subValue={metrics.totalPeriodicMaintenanceForms > 0 && metrics.sameRoleTechnicianCount > 0
              ? `Kişi başı beklenen: ${(metrics.totalPeriodicMaintenanceForms / metrics.sameRoleTechnicianCount).toFixed(1)} bakım`
              : 'Periyodik bakım verisi yok'}
            score={metrics.maintenanceContributionScore}
            maxScore={15}
            tooltip="Kişi başı beklenen pay bazlı. Toplam bakım / personel sayısı = beklenen. Beklenen kadar yapma = 15pt."
          />
          <DetailedMetricRow
            icon={HeartHandshake}
            label="Destek Puanı"
            value={`${metrics.supportCount} destek`}
            subValue={metrics.supportCount > 0
              ? `Arıza çözümünde ${metrics.supportCount} kez destek verildi`
              : 'Henüz destek kaydı yok'}
            score={metrics.supportScore}
            maxScore={10}
            tooltip="Arıza kapatılırken destek personeli olarak seçilme sayısı. Her destek +2 puan, maksimum 10 puan."
          />
          {(metrics.recurrenceCount > 0 || metrics.recurrencePenalty < 0) && (
            <DetailedMetricRow
              icon={AlertTriangle}
              label="Tekrar Arıza Cezası"
              value={`${metrics.recurrenceCount} adet`}
              subValue="7 gün içinde aynı cihazda tekrar arıza"
              score={metrics.recurrencePenalty}
              maxScore={-10}
              tooltip="Çözümden sonra 7 gün içinde aynı cihazda tekrar arıza. Her tekrar -2 puan ceza."
            />
          )}
          {(metrics.overdueMaintenanceTasks > 0 || metrics.overduePeriodicParts > 0) && (
            <DetailedMetricRow
              icon={Timer}
              label="Gecikmiş Bakım Cezası"
              value={`${metrics.overdueMaintenanceTasks + metrics.overduePeriodicParts} adet`}
              subValue={`${metrics.overdueMaintenanceTasks} bakım işi + ${metrics.overduePeriodicParts} parça değişimi gecikmiş`}
              score={metrics.overduePenalty}
              maxScore={-15}
              tooltip="Ana sorumluluk laboratuvarlarındaki gecikmiş periyodik bakım işleri ve parça değişimleri. Her gecikme -3 puan ceza."
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Comparison arrow component
function ComparisonArrow({ value1, value2, higherIsBetter = true }: { value1: number; value2: number; higherIsBetter?: boolean }) {
  const diff = value1 - value2;

  if (Math.abs(diff) < 0.01) {
    return <Minus className="h-5 w-5 text-muted-foreground" />;
  }

  const isFirstBetter = higherIsBetter ? diff > 0 : diff < 0;

  if (isFirstBetter) {
    return <ArrowUp className="h-5 w-5 text-green-600" />;
  } else {
    return <ArrowDown className="h-5 w-5 text-red-600" />;
  }
}

// Comparison metric row
function ComparisonMetricRow({
  icon: Icon,
  label,
  value1,
  value2,
  score1,
  score2,
  maxScore,
  higherIsBetter = true,
}: {
  icon: React.ElementType;
  label: string;
  value1: string | number;
  value2: string | number;
  score1: number;
  score2: number;
  maxScore: number;
  higherIsBetter?: boolean;
}) {
  const isNegative = maxScore < 0;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center p-4 rounded-xl bg-muted/30">
      {/* Person 1 */}
      <div className="text-right">
        <p className="text-lg font-bold">{value1}</p>
        <Badge
          variant={isNegative ? 'destructive' : 'secondary'}
          className={cn(
            "text-xs",
            !isNegative && score1 >= Math.abs(maxScore) * 0.7 && "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
            !isNegative && score1 >= Math.abs(maxScore) * 0.4 && score1 < Math.abs(maxScore) * 0.7 && "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
          )}
        >
          {isNegative ? score1 : `+${score1.toFixed(1)}`}
        </Badge>
      </div>

      {/* Center - label and arrow */}
      <div className="flex flex-col items-center gap-1">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <p className="text-xs font-medium text-center text-muted-foreground">{label}</p>
        <ComparisonArrow value1={score1} value2={score2} higherIsBetter={isNegative ? false : true} />
      </div>

      {/* Person 2 */}
      <div className="text-left">
        <p className="text-lg font-bold">{value2}</p>
        <Badge
          variant={isNegative ? 'destructive' : 'secondary'}
          className={cn(
            "text-xs",
            !isNegative && score2 >= Math.abs(maxScore) * 0.7 && "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
            !isNegative && score2 >= Math.abs(maxScore) * 0.4 && score2 < Math.abs(maxScore) * 0.7 && "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
          )}
        >
          {isNegative ? score2 : `+${score2.toFixed(1)}`}
        </Badge>
      </div>
    </div>
  );
}

// Comparison View Component
function ComparisonView({
  person1,
  person2,
  onClose,
}: {
  person1: PersonnelPerformance;
  person2: PersonnelPerformance;
  onClose: () => void;
}) {
  const m1 = person1.metrics;
  const m2 = person2.metrics;

  const isAplikasyon1 = person1.user.role === 'aplikasyon';
  const isAplikasyon2 = person2.user.role === 'aplikasyon';

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-6 w-6" />
            Personel Karşılaştırması
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-1" />
            Karşılaştırmayı Kapat
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Header with names and scores */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Person 1 */}
          <div className={cn(
            "p-4 rounded-xl border-l-4 flex items-center gap-4",
            isAplikasyon1 ? "border-l-purple-500 bg-purple-50/50 dark:bg-purple-950/20" : "border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
          )}>
            <LargeScoreCircle score={m1.totalScore} />
            <div>
              <h3 className="text-xl font-bold">{person1.user.name || person1.user.email}</h3>
              {isAplikasyon1 ? (
                <Badge variant="outline" className="bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                  <FlaskConical className="h-3 w-3 mr-1" />
                  Aplikasyon
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  <Wrench className="h-3 w-3 mr-1" />
                  Teknik Servis
                </Badge>
              )}
            </div>
          </div>

          {/* Person 2 */}
          <div className={cn(
            "p-4 rounded-xl border-l-4 flex items-center gap-4",
            isAplikasyon2 ? "border-l-purple-500 bg-purple-50/50 dark:bg-purple-950/20" : "border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
          )}>
            <LargeScoreCircle score={m2.totalScore} />
            <div>
              <h3 className="text-xl font-bold">{person2.user.name || person2.user.email}</h3>
              {isAplikasyon2 ? (
                <Badge variant="outline" className="bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                  <FlaskConical className="h-3 w-3 mr-1" />
                  Aplikasyon
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  <Wrench className="h-3 w-3 mr-1" />
                  Teknik Servis
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Comparison metrics */}
        <div className="space-y-3">
          <ComparisonMetricRow
            icon={TrendingUp}
            label="Arıza Üstlenme"
            value1={`${m1.faultsAssigned} / ${m1.expectedFaults > 0 ? m1.expectedFaults.toFixed(1) : m1.avgFaultsAssignedForRole.toFixed(1)}`}
            value2={`${m2.faultsAssigned} / ${m2.expectedFaults > 0 ? m2.expectedFaults.toFixed(1) : m2.avgFaultsAssignedForRole.toFixed(1)}`}
            score1={m1.faultAssignmentScore}
            score2={m2.faultAssignmentScore}
            maxScore={30}
          />
          <ComparisonMetricRow
            icon={Clock}
            label="Müdahale Başlatma"
            value1={formatDuration(m1.avgInterventionStartTimeMinutes)}
            value2={formatDuration(m2.avgInterventionStartTimeMinutes)}
            score1={m1.interventionTimeScore}
            score2={m2.interventionTimeScore}
            maxScore={10}
          />
          <ComparisonMetricRow
            icon={CheckCircle}
            label="Çözüm Süresi"
            value1={formatDuration(m1.avgResolutionTimeMinutes)}
            value2={formatDuration(m2.avgResolutionTimeMinutes)}
            score1={m1.resolutionTimeScore}
            score2={m2.resolutionTimeScore}
            maxScore={15}
          />
          <ComparisonMetricRow
            icon={Building}
            label="Kurum Ziyareti"
            value1={`${m1.institutionVisits} ziyaret`}
            value2={`${m2.institutionVisits} ziyaret`}
            score1={m1.visitFrequencyScore}
            score2={m2.visitFrequencyScore}
            maxScore={10}
          />
          <ComparisonMetricRow
            icon={Phone}
            label="Kurumda Müdahale"
            value1={`${m1.onsiteInterventions} / ${m1.onsiteInterventions + m1.phoneInterventions}`}
            value2={`${m2.onsiteInterventions} / ${m2.onsiteInterventions + m2.phoneInterventions}`}
            score1={m1.onsiteRatioScore}
            score2={m2.onsiteRatioScore}
            maxScore={10}
          />
          <ComparisonMetricRow
            icon={Calendar}
            label="Periyodik Bakım"
            value1={`${m1.periodicMaintenanceForms} / ${m1.totalPeriodicMaintenanceForms}`}
            value2={`${m2.periodicMaintenanceForms} / ${m2.totalPeriodicMaintenanceForms}`}
            score1={m1.maintenanceContributionScore}
            score2={m2.maintenanceContributionScore}
            maxScore={15}
          />
          <ComparisonMetricRow
            icon={HeartHandshake}
            label="Destek Puanı"
            value1={`${m1.supportCount} destek`}
            value2={`${m2.supportCount} destek`}
            score1={m1.supportScore}
            score2={m2.supportScore}
            maxScore={10}
          />
          <ComparisonMetricRow
            icon={AlertTriangle}
            label="Tekrar Arıza Cezası"
            value1={`${m1.recurrenceCount} adet`}
            value2={`${m2.recurrenceCount} adet`}
            score1={m1.recurrencePenalty}
            score2={m2.recurrencePenalty}
            maxScore={-10}
            higherIsBetter={false}
          />
          <ComparisonMetricRow
            icon={Timer}
            label="Gecikmiş Bakım"
            value1={`${m1.overdueMaintenanceTasks + m1.overduePeriodicParts} adet`}
            value2={`${m2.overdueMaintenanceTasks + m2.overduePeriodicParts} adet`}
            score1={m1.overduePenalty}
            score2={m2.overduePenalty}
            maxScore={-15}
            higherIsBetter={false}
          />
        </div>

        {/* Summary */}
        <div className="mt-6 p-4 rounded-xl bg-muted/50">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-3xl font-bold">{m1.totalScore.toFixed(1)}</p>
              <p className="text-sm text-muted-foreground">Toplam Puan</p>
            </div>
            <div>
              <p className="text-3xl font-bold">{m2.totalScore.toFixed(1)}</p>
              <p className="text-sm text-muted-foreground">Toplam Puan</p>
            </div>
          </div>
          <div className="mt-4 text-center">
            {Math.abs(m1.totalScore - m2.totalScore) < 0.5 ? (
              <Badge variant="secondary" className="text-lg px-4 py-1">
                <Minus className="h-4 w-4 mr-2" />
                Performanslar Eşit
              </Badge>
            ) : m1.totalScore > m2.totalScore ? (
              <Badge className="bg-green-600 text-white text-lg px-4 py-1">
                <ArrowUp className="h-4 w-4 mr-2" />
                {person1.user.name || person1.user.email} {(m1.totalScore - m2.totalScore).toFixed(1)} puan önde
              </Badge>
            ) : (
              <Badge className="bg-green-600 text-white text-lg px-4 py-1">
                <ArrowUp className="h-4 w-4 mr-2" />
                {person2.user.name || person2.user.email} {(m2.totalScore - m1.totalScore).toFixed(1)} puan önde
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PersonelIzlemPage() {
  const router = useRouter();
  const { currentUserProfile, isAdmin } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [performances, setPerformances] = useState<PersonnelPerformance[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);

  // Filter states
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>('');
  const [isFiltering, setIsFiltering] = useState(false);

  // Comparison states
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [comparePersonnelId, setComparePersonnelId] = useState<string>('');

  // Selected personnel objects
  const selectedPersonnel = useMemo(() => {
    if (!selectedPersonnelId || selectedPersonnelId === 'all') return null;
    return performances.find(p => p.user.uid === selectedPersonnelId) || null;
  }, [selectedPersonnelId, performances]);

  const comparePersonnel = useMemo(() => {
    if (!comparePersonnelId || comparePersonnelId === 'all') return null;
    return performances.find(p => p.user.uid === comparePersonnelId) || null;
  }, [comparePersonnelId, performances]);

  // Load hospitals for the dropdown
  useEffect(() => {
    const loadHospitals = async () => {
      try {
        const hospitalsSnap = await getDocs(collection(db, 'hospitals'));
        const hospitalsData = hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Hospital);
        setHospitals(hospitalsData.sort((a, b) => a.name.localeCompare(b.name, 'tr')));
      } catch (err) {
        console.error('Error loading hospitals:', err);
      }
    };
    loadHospitals();
  }, []);

  const loadPerformanceData = async (filters?: PerformanceFilters) => {
    setLoading(true);
    try {
      const data = await calculateAllPerformances(filters);
      setPerformances(data);
    } catch (err) {
      console.error('Error loading performance data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    loadPerformanceData();
  }, [isAdmin]);

  const handleApplyFilters = async () => {
    setIsFiltering(true);
    const filters: PerformanceFilters = {
      dateRange: {
        start: startDate ? new Date(startDate) : null,
        end: endDate ? new Date(endDate) : null,
      },
      selectedLaboratoryId: selectedLabId && selectedLabId !== 'all' ? selectedLabId : null,
    };
    await loadPerformanceData(filters);
    setIsFiltering(false);
  };

  const handleClearFilters = async () => {
    setStartDate('');
    setEndDate('');
    setSelectedLabId('');
    setSelectedPersonnelId('');
    setIsCompareMode(false);
    setComparePersonnelId('');
    setIsFiltering(true);
    await loadPerformanceData();
    setIsFiltering(false);
  };

  const hasActiveFilters = startDate || endDate || (selectedLabId && selectedLabId !== 'all') || (selectedPersonnelId && selectedPersonnelId !== 'all');

  const handleExportPersonnelPdf = async () => {
    if (performances.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak personel verisi yok.', variant: 'default' });
      return;
    }
    setExportLoading(true);
    try {
      const personnelData = performances.map(p => ({
        name: p.user.name || p.user.email,
        role: p.user.role === 'aplikasyon' ? 'Aplikasyon' : 'Teknik Servis',
        totalScore: Math.round(p.metrics.totalScore),
        metrics: [
          {
            label: 'Arıza Üstlenme & İş Yükü',
            value: `${p.metrics.faultsAssigned} / ${p.metrics.expectedFaults > 0 ? p.metrics.expectedFaults.toFixed(1) : p.metrics.avgFaultsAssignedForRole.toFixed(1)}`,
            score: `+${p.metrics.faultAssignmentScore.toFixed(1)}`,
            maxScore: '30',
          },
          {
            label: 'Müdahale Başlatma Süresi',
            value: formatDuration(p.metrics.avgInterventionStartTimeMinutes),
            score: `+${p.metrics.interventionTimeScore.toFixed(1)}`,
            maxScore: '10',
          },
          {
            label: 'Çözüm Süresi & Başarısı',
            value: `${formatDuration(p.metrics.avgResolutionTimeMinutes)} (${p.metrics.faultsResolved} arıza çözüldü)`,
            score: `+${p.metrics.resolutionTimeScore.toFixed(1)}`,
            maxScore: '15',
          },
          {
            label: 'Kurum Ziyareti',
            value: `${p.metrics.institutionVisits} ziyaret (ort: ${p.metrics.avgInstitutionVisits.toFixed(1)})`,
            score: `+${p.metrics.visitFrequencyScore.toFixed(1)}`,
            maxScore: '10',
          },
          {
            label: 'Kurumda Müdahale Oranı',
            value: `${p.metrics.onsiteInterventions} / ${p.metrics.onsiteInterventions + p.metrics.phoneInterventions}`,
            score: `+${p.metrics.onsiteRatioScore.toFixed(1)}`,
            maxScore: '10',
          },
          {
            label: 'Periyodik Bakım Katkısı',
            value: `${p.metrics.periodicMaintenanceForms} / ${p.metrics.totalPeriodicMaintenanceForms}`,
            score: `+${p.metrics.maintenanceContributionScore.toFixed(1)}`,
            maxScore: '15',
          },
          {
            label: 'Destek Puanı',
            value: `${p.metrics.supportCount} destek`,
            score: `+${p.metrics.supportScore.toFixed(1)}`,
            maxScore: '10',
          },
          {
            label: 'Tekrar Arıza Cezası',
            value: `${p.metrics.recurrenceCount} adet`,
            score: `${p.metrics.recurrencePenalty}`,
            maxScore: '-10',
          },
          {
            label: 'Gecikmiş Bakım Cezası',
            value: `${p.metrics.overdueMaintenanceTasks + p.metrics.overduePeriodicParts} adet`,
            score: `${p.metrics.overduePenalty}`,
            maxScore: '-15',
          },
        ],
      }));

      await exportPersonnelToPdf(personnelData, 'Personel_Performans', 'Personel Performans Raporu', toast);
    } finally {
      setExportLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Performans verileri hesaplanıyor...</span>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-bold text-destructive">Yetkisiz Erişim</h2>
        <p className="text-muted-foreground mt-2">
          Bu sayfaya sadece yöneticiler erişebilir.
        </p>
      </div>
    );
  }

  // Calculate averages
  const avgScore = performances.length > 0
    ? performances.reduce((sum, p) => sum + p.metrics.totalScore, 0) / performances.length
    : 0;

  const teknikPersonel = performances.filter(p => p.user.role === 'teknik_servis');
  const aplikasyonPersonel = performances.filter(p => p.user.role === 'aplikasyon');

  return (
    <div className="device-module-page p-4 space-y-6">
      <BackButton fallback="/cihaz-yonetimi" />

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-6 w-6" />
                Personel Performans İzleme
              </CardTitle>
              <CardDescription>
                Teknik servis ve aplikasyon personelinin performans metrikleri ve puanları
              </CardDescription>
            </div>
            <Button
              variant="secondary"
              onClick={handleExportPersonnelPdf}
              disabled={exportLoading || performances.length === 0}
            >
              {exportLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4 mr-2" />
              )}
              PDF Döküm
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filtreler</span>
              {hasActiveFilters && (
                <Badge variant="secondary" className="text-xs">Aktif</Badge>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="startDate" className="text-xs">Başlangıç Tarihi</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="endDate" className="text-xs">Bitiş Tarihi</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="laboratory" className="text-xs">Laboratuvar</Label>
                <Select value={selectedLabId} onValueChange={setSelectedLabId}>
                  <SelectTrigger id="laboratory" className="h-9">
                    <SelectValue placeholder="Tümü" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tümü</SelectItem>
                    {hospitals.map((hospital) => (
                      <SelectItem key={hospital.id} value={hospital.id}>
                        {hospital.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="personnel" className="text-xs">Personel</Label>
                <Select
                  value={selectedPersonnelId}
                  onValueChange={(value) => {
                    setSelectedPersonnelId(value);
                    if (value === 'all' || !value) {
                      setIsCompareMode(false);
                      setComparePersonnelId('');
                    }
                  }}
                >
                  <SelectTrigger id="personnel" className="h-9">
                    <SelectValue placeholder="Tümü">
                      {selectedPersonnelId && selectedPersonnelId !== 'all' ? (
                        <span className="flex items-center gap-1">
                          <UserCircle className="h-3 w-3" />
                          {performances.find(p => p.user.uid === selectedPersonnelId)?.user.name || 'Seçili'}
                        </span>
                      ) : (
                        'Tümü'
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tümü</SelectItem>
                    {performances.map((p) => (
                      <SelectItem key={p.user.uid} value={p.user.uid}>
                        <span className="flex items-center gap-2">
                          {p.user.role === 'aplikasyon' ? (
                            <FlaskConical className="h-3 w-3 text-purple-600" />
                          ) : (
                            <Wrench className="h-3 w-3 text-blue-600" />
                          )}
                          {p.user.name || p.user.email}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button
                  onClick={handleApplyFilters}
                  disabled={isFiltering || loading}
                  className="h-9 flex-1"
                >
                  {isFiltering ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Filter className="h-4 w-4 mr-1" />
                  )}
                  Uygula
                </Button>
                {hasActiveFilters && (
                  <Button
                    variant="outline"
                    onClick={handleClearFilters}
                    disabled={isFiltering || loading}
                    className="h-9"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Compare mode selector */}
            {selectedPersonnel && isCompareMode && (
              <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <GitCompare className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Karşılaştırılacak personeli seçin:</span>
                  </div>
                  <Select
                    value={comparePersonnelId}
                    onValueChange={setComparePersonnelId}
                  >
                    <SelectTrigger className="h-9 w-64">
                      <SelectValue placeholder="Personel seçin..." />
                    </SelectTrigger>
                    <SelectContent>
                      {performances
                        .filter(p => p.user.uid !== selectedPersonnelId)
                        .map((p) => (
                          <SelectItem key={p.user.uid} value={p.user.uid}>
                            <span className="flex items-center gap-2">
                              {p.user.role === 'aplikasyon' ? (
                                <FlaskConical className="h-3 w-3 text-purple-600" />
                              ) : (
                                <Wrench className="h-3 w-3 text-blue-600" />
                              )}
                              {p.user.name || p.user.email}
                              <span className="text-muted-foreground">({p.metrics.totalScore.toFixed(0)} puan)</span>
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsCompareMode(false);
                      setComparePersonnelId('');
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            {hasActiveFilters && !isCompareMode && (
              <p className="text-xs text-muted-foreground mt-2">
                {selectedPersonnelId && selectedPersonnelId !== 'all' && `${performances.find(p => p.user.uid === selectedPersonnelId)?.user.name || 'Seçili personel'} detaylı görünümde. `}
                {selectedLabId && selectedLabId !== 'all' && `Sadece "${hospitals.find(h => h.id === selectedLabId)?.name}" laboratuvarının ana sorumluları gösteriliyor. `}
                {(startDate || endDate) && `Tarih aralığı: ${startDate || '∞'} - ${endDate || '∞'}`}
              </p>
            )}
          </div>

          {/* Summary stats - only show when no single personnel selected */}
          {!selectedPersonnel && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <p className="text-3xl font-bold">{performances.length}</p>
                <p className="text-sm text-muted-foreground">Toplam Personel</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <p className="text-3xl font-bold">{avgScore.toFixed(1)}</p>
                <p className="text-sm text-muted-foreground">Ortalama Puan</p>
              </div>
              <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-center">
                <p className="text-3xl font-bold text-blue-600">{teknikPersonel.length}</p>
                <p className="text-sm text-muted-foreground">Teknik Servis</p>
              </div>
              <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-950/30 text-center">
                <p className="text-3xl font-bold text-purple-600">{aplikasyonPersonel.length}</p>
                <p className="text-sm text-muted-foreground">Aplikasyon</p>
              </div>
            </div>
          )}

          {/* Content area - changes based on selection */}
          {performances.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>Henüz personel verisi bulunamadı.</p>
            </div>
          ) : selectedPersonnel && comparePersonnel ? (
            // Comparison view - two personnel selected
            <ComparisonView
              person1={selectedPersonnel}
              person2={comparePersonnel}
              onClose={() => {
                setIsCompareMode(false);
                setComparePersonnelId('');
              }}
            />
          ) : selectedPersonnel ? (
            // Single personnel detailed view
            <DetailedKPICard
              performance={selectedPersonnel}
              onCompare={() => setIsCompareMode(true)}
              showCompareButton={!isCompareMode}
            />
          ) : (
            // All personnel grid view
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {performances.map((performance) => (
                <PersonnelCard key={performance.user.uid} performance={performance} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Algorithm explanation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Performans Hesaplama Algoritması</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Arıza Üstlenme & İş Yükü (30 puan)</p>
              <p className="text-muted-foreground">Beklenen pay karşılama (20pt) + ortalama üstü hacim bonusu (10pt)</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Müdahale Süresi (10 puan)</p>
              <p className="text-muted-foreground">Doğrusal: 0dk=10pt, 1saat=5pt, 2saat=0pt</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Çözüm Süresi & Başarısı (15 puan)</p>
              <p className="text-muted-foreground">Kalite (10pt): 0dk=10pt, 8sa=0pt. Hacim (5pt): çözüm sayısı/ort</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Kurum Ziyareti (10 puan)</p>
              <p className="text-muted-foreground">Rol ortalamasına göre: 1x ort=5pt, 2x ort=10pt</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Kurumda Müdahale (10 puan)</p>
              <p className="text-muted-foreground">Oran × 10pt, 3&apos;ten az müdahalede küçük örneklem düşürücü</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Periyodik Bakım (15 puan)</p>
              <p className="text-muted-foreground">Kişi başı beklenen pay bazlı: toplam/personel sayısı</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Destek Katkısı (10 puan)</p>
              <p className="text-muted-foreground">Arıza çözümünde destek: +2pt/destek, maks 10pt</p>
            </div>
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30">
              <p className="font-semibold text-red-600">Tekrar Arıza Cezası (-10 puan)</p>
              <p className="text-muted-foreground">7 gün içinde aynı cihazda tekrar arıza: -2pt/adet</p>
            </div>
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30">
              <p className="font-semibold text-red-600">Gecikmiş Bakım Cezası (-15 puan)</p>
              <p className="text-muted-foreground">Gecikmiş bakım ve parça değişimi: -3pt/adet</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
