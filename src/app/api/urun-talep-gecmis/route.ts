import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

function toIsoString(value: any): string | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value?._seconds) return new Date(value._seconds * 1000).toISOString();
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const createdById = searchParams.get('createdById');

    if (!createdById) {
      return NextResponse.json({ error: 'createdById zorunludur.' }, { status: 400 });
    }

    const snapshot = await adminDb
      .collection('orders')
      .where('requestSource', '==', 'lab_to_depot')
      .where('createdById', '==', createdById)
      .orderBy('createdAt', 'desc')
      .get();

    const data = snapshot.docs.map((doc) => {
      const order = doc.data();
      return {
        id: doc.id,
        itemCount: Array.isArray(order.items) ? order.items.length : 0,
        createdBy: order.createdBy || '-',
        createdAt: toIsoString(order.createdAt),
      };
    });

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Geçmiş verisi alınamadı.' }, { status: 500 });
  }
}
