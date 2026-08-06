import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  Timestamp,
  where,
  type Firestore,
} from 'firebase/firestore';

type FormTypeLetter = 'T' | 'A';

const trToAscii = (value: string) =>
  value
    .replace(/ç/gi, 'c')
    .replace(/ğ/gi, 'g')
    .replace(/ı/gi, 'i')
    .replace(/ö/gi, 'o')
    .replace(/ş/gi, 's')
    .replace(/ü/gi, 'u');

export const buildPersonnelCode = (name: string | null | undefined) => {
  const cleaned = trToAscii(String(name || ''))
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (cleaned.length === 0) return 'XX';
  const initials = cleaned.map((part) => part.charAt(0)).join('');
  return initials.toUpperCase();
};

const formatSeq = (seq: number) => (seq <= 9999 ? String(seq).padStart(4, '0') : String(seq));

const SAYAC_KOLEKSIYONU = 'actionFormNumberCounters';

/**
 * Sayacın bir sonraki değeri.
 *
 * `tohum`, şirket sayacı ilk kez oluşturulurken eski kullanıcı sayaçlarının en
 * büyüğüdür. `Math.max` iki nedenle şart:
 *   - İlk çağrıda sayaç 0'dır; tohum uygulanmazsa numara var olanlarla çakışır.
 *   - Sonraki çağrılarda sayaç tohumu geçmiştir; tohum yeniden uygulanırsa
 *     numara GERİ GİDER. İki istemci aynı anda tohumlarsa da sonuç aynı kalır.
 */
export function sonrakiSeq(mevcut: number, tohum: number): number {
  return Math.max(Number(mevcut) || 0, Number(tohum) || 0) + 1;
}

/**
 * Şirket sayacının başlangıç değeri: aynı şirket + form tipi için var olan
 * KULLANICI BAZLI sayaçların en büyüğü.
 *
 * NEDEN GEREKLİ: sayaç kullanıcı bazlıydı (`${companyId}_${uid}_${tip}`) ve her
 * kullanıcı 1'den başlıyordu. Şirket bazına geçerken sıfırdan başlamak, var olan
 * numaralarla ÇAKIŞIRDI — A kullanıcısı T0001..T0050, B kullanıcısı T0001..T0030
 * üretmişse yeni sayaç yine T0001 verirdi.
 *
 * Yalnızca şirket sayacı henüz yokken bir kez çağrılır.
 */
async function eskiSayaclarinEnBuyugu(
  db: Firestore,
  companyId: string,
  formTypeLetter: FormTypeLetter,
): Promise<number> {
  const snap = await getDocs(query(
    collection(db, SAYAC_KOLEKSIYONU),
    where('companyId', '==', companyId === 'global' ? null : companyId),
    where('formTypeLetter', '==', formTypeLetter),
  ));

  let enBuyuk = 0;
  snap.forEach((d) => {
    const seq = Number(d.data()?.lastSeq || 0);
    if (Number.isFinite(seq) && seq > enBuyuk) enBuyuk = seq;
  });
  return enBuyuk;
}

export async function reserveActionFormNumber(params: {
  db: Firestore;
  companyId?: string | null;
  userUid: string;
  userName?: string | null;
  formTypeLetter: FormTypeLetter;
}) {
  const { db, companyId, userUid, userName, formTypeLetter } = params;
  const sirket = companyId || 'global';

  // Sayaç ŞİRKET bazlı. Kullanıcı bazlıyken aynı baş harfli iki personel aynı
  // numarayı üretebiliyordu (Batuhan Tubasar / Burak Toprak → ikisi de BT-T0042)
  // ve Ceomed irsaliye numarasının tekil olmasını zorunlu kıldığı için ikinci
  // kişinin irsaliyesi gönderilemiyordu. Sahada uygulamanın mükerrer numarayı
  // reddettiği gözlendi.
  const counterId = `${sirket}_${formTypeLetter}`;
  const counterRef = doc(db, SAYAC_KOLEKSIYONU, counterId);
  const personnelCode = buildPersonnelCode(userName);

  // Şirket sayacı ilk kez oluşturuluyorsa eski kullanıcı sayaçlarının üstünden
  // başlat; yoksa mevcut numaralarla çakışır. İşlem DIŞINDA okunur çünkü
  // Firestore işlemlerinde sorgu çalıştırılamaz. Yarış durumu zararsız: iki
  // istemci de aynı tohumu hesaplar ve işlem içindeki Math.max onu tek sefer
  // uygular.
  let tohum = 0;
  const mevcut = await getDoc(counterRef);
  if (!mevcut.exists()) {
    tohum = await eskiSayaclarinEnBuyugu(db, sirket, formTypeLetter);
  }

  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = Number(snap.data()?.lastSeq || 0);
    const next = sonrakiSeq(current, tohum);
    tx.set(counterRef, {
      companyId: companyId || null,
      formTypeLetter,
      lastSeq: next,
      // Son kullanan; sayaç artık kullanıcıya ait değil, yalnızca iz bırakır.
      sonUserUid: userUid,
      sonUserName: userName || null,
      ...(tohum > 0 && current === 0 ? { tohumlandi: tohum } : {}),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return next;
  });

  return `${personnelCode}-${formTypeLetter}${formatSeq(seq)}`;
}
