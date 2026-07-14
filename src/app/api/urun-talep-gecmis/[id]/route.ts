import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

function toIsoString(value: any): string | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value?._seconds) return new Date(value._seconds * 1000).toISOString();
  return null;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const ref = adminDb.collection('orders').doc(params.id);
    const snapshot = await ref.get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: 'Sipariş bulunamadı.' }, { status: 404 });
    }

    const order = snapshot.data();

    if (order?.requestSource && order.requestSource !== 'lab_to_depot' && order.requestSource !== 'lab_to_office') {
      return NextResponse.json({ error: 'Bu kayıt ürün talep geçmişine ait değil.' }, { status: 400 });
    }

    return NextResponse.json({
      data: {
        id: snapshot.id,
        createdBy: order.createdBy || '-',
        kurumAdi: order.kurumAdi || '-',
        depotName: order.depotName || '-',
        createdAt: toIsoString(order.createdAt),
        items: Array.isArray(order.items) ? order.items : [],
        status: order.status || 'pending',
        urgency: order.urgency || 'normal',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Sipariş detayı alınamadı.' }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const ref = adminDb.collection('orders').doc(params.id);
    const snapshot = await ref.get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: 'Sipariş bulunamadı.' }, { status: 404 });
    }

    const order = snapshot.data();

    // Only allow deletion if pending
    if (order?.status !== 'pending') {
      return NextResponse.json({ error: 'Sadece beklemedeki siparişler silinebilir.' }, { status: 400 });
    }

    await ref.delete();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Sipariş silinemedi.' }, { status: 500 });
  }
}
