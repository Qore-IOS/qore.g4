import { doc, runTransaction, Timestamp, type Firestore } from './data/client';

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

/**
 * Sıradaki form numarasını ayırır: `${personelKodu}-${T|A}${sıra}`.
 *
 * ═══ BU FONKSİYON ÜRETİMİ İKİ KEZ DURDURDU. OKUMADAN DEĞİŞTİRMEYİN. ═══
 *
 * Form kaydetme yolunda. Buradaki her Firestore erişimi, tüm teknik servis ve
 * aplikasyon formlarının kaydedilebilmesinin ön koşulu.
 *
 * 1. OLAY (#1811): buraya bir `list` sorgusu eklendi. Kurallar list'i belge
 *    belge değerlendiriyor; companyId talebiyle birebir eşleşmeyen tek bir
 *    belge tüm sorguyu reddediyor. Hiç kimse form kaydedemedi. (#1818 ile geri
 *    alındı.)
 *
 * 2. OLAY (#1825): sayaç, VAR OLMAYAN yeni bir dokümana taşındı
 *    (`ISLAB2_pfx_BX_T`). `permission-denied`. Sebep: `inCompany()` kuralı
 *    `resource.data.companyId` okuyor; doküman yoksa `resource` null olduğu
 *    için ifade hata veriyor ve erişim reddediliyor. "get var olmayan belgeye
 *    izinli" varsayımı YANLIŞTI — kuraldaki etiketsiz-belge dalı var olan ama
 *    companyId taşımayan belgeler için, hiç var olmayanlar için değil.
 *
 *    Eski kod bu tuzağa düşmüyordu çünkü sayaç dokümanı kullanıcı bazlıydı ve
 *    üretimdeki her kullanıcının dokümanı ZATEN VARDI. Yeni bir doküman
 *    kimliğine geçmek, herkesi "ilk kez okuma" durumuna soktu.
 *
 * KURAL: burada yalnızca VAR OLDUĞU GARANTİ olan tek bir dokümana `get` yapın.
 * Yeni bir sayaç kimliğine geçmek, önce `firestore.rules`'da var olmayan
 * belgeye okuma izni verilmesini (ve o kuralın CANLIYA ÇIKMASINI) gerektirir.
 *
 * Bilinen açık: sayaç kullanıcı bazlı olduğu için aynı Ceomed ön ekine düşen
 * iki personel aynı irsaliye numarasını üretebiliyor. Ceomed mükerreri
 * reddediyor, yani sessiz yanlış kayıt değil, panelde `failed` iş olarak çıkar.
 * Çözümü kural değişikliği gerektirir; ayrıntı ORACLE-IRSALIYE.md.
 */
export async function reserveActionFormNumber(params: {
  db: Firestore;
  companyId?: string | null;
  userUid: string;
  userName?: string | null;
  formTypeLetter: FormTypeLetter;
}) {
  const { db, companyId, userUid, userName, formTypeLetter } = params;
  const counterId = `${companyId || 'global'}_${userUid}_${formTypeLetter}`;
  const counterRef = doc(db, 'actionFormNumberCounters', counterId);
  const personnelCode = buildPersonnelCode(userName);

  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = Number(snap.data()?.lastSeq || 0);
    const next = current + 1;
    tx.set(counterRef, {
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
