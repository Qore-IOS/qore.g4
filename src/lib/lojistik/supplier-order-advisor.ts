/**
 * Tedarikçi sipariş öneri motoru.
 *
 * Amaç: sipariş kararını yoruma bırakmamak. Motor, elde bulunan TÜM varlıkları
 * (ana depo + saha sayımı + cihaz üstü + yoldaki sipariş) ve talep sinyallerini
 * (min/max tanımı + gerçek tüketim + 6 aylık ivme) tek bir sayıya ve tek bir
 * emir cümlesine indirger. Panel yalnızca bu sonucu gösterir; karar mantığı
 * burada, saf ve test edilebilir biçimde durur.
 *
 * Tasarım ilkeleri:
 *  - Hiçbir varlık göz ardı edilmez; cihaz üstü açılmış testler de stoktur.
 *  - Veri eksikse tahmin edilmez, açıkça söylenir (güvenilirlik + uyarılar).
 *  - Her sonuç, sayıları içeren tam bir Türkçe gerekçe taşır.
 */

/** Günlük saha ihtiyacının hangi kaynaktan hesaplanacağı. */
export type DemandBasis = 'buyuk' | 'minmax' | 'tuketim';

/** 6 aylık tüketim serisinin yönü ve ivmesi. */
export type IvmeDurumu =
  | 'hizlanan-artis'
  | 'artis'
  | 'yatay'
  | 'azalis'
  | 'hizlanan-azalis'
  | 'belirsiz';

/** Satır için verilen nihai emir. */
export type OneriTipi = 'acil-siparis' | 'siparis' | 'yeterli' | 'fazla-stok' | 'veri-yok';

export type Guvenilirlik = 'yuksek' | 'orta' | 'dusuk';

/** Trend uygulanabilmesi için 6 ayın en az bu kadarında veri olmalı. */
export const MIN_TREND_VERI_AYI = 4;
/** Bu bandın içindeki değişim "yatay" sayılır (%). */
export const YATAY_ESIK = 8;
/** Trend etkisi bu yüzdede kırpılır; tek bir sıra dışı ay talebi uçurmasın. */
export const TREND_TAVANI = 60;
/** Trendin talebe yansıma oranı (ivmelenen seride daha yüksek). */
export const TREND_SONUM = 0.5;
export const TREND_SONUM_IVMELI = 0.75;
/** Tedarik süresi bilinmiyorsa kritik kabul edilen kapsama günü. */
export const VARSAYILAN_KRITIK_GUN = 15;
/** Hedefin bu katından fazla kapsama "fazla stok" uyarısı üretir. */
export const FAZLA_STOK_KATI = 2;

export interface AylikTuketim {
  /** "MM-YYYY" biçiminde dönem etiketi */
  donem: string;
  /** O dönemde tüketilen kutu; veri girilmemişse null */
  kutu: number | null;
}

export interface TuketimTrendi {
  /** Eskiden yeniye 6 dönem */
  aylar: AylikTuketim[];
  /** Verisi olan dönem sayısı */
  veriAyiSayisi: number;
  /** Son 3 dönemin ortalaması (seçili dönem dahil) */
  son3Ort: number | null;
  /** Ondan önceki 3 dönemin ortalaması */
  onceki3Ort: number | null;
  /** son3 ile onceki3 arasındaki değişim (%) */
  trendYuzde: number | null;
  /** Son ayın, son 3 ay ortalamasından sapması (%) — ivme göstergesi */
  sonAySapmaYuzde: number | null;
  ivme: IvmeDurumu;
  /** Talep tahminine uygulanacak çarpan (1 = etkisiz) */
  katsayi: number;
}

export interface OneriGirdisi {
  /** Min/Max tanımından türeyen günlük kutu ihtiyacı */
  gunlukMinMax: number;
  /** Gerçek tüketimden türeyen günlük kutu ihtiyacı */
  gunlukTuketim: number;
  basis: DemandBasis;
  trend: TuketimTrendi;
  /** Depoda kaç günlük ihtiyaç tutulmak isteniyor */
  hedefGun: number;
  anaDepoStok: number;
  /** Dönem sayımlarından gelen saha stoğu (kutu) */
  sahaStok: number;
  /** Sahadaki cihazlarda açık duran testlerin kutu karşılığı */
  cihazUstuKutu: number;
  /** Bekleyen tedarikçi siparişlerinde yoldaki adet */
  acikSiparis: number;
  /** Markanın teslim süresi (gün); bilinmiyorsa 0 */
  tedarikGun?: number;
  /** Dönem sayımı yapmamış laboratuvar sayısı */
  sayimEksikLab?: number;
  /** Kapsamdaki toplam laboratuvar sayısı */
  toplamLab?: number;
}

export interface OneriSonucu {
  /** Trend uygulanmadan önceki günlük ihtiyaç */
  tabanGunluk: number;
  /** Trend uygulandıktan sonraki günlük ihtiyaç */
  gunlukIhtiyac: number;
  /** Ana depo + saha + cihaz üstü + yoldaki */
  toplamVarlik: number;
  /** Eldeki varlıkla kaç gün idare edilir (talep yoksa null) */
  kapsamaGun: number | null;
  /** Hedef gün için gereken toplam adet */
  gerekliAdet: number;
  /** Nihai öneri (0 = sipariş verme) */
  oneriAdet: number;
  /** Trend uygulanmasaydı çıkacak öneri */
  tabanOneriAdet: number;
  /** Trendin öneriye etkisi (+ artırdı, − azalttı) */
  trendEtkisi: number;
  tip: OneriTipi;
  /** Kısa emir: "SİPARİŞ VER" gibi */
  baslik: string;
  /** Sayıları içeren tam gerekçe */
  aciklama: string;
  guvenilirlik: Guvenilirlik;
  uyarilar: string[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const trNum = (value: number, digits = 1) =>
  value.toLocaleString('tr-TR', { maximumFractionDigits: digits });

function ortalama(values: Array<number | null>): number | null {
  const gecerli = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (gecerli.length === 0) return null;
  return gecerli.reduce((sum, v) => sum + v, 0) / gecerli.length;
}

function yuzdeDegisim(yeni: number, eski: number): number | null {
  if (!Number.isFinite(eski) || eski <= 0) return null;
  return ((yeni - eski) / eski) * 100;
}

/**
 * 6 aylık tüketim serisinden yön, ivme ve talep çarpanını üretir.
 *
 * Seri eskiden yeniye verilir; son 3 ay ile ondan önceki 3 ay karşılaştırılır.
 * Son ayın kendi 3 aylık ortalamasından da aynı yönde sapması "ivmelenme"
 * sayılır ve trendin talebe yansıması artar. Veri yetersizse çarpan 1 kalır —
 * yani eksik veriyle asla tahmin yürütülmez.
 */
export function hesaplaTuketimTrendi(aylar: AylikTuketim[]): TuketimTrendi {
  const seri = aylar.slice(-6);
  const veriAyiSayisi = seri.filter(a => typeof a.kutu === 'number').length;

  const son3 = seri.slice(-3).map(a => a.kutu);
  const onceki3 = seri.slice(-6, -3).map(a => a.kutu);
  const son3Ort = ortalama(son3);
  const onceki3Ort = ortalama(onceki3);
  const sonAy = seri.length > 0 ? seri[seri.length - 1].kutu : null;

  const trendYuzde =
    son3Ort !== null && onceki3Ort !== null ? yuzdeDegisim(son3Ort, onceki3Ort) : null;
  const sonAySapmaYuzde =
    sonAy !== null && son3Ort !== null ? yuzdeDegisim(sonAy, son3Ort) : null;

  let ivme: IvmeDurumu = 'belirsiz';
  let katsayi = 1;

  if (veriAyiSayisi >= MIN_TREND_VERI_AYI && trendYuzde !== null) {
    const artis = trendYuzde > YATAY_ESIK;
    const azalis = trendYuzde < -YATAY_ESIK;
    // Son ay da aynı yönde sapıyorsa hareket hızlanıyor demektir.
    const ivmeli =
      sonAySapmaYuzde !== null &&
      ((artis && sonAySapmaYuzde > YATAY_ESIK) || (azalis && sonAySapmaYuzde < -YATAY_ESIK));

    if (artis) ivme = ivmeli ? 'hizlanan-artis' : 'artis';
    else if (azalis) ivme = ivmeli ? 'hizlanan-azalis' : 'azalis';
    else ivme = 'yatay';

    if (ivme !== 'yatay') {
      const kirpilmis = Math.max(-TREND_TAVANI, Math.min(TREND_TAVANI, trendYuzde));
      const sonum = ivmeli ? TREND_SONUM_IVMELI : TREND_SONUM;
      katsayi = 1 + (kirpilmis / 100) * sonum;
    }
  }

  return {
    aylar: seri,
    veriAyiSayisi,
    son3Ort,
    onceki3Ort,
    trendYuzde,
    sonAySapmaYuzde,
    ivme,
    katsayi,
  };
}

const IVME_METNI: Record<IvmeDurumu, string> = {
  'hizlanan-artis': 'hızlanarak artıyor',
  artis: 'artıyor',
  yatay: 'yatay seyrediyor',
  azalis: 'azalıyor',
  'hizlanan-azalis': 'hızlanarak azalıyor',
  belirsiz: 'belirsiz',
};

/**
 * Tüm sinyalleri tek bir emre indirger.
 *
 * Sıra önemlidir: önce talep (trendle düzeltilmiş), sonra eldeki tüm varlıklar,
 * sonra kapsama günü, en sonunda emir. Eksik veri emri bastırmaz ama
 * güvenilirliği düşürür ve gerekçede açıkça belirtilir.
 */
export function hesaplaOneri(girdi: OneriGirdisi): OneriSonucu {
  const {
    gunlukMinMax,
    gunlukTuketim,
    basis,
    trend,
    hedefGun,
    anaDepoStok,
    sahaStok,
    cihazUstuKutu,
    acikSiparis,
    tedarikGun = 0,
    sayimEksikLab = 0,
    toplamLab = 0,
  } = girdi;

  const tabanGunluk =
    basis === 'minmax' ? gunlukMinMax
    : basis === 'tuketim' ? gunlukTuketim
    : Math.max(gunlukMinMax, gunlukTuketim);

  const gunlukIhtiyac = tabanGunluk * trend.katsayi;
  const toplamVarlik = anaDepoStok + sahaStok + cihazUstuKutu + acikSiparis;

  const uyarilar: string[] = [];
  if (sayimEksikLab > 0) {
    uyarilar.push(
      `${sayimEksikLab}/${toplamLab} laboratuvarın dönem sayımı yok; saha stoğu olduğundan düşük görünüyor.`,
    );
  }
  if (trend.veriAyiSayisi < MIN_TREND_VERI_AYI) {
    uyarilar.push(
      `Son 6 ayın yalnızca ${trend.veriAyiSayisi} ayında tüketim verisi var; trend uygulanmadı.`,
    );
  }
  if (gunlukTuketim <= 0 && gunlukMinMax > 0) {
    uyarilar.push('Bu dönem için tüketim verisi yok; hesap yalnızca Min/Max tanımına dayanıyor.');
  }
  if (gunlukMinMax <= 0 && gunlukTuketim > 0) {
    uyarilar.push('Kurumlarda min/max tanımı yok; hesap yalnızca gerçek tüketime dayanıyor.');
  }

  const guvenilirlik: Guvenilirlik =
    uyarilar.length === 0 ? 'yuksek' : uyarilar.length === 1 ? 'orta' : 'dusuk';

  const varlikDetayi =
    `depo ${anaDepoStok} + saha ${sahaStok} + cihaz üstü ${cihazUstuKutu} + yolda ${acikSiparis}`;

  // Talep sinyali yoksa sipariş kararı üretmek yerine veri istenir.
  if (!(gunlukIhtiyac > 0)) {
    return {
      tabanGunluk,
      gunlukIhtiyac: 0,
      toplamVarlik,
      kapsamaGun: null,
      gerekliAdet: 0,
      oneriAdet: 0,
      tabanOneriAdet: 0,
      trendEtkisi: 0,
      tip: 'veri-yok',
      baslik: 'VERİ GİRİLMELİ',
      aciklama:
        `Bu ürün için talep sinyali yok: ne min/max tanımı ne de tüketim verisi var. ` +
        `Elde ${toplamVarlik} kutu duruyor (${varlikDetayi}). ` +
        `Kurumlara min/max tanımlayın veya dönem kümülatifini girin.`,
      guvenilirlik: 'dusuk',
      uyarilar,
    };
  }

  const kapsamaGun = toplamVarlik / gunlukIhtiyac;
  const gerekliAdet = Math.ceil(gunlukIhtiyac * hedefGun);
  const oneriAdet = Math.max(0, gerekliAdet - toplamVarlik);
  const tabanGerekli = Math.ceil(tabanGunluk * hedefGun);
  const tabanOneriAdet = Math.max(0, tabanGerekli - toplamVarlik);
  const trendEtkisi = oneriAdet - tabanOneriAdet;

  const kritikGun = tedarikGun > 0 ? tedarikGun + 7 : VARSAYILAN_KRITIK_GUN;

  const trendCumlesi =
    trend.ivme === 'belirsiz' || trend.ivme === 'yatay' || trend.trendYuzde === null
      ? trend.ivme === 'yatay'
        ? 'Tüketim son 6 ayda yatay seyrediyor; talep olduğu gibi alındı.'
        : ''
      : `Tüketim ${IVME_METNI[trend.ivme]} (son 3 ay, önceki 3 aya göre %${trNum(
          trend.trendYuzde,
          0,
        )}); günlük ihtiyaç ${trend.katsayi >= 1 ? 'yukarı' : 'aşağı'} çekilerek ` +
        `${trNum(tabanGunluk)} → ${trNum(gunlukIhtiyac)} kutu/gün oldu.`;

  const temelCumle =
    `Günlük ihtiyaç ${trNum(gunlukIhtiyac)} kutu. Elde ${toplamVarlik} kutu var ` +
    `(${varlikDetayi}) → ${trNum(kapsamaGun, 0)} gün yeter.`;

  let tip: OneriTipi;
  let baslik: string;
  let aciklama: string;

  if (oneriAdet > 0 && kapsamaGun < kritikGun) {
    tip = 'acil-siparis';
    baslik = 'ACİL SİPARİŞ VER';
    aciklama =
      `${temelCumle} Bu, kritik eşiğin (${kritikGun} gün) altında. ` +
      `${hedefGun} günlük hedef için ${gerekliAdet} kutu gerekiyor, ${oneriAdet} kutu sipariş edin. ` +
      trendCumlesi;
  } else if (oneriAdet > 0) {
    tip = 'siparis';
    baslik = 'SİPARİŞ VER';
    aciklama =
      `${temelCumle} ${hedefGun} günlük hedef için ${gerekliAdet} kutu gerekiyor, ` +
      `${oneriAdet} kutu sipariş edin. ` + trendCumlesi;
  } else if (kapsamaGun > hedefGun * FAZLA_STOK_KATI) {
    tip = 'fazla-stok';
    baslik = 'SİPARİŞ VERME — FAZLA STOK';
    aciklama =
      `${temelCumle} Bu, ${hedefGun} günlük hedefin ${trNum(kapsamaGun / hedefGun, 1)} katı. ` +
      `Sipariş vermeyin; miad riskine karşı sahaya sevk veya kurumlar arası aktarım değerlendirin. ` +
      trendCumlesi;
  } else {
    tip = 'yeterli';
    baslik = 'SİPARİŞ VERME';
    aciklama =
      `${temelCumle} ${hedefGun} günlük hedef karşılanıyor, sipariş gerekmiyor. ` + trendCumlesi;
  }

  return {
    tabanGunluk,
    gunlukIhtiyac,
    toplamVarlik,
    kapsamaGun: round1(kapsamaGun),
    gerekliAdet,
    oneriAdet,
    tabanOneriAdet,
    trendEtkisi,
    tip,
    baslik,
    aciklama: aciklama.trim().replace(/\s+/g, ' '),
    guvenilirlik,
    uyarilar,
  };
}
