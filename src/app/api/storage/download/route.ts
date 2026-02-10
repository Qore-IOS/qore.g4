import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
// Side-effect import to ensure admin SDK is initialized
import '@/lib/firebase-admin';

const STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

export async function POST(request: NextRequest) {
  try {
    const { storagePath } = await request.json();

    if (!storagePath || typeof storagePath !== 'string') {
      return NextResponse.json({ error: 'storagePath gerekli' }, { status: 400 });
    }

    // Validate the path starts with irsaliyeler/ to prevent arbitrary file access
    if (!storagePath.startsWith('irsaliyeler/')) {
      return NextResponse.json({ error: 'Geçersiz dosya yolu' }, { status: 403 });
    }

    const bucket = admin.storage().bucket(STORAGE_BUCKET);
    const file = bucket.file(storagePath);

    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json({ error: 'Dosya bulunamadı' }, { status: 404 });
    }

    const [buffer] = await file.download();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="file.pdf"`,
      },
    });
  } catch (error: any) {
    console.error('Storage download error:', error);
    return NextResponse.json(
      { error: error.message || 'Dosya indirilirken hata oluştu' },
      { status: 500 }
    );
  }
}
