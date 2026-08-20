// src/lib/firebase-admin.ts
import * as admin from 'firebase-admin';

// IMPORTANT: This file is used in server-side code (Server Actions, API routes).
// Do not import this file in client-side components.

const serviceAccountKeyFromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

/**
 * Emülatör kipi. Admin SDK, `FIRESTORE_EMULATOR_HOST` ve
 * `FIREBASE_AUTH_EMULATOR_HOST` ortam değişkenlerini KENDİLİĞİNDEN okur ve
 * trafiği emülatöre yönlendirir — ek bir bağlantı çağrısı gerekmez.
 *
 * Değişmesi gereken tek şey başlatma: emülatörde gerçek bir kimlik bilgisi
 * yoktur, `applicationDefault()` hata verir. Bu yüzden yalnız `projectId` ile
 * başlatılır. Emülatör dışında davranış birebir eskisi gibidir.
 */
const EMULATOR_MODE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

/**
 * Başlatma nasıl yapıldı / neden yapılamadı.
 *
 * NEDEN VAR — üretimde yaşanan arıza:
 *
 * Bu dosya eskiden şöyle bitiyordu:
 *
 *     if (!admin.apps.length) { try { initializeApp() } catch (e) { console.error(e) } }
 *     const adminDb = admin.firestore();       // <-- MODÜL GÖVDESİNDE
 *
 * `initializeApp()` başarısız olduğunda hata YUTULUYOR, hemen ardından
 * `admin.firestore()` "The default Firebase app does not exist" ile
 * MODÜL DEĞERLENDİRMESİ SIRASINDA patlıyordu. Next.js için bu, modülü import
 * eden HER server action'ın import anında düşmesi demek: istemci tarafında
 * teşhis edilemez bir `500 Internal Server Error` görünür, sunucu günlüğünde
 * ise asıl sebep (kimlik bilgisi yok / IAM izni yok) kaybolur.
 *
 * Belirti tam olarak buydu: `getProductCodesAction` ve `getBarcodeFormatsAction`
 * 500 dönüyor, istemci SDK'sıyla okuyan hook'lar (depots, hospitals) çalışıyordu
 * — yani Firestore ayakta, arızalı olan yalnızca Admin SDK yolu. Ama paneller
 * bunu göremediği için sonsuza kadar "yükleniyor"da kalıyordu.
 *
 * Artık: başlatma hatası saklanır, `adminDb`/`adminAuth` TEMBEL çözülür ve
 * ancak GERÇEKTEN kullanıldıklarında ne yapılacağını söyleyen bir hata fırlatır.
 * Modül import'u hiçbir koşulda düşmez; `getAdminSdkStatus()` ile durum
 * `/api/health/admin` üzerinden tek istekte okunabilir.
 */
export type AdminSdkStatus = {
  ready: boolean;
  /** Hangi kimlik bilgisi yolu denendi. */
  credentialSource: 'emulator' | 'service-account-env' | 'application-default';
  projectId: string | null;
  error: string | null;
};

const credentialSource: AdminSdkStatus['credentialSource'] = EMULATOR_MODE
  ? 'emulator'
  : serviceAccountKeyFromEnv
    ? 'service-account-env'
    : 'application-default';

let initError: Error | null = null;

function initializeAdminApp(): void {
  if (admin.apps.length) return;
  if (EMULATOR_MODE) {
    admin.initializeApp({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
        || process.env.GCLOUD_PROJECT
        || 'qore-e2e',
    });
    return;
  }
  if (serviceAccountKeyFromEnv) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(serviceAccountKeyFromEnv) as admin.ServiceAccount,
      ),
    });
    return;
  }
  // Fallback for local development or environments with Application Default
  // Credentials (Firebase App Hosting / Cloud Run metadata server).
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

try {
  initializeAdminApp();
} catch (error: any) {
  initError = error instanceof Error ? error : new Error(String(error));
  // Bilerek fırlatılmıyor: modül import'u düşerse tüm server action'lar
  // teşhis edilemez 500 verir (yukarıdaki açıklamaya bakın).
  console.error('Firebase Admin SDK initialization error:', initError.message);
}

/** İnsanın okuyup ne yapacağını anlayabileceği hata metni. */
function adminUnavailableError(cause: Error): Error {
  const hint = credentialSource === 'service-account-env'
    ? 'FIREBASE_SERVICE_ACCOUNT_KEY geçerli bir servis hesabı JSON\'u içermiyor olabilir.'
    : credentialSource === 'application-default'
      ? 'Uygulama varsayılan kimlik bilgisi (ADC) okunamadı. Cloud Run/App Hosting servis hesabının Firestore erişimi (roles/datastore.user) olduğundan emin olun.'
      : 'Emülatör başlatılamadı; FIRESTORE_EMULATOR_HOST doğru mu?';
  const err = new Error(
    `Firebase Admin SDK kullanılamıyor (kimlik kaynağı: ${credentialSource}). ${hint} Asıl hata: ${cause.message}`,
  );
  err.name = 'AdminSdkUnavailableError';
  return err;
}

let firestoreInstance: admin.firestore.Firestore | null = null;

function resolveFirestore(): admin.firestore.Firestore {
  if (initError) throw adminUnavailableError(initError);
  if (firestoreInstance) return firestoreInstance;
  try {
    firestoreInstance = admin.firestore();
    try {
      firestoreInstance.settings({ ignoreUndefinedProperties: true });
    } catch {
      // settings() may only run before the first Firestore call; safe to ignore on hot reload
    }
    return firestoreInstance;
  } catch (error: any) {
    throw adminUnavailableError(error instanceof Error ? error : new Error(String(error)));
  }
}

function resolveAuth(): admin.auth.Auth {
  if (initError) throw adminUnavailableError(initError);
  try {
    return admin.auth();
  } catch (error: any) {
    throw adminUnavailableError(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * `adminDb.collection(...)` gibi 300'den fazla çağrı yeri var; tembel çözümü
 * bir Proxy ile veriyoruz ki çağrı biçimi aynı kalsın ama modül import'u
 * hiçbir zaman düşmesin.
 */
function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      // DİKKAT: `receiver` olarak Proxy DEĞİL, çözülen gerçek nesne verilir.
      // Firestore örneğindeki getter'lar `this` üzerinden dâhilî alanlara
      // eriştiği için Proxy'yi `this` yapmak "incompatible receiver" hatası
      // verir. Aynı sebeple metotlar gerçek örneğe bağlanır.
      const instance = resolve();
      const value = Reflect.get(instance as object, prop, instance);
      return typeof value === 'function' ? value.bind(instance) : value;
    },
    set(_target, prop, value) {
      return Reflect.set(resolve() as object, prop, value);
    },
    has(_target, prop) {
      return Reflect.has(resolve() as object, prop);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolve() as object);
    },
  });
}

const adminDb = lazyProxy<admin.firestore.Firestore>(resolveFirestore);
const adminAuth = lazyProxy<admin.auth.Auth>(resolveAuth);

/** Admin SDK gerçekten çalışıyor mu? Ağ çağrısı YAPMAZ. */
export function getAdminSdkStatus(): AdminSdkStatus {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    || process.env.GCLOUD_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || null;
  if (initError) {
    return { ready: false, credentialSource, projectId, error: initError.message };
  }
  try {
    resolveFirestore();
    return { ready: true, credentialSource, projectId, error: null };
  } catch (error: any) {
    return { ready: false, credentialSource, projectId, error: error?.message ?? String(error) };
  }
}

/**
 * Admin SDK'nın Firestore'a GERÇEKTEN erişebildiğini doğrular (tek belgelik
 * okuma). Kimlik bilgisi varken IAM izni olmayan durumu ancak bu yakalar.
 */
export async function probeAdminSdk(): Promise<AdminSdkStatus> {
  const status = getAdminSdkStatus();
  if (!status.ready) return status;
  try {
    await adminDb.collection('productCodes').limit(1).get();
    return status;
  } catch (error: any) {
    return { ...status, ready: false, error: error?.message ?? String(error) };
  }
}

export { adminDb, adminAuth };
