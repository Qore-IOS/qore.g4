/**
 * Depo stok özeti istemci yardımcıları.
 *
 * Maliyet Gözlem paneli sevk edilmiş stoğu belge belge indirmek yerine
 * `/api/maliyet-gozlem/depo-stok-ozet` route'undan lab + stok kodu başına
 * satır sayısı özetini çeker. Route erişilemezse çağıran taraf
 * `aggregateDepoStokRows` ile eski Firestore yoluna düşebilir.
 */
import type { DepoStokCount } from '@/lib/test-cost-calculator';

/** `DepoStokItem`'ın özet için gereken alt kümesi (yapısal — import yolu bağımsız) */
interface DepoStokRowLike {
  isShipped?: boolean;
  hedefKurumId?: string;
  stokKodu?: string;
}

export async function fetchDepoStokCounts(
  companyId: string | null | undefined,
  isSuperAdmin: boolean | undefined,
): Promise<DepoStokCount[]> {
  const res = await fetch('/api/maliyet-gozlem/depo-stok-ozet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId: companyId ?? null, isSuperAdmin: !!isSuperAdmin }),
  });

  if (!res.ok) {
    throw new Error(`Depo stok özeti HTTP ${res.status}`);
  }

  const payload = await res.json();
  if (!payload?.success || !Array.isArray(payload?.data?.rows)) {
    throw new Error(payload?.error || 'Depo stok özeti alınamadı');
  }

  return payload.data.rows as DepoStokCount[];
}

/**
 * Ham `DepoStokItem` satırlarını lab + stok kodu başına sayıya indirger.
 * API route'una erişilemeyen durumlar için istemci tarafı fallback.
 */
export function aggregateDepoStokRows(items: DepoStokRowLike[]): DepoStokCount[] {
  const counts = new Map<string, Map<string, number>>();
  for (const item of items) {
    if (!item.isShipped) continue;
    if (!item.hedefKurumId || !item.stokKodu) continue;
    let inner = counts.get(item.hedefKurumId);
    if (!inner) {
      inner = new Map<string, number>();
      counts.set(item.hedefKurumId, inner);
    }
    inner.set(item.stokKodu, (inner.get(item.stokKodu) || 0) + 1);
  }

  const rows: DepoStokCount[] = [];
  for (const [hedefKurumId, inner] of counts) {
    for (const [stokKodu, count] of inner) {
      rows.push({ hedefKurumId, stokKodu, count });
    }
  }
  return rows;
}
