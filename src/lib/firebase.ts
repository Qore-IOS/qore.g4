// Import the functions you need from the SDKs you need
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator } from "firebase/firestore";
import { getAnalytics, type Analytics, isSupported } from "firebase/analytics";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

/**
 * E2E emülatör kipi.
 *
 * Uçtan uca testler gerçek Firebase projesine dokunamaz: üretim verisini
 * bozarlar ve CI'da kimlik bilgisi gerektirirler. Bu bayrak açıkken istemci
 * SDK'sı yerel emülatörlere bağlanır.
 *
 * Bayrak SADECE `NEXT_PUBLIC_FIREBASE_EMULATOR === '1'` ile açılır ve
 * `.env` dosyalarında bulunmaz — yalnızca test koşucusu tarafından verilir.
 * Değer yoksa aşağıdaki blokların hiçbiri çalışmaz, üretim yolu birebir
 * eskisi gibidir.
 */
export const EMULATOR_MODE = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === '1';
const EMULATOR_HOST = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';
const FIRESTORE_EMULATOR_PORT = Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT || 8080);
const AUTH_EMULATOR_PORT = Number(process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT || 9099);

// Config using environment variables
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: `https://${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}-default-rtdb.europe-west1.firebasedatabase.app`,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

let app: FirebaseApp;

if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

// Firestore'u offline persistence ile başlat
// Bu sayede internet kesildiğinde yazma işlemleri yerel olarak saklanır
// ve bağlantı geldiğinde otomatik senkronize edilir
/**
 * Emülatör bağlantısının bir kereden fazla kurulmasını engelleyen bayrak.
 *
 * Next.js geliştirme sunucusu bu modülü sıcak yeniden yükleme sırasında
 * yeniden değerlendirir. `getApps()` koruması uygulamanın yeniden
 * başlatılmasını önler ama `getFirestore(app)` AYNI örneği döndürür ve
 * `connectFirestoreEmulator` o örnek üzerinde ikinci kez çağrılır. SDK bunu
 * içeriden şu hatayla karşılar:
 *
 *   FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)
 *
 * Belirti sinsidir: ilk sorgu geçer, sonrakiler sessizce boş döner. Panelde
 * "laboratuvar yok" gibi görünür, bir bağlantı hatası gibi değil.
 */
const emulatorBayragi = globalThis as { __qoreEmulatorBagli?: boolean };

let db;
if (EMULATOR_MODE) {
  // Emülatörde kalıcı önbellek KULLANILMAZ. IndexedDB önbelleği test koşuları
  // arasında tarayıcı profilinde yaşamaya devam eder ve bir testin yazdığı
  // veri sonrakine sızar; ayrıca tohumlanan veri ile önbellek arasındaki
  // ayrışma testleri kararsız yapar. Emülatör zaten yereldir, çevrimdışı
  // dayanıklılığa gerek yoktur.
  db = getFirestore(app);
  if (!emulatorBayragi.__qoreEmulatorBagli) {
    emulatorBayragi.__qoreEmulatorBagli = true;
    connectFirestoreEmulator(db, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
    connectAuthEmulator(getAuth(app), `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, { disableWarnings: true });
  }
} else if (typeof window !== 'undefined') {
  // Client-side: offline persistence aktif
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      }),
      ignoreUndefinedProperties: true, // Undefined değerleri yoksay - batch işlemlerde hata önler
    });
  } catch {
    // Zaten başlatılmışsa normal getFirestore kullan
    db = getFirestore(app);
  }
} else {
  // Server-side: normal Firestore
  db = getFirestore(app);
}

const functions = getFunctions(app, "europe-west1");
const storage = getStorage(app);

let analytics: Analytics | null = null;

// Conditionally initialize Analytics only on the client-side, delayed to avoid blocking hydration.
// Emülatör kipinde atlanır: Analytics'in emülatörü yoktur, Google'a çıkmaya
// çalışır ve testlerde işe yaramaz "Failed to fetch" gürültüsü üretir.
if (typeof window !== "undefined" && !EMULATOR_MODE) {
  const initAnalytics = () => {
    isSupported().then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
      }
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(initAnalytics);
  } else {
    setTimeout(initAnalytics, 2000);
  }
}

export { app, db, functions, analytics, storage };
