/**
 * Cache-first Firestore okuma katmanı ("ışık hızı" veri yolu).
 *
 * Problem: tüm React Query hook'ları `getDocs` kullanıyordu. `getDocs`,
 * IndexedDB persistence açık olsa bile ÖNCE SUNUCUYU bekler — yani her
 * panel açılışı en az bir sunucu round-trip'ine, kanal bozuksa sonsuz
 * loading'e kilitleniyordu. Barkod format/ürün verisi gelmeden okutulan
 * barkodların hata vermesinin kökü de bu.
 *
 * Çözüm (stale-while-revalidate):
 *  1. Sorgu önce Firestore'un IndexedDB cache'inden okunur → veri
 *     milisaniyeler içinde ekranda.
 *  2. Arka planda sunucudan tazesi çekilir (SDK bunu local cache'e de
 *     yazar) ve ilgili React Query anahtarı invalidate edilir → ekran
 *     sessizce güncellenir.
 *  3. Cache boşsa (ilk ziyaret / yeni cihaz) davranış bugünküyle aynıdır:
 *     sunucudan beklenir — ama `getDocsResilient` sayesinde takılan kanal
 *     kendini kurtarır.
 *
 * Maliyet notu: cache'ten servis SIFIR okuma harcar; arka plan tazeleme
 * bugünkü getDocs ile aynı sayıda okumadır. Toplam Firestore okuma sayısı
 * değişmez, sadece kullanıcı hiç beklemez.
 */
import {
  getDocsFromCache,
  getDocsFromServer,
  type DocumentData,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import { hashKey, type QueryKey } from '@tanstack/react-query';
import { appQueryClient } from '@/lib/query-client';
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import { recordDataServe } from '@/lib/perf/data-vitals';

/** queryFn'in React Query'den aldığı context'in kullandığımız alt kümesi. */
export type QueryFnCtx = { queryKey: QueryKey };

/**
 * "invalidate → refetch → tekrar revalidate" döngüsünü kıran pencere:
 * bir anahtar için sunucu senkronu bu kadar yeniyse, cache'ten servis
 * edilirken yeni bir arka plan tazeleme tetiklenmez.
 */
const REVALIDATE_GUARD_MS = 5_000;
/** Aynı queryFn içindeki çoklu alt sorguların tek invalidate'te toplanması. */
const INVALIDATE_DEBOUNCE_MS = 150;

const lastServerSyncAt = new Map<string, number>();
const pendingInvalidate = new Map<string, ReturnType<typeof setTimeout>>();

function recentlySynced(key: string): boolean {
  const at = lastServerSyncAt.get(key);
  return at !== undefined && Date.now() - at < REVALIDATE_GUARD_MS;
}

function markSynced(key: string): void {
  lastServerSyncAt.set(key, Date.now());
}

function scheduleInvalidate(key: string, queryKey: QueryKey): void {
  const existing = pendingInvalidate.get(key);
  if (existing) clearTimeout(existing);
  pendingInvalidate.set(
    key,
    setTimeout(() => {
      pendingInvalidate.delete(key);
      void appQueryClient.invalidateQueries({
        queryKey,
        exact: true,
        refetchType: 'active',
      });
    }, INVALIDATE_DEBOUNCE_MS),
  );
}

/**
 * Sorguyu arka planda sunucudan tazeler; başarılı olursa ilgili React
 * Query anahtarını invalidate eder. Hata (offline vb.) sessizce yutulur —
 * cache'teki veri ekranda kalmaya devam eder.
 */
export function revalidateInBackground(
  ctx: QueryFnCtx,
  q: Query<DocumentData>,
): void {
  const key = hashKey(ctx.queryKey);
  // Guard: invalidate sonrası yeniden çalışan queryFn'in aynı sorguları
  // tekrar tazeleyip sonsuz invalidate döngüsü kurmasını engeller.
  if (recentlySynced(key)) return;
  getDocsFromServer(q)
    .then(() => {
      markSynced(key);
      scheduleInvalidate(key, ctx.queryKey);
    })
    .catch(() => {
      /* offline / izin / geçici hata: cache verisiyle devam */
    });
}

/**
 * getDocs'un cache-first, kendini iyileştiren muadili.
 *
 * Dönen QuerySnapshot, hook'lardaki mevcut `.docs.map(...)` kullanımıyla
 * birebir uyumludur. Cache'ten servis edildiğinde
 * `snapshot.metadata.fromCache === true` olur.
 */
export async function getDocsCacheFirst(
  ctx: QueryFnCtx,
  q: Query<DocumentData>,
): Promise<QuerySnapshot<DocumentData>> {
  // SSR / server action: local cache yok, doğrudan sunucu.
  if (typeof window === 'undefined') return getDocsResilient(q);

  const t0 = performance.now();
  const key = hashKey(ctx.queryKey);
  try {
    const cached = await getDocsFromCache(q);
    if (!cached.empty) {
      if (!recentlySynced(key)) revalidateInBackground(ctx, q);
      recordDataServe(performance.now() - t0, 'cache');
      return cached;
    }
  } catch {
    // Cache sorgusu desteklenmiyor/başarısız → sunucu yoluna düş.
  }

  // Cache boş: "hiç çekilmedi" ile "gerçekten boş koleksiyon" ayırt
  // edilemez; doğruluk için sunucuya gidilir (bugünkü davranış) ama
  // timeout + kanal kurtarma korumalıdır.
  const snap = await getDocsResilient(q);
  markSynced(key);
  recordDataServe(performance.now() - t0, 'server');
  return snap;
}
