/**
 * @fileoverview Çevrimdışı yazma — "önce yerel" tamamlama.
 *
 * ÇÖZDÜĞÜ SORUN
 *
 * Firestore Web SDK'sında `writeBatch(...).commit()` ile dönen söz, yazım
 * SUNUCU tarafından onaylandığında çözülür. Çevrimdışıyken bu onay hiç
 * gelmez: söz ne çözülür ne reddedilir, SONSUZA KADAR bekler.
 *
 * Bunun pratikteki sonucu, `await batch.commit()` yazan her ekranın
 * çevrimdışıyken "Kaydediliyor…" konumunda kilitlenmesidir. Kullanıcı işlemin
 * kaydedilip kaydedilmediğini bilemez, listeyi temizleyemez, çıkamaz.
 *
 * Oysa SDK yazımı yerel önbelleğe ANINDA uygular ve bağlantı gelince kendisi
 * gönderir. Yani veri kaybı yoktur — eksik olan yalnızca arayüzün bunu
 * anlamasıdır.
 *
 * ÇÖZÜM
 *
 * `commitLocalFirst()`, commit sözünü kısa bir zaman aşımıyla yarıştırır:
 *
 *   - Sunucu zamanında onaylarsa      → `'synced'`
 *   - Zaman aşımı kazanırsa           → `'pending'` (yerelde yazıldı, kuyrukta)
 *   - Söz reddedilirse                → fırlatır (gerçek hata: izin, geçersiz veri)
 *
 * Zaman aşımı yolunda özgün söz BIRAKILMAZ; arka planda izlenmeye devam eder
 * ve sonucuna göre bekleyen sayaç güncellenir. Böylece "3 işlem senkron
 * bekliyor" göstergesi gerçeği yansıtır.
 */

/**
 * Sunucu onayı için beklenecek süre.
 *
 * Çevrimiçi bir yazım tipik olarak 100–400 ms'de onaylanır. 2 saniye, yavaş
 * bir bağlantıda gereksiz yere "bekliyor" demeyecek kadar uzun; çevrimdışı
 * bir kullanıcıyı oyalamayacak kadar kısa.
 */
const SERVER_ACK_TIMEOUT_MS = 2000;

export type CommitOutcome = 'synced' | 'pending';

/**
 * Bir commit sözünün nihai sonucu.
 *
 * Ayrımlı birleşim (`{ok:true} | {ok:false;error}`) DEĞİL: bu proje
 * `strict: false` ile derleniyor ve orada `!result.ok` daraltması çalışmıyor,
 * `error` alanı görünmez oluyor. Tek şekilli tip hem derleniyor hem de burada
 * okunması daha kolay.
 */
type CommitSettlement = { ok: boolean; error?: unknown };

type PendingListener = (count: number) => void;

let pendingCount = 0;
const listeners = new Set<PendingListener>();

function setPending(next: number) {
  pendingCount = Math.max(0, next);
  listeners.forEach(listener => listener(pendingCount));
}

/** Sunucu onayı bekleyen yazım sayısı. */
export function getPendingWriteCount(): number {
  return pendingCount;
}

/**
 * Bekleyen yazım sayısını dinler.
 * @returns Aboneliği sonlandıran fonksiyon.
 */
export function subscribeToPendingWrites(listener: PendingListener): () => void {
  listeners.add(listener);
  listener(pendingCount);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Bir yazımı BEKLEMEDEN kuyruğa alır.
 *
 * `commitLocalFirst`'ten farkı, çağıranın hiç beklememesidir: Firestore
 * yazımı yerel önbelleğe SENKRON uygular, dolayısıyla veri o an zaten
 * doğrudur ve arayüz sonucu beklemeden ilerleyebilir.
 *
 * Terminal ekranları bunu kullanır — depoda barkod okutan bir kullanıcının
 * "Kaydediliyor…" görmesi için hiçbir sebep yok. Sunucu onayı gelene kadar
 * işlem bekleyen sayaca yazılır ve üst şeritteki göstergede görünür.
 *
 * @param onSettled Sunucu sonucu geldiğinde çağrılır (arka planda).
 */
export function queueWrite(
  commit: Promise<unknown>,
  onSettled?: (result: { ok: boolean; error?: unknown }) => void,
): void {
  setPending(pendingCount + 1);
  commit.then(
    () => {
      setPending(pendingCount - 1);
      onSettled?.({ ok: true });
    },
    (error: unknown) => {
      setPending(pendingCount - 1);
      // Gerçek bir ret (kural ihlali, geçersiz belge) sessizce kaybolmamalı.
      console.error('[offline-write] Kuyruktaki yazım reddedildi:', error);
      onSettled?.({ ok: false, error });
    },
  );
}

/**
 * Bir Firestore yazımını "önce yerel" mantığıyla tamamlar.
 *
 * @param commit Yazımı başlatan söz — ör. `batch.commit()`.
 * @param options.timeoutMs Sunucu onayı için beklenecek süre.
 * @returns Yazımın sunucuya işlenip işlenmediği.
 * @throws Yazım gerçekten reddedilirse (izin hatası, geçersiz belge) hatayı
 *         aynen fırlatır — bu bir bağlantı sorunu değildir ve yutulmamalıdır.
 */
export async function commitLocalFirst(
  commit: Promise<unknown>,
  options?: { timeoutMs?: number },
): Promise<CommitOutcome> {
  const timeoutMs = options?.timeoutMs ?? SERVER_ACK_TIMEOUT_MS;

  // Zaman aşımı kazandığında sözün reddi işlenmeden kalırsa Node/tarayıcı
  // "unhandled rejection" üretir. Bu yüzden sonuç HER ZAMAN burada işlenir;
  // aşağıdaki yarış yalnızca ne kadar bekleneceğine karar verir.
  const tracked: Promise<CommitSettlement> = commit.then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error }),
  );

  const timer = new Promise<'timeout'>(resolve => {
    setTimeout(() => resolve('timeout'), timeoutMs);
  });

  const winner = await Promise.race([tracked, timer]);

  if (winner !== 'timeout') {
    if (!winner.ok) throw winner.error;
    return 'synced';
  }

  // Zaman aşımı: yazım yerel önbellekte, kuyrukta bekliyor. Sayaç, gerçek
  // sonuç geldiğinde düşürülür.
  setPending(pendingCount + 1);
  void tracked.then(result => {
    setPending(pendingCount - 1);
    if (!result.ok) {
      // Bağlantı geri geldiğinde reddedilen bir yazım gerçek bir sorundur
      // (ör. kural ihlali). Kullanıcı o an başka ekranda olabileceği için
      // en azından günlüğe düşer.
      console.error('[offline-write] Kuyruktaki yazım reddedildi:', result.error);
    }
  });

  return 'pending';
}
