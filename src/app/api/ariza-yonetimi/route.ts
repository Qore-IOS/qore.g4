import type * as DocumentStore from '../../../lib/data/admin';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '../../../lib/data/admin';
import { matchesCompanyScope } from '@/lib/company-scope';

// Firestore Timestamp to Date converter
function convertTimestamp(timestamp: any): string | null {
  if (!timestamp) return null;
  if (timestamp._seconds !== undefined) {
    return new Date(timestamp._seconds * 1000).toISOString();
  }
  if (timestamp.toDate) {
    return timestamp.toDate().toISOString();
  }
  return null;
}

// Serialize fault report data
function serializeFaultReport(doc: DocumentStore.DocumentSnapshot): any {
  const data = doc.data();
  if (!data) return null;

  return {
    id: doc.id,
    ...data,
    openedAt: convertTimestamp(data.openedAt),
    closedAt: convertTimestamp(data.closedAt),
    assignedAt: convertTimestamp(data.assignedAt),
    interventionStartedAt: convertTimestamp(data.interventionStartedAt),
    locationVerifiedAt: convertTimestamp(data.locationVerifiedAt),
    createdAt: convertTimestamp(data.createdAt),
  };
}

// Normalize status for legacy values
function normalizeStatus(status: string): string {
  if (status === 'open') return 'atama_bekliyor';
  if (status === 'closed') return 'cozuldu';
  return status;
}

function toUnixMs(value: any): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof value === 'number') return value;
  if (value._seconds !== undefined) return value._seconds * 1000;
  if (value.seconds !== undefined) return value.seconds * 1000;
  if (typeof value.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
  }
  return 0;
}

// GET handler - fetch fault reports with filtering and pagination
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Filters
    const status = searchParams.get('status') || 'all';
    const lab = searchParams.get('lab') || 'all';
    const device = searchParams.get('device') || 'all';
    const opener = searchParams.get('opener') || 'all';
    const companyId = searchParams.get('companyId') || undefined;
    const isSuperAdmin = searchParams.get('isSuperAdmin') === '1';
    const isAdmin = searchParams.get('isAdmin') === '1';
    const assignedLabsParam = searchParams.get('assignedLabs') || '';
    const assignedLabIds = assignedLabsParam
      ? assignedLabsParam.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Pagination
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const exportAll = searchParams.get('all') === '1';

    // Fetch all reports.
    // NOTE: orderBy('openedAt') hides documents where openedAt is missing.
    // After company filter rollout, some records may only have createdAt.
    const snapshot = await adminDb
      .collection('deviceFaultReports')
      .get();

    // Serialize all documents
    const allReports = snapshot.docs
      .map(doc => serializeFaultReport(doc))
      .filter(Boolean);

    const companyScopedReports = allReports.filter((r: any) =>
      matchesCompanyScope(r, companyId, isSuperAdmin)
    );

    // Lab-level filter: super admins and admins see everything within their
    // company; everyone else only sees reports for their assigned labs.
    const allowedLabs = new Set(assignedLabIds);
    const scopedReports = (isSuperAdmin || isAdmin || allowedLabs.size === 0)
      ? companyScopedReports
      : companyScopedReports.filter((r: any) => {
          const candidate = r.hospitalId || r.labId || '';
          return candidate ? allowedLabs.has(candidate) : true;
        });

    // Keep newest reports first using openedAt, then createdAt fallback.
    scopedReports.sort((a: any, b: any) => {
      const aMs = toUnixMs(a.openedAt) || toUnixMs(a.createdAt);
      const bMs = toUnixMs(b.openedAt) || toUnixMs(b.createdAt);
      return bMs - aMs;
    });

    // Calculate status counts before filtering
    const statusCounts = {
      all: scopedReports.length,
      atama_bekliyor: 0,
      mudahale_bekliyor: 0,
      mudahale_ediliyor: 0,
      cozuldu: 0,
    };

    scopedReports.forEach((r: any) => {
      const normalized = normalizeStatus(r.status);
      if (normalized === 'atama_bekliyor') statusCounts.atama_bekliyor++;
      else if (normalized === 'mudahale_bekliyor') statusCounts.mudahale_bekliyor++;
      else if (normalized === 'mudahale_ediliyor') statusCounts.mudahale_ediliyor++;
      else if (normalized === 'cozuldu') statusCounts.cozuldu++;
    });

    // Extract unique filter options
    const uniqueLabs = [...new Set(scopedReports.map((r: any) => r.labName).filter(Boolean))];
    const uniqueDevices = [...new Set(scopedReports.map((r: any) => r.serial).filter(Boolean))];
    const uniqueOpeners = [...new Set(scopedReports.map((r: any) => r.openedByName).filter(Boolean))];

    // Apply filters
    let filteredReports = scopedReports;

    if (status !== 'all') {
      filteredReports = filteredReports.filter((r: any) => normalizeStatus(r.status) === status);
    }

    if (lab !== 'all') {
      filteredReports = filteredReports.filter((r: any) => r.labName === lab);
    }

    if (device !== 'all') {
      filteredReports = filteredReports.filter((r: any) => r.serial === device);
    }

    if (opener !== 'all') {
      filteredReports = filteredReports.filter((r: any) => r.openedByName === opener);
    }

    // Pagination
    const totalFiltered = filteredReports.length;
    const totalPages = exportAll ? 1 : Math.ceil(totalFiltered / limit);
    const startIndex = (page - 1) * limit;
    const paginatedReports = exportAll
      ? filteredReports
      : filteredReports.slice(startIndex, startIndex + limit);

    return NextResponse.json({
      success: true,
      data: paginatedReports,
      pagination: {
        page: exportAll ? 1 : page,
        limit: exportAll ? totalFiltered : limit,
        totalFiltered,
        totalPages,
      },
      statusCounts,
      filterOptions: {
        labs: uniqueLabs,
        devices: uniqueDevices,
        openers: uniqueOpeners,
      },
    });
  } catch (error: any) {
    console.error('Error fetching fault reports:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Arıza kayıtları alınamadı' },
      { status: 500 }
    );
  }
}

// DELETE handler - delete a fault report
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get('id');

    if (!reportId) {
      return NextResponse.json(
        { success: false, error: 'Rapor ID gerekli' },
        { status: 400 }
      );
    }

    const reportRef = adminDb.collection('deviceFaultReports').doc(reportId);
    const reportSnap = await reportRef.get();
    const reportData = reportSnap.data() || {};
    const deviceId = typeof reportData.deviceId === 'string' ? reportData.deviceId : '';

    // Also delete any history subcollection documents
    const historySnapshot = await adminDb
      .collection('deviceFaultReports')
      .doc(reportId)
      .collection('history')
      .get();

    const batch = adminDb.batch();
    historySnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    batch.delete(reportRef);
    await batch.commit();

    // Keep devices collection consistent with arıza yönetimi:
    // if no open report remains for this device, clear arızaDurumu.
    if (deviceId) {
      const remainingOpenSnap = await adminDb
        .collection('deviceFaultReports')
        .where('deviceId', '==', deviceId)
        .where('status', 'in', ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'])
        .limit(1)
        .get();

      if (remainingOpenSnap.empty) {
        await adminDb.collection('devices').doc(deviceId).set({
          arizaDurumu: 'yok',
          arizaAciklamasi: '',
        }, { merge: true });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Arıza kaydı silindi',
    });
  } catch (error: any) {
    console.error('Error deleting fault report:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Arıza kaydı silinemedi' },
      { status: 500 }
    );
  }
}
