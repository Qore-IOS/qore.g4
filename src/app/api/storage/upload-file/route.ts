import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import '@/lib/firebase-admin';

const STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const ALLOWED_FOLDERS = new Set(['irsaliyeler']);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const folder = formData.get('folder');
    const userUid = formData.get('userUid');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Dosya gerekli.' }, { status: 400 });
    }

    const folderValue = typeof folder === 'string' ? folder : '';
    if (!ALLOWED_FOLDERS.has(folderValue)) {
      return NextResponse.json({ error: 'Geçersiz klasör.' }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Sadece PDF ve Excel dosyaları yüklenebilir.' }, { status: 400 });
    }

    const owner = typeof userUid === 'string' && userUid.trim() ? userUid.trim() : 'unknown-user';
    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = `${folderValue}/${owner}/${Date.now()}_${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const bucket = STORAGE_BUCKET
      ? admin.storage().bucket(STORAGE_BUCKET)
      : admin.storage().bucket();

    const bucketFile = bucket.file(filePath);
    await bucketFile.save(buffer, {
      metadata: {
        contentType: file.type,
        cacheControl: 'private,max-age=0',
      },
      resumable: false,
    });

    const [url] = await bucketFile.getSignedUrl({
      action: 'read',
      expires: '2500-01-01',
    });

    return NextResponse.json({ path: filePath, url });
  } catch (error: any) {
    console.error('Storage upload file error:', error);
    return NextResponse.json({ error: error?.message || 'Dosya yüklenemedi.' }, { status: 500 });
  }
}
