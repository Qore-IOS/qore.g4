/**
 * Teknik / Aplikasyon formundan Ceomed "Çıkış İrsaliyesi" giriş işi üretir.
 *
 * AKIŞ: Bir teknik servis ya da aplikasyon formu kapatıldığında ve içinde yedek
 * parça kullanılmışsa, Ceomed masaüstü uygulamasındaki muhasebe irsaliyesi
 * ELLE değil OTOMATİK doldurulur. Qore bulutta çalıştığı, Ceomed masaüstü
 * uygulaması ise yalnızca VPN/şirket ağından erişilebildiği için doğrudan
 * yazamayız: bu modül işin *tarifini* üretir, ağdaki on-prem worker
 * (`scripts/ceomed-sync/oracleIrsaliyeWorker.js`) o tarifi tüketip uygulamaya
 * yazar.
 *
 * TASARIM KARARI — belirsizlik asla tahminle kapatılmaz. Cari kodu tanımsızsa,
 * stok kodu boşsa ya da personel adı yoksa iş `blocked` damgalanır ve bekler.
 * Muhasebeye yanlış irsaliye düşmesi, elle girmekten kat kat pahalıdır: kayıt
 * e-irsaliye olarak gönderildikten sonra geri alınamaz.
 *
 * Saf fonksiyon: Firebase SDK'sına dokunmaz, doğrudan test edilebilir
 * (`tests/ceomed/irsaliyeGiris.test.ts`).
 */

/** Ceomed formundaki "İşlem Tipi" — yedek parça çıkışı için her zaman 35. */
export const CEOMED_ISLEM_TIPI = '35';

/** Ceomed formundaki "Depo" — yedek parça çıkışı için her zaman 10. */
export const CEOMED_DEPO = '10';

/** Kuyruk koleksiyonu. Worker bu koleksiyonu dinler. */
export const IRSALIYE_GIRIS_COLLECTION = 'ceomedIrsaliyeGirisJobs';

export type IrsaliyeGirisStatus =
  | 'pending'     // kuyrukta, worker henüz almadı
  | 'processing'  // worker uygulamaya yazıyor
  | 'sent'        // e-irsaliye gönderildi
  | 'failed'      // yazma denendi, hata aldı (yeniden denenebilir)
  | 'blocked';    // eksik/çelişkili veri — elle müdahale gerekir, DENENMEZ

/** Lot alanının hangi bilgiden doldurulduğu — denetim izi için saklanır. */
export type LotKaynagi = 'seri_no' | 'lot' | 'yok';

export type IrsaliyeGirisSatiri = {
  /** Formdaki action id'si — mükerrer satır ayıklaması ve iz sürme için. */
  actionId: string;
  stokKodu: string;
  stokAdi: string;
  miktar: number;
  /**
   * Ceomed formundaki LOT sütununa yazılacak değer.
   * Kural: seri no varsa seri no, yoksa lot, ikisi de yoksa boş.
   */
  lot: string;
  lotKaynagi: LotKaynagi;
  /** Miad — Qore yedek parça stoğunda tutulmuyorsa boş geçilir. */
  miad: string;
};

export type IrsaliyeGirisJob = {
  /** Ceomed "İrsaliye No" alanı — Qore form numarası. */
  irsaliyeNo: string;
  /** Ceomed "Cari Kodu" alanı — laboratuvarın ceomedCariKodu değeri. */
  cariKodu: string;
  /** İşlem tarihi, ISO (YYYY-MM-DD). Uygulama maskesine worker çevirir. */
  tarih: string;
  islemTipi: typeof CEOMED_ISLEM_TIPI;
  depo: typeof CEOMED_DEPO;
  /** Sol alttaki "Açıklama" alanı — işlemi yapan personelin adı soyadı. */
  aciklama: string;
  satirlar: IrsaliyeGirisSatiri[];
};

/** Kuyruk dokümanının tamamı (iş + izlenebilirlik + durum alanları). */
export type IrsaliyeGirisDoc = IrsaliyeGirisJob & {
  status: IrsaliyeGirisStatus;
  /** `blocked` ise makine-okunur gerekçe, değilse null. */
  blockedReason: BlockReason | null;
  /** `blocked` ise kullanıcıya gösterilecek Türkçe açıklama. */
  blockedDetail: string | null;
  formId: string;
  formNo: string;
  formType: 'teknik_servis' | 'aplikasyon';
  hospitalId: string;
  labName: string | null;
  deviceId: string | null;
  cihazAdi: string | null;
  seriNumarasi: string | null;
  personnelUid: string | null;
  personnelName: string;
  companyId: string | null;
  attemptCount: number;
  lastError: string | null;
};

export type BlockReason =
  | 'cari_kodu_tanimsiz'
  | 'stok_kodu_eksik'
  | 'personel_adi_yok'
  | 'form_no_yok'
  | 'form_no_ceomed_formatina_uymuyor'
  | 'tarih_gecersiz';

/**
 * Ceomed "İrsaliye No" alanının kabul ettiği biçim — ÖLÇÜLMÜŞTÜR, tahmin değil.
 *
 * Uygulama hatalı değerde şu uyarıyı veriyor:
 *   "İrsaliye numarasının ilk 2 karakterinden sonrası, sadece rakam olmalıdır"
 *
 * Alan ayrıca 8 karakterde SESSİZCE kesiyor: 'AB12345678901234567890' yazıldığında
 * alanda 'AB123456' kalıyor, hiçbir uyarı çıkmıyor. Bu yüzden sığmayan bir numarayı
 * göndermeye çalışmak, muhasebeye YANLIŞ numara yazmak demektir — kesilmesine izin
 * vermek yerine iş `blocked` damgalanır.
 */
const CEOMED_IRSALIYE_NO_DESENI = /^[A-Z]{2}\d{1,6}$/;

/** Qore form numarası: `${personelKodu}-${T|A}${sıra}` (src/lib/form-number.ts). */
const QORE_FORM_NO_DESENI = /^([A-Za-z]+)-([TA])(\d+)$/;

/**
 * Form tipi harfi rakama çevrilir. Ceomed ilk 2 karakterden sonrasının yalnızca
 * rakam olmasını istediği için `T`/`A` olduğu gibi bırakılamaz: `BT-T0042` →
 * `BTT0042` uygulamada reddedilir.
 */
const FORM_TIPI_RAKAMI: Record<string, string> = { T: '1', A: '2' };

/**
 * Qore form numarasını Ceomed İrsaliye No biçimine çevirir; çevrilemiyorsa null.
 *
 * `BT-T0042` → `BT10042`
 *
 * Personel kodu 2 harften kısaysa (tek isimli personel: "Batuhan" → `B`) `X` ile
 * tamamlanır. Bu deterministiktir ama teorik bir çakışma kaynağıdır — numara
 * tekilliği zaten açık bir ürün kararıdır (sayaç kullanıcı bazlı olduğu için aynı
 * baş harfli iki personel aynı numarayı üretebiliyor), ayrıntı ORACLE-IRSALIYE.md.
 */
export function ceomedIrsaliyeNo(formNo: string): string | null {
  const eslesme = QORE_FORM_NO_DESENI.exec(String(formNo || '').trim());
  if (!eslesme) return null;

  const [, personelKodu, formTipi, sira] = eslesme;
  const rakam = FORM_TIPI_RAKAMI[formTipi];
  if (!rakam) return null;

  const onEk = personelKodu.toLocaleUpperCase('en-US').slice(0, 2).padEnd(2, 'X');
  const aday = `${onEk}${rakam}${sira}`;

  // Sığmıyorsa kesmek yerine reddet: sessiz kesilme muhasebeye yanlış numara yazar.
  return CEOMED_IRSALIYE_NO_DESENI.test(aday) ? aday : null;
}

/** Yedek parça sayılan action tipleri. Hücre değişimi de stoktan parça tüketir. */
const PART_ACTION_TYPES = new Set(['part_change', 'hucre_degisimi']);

/** Builder'ın beklediği minimum action şekli (ActionItem'ın alt kümesi). */
export type PartActionInput = {
  id?: string;
  type?: string;
  stokKodu?: string;
  stokAdi?: string;
  quantity?: number;
  serialNumber?: string;
  lotNumber?: string;
  miad?: string;
};

export type BuildIrsaliyeGirisInput = {
  formId: string;
  formNo?: string | null;
  formType: 'teknik_servis' | 'aplikasyon';
  /** İşlem tarihi — 'YYYY-MM-DD' ya da Date. */
  tarih?: string | Date | null;
  hospitalId: string;
  /** Laboratuvarın Ceomed cari kodu (Yönetim → Laboratuvarlar). */
  cariKodu?: string | null;
  labName?: string | null;
  deviceId?: string | null;
  cihazAdi?: string | null;
  seriNumarasi?: string | null;
  /** İşlemi yapan teknik/aplikasyon personelinin adı soyadı. */
  personnelName?: string | null;
  personnelUid?: string | null;
  companyId?: string | null;
  actions: PartActionInput[];
};

const text = (value: unknown) => String(value == null ? '' : value).trim();

/** Yedek parça içeren action'ları ayıklar. Parça yoksa boş dizi döner. */
export function selectPartActions<T extends PartActionInput>(actions: T[] | null | undefined): T[] {
  return (actions || []).filter((a) => PART_ACTION_TYPES.has(String(a?.type || '')));
}

/**
 * Ceomed LOT sütununa ne yazılacağını belirler.
 *
 * Kullanıcı kuralı, üç durumu da tek cümleye indirger: "seri no varsa seri no".
 *   - lot + miad + seri no  → seri no
 *   - sadece seri no        → seri no
 *   - sadece lot            → lot
 */
export function resolveLotValue(action: PartActionInput): { lot: string; lotKaynagi: LotKaynagi } {
  const seri = text(action?.serialNumber);
  if (seri) return { lot: seri, lotKaynagi: 'seri_no' };

  const lot = text(action?.lotNumber);
  if (lot) return { lot, lotKaynagi: 'lot' };

  return { lot: '', lotKaynagi: 'yok' };
}

/** Tarihi ISO (YYYY-MM-DD) biçimine indirger; çözemezse null döner. */
export function normalizeTarih(input: string | Date | null | undefined): string | null {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${input.getFullYear()}-${pad(input.getMonth() + 1)}-${pad(input.getDate())}`;
  }

  const raw = text(input);
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // dd.MM.yyyy / dd/MM/yyyy / dd-MM-yyyy — Ceomed ve Excel girişleri bu biçimde gelir.
  const m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

/**
 * ISO tarihi Ceomed formunun beklediği maskeye çevirir.
 * Worker bu fonksiyonun JS ikizini kullanır; biçim env ile değiştirilebilir.
 */
export function formatTarihForCeomed(iso: string, separator: '/' | '.' = '/'): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${d}${separator}${mo}${separator}${y}`;
}

export type BuildIrsaliyeGirisResult =
  | { outcome: 'skip'; reason: 'yedek_parca_yok' }
  | { outcome: 'ready'; doc: IrsaliyeGirisDoc }
  | { outcome: 'blocked'; doc: IrsaliyeGirisDoc };

/**
 * Formdan kuyruk dokümanı üretir.
 *
 * Üç sonuç vardır ve üçü de bilinçlidir:
 *   - `skip`    — formda yedek parça yok, yazılacak bir şey de yok.
 *   - `ready`   — tüm zorunlu alanlar dolu, worker yazabilir.
 *   - `blocked` — eksik veri var. Doküman YİNE DE yazılır ki iş kaybolmasın ve
 *                 panelde gerekçesiyle görünsün; worker bunlara dokunmaz.
 */
export function buildIrsaliyeGirisDoc(input: BuildIrsaliyeGirisInput): BuildIrsaliyeGirisResult {
  const partActions = selectPartActions(input.actions);
  if (partActions.length === 0) {
    return { outcome: 'skip', reason: 'yedek_parca_yok' };
  }

  const satirlar: IrsaliyeGirisSatiri[] = partActions.map((action) => {
    const { lot, lotKaynagi } = resolveLotValue(action);
    const miktar = Number(action?.quantity);
    return {
      actionId: text(action?.id),
      stokKodu: text(action?.stokKodu),
      stokAdi: text(action?.stokAdi),
      miktar: Number.isFinite(miktar) && miktar > 0 ? miktar : 1,
      lot,
      lotKaynagi,
      miad: text(action?.miad),
    };
  });

  const formNo = text(input.formNo);
  const irsaliyeNo = formNo ? ceomedIrsaliyeNo(formNo) : null;
  const cariKodu = text(input.cariKodu).toLocaleUpperCase('tr-TR');
  const personnelName = text(input.personnelName);
  const tarih = normalizeTarih(input.tarih);

  const blocks: Array<{ reason: BlockReason; detail: string }> = [];

  if (!formNo) {
    blocks.push({
      reason: 'form_no_yok',
      detail: 'Formun numarası üretilememiş; irsaliye no alanı doldurulamaz.',
    });
  } else if (!irsaliyeNo) {
    blocks.push({
      reason: 'form_no_ceomed_formatina_uymuyor',
      detail:
        `Form numarası "${formNo}" Ceomed irsaliye no biçimine çevrilemedi. ` +
        'Alan 2 harf + en fazla 6 rakam kabul ediyor ve fazlasını sessizce kesiyor; ' +
        'yanlış numara yazmamak için iş durduruldu.',
    });
  }
  if (!cariKodu) {
    blocks.push({
      reason: 'cari_kodu_tanimsiz',
      detail:
        `"${text(input.labName) || input.hospitalId}" laboratuvarında Ceomed cari kodu tanımlı değil. ` +
        'Yönetim → Laboratuvarlar ekranından cari kodunu girin; iş otomatik yeniden denenecektir.',
    });
  }
  if (!tarih) {
    blocks.push({
      reason: 'tarih_gecersiz',
      detail: 'İşlem tarihi okunamadı; irsaliye tarihi alanı doldurulamaz.',
    });
  }
  if (!personnelName) {
    blocks.push({
      reason: 'personel_adi_yok',
      detail: 'İşlemi yapan personelin adı soyadı boş; açıklama alanı doldurulamaz.',
    });
  }

  const kodsuz = satirlar.filter((s) => !s.stokKodu);
  if (kodsuz.length > 0) {
    blocks.push({
      reason: 'stok_kodu_eksik',
      detail:
        `${kodsuz.length} yedek parça satırında stok kodu yok ` +
        `(${kodsuz.map((s) => s.stokAdi || 'isimsiz').join(', ')}). ` +
        'Ürün kodunu tanımlayıp işi yeniden kuyruğa alın.',
    });
  }

  const doc: IrsaliyeGirisDoc = {
    irsaliyeNo: irsaliyeNo || '',
    cariKodu,
    tarih: tarih || '',
    islemTipi: CEOMED_ISLEM_TIPI,
    depo: CEOMED_DEPO,
    aciklama: personnelName,
    satirlar,
    status: blocks.length > 0 ? 'blocked' : 'pending',
    blockedReason: blocks.length > 0 ? blocks[0].reason : null,
    blockedDetail: blocks.length > 0 ? blocks.map((b) => b.detail).join(' ') : null,
    formId: input.formId,
    formNo,
    formType: input.formType,
    hospitalId: input.hospitalId,
    labName: text(input.labName) || null,
    deviceId: text(input.deviceId) || null,
    cihazAdi: text(input.cihazAdi) || null,
    seriNumarasi: text(input.seriNumarasi) || null,
    personnelUid: text(input.personnelUid) || null,
    personnelName,
    companyId: text(input.companyId) || null,
    attemptCount: 0,
    lastError: null,
  };

  return blocks.length > 0 ? { outcome: 'blocked', doc } : { outcome: 'ready', doc };
}
