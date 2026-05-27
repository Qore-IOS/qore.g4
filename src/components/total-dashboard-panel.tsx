/**
 * @fileoverview Total Dashboard Panel Component
 * @description Comprehensive dashboard for visualizing total efficiency metrics
 * across all laboratories and efficiency pools. Provides KPI cards, trend analysis,
 * comparative charts, and device fault tracking.
 * @module components/total-dashboard-panel
 * @version 1.0.0
 *
 * @features
 * - Multi-pool efficiency overview with KPI cards
 * - Period-based filtering (last 6 months default)
 * - Pool and laboratory filtering
 * - Stock accuracy and kit efficiency visualization
 * - Cost and profit analysis with multi-currency support
 * - Device fault tracking integration
 * - Lab performance ranking
 * - Trend indicators for efficiency changes
 *
 * @accessibility
 * - ARIA labels for all interactive elements
 * - Screen reader compatible data visualization
 * - Keyboard accessible filters and controls
 * - Semantic HTML structure
 */

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs, query, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { totalVerimlilikLogger } from '@/lib/logger';
import type { Hospital, EfficiencyPool, DeviceFaultReport } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { getExchangeRates } from '@/lib/exchange-rates';
import { calculateEfficiencyMetrics } from '@/lib/verimlilik/validation';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  Package,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BarChart3,
  PieChart,
  Target,
  Zap,
  Building2,
  Calendar,
  Filter,
  ChevronDown,
  ChevronUp,
  Award,
  AlertCircle,
  Layers,
  FlaskConical,
  Coins,
  Percent,
  Box,
  LineChart as LineChartIcon,
  Wrench,
  AlertOctagon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LabSelector } from '@/components/common/LabSelector';
import { cn } from '@/lib/utils';

// Types
interface EfficiencyRecord {
  id: string;
  poolId: string;
  poolName: string;
  month: number;
  year: number;
  efficiencyMetrics?: {
    toplamKumulatif: number;
    toplamBeklenenTuketim: number;
    toplamHakEdis: number;
    stokSapmaYuzde: number;
    kitSapmaYuzde: number;
    stokDogrulukSkoru: number;
    kitVerimlilikSkoru: number;
    genelVerimlilik: number;
    toplamEtkiDegeri?: number;
    maliyetAgirlikli?: boolean;
    hesaplananSatirSayisi?: number;
    hakEdisVerisiGirildi?: boolean;
    algoritma?: 'value-impact-efficiency-index';
  };
  rows?: any[];
  isAraKayit?: boolean;
  createdAt?: any;
}

interface TotalDashboardPanelProps {
  hospitals: Hospital[];
}

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' })
}));

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

// Neumorphic card component
const NeumorphicCard = ({
  children,
  className = '',
  gradient = false,
  hover = true,
  glow = false
}: {
  children: React.ReactNode;
  className?: string;
  gradient?: boolean;
  hover?: boolean;
  glow?: boolean;
}) => (
  <div className={cn(
    // Light mode - Neumorphic
    "bg-gray-100 dark:bg-transparent",
    "rounded-2xl",
    // Neumorphic shadow for light mode
    "shadow-[8px_8px_16px_#d1d5db,-8px_-8px_16px_#ffffff]",
    // Dark mode - Glassmorphic
    "dark:bg-gradient-to-br dark:from-white/10 dark:to-white/5",
    "dark:backdrop-blur-xl dark:border dark:border-white/20",
    "dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)]",
    // Transitions
    hover && "transition-all duration-300",
    hover && "hover:shadow-[12px_12px_24px_#d1d5db,-12px_-12px_24px_#ffffff]",
    hover && "dark:hover:shadow-[0_12px_48px_rgba(0,0,0,0.4)]",
    hover && "dark:hover:border-white/30",
    // Glow effect
    glow && "dark:shadow-[0_0_30px_rgba(59,130,246,0.3)]",
    // Gradient overlay
    gradient && "relative overflow-hidden",
    className
  )}>
    {gradient && (
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent dark:from-primary/10 pointer-events-none" />
    )}
    <div className="relative z-10">
      {children}
    </div>
  </div>
);

// KPI Card Component - Mobile Responsive
const KPICard = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  color = 'blue',
  size = 'default'
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  color?: 'blue' | 'green' | 'red' | 'amber' | 'purple' | 'emerald' | 'sky' | 'rose' | 'orange';
  size?: 'default' | 'large';
}) => {
  const colorClasses = {
    blue: 'text-blue-500 dark:text-blue-400 bg-blue-500/10 dark:bg-blue-500/20',
    green: 'text-green-500 dark:text-green-400 bg-green-500/10 dark:bg-green-500/20',
    red: 'text-red-500 dark:text-red-400 bg-red-500/10 dark:bg-red-500/20',
    amber: 'text-amber-500 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-500/20',
    purple: 'text-purple-500 dark:text-purple-400 bg-purple-500/10 dark:bg-purple-500/20',
    emerald: 'text-emerald-500 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-500/20',
    sky: 'text-sky-500 dark:text-sky-400 bg-sky-500/10 dark:bg-sky-500/20',
    rose: 'text-rose-500 dark:text-rose-400 bg-rose-500/10 dark:bg-rose-500/20',
    orange: 'text-orange-500 dark:text-orange-400 bg-orange-500/10 dark:bg-orange-500/20',
  };

  return (
    <NeumorphicCard className={cn(
      // Responsive padding: smaller on mobile, larger on desktop
      "p-3 sm:p-4 md:p-5",
      size === 'large' && "md:p-6",
      "kpi-card"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-0.5 sm:mb-1 truncate">{title}</p>
          <p className={cn(
            "font-bold tracking-tight",
            // Responsive text size
            size === 'large'
              ? "text-xl sm:text-2xl md:text-3xl"
              : "text-lg sm:text-xl md:text-2xl"
          )}>
            {value}
          </p>
          {subtitle && (
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 truncate">{subtitle}</p>
          )}
          {trend && trendValue && (
            <div className={cn(
              "flex items-center gap-1 mt-1 sm:mt-2 text-xs sm:text-sm font-medium",
              trend === 'up' && "text-green-500",
              trend === 'down' && "text-red-500",
              trend === 'neutral' && "text-muted-foreground"
            )}>
              {trend === 'up' && <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4" />}
              {trend === 'down' && <TrendingDown className="h-3 w-3 sm:h-4 sm:w-4" />}
              <span className="truncate">{trendValue}</span>
            </div>
          )}
        </div>
        <div className={cn(
          // Responsive icon container padding
          "p-2 sm:p-2.5 md:p-3 rounded-lg sm:rounded-xl flex-shrink-0",
          colorClasses[color]
        )}>
          <Icon className={cn(
            // Responsive icon size
            size === 'large'
              ? "h-5 w-5 sm:h-6 sm:w-6 md:h-7 md:w-7"
              : "h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6"
          )} />
        </div>
      </div>
    </NeumorphicCard>
  );
};

// Circular Progress Component
const CircularProgress = ({
  value,
  size = 120,
  strokeWidth = 10,
  color = 'blue',
  label,
  sublabel
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple';
  label?: string;
  sublabel?: string;
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  const colorClasses = {
    blue: 'stroke-blue-500 dark:stroke-blue-400',
    green: 'stroke-green-500 dark:stroke-green-400',
    amber: 'stroke-amber-500 dark:stroke-amber-400',
    red: 'stroke-red-500 dark:stroke-red-400',
    purple: 'stroke-purple-500 dark:stroke-purple-400',
  };

  const getColor = (val: number) => {
    if (val >= 90) return 'green';
    if (val >= 70) return 'amber';
    if (val >= 50) return 'amber';
    return 'red';
  };

  const actualColor = color === 'blue' ? getColor(value) : color;

  return (
    <div className="flex flex-col items-center">
      <div className="relative p-3" style={{ width: size + 24, height: size + 24 }}>
        <svg
          className="transform -rotate-90 overflow-visible"
          width={size}
          height={size}
          style={{ margin: 12 }}
          viewBox={`0 0 ${size} ${size}`}
        >
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-gray-200 dark:text-white/10"
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={cn(colorClasses[actualColor], "transition-all duration-700 ease-out")}
            style={{
              filter: 'drop-shadow(0 0 8px currentColor)',
            }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn(
            "text-2xl font-bold",
            actualColor === 'green' && "text-green-600 dark:text-green-400",
            actualColor === 'amber' && "text-amber-600 dark:text-amber-400",
            actualColor === 'red' && "text-red-600 dark:text-red-400",
            actualColor === 'purple' && "text-purple-600 dark:text-purple-400"
          )}>
            %{value.toFixed(1)}
          </span>
          {sublabel && (
            <span className="text-xs text-muted-foreground">{sublabel}</span>
          )}
        </div>
      </div>
      {label && (
        <span className="mt-2 text-sm font-medium text-center">{label}</span>
      )}
    </div>
  );
};

// Mini Bar Chart Component
const MiniBarChart = ({
  data,
  height = 100,
  color = 'blue'
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: 'blue' | 'green' | 'amber' | 'purple';
}) => {
  const maxValue = Math.max(...data.map(d => d.value), 1);

  const colorClasses = {
    blue: 'bg-blue-500 dark:bg-blue-400',
    green: 'bg-green-500 dark:bg-green-400',
    amber: 'bg-amber-500 dark:bg-amber-400',
    purple: 'bg-purple-500 dark:bg-purple-400',
  };

  return (
    <div className="flex items-end justify-between gap-2" style={{ height }}>
      {data.map((item, index) => (
        <div key={index} className="flex-1 flex flex-col items-center gap-1">
          <div
            className={cn(
              "w-full rounded-t-md transition-all duration-500",
              colorClasses[color],
              "shadow-lg"
            )}
            style={{
              height: `${(item.value / maxValue) * (height - 24)}px`,
              minHeight: item.value > 0 ? 4 : 0,
            }}
          />
          <span className="text-[10px] text-muted-foreground truncate max-w-full">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
};

// Trend Line Component
const TrendLine = ({
  data,
  height = 60,
  color = 'blue'
}: {
  data: number[];
  height?: number;
  color?: 'blue' | 'green' | 'amber';
}) => {
  if (data.length < 2) return null;

  const maxValue = Math.max(...data, 1);
  const minValue = Math.min(...data, 0);
  const range = maxValue - minValue || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = ((maxValue - value) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const colorClasses = {
    blue: 'stroke-blue-500 dark:stroke-blue-400',
    green: 'stroke-green-500 dark:stroke-green-400',
    amber: 'stroke-amber-500 dark:stroke-amber-400',
  };

  return (
    <svg width="100%" height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(colorClasses[color])}
        style={{
          filter: 'drop-shadow(0 2px 4px currentColor)',
        }}
      />
      {/* Dots */}
      {data.map((value, index) => {
        const x = (index / (data.length - 1)) * 100;
        const y = ((maxValue - value) / range) * height;
        return (
          <circle
            key={index}
            cx={`${x}%`}
            cy={y}
            r="4"
            className={cn("fill-current", colorClasses[color].replace('stroke-', 'text-'))}
          />
        );
      })}
    </svg>
  );
};

// Alert Card Component
const AlertCard = ({
  type,
  title,
  message,
  count
}: {
  type: 'warning' | 'error' | 'success' | 'info';
  title: string;
  message: string;
  count?: number;
}) => {
  const styles = {
    warning: {
      bg: 'bg-amber-50 dark:bg-amber-500/10',
      border: 'border-amber-200 dark:border-amber-500/30',
      icon: AlertTriangle,
      iconColor: 'text-amber-500',
    },
    error: {
      bg: 'bg-red-50 dark:bg-red-500/10',
      border: 'border-red-200 dark:border-red-500/30',
      icon: XCircle,
      iconColor: 'text-red-500',
    },
    success: {
      bg: 'bg-green-50 dark:bg-green-500/10',
      border: 'border-green-200 dark:border-green-500/30',
      icon: CheckCircle2,
      iconColor: 'text-green-500',
    },
    info: {
      bg: 'bg-blue-50 dark:bg-blue-500/10',
      border: 'border-blue-200 dark:border-blue-500/30',
      icon: AlertCircle,
      iconColor: 'text-blue-500',
    },
  };

  const style = styles[type];
  const Icon = style.icon;

  return (
    <div className={cn(
      "flex items-start gap-3 p-4 rounded-xl border",
      style.bg,
      style.border
    )}>
      <Icon className={cn("h-5 w-5 mt-0.5 flex-shrink-0", style.iconColor)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-sm">{title}</p>
          {count !== undefined && (
            <Badge variant="secondary" className="text-xs">
              {count}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{message}</p>
      </div>
    </div>
  );
};

// Pool Rank Card
const PoolRankCard = ({
  rank,
  poolName,
  score,
  trend
}: {
  rank: number;
  poolName: string;
  score: number;
  trend?: 'up' | 'down' | 'same';
}) => {
  const getRankColor = (r: number) => {
    if (r === 1) return 'text-amber-500 bg-amber-500/10';
    if (r === 2) return 'text-gray-400 bg-gray-400/10';
    if (r === 3) return 'text-orange-600 bg-orange-600/10';
    return 'text-muted-foreground bg-muted';
  };

  const getScoreColor = (s: number) => {
    if (s >= 90) return 'text-green-500';
    if (s >= 70) return 'text-amber-500';
    return 'text-red-500';
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
        getRankColor(rank)
      )}>
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{poolName}</p>
      </div>
      <div className="flex items-center gap-2">
        {trend && (
          <span className={cn(
            "text-xs",
            trend === 'up' && "text-green-500",
            trend === 'down' && "text-red-500",
            trend === 'same' && "text-muted-foreground"
          )}>
            {trend === 'up' && <TrendingUp className="h-4 w-4" />}
            {trend === 'down' && <TrendingDown className="h-4 w-4" />}
            {trend === 'same' && <span>-</span>}
          </span>
        )}
        <span className={cn("font-bold", getScoreColor(score))}>
          %{score.toFixed(1)}
        </span>
      </div>
    </div>
  );
};

export default function TotalDashboardPanel({ hospitals }: TotalDashboardPanelProps) {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  // State
  const [isLoading, setIsLoading] = useState(true);
  const [efficiencyPools, setEfficiencyPools] = useState<EfficiencyPool[]>([]);
  const [efficiencyRecords, setEfficiencyRecords] = useState<EfficiencyRecord[]>([]);
  const [deviceFaults, setDeviceFaults] = useState<DeviceFaultReport[]>([]);

  // Filters
  const [selectedPoolId, setSelectedPoolId] = useState<string>('all');
  const [selectedLabId, setSelectedLabId] = useState<string>('all');
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Exchange rates for currency display
  const [exchangeRates, setExchangeRates] = useState<{ EUR: number; USD: number; TRY: number } | null>(null);
  const [displayCurrency, setDisplayCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');

  // Get last 6 months
  const last6Months = useMemo(() => {
    const months: { year: number; month: number; key: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        year: date.getFullYear(),
        month: date.getMonth(),
        key: `${date.getFullYear()}-${date.getMonth()}`,
        label: `${MONTHS[date.getMonth()].label} ${date.getFullYear()}`
      });
    }
    return months;
  }, []);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch efficiency pools
        const poolsSnap = await getDocs(
          scopedQuery('efficiencyPools', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc'))
        );
        const pools = poolsSnap.docs.map(d => ({ id: d.id, ...d.data() } as EfficiencyPool));
        setEfficiencyPools(pools);

        // Fetch all efficiency records (without compound index - sort in JS)
        const recordsSnap = await getDocs(scopedQuery('totalEfficiencyRecords', currentCompanyId, isSuperAdmin));
        const records = recordsSnap.docs
          .map(d => {
            const data = d.data();
            return {
              id: d.id,
              ...data,
              efficiencyMetrics: data.rows?.length && data.efficiencyMetrics?.hakEdisVerisiGirildi === undefined
                ? calculateEfficiencyMetrics(data.rows)
                : data.efficiencyMetrics || (data.rows?.length ? calculateEfficiencyMetrics(data.rows) : undefined),
              isAraKayit: data.isAraKayit === true,
            } as EfficiencyRecord;
          })
          .sort((a, b) => {
            // Sort by year desc, then month desc
            if (b.year !== a.year) return b.year - a.year;
            return b.month - a.month;
          });
        setEfficiencyRecords(records);

        // Fetch device fault reports
        const faultsSnap = await getDocs(
          scopedQuery('deviceFaultReports', currentCompanyId, isSuperAdmin, orderBy('openedAt', 'desc'))
        );
        const faults = faultsSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            openedAt: data.openedAt?.toDate?.() || null,
            closedAt: data.closedAt?.toDate?.() || null,
          } as DeviceFaultReport;
        });
        setDeviceFaults(faults);

        // Set default periods to last 6 months
        const defaultPeriods = new Set(last6Months.map(m => m.key));
        setSelectedPeriods(defaultPeriods);

      } catch (error) {
        totalVerimlilikLogger.error('Dashboard verileri yüklenirken hata oluştu', error);
        toast({ title: 'Hata', description: 'Veriler yüklenirken hata oluştu.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [toast, last6Months]);

  // Fetch exchange rates
  useEffect(() => {
    const fetchRates = async () => {
      try {
        setExchangeRates(await getExchangeRates());
      } catch (e) {
        setExchangeRates({ EUR: 1, USD: 1.08, TRY: 38.5 });
      }
    };
    fetchRates();
  }, []);

  // Filter records based on selection
  const filteredRecords = useMemo(() => {
    let filtered = efficiencyRecords;

    // Filter by pool
    if (selectedPoolId !== 'all') {
      filtered = filtered.filter(r => r.poolId === selectedPoolId);
    }

    // Filter by periods
    if (selectedPeriods.size > 0) {
      filtered = filtered.filter(r => selectedPeriods.has(`${r.year}-${r.month}`));
    }

    return filtered;
  }, [efficiencyRecords, selectedPoolId, selectedPeriods]);

  // Get lab IDs for selected pool
  const selectedPoolLabIds = useMemo(() => {
    if (selectedPoolId === 'all') {
      // All labs from all pools
      const allLabIds = new Set<string>();
      efficiencyPools.forEach(pool => {
        pool.memberIds.forEach(id => allLabIds.add(id));
      });
      return allLabIds;
    }
    const pool = efficiencyPools.find(p => p.id === selectedPoolId);
    return new Set(pool?.memberIds || []);
  }, [selectedPoolId, efficiencyPools]);

  // Filter and calculate fault metrics
  const faultMetrics = useMemo(() => {
    // Filter faults by lab and period
    const filteredFaults = deviceFaults.filter(fault => {
      // Filter by lab
      if (selectedLabId !== 'all') {
        if (fault.labId !== selectedLabId) return false;
      } else if (selectedPoolLabIds.size > 0) {
        if (!selectedPoolLabIds.has(fault.labId)) return false;
      }

      // Filter by period
      if (selectedPeriods.size > 0 && fault.openedAt) {
        const faultDate = new Date(fault.openedAt);
        const faultKey = `${faultDate.getFullYear()}-${faultDate.getMonth()}`;
        if (!selectedPeriods.has(faultKey)) return false;
      }

      return true;
    });

    // Calculate monthly fault counts
    const monthlyFaults: Record<string, { open: number; closed: number; total: number }> = {};

    // Initialize with last 6 months
    last6Months.forEach(m => {
      monthlyFaults[m.key] = { open: 0, closed: 0, total: 0 };
    });

    filteredFaults.forEach(fault => {
      if (!fault.openedAt) return;
      const faultDate = new Date(fault.openedAt);
      const key = `${faultDate.getFullYear()}-${faultDate.getMonth()}`;

      if (monthlyFaults[key]) {
        monthlyFaults[key].total++;
        if (fault.status === 'open') {
          monthlyFaults[key].open++;
        } else {
          monthlyFaults[key].closed++;
        }
      }
    });

    // Convert to array for chart
    const monthlyData = last6Months.map(m => ({
      month: m.label.split(' ')[0].substring(0, 3),
      fullLabel: m.label,
      open: monthlyFaults[m.key]?.open || 0,
      closed: monthlyFaults[m.key]?.closed || 0,
      total: monthlyFaults[m.key]?.total || 0,
    })).reverse();

    // Calculate totals
    const totalFaults = filteredFaults.length;
    const openFaults = filteredFaults.filter(f => f.status === 'open').length;
    const closedFaults = filteredFaults.filter(f => f.status === 'closed').length;

    // By type
    const teknikServisFaults = filteredFaults.filter(f => f.faultType === 'teknik_servis').length;
    const aplikasyonFaults = filteredFaults.filter(f => f.faultType === 'aplikasyon').length;

    return {
      totalFaults,
      openFaults,
      closedFaults,
      teknikServisFaults,
      aplikasyonFaults,
      monthlyData,
      closeRate: totalFaults > 0 ? (closedFaults / totalFaults) * 100 : 0,
    };
  }, [deviceFaults, selectedPoolLabIds, selectedLabId, selectedPeriods, last6Months]);

  // Calculate aggregated metrics
  const metrics = useMemo(() => {
    if (filteredRecords.length === 0) {
      return {
        genelVerimlilik: 0,
        stokDogruluk: 0,
        kitVerimlilik: 0,
        toplamTest: 0,
        toplamMaliyet: 0,
        toplamHakEdisKarsiligi: 0,
        netKar: 0,
        karMarji: 0,
        toplamKutuKayip: 0,
        aktifHavuz: 0,
        aktifLab: new Set<string>(),
        poolScores: [] as { poolId: string; poolName: string; score: number }[],
        monthlyTrend: [] as { month: string; score: number }[],
        alerts: [] as { type: 'warning' | 'error' | 'success' | 'info'; title: string; message: string; count?: number }[],
        dataGaps: [] as string[],
      };
    }

    let totalVerimlilik = 0;
    let totalStokDogruluk = 0;
    let totalKitVerimlilik = 0;
    let totalKumulatif = 0;
    let totalMaliyet = 0;
    let totalHakEdis = 0;
    let totalKutuKayip = 0;
    let recordsWithMetrics = 0;
    const activeLabIds = new Set<string>();
    const poolMetrics: Record<string, { total: number; count: number; name: string }> = {};
    const monthlyMetrics: Record<string, { total: number; count: number }> = {};

    filteredRecords.forEach(record => {
      if (record.efficiencyMetrics) {
        const m = record.efficiencyMetrics;
        totalVerimlilik += m.genelVerimlilik || 0;
        totalStokDogruluk += m.stokDogrulukSkoru || 0;
        totalKitVerimlilik += m.kitVerimlilikSkoru || 0;
        totalKumulatif += m.toplamKumulatif || 0;
        totalHakEdis += m.toplamHakEdis || 0;
        recordsWithMetrics++;

        // Pool metrics
        if (!poolMetrics[record.poolId]) {
          poolMetrics[record.poolId] = { total: 0, count: 0, name: record.poolName };
        }
        poolMetrics[record.poolId].total += m.genelVerimlilik || 0;
        poolMetrics[record.poolId].count++;

        // Monthly metrics
        const monthKey = `${record.year}-${record.month}`;
        if (!monthlyMetrics[monthKey]) {
          monthlyMetrics[monthKey] = { total: 0, count: 0 };
        }
        monthlyMetrics[monthKey].total += m.genelVerimlilik || 0;
        monthlyMetrics[monthKey].count++;
      }

      // Calculate costs and kutu kayip from rows
      if (record.rows) {
        record.rows.forEach((row: any) => {
          if (row.labId) activeLabIds.add(row.labId);

          // Calculate kutu kayip
          const testFark = (row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest) - row.kumulatifTotal;
          const kutuKayip = testFark / (row.ambalajDegeri || 1);
          if (Math.abs(kutuKayip) >= 1) {
            totalKutuKayip += kutuKayip;
          }
        });
      }
    });

    // Calculate pool scores
    const poolScores = Object.entries(poolMetrics)
      .map(([poolId, data]) => ({
        poolId,
        poolName: data.name,
        score: data.count > 0 ? data.total / data.count : 0
      }))
      .sort((a, b) => b.score - a.score);

    // Calculate monthly trend
    const monthlyTrend = last6Months
      .map(m => ({
        month: m.label.split(' ')[0].substring(0, 3),
        score: monthlyMetrics[m.key]?.count > 0
          ? monthlyMetrics[m.key].total / monthlyMetrics[m.key].count
          : 0
      }))
      .reverse();

    // Generate alerts
    const alerts: { type: 'warning' | 'error' | 'success' | 'info'; title: string; message: string; count?: number }[] = [];

    const avgVerimlilik = recordsWithMetrics > 0 ? totalVerimlilik / recordsWithMetrics : 0;

    if (avgVerimlilik < 70) {
      alerts.push({
        type: 'error',
        title: 'Kritik Verimlilik',
        message: 'Genel verimlilik %70 altında',
      });
    } else if (avgVerimlilik >= 90) {
      alerts.push({
        type: 'success',
        title: 'Mükemmel Performans',
        message: 'Genel verimlilik %90 üzerinde',
      });
    }

    const lowPerformancePools = poolScores.filter(p => p.score < 70 && p.score > 0);
    if (lowPerformancePools.length > 0) {
      alerts.push({
        type: 'warning',
        title: 'Düşük Performanslı Havuzlar',
        message: `${lowPerformancePools.map(p => p.poolName).join(', ')} havuzları iyileştirme gerektiriyor`,
        count: lowPerformancePools.length,
      });
    }

    // Check for data gaps
    const dataGaps: string[] = [];
    last6Months.forEach(m => {
      const hasData = filteredRecords.some(r => r.year === m.year && r.month === m.month);
      if (!hasData) {
        dataGaps.push(m.label);
      }
    });

    if (dataGaps.length > 0) {
      alerts.push({
        type: 'info',
        title: 'Eksik Dönemler',
        message: `${dataGaps.slice(0, 2).join(', ')}${dataGaps.length > 2 ? ` ve ${dataGaps.length - 2} dönem daha` : ''} için veri yok`,
        count: dataGaps.length,
      });
    }

    return {
      genelVerimlilik: recordsWithMetrics > 0 ? totalVerimlilik / recordsWithMetrics : 0,
      stokDogruluk: recordsWithMetrics > 0 ? totalStokDogruluk / recordsWithMetrics : 0,
      kitVerimlilik: recordsWithMetrics > 0 ? totalKitVerimlilik / recordsWithMetrics : 0,
      toplamTest: totalKumulatif,
      toplamMaliyet: totalMaliyet,
      toplamHakEdisKarsiligi: totalHakEdis,
      netKar: totalHakEdis - totalMaliyet,
      karMarji: totalHakEdis > 0 ? ((totalHakEdis - totalMaliyet) / totalHakEdis) * 100 : 0,
      toplamKutuKayip: totalKutuKayip,
      aktifHavuz: new Set(filteredRecords.map(r => r.poolId)).size,
      aktifLab: activeLabIds,
      poolScores,
      monthlyTrend,
      alerts,
      dataGaps,
    };
  }, [filteredRecords, last6Months]);

  // Get labs for selected pool
  const poolLabs = useMemo(() => {
    if (selectedPoolId === 'all') return hospitals;
    const pool = efficiencyPools.find(p => p.id === selectedPoolId);
    if (!pool) return [];
    return hospitals.filter(h => pool.memberIds.includes(h.id));
  }, [selectedPoolId, efficiencyPools, hospitals]);

  // Toggle period selection
  const togglePeriod = useCallback((key: string) => {
    setSelectedPeriods(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  }, []);

  // Select all / none periods
  const selectAllPeriods = useCallback(() => {
    setSelectedPeriods(new Set(last6Months.map(m => m.key)));
  }, [last6Months]);

  const clearPeriods = useCallback(() => {
    setSelectedPeriods(new Set());
  }, []);

  // Currency formatter
  const formatCurrency = useCallback((value: number) => {
    const symbol = displayCurrency === 'TRY' ? '₺' : displayCurrency === 'USD' ? '$' : '€';
    return `${symbol}${value.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }, [displayCurrency]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96" role="status" aria-label="Yükleniyor">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" aria-hidden="true" />
          <p className="text-muted-foreground">Dashboard yükleniyor...</p>
          <span className="sr-only">Dashboard verileri yükleniyor, lütfen bekleyin</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-50 dark:bg-gray-950" role="main" aria-label="Total Dashboard">
      <BackButton fallback="/total-verimlilik" />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <BarChart3 className="h-8 w-8 text-primary" />
            </div>
            Total Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Verimlilik havuzlarının genel performans analizi
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap" role="group" aria-label="Dashboard filtreleri">
          {/* Pool Filter */}
          <Select value={selectedPoolId} onValueChange={setSelectedPoolId}>
            <SelectTrigger className="w-[200px] bg-background" aria-label="Verimlilik havuzu seçin">
              <Layers className="h-4 w-4 mr-2 text-muted-foreground" aria-hidden="true" />
              <SelectValue placeholder="Havuz seçin..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm Havuzlar</SelectItem>
              {efficiencyPools.map(pool => (
                <SelectItem key={pool.id} value={pool.id}>{pool.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Lab Filter */}
          <div className="w-[220px]">
            <LabSelector
              ariaLabel="Laboratuvar seçin"
              labs={poolLabs.map(l => ({ id: l.id, name: l.name, kod: l.kod }))}
              value={selectedLabId}
              onChange={setSelectedLabId}
              placeholder="Laboratuvar seçin..."
              allOption={{ value: 'all', label: 'Tüm Laboratuvarlar' }}
              icon={<FlaskConical className="h-4 w-4" />}
            />
          </div>

          {/* Period Filter */}
          <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2" aria-label={`Dönem filtresi, ${selectedPeriods.size} dönem seçili`} aria-expanded={isFilterOpen}>
                <Calendar className="h-4 w-4" aria-hidden="true" />
                Dönem ({selectedPeriods.size})
                {isFilterOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" align="end">
              <div className="space-y-4" role="group" aria-label="Dönem seçim paneli">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium" id="period-selection-title">Dönem Seçimi</h4>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={selectAllPeriods} aria-label="Tüm dönemleri seç">Tümü</Button>
                    <Button variant="ghost" size="sm" onClick={clearPeriods} aria-label="Seçimleri temizle">Temizle</Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {last6Months.map(month => (
                    <div key={month.key} className="flex items-center gap-2">
                      <Checkbox
                        id={month.key}
                        checked={selectedPeriods.has(month.key)}
                        onCheckedChange={() => togglePeriod(month.key)}
                      />
                      <Label htmlFor={month.key} className="text-sm cursor-pointer">
                        {month.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Main Efficiency Score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <NeumorphicCard className="lg:col-span-1 p-6" gradient glow>
          <div className="flex flex-col items-center">
            <h3 className="text-lg font-semibold mb-4">Genel Verimlilik</h3>
            <CircularProgress
              value={metrics.genelVerimlilik}
              size={180}
              strokeWidth={14}
              sublabel="Ortalama"
            />
            <div className="grid grid-cols-2 gap-4 mt-6 w-full">
              <div className="text-center p-3 rounded-xl bg-muted/50">
                <p className="text-2xl font-bold text-blue-500">{metrics.aktifHavuz}</p>
                <p className="text-xs text-muted-foreground">Aktif Havuz</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-muted/50">
                <p className="text-2xl font-bold text-purple-500">{metrics.aktifLab.size}</p>
                <p className="text-xs text-muted-foreground">Aktif Lab</p>
              </div>
            </div>
          </div>
        </NeumorphicCard>

        <NeumorphicCard className="lg:col-span-2 p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <LineChartIcon className="h-5 w-5 text-blue-500" />
            Aylık Verimlilik Trendi
          </h3>
          <div className="h-[200px]">
            <MiniBarChart
              data={metrics.monthlyTrend.map(m => ({ label: m.month, value: m.score }))}
              height={180}
              color="blue"
            />
          </div>
        </NeumorphicCard>
      </div>

      {/* Cihaz Arızaları Grafiği */}
      <NeumorphicCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Wrench className="h-5 w-5 text-orange-500" />
            Cihaz Arızaları
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-muted-foreground">Açık ({faultMetrics.openFaults})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-muted-foreground">Kapalı ({faultMetrics.closedFaults})</span>
              </div>
            </div>
            <Badge variant="outline" className={cn(
              "font-semibold",
              faultMetrics.closeRate >= 80 ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" :
              faultMetrics.closeRate >= 50 ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" :
              "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
            )}>
              Çözüm Oranı: %{faultMetrics.closeRate.toFixed(0)}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Stacked Bar Chart */}
          <div className="lg:col-span-3">
            <div className="h-[180px] flex items-end justify-between gap-2">
              {faultMetrics.monthlyData.map((item, index) => {
                const maxTotal = Math.max(...faultMetrics.monthlyData.map(d => d.total), 1);
                const totalHeight = (item.total / maxTotal) * 150;
                const openHeight = item.total > 0 ? (item.open / item.total) * totalHeight : 0;
                const closedHeight = item.total > 0 ? (item.closed / item.total) * totalHeight : 0;

                return (
                  <div key={index} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col-reverse rounded-t-md overflow-hidden" style={{ height: totalHeight || 4 }}>
                      {item.total > 0 ? (
                        <>
                          <div
                            className="w-full bg-green-500 transition-all duration-500"
                            style={{ height: closedHeight }}
                            title={`Kapalı: ${item.closed}`}
                          />
                          <div
                            className="w-full bg-red-500 transition-all duration-500"
                            style={{ height: openHeight }}
                            title={`Açık: ${item.open}`}
                          />
                        </>
                      ) : (
                        <div className="w-full bg-gray-200 dark:bg-gray-700 h-1" />
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{item.month}</span>
                    <span className="text-xs font-medium">{item.total}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fault Summary Cards */}
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-muted/50">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Toplam Arıza</span>
                <AlertOctagon className="h-4 w-4 text-orange-500" />
              </div>
              <p className="text-2xl font-bold mt-1">{faultMetrics.totalFaults}</p>
            </div>
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50">
              <div className="flex items-center justify-between">
                <span className="text-sm text-red-600 dark:text-red-400">Açık Arıza</span>
                <XCircle className="h-4 w-4 text-red-500" />
              </div>
              <p className="text-xl font-bold text-red-600 dark:text-red-400 mt-1">{faultMetrics.openFaults}</p>
            </div>
            <div className="p-3 rounded-xl bg-green-50 dark:bg-green-950/50">
              <div className="flex items-center justify-between">
                <span className="text-sm text-green-600 dark:text-green-400">Kapalı Arıza</span>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </div>
              <p className="text-xl font-bold text-green-600 dark:text-green-400 mt-1">{faultMetrics.closedFaults}</p>
            </div>
          </div>
        </div>

        {/* Fault Type Breakdown */}
        {faultMetrics.totalFaults > 0 && (
          <div className="mt-4 pt-4 border-t border-dashed flex items-center gap-6">
            <span className="text-sm text-muted-foreground">Arıza Türü:</span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-blue-500" />
                <span className="text-sm">Teknik Servis: <strong>{faultMetrics.teknikServisFaults}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-purple-500" />
                <span className="text-sm">Aplikasyon: <strong>{faultMetrics.aplikasyonFaults}</strong></span>
              </div>
            </div>
          </div>
        )}
      </NeumorphicCard>

      {/* KPI Cards Row 1 - Verimlilik Metrikleri */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Stok Doğruluk Oranı"
          value={`%${metrics.stokDogruluk.toFixed(1)}`}
          icon={Target}
          color="blue"
          trend={metrics.stokDogruluk >= 90 ? 'up' : metrics.stokDogruluk < 70 ? 'down' : 'neutral'}
          trendValue={metrics.stokDogruluk >= 90 ? 'Hedefte' : metrics.stokDogruluk < 70 ? 'Kritik' : 'Normal'}
        />
        <KPICard
          title="Kit Verimlilik Oranı"
          value={`%${metrics.kitVerimlilik.toFixed(1)}`}
          icon={Zap}
          color="purple"
          trend={metrics.kitVerimlilik >= 90 ? 'up' : metrics.kitVerimlilik < 70 ? 'down' : 'neutral'}
          trendValue={metrics.kitVerimlilik >= 90 ? 'Hedefte' : metrics.kitVerimlilik < 70 ? 'Kritik' : 'Normal'}
        />
        <KPICard
          title="Toplam Test"
          value={metrics.toplamTest.toLocaleString('tr-TR')}
          subtitle="Kümülatif test adedi"
          icon={Activity}
          color="emerald"
        />
        <KPICard
          title="Kutu Kayıp"
          value={Math.abs(metrics.toplamKutuKayip).toFixed(1)}
          subtitle={metrics.toplamKutuKayip > 0 ? 'Fazla tüketim' : 'Tasarruf'}
          icon={Box}
          color={metrics.toplamKutuKayip > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Financial Metrics & Pool Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Financial Metrics */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          <KPICard
            title="Toplam Hak Ediş"
            value={metrics.toplamHakEdisKarsiligi.toLocaleString('tr-TR')}
            subtitle="Test adedi (Hak Ediş)"
            icon={Coins}
            color="amber"
            size="large"
          />
          <KPICard
            title="Kâr Marjı"
            value={`%${metrics.karMarji.toFixed(1)}`}
            subtitle={metrics.karMarji >= 0 ? 'Kârlı' : 'Zararlı'}
            icon={Percent}
            color={metrics.karMarji >= 0 ? 'green' : 'red'}
            size="large"
            trend={metrics.karMarji >= 20 ? 'up' : metrics.karMarji < 0 ? 'down' : 'neutral'}
            trendValue={metrics.karMarji >= 20 ? 'İyi' : metrics.karMarji < 0 ? 'Dikkat' : 'Normal'}
          />
        </div>

        {/* Pool Ranking */}
        <NeumorphicCard className="p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Award className="h-5 w-5 text-amber-500" />
            Havuz Sıralaması
          </h3>
          <div className="space-y-1">
            {metrics.poolScores.slice(0, 5).map((pool, index) => (
              <PoolRankCard
                key={pool.poolId}
                rank={index + 1}
                poolName={pool.poolName}
                score={pool.score}
              />
            ))}
            {metrics.poolScores.length === 0 && (
              <p className="text-muted-foreground text-sm text-center py-4">
                Henüz veri yok
              </p>
            )}
          </div>
        </NeumorphicCard>
      </div>

      {/* Comparison Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* En Verimli Havuz */}
        {metrics.poolScores.length > 0 && (
          <NeumorphicCard className="p-5" gradient>
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-green-500/10">
                <TrendingUp className="h-8 w-8 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">En Verimli Havuz</p>
                <p className="text-lg font-bold mt-1">{metrics.poolScores[0]?.poolName || '-'}</p>
                <p className="text-2xl font-bold text-green-500 mt-1">
                  %{(metrics.poolScores[0]?.score || 0).toFixed(1)}
                </p>
              </div>
            </div>
          </NeumorphicCard>
        )}

        {/* En Düşük Verimli Havuz */}
        {metrics.poolScores.length > 1 && (
          <NeumorphicCard className="p-5" gradient>
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-red-500/10">
                <TrendingDown className="h-8 w-8 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">İyileştirme Gereken</p>
                <p className="text-lg font-bold mt-1">
                  {metrics.poolScores[metrics.poolScores.length - 1]?.poolName || '-'}
                </p>
                <p className="text-2xl font-bold text-red-500 mt-1">
                  %{(metrics.poolScores[metrics.poolScores.length - 1]?.score || 0).toFixed(1)}
                </p>
              </div>
            </div>
          </NeumorphicCard>
        )}

        {/* Aktif Laboratuvarlar */}
        <NeumorphicCard className="p-5" gradient>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-purple-500/10">
              <Building2 className="h-8 w-8 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Aktif Laboratuvarlar</p>
              <p className="text-3xl font-bold mt-1 text-purple-500">{metrics.aktifLab.size}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Seçili dönemde veri giren
              </p>
            </div>
          </div>
        </NeumorphicCard>
      </div>

      {/* Alerts Section */}
      {metrics.alerts.length > 0 && (
        <NeumorphicCard className="p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Uyarılar ve Bildirimler
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {metrics.alerts.map((alert, index) => (
              <AlertCard
                key={index}
                type={alert.type}
                title={alert.title}
                message={alert.message}
                count={alert.count}
              />
            ))}
          </div>
        </NeumorphicCard>
      )}

      {/* Footer Info */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {filteredRecords.length} kayıt analiz edildi
        </span>
        <span>
          Son güncelleme: {new Date().toLocaleDateString('tr-TR')}
        </span>
      </div>
    </div>
  );
}
