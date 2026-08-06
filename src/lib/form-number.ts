import { doc, runTransaction, Timestamp, type Firestore } from 'firebase/firestore';

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
