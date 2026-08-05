/**
 * Ceomed irsaliye giriş işini Firestore kuyruğuna yazar.
 *
 * `irsaliye-giris.ts` saf eşleme katmanıdır; bu dosya onun ürettiği dokümanı
 * Firestore'a bağlar. Ayrı tutulmalarının sebebi eşleme kurallarının Firebase
 * SDK'sı olmadan test edilebilmesidir.
 *
 * İDEMPOTENS: doküman kimliği form kimliğinden türetilir (`formId`). Form kaydı
 * yeniden denenirse, tarayıcı yenilenirse ya da aynı batch iki kez uygulanırsa
 * aynı kimlik üretilir — muhasebeye MÜKERRER irsaliye düşmez. Bu, tam otomatik
 * gönderim modunda pazarlık konusu değildir.
 */
import { doc, serverTimestamp, type Firestore, type WriteBatch } from 'firebase/firestore';

import {
  buildIrsaliyeGirisDoc,
  IRSALIYE_GIRIS_COLLECTION,
  type BuildIrsaliyeGirisInput,
  type BuildIrsaliyeGirisResult,
} from './irsaliye-giris';

export type EnqueueOutcome =
  | { enqueued: false; reason: 'yedek_parca_yok' }
  | { enqueued: true; jobId: string; status: 'pending' | 'blocked'; blockedDetail: string | null };

/**
 * İşi verilen batch'e ekler. Formun kendi kaydıyla AYNI batch'te yazılmalıdır:
 * form kaydı başarısız olursa irsaliye işi de yazılmaz, tersi de geçerlidir.
 *
 * @returns `enqueued: false` yalnızca formda yedek parça yoksa döner — bu bir
 *          hata değil, beklenen durumdur.
 */
export function enqueueIrsaliyeGiris(
  db: Firestore,
  batch: WriteBatch,
  input: BuildIrsaliyeGirisInput,
): EnqueueOutcome {
  const result: BuildIrsaliyeGirisResult = buildIrsaliyeGirisDoc(input);

  if (result.outcome === 'skip') {
    return { enqueued: false, reason: 'yedek_parca_yok' };
  }

  const jobId = result.doc.formId;
  batch.set(doc(db, IRSALIYE_GIRIS_COLLECTION, jobId), {
    ...result.doc,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return {
    enqueued: true,
    jobId,
    status: result.doc.status === 'blocked' ? 'blocked' : 'pending',
    blockedDetail: result.doc.blockedDetail,
  };
}
