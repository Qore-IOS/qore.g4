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
import { doc, serverTimestamp, setDoc, type Firestore, type WriteBatch } from 'firebase/firestore';

import {
  buildIrsaliyeGirisDoc,
  IRSALIYE_GIRIS_COLLECTION,
  type BuildIrsaliyeGirisInput,
  type BuildIrsaliyeGirisResult,
} from './irsaliye-giris';

export type EnqueueOutcome =
  | { enqueued: false; reason: 'yedek_parca_yok' | 'entegrasyon_acil_kapali' }
  | { enqueued: true; jobId: string; status: 'pending' | 'blocked'; blockedDetail: string | null };

/**
 * `enqueueIrsaliyeGirisAyri` sonucu.
 *
 * `EnqueueOutcome`'dan ayrı bir tip: ayrı yazım throw etmediği için başarısızlık
 * sebepleri arasında `yazilamadi` de var. Başarısızlık kolu TEK bir nesne şekli
 * olarak tutuluyor (`hata` her zaman var, sadece null olabilir) — böylece
 * `if (!sonuc.enqueued)` içinde hem `reason` hem `hata` doğrudan okunabiliyor.
 */
export type EnqueueAyriOutcome =
  | {
      enqueued: false;
      reason: 'yedek_parca_yok' | 'entegrasyon_acil_kapali' | 'yazilamadi';
      /** Yalnızca `reason === 'yazilamadi'` iken dolu. */
      hata: string | null;
    }
  | { enqueued: true; jobId: string; status: 'pending' | 'blocked'; blockedDetail: string | null };

/**
 * Entegrasyon anahtarı. Sorun çıkarsa tek satırla kapatılabilir.
 *
 * GEÇMİŞ: entegrasyon bir kez acil olarak kapatıldı. Sebebi kuyruk yazısının
 * form kaydıyla AYNI BATCH'te olmasıydı — canlı Firestore rules yayını geride
 * kalınca `ceomedIrsaliyeGirisJobs` yazımı reddediliyor, batch atomik olduğu
 * için formun tamamı `permission-denied` ile geri alınıyordu. Teknik servis ve
 * aplikasyon formları kapatılamaz hâle gelmişti.
 *
 * Artık kuyruk yazısı batch'ten AYRI ve form kaydından SONRA yapılıyor
 * (`enqueueIrsaliyeGirisAyri`), dolayısıyla kuyruk hatası form kaydını
 * düşüremez. Anahtar bu tasarım değişikliğiyle birlikte açıldı.
 */
const CEOMED_IRSALIYE_INTEGRATION_ENABLED = true;

/**
 * İşi verilen batch'e ekler.
 *
 * DİKKAT — form kaydetme yolunda BUNU KULLANMAYIN. Batch atomiktir: kuyruk
 * yazısı reddedilirse formun tamamı geri alınır ve form kaydedilemez. Sahada
 * tam bu yaşandı. Form akışı için `enqueueIrsaliyeGirisAyri` kullanın.
 *
 * Bu sürüm, kuyruk yazısının gerçekten atomik olması gereken (form dışı)
 * çağıranlar için duruyor.
 *
 * @returns `enqueued: false` yalnızca formda yedek parça yoksa döner — bu bir
 *          hata değil, beklenen durumdur.
 */
export function enqueueIrsaliyeGiris(
  db: Firestore,
  batch: WriteBatch,
  input: BuildIrsaliyeGirisInput,
): EnqueueOutcome {
  if (!CEOMED_IRSALIYE_INTEGRATION_ENABLED) {
    return { enqueued: false, reason: 'entegrasyon_acil_kapali' };
  }

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


/**
 * İşi kuyruğa AYRI bir yazımla ekler — form kaydı commit edildikten SONRA.
 *
 * NEDEN AYRI: irsaliye otomasyonu ikincil bir özellik; teknik/aplikasyon formu
 * kapatmak birincil iş. Aynı batch'te yazmak ikisini birbirine bağlıyor ve
 * kuyruk tarafındaki herhangi bir sorun (kural yayını geride kalmış, alan adı
 * değişmiş, koleksiyon yeni) formun tamamını düşürüyor. Sahada tam bu oldu.
 *
 * NE KAYBEDİYORUZ: atomiklik. Form kaydedilip kuyruk yazısı düşebilir. Bu
 * KURTARILABİLİR bir durum — iş panelden yeniden kuyruğa alınabilir ve
 * doküman kimliği form kimliği olduğu için mükerrer üretmez. Tersi
 * (kuyrukta iş var ama form yok) mümkün değil: kuyruk yazısı commit'ten sonra.
 *
 * ASLA THROW ETMEZ. Çağıran, form kaydı başarılı olduktan sonra çağırır;
 * buradan çıkan bir istisna kullanıcıya "form kaydedilemedi" gibi görünürdü.
 */
export async function enqueueIrsaliyeGirisAyri(
  db: Firestore,
  input: BuildIrsaliyeGirisInput,
): Promise<EnqueueAyriOutcome> {
  if (!CEOMED_IRSALIYE_INTEGRATION_ENABLED) {
    return { enqueued: false, reason: 'entegrasyon_acil_kapali', hata: null };
  }

  let result: BuildIrsaliyeGirisResult;
  try {
    result = buildIrsaliyeGirisDoc(input);
  } catch (e: any) {
    return { enqueued: false, reason: 'yazilamadi', hata: e?.message || String(e) };
  }

  if (result.outcome === 'skip') {
    return { enqueued: false, reason: 'yedek_parca_yok', hata: null };
  }

  const jobId = result.doc.formId;
  try {
    await setDoc(doc(db, IRSALIYE_GIRIS_COLLECTION, jobId), {
      ...result.doc,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (e: any) {
    // Form KAYDEDİLDİ. Buradaki hata yalnızca irsaliye otomasyonunu etkiler.
    return { enqueued: false, reason: 'yazilamadi', hata: e?.message || String(e) };
  }

  return {
    enqueued: true,
    jobId,
    status: result.doc.status === 'blocked' ? 'blocked' : 'pending',
    blockedDetail: result.doc.blockedDetail,
  };
}
