/**
 * Seri No Defteri — istemci (Web SDK) tarafı yazma/okuma yardımcıları.
 *
 * Tüm paneller (mal kabul, direkt transfer, sipariş toplama, ürün kullanım,
 * depo sayım, imha, borç) seri no olaylarını YALNIZCA buradan yazar. Böylece
 * olay sözlüğü, belge kimliği ve şirket etiketi tek yerde tanımlı kalır.
 */
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { normalizeCompanyId } from '@/lib/company-scope';
import {
  buildSerialLedgerId,
  isTrackableSerial,
  projectEventFields,
  projectLedgerFields,
  type SerialEventInput,
  type SerialLedgerEntry,
} from './core';

export const SERIAL_LEDGER_COLLECTION = 'serialLedger';
export const SERIAL_LEDGER_EVENTS = 'events';

/** Firestore `in` sorgusu tek seferde en fazla 30 değer kabul eder. */
const IN_CHUNK = 30;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface SerialLedgerWrite {
  ref: ReturnType<typeof doc>;
  data: Record<string, unknown>;
  merge: boolean;
}

/**
 * Bir olayın üreteceği Firestore yazımlarını, batch'e bağımlı olmadan döndürür.
 *
 * Mal kabul paneli 500 işlem sınırını kendi yöneten bir `BatchQueue` kullanır;
 * doğrudan `WriteBatch` alan yardımcıyı çağıramaz. Bu fonksiyon aynı yazımları
 * üretip kuyruğa devredilebilir hâle getirir.
 */
export function buildSerialLedgerWrites(
  input: SerialEventInput,
  companyId: string | null | undefined,
): SerialLedgerWrite[] {
  if (!isTrackableSerial(input.seriNumarasi)) return [];
  if (!(input.stokKodu || '').trim()) return [];

  const scopedCompanyId = normalizeCompanyId(companyId);
  const ledgerId = buildSerialLedgerId(scopedCompanyId, input.stokKodu, input.seriNumarasi);
  const ledgerRef = doc(db, SERIAL_LEDGER_COLLECTION, ledgerId);
  const now = Timestamp.now();

  return [
    {
      ref: ledgerRef,
      merge: true,
      data: {
        ...projectLedgerFields(input, scopedCompanyId),
        id: ledgerId,
        lastEventAt: now,
        updatedAt: serverTimestamp(),
        eventCount: increment(1),
      },
    },
    {
      ref: doc(collection(ledgerRef, SERIAL_LEDGER_EVENTS)),
      merge: false,
      data: {
        ...projectEventFields(input, scopedCompanyId),
        ledgerId,
        timestamp: now,
      },
    },
  ];
}

/**
 * Bir seri no olayını mevcut bir `writeBatch` içine ekler.
 *
 * Defter satırı `merge: true` ile güncellenir (yoksa oluşur), olay ise ayrı bir
 * alt-belge olarak yazılır. Böylece stok yazımı ile defter yazımı AYNI atomik
 * batch'te gerçekleşir: stok değişip defter değişmemesi mümkün olmaz.
 *
 * @returns Yazma yapıldıysa defter belge kimliği, sentetik/boş seride `null`.
 */
export function appendSerialEventToBatch(
  batch: WriteBatch,
  input: SerialEventInput,
  companyId: string | null | undefined,
): string | null {
  const writes = buildSerialLedgerWrites(input, companyId);
  if (writes.length === 0) return null;
  writes.forEach(write => {
    if (write.merge) batch.set(write.ref, write.data, { merge: true });
    else batch.set(write.ref, write.data);
  });
  // Firestore'da "yoksa yaz" tek batch'te ifade edilemez. Satırın ilk görülme
  // anı bu yüzden olay alt-koleksiyonundan (en eski olay) ya da geriye dönük
  // doldurmadan türetilir; defter satırında yalnızca sayaç artırılır.
  return String(writes[0].data.id);
}

/**
 * Tek bir olayı kendi batch'inde yazar. Stok yazımıyla aynı atomik işlemde
 * olması gerekmeyen çağrılar (ör. arka planda tamamlayıcı kayıtlar) içindir.
 */
export async function appendSerialEvent(
  input: SerialEventInput,
  companyId: string | null | undefined,
): Promise<string | null> {
  const batch = writeBatch(db);
  const ledgerId = appendSerialEventToBatch(batch, input, companyId);
  if (!ledgerId) return null;
  await batch.commit();
  return ledgerId;
}

/** Birden çok olayı 450'lik partiler hâlinde yazar. */
export async function appendSerialEvents(
  inputs: SerialEventInput[],
  companyId: string | null | undefined,
): Promise<number> {
  const writable = inputs.filter(i => isTrackableSerial(i.seriNumarasi) && (i.stokKodu || '').trim());
  let written = 0;
  // Her olay 3 yazma işlemi üretir (defter merge + ilk-kayıt + olay belgesi),
  // bu yüzden parti boyu 500 limitinin altında kalacak şekilde seçilir.
  for (const part of chunk(writable, 150)) {
    const batch = writeBatch(db);
    part.forEach(input => {
      if (appendSerialEventToBatch(batch, input, companyId)) written += 1;
    });
    await batch.commit();
  }
  return written;
}

/** Tek bir `ürün kodu + seri no` çiftinin defter satırını okur. */
export async function getSerialLedgerEntry(
  stokKodu: string,
  seriNumarasi: string,
  companyId: string | null | undefined,
): Promise<SerialLedgerEntry | null> {
  if (!isTrackableSerial(seriNumarasi) || !stokKodu) return null;
  const ledgerId = buildSerialLedgerId(normalizeCompanyId(companyId), stokKodu, seriNumarasi);
  const snap = await getDoc(doc(db, SERIAL_LEDGER_COLLECTION, ledgerId));
  if (!snap.exists()) return null;
  return { ...(snap.data() as SerialLedgerEntry), id: snap.id };
}

/**
 * Çok sayıda `ürün kodu + seri no` çiftini tek turda okur.
 *
 * Mal kabul commit'i yüzlerce seriyi birden kontrol eder; her seri için ayrı
 * `getDoc` yerine `documentId() in [...]` ile 30'luk partiler hâlinde okunur.
 *
 * @returns `${stokKodu}||${seriNumarasi}` anahtarlı defter satırları.
 */
export async function getSerialLedgerEntries(
  pairs: Array<{ stokKodu: string; seriNumarasi: string }>,
  companyId: string | null | undefined,
): Promise<Map<string, SerialLedgerEntry>> {
  const scopedCompanyId = normalizeCompanyId(companyId);
  const byLedgerId = new Map<string, { stokKodu: string; seriNumarasi: string }>();
  pairs.forEach(pair => {
    if (!isTrackableSerial(pair.seriNumarasi) || !pair.stokKodu) return;
    byLedgerId.set(buildSerialLedgerId(scopedCompanyId, pair.stokKodu, pair.seriNumarasi), pair);
  });

  const result = new Map<string, SerialLedgerEntry>();
  const ids = Array.from(byLedgerId.keys());
  if (ids.length === 0) return result;

  await Promise.all(
    chunk(ids, IN_CHUNK).map(async part => {
      const snap = await getDocs(
        query(collection(db, SERIAL_LEDGER_COLLECTION), where(documentId(), 'in', part)),
      );
      snap.docs.forEach(docSnap => {
        const data = { ...(docSnap.data() as SerialLedgerEntry), id: docSnap.id };
        result.set(`${data.stokKodu}||${data.seriNumarasi}`, data);
      });
    }),
  );

  return result;
}

/**
 * Bir seri numarasının TÜM ürün kodları altındaki satırlarını getirir.
 *
 * Barkod okutulduğunda "bu ürün geçmişte işlem görmüş mü" sorusuna, ürün kodu
 * henüz çözümlenemese bile cevap verebilmek için kullanılır.
 */
export async function getSerialLedgerBySerial(
  seriNumarasi: string,
  companyId: string | null | undefined,
  isSuperAdmin?: boolean,
): Promise<SerialLedgerEntry[]> {
  if (!isTrackableSerial(seriNumarasi)) return [];
  const base = collection(db, SERIAL_LEDGER_COLLECTION);
  const constraints = [where('seriNumarasi', '==', seriNumarasi.trim())];
  const q = isSuperAdmin
    ? query(base, ...constraints)
    : query(base, where('companyId', '==', normalizeCompanyId(companyId)), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ...(d.data() as SerialLedgerEntry), id: d.id }));
}

/** Bir defter satırının olay geçmişi (en yeniden eskiye). */
export async function getSerialLedgerEvents(ledgerId: string, take = 50) {
  const snap = await getDocs(
    query(
      collection(db, SERIAL_LEDGER_COLLECTION, ledgerId, SERIAL_LEDGER_EVENTS),
      orderBy('timestamp', 'desc'),
      limit(take),
    ),
  );
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
}
