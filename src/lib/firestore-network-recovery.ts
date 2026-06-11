/**
 * Firestore bağlantı sağlığı: zombi WebChannel kurtarma katmanı.
 *
 * Semptom: panel dakikalarca loading'de kalıyor, F5 ile her şey anında
 * geliyor. Sebep: Firestore web SDK'sının Listen/Write WebChannel'ı uyku,
 * ağ değişimi veya NAT timeout sonrası "açık ama ölü" kalabiliyor. SDK
 * kendini online sandığı için getDocs/onSnapshot sonsuza dek sunucuyu
 * bekliyor; F5 taze kanal açtığı için sorun anında kayboluyor.
 *
 * STABİLİZASYON (P0.2): Önceki sürüm HER sorgu timeout'unda bütün Firestore
 * ağını disableNetwork/enableNetwork ile resetliyordu. Aynı anda timeout
 * olan 5-6 sorgu bağlantıyı peş peşe sıfırlayıp tüm panellerin okumalarını
 * ve listener'larını birlikte bozuyordu ("reset fırtınası": ekrandaki
 * art arda [firestore-recovery] uyarılarının nedeni). Yeni kurallar:
 *
 *  1. Kanal reseti yalnız merkezi supervisor üzerinden yapılır ve
 *     RECOVERY_COOLDOWN_MS içinde EN FAZLA BİR kez çalışır. Eşzamanlı
 *     timeout'lar tek resette birleşir; cooldown içindeki yeni timeout'lar
 *     reset tetiklemez.
 *  2. Watchdog (uyku/ağ değişimi dönüşü) gerçek connectivity sinyali
 *     olduğu için cooldown'u bypass eder (force) — meşru kullanım budur.
 *  3. Timeout süreleri 12+15sn'den 8+8sn'ye indi: takılan okuma en kötü
 *     16 saniyede sonuçlanır (eskiden 27sn; üstüne TanStack retry'ları
 *     binince ~81sn'ye çıkabiliyordu).
 *  4. withTimeout alttaki getDocs'u iptal edemez; retry'da eski promise
 *     ÇÖPE ATILMAZ — ikisinden önce dolan kazanır (firstFulfilled). Geç
 *     gelen ilk yanıt böylece kaybolmaz ve mükerrer bekleme kısalır.
 *  5. Her timeout/kurtarma artık telemetriye yazılır (recordDataIssue) —
 *     üretimde "neden 12sn bekledik" sorusu görünür hale gelir.
 */
import {
  disableNetwork,
  enableNetwork,
  getDoc,
  getDocs,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { recordDataIssue } from '@/lib/perf/data-vitals';

/** İlk deneme için sunucu yanıt üst sınırı. */
const FIRST_ATTEMPT_TIMEOUT_MS = 8_000;
/** İkinci (retry) deneme üst sınırı. */
const RETRY_TIMEOUT_MS = 8_000;
/** Sekme bundan uzun süre arkaplanda kaldıysa dönüşte kanal tazelenir. */
const HIDDEN_RECOVERY_THRESHOLD_MS = 45_000;
/** İki kanal reseti arasındaki zorunlu bekleme (reset fırtınası önleyici). */
const RECOVERY_COOLDOWN_MS = 60_000;

export class FirestoreTimeoutError extends Error {
  constructor(ms: number) {
    super(`Firestore sunucu yanıtı ${ms}ms içinde gelmedi (olası zombi kanal)`);
    this.name = 'FirestoreTimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FirestoreTimeoutError(ms)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * İlk DOLAN promise'i döndürür (Promise.any benzeri, lib bağımsız).
 * Hepsi reddederse son hatayla reddeder.
 */
function firstFulfilled<T>(promises: Array<Promise<T>>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let rejectedCount = 0;
    let lastError: unknown;
    for (const p of promises) {
      p.then(resolve, (err) => {
        lastError = err;
        rejectedCount += 1;
        if (rejectedCount === promises.length) reject(lastError);
      });
    }
  });
}

let recoveryInFlight: Promise<void> | null = null;
let lastRecoveryAt = 0;

/**
 * WebChannel'ı kapatıp yeniden açarak taze bağlantı kurdurur.
 *
 * Eşzamanlı çağrılar tek kurtarma işlemini paylaşır; cooldown penceresi
 * içindeki tekrar istekler (force değilse) resetlemeden döner. `force`
 * yalnız gerçek connectivity sinyalleri (online/uykudan dönüş) içindir.
 */
export function recoverFirestoreNetwork(options?: { force?: boolean }): Promise<void> {
  if (recoveryInFlight) return recoveryInFlight;
  const now = Date.now();
  if (!options?.force && now - lastRecoveryAt < RECOVERY_COOLDOWN_MS) {
    return Promise.resolve();
  }
  lastRecoveryAt = now;
  recoveryInFlight = (async () => {
    try {
      await disableNetwork(db);
      await enableNetwork(db);
      recordDataIssue('channel-recovery', options?.force ? 'forced (connectivity)' : 'timeout-escalation');
    } catch (err) {
      console.warn('[firestore-recovery] Ağ tazeleme başarısız:', err);
    } finally {
      recoveryInFlight = null;
    }
  })();
  return recoveryInFlight;
}

/**
 * Timeout + (cooldown'lu) kanal kurtarma + tek retry'lı getDocs.
 * Sağlıklı bağlantıda davranış birebir getDocs ile aynıdır.
 */
export async function getDocsResilient<T = DocumentData>(
  q: Query<T>,
): Promise<QuerySnapshot<T>> {
  // SSR/server-action tarafında watchdog mantığına gerek yok.
  if (typeof window === 'undefined') return getDocs(q);
  const first = getDocs(q);
  try {
    return await withTimeout(first, FIRST_ATTEMPT_TIMEOUT_MS);
  } catch (err) {
    if (!(err instanceof FirestoreTimeoutError)) throw err;
    recordDataIssue('read-timeout', `getDocs ${FIRST_ATTEMPT_TIMEOUT_MS}ms`);
    // Supervisor cooldown içindeyse bu çağrı resetlemez — sadece retry eder.
    await recoverFirestoreNetwork();
    const second = getDocs(q);
    return withTimeout(firstFulfilled([first, second]), RETRY_TIMEOUT_MS);
  }
}

/**
 * Timeout + (cooldown'lu) kanal kurtarma + tek retry'lı getDoc (tekil doküman).
 * Sağlıklı bağlantıda davranış birebir getDoc ile aynıdır.
 */
export async function getDocResilient<T = DocumentData>(
  ref: DocumentReference<T>,
): Promise<DocumentSnapshot<T>> {
  if (typeof window === 'undefined') return getDoc(ref);
  const first = getDoc(ref);
  try {
    return await withTimeout(first, FIRST_ATTEMPT_TIMEOUT_MS);
  } catch (err) {
    if (!(err instanceof FirestoreTimeoutError)) throw err;
    recordDataIssue('read-timeout', `getDoc ${FIRST_ATTEMPT_TIMEOUT_MS}ms`);
    await recoverFirestoreNetwork();
    const second = getDoc(ref);
    return withTimeout(firstFulfilled([first, second]), RETRY_TIMEOUT_MS);
  }
}

let watchdogInstalled = false;
let hiddenSince = 0;

/**
 * Uygulama açılışında bir kez kurulur (QueryProvider içinden).
 * Idempotent — tekrar çağrılması etkisizdir.
 */
export function initFirestoreConnectionWatchdog(): void {
  if (watchdogInstalled || typeof window === 'undefined') return;
  watchdogInstalled = true;

  window.addEventListener('online', () => {
    void recoverFirestoreNetwork({ force: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now();
      return;
    }
    if (hiddenSince && Date.now() - hiddenSince > HIDDEN_RECOVERY_THRESHOLD_MS) {
      void recoverFirestoreNetwork({ force: true });
    }
    hiddenSince = 0;
  });
}
