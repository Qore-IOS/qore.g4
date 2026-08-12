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
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';

import {
  buildIrsaliyeGirisDoc,
  cariCoz,
  IRSALIYE_GIRIS_COLLECTION,
  type BuildIrsaliyeGirisInput,
  type BuildIrsaliyeGirisResult,
  type CariCozum,
  type LabCariBilgisi,
} from './irsaliye-giris';

/**
 * Bir laboratuvarın Ceomed cari kodunu ve sevk adresini Firestore'dan çözer.
 *
 * Ek hizmet binalarının Ceomed'de kendi carisi yok; bağlı oldukları ana labın
 * carisi üzerinden faturalanıyorlar. Bağ ANA LABDA tutuluyor
 * (`hospitals/{ana}.ekHizmetLabIds` dizisi), o yüzden ana labı bulmak bir
 * `array-contains` SORGUSU gerektiriyor.
 *
 * ⚠️ BU FONKSİYON FORM KAYDETME YOLUNDA ÇAĞRILMAMALI. Sorgular Firestore
 * kurallarınca belge belge değerlendiriliyor; form kaydında bir sorgunun
 * reddedilmesi tüm kaydı düşürür ve üretimi durdurur (iki kez yaşandı).
 * Çağrı yeri her zaman `batch.commit()` SONRASI olmalı.
 *
 * Sorgu başarısız olursa istisna fırlatmaz: elde ne varsa onunla döner ve iş
 * `blocked` olarak kuyruğa girer — operatör panelden yeniden deneyebilir.
 */
export async function cariCozAsync(
  db: Firestore,
  hospitalId: string,
): Promise<CariCozum & { hata: string | null }> {
  const bos = { cariKodu: '', sevkAdresi: '', kaynak: 'yok' as const, anaLabAdi: null, hata: null };
  if (!hospitalId) return { ...bos, hata: 'Laboratuvar kimliği yok.' };

  let lab: LabCariBilgisi | null = null;
  try {
    const snap = await getDoc(doc(db, 'hospitals', hospitalId));
    if (!snap.exists()) return { ...bos, hata: 'Laboratuvar kaydı bulunamadı.' };
    lab = { id: snap.id, ...(snap.data() as any) };
  } catch (e: any) {
    return { ...bos, hata: `Laboratuvar okunamadı: ${e?.message || e}` };
  }

  // Kendi carisi varsa ana labı aramaya hiç gerek yok.
  const kendi = cariCoz(lab, null);
  if (kendi.kaynak === 'kendi') return { ...kendi, hata: null };

  // BİRİNCİL YOL — ters bağ: çocuk kendi ana labını taşıyor, tek `get` yeter.
  // Sorgu yok, dolayısıyla list kuralı tuzağı da yok.
  const anaLabId = String((lab as any)?.anaLabId || '').trim();
  if (anaLabId) {
    try {
      const snap = await getDoc(doc(db, 'hospitals', anaLabId));
      if (snap.exists()) {
        return { ...cariCoz(lab, { id: snap.id, ...(snap.data() as any) }), hata: null };
      }
      return { ...cariCoz(lab, null), hata: `Ana lab kaydı (${anaLabId}) bulunamadı.` };
    } catch (e: any) {
      return { ...cariCoz(lab, null), hata: `Ana lab okunamadı: ${e?.message || e}` };
    }
  }

  // YEDEK YOL — ters bağı henüz yazılmamış eski kayıtlar için. Bu bir LIST
  // sorgusu: kurallar dönen belgeyi tek tek denetliyor, ana labın companyId'si
  // eşleşmezse sorgunun tamamı reddedilir. Bu yüzden birincil yol değil.
  // Ana lab bir kez Yönetim → Laboratuvarlar'dan kaydedilince ters bağ yazılır
  // ve bu yola bir daha düşülmez.
  try {
    const q = query(
      collection(db, 'hospitals'),
      where('ekHizmetLabIds', 'array-contains', hospitalId),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      return { ...cariCoz(lab, null), hata: 'Bu laboratuvar hiçbir ana laba ek hizmet olarak bağlı değil.' };
    }
    const d = snap.docs[0];
    return { ...cariCoz(lab, { id: d.id, ...(d.data() as any) }), hata: null };
  } catch (e: any) {
    // Sessizce yutmak, izin hatasını "cari kodu tanımlı değil" gibi gösterip
    // operatörü var olmayan bir veri eksiğini aramaya yollardı.
    return {
      ...cariCoz(lab, null),
      hata:
        `Ana lab aranamadı: ${e?.message || e}. Ana laboratuvarı Yönetim → ` +
        'Laboratuvarlar ekranından bir kez kaydedin; bağ doğrudan yazılır ve ' +
        'bu arama gerekmez.',
    };
  }
}

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
