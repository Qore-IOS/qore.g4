/**
 * Kuyruktan gelen Ceomed irsaliye giriş işinin worker tarafındaki doğrulaması.
 *
 * Bu, `src/lib/ceomed/irsaliye-giris.ts` içindeki kuralların İKİNCİ savunma
 * hattıdır — kopya değil, bilinçli tekrar. Web tarafı işi üretirken doğrular;
 * worker yazmadan hemen önce bir daha doğrular. Sebep: kuyruk dokümanı Firestore
 * konsolundan elle düzenlenmiş, eski bir sürüm tarafından yazılmış ya da yeniden
 * kuyruğa alınırken bozulmuş olabilir. Muhasebeye e-irsaliye gönderimi geri
 * alınamadığı için "muhtemelen doğrudur" yeterli değildir.
 *
 * Saf fonksiyonlar: Firestore/ağ/UI bağımlılığı yoktur.
 */

const ISLEM_TIPI = '35';
const DEPO = '10';
const COLLECTION = 'ceomedIrsaliyeGirisJobs';

const text = (v) => String(v == null ? '' : v).trim();

/** ISO tarihi (YYYY-MM-DD) Ceomed formunun maskesine çevirir. */
function formatTarih(iso, separator = '/') {
  const m = text(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${d}${separator}${mo}${separator}${y}`;
}

/**
 * İşin uygulamaya yazılmaya hazır olup olmadığını denetler.
 *
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
function validateJob(job) {
  const errors = [];

  if (!job || typeof job !== 'object') {
    return { ok: false, errors: ['İş dokümanı boş.'] };
  }

  if (!text(job.irsaliyeNo)) errors.push('irsaliyeNo boş.');
  if (!text(job.cariKodu)) errors.push('cariKodu boş.');
  if (!formatTarih(job.tarih)) errors.push(`tarih ISO biçiminde değil: "${text(job.tarih)}".`);
  if (!text(job.aciklama)) errors.push('aciklama (personel adı) boş.');

  // Sabitler asla "yaklaşık" olmamalı: yanlış işlem tipi/depo muhasebede sessizce
  // yanlış hesaba düşer, sonradan ayıklaması çok pahalıdır.
  if (text(job.islemTipi) !== ISLEM_TIPI) {
    errors.push(`islemTipi "${ISLEM_TIPI}" olmalı, "${text(job.islemTipi)}" geldi.`);
  }
  if (text(job.depo) !== DEPO) {
    errors.push(`depo "${DEPO}" olmalı, "${text(job.depo)}" geldi.`);
  }

  const satirlar = Array.isArray(job.satirlar) ? job.satirlar : [];
  if (satirlar.length === 0) {
    errors.push('Yazılacak yedek parça satırı yok.');
  }
  satirlar.forEach((s, i) => {
    if (!text(s && s.stokKodu)) errors.push(`${i + 1}. satırda stokKodu boş.`);
    const miktar = Number(s && s.miktar);
    if (!Number.isFinite(miktar) || miktar <= 0) {
      errors.push(`${i + 1}. satırda miktar geçersiz: "${s && s.miktar}".`);
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * İşi sürücünün tuşlayacağı düz alan listesine çevirir.
 * Sürücüler bu şekli bekler; iş dokümanının şeması değişirse tek yer burasıdır.
 */
function toKeystrokePlan(job, { dateSeparator = '/' } = {}) {
  return {
    header: {
      irsaliyeNo: text(job.irsaliyeNo),
      cariKodu: text(job.cariKodu),
      // Ek hizmet binalarında cari ANA LABDAN gelir; irsaliyenin doğru
      // binaya gitmesini bu alan sağlar. Tanımsızsa boş geçilir ve sürücü
      // alana dokunmaz — boş yazmak mevcut değeri silmek olurdu.
      sevkAdresi: text(job.sevkAdresi),
      tarih: formatTarih(job.tarih, dateSeparator),
      islemTipi: ISLEM_TIPI,
      depo: DEPO,
    },
    rows: (job.satirlar || []).map((s) => ({
      stokKodu: text(s.stokKodu),
      stokAdi: text(s.stokAdi),
      miktar: Number(s.miktar) || 1,
      lot: text(s.lot),
      miad: text(s.miad),
    })),
    aciklama: text(job.aciklama),
  };
}

/** Log/insan okuması için işin tek satırlık özeti. */
function describeJob(job) {
  const n = Array.isArray(job.satirlar) ? job.satirlar.length : 0;
  return `${text(job.irsaliyeNo) || '(no yok)'} → ${text(job.cariKodu) || '(cari yok)'} • ${n} satır`;
}

module.exports = { ISLEM_TIPI, DEPO, COLLECTION, formatTarih, validateJob, toKeystrokePlan, describeJob };
