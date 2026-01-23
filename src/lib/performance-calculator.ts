'use client';

import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User, MaintenancePlan, MaintenanceLog, PeriodicPartChange, PeriodicPartChangeLog, Device } from '@/lib/types';

export interface PerformanceMetrics {
  // Raw metrics
  totalFaultsForRole: number;
  expectedFaults: number; // Expected fault share based on primary labs
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

  // Overdue metrics
  overdueMaintenanceTasks: number;
  overduePeriodicParts: number;

  // Calculated scores (0-100 scale for each, then weighted)
  faultAssignmentScore: number; // max 20
  interventionTimeScore: number; // max 15
  resolutionTimeScore: number; // max 15
  visitFrequencyScore: number; // max 15
  onsiteRatioScore: number; // max 15
  maintenanceContributionScore: number; // max 20
  recurrencePenalty: number; // -10 to 0
  overduePenalty: number; // -15 to 0

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
  const [
    usersSnap,
    faultsSnap,
    teknikFormsSnap,
    aplikasyonFormsSnap,
    devicesSnap,
    maintenancePlansSnap,
    maintenanceLogsSnap,
    periodicPartChangesSnap,
    periodicPartChangeLogsSnap
  ] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'deviceFaultReports')),
    getDocs(collection(db, 'deviceActionForms')),
    getDocs(collection(db, 'aplikasyonActionForms')),
    getDocs(collection(db, 'devices')),
    getDocs(collection(db, 'maintenancePlans')),
    getDocs(collection(db, 'maintenanceLogs')),
    getDocs(collection(db, 'periodicPartChanges')),
    getDocs(collection(db, 'periodicPartChangeLogs')),
  ]);

  // Parse data
  const allUsers = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }) as User);
  const technicians = allUsers.filter(u => u.role === 'teknik_servis' || u.role === 'aplikasyon');

  // Parse devices to get hospitalId mapping
  const devices = devicesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Device);
  const deviceHospitalMap = new Map<string, string>();
  devices.forEach(d => {
    if (d.hospitalId) {
      deviceHospitalMap.set(d.id, d.hospitalId);
    }
  });

  // Parse maintenance plans
  const maintenancePlans = maintenancePlansSnap.docs.map(d => ({
    id: d.id,
    ...d.data(),
  })) as MaintenancePlan[];

  // Parse maintenance logs
  const maintenanceLogs = maintenanceLogsSnap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      completedAt: data.completedAt?.toDate?.() || null,
      nextDueDate: data.nextDueDate?.toDate?.() || null,
    };
  }) as MaintenanceLog[];

  // Parse periodic part changes
  const periodicPartChanges = periodicPartChangesSnap.docs.map(d => ({
    id: d.id,
    ...d.data(),
  })) as PeriodicPartChange[];

  // Parse periodic part change logs
  const periodicPartChangeLogs = periodicPartChangeLogsSnap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      completedAt: data.completedAt?.toDate?.() || null,
      nextDueDate: data.nextDueDate?.toDate?.() || null,
    };
  }) as PeriodicPartChangeLog[];

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

  // Build map of lab -> personnel count (per role) for expected fault calculation
  // This counts how many personnel have each lab as primary, grouped by role
  const teknikPersonnelPerLab = new Map<string, number>();
  const aplikasyonPersonnelPerLab = new Map<string, number>();

  for (const user of technicians) {
    const primaryLabs = user.primaryLaboratories || [];
    const targetMap = user.role === 'aplikasyon' ? aplikasyonPersonnelPerLab : teknikPersonnelPerLab;

    for (const labId of primaryLabs) {
      targetMap.set(labId, (targetMap.get(labId) || 0) + 1);
    }
  }

  // Helper function to calculate expected faults for a user based on primary labs
  const calculateExpectedFaults = (
    userPrimaryLabs: string[],
    userRole: string,
    faultsByType: typeof allFaults
  ): number => {
    if (userPrimaryLabs.length === 0) return 0;

    const personnelPerLabMap = userRole === 'aplikasyon'
      ? aplikasyonPersonnelPerLab
      : teknikPersonnelPerLab;

    let expectedTotal = 0;

    for (const labId of userPrimaryLabs) {
      // Count faults in this lab
      const faultsInLab = faultsByType.filter(f => f.hospitalId === labId).length;
      // Get number of personnel responsible for this lab
      const personnelCount = personnelPerLabMap.get(labId) || 1;
      // Add this user's expected share
      expectedTotal += faultsInLab / personnelCount;
    }

    return expectedTotal;
  };

  // Helper function to calculate overdue status
  const now = new Date();
  const calculateOverdueItems = (
    userPrimaryLabs: string[],
    userRole: string
  ): { overdueMaintenanceTasks: number; overduePeriodicParts: number } => {
    const isAplikasyon = userRole === 'aplikasyon';
    const maintenanceType = isAplikasyon ? 'aplikasyon' : 'teknik_servis';

    // Get all devices in primary laboratories
    const primaryLabDeviceIds = devices
      .filter(d => d.hospitalId && userPrimaryLabs.includes(d.hospitalId))
      .map(d => d.id);

    // Calculate overdue maintenance tasks
    let overdueMaintenanceTasks = 0;
    const relevantPlans = maintenancePlans.filter(
      p => primaryLabDeviceIds.includes(p.deviceId) && p.type === maintenanceType
    );

    for (const plan of relevantPlans) {
      const latestLog = maintenanceLogs
        .filter(l => l.planId === plan.id)
        .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0))[0];

      if (latestLog?.nextDueDate) {
        if (latestLog.nextDueDate.getTime() < now.getTime()) {
          overdueMaintenanceTasks++;
        }
      }
    }

    // Calculate overdue periodic parts
    let overduePeriodicParts = 0;
    const relevantPartChanges = periodicPartChanges.filter(p => {
      if (!primaryLabDeviceIds.includes(p.deviceId)) return false;
      return p.responsibilityType === userRole || p.responsibilityType === 'both';
    });

    for (const partChange of relevantPartChanges) {
      const latestLog = periodicPartChangeLogs
        .filter(l => l.periodicPartChangeId === partChange.id)
        .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0))[0];

      if (latestLog?.nextDueDate) {
        if (latestLog.nextDueDate.getTime() < now.getTime()) {
          overduePeriodicParts++;
        }
      }
    }

    return { overdueMaintenanceTasks, overduePeriodicParts };
  };

  // Calculate performance for each technician
  const performances: PersonnelPerformance[] = [];

  for (const user of technicians) {
    const isAplikasyon = user.role === 'aplikasyon';

    // Use primaryLaboratories for performance calculation, fallback to empty array
    const primaryLabs = user.primaryLaboratories || [];
    const hasPrimaryLabs = primaryLabs.length > 0;

    // Filter faults for primary laboratories only
    const allRelevantFaults = isAplikasyon ? aplikasyonFaults : teknikServisFaults;
    const relevantFaults = hasPrimaryLabs
      ? allRelevantFaults.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : allRelevantFaults;

    // 1. Fault Assignment Score (max 20 points)
    // Calculate expected faults based on primary laboratories
    // Each lab's faults are divided by the number of personnel who have that lab as primary
    const faultsByType = isAplikasyon ? aplikasyonFaults : teknikServisFaults;
    const expectedFaults = calculateExpectedFaults(primaryLabs, user.role, faultsByType);

    // Count faults assigned to this user (from primary labs only)
    const faultsAssigned = relevantFaults.filter(f => f.assignedToUid === user.uid).length;
    const totalFaultsForRole = relevantFaults.length;

    // Score based on meeting expected share
    // If user meets or exceeds expected: full 20 points
    // If user is below expected: proportional score
    let faultAssignmentScore = 0;
    if (expectedFaults > 0) {
      const fulfillmentRatio = faultsAssigned / expectedFaults;
      // Cap at 1.0 (meeting 100% of expectation = 20 points, 50% = 10 points)
      faultAssignmentScore = Math.min(20, fulfillmentRatio * 20);
    } else if (faultsAssigned > 0) {
      // No expected faults but user still took some (bonus)
      faultAssignmentScore = 20;
    }

    // 2. Intervention Start Time (max 15 points) - filter by primary labs
    const faultsWithIntervention = (hasPrimaryLabs
      ? allFaults.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : allFaults
    ).filter(f =>
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

    // 3. Resolution Time (max 15 points) - filter by primary labs
    const resolvedFaults = (hasPrimaryLabs
      ? allFaults.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : allFaults
    ).filter(f =>
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

    // 4. Institution Visit Frequency (max 15 points) - filter by primary labs
    const relevantForms = hasPrimaryLabs
      ? allForms.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : allForms;
    const relevantFaultsForVisits = hasPrimaryLabs
      ? allFaults.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : allFaults;

    const userForms = relevantForms.filter(f => f.createdByUid === user.uid).length;
    const onsiteInterventions = relevantFaultsForVisits.filter(f =>
      f.assignedToUid === user.uid && f.interventionType === 'yerinde'
    ).length;
    const phoneInterventions = relevantFaultsForVisits.filter(f =>
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

    // 6. Periodic Maintenance Contribution (max 20 points) - filter by primary labs
    const relevantPeriodicForms = hasPrimaryLabs
      ? relevantForms.filter(f => f.islemTuru === 'periyodik_bakim')
      : allForms.filter(f => f.islemTuru === 'periyodik_bakim');
    const totalRelevantPeriodicForms = relevantPeriodicForms.length;

    const userPeriodicForms = relevantPeriodicForms.filter(f => f.createdByUid === user.uid).length;
    let maintenanceContributionScore = 0;
    if (totalRelevantPeriodicForms > 0) {
      const ratio = userPeriodicForms / totalRelevantPeriodicForms;
      maintenanceContributionScore = Math.min(20, ratio * 100); // 20% contribution = 20 pts
    }

    // 7. Recurrence Penalty (-10 to 0 points) - filter by primary labs
    // Check if any fault recurred within 7 days after this user resolved it
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    let recurrenceCount = 0;

    const userResolvedFaultsForRecurrence = (hasPrimaryLabs
      ? allFaults.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : allFaults
    ).filter(f => f.closedByUid === user.uid && f.status === 'closed' && f.closedAt);

    for (const resolved of userResolvedFaultsForRecurrence) {
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

    // 8. Overdue Penalty (-15 to 0 points)
    // Penalty for overdue maintenance tasks and periodic part changes in primary laboratories
    const overdueData = hasPrimaryLabs
      ? calculateOverdueItems(primaryLabs, user.role)
      : { overdueMaintenanceTasks: 0, overduePeriodicParts: 0 };

    const { overdueMaintenanceTasks, overduePeriodicParts } = overdueData;
    const totalOverdue = overdueMaintenanceTasks + overduePeriodicParts;
    // -3 points per overdue item, max -15
    const overduePenalty = Math.max(-15, -totalOverdue * 3);

    // Calculate total score
    const totalScore = Math.max(0, Math.min(100,
      faultAssignmentScore +
      interventionTimeScore +
      resolutionTimeScore +
      visitFrequencyScore +
      onsiteRatioScore +
      maintenanceContributionScore +
      recurrencePenalty +
      overduePenalty
    ));

    performances.push({
      user,
      metrics: {
        totalFaultsForRole,
        expectedFaults,
        faultsAssigned,
        faultsResolved: resolvedFaults.length,
        avgInterventionStartTimeMinutes,
        avgResolutionTimeMinutes,
        institutionVisits,
        avgInstitutionVisits,
        onsiteInterventions,
        phoneInterventions,
        periodicMaintenanceForms: userPeriodicForms,
        totalPeriodicMaintenanceForms: totalRelevantPeriodicForms,
        recurrenceCount,
        overdueMaintenanceTasks,
        overduePeriodicParts,
        faultAssignmentScore,
        interventionTimeScore,
        resolutionTimeScore,
        visitFrequencyScore,
        onsiteRatioScore,
        maintenanceContributionScore,
        recurrencePenalty,
        overduePenalty,
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
