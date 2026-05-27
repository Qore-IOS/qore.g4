import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

/**
 * Transfer Raporu API
 * Depodan laboratuvarlara yapılan transferlerin ürün bazlı raporunu oluşturur
 */

interface TransferReportRequest {
  sourceDepotId: string;
  targetLabIds: string[];
  startDate?: string; // ISO date string
  endDate?: string; // ISO date string
  marka?: string;
  urunGrubu?: 'kit' | 'sarf' | 'yedek_parca';
  stokKodu?: string;
  /** Caller's company id — server-side filter for cross-tenant isolation. */
  companyId?: string | null;
  /** Caller's super-admin flag — bypasses company filter. */
  isSuperAdmin?: boolean;
}

interface ProductTransferSummary {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  urunGrubu: string;
  totalTransferred: number;
  monthlyAverage: number;
  last3MonthsAverage: number;
  monthlyData: { month: string; count: number }[];
}

// Firestore Timestamp to Date converter
function toDate(timestamp: any): Date | null {
  if (!timestamp) return null;
  if (timestamp._seconds !== undefined) {
    return new Date(timestamp._seconds * 1000);
  }
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }
  if (timestamp instanceof Date) {
    return timestamp;
  }
  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    return new Date(timestamp);
  }
  return null;
}

// Get month string in YYYY-MM format
function getMonthString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Get last N months from current date
function getLastNMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(getMonthString(date));
  }
  return months;
}

// POST handler - generate transfer report
export async function POST(request: NextRequest) {
  try {
    const body: TransferReportRequest = await request.json();
    const { sourceDepotId, targetLabIds, startDate, endDate, marka, urunGrubu, stokKodu, companyId, isSuperAdmin } = body;

    // Validation
    if (!sourceDepotId) {
      return NextResponse.json(
        { success: false, error: 'Kaynak depo seçilmelidir.' },
        { status: 400 }
      );
    }

    if (!targetLabIds || targetLabIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'En az bir laboratuvar seçilmelidir.' },
        { status: 400 }
      );
    }

    // Build query for transfers — company-scoped (cross-tenant isolation)
    let query = adminDb.collection('transfers')
      .where('sourceDepotId', '==', sourceDepotId)
      .where('mode', '==', 'lab') as FirebaseFirestore.Query;
    if (!isSuperAdmin) {
      const normalizedCompanyId = (companyId && companyId.trim()) || '__legacy__';
      query = query.where('companyId', '==', normalizedCompanyId);
    }

    // Get all transfers and filter by target labs (Firestore doesn't support array-contains-any with other filters)
    const transfersSnapshot = await query.get();

    // Filter by target labs and date range
    const filteredTransfers: { id: string; data: any }[] = [];
    const startDateTime = startDate ? new Date(startDate) : null;
    const endDateTime = endDate ? new Date(endDate) : null;

    // Set end date to end of day
    if (endDateTime) {
      endDateTime.setHours(23, 59, 59, 999);
    }

    for (const doc of transfersSnapshot.docs) {
      const data = doc.data();

      // Check if target is in selected labs
      if (!targetLabIds.includes(data.targetHospitalId)) {
        continue;
      }

      // Check date range
      const transferDate = toDate(data.timestamp);
      if (transferDate) {
        if (startDateTime && transferDate < startDateTime) continue;
        if (endDateTime && transferDate > endDateTime) continue;
      }

      filteredTransfers.push({ id: doc.id, data });
    }

    // Fetch product codes for filtering and metadata
    const productCodesSnapshot = await adminDb.collection('productCodes').get();
    const productCodesMap = new Map<string, any>();
    productCodesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      productCodesMap.set(data.stokKodu, data);
    });

    // Aggregate transfer items by product
    const productTransfers = new Map<string, {
      stokKodu: string;
      stokAdi: string;
      marka: string;
      urunGrubu: string;
      totalCount: number;
      monthlyBreakdown: Map<string, number>;
    }>();

    // Process each transfer and its items
    for (const transfer of filteredTransfers) {
      const transferDate = toDate(transfer.data.timestamp);
      const monthKey = transferDate ? getMonthString(transferDate) : 'unknown';

      // Fetch items from subcollection
      const itemsSnapshot = await adminDb
        .collection('transfers')
        .doc(transfer.id)
        .collection('items')
        .get();

      for (const itemDoc of itemsSnapshot.docs) {
        const item = itemDoc.data();
        const productInfo = productCodesMap.get(item.stokKodu);

        // Apply filters
        if (marka && productInfo?.marka !== marka) continue;
        if (urunGrubu && productInfo?.urunGrubu !== urunGrubu) continue;
        if (stokKodu && item.stokKodu !== stokKodu) continue;

        const key = item.stokKodu;
        if (!productTransfers.has(key)) {
          productTransfers.set(key, {
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi || productInfo?.stokAdi || 'Bilinmiyor',
            marka: productInfo?.marka || '-',
            urunGrubu: productInfo?.urunGrubu || '-',
            totalCount: 0,
            monthlyBreakdown: new Map(),
          });
        }

        const product = productTransfers.get(key)!;
        product.totalCount += 1;
        product.monthlyBreakdown.set(
          monthKey,
          (product.monthlyBreakdown.get(monthKey) || 0) + 1
        );
      }
    }

    // Calculate statistics
    const last3Months = getLastNMonths(3);
    const last6Months = getLastNMonths(6);
    const now = new Date();

    const results: ProductTransferSummary[] = [];

    for (const [, product] of productTransfers) {
      // Calculate period months for monthly average
      let periodMonths: number;
      if (startDateTime && endDateTime) {
        // Calculate months between start and end date
        const monthsDiff = (endDateTime.getFullYear() - startDateTime.getFullYear()) * 12
          + (endDateTime.getMonth() - startDateTime.getMonth()) + 1;
        periodMonths = Math.max(1, monthsDiff);
      } else if (startDateTime) {
        // From start date to now
        const monthsDiff = (now.getFullYear() - startDateTime.getFullYear()) * 12
          + (now.getMonth() - startDateTime.getMonth()) + 1;
        periodMonths = Math.max(1, monthsDiff);
      } else {
        // All time - estimate based on available data
        const allMonths = Array.from(product.monthlyBreakdown.keys()).sort();
        if (allMonths.length > 0) {
          const firstMonth = allMonths[0];
          const [firstYear, firstMonthNum] = firstMonth.split('-').map(Number);
          const monthsDiff = (now.getFullYear() - firstYear) * 12
            + (now.getMonth() + 1 - firstMonthNum) + 1;
          periodMonths = Math.max(1, monthsDiff);
        } else {
          periodMonths = 1;
        }
      }

      // Monthly average for the selected period
      const monthlyAverage = product.totalCount / periodMonths;

      // Last 3 months average
      let last3MonthsTotal = 0;
      for (const month of last3Months) {
        last3MonthsTotal += product.monthlyBreakdown.get(month) || 0;
      }
      const last3MonthsAverage = last3MonthsTotal / 3;

      // Last 6 months data for chart
      const monthlyData: { month: string; count: number }[] = [];
      for (const month of last6Months.reverse()) {
        monthlyData.push({
          month,
          count: product.monthlyBreakdown.get(month) || 0,
        });
      }

      results.push({
        stokKodu: product.stokKodu,
        stokAdi: product.stokAdi,
        marka: product.marka,
        urunGrubu: product.urunGrubu,
        totalTransferred: product.totalCount,
        monthlyAverage: Math.round(monthlyAverage * 100) / 100,
        last3MonthsAverage: Math.round(last3MonthsAverage * 100) / 100,
        monthlyData,
      });
    }

    // Sort by total transferred descending
    results.sort((a, b) => b.totalTransferred - a.totalTransferred);

    return NextResponse.json({
      success: true,
      data: results,
      meta: {
        totalProducts: results.length,
        totalTransfers: filteredTransfers.length,
        sourceDepotId,
        targetLabIds,
        dateRange: {
          start: startDate || null,
          end: endDate || null,
        },
        filters: {
          marka: marka || null,
          urunGrubu: urunGrubu || null,
          stokKodu: stokKodu || null,
        },
      },
    });
  } catch (error: any) {
    console.error('Transfer report error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Rapor oluşturulurken bir hata oluştu' },
      { status: 500 }
    );
  }
}

// GET handler - get available filter options
export async function GET(request: NextRequest) {
  try {
    // Fetch depots
    const depotsSnapshot = await adminDb.collection('depots').get();
    const depots = depotsSnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name,
    }));

    // Fetch hospitals/laboratories
    const hospitalsSnapshot = await adminDb.collection('hospitals').get();
    const laboratories = hospitalsSnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name || doc.data().ad,
    }));

    // Fetch unique brands and product groups from productCodes
    const productCodesSnapshot = await adminDb.collection('productCodes').get();
    const brands = new Set<string>();
    const products: { stokKodu: string; stokAdi: string }[] = [];

    productCodesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.marka) brands.add(data.marka);
      products.push({
        stokKodu: data.stokKodu,
        stokAdi: data.stokAdi,
      });
    });

    return NextResponse.json({
      success: true,
      data: {
        depots,
        laboratories,
        brands: Array.from(brands).sort(),
        productGroups: ['kit', 'sarf', 'yedek_parca'],
        products: products.sort((a, b) => a.stokAdi.localeCompare(b.stokAdi, 'tr')),
      },
    });
  } catch (error: any) {
    console.error('Transfer report options error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Filtre seçenekleri alınamadı' },
      { status: 500 }
    );
  }
}
