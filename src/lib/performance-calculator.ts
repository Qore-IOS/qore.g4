'use client';

import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User, MaintenancePlan, MaintenanceLog, PeriodicPartChange, PeriodicPartChangeLog, Device } from '@/lib/types';
import { isUnavailableAt, toDateValue, type PersonnelAvailabilityRecord } from '@/lib/personnel-availability';
import { companyQuery } from '@/lib/company-filter';

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
  supportCount: number;

  // Peer comparison metrics
  avgFaultsAssignedForRole: number;
  avgFaultsResolvedForRole: number;
  sameRoleTechnicianCount: number;

  // Overdue metrics
  overdueMaintenanceTasks: number;
  overduePeriodicParts: number;

  // Calculated scores
  faultAssignmentScore: number; // max 30 (fulfillment 20 + volume bonus 10)
  interventionTimeScore: number; // max 10 (continuous linear)
  resolutionTimeScore: number; // max 15 (quality 10 + volume 5)
  visitFrequencyScore: number; // max 10
  onsiteRatioScore: number; // max 10 (with sample threshold)
  maintenanceContributionScore: number; // max 15 (expected share based)
  supportScore: number; // max 10
  recurrencePenalty: number; // -10 to 0
  overduePenalty: number; // -15 to 0

  // Final score
  totalScore: number;
}

export interface PersonnelPerformance {
  user: User;
  metrics: PerformanceMetrics;
}

// Continuous intervention time score (max 10 points)
// Linear: 0 min = 10, 120 min (2h) = 0
function calculateInterventionTimeScore(avgMinutes: number): number {
  if (avgMinutes <= 0) return 0; // No data
  return Math.max(0, Math.min(10, 10 * (1 - avgMinutes / 120)));
}

// Continuous resolution time quality score (max 10 points)
// Linear: 0 min = 10, 480 min (8h) = 0
function calculateResolutionQualityScore(avgMinutes: number): number {
  if (avgMinutes <= 0) return 0; // No data
  return Math.max(0, Math.min(10, 10 * (1 - avgMinutes / 480)));
}

export interface PerformanceFilters {
  dateRange?: { start: Date | null; end: Date | null };
  selectedLaboratoryId?: string | null;
}

export async function calculateAllPerformances(filters?: PerformanceFilters, companyId?: string): Promise<PersonnelPerformance[]> {
  const { dateRange, selectedLaboratoryId } = filters || {};
  const hasDateFilter = dateRange?.start || dateRange?.end;
  const hasLabFilter = !!selectedLaboratoryId;
  // Fetch all required data
  const cid = companyId || '';
  const [
    usersSnap,
    faultsSnap,
    teknikFormsSnap,
    aplikasyonFormsSnap,
    devicesSnap,
    maintenancePlansSnap,
    maintenanceLogsSnap,
    periodicPartChangesSnap,
    periodicPartChangeLogsSnap,
    availabilitySnap,
  ] = await Promise.all([
    getDocs(companyQuery(db, 'users', cid)),
    getDocs(companyQuery(db, 'deviceFaultReports', cid)),
    getDocs(companyQuery(db, 'deviceActionForms', cid)),
    getDocs(companyQuery(db, 'aplikasyonActionForms', cid)),
    getDocs(companyQuery(db, 'devices', cid)),
    getDocs(companyQuery(db, 'maintenancePlans', cid)),
    getDocs(companyQuery(db, 'maintenanceLogs', cid)),
    getDocs(companyQuery(db, 'periodicPartChanges', cid)),
    getDocs(companyQuery(db, 'periodicPartChangeLogs', cid)),
    getDocs(companyQuery(db, 'personnelAvailability', cid)),
  ]);

  // Parse data
  const allUsers = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }) as User);
  let technicians = allUsers.filter(u => u.role === 'teknik_servis' || u.role === 'aplikasyon');

  // Filter technicians by selected laboratory (only those who have it as primary)
  if (hasLabFilter) {
    technicians = technicians.filter(u =>
      u.primaryLaboratories && u.primaryLaboratories.includes(selectedLaboratoryId!)
    );
  }

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
      supportPersonnelUid: data.supportPersonnelUid || null,
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

  let allForms = [...teknikForms, ...aplikasyonForms];

  const availabilityByUser = new Map<string, PersonnelAvailabilityRecord[]>();
  availabilitySnap.docs.forEach((doc) => {
    const data = doc.data();
    const startAt = toDateValue(data.startAt);
    const endAt = toDateValue(data.endAt);
    if (!data.uid || !startAt || !endAt) return;

    const type = data.type === 'training' ? 'training' : 'office';
    const current = availabilityByUser.get(data.uid) || [];
    current.push({
      id: doc.id,
      uid: data.uid,
      type,
      description: data.description || '',
      startAt,
      endAt,
      createdAt: toDateValue(data.createdAt),
      createdByUid: data.createdByUid || null,
    });
    availabilityByUser.set(data.uid, current);
  });

  // Helper function to check if a date is within range
  const isWithinDateRange = (date: Date | null): boolean => {
    if (!hasDateFilter || !date) return true;
    if (dateRange?.start && date < dateRange.start) return false;
    if (dateRange?.end) {
      // Include the entire end day
      const endOfDay = new Date(dateRange.end);
      endOfDay.setHours(23, 59, 59, 999);
      if (date > endOfDay) return false;
    }
    return true;
  };

  // Apply date and laboratory filters to faults
  let filteredFaults = allFaults;
  if (hasDateFilter) {
    filteredFaults = filteredFaults.filter(f => isWithinDateRange(f.openedAt));
  }
  if (hasLabFilter) {
    filteredFaults = filteredFaults.filter(f => f.hospitalId === selectedLaboratoryId);
  }

  // Apply date and laboratory filters to forms
  let filteredForms = allForms;
  if (hasDateFilter) {
    filteredForms = filteredForms.filter(f => isWithinDateRange(f.createdAt));
  }
  if (hasLabFilter) {
    filteredForms = filteredForms.filter(f => f.hospitalId === selectedLaboratoryId);
  }

  // Use filtered data for calculations when filters are applied
  const faultsForCalculation = (hasDateFilter || hasLabFilter) ? filteredFaults : allFaults;
  const formsForCalculation = (hasDateFilter || hasLabFilter) ? filteredForms : allForms;

  // Count faults by type
  const teknikServisFaults = faultsForCalculation.filter(f => f.faultType === 'teknik_servis');
  const aplikasyonFaults = faultsForCalculation.filter(f => f.faultType === 'aplikasyon');

  // Build map of lab -> personnel count (per role) for expected fault calculation
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
    userUid: string,
    userPrimaryLabs: string[],
    userRole: string,
    faultsByType: typeof allFaults
  ): number => {
    if (userPrimaryLabs.length === 0) return 0;

    const personnelPerLabMap = userRole === 'aplikasyon'
      ? aplikasyonPersonnelPerLab
      : teknikPersonnelPerLab;

    const userAvailability = availabilityByUser.get(userUid) || [];
    let expectedTotal = 0;

    for (const labId of userPrimaryLabs) {
      const faultsInLab = faultsByType.filter((f) => {
        if (f.hospitalId !== labId) return false;
        if (!f.openedAt) return true;
        return !isUnavailableAt(userAvailability, f.openedAt);
      }).length;
      const personnelCount = personnelPerLabMap.get(labId) || 1;
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

    const primaryLabDeviceIds = devices
      .filter(d => d.hospitalId && userPrimaryLabs.includes(d.hospitalId))
      .map(d => d.id);

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

  // ============================================================================
  // PRE-CALCULATE PEER AVERAGES (per role) for fair comparison
  // ============================================================================

  const teknikTechnicians = technicians.filter(u => u.role === 'teknik_servis');
  const aplikasyonTechnicians = technicians.filter(u => u.role === 'aplikasyon');

  // Pre-compute per-user fault counts for peer averaging
  const userFaultCounts = new Map<string, { assigned: number; resolved: number }>();
  for (const user of technicians) {
    const isAplikasyon = user.role === 'aplikasyon';
    const primaryLabs = user.primaryLaboratories || [];
    const hasPrimaryLabs = primaryLabs.length > 0;
    const allRelevantFaults = isAplikasyon ? aplikasyonFaults : teknikServisFaults;
    const relevantFaults = hasPrimaryLabs
      ? allRelevantFaults.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : allRelevantFaults;

    const assigned = relevantFaults.filter(f => f.assignedToUid === user.uid).length;

    const relevantFaultsForResolution = hasPrimaryLabs
      ? faultsForCalculation.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : faultsForCalculation;
    const resolved = relevantFaultsForResolution.filter(f =>
      f.closedByUid === user.uid && f.interventionStartedAt && f.closedAt
    ).length;

    userFaultCounts.set(user.uid, { assigned, resolved });
  }

  // Calculate averages per role
  const calcRoleAvg = (roleUsers: User[]) => {
    if (roleUsers.length === 0) return { avgAssigned: 0, avgResolved: 0 };
    const totals = roleUsers.reduce((acc, u) => {
      const counts = userFaultCounts.get(u.uid) || { assigned: 0, resolved: 0 };
      return { assigned: acc.assigned + counts.assigned, resolved: acc.resolved + counts.resolved };
    }, { assigned: 0, resolved: 0 });
    return {
      avgAssigned: totals.assigned / roleUsers.length,
      avgResolved: totals.resolved / roleUsers.length,
    };
  };

  const teknikAvg = calcRoleAvg(teknikTechnicians);
  const aplikasyonAvg = calcRoleAvg(aplikasyonTechnicians);

  // Calculate average institution visits per role
  const calcVisitAvg = (roleUsers: User[]) => {
    if (roleUsers.length === 0) return 0;
    const total = roleUsers.reduce((sum, user) => {
      const primaryLabs = user.primaryLaboratories || [];
      const hasPrimaryLabs = primaryLabs.length > 0;
      const relevantForms = hasPrimaryLabs
        ? formsForCalculation.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
        : formsForCalculation;
      const relevantFaultsForVisits = hasPrimaryLabs
        ? faultsForCalculation.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
        : faultsForCalculation;
      const userForms = relevantForms.filter(f => f.createdByUid === user.uid).length;
      const onsiteInterventions = relevantFaultsForVisits.filter(f =>
        f.assignedToUid === user.uid && f.interventionType === 'yerinde'
      ).length;
      return sum + userForms + onsiteInterventions;
    }, 0);
    return total / roleUsers.length;
  };

  const teknikVisitAvg = calcVisitAvg(teknikTechnicians);
  const aplikasyonVisitAvg = calcVisitAvg(aplikasyonTechnicians);

  // ============================================================================
  // CALCULATE PERFORMANCE FOR EACH TECHNICIAN
  // ============================================================================

  const performances: PersonnelPerformance[] = [];

  for (const user of technicians) {
    const isAplikasyon = user.role === 'aplikasyon';
    const primaryLabs = user.primaryLaboratories || [];
    const hasPrimaryLabs = primaryLabs.length > 0;

    // Peer averages for this user's role
    const roleAvg = isAplikasyon ? aplikasyonAvg : teknikAvg;
    const roleVisitAvg = isAplikasyon ? aplikasyonVisitAvg : teknikVisitAvg;
    const sameRoleTechnicianCount = isAplikasyon ? aplikasyonTechnicians.length : teknikTechnicians.length;

    // Filter faults for primary laboratories only
    const allRelevantFaults = isAplikasyon ? aplikasyonFaults : teknikServisFaults;
    const relevantFaults = hasPrimaryLabs
      ? allRelevantFaults.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : allRelevantFaults;

    // =========================================================================
    // 1. ARIZA ÜSTLENME & İŞ YÜKÜ (max 30 points)
    //    Fulfillment (max 20): Meeting expected share
    //    Volume bonus (max 10): Handling more than average
    // =========================================================================
    const faultsByType = isAplikasyon ? aplikasyonFaults : teknikServisFaults;
    const expectedFaults = calculateExpectedFaults(user.uid, primaryLabs, user.role, faultsByType);
    const faultsAssigned = relevantFaults.filter(f => f.assignedToUid === user.uid).length;
    const totalFaultsForRole = relevantFaults.length;

    let fulfillmentScore = 0;
    if (expectedFaults > 0) {
      // Proportional to meeting expected share (100% = 20 pts)
      fulfillmentScore = Math.min(20, (faultsAssigned / expectedFaults) * 20);
    } else if (roleAvg.avgAssigned > 0) {
      // No expected faults (no primary labs?) → compare against peer average
      fulfillmentScore = Math.min(20, (faultsAssigned / roleAvg.avgAssigned) * 20);
    } else if (faultsAssigned > 0) {
      // No baseline at all, but did some work
      fulfillmentScore = 10;
    }

    // Volume bonus: reward handling more faults than role average
    let volumeBonus = 0;
    if (roleAvg.avgAssigned > 0) {
      // 1x average = 5 pts, 2x average = 10 pts (max)
      volumeBonus = Math.min(10, (faultsAssigned / roleAvg.avgAssigned) * 5);
    } else if (faultsAssigned > 0) {
      volumeBonus = 5; // No average baseline, give partial
    }

    const faultAssignmentScore = Math.min(30, fulfillmentScore + volumeBonus);

    // =========================================================================
    // 2. MÜDAHALE BAŞLATMA HIZI (max 10 points) - Continuous linear
    //    0 min = 10 pts, 120 min = 0 pts
    // =========================================================================
    const faultsWithIntervention = (hasPrimaryLabs
      ? faultsForCalculation.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : faultsForCalculation
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

    // =========================================================================
    // 3. ÇÖZÜM SÜRESİ & BAŞARISI (max 15 points)
    //    Quality (max 10): Based on avg resolution time (continuous)
    //    Volume (max 5): Reward for resolving more faults than average
    // =========================================================================
    const resolvedFaults = (hasPrimaryLabs
      ? faultsForCalculation.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : faultsForCalculation
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

    const resolutionQuality = calculateResolutionQualityScore(avgResolutionTimeMinutes);

    // Volume component: resolved faults vs peer average
    let resolutionVolume = 0;
    if (roleAvg.avgResolved > 0) {
      // 1x average = 2.5 pts, 2x average = 5 pts (max)
      resolutionVolume = Math.min(5, (resolvedFaults.length / roleAvg.avgResolved) * 2.5);
    } else if (resolvedFaults.length > 0) {
      resolutionVolume = 2.5;
    }

    const resolutionTimeScore = resolutionQuality + resolutionVolume;

    // =========================================================================
    // 4. KURUM ZİYARETİ (max 10 points) - Relative to role average
    //    1x average = 5 pts, 2x average = 10 pts
    // =========================================================================
    const relevantForms = hasPrimaryLabs
      ? formsForCalculation.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : formsForCalculation;
    const relevantFaultsForVisits = hasPrimaryLabs
      ? faultsForCalculation.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : faultsForCalculation;

    const userForms = relevantForms.filter(f => f.createdByUid === user.uid).length;
    const onsiteInterventions = relevantFaultsForVisits.filter(f =>
      f.assignedToUid === user.uid && f.interventionType === 'yerinde'
    ).length;
    const phoneInterventions = relevantFaultsForVisits.filter(f =>
      f.assignedToUid === user.uid && f.interventionType === 'telefonla'
    ).length;
    const institutionVisits = userForms + onsiteInterventions;

    let visitFrequencyScore = 0;
    if (roleVisitAvg > 0) {
      const ratio = institutionVisits / roleVisitAvg;
      visitFrequencyScore = Math.min(10, ratio * 5); // 2x average = 10 pts
    } else if (institutionVisits > 0) {
      visitFrequencyScore = 5;
    }

    // =========================================================================
    // 5. KURUMDA MÜDAHALE ORANI (max 10 points) - With sample threshold
    //    100% on-site = 10 pts, but scaled down if < 3 total interventions
    // =========================================================================
    const totalInterventions = onsiteInterventions + phoneInterventions;
    let onsiteRatioScore = 0;
    if (totalInterventions > 0) {
      const onsiteRatio = onsiteInterventions / totalInterventions;
      let baseScore = onsiteRatio * 10;
      // Scale down for small sample sizes to prevent 1/1 = 100% scoring full points
      if (totalInterventions < 3) {
        baseScore = baseScore * (totalInterventions / 3);
      }
      onsiteRatioScore = baseScore;
    }

    // =========================================================================
    // 6. PERİYODİK BAKIM KATKISI (max 15 points) - Expected share based
    //    If there are N technicians of same role and T total periodic forms,
    //    each should do T/N. Score = (actual / expected) * 15
    // =========================================================================
    const relevantPeriodicForms = hasPrimaryLabs
      ? relevantForms.filter(f => f.islemTuru === 'periyodik_bakim')
      : formsForCalculation.filter(f => f.islemTuru === 'periyodik_bakim');
    const totalRelevantPeriodicForms = relevantPeriodicForms.length;

    const userPeriodicForms = relevantPeriodicForms.filter(f => f.createdByUid === user.uid).length;
    let maintenanceContributionScore = 0;
    if (totalRelevantPeriodicForms > 0 && sameRoleTechnicianCount > 0) {
      const expectedShare = totalRelevantPeriodicForms / sameRoleTechnicianCount;
      if (expectedShare > 0) {
        maintenanceContributionScore = Math.min(15, (userPeriodicForms / expectedShare) * 15);
      }
    }

    // =========================================================================
    // 7. TEKRAR ARIZA CEZASI (-10 to 0 points)
    //    -2 per recurrence within 3 hours, max -10
    // =========================================================================
    const recurrenceWindowMs = 3 * 60 * 60 * 1000;
    let recurrenceCount = 0;

    const userResolvedFaultsForRecurrence = (hasPrimaryLabs
      ? faultsForCalculation.filter(f => f.hospitalId && primaryLabs.includes(f.hospitalId))
      : faultsForCalculation
    ).filter(f => f.closedByUid === user.uid && f.status === 'closed' && f.closedAt);

    for (const resolved of userResolvedFaultsForRecurrence) {
      const hasRecurrence = faultsForCalculation.some(f =>
        f.id !== resolved.id &&
        f.deviceId === resolved.deviceId &&
        f.openedAt &&
        resolved.closedAt &&
        f.openedAt.getTime() > resolved.closedAt.getTime() &&
        f.openedAt.getTime() - resolved.closedAt.getTime() <= recurrenceWindowMs
      );
      if (hasRecurrence) recurrenceCount++;
    }

    const recurrencePenalty = Math.max(-10, -recurrenceCount * 2);

    // =========================================================================
    // 8. GECİKMİŞ BAKIM CEZASI (-15 to 0 points)
    //    -3 per overdue item, max -15
    // =========================================================================
    const overdueData = hasPrimaryLabs
      ? calculateOverdueItems(primaryLabs, user.role)
      : { overdueMaintenanceTasks: 0, overduePeriodicParts: 0 };

    const { overdueMaintenanceTasks, overduePeriodicParts } = overdueData;
    const totalOverdue = overdueMaintenanceTasks + overduePeriodicParts;
    const overduePenalty = Math.max(-15, -totalOverdue * 3);

    // =========================================================================
    // 9. DESTEK PUANI (max 10 points)
    //    2 points per support, max 10
    // =========================================================================
    const supportCount = faultsForCalculation.filter(f =>
      f.supportPersonnelUid === user.uid &&
      (f.status === 'cozuldu' || f.status === 'closed')
    ).length;

    const supportScore = Math.min(10, supportCount * 2);

    // =========================================================================
    // TOTAL SCORE (clamped 0-100)
    // =========================================================================
    const totalScore = Math.max(0, Math.min(100,
      faultAssignmentScore +
      interventionTimeScore +
      resolutionTimeScore +
      visitFrequencyScore +
      onsiteRatioScore +
      maintenanceContributionScore +
      supportScore +
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
        avgInstitutionVisits: roleVisitAvg,
        onsiteInterventions,
        phoneInterventions,
        periodicMaintenanceForms: userPeriodicForms,
        totalPeriodicMaintenanceForms: totalRelevantPeriodicForms,
        recurrenceCount,
        supportCount,
        avgFaultsAssignedForRole: roleAvg.avgAssigned,
        avgFaultsResolvedForRole: roleAvg.avgResolved,
        sameRoleTechnicianCount,
        overdueMaintenanceTasks,
        overduePeriodicParts,
        faultAssignmentScore,
        interventionTimeScore,
        resolutionTimeScore,
        visitFrequencyScore,
        onsiteRatioScore,
        maintenanceContributionScore,
        supportScore,
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
