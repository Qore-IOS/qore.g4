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
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const createdById = searchParams.get('createdById');

    if (!createdById) {
      return NextResponse.json({ error: 'createdById zorunludur.' }, { status: 400 });
    }

    try {
      const snapshot = await adminDb
        .collection('orders')
        .where('requestSource', '==', 'lab_to_depot')
        .where('createdById', '==', createdById)
        .orderBy('createdAt', 'desc')
        .get();

      return NextResponse.json({ data: buildHistoryData(snapshot), strategy: 'indexed-query' });
    } catch (error: any) {
      if (!isMissingIndexError(error)) {
        throw error;
      }

      // Fallback: index henüz deploy edilmemiş ortamlarda çalışmaya devam et
      const fallbackSnapshot = await adminDb
        .collection('orders')
        .where('createdById', '==', createdById)
        .get();

      const data = fallbackSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((order: any) => order.requestSource === 'lab_to_depot')
        .sort((a: any, b: any) => {
          const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
          const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
          return bTime - aTime;
        })
        .map((order: any) => ({
          id: order.id,
          itemCount: Array.isArray(order.items) ? order.items.length : 0,
          createdBy: order.createdBy || '-',
          createdAt: toIsoString(order.createdAt),
        }));

      return NextResponse.json({ data, strategy: 'fallback-query' });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Geçmiş verisi alınamadı.' },
      { status: 500 }
    );
  }
}
