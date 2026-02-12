import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import '@/lib/firebase-admin';

const STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

const ALLOWED_FOLDERS = new Set(['removed-parts', 'used-parts']);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const folder = formData.get('folder');
    const deviceId = formData.get('deviceId');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Dosya gerekli.' }, { status: 400 });
    }

    const folderValue = typeof folder === 'string' ? folder : '';
    if (!ALLOWED_FOLDERS.has(folderValue)) {
      return NextResponse.json({ error: 'Geçersiz klasör.' }, { status: 400 });
    }

    const deviceIdValue = typeof deviceId === 'string' && deviceId.trim() ? deviceId.trim() : 'unknown-device';

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Sadece görsel dosyalar yüklenebilir.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const bucket = STORAGE_BUCKET
      ? admin.storage().bucket(STORAGE_BUCKET)
      : admin.storage().bucket();

    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = `${folderValue}/${deviceIdValue}/${Date.now()}_${safeName}`;
    const bucketFile = bucket.file(filePath);

    await bucketFile.save(buffer, {
      metadata: {
        contentType: file.type,
        cacheControl: 'public,max-age=31536000',
      },
      resumable: false,
    });

    const [signedUrl] = await bucketFile.getSignedUrl({
      action: 'read',
      expires: '2500-01-01',
    });

    return NextResponse.json({
      url: signedUrl,
      path: filePath,
    });
  } catch (error: any) {
    console.error('Storage upload image error:', error);
    return NextResponse.json(
      { error: error?.message || 'Görsel yüklenemedi.' },
      { status: 500 }
    );
  }
}
