'use client';

import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User } from '@/lib/types';

export interface PerformanceMetrics {
  // Raw metrics
  totalFaultsForRole: number;
  faultsAssigned: number;
  faultsResolved: number;
  avgInterventionStartTimeMinutes: number;
  avgResolutionTimeMinutes: number;
  institutionVisits: number;
  avgInstitutionVisits: number;
  onsiteInterventions: number;
  phoneInterventions: number;
  periodicMaintenanceForms: number;
  totalPeriodicMaintenanceForms: number;
  recurrenceCount: number;

  // Calculated scores (0-100 scale for each, then weighted)
  faultAssignmentScore: number; // max 20
  interventionTimeScore: number; // max 15
  resolutionTimeScore: number; // max 15
  visitFrequencyScore: number; // max 15
  onsiteRatioScore: number; // max 15
  maintenanceContributionScore: number; // max 20
  recurrencePenalty: number; // -10 to 0

  // Final score
  totalScore: number;
}

export interface PersonnelPerformance {
  user: User;
  metrics: PerformanceMetrics;
}

// Calculate intervention time score (max 15 points)
function calculateInterventionTimeScore(avgMinutes: number): number {
  if (avgMinutes <= 0) return 0; // No data
  if (avgMinutes <= 30) return 15;
  if (avgMinutes <= 60) return 12;
  if (avgMinutes <= 120) return 9;
  if (avgMinutes <= 240) return 6;
  if (avgMinutes <= 480) return 3;
  return 0;
}

// Calculate resolution time score (max 15 points)
function calculateResolutionTimeScore(avgMinutes: number): number {
  if (avgMinutes <= 0) return 0; // No data
  if (avgMinutes <= 60) return 15;
  if (avgMinutes <= 120) return 12;
  if (avgMinutes <= 240) return 9;
  if (avgMinutes <= 480) return 6;
  if (avgMinutes <= 1440) return 3;
  return 0;
}

export async function calculateAllPerformances(): Promise<PersonnelPerformance[]> {
  // Fetch all required data
  const [usersSnap, faultsSnap, teknikFormsSnap, aplikasyonFormsSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'deviceFaultReports')),
    getDocs(collection(db, 'deviceActionForms')),
    getDocs(collection(db, 'aplikasyonActionForms')),
  ]);

  // Parse data
  const allUsers = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }) as User);
  const technicians = allUsers.filter(u => u.role === 'teknik_servis' || u.role === 'aplikasyon');

  const allFaults = faultsSnap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      openedAt: data.openedAt?.toDate?.() || null,
      assignedAt: data.assignedAt?.toDate?.() || null,
      interventionStartedAt: data.interventionStartedAt?.toDate?.() || null,
      closedAt: data.closedAt?.toDate?.() || null,
      assignedToUid: data.assignedToUid || null,
      closedByUid: data.closedByUid || null,
      faultType: data.faultType || 'teknik_servis',
      status: data.status,
      interventionType: data.interventionType || null,
      deviceId: data.deviceId,
      hospitalId: data.hospitalId,
    };
  });

  const teknikForms = teknikFormsSnap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      createdByUid: data.createdByUid,
      createdAt: data.createdAt?.toDate?.() || null,
      islemTuru: data.islemTuru,
      deviceId: data.deviceId,
      hospitalId: data.hospitalId,
    };
  });

  const aplikasyonForms = aplikasyonFormsSnap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      createdByUid: data.createdByUid,
      createdAt: data.createdAt?.toDate?.() || null,
      islemTuru: data.islemTuru,
      deviceId: data.deviceId,
      hospitalId: data.hospitalId,
    };
  });

  const allForms = [...teknikForms, ...aplikasyonForms];

  // Calculate total periodic maintenance forms
  const totalPeriodicMaintenanceForms = allForms.filter(f => f.islemTuru === 'periyodik_bakim').length;

  // Calculate average institution visits
  const visitCounts = technicians.map(user => {
    const userForms = allForms.filter(f => f.createdByUid === user.uid).length;
    const userOnsiteInterventions = allFaults.filter(f =>
      f.assignedToUid === user.uid && f.interventionType === 'yerinde'
    ).length;
    return userForms + userOnsiteInterventions;
  });
  const avgInstitutionVisits = visitCounts.length > 0
    ? visitCounts.reduce((a, b) => a + b, 0) / visitCounts.length
    : 0;

  // Count faults by type
  const teknikServisFaults = allFaults.filter(f => f.faultType === 'teknik_servis');
  const aplikasyonFaults = allFaults.filter(f => f.faultType === 'aplikasyon');

  // Calculate performance for each technician
  const performances: PersonnelPerformance[] = [];

  for (const user of technicians) {
    const isAplikasyon = user.role === 'aplikasyon';
    const relevantFaults = isAplikasyon ? aplikasyonFaults : teknikServisFaults;

    // 1. Fault Assignment Ratio (max 20 points)
    const faultsAssigned = relevantFaults.filter(f => f.assignedToUid === user.uid).length;
    const totalFaultsForRole = relevantFaults.length;
    const faultAssignmentRatio = totalFaultsForRole > 0 ? faultsAssigned / totalFaultsForRole : 0;
    const faultAssignmentScore = Math.min(20, faultAssignmentRatio * 100); // Scale: 5% = 5pts, 20%+ = 20pts

    // 2. Intervention Start Time (max 15 points)
    const faultsWithIntervention = allFaults.filter(f =>
      f.assignedToUid === user.uid &&
      f.assignedAt &&
      f.interventionStartedAt
    );
    let avgInterventionStartTimeMinutes = 0;
    if (faultsWithIntervention.length > 0) {
      const totalMinutes = faultsWithIntervention.reduce((sum, f) => {
        const diff = (f.interventionStartedAt!.getTime() - f.assignedAt!.getTime()) / (1000 * 60);
        return sum + Math.max(0, diff);
      }, 0);
      avgInterventionStartTimeMinutes = totalMinutes / faultsWithIntervention.length;
    }
    const interventionTimeScore = calculateInterventionTimeScore(avgInterventionStartTimeMinutes);

    // 3. Resolution Time (max 15 points)
    const resolvedFaults = allFaults.filter(f =>
      f.closedByUid === user.uid &&
      f.interventionStartedAt &&
      f.closedAt
    );
    let avgResolutionTimeMinutes = 0;
    if (resolvedFaults.length > 0) {
      const totalMinutes = resolvedFaults.reduce((sum, f) => {
        const diff = (f.closedAt!.getTime() - f.interventionStartedAt!.getTime()) / (1000 * 60);
        return sum + Math.max(0, diff);
      }, 0);
      avgResolutionTimeMinutes = totalMinutes / resolvedFaults.length;
    }
    const resolutionTimeScore = calculateResolutionTimeScore(avgResolutionTimeMinutes);

    // 4. Institution Visit Frequency (max 15 points)
    const userForms = allForms.filter(f => f.createdByUid === user.uid).length;
    const onsiteInterventions = allFaults.filter(f =>
      f.assignedToUid === user.uid && f.interventionType === 'yerinde'
    ).length;
    const phoneInterventions = allFaults.filter(f =>
      f.assignedToUid === user.uid && f.interventionType === 'telefonla'
    ).length;
    const institutionVisits = userForms + onsiteInterventions;

    let visitFrequencyScore = 0;
    if (avgInstitutionVisits > 0) {
      const ratio = institutionVisits / avgInstitutionVisits;
      visitFrequencyScore = Math.min(15, ratio * 7.5); // 2x average = 15 pts
    }

    // 5. On-site Intervention Ratio (max 15 points)
    const totalInterventions = onsiteInterventions + phoneInterventions;
    let onsiteRatioScore = 0;
    if (totalInterventions > 0) {
      const onsiteRatio = onsiteInterventions / totalInterventions;
      onsiteRatioScore = onsiteRatio * 15;
    }

    // 6. Periodic Maintenance Contribution (max 20 points)
    const userPeriodicForms = allForms.filter(f =>
      f.createdByUid === user.uid && f.islemTuru === 'periyodik_bakim'
    ).length;
    let maintenanceContributionScore = 0;
    if (totalPeriodicMaintenanceForms > 0) {
      const ratio = userPeriodicForms / totalPeriodicMaintenanceForms;
      maintenanceContributionScore = Math.min(20, ratio * 100); // 20% contribution = 20 pts
    }

    // 7. Recurrence Penalty (-10 to 0 points)
    // Check if any fault recurred within 7 days after this user resolved it
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    let recurrenceCount = 0;

    const userResolvedFaults = allFaults.filter(f =>
      f.closedByUid === user.uid && f.status === 'closed' && f.closedAt
    );

    for (const resolved of userResolvedFaults) {
      // Check if same device had a new fault within 7 days
      const hasRecurrence = allFaults.some(f =>
        f.id !== resolved.id &&
        f.deviceId === resolved.deviceId &&
        f.openedAt &&
        resolved.closedAt &&
        f.openedAt.getTime() > resolved.closedAt.getTime() &&
        f.openedAt.getTime() - resolved.closedAt.getTime() <= sevenDaysMs
      );
      if (hasRecurrence) recurrenceCount++;
    }

    const recurrencePenalty = Math.max(-10, -recurrenceCount * 2);

    // Calculate total score
    const totalScore = Math.max(0, Math.min(100,
      faultAssignmentScore +
      interventionTimeScore +
      resolutionTimeScore +
      visitFrequencyScore +
      onsiteRatioScore +
      maintenanceContributionScore +
      recurrencePenalty
    ));

    performances.push({
      user,
      metrics: {
        totalFaultsForRole,
        faultsAssigned,
        faultsResolved: resolvedFaults.length,
        avgInterventionStartTimeMinutes,
        avgResolutionTimeMinutes,
        institutionVisits,
        avgInstitutionVisits,
        onsiteInterventions,
        phoneInterventions,
        periodicMaintenanceForms: userPeriodicForms,
        totalPeriodicMaintenanceForms,
        recurrenceCount,
        faultAssignmentScore,
        interventionTimeScore,
        resolutionTimeScore,
        visitFrequencyScore,
        onsiteRatioScore,
        maintenanceContributionScore,
        recurrencePenalty,
        totalScore,
      },
    });
  }

  // Sort by total score descending
  performances.sort((a, b) => b.metrics.totalScore - a.metrics.totalScore);

  return performances;
}

// Get color for score
export function getScoreColor(score: number): { bg: string; text: string; ring: string } {
  if (score >= 80) return { bg: 'bg-green-500', text: 'text-green-600', ring: 'ring-green-400' };
  if (score >= 60) return { bg: 'bg-blue-500', text: 'text-blue-600', ring: 'ring-blue-400' };
  if (score >= 40) return { bg: 'bg-yellow-500', text: 'text-yellow-600', ring: 'ring-yellow-400' };
  if (score >= 20) return { bg: 'bg-orange-500', text: 'text-orange-600', ring: 'ring-orange-400' };
  return { bg: 'bg-red-500', text: 'text-red-600', ring: 'ring-red-400' };
}

// Format minutes to readable string
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '-';
  if (minutes < 60) return `${Math.round(minutes)} dk`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} saat`;
  return `${Math.round(minutes / 1440)} gün`;
}
