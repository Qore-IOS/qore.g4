import { NextResponse } from 'next/server';
import { probeAdminSdk } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Admin SDK sağlık ucu.
 *
 * NEDEN VAR: `getProductCodesAction` / `getBarcodeFormatsAction` gibi Admin SDK
 * kullanan server action'lar bozulduğunda istemci yalnızca `500 Internal Server
 * Error` görür — sebep (kimlik bilgisi yok, IAM izni yok, proje kotası dolu)
 * tarayıcıya hiç ulaşmaz. Bu uç, tek bir istekte asıl sebebi döndürür:
 *
 *     curl https://<host>/api/health/admin
 *
 * `ready:false` + `error` alanındaki metin ne yapılacağını söyler. Sık görülen
 * üç hâl:
 *   - "Could not load the default credentials"  → ADC yok / servis hesabı yanlış
 *   - "PERMISSION_DENIED"                       → servis hesabında Firestore izni yok
 *   - "RESOURCE_EXHAUSTED" / "Quota exceeded"   → proje kotası dolmuş (faturalama planı)
 *
 * Kimlik bilgisi İÇERMEZ; yalnızca hangi kaynağın denendiğini söyler.
 */
export async function GET() {
  const status = await probeAdminSdk();
  return NextResponse.json(status, { status: status.ready ? 200 : 503 });
}
