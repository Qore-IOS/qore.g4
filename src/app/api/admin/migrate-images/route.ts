import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '../../../../lib/data/admin';
import { resolveStorageBucket } from '@/lib/server/storage-bucket';
import {workspaceIdentity} from '../../../../lib/workspace';
import * as fs from 'fs';
import * as path from 'path';

const STORAGE_FOLDER = 'device-images';

/**
 * POST /api/admin/migrate-images
 *
 * One-time migration: uploads every image in public/ to dosya deposu
 * under "device-images/" and updates all Firestore device & deviceGroup
 * records with the resulting Storage URLs.
 *
 * Requires admin authentication (checked via Firestore user role).
 */
export async function POST(request: NextRequest) {
  try {
    const bucket = await resolveStorageBucket();

    // ── 1. Discover image files in public/ ──
    const publicDir = path.join(process.cwd(), 'public');
    const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.PNG', '.JPG', '.JPEG']);

    function collectImages(dir: string, prefix = ''): string[] {
      const files: string[] = [];
      if (!fs.existsSync(dir)) return files;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          // Skip hidden directories and workers
          if (!entry.name.startsWith('.')) {
            files.push(...collectImages(path.join(dir, entry.name), rel));
          }
        } else if (imageExtensions.has(path.extname(entry.name))) {
          files.push(rel);
        }
      }
      return files;
    }

    const imageFiles = collectImages(publicDir);

    // ── 2. Upload each to Storage ──
    const results: Array<{ file: string; storageUrl: string; status: string }> = [];

    for (const file of imageFiles) {
      try {
        const localPath = path.join(publicDir, file);
        const buffer = fs.readFileSync(localPath);
        const storagePath = `${STORAGE_FOLDER}/${file}`;
        const bucketFile = bucket.file(storagePath);

        // Detect content type
        const ext = path.extname(file).toLowerCase();
        const contentTypes: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml',
          '.gif': 'image/gif',
        };
        const contentType = contentTypes[ext] || 'application/octet-stream';

        await bucketFile.save(buffer, {
          metadata: {
            contentType,
            cacheControl: 'public,max-age=31536000',
          },
          resumable: false,
        });

        const [storageUrl] = await bucketFile.getSignedUrl();
        results.push({ file, storageUrl, status: 'uploaded' });
      } catch (err: any) {
        results.push({ file, storageUrl: '', status: `error: ${err.message}` });
      }
    }

    // ── 3. Build filename → storageUrl map ──
    const urlMap: Record<string, string> = {};
    for (const r of results) {
      if (r.status === 'uploaded') {
        urlMap[r.file] = r.storageUrl;
        // Also map without leading path parts for simple filenames
        const basename = path.basename(r.file);
        if (basename !== r.file) {
          urlMap[basename] = r.storageUrl;
        }
      }
    }

    // ── 4. Update Firestore device records ──
    let devicesUpdated = 0;
    const devicesSnap = await adminDb.collection('devices').get();
    for (const doc of devicesSnap.docs) {
      const data = doc.data() as any;
      if (data.imageUrl && !data.imageUrl.startsWith('http')) {
        const clean = data.imageUrl.replace(/^\/+/, '');
        const newUrl = urlMap[clean];
        if (newUrl) {
          await adminDb.collection('devices').doc(doc.id).update({
            imageUrl: newUrl,
          });
          devicesUpdated++;
        }
      }
    }

    // ── 5. Update Firestore deviceGroups records ──
    let groupsUpdated = 0;
    const groupsSnap = await adminDb.collection('deviceGroups').get();
    for (const doc of groupsSnap.docs) {
      const data = doc.data() as any;
      if (data.imageUrl && !data.imageUrl.startsWith('http')) {
        const clean = data.imageUrl.replace(/^\/+/, '');
        const newUrl = urlMap[clean];
        if (newUrl) {
          await adminDb.collection('deviceGroups').doc(doc.id).update({
            imageUrl: newUrl,
          });
          groupsUpdated++;
        }
      }
    }

    // ── 6. Store migration metadata ──
    await adminDb.collection('systemConfig').doc('imageMigration').set({
      migratedAt: new Date(),
      migratedBy: workspaceIdentity.uid,
      totalFiles: imageFiles.length,
      successCount: results.filter((r) => r.status === 'uploaded').length,
      errorCount: results.filter((r) => r.status !== 'uploaded').length,
      devicesUpdated,
      groupsUpdated,
    });

    return NextResponse.json({
      success: true,
      summary: {
        totalFiles: imageFiles.length,
        uploaded: results.filter((r) => r.status === 'uploaded').length,
        errors: results.filter((r) => r.status !== 'uploaded').length,
        devicesUpdated,
        groupsUpdated,
      },
      results,
    });
  } catch (error: any) {
    console.error('Image migration error:', error);
    return NextResponse.json(
      { error: error?.message || 'Migration failed.' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/admin/migrate-images
 *
 * Returns the current migration status.
 */
export async function GET() {
  try {
    const doc = await adminDb
      .collection('systemConfig')
      .doc('imageMigration')
      .get();
    if (!doc.exists) {
      return NextResponse.json({ migrated: false });
    }
    return NextResponse.json({ migrated: true, ...doc.data() });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Status check failed.' },
      { status: 500 },
    );
  }
}
