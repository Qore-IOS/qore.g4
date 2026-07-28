import {
  donemAnahtari,
  type BirlestirmeSonucu,
  type Kaynak,
  type LabDonemSnapshot,
  type OlcumAlani,
  type OlcumDegeri,
  type OlcumGirdisi,
  type YazmaBaglami,
} from './types';

/**
 * Lab-dönem birleştirme kuralı.
 *
 * "İlk yapılan sayım asıl sayımdır; sonra hangi panel açılırsa dolu gelir;
 * herhangi bir panelden düzenlenirse her yerde değişir."
 *
 * Bunun koda çevrilmiş hali üç durumdur:
 *
 *  1. **Alan boşsa** → gelen değer kurulur. Hangi panelden geldiği `ilkKaynak`
 *     olarak saklanır ve bir daha değişmez; "bu sayımı ilk kim yaptı"
 *     sorusunun cevabı kalıcıdır.
 *  2. **Alan doluysa ve gelen değer aynıysa** → hiçbir şey yapılmaz. Bu, veriyi
 *     dolu olarak açıp değiştirmeden kaydeden panelin durumudur; kaydeden
 *     panelin adı sayımın sahibi olarak yazılmaz.
 *  3. **Alan doluysa ve gelen değer farklıysa** → düzenlemedir. Değer ve son
 *     kaynak güncellenir, `ilkKaynak` korunur, `duzenlemeSayisi` artar ve
 *     değişiklik denetim için raporlanır.
 *
 * Üçüncü kuralın doğru çalışması panellerin veriyi **dolu açmasına** bağlıdır:
 * panel mevcut değeri göstermeden kaydederse kendi hesabındaki sayı düzenleme
 * sanılır. Bu yüzden yazan her panel aynı snapshot'ı okuyup ön-doldurmalıdır.
 */
export function bosSnapshot(
  companyId: string,
  labId: string,
  labAdi: string,
  yil: number,
  ay: number,
): LabDonemSnapshot {
  return {
    companyId: companyId || '__legacy__',
    labId,
    labAdi,
    donem: donemAnahtari(yil, ay),
    yil,
    ay,
    stok: {},
    cihazUstu: {},
    kumulatif: {},
    guncellemeZamani: 0,
  };
}

const ALANLAR: OlcumAlani[] = ['stok', 'cihazUstu', 'kumulatif'];

/** Sayı olmayan / negatif değerler yazılmaz — eksik veri sıfır sayılmamalı. */
function gecerliDeger(deger: unknown): number | null {
  const sayi = Number(deger);
  if (!Number.isFinite(sayi) || sayi < 0) return null;
  return sayi;
}

/**
 * Gelen ölçümleri snapshot'a işler ve neyin değiştiğini raporlar.
 *
 * Saf fonksiyondur: girdiyi değiştirmez, yeni snapshot döndürür.
 */
export function birlestir(
  mevcut: LabDonemSnapshot,
  girdiler: OlcumGirdisi[],
  baglam: YazmaBaglami,
): BirlestirmeSonucu {
  const zaman = baglam.zaman ?? Date.now();
  const sonuc: BirlestirmeSonucu = {
    snapshot: {
      ...mevcut,
      stok: { ...mevcut.stok },
      cihazUstu: { ...mevcut.cihazUstu },
      kumulatif: { ...mevcut.kumulatif },
    },
    eklenen: 0,
    guncellenen: 0,
    degismeyen: 0,
    degisiklikler: [],
  };

  girdiler.forEach(girdi => {
    const stokKodu = String(girdi?.stokKodu ?? '').trim();
    if (!stokKodu) return;
    if (!ALANLAR.includes(girdi.alan)) return;
    const deger = gecerliDeger(girdi.deger);
    if (deger === null) return;

    const alanHaritasi = sonuc.snapshot[girdi.alan];
    const onceki = alanHaritasi[stokKodu];

    if (!onceki) {
      alanHaritasi[stokKodu] = {
        deger,
        kaynak: baglam.kaynak,
        kaynakKayitId: baglam.kaynakKayitId,
        girenAdi: baglam.girenAdi,
        ilkKaynak: baglam.kaynak,
        ilkKayitZamani: zaman,
        guncellemeZamani: zaman,
        duzenlemeSayisi: 0,
      };
      sonuc.eklenen += 1;
      return;
    }

    if (onceki.deger === deger) {
      sonuc.degismeyen += 1;
      return;
    }

    alanHaritasi[stokKodu] = {
      ...onceki,
      deger,
      kaynak: baglam.kaynak,
      kaynakKayitId: baglam.kaynakKayitId,
      girenAdi: baglam.girenAdi,
      guncellemeZamani: zaman,
      duzenlemeSayisi: onceki.duzenlemeSayisi + 1,
    };
    sonuc.guncellenen += 1;
    sonuc.degisiklikler.push({
      stokKodu,
      alan: girdi.alan,
      eskiDeger: onceki.deger,
      yeniDeger: deger,
      eskiKaynak: onceki.kaynak,
      yeniKaynak: baglam.kaynak,
    });
  });

  if (sonuc.eklenen > 0 || sonuc.guncellenen > 0) {
    sonuc.snapshot.guncellemeZamani = zaman;
  }
  return sonuc;
}

/** Bir alanın yalın `stokKodu -> deger` haritası (okuyan paneller için). */
export function alanHaritasi(
  snapshot: LabDonemSnapshot | undefined,
  alan: OlcumAlani,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!snapshot) return out;
  Object.entries(snapshot[alan] || {}).forEach(([kod, olcum]) => {
    if (olcum && Number.isFinite(olcum.deger)) out[kod] = olcum.deger;
  });
  return out;
}

/** Kaynak kaydın aktarımda tekil kimliği. */
export function kaynakKayitAnahtari(kaynak: Kaynak, kayitId: string | undefined): string {
  return `${kaynak}:${String(kayitId ?? '').trim()}`;
}

/**
 * Geriye dönük aktarımda kullanılır: eski kayıtlar zaman sırasına dizilip
 * sırayla işlenir, böylece **en eski kayıt ilk sayım** olur ve sonrakiler
 * yalnızca farklıysa düzenleme sayılır — canlı kullanımdaki kuralla aynı.
 *
 * Aktarım tekrar çalıştırılabilir olmalıdır. Daha önce işlenmiş kaynak
 * kayıtları atlanır; aksi halde ikinci çalıştırma eski değerleri yeniden
 * oynatır ve aradaki canlı düzenlemeleri geri alır.
 */
export function kronolojikBirlestir(
  baslangic: LabDonemSnapshot,
  partiler: Array<{ girdiler: OlcumGirdisi[]; baglam: YazmaBaglami }>,
): BirlestirmeSonucu {
  const islenmis = new Set(baslangic.islenmisKaynakKayitlari ?? []);
  const sirali = [...partiler]
    .filter(p => !islenmis.has(kaynakKayitAnahtari(p.baglam.kaynak, p.baglam.kaynakKayitId)))
    .sort((a, b) => (a.baglam.zaman ?? 0) - (b.baglam.zaman ?? 0));

  let snapshot = baslangic;
  const toplam: BirlestirmeSonucu = {
    snapshot,
    eklenen: 0,
    guncellenen: 0,
    degismeyen: 0,
    degisiklikler: [],
  };
  sirali.forEach(parti => {
    const adim = birlestir(snapshot, parti.girdiler, parti.baglam);
    snapshot = adim.snapshot;
    islenmis.add(kaynakKayitAnahtari(parti.baglam.kaynak, parti.baglam.kaynakKayitId));
    toplam.eklenen += adim.eklenen;
    toplam.guncellenen += adim.guncellenen;
    toplam.degismeyen += adim.degismeyen;
    toplam.degisiklikler.push(...adim.degisiklikler);
  });

  toplam.snapshot = { ...snapshot, islenmisKaynakKayitlari: Array.from(islenmis).sort() };
  return toplam;
}

/** Snapshot'ta kaç ölçüm var (özet göstergeler için). */
export function olcumSayisi(snapshot: LabDonemSnapshot | undefined): number {
  if (!snapshot) return 0;
  return ALANLAR.reduce((sum, alan) => sum + Object.keys(snapshot[alan] || {}).length, 0);
}

/** Bir alanın panelde gösterilecek özeti. */
export interface AlanOzeti {
  /** Alanda kaç ürün için ölçüm var */
  urunSayisi: number;
  /** Ölçümlerin toplamı */
  toplam: number;
  /** İlk kaydı yapan panel(ler) */
  kaynaklar: Kaynak[];
  /** En son güncelleme (epoch ms); ölçüm yoksa 0 */
  sonGuncelleme: number;
}

/**
 * Bir alanın özetini çıkarır — "bu dönem için zaten veri var mı, nereden
 * geldi, ne zaman girildi" sorularını tek çağrıda cevaplar.
 */
export function alanOzeti(
  snapshot: LabDonemSnapshot | undefined,
  alan: OlcumAlani,
): AlanOzeti {
  const bos: AlanOzeti = { urunSayisi: 0, toplam: 0, kaynaklar: [], sonGuncelleme: 0 };
  if (!snapshot) return bos;
  const olcumler = Object.values(snapshot[alan] || {});
  if (olcumler.length === 0) return bos;
  const kaynaklar = new Set<Kaynak>();
  let toplam = 0;
  let sonGuncelleme = 0;
  olcumler.forEach(o => {
    if (!o) return;
    toplam += Number(o.deger) || 0;
    kaynaklar.add(o.ilkKaynak);
    sonGuncelleme = Math.max(sonGuncelleme, o.guncellemeZamani || 0);
  });
  return {
    urunSayisi: olcumler.length,
    toplam,
    kaynaklar: Array.from(kaynaklar),
    sonGuncelleme,
  };
}

/** Bir ölçümün nereden geldiğini tek satırda anlatır. */
export function kaynakOzeti(olcum: OlcumDegeri | undefined, adlar: Record<Kaynak, string>): string {
  if (!olcum) return 'Veri yok';
  const ilk = adlar[olcum.ilkKaynak] ?? olcum.ilkKaynak;
  if (olcum.duzenlemeSayisi === 0) return `${ilk} tarafından girildi`;
  const son = adlar[olcum.kaynak] ?? olcum.kaynak;
  return `${ilk} tarafından girildi, ${son} tarafından güncellendi (${olcum.duzenlemeSayisi} düzenleme)`;
}
