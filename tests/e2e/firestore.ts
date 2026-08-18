/**
 * Testlerin emülatör verisini kurup doğrulamak için kullandığı Admin SDK
 * yardımcıları.
 *
 * NEDEN UI YERİNE ADMIN SDK
 *
 * Test ARANJMANI (bir lotu depoya koymak) UI'dan yapılırsa, bir akışı test
 * ederken başka bir akışa bağımlı hâle gelinir: mal kabul ekranı kırılınca
 * transfer testi de kırmızıya döner ve hata nereden geliyor belli olmaz.
 * Aranjman Admin SDK ile kurulur, DOĞRULAMA da Admin SDK ile yapılır; arada
 * kalan tek şey test edilen akışın kendisidir.
 */

import * as admin from 'firebase-admin';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PROJECT_ID, COMPANY_ID, DEPOT } = require('./seed.js') as {
  PROJECT_ID: string;
  COMPANY_ID: string;
  DEPOT: { id: string; name: string };
};

function db(): admin.firestore.Firestore {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST yok — testler gerçek projeye bağlanmayı reddediyor.');
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  return admin.firestore();
}

export interface StokGirdisi {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  seriNumarasi?: string;
  /** `dd.MM.yyyy` — sistemin `depoStok.miad` için kullandığı biçim. */
  miad: string;
  adet?: number;
}

/** Depoya tek bir stok belgesi koyar ve belge kimliğini döndürür. */
export async function depoyaStokKoy(girdi: StokGirdisi): Promise<string> {
  const ref = db().collection('depoStok').doc();
  await ref.set({
    companyId: COMPANY_ID,
    depotId: DEPOT.id,
    depotName: DEPOT.name,
    isShipped: false,
    adet: girdi.adet ?? 1,
    ...girdi,
  });
  return ref.id;
}

/** Bir stok belgesinin güncel hâli. */
export async function stokBelgesi(id: string): Promise<Record<string, unknown> | null> {
  const snap = await db().collection('depoStok').doc(id).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

/** Testler arası sızıntıyı önlemek için tüm stok belgelerini siler. */
export async function stoguTemizle(): Promise<void> {
  const snap = await db().collection('depoStok').get();
  await Promise.all(snap.docs.map(d => d.ref.delete()));
}

/** Oluşan transfer başlıklarını siler. */
export async function transferleriTemizle(): Promise<void> {
  const snap = await db().collection('transfers').get();
  await Promise.all(snap.docs.map(d => d.ref.delete()));
}

export { COMPANY_ID, DEPOT };
