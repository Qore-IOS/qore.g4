import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

function toIsoString(value: any): string | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value?._seconds) return new Date(value._seconds * 1000).toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

const REQUEST_SOURCES = ['lab_to_depot', 'lab_to_office', 'depot_to_office'] as const;
const LAB_IDS_IN_CHUNK_SIZE = 30;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type HistoryOrder = FirebaseFirestore.DocumentData & { id: string };

function getCreatedAtMillis(order: FirebaseFirestore.DocumentData): number {
  if (typeof order.createdAt?.toDate === 'function') return order.createdAt.toDate().getTime();
  if (order.createdAt?._seconds) return order.createdAt._seconds * 1000;
  if (order.createdAt instanceof Date) return order.createdAt.getTime();
  return 0;
}

function splitIntoChunks<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function uniqueById(orders: HistoryOrder[]): HistoryOrder[] {
  const seen = new Set<string>();
  return orders.filter((order) => {
    if (seen.has(order.id)) return false;
    seen.add(order.id);
    return true;
  });
}

function isProductRequestOrder(order: FirebaseFirestore.DocumentData): boolean {
  if (!Array.isArray(order.items)) return false;
  if (!order.requestSource) return !!order.labId; // Legacy product requests did not persist requestSource.
  if (order.requestSource === 'depot_to_office') return !!order.depotId || order.isDepotRequest === true;
  return !!order.labId && REQUEST_SOURCES.includes(order.requestSource);
}

function sortHistoryOrders(orders: HistoryOrder[]): HistoryOrder[] {
  return uniqueById(orders)
    .filter(isProductRequestOrder)
    .sort((a, b) => getCreatedAtMillis(b) - getCreatedAtMillis(a));
}

async function fetchOrdersByLabIds(labIds: string[]): Promise<HistoryOrder[]> {
  const labChunks = splitIntoChunks(labIds, LAB_IDS_IN_CHUNK_SIZE);
  const snapshots = await Promise.all(labChunks.map((chunk) => adminDb.collection('orders')
    .where('labId', 'in', chunk)
    .get()));

  return sortHistoryOrders(snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }))));
}

async function fetchOrdersByLabId(labId: string): Promise<HistoryOrder[]> {
  const snapshot = await adminDb.collection('orders').where('labId', '==', labId).get();
  return sortHistoryOrders(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
}

async function fetchOrdersByDepotId(depotId: string): Promise<HistoryOrder[]> {
  const snapshot = await adminDb.collection('orders').where('depotId', '==', depotId).get();
  const depotRequests = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((order) => order.requestSource === 'depot_to_office' || order.isDepotRequest === true);
  return sortHistoryOrders(depotRequests);
}

async function fetchOrdersByCreatedById(createdById: string): Promise<HistoryOrder[]> {
  const snapshot = await adminDb.collection('orders').where('createdById', '==', createdById).get();
  return sortHistoryOrders(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
}

function mapHistoryOrder(order: HistoryOrder) {
  return {
    id: order.id,
    itemCount: Array.isArray(order.items) ? order.items.length : 0,
    createdBy: order.createdBy || '-',
    createdAt: toIsoString(order.createdAt),
    status: order.status || 'pending',
    urgency: order.urgency || 'normal',
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const createdById = searchParams.get('createdById');
    const labId = searchParams.get('labId');
    const depotId = searchParams.get('depotId');
    const labIds = searchParams.get('labIds')?.split(',').filter(Boolean);
    const pageSizeParam = searchParams.get('pageSize');
    const startAfterId = searchParams.get('startAfterId');
    const countOnly = searchParams.get('countOnly');

    let allData: HistoryOrder[];
    if (depotId) {
      allData = await fetchOrdersByDepotId(depotId);
    } else if (labIds && labIds.length > 0) {
      allData = await fetchOrdersByLabIds(labIds);
    } else if (labId) {
      allData = await fetchOrdersByLabId(labId);
    } else if (createdById) {
      allData = await fetchOrdersByCreatedById(createdById);
    } else {
      return NextResponse.json({ error: 'Filtreleme kriteri (depotId, labId veya createdById) zorunludur.' }, { status: 400 });
    }

    if (countOnly === 'true') {
      return NextResponse.json({ totalCount: allData.length });
    }

    const pageSize = Math.min(
      Math.max(1, Number(pageSizeParam) || DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE
    );

    let startIndex = 0;
    if (startAfterId) {
      const cursorIndex = allData.findIndex((item) => item.id === startAfterId);
      if (cursorIndex >= 0) startIndex = cursorIndex + 1;
    }

    const pagedData = allData.slice(startIndex, startIndex + pageSize);

    return NextResponse.json({
      data: pagedData.map(mapHistoryOrder),
      lastDocId: pagedData.length > 0 ? pagedData[pagedData.length - 1].id : null,
      hasMore: startIndex + pageSize < allData.length,
      strategy: 'merged-history-query',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Geçmiş verisi alınamadı.' },
      { status: 500 }
    );
  }
}
