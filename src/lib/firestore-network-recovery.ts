/**
 * Firestore bağlantı sağlığı: zombi WebChannel kurtarma katmanı.
 *
 * Semptom: panel dakikalarca loading'de kalıyor, F5 ile her şey anında
 * geliyor. Sebep: Firestore web SDK'sının Listen/Write WebChannel'ı uyku,
 * ağ değişimi veya NAT timeout sonrası "açık ama ölü" kalabiliyor. SDK
 * kendini online sandığı için getDocs/onSnapshot sonsuza dek sunucuyu
 * bekliyor; F5 taze kanal açtığı için sorun anında kayboluyor.
 *
 * Bu modül iki şey yapar:
 *  1. `initFirestoreConnectionWatchdog()` — sekme uykudan/arkaplandan
 *     dönünce veya tarayıcı online olunca kanalı proaktif tazeler
 *     (disableNetwork → enableNetwork). Bekleyen yazmalar kaybolmaz;
 *     kuyrukta kalır ve yeni kanaldan gönderilir. Aktif onSnapshot
 *     listener'ları da yeni kanal üzerinden kendiliğinden yeniden kurulur.
 *  2. `getDocsResilient()` — sunucu okumasına üst sınır koyar: timeout
 *     aşılırsa kanalı tazeleyip bir kez daha dener. "Sonsuz loading"
 *     en kötü ihtimalle sınırlı bir gecikmeye iner ve kendi kendini iyileştirir.
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

/** İlk deneme için sunucu yanıt üst sınırı. */
const FIRST_ATTEMPT_TIMEOUT_MS = 12_000;
/** Kanal tazelendikten sonraki ikinci deneme üst sınırı. */
const RETRY_TIMEOUT_MS = 15_000;
/** Sekme bundan uzun süre arkaplanda kaldıysa dönüşte kanal tazelenir. */
const HIDDEN_RECOVERY_THRESHOLD_MS = 45_000;

class FirestoreTimeoutError extends Error {
  constructor(ms: number) {
    super(`Firestore sunucu yanıtı ${ms}ms içinde gelmedi (olası zombi kanal)`);
    this.name = 'FirestoreTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FirestoreTimeoutError(ms)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

let recoveryInFlight: Promise<void> | null = null;

/**
 * WebChannel'ı kapatıp yeniden açarak taze bağlantı kurdurur. Eşzamanlı
 * çağrılar tek kurtarma işlemini paylaşır (kanal flap'ini önler).
 */
export function recoverFirestoreNetwork(): Promise<void> {
  if (recoveryInFlight) return recoveryInFlight;
  recoveryInFlight = (async () => {
    try {
      await disableNetwork(db);
      await enableNetwork(db);
    } catch (err) {
      console.warn('[firestore-recovery] Ağ tazeleme başarısız:', err);
    } finally {
      recoveryInFlight = null;
    }
  })();
  return recoveryInFlight;
}

/**
 * Timeout + otomatik kanal kurtarma + tek retry'lı getDocs.
 * Sağlıklı bağlantıda davranış birebir getDocs ile aynıdır.
 */
export async function getDocsResilient<T = DocumentData>(
  q: Query<T>,
): Promise<QuerySnapshot<T>> {
  // SSR/server-action tarafında watchdog mantığına gerek yok.
  if (typeof window === 'undefined') return getDocs(q);
  try {
    return await withTimeout(getDocs(q), FIRST_ATTEMPT_TIMEOUT_MS);
  } catch (err) {
    if (!(err instanceof FirestoreTimeoutError)) throw err;
    console.warn('[firestore-recovery] Okuma takıldı, kanal tazelenip yeniden deneniyor…');
    await recoverFirestoreNetwork();
    return withTimeout(getDocs(q), RETRY_TIMEOUT_MS);
  }
}

/**
 * Timeout + otomatik kanal kurtarma + tek retry'lı getDoc (tekil doküman).
 * Sağlıklı bağlantıda davranış birebir getDoc ile aynıdır.
 */
export async function getDocResilient<T = DocumentData>(
  ref: DocumentReference<T>,
): Promise<DocumentSnapshot<T>> {
  if (typeof window === 'undefined') return getDoc(ref);
  try {
    return await withTimeout(getDoc(ref), FIRST_ATTEMPT_TIMEOUT_MS);
  } catch (err) {
    if (!(err instanceof FirestoreTimeoutError)) throw err;
    console.warn('[firestore-recovery] Doküman okuması takıldı, kanal tazelenip yeniden deneniyor…');
    await recoverFirestoreNetwork();
    return withTimeout(getDoc(ref), RETRY_TIMEOUT_MS);
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
    void recoverFirestoreNetwork();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now();
      return;
    }
    if (hiddenSince && Date.now() - hiddenSince > HIDDEN_RECOVERY_THRESHOLD_MS) {
      void recoverFirestoreNetwork();
    }
    hiddenSince = 0;
  });
}
