/**
 * Miad (son kullanma tarihi) ayrıştırma.
 *
 * Miad değeri sisteme birden çok kaynaktan girer ve her biri farklı biçim
 * kullanır: yerel `depoStok` kayıtları `dd.MM.yyyy`, Ceomed senkronu API'nin
 * ham `MIYAT` alanını olduğu gibi taşır (ISO veya gün/ay/yıl olabilir), elle
 * girilen bazı kayıtlarda ise yalnızca ay/yıl bulunur.
 *
 * Tek bir biçim varsayıp ayrıştıramadığında "miad yok" demek, sevkiyatta
 * yanlış tarafa düşen bir hatadır: miadı bilinmeyen lot risk hesabına
 * girmediği için riskli stok olduğundan az görünür ve FEFO sıralaması
 * bozulur. Bu yüzden yaygın biçimlerin tamamı denenir.
 */

/** Yalnızca ay/yıl verilmişse ayın son günü kabul edilir (miad ay sonunda dolar). */
function ayinSonGunu(yil: number, ay: number): number {
  return new Date(yil, ay, 0).getDate();
}

function gecerliMi(yil: number, ay: number, gun: number): boolean {
  if (!Number.isFinite(yil) || !Number.isFinite(ay) || !Number.isFinite(gun)) return false;
  if (yil < 1900 || yil > 2200) return false;
  if (ay < 1 || ay > 12) return false;
  return gun >= 1 && gun <= ayinSonGunu(yil, ay);
}

/** İki haneli yılı 2000'li yıllara taşır (miadlar geçmişe dönük olmaz). */
function yiliNormalize(parca: string): number {
  const sayi = Number(parca);
  if (parca.length <= 2) return 2000 + sayi;
  return sayi;
}

/**
 * Serbest biçimli bir miad değerini `Date`'e çevirir; çözemezse null döner.
 *
 * Desteklenen biçimler:
 *  - `dd.MM.yyyy`, `dd/MM/yyyy`, `dd-MM-yyyy` (ve tek haneli gün/ay)
 *  - `yyyy-MM-dd`, `yyyy.MM.dd`, `yyyy/MM/dd`
 *  - `MM.yyyy`, `MM/yyyy`, `yyyy-MM` → ayın son günü
 *  - `dd.MM.yy` → 2000'li yıl
 *  - Yukarıdakilerin saat ekli halleri (`31.12.2027 00:00:00`, ISO datetime)
 *  - `Date` ve Firestore Timestamp benzeri (`toDate()`) değerler
 */
export function parseMiad(raw: unknown): Date | null {
  if (raw == null) return null;

  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'object' && typeof (raw as { toDate?: unknown }).toDate === 'function') {
    const d = (raw as { toDate: () => Date }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }

  const metin = String(raw).trim();
  if (!metin) return null;

  // Saat kısmını at — miad gün hassasiyetinde kullanılır.
  const tarihKismi = metin.split(/[T\s]/)[0];
  const parcalar = tarihKismi.split(/[./-]/).filter(Boolean);

  if (parcalar.length === 3) {
    const [a, b, c] = parcalar;
    // 4 haneyle başlıyorsa yıl öndedir (ISO), aksi halde gün öndedir (TR).
    const yilOnde = a.length === 4;
    const yil = yilOnde ? Number(a) : yiliNormalize(c);
    const ay = Number(b);
    const gun = yilOnde ? Number(c) : Number(a);
    if (!gecerliMi(yil, ay, gun)) return null;
    return new Date(yil, ay - 1, gun);
  }

  if (parcalar.length === 2) {
    const [a, b] = parcalar;
    const yilOnde = a.length === 4;
    const yil = yilOnde ? Number(a) : yiliNormalize(b);
    const ay = yilOnde ? Number(b) : Number(a);
    if (!gecerliMi(yil, ay, 1)) return null;
    return new Date(yil, ay - 1, ayinSonGunu(yil, ay));
  }

  return null;
}

/**
 * Miada kalan gün sayısı; çözülemezse null.
 *
 * Bugünün saati sıfırlanır, yani "3 gün kaldı" takvim günü olarak okunur.
 * Geçmiş miadlarda negatif döner — çağıran bunu "tamamı riskli" olarak
 * değerlendirir.
 */
export function miadaKalanGun(raw: unknown, bugun: Date = new Date()): number | null {
  const tarih = parseMiad(raw);
  if (!tarih) return null;
  const bas = new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate());
  const son = new Date(tarih.getFullYear(), tarih.getMonth(), tarih.getDate());
  return Math.round((son.getTime() - bas.getTime()) / 86400000);
}
