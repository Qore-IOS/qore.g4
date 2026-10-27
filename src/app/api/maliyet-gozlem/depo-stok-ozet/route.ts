import type * as DocumentStore from '../../../../lib/data/admin';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '../../../../lib/data/admin';
import { normalizeCompanyId } from '@/lib/company-scope';

/**
 * Depo Stok Özeti API — Maliyet Gözlem paneli için.
 *
 * `depoStok` koleksiyonunda her kutu/seri ayrı belge olduğundan panel açılışta
 * tüm sevk edilmiş stoğu indirmek zorunda kalıyordu (on binlerce belge).
 * Bu route aynı veriyi sunucu tarafında lab + stok kodu başına satır sayısına
 * indirger; istemciye yalnızca kompakt özet döner. Maliyet motoru
 * (`test-cost-calculator.ts`) bu özeti `depoStokCounts` girdisi olarak kullanır.
 *
 * Şirket kapsamı `scopedQuery` ile aynı semantiği izler: superadmin ve legacy
 * kullanıcılar filtresiz, diğerleri `companyId` eşitliğiyle sorgular.
 */

export const dynamic = 'force-dynamic';

interface DepoStokOzetRequest {
  /** Caller's company id — server-side filter for cross-tenant isolation. */
  companyId?: string | null;
  /** Caller's super-admin flag — bypasses company filter. */
  isSuperAdmin?: boolean;
}

const PAGE_SIZE = 10000;

export async function POST(request: NextRequest) {
  try {
    const body: DepoStokOzetRequest = await request.json().catch(() => ({} as DepoStokOzetRequest));
    const normalized = normalizeCompanyId(body.companyId);

    let base = adminDb
      .collection('depoStok')
      .where('isShipped', '==', true) as DocumentStore.Query;
    if (!body.isSuperAdmin && normalized !== '__legacy__') {
      base = base.where('companyId', '==', normalized);
    }
    // Field mask: yalnızca özet için gereken alanlar okunur
    base = base.select('hedefKurumId', 'stokKodu');

    // labId → stokKodu → satır sayısı (sayfalı okuma — bellek güvenli)
    const counts = new Map<string, Map<string, number>>();
    let totalRows = 0;
    let last: DocumentStore.QueryDocumentSnapshot | null = null;

    for (;;) {
      let q = base.limit(PAGE_SIZE);
      if (last) q = q.startAfter(last);
      const snap = await q.get();

      for (const doc of snap.docs) {
        const data = doc.data();
        const labId = data.hedefKurumId;
        const stokKodu = data.stokKodu;
        if (typeof labId !== 'string' || !labId) continue;
        if (typeof stokKodu !== 'string' || !stokKodu) continue;

        let inner = counts.get(labId);
        if (!inner) {
          inner = new Map<string, number>();
          counts.set(labId, inner);
        }
        inner.set(stokKodu, (inner.get(stokKodu) || 0) + 1);
        totalRows++;
      }

      if (snap.size < PAGE_SIZE) break;
      last = snap.docs[snap.size - 1];
    }

    const rows: { hedefKurumId: string; stokKodu: string; count: number }[] = [];
    for (const [labId, inner] of counts) {
      for (const [stokKodu, count] of inner) {
        rows.push({ hedefKurumId: labId, stokKodu, count });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        rows,
        totalRows,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Depo stok özeti error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Depo stok özeti oluşturulamadı' },
      { status: 500 },
    );
  }
}
