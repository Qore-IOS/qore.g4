import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

function toIsoString(value: any): string | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value?._seconds) return new Date(value._seconds * 1000).toISOString();
  return null;
}

function isMissingIndexError(error: any): boolean {
  return (
    error?.code === 9 ||
    error?.code === 'failed-precondition' ||
    String(error?.message || '').toLowerCase().includes('index')
  );
}

function buildHistoryData(snapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>) {
  return snapshot.docs.map((doc) => {
    const order = doc.data();
    return {
      id: doc.id,
      itemCount: Array.isArray(order.items) ? order.items.length : 0,
      createdBy: order.createdBy || '-',
      createdAt: toIsoString(order.createdAt),
      status: order.status || 'pending',
      urgency: order.urgency || 'normal',
    };
  });
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const createdById = searchParams.get('createdById');
    const labId = searchParams.get('labId');
    const labIds = searchParams.get('labIds')?.split(',').filter(Boolean);
    const pageSizeParam = searchParams.get('pageSize');
    const startAfterId = searchParams.get('startAfterId');
    const countOnly = searchParams.get('countOnly');

    // Build base query
    let baseQuery: FirebaseFirestore.Query = adminDb.collection('orders')
      .where('requestSource', '==', 'lab_to_depot');

    if (labIds && labIds.length > 0) {
      // If we have multiple labs, we use 'in' operator (limited to 30 labs)
      baseQuery = baseQuery.where('labId', 'in', labIds.slice(0, 30));
    } else if (labId) {
      baseQuery = baseQuery.where('labId', '==', labId);
    } else if (createdById) {
      baseQuery = baseQuery.where('createdById', '==', createdById);
    } else {
      return NextResponse.json({ error: 'Filtreleme kriteri (labId veya createdById) zorunludur.' }, { status: 400 });
    }

    // Count-only request
    if (countOnly === 'true') {
      try {
        const countSnapshot = await baseQuery.count().get();
        return NextResponse.json({ totalCount: countSnapshot.data().count });
      } catch (error: any) {
        if (!isMissingIndexError(error)) throw error;

        // Fallback count
        const fallbackSnapshot = await baseQuery.get();
        return NextResponse.json({ totalCount: fallbackSnapshot.docs.length });
      }
    }

    const pageSize = Math.min(
      Math.max(1, Number(pageSizeParam) || DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE
    );

    try {
      let queryRef: FirebaseFirestore.Query = baseQuery
        .orderBy('createdAt', 'desc')
        .limit(pageSize);

      // Cursor-based pagination
      if (startAfterId) {
        const cursorDoc = await adminDb.collection('orders').doc(startAfterId).get();
        if (cursorDoc.exists) {
          queryRef = baseQuery
            .orderBy('createdAt', 'desc')
            .startAfter(cursorDoc)
            .limit(pageSize);
        }
      }

      const snapshot = await queryRef.get();
      const data = buildHistoryData(snapshot);
      const lastDocId = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : null;
      const hasMore = snapshot.docs.length === pageSize;

      return NextResponse.json({
        data,
        lastDocId,
        hasMore,
        strategy: 'indexed-query',
      });
    } catch (error: any) {
      if (!isMissingIndexError(error)) {
        throw error;
      }

      // Fallback: manually filter and sort if index is missing
      // Note: For 'in' queries, we'd need more complex fallback.
      // Usually index is better.
      const fallbackSnapshot = await baseQuery.get();

      const allData = fallbackSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .sort((a: any, b: any) => {
          const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
          const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
          return bTime - aTime;
        });

      let startIndex = 0;
      if (startAfterId) {
        const cursorIndex = allData.findIndex((item) => item.id === startAfterId);
        if (cursorIndex >= 0) {
          startIndex = cursorIndex + 1;
        }
      }

      const pagedData = allData.slice(startIndex, startIndex + pageSize);
      const data = pagedData.map((order: any) => ({
        id: order.id,
        itemCount: Array.isArray(order.items) ? order.items.length : 0,
        createdBy: order.createdBy || '-',
        createdAt: toIsoString(order.createdAt),
        status: order.status || 'pending',
        urgency: order.urgency || 'normal',
      }));

      const lastDocId = data.length > 0 ? data[data.length - 1].id : null;
      const hasMore = startIndex + pageSize < allData.length;

      return NextResponse.json({
        data,
        lastDocId,
        hasMore,
        strategy: 'fallback-query',
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Geçmiş verisi alınamadı.' },
      { status: 500 }
    );
  }
}
