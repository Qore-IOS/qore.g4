'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, TrendingUp, TrendingDown, Clock, Phone, Building, Wrench, FlaskConical, AlertTriangle, CheckCircle, Calendar, Package, Timer } from 'lucide-react';
import BackButton from '@/components/BackButton';
import {
  calculateAllPerformances,
  getScoreColor,
  formatDuration,
  type PersonnelPerformance,
} from '@/lib/performance-calculator';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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
                value={`${metrics.faultsAssigned} / ${metrics.expectedFaults.toFixed(1)}`}
                subValue={metrics.expectedFaults > 0
                  ? `%${((metrics.faultsAssigned / metrics.expectedFaults) * 100).toFixed(0)} beklenen`
                  : 'beklenti yok'}
                score={metrics.faultAssignmentScore}
                tooltip="Ana sorumlu olunan laboratuvarlara göre beklenen arıza sayısı ve gerçek üstlenilen. Beklenenin %100'ü = 20 puan."
              />
              <MetricItem
                icon={Clock}
                label="Müdahale Başlatma"
                value={formatDuration(metrics.avgInterventionStartTimeMinutes)}
                subValue="ortalama süre"
                score={metrics.interventionTimeScore}
                tooltip="Arıza atandıktan sonra müdahaleye başlama süresi. Hızlı başlama = yüksek puan."
              />
              <MetricItem
                icon={CheckCircle}
                label="Çözüm Süresi"
                value={formatDuration(metrics.avgResolutionTimeMinutes)}
                subValue={`${metrics.faultsResolved} arıza çözüldü`}
                score={metrics.resolutionTimeScore}
                tooltip="Müdahaleden arıza çözümüne kadar geçen süre. Hızlı çözüm = yüksek puan."
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

export default function PersonelIzlemPage() {
  const router = useRouter();
  const { currentUserProfile, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [performances, setPerformances] = useState<PersonnelPerformance[]>([]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    const loadData = async () => {
      try {
        const data = await calculateAllPerformances();
        setPerformances(data);
      } catch (err) {
        console.error('Error loading performance data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isAdmin]);

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
    <div className="p-4 space-y-6">
      <BackButton fallback="/cihaz-yonetimi" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-6 w-6" />
            Personel Performans İzleme
          </CardTitle>
          <CardDescription>
            Teknik servis ve aplikasyon personelinin performans metrikleri ve puanları
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Summary stats */}
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

          {/* Personnel cards grid */}
          {performances.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>Henüz personel verisi bulunamadı.</p>
            </div>
          ) : (
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
              <p className="font-semibold">Arıza Üstlenme (20 puan)</p>
              <p className="text-muted-foreground">Ana sorumlu laboratuvarlara göre beklenen arıza payını karşılama oranı</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Müdahale Süresi (15 puan)</p>
              <p className="text-muted-foreground">≤30dk: 15pt, ≤1sa: 12pt, ≤2sa: 9pt, ≤4sa: 6pt</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Çözüm Süresi (15 puan)</p>
              <p className="text-muted-foreground">≤1sa: 15pt, ≤2sa: 12pt, ≤4sa: 9pt, ≤8sa: 6pt</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Kurum Ziyareti (15 puan)</p>
              <p className="text-muted-foreground">Form + kurumda müdahale sayısı, ortalamaya göre</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Kurumda Müdahale (15 puan)</p>
              <p className="text-muted-foreground">Telefon vs kurumda oranı, kurumda = daha değerli</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="font-semibold">Periyodik Bakım (20 puan)</p>
              <p className="text-muted-foreground">Toplam periyodik bakım formlarındaki pay</p>
            </div>
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30">
              <p className="font-semibold text-red-600">Tekrar Arıza Cezası (-10 puan)</p>
              <p className="text-muted-foreground">7 gün içinde aynı cihazda tekrar arıza: -2pt/adet</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
