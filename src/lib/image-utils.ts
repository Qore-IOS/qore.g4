const STORAGE_BUCKET =
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'invpilot.appspot.com';
const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o`;

/**
 * Resolves an image path to a displayable URL.
 *
 * After the one-time migration (POST /api/admin/migrate-images),
 * Firestore device records contain full Firebase Storage URLs.
 * This helper handles both legacy relative paths and full URLs.
 *
 * - Full URL (https://, data:, blob:)  → returned as-is
 * - Empty / null                       → returns `fallback`
 * - Relative path ("703.png")          → "/703.png" (public/ fallback)
 */
export function resolveImageSrc(
  input?: string | null,
  fallback = '/lab_diorama.png',
): string {
  if (!input || !input.trim()) return fallback;

  let value = input.trim();

  // absolute / remote / data / blob paths – keep as-is
  if (/^(https?:\/\/|data:|blob:)/i.test(value)) return value;

  value = value.replace(/\\/g, '/');
  value = value.replace(/^\.\//, '');
  value = value.replace(/^public\//i, '');

  if (!value.startsWith('/')) value = `/${value}`;

  // normalize duplicate slashes
  value = value.replace(/\/+/g, '/');

  // encode spaces and special chars for static file serving
  return encodeURI(value);
}

/**
 * Converts a local filename to a deterministic Firebase Storage URL.
 * Used by the migration endpoint to compute target URLs.
 */
export function toStorageUrl(
  filename: string,
  folder = 'device-images',
): string {
  const clean = filename.replace(/^\/+/, '');
  const path = `${folder}/${clean}`;
  return `${STORAGE_BASE}/${encodeURIComponent(path)}?alt=media`;
}
