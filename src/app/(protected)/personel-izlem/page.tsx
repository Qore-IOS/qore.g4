'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import {
  Loader2, Users, TrendingUp, Clock, Phone, Building, Wrench, FlaskConical,
  AlertTriangle, CheckCircle, Calendar, Timer, UserCircle, ArrowUp, ArrowDown,
  Minus, GitCompare, FileDown, HeartHandshake, X, ChevronLeft,
} from 'lucide-react';
import {
  calculateAllPerformances,
  getScoreColor,
  formatDuration,
  type PersonnelPerformance,
  type PerformanceFilters,
} from '@/lib/performance-calculator';
import { exportPersonnelToPdf } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs } from 'firebase/firestore';
import { scopedQuery } from '@/lib/firestore-helpers';
import { db } from '@/lib/firebase';
import type { Hospital } from '@/lib/types';
import {
  ClayPage, PageHead, Card, CardHead, KpiTile, Pill, GhostBtn, Segmented,
  RoleChip, ClayLoader, C, AC, PAL, useMode, fmtInt,
} from '@/components/cihaz-yonetimi/clay-kit';

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

// ── Clay score ring (local) ─────────────────────────────────────────────────────
function scoreBand(score: number): { color: string; label: string } {
  if (score >= 85) return { color: PAL.ready, label: 'Çok İyi' };
  if (score >= 70) return { color: PAL.tech, label: 'İyi' };
  if (score >= 55) return { color: C.amber, label: 'Orta' };
  if (score >= 40) return { color: C.amber, label: 'Zayıf' };
  return { color: C.danger, label: 'Riskli' };
}

function ClayScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const { color, label } = scoreBand(score);
  const sw = size >= 140 ? 11 : 8;
  const r = (size - sw) / 2 - 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const offset = circ - pct * circ;
  const numSize = size >= 140 ? 42 : 26;
  const uid = React.useId().replace(/[:]/g, '');
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <linearGradient id={`csr${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={color + 'aa'} />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={C.surface2} strokeWidth={sw} />
        <circle
          cx={cx} cy={cx} r={r} fill="none" stroke={`url(#csr${uid})`} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 700ms ' + EASE }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <span style={{ fontSize: numSize, fontWeight: 800, lineHeight: 1, color: C.ink1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(score)}
        </span>
        <span style={{ fontSize: size >= 140 ? 12 : 10.5, fontWeight: 700, color, marginTop: 4 }}>{label}</span>
      </div>
    </div>
  );
}

// ── delta chip ──────────────────────────────────────────────────────────────────
function DeltaChip({ score }: { score: number }) {
  const neg = score < 0;
  const c = neg ? C.danger : score > 0 ? C.waterDeep : C.ink3;
  const bg = neg ? 'rgba(192,121,106,0.14)' : score > 0 ? 'rgba(111,181,133,0.14)' : C.surface2;
  return (
    <span style={{
      flexShrink: 0, padding: '3px 8px', borderRadius: C.radiusPill, background: bg, color: c,
      fontSize: 11.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
    }}>
      {neg ? score : `+${score.toFixed(1)}`}
    </span>
  );
}

// ── small clay metric sub-tile ───────────────────────────────────────────────────
function MetricTile({
  icon: Icon, label, value, subValue, score, delay = 0, emphasize = false,
}: {
  icon: React.ElementType; label: string; value: string | number; subValue?: string;
  score: number; delay?: number; emphasize?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 11px', borderRadius: C.radiusSm,
      background: emphasize ? 'rgba(192,121,106,0.08)' : C.surface2,
      boxShadow: emphasize ? 'inset 0 0 0 1.5px rgba(192,121,106,0.3)' : C.clayInset,
      animation: `cyPopIn 320ms ${EASE} ${delay}ms both`, minWidth: 0,
    }}>
      <span style={{
        width: 30, height: 30, flexShrink: 0, borderRadius: 9, display: 'grid', placeItems: 'center',
        color: emphasize ? C.danger : AC.primary, background: emphasize ? 'rgba(192,121,106,0.14)' : AC.primary + '16',
        boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)',
      }}>
        <Icon size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.ink3, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
        {subValue && <div style={{ fontSize: 10.5, fontWeight: 600, color: C.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subValue}</div>}
      </div>
      <DeltaChip score={score} />
    </div>
  );
}

function roleChipKey(role: string): 'tech' | 'app' | 'admin' {
  return role === 'aplikasyon' ? 'app' : 'tech';
}

// ── Penalty / warning strip ──────────────────────────────────────────────────────
function PenaltyStrip({ icon: Icon, label, detail, score, tone = 'danger' }: {
  icon: React.ElementType; label: string; detail: string; score: number; tone?: 'danger' | 'amber';
}) {
  const c = tone === 'danger' ? C.danger : '#9A6F1E';
  const bg = tone === 'danger' ? 'rgba(192,121,106,0.10)' : C.amberSoft;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: C.radiusSm,
      background: bg, marginTop: 8, minWidth: 0,
    }}>
      <Icon size={15} style={{ color: c, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: c }}>{label}</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: C.ink2 }}> · {detail}</span>
      </div>
      <DeltaChip score={score} />
    </div>
  );
}

// ── Personnel card ────────────────────────────────────────────────────────────────
function PersonnelCard({ performance, mode }: { performance: PersonnelPerformance; mode: string }) {
  const { user, metrics } = performance;
  const onsiteTotal = metrics.onsiteInterventions + metrics.phoneInterventions;
  const tiles: React.ReactNode[] = [
    <MetricTile key="fa" icon={TrendingUp} label="Arıza Üstlenme"
      value={`${metrics.faultsAssigned} / ${metrics.expectedFaults > 0 ? metrics.expectedFaults.toFixed(1) : metrics.avgFaultsAssignedForRole.toFixed(1)}`}
      subValue={metrics.expectedFaults > 0
        ? `%${((metrics.faultsAssigned / metrics.expectedFaults) * 100).toFixed(0)} beklenen`
        : metrics.avgFaultsAssignedForRole > 0 ? `ort: ${metrics.avgFaultsAssignedForRole.toFixed(1)}` : 'beklenti yok'}
      score={metrics.faultAssignmentScore} delay={0} />,
    <MetricTile key="it" icon={Clock} label="Müdahale Başlatma"
      value={formatDuration(metrics.avgInterventionStartTimeMinutes)} subValue="ortalama süre"
      score={metrics.interventionTimeScore} delay={40} />,
    <MetricTile key="rt" icon={CheckCircle} label="Çözüm Süresi"
      value={formatDuration(metrics.avgResolutionTimeMinutes)} subValue={`${metrics.faultsResolved} arıza çözüldü`}
      score={metrics.resolutionTimeScore} delay={80} />,
    <MetricTile key="iv" icon={Building} label="Kurum Ziyareti"
      value={`${metrics.institutionVisits} ziyaret`} subValue={`ort: ${metrics.avgInstitutionVisits.toFixed(1)}`}
      score={metrics.visitFrequencyScore} delay={120} />,
    <MetricTile key="os" icon={Phone} label="Kurumda Müdahale"
      value={`${metrics.onsiteInterventions} / ${onsiteTotal}`}
      subValue={onsiteTotal > 0 ? `%${((metrics.onsiteInterventions / onsiteTotal) * 100).toFixed(0)} kurumda` : 'veri yok'}
      score={metrics.onsiteRatioScore} delay={160} />,
    <MetricTile key="pm" icon={Calendar} label="Periyodik Bakım"
      value={`${metrics.periodicMaintenanceForms} / ${metrics.totalPeriodicMaintenanceForms}`}
      subValue={metrics.totalPeriodicMaintenanceForms > 0 ? `%${((metrics.periodicMaintenanceForms / metrics.totalPeriodicMaintenanceForms) * 100).toFixed(1)} katkı` : 'veri yok'}
      score={metrics.maintenanceContributionScore} delay={200} />,
  ];
  if (metrics.supportCount > 0) {
    tiles.push(
      <MetricTile key="sp" icon={HeartHandshake} label="Destek Puanı"
        value={`${metrics.supportCount} destek`} subValue="arıza çözümünde"
        score={metrics.supportScore} delay={240} />
    );
  }

  return (
    <Card pad={16} style={{ display: 'flex', flexDirection: 'column' }}>
      {/* top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.ink1, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.name || user.email}
          </div>
          <div style={{ marginTop: 7 }}>
            <RoleChip role={roleChipKey(user.role)} />
          </div>
        </div>
        <ClayScoreRing score={metrics.totalScore} size={mode === 'mobile' ? 86 : 96} />
      </div>

      {/* metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: mode === 'mobile' ? '1fr' : '1fr 1fr', gap: 8 }}>
        {tiles}
      </div>

      {/* penalty strips */}
      {metrics.recurrenceCount > 0 && (
        <PenaltyStrip icon={AlertTriangle} label="Tekrar Arıza"
          detail={`${metrics.recurrenceCount} adet · 3 saat içinde`} score={metrics.recurrencePenalty} tone="amber" />
      )}
      {(metrics.overdueMaintenanceTasks > 0 || metrics.overduePeriodicParts > 0) && (
        <PenaltyStrip icon={Timer} label="Gecikmiş Bakım"
          detail={`${metrics.overdueMaintenanceTasks} iş · ${metrics.overduePeriodicParts} parça`} score={metrics.overduePenalty} tone="danger" />
      )}
    </Card>
  );
}

// ── List view row ─────────────────────────────────────────────────────────────────
function ListRow({ performance, mode }: { performance: PersonnelPerformance; mode: string }) {
  const { user, metrics } = performance;
  const { color, label } = scoreBand(metrics.totalScore);
  return (
    <div className="cy-row-hover" style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: C.radiusSm,
      background: C.surface2, boxShadow: C.clayInset, minWidth: 0, flexWrap: mode === 'mobile' ? 'wrap' : 'nowrap',
    }}>
      <div style={{
        width: 46, height: 46, flexShrink: 0, borderRadius: 12, display: 'grid', placeItems: 'center',
        background: C.surfaceHi, boxShadow: C.clayFlat, color, fontWeight: 800, fontSize: 16, fontVariantNumeric: 'tabular-nums',
      }}>
        {Math.round(metrics.totalScore)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name || user.email}</div>
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <RoleChip role={roleChipKey(user.role)} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color }}>{label}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.ink3 }}>ÇÖZÜM</div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink1 }}>{formatDuration(metrics.avgResolutionTimeMinutes)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.ink3 }}>MÜDAHALE</div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink1 }}>{formatDuration(metrics.avgInterventionStartTimeMinutes)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.ink3 }}>TEKRAR</div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: metrics.recurrenceCount > 0 ? C.danger : C.ink1 }}>{metrics.recurrenceCount}</div>
        </div>
      </div>
    </div>
  );
}

// ── Detailed metric row (single / self view) ────────────────────────────────────
function DetailedMetricRow({
  icon: Icon, label, value, subValue, score, maxScore,
}: {
  icon: React.ElementType; label: string; value: string | number; subValue?: string; score: number; maxScore: number;
}) {
  const isNegative = score < 0;
  const percentage = maxScore > 0 ? Math.max(0, Math.min(100, (score / maxScore) * 100)) : 0;
  const barCol = score >= maxScore * 0.7 ? PAL.ready : score >= maxScore * 0.4 ? PAL.tech : C.amber;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: C.radiusSm,
      background: C.surface2, boxShadow: C.clayInset, minWidth: 0,
    }}>
      <span style={{
        width: 38, height: 38, flexShrink: 0, borderRadius: 11, display: 'grid', placeItems: 'center',
        color: isNegative ? C.danger : AC.primary, background: isNegative ? 'rgba(192,121,106,0.14)' : AC.primary + '16',
        boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)',
      }}>
        <Icon size={19} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink2 }}>{label}</span>
          <span style={{
            flexShrink: 0, padding: '2px 9px', borderRadius: C.radiusPill, fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            color: isNegative ? C.danger : barCol, background: isNegative ? 'rgba(192,121,106,0.14)' : barCol + '22',
          }}>
            {isNegative ? score : `+${score.toFixed(1)}`} / {maxScore}
          </span>
        </div>
        <div style={{ fontSize: 16.5, fontWeight: 800, color: C.ink1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        {subValue && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink3 }}>{subValue}</div>}
        {!isNegative && (
          <div style={{ marginTop: 8, height: 8, borderRadius: 99, background: C.surface, boxShadow: C.clayInset, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${percentage}%`, borderRadius: 99, background: `linear-gradient(90deg, ${barCol}cc, ${barCol})` }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Detailed KPI card (single / self) ────────────────────────────────────────────
function DetailedKPICard({
  performance, onCompare, showCompareButton = true, mode,
}: {
  performance: PersonnelPerformance; onCompare?: () => void; showCompareButton?: boolean; mode: string;
}) {
  const { user, metrics } = performance;
  return (
    <Card pad={mode === 'mobile' ? 16 : 20}>
      <div style={{ display: 'flex', alignItems: mode === 'mobile' ? 'flex-start' : 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.ink1, letterSpacing: '-0.02em' }}>{user.name || user.email}</div>
          <div style={{ marginTop: 8 }}><RoleChip role={roleChipKey(user.role)} /></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {showCompareButton && onCompare && (
            <GhostBtn onClick={onCompare}><GitCompare size={16} /> Karşılaştır</GhostBtn>
          )}
          <ClayScoreRing score={metrics.totalScore} size={mode === 'mobile' ? 120 : 150} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: mode === 'mobile' ? '1fr' : '1fr 1fr', gap: 12 }}>
        <DetailedMetricRow icon={TrendingUp} label="Arıza Üstlenme & İş Yükü"
          value={`${metrics.faultsAssigned} / ${metrics.expectedFaults > 0 ? metrics.expectedFaults.toFixed(1) : metrics.avgFaultsAssignedForRole.toFixed(1)}`}
          subValue={metrics.expectedFaults > 0
            ? `Beklenen arıza sayısının %${((metrics.faultsAssigned / metrics.expectedFaults) * 100).toFixed(0)}'i karşılandı`
            : metrics.avgFaultsAssignedForRole > 0 ? `Rol ortalaması: ${metrics.avgFaultsAssignedForRole.toFixed(1)} arıza` : 'Beklenen arıza yok'}
          score={metrics.faultAssignmentScore} maxScore={30} />
        <DetailedMetricRow icon={Clock} label="Müdahale Başlatma Süresi"
          value={formatDuration(metrics.avgInterventionStartTimeMinutes)} subValue="Ortalama müdahale başlama süresi"
          score={metrics.interventionTimeScore} maxScore={10} />
        <DetailedMetricRow icon={CheckCircle} label="Çözüm Süresi & Başarısı"
          value={formatDuration(metrics.avgResolutionTimeMinutes)}
          subValue={`Toplam ${metrics.faultsResolved} arıza çözüldü (ort: ${metrics.avgFaultsResolvedForRole.toFixed(1)})`}
          score={metrics.resolutionTimeScore} maxScore={15} />
        <DetailedMetricRow icon={Building} label="Kurum Ziyareti"
          value={`${metrics.institutionVisits} ziyaret`} subValue={`Rol ortalaması: ${metrics.avgInstitutionVisits.toFixed(1)} ziyaret`}
          score={metrics.visitFrequencyScore} maxScore={10} />
        <DetailedMetricRow icon={Phone} label="Kurumda Müdahale Oranı"
          value={`${metrics.onsiteInterventions} / ${metrics.onsiteInterventions + metrics.phoneInterventions}`}
          subValue={metrics.onsiteInterventions + metrics.phoneInterventions > 0
            ? `Müdahalelerin %${((metrics.onsiteInterventions / (metrics.onsiteInterventions + metrics.phoneInterventions)) * 100).toFixed(0)}'i kurumda yapıldı`
            : 'Müdahale verisi yok'}
          score={metrics.onsiteRatioScore} maxScore={10} />
        <DetailedMetricRow icon={Calendar} label="Periyodik Bakım Katkısı"
          value={`${metrics.periodicMaintenanceForms} / ${metrics.totalPeriodicMaintenanceForms}`}
          subValue={metrics.totalPeriodicMaintenanceForms > 0 && metrics.sameRoleTechnicianCount > 0
            ? `Kişi başı beklenen: ${(metrics.totalPeriodicMaintenanceForms / metrics.sameRoleTechnicianCount).toFixed(1)} bakım`
            : 'Periyodik bakım verisi yok'}
          score={metrics.maintenanceContributionScore} maxScore={15} />
        <DetailedMetricRow icon={HeartHandshake} label="Destek Puanı"
          value={`${metrics.supportCount} destek`}
          subValue={metrics.supportCount > 0 ? `Arıza çözümünde ${metrics.supportCount} kez destek verildi` : 'Henüz destek kaydı yok'}
          score={metrics.supportScore} maxScore={10} />
        {(metrics.recurrenceCount > 0 || metrics.recurrencePenalty < 0) && (
          <DetailedMetricRow icon={AlertTriangle} label="Tekrar Arıza Cezası"
            value={`${metrics.recurrenceCount} adet`} subValue="3 saat içinde aynı cihazda tekrar arıza"
            score={metrics.recurrencePenalty} maxScore={-10} />
        )}
        {(metrics.overdueMaintenanceTasks > 0 || metrics.overduePeriodicParts > 0) && (
          <DetailedMetricRow icon={Timer} label="Gecikmiş Bakım Cezası"
            value={`${metrics.overdueMaintenanceTasks + metrics.overduePeriodicParts} adet`}
            subValue={`${metrics.overdueMaintenanceTasks} bakım işi + ${metrics.overduePeriodicParts} parça değişimi gecikmiş`}
            score={metrics.overduePenalty} maxScore={-15} />
        )}
      </div>
    </Card>
  );
}

// ── Comparison arrow ──────────────────────────────────────────────────────────────
function ComparisonArrow({ value1, value2, higherIsBetter = true }: { value1: number; value2: number; higherIsBetter?: boolean }) {
  const diff = value1 - value2;
  if (Math.abs(diff) < 0.01) return <Minus size={18} style={{ color: C.ink3 }} />;
  const isFirstBetter = higherIsBetter ? diff > 0 : diff < 0;
  return isFirstBetter
    ? <ArrowUp size={18} style={{ color: C.waterDeep }} />
    : <ArrowDown size={18} style={{ color: C.danger }} />;
}

function ComparisonMetricRow({
  icon: Icon, label, value1, value2, score1, score2, maxScore,
}: {
  icon: React.ElementType; label: string; value1: string | number; value2: string | number;
  score1: number; score2: number; maxScore: number;
}) {
  const isNegative = maxScore < 0;
  const chip = (s: number) => {
    const c = isNegative ? C.danger : s >= Math.abs(maxScore) * 0.7 ? PAL.ready : s >= Math.abs(maxScore) * 0.4 ? PAL.tech : C.amber;
    return (
      <span style={{ padding: '2px 9px', borderRadius: C.radiusPill, fontSize: 11.5, fontWeight: 800, color: c, background: c + '22', fontVariantNumeric: 'tabular-nums' }}>
        {isNegative ? s : `+${s.toFixed(1)}`}
      </span>
    );
  };
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center', padding: 12,
      borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset,
    }}>
      <div style={{ textAlign: 'right', minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.ink1, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value1}</div>
        <div style={{ marginTop: 3 }}>{chip(score1)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', color: AC.primary, background: AC.primary + '16', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}>
          <Icon size={16} />
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: C.ink3, textAlign: 'center', maxWidth: 90 }}>{label}</span>
        <ComparisonArrow value1={score1} value2={score2} higherIsBetter={!isNegative} />
      </div>
      <div style={{ textAlign: 'left', minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.ink1, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value2}</div>
        <div style={{ marginTop: 3 }}>{chip(score2)}</div>
      </div>
    </div>
  );
}

function ComparisonView({
  person1, person2, onClose, mode,
}: { person1: PersonnelPerformance; person2: PersonnelPerformance; onClose: () => void; mode: string }) {
  const m1 = person1.metrics;
  const m2 = person2.metrics;
  const header = (p: PersonnelPerformance) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset, minWidth: 0 }}>
      <ClayScoreRing score={p.metrics.totalScore} size={mode === 'mobile' ? 86 : 110} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.user.name || p.user.email}</div>
        <div style={{ marginTop: 6 }}><RoleChip role={roleChipKey(p.user.role)} /></div>
      </div>
    </div>
  );
  return (
    <Card pad={mode === 'mobile' ? 16 : 20}>
      <CardHead ico="gauge" title="Personel Karşılaştırması" right={
        <GhostBtn onClick={onClose}><X size={16} /> Kapat</GhostBtn>
      } />
      <div style={{ display: 'grid', gridTemplateColumns: mode === 'mobile' ? '1fr' : '1fr 1fr', gap: 12, margin: '14px 0 18px' }}>
        {header(person1)}
        {header(person2)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ComparisonMetricRow icon={TrendingUp} label="Arıza Üstlenme"
          value1={`${m1.faultsAssigned} / ${m1.expectedFaults > 0 ? m1.expectedFaults.toFixed(1) : m1.avgFaultsAssignedForRole.toFixed(1)}`}
          value2={`${m2.faultsAssigned} / ${m2.expectedFaults > 0 ? m2.expectedFaults.toFixed(1) : m2.avgFaultsAssignedForRole.toFixed(1)}`}
          score1={m1.faultAssignmentScore} score2={m2.faultAssignmentScore} maxScore={30} />
        <ComparisonMetricRow icon={Clock} label="Müdahale Başlatma"
          value1={formatDuration(m1.avgInterventionStartTimeMinutes)} value2={formatDuration(m2.avgInterventionStartTimeMinutes)}
          score1={m1.interventionTimeScore} score2={m2.interventionTimeScore} maxScore={10} />
        <ComparisonMetricRow icon={CheckCircle} label="Çözüm Süresi"
          value1={formatDuration(m1.avgResolutionTimeMinutes)} value2={formatDuration(m2.avgResolutionTimeMinutes)}
          score1={m1.resolutionTimeScore} score2={m2.resolutionTimeScore} maxScore={15} />
        <ComparisonMetricRow icon={Building} label="Kurum Ziyareti"
          value1={`${m1.institutionVisits} ziyaret`} value2={`${m2.institutionVisits} ziyaret`}
          score1={m1.visitFrequencyScore} score2={m2.visitFrequencyScore} maxScore={10} />
        <ComparisonMetricRow icon={Phone} label="Kurumda Müdahale"
          value1={`${m1.onsiteInterventions} / ${m1.onsiteInterventions + m1.phoneInterventions}`}
          value2={`${m2.onsiteInterventions} / ${m2.onsiteInterventions + m2.phoneInterventions}`}
          score1={m1.onsiteRatioScore} score2={m2.onsiteRatioScore} maxScore={10} />
        <ComparisonMetricRow icon={Calendar} label="Periyodik Bakım"
          value1={`${m1.periodicMaintenanceForms} / ${m1.totalPeriodicMaintenanceForms}`}
          value2={`${m2.periodicMaintenanceForms} / ${m2.totalPeriodicMaintenanceForms}`}
          score1={m1.maintenanceContributionScore} score2={m2.maintenanceContributionScore} maxScore={15} />
        <ComparisonMetricRow icon={HeartHandshake} label="Destek Puanı"
          value1={`${m1.supportCount} destek`} value2={`${m2.supportCount} destek`}
          score1={m1.supportScore} score2={m2.supportScore} maxScore={10} />
        <ComparisonMetricRow icon={AlertTriangle} label="Tekrar Arıza"
          value1={`${m1.recurrenceCount} adet`} value2={`${m2.recurrenceCount} adet`}
          score1={m1.recurrencePenalty} score2={m2.recurrencePenalty} maxScore={-10} />
        <ComparisonMetricRow icon={Timer} label="Gecikmiş Bakım"
          value1={`${m1.overdueMaintenanceTasks + m1.overduePeriodicParts} adet`}
          value2={`${m2.overdueMaintenanceTasks + m2.overduePeriodicParts} adet`}
          score1={m1.overduePenalty} score2={m2.overduePenalty} maxScore={-15} />
      </div>
      {/* summary */}
      <div style={{ marginTop: 18, padding: 16, borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, color: C.ink1, fontVariantNumeric: 'tabular-nums' }}>{m1.totalScore.toFixed(1)}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink3 }}>Toplam Puan</div>
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, color: C.ink1, fontVariantNumeric: 'tabular-nums' }}>{m2.totalScore.toFixed(1)}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink3 }}>Toplam Puan</div>
          </div>
        </div>
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          {Math.abs(m1.totalScore - m2.totalScore) < 0.5 ? (
            <Pill><Minus size={14} /> Performanslar Eşit</Pill>
          ) : m1.totalScore > m2.totalScore ? (
            <Pill tone="ok"><ArrowUp size={14} /> {person1.user.name || person1.user.email} {(m1.totalScore - m2.totalScore).toFixed(1)} puan önde</Pill>
          ) : (
            <Pill tone="ok"><ArrowUp size={14} /> {person2.user.name || person2.user.email} {(m2.totalScore - m1.totalScore).toFixed(1)} puan önde</Pill>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── clay date input ──────────────────────────────────────────────────────────────
function ClayDate({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <label htmlFor={id} style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.03em', textTransform: 'uppercase' }}>{label}</label>
      <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', height: 42, padding: '0 12px', borderRadius: C.radiusSm,
          border: 'none', background: C.surface2, boxShadow: C.clayInset, color: C.ink1, fontSize: 13.5, fontWeight: 600,
          fontFamily: 'inherit', outline: 'none',
        }} />
    </div>
  );
}

// ── clay select ──────────────────────────────────────────────────────────────────
function ClaySelect({ id, label, value, onChange, children }: {
  id: string; label?: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      {label && <label htmlFor={id} style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.03em', textTransform: 'uppercase' }}>{label}</label>}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', height: 42, padding: '0 12px', borderRadius: C.radiusSm,
          border: 'none', background: C.surface2, boxShadow: C.clayInset, color: C.ink1, fontSize: 13.5, fontWeight: 600,
          fontFamily: 'inherit', outline: 'none', cursor: 'pointer', appearance: 'none',
        }}>
        {children}
      </select>
    </div>
  );
}

export default function PersonelIzlemPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMineMode = searchParams?.get('mine') === '1';
  const { currentUserProfile, isAdmin, currentCompanyId, isSuperAdmin } = useAuth();
  const myUid = currentUserProfile?.uid;
  const { toast } = useToast();
  const mode = useMode();
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

  // View/sort states
  const [roleFilter, setRoleFilter] = useState<'all' | 'teknik_servis' | 'aplikasyon'>('all');
  const [scoreRange, setScoreRange] = useState<'all' | 'low' | 'mid' | 'high'>('all');
  const [sortBy, setSortBy] = useState<'score' | 'resolution' | 'recurrence' | 'intervention'>('score');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

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
        const hospitalsSnap = await getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin));
        const hospitalsData = hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Hospital);
        setHospitals(hospitalsData.sort((a, b) => a.name.localeCompare(b.name, 'tr')));
      } catch (err) {
        console.error('Error loading hospitals:', err);
      }
    };
    loadHospitals();
  }, [currentCompanyId, isSuperAdmin]);

  const loadPerformanceData = async (filters?: PerformanceFilters) => {
    setLoading(true);
    try {
      const data = await calculateAllPerformances({ ...filters, companyId: currentCompanyId, isSuperAdmin });
      setPerformances(data);
    } catch (err) {
      console.error('Error loading performance data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin && !(isMineMode && myUid)) {
      setLoading(false);
      return;
    }

    loadPerformanceData();
  }, [isAdmin, isMineMode, myUid]);

  // In self-view mode, pin the selected personnel to the current user
  useEffect(() => {
    if (isMineMode && myUid) {
      setSelectedPersonnelId(myUid);
      setIsCompareMode(false);
      setComparePersonnelId('');
    }
  }, [isMineMode, myUid, performances]);

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

  const applyQuickDate = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days + 1);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  };

  const displayedPerformances = useMemo(() => {
    const filtered = performances.filter((p) => {
      if (roleFilter !== 'all' && p.user.role !== roleFilter) return false;
      if (scoreRange === 'low' && p.metrics.totalScore >= 40) return false;
      if (scoreRange === 'mid' && (p.metrics.totalScore < 40 || p.metrics.totalScore >= 60)) return false;
      if (scoreRange === 'high' && p.metrics.totalScore < 60) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'score') return b.metrics.totalScore - a.metrics.totalScore;
      if (sortBy === 'resolution') return a.metrics.avgResolutionTimeMinutes - b.metrics.avgResolutionTimeMinutes;
      if (sortBy === 'intervention') return a.metrics.avgInterventionStartTimeMinutes - b.metrics.avgInterventionStartTimeMinutes;
      return b.metrics.recurrenceCount - a.metrics.recurrenceCount;
    });

    return sorted;
  }, [performances, roleFilter, scoreRange, sortBy]);

  const handleExportPersonnelPdf = async () => {
    if (displayedPerformances.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak personel verisi yok.', variant: 'default' });
      return;
    }
    setExportLoading(true);
    try {
      const personnelData = displayedPerformances.map(p => ({
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
      <ClayPage>
        <ClayLoader label="Performans verileri hesaplanıyor…" />
      </ClayPage>
    );
  }

  if (!isAdmin && !(isMineMode && myUid)) {
    return (
      <ClayPage>
        <Card tone="danger" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.danger }}>Yetkisiz Erişim</div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink2, marginTop: 8 }}>
            Bu sayfaya sadece yöneticiler erişebilir.
          </div>
        </Card>
      </ClayPage>
    );
  }

  // Self-view: own performance only, no filters / personnel picker / compare
  if (isMineMode && myUid) {
    const mine = performances.find((p) => p.user.uid === myUid) || null;
    return (
      <ClayPage>
        <PageHead
          ico="users"
          title="Performansım"
          sub="Kendi performans metrikleriniz ve puanınız"
          onBack={() => router.push('/cihaz-yonetimi-ana')}
          mobile={mode === 'mobile'}
        />
        {mine ? (
          <DetailedKPICard performance={mine} showCompareButton={false} mode={mode} />
        ) : (
          <Card style={{ textAlign: 'center', padding: 40 }}>
            <Users size={44} style={{ color: C.ink3, opacity: 0.4, margin: '0 auto 14px' }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: C.ink2 }}>Henüz sizin için hesaplanmış performans verisi bulunmuyor.</div>
          </Card>
        )}
      </ClayPage>
    );
  }

  // Calculate averages
  const avgScore = displayedPerformances.length > 0
    ? displayedPerformances.reduce((sum, p) => sum + p.metrics.totalScore, 0) / displayedPerformances.length
    : 0;

  const teknikPersonel = displayedPerformances.filter(p => p.user.role === 'teknik_servis');
  const aplikasyonPersonel = displayedPerformances.filter(p => p.user.role === 'aplikasyon');
  const avgRecurrence = displayedPerformances.length
    ? displayedPerformances.reduce((sum, p) => sum + p.metrics.recurrenceCount, 0) / displayedPerformances.length
    : 0;

  const isMobile = mode === 'mobile';

  return (
    <ClayPage>
      <PageHead
        ico="users"
        title="Personel Performans İzleme"
        sub="Teknik servis ve aplikasyon personelinin performans metrikleri"
        onBack={() => router.push('/cihaz-yonetimi')}
        mobile={isMobile}
        right={
          <GhostBtn onClick={handleExportPersonnelPdf}>
            {exportLoading ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
            PDF Döküm
          </GhostBtn>
        }
      />

      {/* Filters */}
      <Card pad={16} style={{ marginBottom: 16 }}>
        <CardHead ico="search" title="Filtreler" right={hasActiveFilters ? <Pill tone="ok">Aktif</Pill> : undefined} />
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10, marginTop: 14 }}>
          <ClayDate id="startDate" label="Başlangıç" value={startDate} onChange={setStartDate} />
          <ClayDate id="endDate" label="Bitiş" value={endDate} onChange={setEndDate} />
          <ClaySelect id="laboratory" label="Laboratuvar" value={selectedLabId} onChange={setSelectedLabId}>
            <option value="all">Tümü</option>
            {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </ClaySelect>
          <ClaySelect id="personnel" label="Personel" value={selectedPersonnelId}
            onChange={(value) => {
              setSelectedPersonnelId(value);
              if (value === 'all' || !value) {
                setIsCompareMode(false);
                setComparePersonnelId('');
              }
            }}>
            <option value="all">Tümü</option>
            {performances.map((p) => (
              <option key={p.user.uid} value={p.user.uid}>{p.user.name || p.user.email}</option>
            ))}
          </ClaySelect>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          <GhostBtn onClick={handleApplyFilters}>
            {isFiltering ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />} Uygula
          </GhostBtn>
          {hasActiveFilters && <GhostBtn onClick={handleClearFilters}><X size={15} /> Temizle</GhostBtn>}
          <span style={{ width: 1, alignSelf: 'stretch', background: C.line, margin: '0 2px' }} />
          <GhostBtn onClick={() => applyQuickDate(7)}>Son 7 gün</GhostBtn>
          <GhostBtn onClick={() => applyQuickDate(30)}>Son 30 gün</GhostBtn>
          <GhostBtn onClick={() => {
            const now = new Date();
            const first = new Date(now.getFullYear(), now.getMonth(), 1);
            setStartDate(first.toISOString().slice(0, 10));
            setEndDate(now.toISOString().slice(0, 10));
          }}>Bu ay</GhostBtn>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 14 }}>
          <Segmented
            value={roleFilter}
            onChange={(v) => setRoleFilter(v as 'all' | 'teknik_servis' | 'aplikasyon')}
            options={[{ v: 'all', l: 'Tümü' }, { v: 'teknik_servis', l: 'Teknik' }, { v: 'aplikasyon', l: 'Aplikasyon' }]}
          />
          <Segmented
            value={scoreRange}
            onChange={(v) => setScoreRange(v as 'all' | 'low' | 'mid' | 'high')}
            options={[{ v: 'all', l: 'Tüm Skor' }, { v: 'low', l: '0-40' }, { v: 'mid', l: '40-60' }, { v: 'high', l: '60+' }]}
          />
        </div>

        {/* Compare mode selector */}
        {selectedPersonnel && isCompareMode && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: C.radiusSm, background: AC.primary + '0f', boxShadow: `inset 0 0 0 1.5px ${AC.primary}33` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: C.ink1 }}>
                <GitCompare size={15} style={{ color: AC.primary }} /> Karşılaştırılacak personeli seçin:
              </span>
              <div style={{ flex: 1, minWidth: 180 }}>
                <ClaySelect id="compare" value={comparePersonnelId} onChange={setComparePersonnelId}>
                  <option value="">Personel seçin...</option>
                  {performances.filter(p => p.user.uid !== selectedPersonnelId).map((p) => (
                    <option key={p.user.uid} value={p.user.uid}>
                      {p.user.name || p.user.email} ({p.metrics.totalScore.toFixed(0)} puan)
                    </option>
                  ))}
                </ClaySelect>
              </div>
              <GhostBtn onClick={() => { setIsCompareMode(false); setComparePersonnelId(''); }}><X size={15} /></GhostBtn>
            </div>
          </div>
        )}
        {hasActiveFilters && !isCompareMode && (
          <p style={{ fontSize: 11.5, fontWeight: 600, color: C.ink3, marginTop: 10 }}>
            {selectedPersonnelId && selectedPersonnelId !== 'all' && `${performances.find(p => p.user.uid === selectedPersonnelId)?.user.name || 'Seçili personel'} detaylı görünümde. `}
            {selectedLabId && selectedLabId !== 'all' && `Sadece "${hospitals.find(h => h.id === selectedLabId)?.name}" laboratuvarının ana sorumluları gösteriliyor. `}
            {(startDate || endDate) && `Tarih aralığı: ${startDate || '∞'} - ${endDate || '∞'}`}
          </p>
        )}
      </Card>

      {/* Summary KPIs + list controls - only when no single personnel selected */}
      {!selectedPersonnel && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)',
            gap: 12, marginBottom: 16,
          }}>
            <KpiTile ico="users" label="Toplam Personel" value={displayedPerformances.length} delay={0} />
            <KpiTile ico="gauge" label="Ortalama Puan" value={Number(avgScore.toFixed(1)) as unknown as string} delay={60} />
            <KpiTile ico="wrench" label="Teknik Servis" value={teknikPersonel.length} tone="tech" delay={120} />
            <KpiTile ico="flask" label="Aplikasyon" value={aplikasyonPersonel.length} tone="app" delay={180} />
            <KpiTile ico="alert" label="Ort. Tekrar Arıza" value={avgRecurrence.toFixed(1)} tone="amber" delay={240} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Segmented
              value={sortBy === 'recurrence' || sortBy === 'intervention' ? sortBy : sortBy}
              onChange={(v) => setSortBy(v as 'score' | 'resolution' | 'recurrence' | 'intervention')}
              options={[
                { v: 'score', l: 'Skora göre' },
                { v: 'resolution', l: 'Çözüme göre' },
                { v: 'intervention', l: 'Müdahaleye göre' },
                { v: 'recurrence', l: 'Tekrara göre' },
              ]}
            />
            <Segmented
              value={viewMode}
              onChange={(v) => setViewMode(v as 'grid' | 'list')}
              options={[{ v: 'grid', l: 'Grid' }, { v: 'list', l: 'Liste' }]}
            />
          </div>
        </>
      )}

      {/* Content area */}
      {displayedPerformances.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: 40 }}>
          <Users size={44} style={{ color: C.ink3, opacity: 0.4, margin: '0 auto 14px' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink2 }}>Henüz personel verisi bulunamadı.</div>
        </Card>
      ) : selectedPersonnel && comparePersonnel ? (
        <ComparisonView
          person1={selectedPersonnel}
          person2={comparePersonnel}
          onClose={() => { setIsCompareMode(false); setComparePersonnelId(''); }}
          mode={mode}
        />
      ) : selectedPersonnel ? (
        <DetailedKPICard
          performance={selectedPersonnel}
          onCompare={() => setIsCompareMode(true)}
          showCompareButton={!isCompareMode}
          mode={mode}
        />
      ) : viewMode === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
          {displayedPerformances.map((performance) => (
            <PersonnelCard key={performance.user.uid} performance={performance} mode={mode} />
          ))}
        </div>
      ) : (
        <Card pad={14}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {displayedPerformances.map((performance) => (
              <ListRow key={performance.user.uid} performance={performance} mode={mode} />
            ))}
          </div>
        </Card>
      )}

      {/* Algorithm explanation */}
      <Card pad={isMobile ? 16 : 20} style={{ marginTop: 16 }}>
        <CardHead ico="sparkles" title="Performans Hesaplama Algoritması" />
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 10, marginTop: 14,
        }}>
          {[
            { t: 'Arıza Üstlenme & İş Yükü (30 puan)', d: 'Beklenen pay karşılama (20pt) + ortalama üstü hacim bonusu (10pt)' },
            { t: 'Müdahale Süresi (10 puan)', d: 'Doğrusal: 0dk=10pt, 1saat=5pt, 2saat=0pt' },
            { t: 'Çözüm Süresi & Başarısı (15 puan)', d: 'Kalite (10pt): 0dk=10pt, 8sa=0pt. Hacim (5pt): çözüm sayısı/ort' },
            { t: 'Kurum Ziyareti (10 puan)', d: 'Rol ortalamasına göre: 1x ort=5pt, 2x ort=10pt' },
            { t: 'Kurumda Müdahale (10 puan)', d: 'Kurumda müdahale oranı × 10pt; 3’ten az müdahalede küçük örneklem düşürücü' },
            { t: 'Periyodik Bakım (15 puan)', d: 'Kişi başı beklenen pay bazlı: toplam/personel sayısı' },
            { t: 'Destek Katkısı (10 puan)', d: 'Arıza çözümünde destek: +2pt/destek, maks 10pt' },
          ].map((x, i) => (
            <div key={i} style={{ padding: 12, borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink1 }}>{x.t}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink2, marginTop: 3 }}>{x.d}</div>
            </div>
          ))}
          {[
            { t: 'Tekrar Arıza Cezası (-10 puan)', d: '3 saat içinde aynı cihazda birebir aynı arıza başlığı: -2pt/adet' },
            { t: 'Gecikmiş Bakım Cezası (-15 puan)', d: 'Gecikmiş bakım ve parça değişimi: -3pt/adet' },
          ].map((x, i) => (
            <div key={`p${i}`} style={{ padding: 12, borderRadius: C.radiusSm, background: 'rgba(192,121,106,0.08)', boxShadow: 'inset 0 0 0 1.5px rgba(192,121,106,0.2)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.danger }}>{x.t}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink2, marginTop: 3 }}>{x.d}</div>
            </div>
          ))}
        </div>
      </Card>
    </ClayPage>
  );
}
