import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import '@/lib/firebase-admin';

const STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const ALLOWED_PREFIXES = ['irsaliyeler/', 'removed-parts/', 'used-parts/'];

export async function POST(request: NextRequest) {
  try {
    const { storagePath } = await request.json();

    if (!storagePath || typeof storagePath !== 'string') {
      return NextResponse.json({ error: 'storagePath gerekli' }, { status: 400 });
    }

    if (!ALLOWED_PREFIXES.some(prefix => storagePath.startsWith(prefix))) {
      return NextResponse.json({ error: 'Geçersiz dosya yolu' }, { status: 403 });
    }

    const bucket = STORAGE_BUCKET
      ? admin.storage().bucket(STORAGE_BUCKET)
      : admin.storage().bucket();

    const file = bucket.file(storagePath);
    await file.delete({ ignoreNotFound: true });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Storage delete file error:', error);
    return NextResponse.json({ error: error?.message || 'Dosya silinemedi' }, { status: 500 });
  }
}
