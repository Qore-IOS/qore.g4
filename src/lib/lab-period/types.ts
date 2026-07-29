/**
 * Laboratuvar-dönem anlık görüntüsü (snapshot).
 *
 * Bir laboratuvarın bir döneme ait stoğu, cihaz üstü testi ve kümülatifi
 * bugüne kadar beş ayrı yerde tutuluyordu: lab sayım paneli, maliyet sayım
 * paneli, total verimlilik tablosunun ay başı sütunları, cihaz üstü hesaplama
 * ve kümülatif hesaplama geçmişleri. Veriye ihtiyaç duyan her panel bu beş
 * yeri sırayla denemek zorunda kalıyor, biri boşsa veri "yok" görünüyordu.
 *
 * Bu koleksiyon tek doğruluk kaynağıdır: veri hangi panelden girilirse
 * girilsin buraya yazılır, okuyan da yalnızca buraya bakar.
 */

/** Ölçülen büyüklük. */
export type OlcumAlani = 'stok' | 'cihazUstu' | 'kumulatif';

/** Değeri yazan panel. */
export type Kaynak =
  | 'lab-sayim'
  | 'maliyet-sayim'
  | 'total-verimlilik'
  | 'cihaz-ustu-hesaplama'
  | 'kumulatif-hesaplama'
  | 'geriye-donuk-aktarim';

export const KAYNAK_ADI: Record<Kaynak, string> = {
  'lab-sayim': 'Lab Sayım',
  'maliyet-sayim': 'Maliyet Sayım',
  'total-verimlilik': 'Total Verimlilik',
  'cihaz-ustu-hesaplama': 'Cihaz Üstü Hesaplama',
  'kumulatif-hesaplama': 'Kümülatif Hesaplama',
  'geriye-donuk-aktarim': 'Geriye Dönük Aktarım',
};

/** Tek bir (lab, dönem, ürün, alan) ölçümü ve kim tarafından girildiği. */
export interface OlcumDegeri {
  /** stok → kutu, cihazUstu → test, kumulatif → test */
  deger: number;
  /**
   * Ölçümün alt kırılımı; yalnızca kaynağı taşıyorsa dolar.
   *
   * Kümülatifte `{ routine, rerun, calib, control }` olarak gelir — kümülatif
   * hesaplama paneli bu kırılımı üretir ve geri okurken tabloya yazabilmelidir.
   * Kırılım toplamla birlikte taşınır ama `deger` her zaman toplamdır; okuyan
   * paneller kırılımı yoksayabilir.
   */
  kirilim?: Record<string, number>;
  /** Değeri en son yazan panel */
  kaynak: Kaynak;
  /** Kaynak koleksiyondaki kayıt id'si (denetim için) */
  kaynakKayitId?: string;
  /** Değeri en son yazan kullanıcı */
  girenAdi?: string;
  /** İlk sayımı yapan panel — sonradan düzenlense de korunur */
  ilkKaynak: Kaynak;
  /** İlk kaydın zamanı (epoch ms) */
  ilkKayitZamani: number;
  /** Son güncelleme zamanı (epoch ms) */
  guncellemeZamani: number;
  /** Kaç kez düzenlendiği (0 = ilk kayıttan beri değişmedi) */
  duzenlemeSayisi: number;
}

export interface LabDonemSnapshot {
  companyId: string;
  labId: string;
  labAdi: string;
  /** "YYYY-MM" */
  donem: string;
  yil: number;
  /** 1-12 */
  ay: number;
  /** stokKodu -> kutu */
  stok: Record<string, OlcumDegeri>;
  /** stokKodu -> cihaz üstü açık test */
  cihazUstu: Record<string, OlcumDegeri>;
  /** stokKodu -> kümülatif test */
  kumulatif: Record<string, OlcumDegeri>;
  /**
   * Geriye dönük aktarımda işlenmiş kaynak kayıtları (`kaynak:kayitId`).
   *
   * Aktarım yönetim panelinden elle tetiklenir ve birden çok kez
   * çalıştırılabilir. Bu liste olmadan ikinci çalıştırma, eski kayıtları
   * yeniden oynatıp aradaki canlı düzenlemeleri geri alır. Burada tutulan
   * kayıtlar aktarımda atlanır; canlı yazmalar bu listeden etkilenmez.
   */
  islenmisKaynakKayitlari?: string[];
  guncellemeZamani: number;
}

/** Bir panelin yazmak istediği tek ölçüm. */
export interface OlcumGirdisi {
  stokKodu: string;
  alan: OlcumAlani;
  deger: number;
  /** Varsa ölçümün alt kırılımı (bkz. `OlcumDegeri.kirilim`) */
  kirilim?: Record<string, number>;
}

/** Bir yazma işleminin ortak bilgileri. */
export interface YazmaBaglami {
  kaynak: Kaynak;
  kaynakKayitId?: string;
  girenAdi?: string;
  /** Epoch ms; verilmezse çağrıldığı an */
  zaman?: number;
}

/** Birleştirme sonucunun ne değiştirdiği — panelde ve denetimde gösterilir. */
export interface BirlestirmeSonucu {
  snapshot: LabDonemSnapshot;
  /** İlk kez yazılan ölçüm sayısı */
  eklenen: number;
  /** Mevcut değeri değiştiren (düzenleme sayılan) ölçüm sayısı */
  guncellenen: number;
  /** Değeri aynı olduğu için dokunulmayan ölçüm sayısı */
  degismeyen: number;
  /** Düzenlenen ölçümlerin kırılımı (denetim için) */
  degisiklikler: Array<{
    stokKodu: string;
    alan: OlcumAlani;
    eskiDeger: number;
    yeniDeger: number;
    eskiKaynak: Kaynak;
    yeniKaynak: Kaynak;
  }>;
}

/** Firestore doküman kimliği — (şirket, lab, dönem) üçlüsü tekildir. */
export function snapshotDocId(companyId: string, labId: string, donem: string): string {
  const temiz = (v: string) => String(v || '').trim().replace(/\//g, '_');
  return `${temiz(companyId) || '__legacy__'}__${temiz(labId)}__${temiz(donem)}`;
}

/** "YYYY-MM" dönem anahtarı (ay 1-12). */
export function donemAnahtari(yil: number, ay: number): string {
  return `${yil}-${String(ay).padStart(2, '0')}`;
}
