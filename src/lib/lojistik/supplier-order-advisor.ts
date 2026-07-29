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

/**
 * Günlük saha ihtiyacının hangi kaynaktan hesaplanacağı.
 * - `minmax`  : kurumların min/max tanımlarından
 * - `tuketim` : Total Verimlilik kümülatif tüketiminden
 * - `cikis`   : ana depodan kesilen irsaliyelerdeki fiili çıkıştan
 * - `buyuk`   : üçünün en büyüğü (stoksuz kalmaya karşı güvenli taraf)
 */
export type DemandBasis = 'buyuk' | 'minmax' | 'tuketim' | 'cikis';

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

/** Saha ihtiyacının tutulduğu referans periyot (gün). */
export const AYLIK_GUN = 30;

/**
 * Bir kurumun min/max tanımını **aylık kutu** ihtiyacına çevirir.
 *
 * Lojistik tarafı saha ihtiyacını günlük değil aylık tutuyor: her kurumun
 * 30 günlük max'ı tam kutuya yuvarlanıp toplanıyor, sipariş bu toplamın
 * hedef gün karşılığından hesaplanıyor. Yuvarlama **yukarı** yapılır — yarım
 * kutu sipariş edilemez ve eksik kalmaktansa fazla gitmesi tercih edilir.
 *
 * Yuvarlamanın kurum bazında yapılması önemli: toplamı yuvarlamak, 15 kurumun
 * her birindeki küsuratı tek bir kutuya sıkıştırır ve sahanın gerçek
 * ihtiyacının altında kalır.
 *
 * `maxGun` tanımsızsa (0) çağıran varsayılanı geçmelidir; burada 0'a bölme
 * yapılmaz.
 */
export function aylikMaxKutu(max: number, maxGun: number): number {
  const m = Number(max);
  const g = Number(maxGun);
  if (!Number.isFinite(m) || m <= 0) return 0;
  if (!Number.isFinite(g) || g <= 0) return 0;
  return Math.ceil((m * AYLIK_GUN) / g);
}

/**
 * Aylık kutu ihtiyacını motorun beklediği günlük orana çevirir.
 *
 * Motor günlük çalışır (kapsama günü, hedef gün çarpımı); saha ihtiyacı ise
 * aylık tutulur. Dönüşüm tek yerde dursun diye ayrıldı.
 */
export function aylikKutudanGunluk(aylikKutu: number): number {
  const a = Number(aylikKutu);
  if (!Number.isFinite(a) || a <= 0) return 0;
  return a / AYLIK_GUN;
}

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
  /** Ana depodan fiili çıkıştan (irsaliye) türeyen günlük kutu ihtiyacı */
  gunlukCikis?: number;
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
  /**
   * Kurumun tanımlı max adedi (kutu). Verilirse öneri, sevk sonrası eldeki
   * toplam varlık bu tavanı aşmayacak şekilde kırpılır. Hastane sevkiyatında
   * zorunlu; tedarikçi siparişinde tavan yoktur (0/undefined geçilir).
   */
  kurumMax?: number;
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
  /** Kurum max tavanı uygulanmadan önceki öneri */
  tavansizOneriAdet: number;
  /** Max tavanı yüzünden öneriden düşülen adet (0 = tavan devrede değil) */
  maxKirpma: number;
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
    gunlukCikis = 0,
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
    kurumMax = 0,
  } = girdi;

  const tabanGunluk =
    basis === 'minmax' ? gunlukMinMax
    : basis === 'tuketim' ? gunlukTuketim
    : basis === 'cikis' ? gunlukCikis
    : Math.max(gunlukMinMax, gunlukTuketim, gunlukCikis);

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
  if (gunlukCikis <= 0) {
    uyarilar.push('Son 3 ayda bu depodan çıkış (irsaliye) verisi bulunamadı.');
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
      tavansizOneriAdet: 0,
      maxKirpma: 0,
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
  const tavansizOneriAdet = Math.max(0, gerekliAdet - toplamVarlik);

  // Kurum max tavanı: hedef gün max/maxGün periyodundan uzun olduğunda ihtiyaç
  // kurumun taşıyabileceğini aşar. Tavan, sevk sonrası eldeki toplam varlığa
  // uygulanır — eldeki zaten max'ı aşıyorsa tavan boşluğu 0'dır.
  const tavanBoslugu = kurumMax > 0 ? Math.max(0, Math.floor(kurumMax - toplamVarlik)) : Infinity;
  const oneriAdet = Math.min(tavansizOneriAdet, tavanBoslugu);
  const maxKirpma = tavansizOneriAdet - oneriAdet;

  const tabanGerekli = Math.ceil(tabanGunluk * hedefGun);
  const tabanOneriAdet = Math.min(Math.max(0, tabanGerekli - toplamVarlik), tavanBoslugu);
  const trendEtkisi = oneriAdet - tabanOneriAdet;

  if (maxKirpma > 0) {
    uyarilar.push(
      `${hedefGun} günlük hedef ${tavansizOneriAdet} kutu gerektiriyordu; kurumun tanımlı max'ı ` +
        `(${kurumMax} kutu) aşılmasın diye ${oneriAdet} kutuya çekildi.`,
    );
  }

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

  // Hangi sinyalin talebi belirlediğini yaz — okuyan "bu sayı nereden geldi"
  // diye sormasın.
  const kaynakCumlesi =
    basis !== 'buyuk'
      ? ''
      : gunlukCikis > 0 && gunlukCikis >= gunlukMinMax && gunlukCikis >= gunlukTuketim
        ? `Talebi depo çıkışı belirledi (ayda ort. ${trNum(gunlukCikis * 30, 0)} kutu).`
        : gunlukTuketim >= gunlukMinMax
          ? 'Talebi gerçek tüketim belirledi.'
          : 'Talebi Min/Max tanımı belirledi.';

  const temelCumle =
    `Günlük ihtiyaç ${trNum(gunlukIhtiyac)} kutu. Elde ${toplamVarlik} kutu var ` +
    `(${varlikDetayi}) → ${trNum(kapsamaGun, 0)} gün yeter.`;

  // Tavan devredeyse gerekçe bunu açıkça söyler — okuyan, sayının neden
  // hedeften düşük olduğunu tabloyu terk etmeden görsün.
  const tavanCumlesi =
    maxKirpma > 0
      ? `Kurumun tanımlı max'ı ${kurumMax} kutu; ${tavansizOneriAdet} kutu bu tavanı aşacağı için ` +
        `${maxKirpma} kutu düşüldü.`
      : '';

  let tip: OneriTipi;
  let baslik: string;
  let aciklama: string;

  if (oneriAdet > 0 && kapsamaGun < kritikGun) {
    tip = 'acil-siparis';
    baslik = 'ACİL SİPARİŞ VER';
    aciklama =
      `${temelCumle} Bu, kritik eşiğin (${kritikGun} gün) altında. ` +
      `${hedefGun} günlük hedef için ${gerekliAdet} kutu gerekiyor, ${oneriAdet} kutu sipariş edin. ` +
      `${tavanCumlesi} ${kaynakCumlesi} ` + trendCumlesi;
  } else if (oneriAdet > 0) {
    tip = 'siparis';
    baslik = 'SİPARİŞ VER';
    aciklama =
      `${temelCumle} ${hedefGun} günlük hedef için ${gerekliAdet} kutu gerekiyor, ` +
      `${oneriAdet} kutu sipariş edin. ` + `${tavanCumlesi} ${kaynakCumlesi} ` + trendCumlesi;
  } else if (maxKirpma > 0) {
    // Hedef daha fazlasını isterdi ama kurum tavanı doludur; bu "yeterli"den
    // farklı bir durumdur ve fazla stok da sayılmaz.
    tip = 'yeterli';
    baslik = 'SEVK ETME — MAX DOLU';
    aciklama =
      `${temelCumle} ${hedefGun} günlük hedef ${gerekliAdet} kutu isterdi ama kurumun tanımlı max'ı ` +
      `${kurumMax} kutu ve elde zaten ${toplamVarlik} kutu var; tavan aşılmasın diye sevk yapılmıyor. ` +
      trendCumlesi;
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
    tavansizOneriAdet,
    maxKirpma,
    tabanOneriAdet,
    trendEtkisi,
    tip,
    baslik,
    aciklama: aciklama.trim().replace(/\s+/g, ' '),
    guvenilirlik,
    uyarilar,
  };
}

/* ——— Hastane sevkiyatı: sınırlı depo stoğunun dağıtımı ——— */

export interface SevkAdayi {
  /** Satırı geri eşlemek için serbest kimlik (ör. labId) */
  id: string;
  /** Bu kurumun ihtiyacı (kutu) */
  ihtiyac: number;
  /**
   * Kurumun eldekiyle kaç gün idare edebileceği. Küçük olan daha aciildir;
   * null "talep sinyali yok" demektir ve en sona düşer.
   */
  kapsamaGun: number | null;
}

export interface SevkPayi {
  id: string;
  ihtiyac: number;
  /** Depoda olan kadarıyla sevk edilebilecek adet */
  sevkAdedi: number;
  /** Depo stoğu yetmediği için karşılanamayan adet */
  karsilanamayan: number;
  /**
   * Aciliyet sırasındaki 0 tabanlı konum. Lotlar depodan bu sırayla ayrıldığı
   * için miad riski hesabında da aynı sıra kullanılır.
   */
  sira: number;
}

export interface DagitimSonucu {
  paylar: SevkPayi[];
  /** Dağıtım sonrası depoda kalan */
  kalanStok: number;
  /** Toplam karşılanamayan adet */
  toplamKarsilanamayan: number;
}

/**
 * Bir ürünün sınırlı ana depo stoğunu hastanelere dağıtır.
 *
 * Öncelik **aciliyettir**: kapsama günü en düşük olan kurum önce TAM karşılanır.
 * Orantılı bölüştürme yerine bu seçildi; stok kıtken herkesi eksik bırakmak,
 * tükenmek üzere olan labı da tükenmeyecek olanı da riske atar. Böylece stok
 * biteceği ana en yakın kurumlar korunur.
 *
 * Eşit aciliyette büyük ihtiyaç önce gelir (deterministik olsun diye id ile
 * sabitlenir), böylece aynı girdi her zaman aynı dağıtımı üretir.
 */
export function dagitimYap(adaylar: SevkAdayi[], depoStogu: number): DagitimSonucu {
  const sirali = [...adaylar].sort((a, b) => {
    const ak = a.kapsamaGun ?? Number.POSITIVE_INFINITY;
    const bk = b.kapsamaGun ?? Number.POSITIVE_INFINITY;
    if (ak !== bk) return ak - bk;
    if (b.ihtiyac !== a.ihtiyac) return b.ihtiyac - a.ihtiyac;
    return a.id.localeCompare(b.id);
  });

  let kalan = Math.max(0, Math.floor(depoStogu));
  const payById = new Map<string, SevkPayi>();
  sirali.forEach((aday, sira) => {
    const ihtiyac = Math.max(0, Math.ceil(aday.ihtiyac));
    const sevkAdedi = Math.min(ihtiyac, kalan);
    kalan -= sevkAdedi;
    payById.set(aday.id, {
      id: aday.id,
      ihtiyac,
      sevkAdedi,
      karsilanamayan: ihtiyac - sevkAdedi,
      sira,
    });
  });

  // Çağıranın verdiği sırayı koru — tablo sıralaması dağıtımdan bağımsız olsun.
  const paylar = adaylar.map(
    (a, i) =>
      payById.get(a.id) ?? { id: a.id, ihtiyac: 0, sevkAdedi: 0, karsilanamayan: 0, sira: i },
  );
  return {
    paylar,
    kalanStok: kalan,
    toplamKarsilanamayan: paylar.reduce((sum, p) => sum + p.karsilanamayan, 0),
  };
}

/* ——— Sevk edilen lotların miad riski ——— */

export interface SevkLotu {
  lot: string;
  /** Miada kalan gün; miad bilinmiyorsa null */
  miatGun: number | null;
  adet: number;
}

export interface RiskliLotDetayi {
  lot: string;
  miatGun: number;
  adet: number;
  /** Bu lottan miadı dolmadan tüketilemeyecek adet */
  riskliAdet: number;
}

export interface RiskliSevkSonucu {
  /** Miadı dolmadan tüketilemeyecek toplam kutu */
  riskliAdet: number;
  /** Riske giren lotların kırılımı (yalnızca riskliAdet > 0 olanlar) */
  detay: RiskliLotDetayi[];
  /** Miad ya da talep bilgisi olmadığı için değerlendirilemeyen kutu */
  degerlendirilemeyenAdet: number;
  /** Sevk edilen lotlar içindeki en yakın miad (gün); yoksa null */
  enYakinMiatGun: number | null;
}

/**
 * Sevk edilecek lotların kurumda miadı dolmadan tüketilip tüketilemeyeceğini
 * hesaplar.
 *
 * Stok Yönetimi panelindeki riskli stok mantığının lot sıralı halidir: orada
 * tek bir satır için `riskli = (kapsamaGün − miatGün) × günlükİhtiyaç` yazılır,
 * yani "stok, miad gelene kadar tüketilebilecek miktarı aşıyorsa fazlası
 * risklidir". Burada aynı kural, kurumda **önce tüketilecek** miktar hesaba
 * katılarak uygulanır:
 *
 *  - Lotlar miadı yakın olandan uzağa sıralanır (FEFO — kurum da böyle tüketir).
 *  - Bir lot, kendinden önce tüketilecek stok bittiğinde açılır:
 *      `başlangıçGün = öncekiToplam / günlükİhtiyaç`
 *  - Miada kalan sürede tüketilebilecek miktar `(miatGün − başlangıçGün) × günlükİhtiyaç`;
 *    lotun bunu aşan kısmı risklidir.
 *
 * Tek lot ve sıfır mevcut stokta formül panelin formülüne indirgenir; fark,
 * panelin `kapsamaGün`'ü aşağı yuvarlamasından gelen ≤1 günlük sapmadır —
 * burada yuvarlama yapılmaz, yani risk asla olduğundan az gösterilmez.
 *
 * Miadı bilinmeyen lotlar riske sayılmaz ama sıranın sonuna konur (öndeki
 * lotların riskini şişirmesinler) ve `degerlendirilemeyenAdet` ile raporlanır.
 */
export function hesaplaRiskliSevk(girdi: {
  lotlar: SevkLotu[];
  gunlukIhtiyac: number;
  /** Sevkten önce kurumda bulunan ve önce tüketilecek stok (kutu) */
  mevcutStok: number;
}): RiskliSevkSonucu {
  const { lotlar, gunlukIhtiyac, mevcutStok } = girdi;

  const gecerli = lotlar.filter(l => l.adet > 0);
  const miatli = gecerli.filter(
    (l): l is SevkLotu & { miatGun: number } =>
      typeof l.miatGun === 'number' && Number.isFinite(l.miatGun),
  );
  const miatsizAdet = gecerli
    .filter(l => typeof l.miatGun !== 'number' || !Number.isFinite(l.miatGun))
    .reduce((sum, l) => sum + l.adet, 0);

  const enYakinMiatGun = miatli.length
    ? miatli.reduce((min, l) => Math.min(min, l.miatGun), Number.POSITIVE_INFINITY)
    : null;

  // Talep sinyali yoksa "ne kadar sürede tüketilir" sorusunun cevabı yok;
  // tahmin üretmek yerine değerlendirilemedi denir.
  if (!(gunlukIhtiyac > 0)) {
    return {
      riskliAdet: 0,
      detay: [],
      degerlendirilemeyenAdet: gecerli.reduce((sum, l) => sum + l.adet, 0),
      enYakinMiatGun,
    };
  }

  const sirali = [...miatli].sort((a, b) => a.miatGun - b.miatGun || a.lot.localeCompare(b.lot));

  let oncekiToplam = Math.max(0, mevcutStok);
  let riskliAdet = 0;
  const detay: RiskliLotDetayi[] = [];

  sirali.forEach(lot => {
    let riskli: number;
    if (lot.miatGun <= 0) {
      // Miadı geçmiş ya da bugün dolan lot: tamamı risklidir.
      riskli = lot.adet;
    } else {
      const baslangicGun = oncekiToplam / gunlukIhtiyac;
      const kalanGun = Math.max(0, lot.miatGun - baslangicGun);
      const tuketilebilir = kalanGun * gunlukIhtiyac;
      riskli = Math.min(lot.adet, Math.max(0, Math.ceil(lot.adet - tuketilebilir)));
    }
    if (riskli > 0) {
      detay.push({ lot: lot.lot, miatGun: lot.miatGun, adet: lot.adet, riskliAdet: riskli });
      riskliAdet += riskli;
    }
    oncekiToplam += lot.adet;
  });

  return { riskliAdet, detay, degerlendirilemeyenAdet: miatsizAdet, enYakinMiatGun };
}
