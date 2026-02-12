import * as admin from 'firebase-admin';

function getBucketCandidates(): string[] {
  const configured = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  const candidates = new Set<string>();
  const add = (value?: string) => {
    if (value && value.trim()) candidates.add(value.trim());
  };

  add(configured);
  if (configured?.endsWith('.appspot.com')) add(configured.replace('.appspot.com', '.firebasestorage.app'));
  if (configured?.endsWith('.firebasestorage.app')) add(configured.replace('.firebasestorage.app', '.appspot.com'));

  if (projectId) {
    add(`${projectId}.appspot.com`);
    add(`${projectId}.firebasestorage.app`);
  }

  return [...candidates];
}

export async function resolveStorageBucket(): Promise<admin.storage.Bucket> {
  const candidates = getBucketCandidates();
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const bucket = admin.storage().bucket(candidate);
      const [exists] = await bucket.exists();
      if (exists) return bucket;
    } catch (error) {
      lastError = error;
    }
  }

  if (!candidates.length) {
    return admin.storage().bucket();
  }

  throw new Error(
    `Storage bucket bulunamadı. Denenen bucketlar: ${candidates.join(', ')}${lastError ? ` | Son hata: ${(lastError as any)?.message || String(lastError)}` : ''}`
  );
}
