import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '../../../../lib/data/admin';

function activityLog(action: string, message: string, uid?: string, name?: string) {
  return {
    id: `al_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action,
    message,
    createdAt: new Date(),
    createdByUid: uid || 'system',
    createdByName: name || 'Sistem',
  };
}

export async function POST(req: NextRequest) {
  try {
    const { taskId, completed, userUid, userName } = await req.json();
    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json({ ok: false, error: 'Geçersiz görev kimliği' }, { status: 400 });
    }
    if (typeof completed !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'Geçersiz tamamlanma durumu' }, { status: 400 });
    }

    const ref = adminDb.collection('purchasingTasks').doc(taskId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: 'Görev bulunamadı' }, { status: 404 });
    }

    const data = snap.data() as any;
    const logs = Array.isArray(data?.activityLogs) ? data.activityLogs : [];
    const log = activityLog(
      completed ? 'completed' : 'reopened',
      completed ? 'Görev tamamlandı (API fallback)' : 'Görev yeniden açıldı (API fallback)',
      userUid,
      userName
    );

    await ref.update({
      completed,
      updatedAt: new Date(),
      activityLogs: [...logs, log],
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Görev güncellenemedi' }, { status: 500 });
  }
}
