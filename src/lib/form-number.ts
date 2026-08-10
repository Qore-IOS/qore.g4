import { doc, runTransaction, Timestamp, type Firestore } from 'firebase/firestore';

import { ceomedNoOnEki, ceomedNumaraAlani } from '@/lib/ceomed/irsaliye-giris';

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

const sayiVeya0 = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Kullanıcı bazlı ESKİ sayacın kimliği. Yalnızca geçiş için okunuyor. */
const eskiSayacKimligi = (companyId: string | null | undefined, userUid: string, tip: FormTypeLetter) =>
  `${companyId || 'global'}_${userUid}_${tip}`;

/**
 * Sıradaki form numarasını ayırır: `${personelKodu}-${T|A}${sıra}`.
 *
 * SORGU YOK — YALNIZCA TEKİL DOKÜMAN OKUMASI. Bu kısıt pazarlık konusu değil:
 * bu fonksiyon form kaydetme yolunda ve bir kez buraya Firestore *list* sorgusu
 * eklendiğinde üretim tamamen durdu. Kurallar list'i belge belge değerlendiriyor,
 * companyId talebiyle birebir eşleşmeyen tek bir belge tüm sorguyu reddediyor ve
 * hiç kimse form kaydedemiyordu. `get` güvenli (kural var olmayan belgeye de
 * izin veriyor), `list` değil.
 */
export async function reserveActionFormNumber(params: {
  db: Firestore;
  companyId?: string | null;
  userUid: string;
  userName?: string | null;
  formTypeLetter: FormTypeLetter;
}) {
  const { db, companyId, userUid, userName, formTypeLetter } = params;
  const personnelCode = buildPersonnelCode(userName);
  const onEk = ceomedNoOnEki(personnelCode);

  // Sayaç, Ceomed'de çakışabilecek numara kümesiyle anahtarlanır — kullanıcıyla
  // değil. Sayaç kullanıcı bazlıyken aynı ön eke düşen iki personel ikisi de
  // 1'den başlıyor, aynı Ceomed numarasını üretiyor ve uygulama mükerrer diye
  // reddediyordu. Ön eki paylaşan herkes artık TEK sayacı paylaşıyor.
  const counterRef = doc(
    db,
    'actionFormNumberCounters',
    ceomedNumaraAlani(companyId, personnelCode, formTypeLetter),
  );
  const eskiRef = doc(db, 'actionFormNumberCounters', eskiSayacKimligi(companyId, userUid, formTypeLetter));

  const seq = await runTransaction(db, async (tx) => {
    const [snap, eskiSnap] = await Promise.all([tx.get(counterRef), tx.get(eskiRef)]);

    // GEÇİŞ: paylaşılan sayaç yeni, eski kullanıcı sayaçları ise numara dağıtmış
    // durumda. Sıfırdan başlamak zaten verilmiş numaraları yeniden üretirdi.
    // İkisinin büyüğünden devam ediyoruz; ön eki paylaşan her kullanıcı ilk
    // kaydında kendi eski değerini de getirdiği için paylaşılan sayaç birkaç
    // kayıt içinde hepsinin üstüne çıkıyor.
    //
    // ARTIK RİSK: A kullanıcısı geçtikten sonra B ilk kez kaydedene kadar, B'nin
    // geçmişte kullandığı aralıkta numara üretilebilir. Sorgu yapmadan bunu
    // tamamen kapatmanın yolu yok — ve sorgu tam olarak üretimi durduran şeydi.
    // Emniyet ağı Ceomed tarafında: mükerrer numarayı REDDEDİYOR, yani çakışma
    // sessiz yanlış kayıt değil, panelde görünen `failed` bir iş olarak çıkar.
    const current = Math.max(sayiVeya0(snap.data()?.lastSeq), sayiVeya0(eskiSnap.data()?.lastSeq));
    const next = current + 1;

    tx.set(counterRef, {
      companyId: companyId || null,
      ceomedOnEki: onEk,
      formTypeLetter,
      lastSeq: next,
      // Hangi kullanıcının en son çektiği; sayaç paylaşıldığı için "sahibi" yok.
      sonUserUid: userUid,
      sonUserName: userName || null,
      sonPersonnelCode: personnelCode,
      updatedAt: Timestamp.now(),
    }, { merge: true });

    // Eski sayacı da ilerlet: geri dönülmesi gerekirse kullanıcı bazlı sayaç
    // geride kalmış olmasın ve daha önce verilmiş numaraları tekrar dağıtmasın.
    tx.set(eskiRef, {
      companyId: companyId || null,
      userUid,
      userName: userName || null,
      formTypeLetter,
      personnelCode,
      lastSeq: next,
      updatedAt: Timestamp.now(),
    }, { merge: true });

    return next;
  });

  return `${personnelCode}-${formTypeLetter}${formatSeq(seq)}`;
}
