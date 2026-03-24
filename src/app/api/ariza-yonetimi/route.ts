import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

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
function serializeFaultReport(doc: FirebaseFirestore.DocumentSnapshot): any {
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

// GET handler - fetch fault reports with filtering and pagination
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Filters
    const status = searchParams.get('status') || 'all';
    const lab = searchParams.get('lab') || 'all';
    const device = searchParams.get('device') || 'all';
    const opener = searchParams.get('opener') || 'all';
    const companyId = searchParams.get('companyId') || '';

    // Pagination
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // Fetch reports ordered by openedAt desc, with optional company filter
    let dbQuery: FirebaseFirestore.Query = adminDb
      .collection('deviceFaultReports')
      .orderBy('openedAt', 'desc');

    // Apply company filter if companyId is provided and not legacy
    if (companyId && companyId !== '__legacy__') {
      dbQuery = dbQuery.where('companyId', '==', companyId);
    }

    const snapshot = await dbQuery.get();

    // Serialize all documents
    const allReports = snapshot.docs
      .map(doc => serializeFaultReport(doc))
      .filter(Boolean);

    // Calculate status counts before filtering
    const statusCounts = {
      all: allReports.length,
      atama_bekliyor: 0,
      mudahale_bekliyor: 0,
      mudahale_ediliyor: 0,
      cozuldu: 0,
    };

    allReports.forEach((r: any) => {
      const normalized = normalizeStatus(r.status);
      if (normalized === 'atama_bekliyor') statusCounts.atama_bekliyor++;
      else if (normalized === 'mudahale_bekliyor') statusCounts.mudahale_bekliyor++;
      else if (normalized === 'mudahale_ediliyor') statusCounts.mudahale_ediliyor++;
      else if (normalized === 'cozuldu') statusCounts.cozuldu++;
    });

    // Extract unique filter options
    const uniqueLabs = [...new Set(allReports.map((r: any) => r.labName).filter(Boolean))];
    const uniqueDevices = [...new Set(allReports.map((r: any) => r.serial).filter(Boolean))];
    const uniqueOpeners = [...new Set(allReports.map((r: any) => r.openedByName).filter(Boolean))];

    // Apply filters
    let filteredReports = allReports;

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
    const totalPages = Math.ceil(totalFiltered / limit);
    const startIndex = (page - 1) * limit;
    const paginatedReports = filteredReports.slice(startIndex, startIndex + limit);

    return NextResponse.json({
      success: true,
      data: paginatedReports,
      pagination: {
        page,
        limit,
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

    // Delete the report
    await adminDb.collection('deviceFaultReports').doc(reportId).delete();

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
    await batch.commit();

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
