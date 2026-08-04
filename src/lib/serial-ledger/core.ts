/**
 * Seri No Defteri (serialLedger) — çekirdek, saf mantık.
 *
 * Sistemdeki her benzersiz fiziksel ürün, `ürün kodu + seri no` eşleşmesiyle
 * TEK bir satırla temsil edilir. Bu satır ürünün geçmişte hangi işlemlerden
 * geçtiğini (mal kabul → transfer → sipariş karşılama → tüketim → imha → borç →
 * depo sayımından düşüm) ve şu anda nerede olduğunu tutar.
 *
 * Eski `serialHistory/{seriNo}/events` yapısı yalnızca seri numarasıyla
 * anahtarlanıyordu; aynı seri numarası farklı ürün kodlarında da geçebildiği
 * için bu yapı iki farklı fiziksel ürünü aynı satırda birleştiriyordu. Ayrıca
 * `companyId` taşımadığı için kiracı (tenant) bazında sorgulanamıyordu.
 *
 * Bu dosya Firestore SDK'sına DOKUNMAZ; tamamen saf olduğu için hem istemci,
 * hem sunucu (Admin SDK), hem de testler tarafından kullanılabilir.
 */

/** Bir seri numarasının geçebileceği işlem tipleri. */
export type SerialEventType =
  /** Depoya mal kabul ile giriş. */
  | 'mal_kabul'
  /** Depodan laboratuvara direkt transfer. */
  | 'transfer'
  /** Bir siparişin toplanarak karşılanması (transferin sipariş bağlamlı hali). */
  | 'siparis_karsilama'
  /** Laboratuvarlar arası / havuz içi transfer. */
  | 'lab_transfer'
  /** Ürün kullanım panelinden tüketim. */
  | 'tuketim'
  /** İmha edilen kit / ürün. */
  | 'imha'
  /** Borç deposuna çıkış. */
  | 'borc'
  /** Borç iadesi veya laboratuvardan depoya geri dönüş. */
  | 'iade'
  /** Depo sayımında fiilen bulunamayıp stoktan düşülen birim. */
  | 'sayim_dusum'
  /** Manuel stok düzeltmesi / yönetici müdahalesi. */
  | 'duzeltme';

export const SERIAL_EVENT_TYPES: readonly SerialEventType[] = [
  'mal_kabul',
  'transfer',
  'siparis_karsilama',
  'lab_transfer',
  'tuketim',
  'imha',
  'borc',
  'iade',
  'sayim_dusum',
  'duzeltme',
];

export const SERIAL_EVENT_LABEL: Record<SerialEventType, string> = {
  mal_kabul: 'Mal Kabul',
  transfer: 'Transfer',
  siparis_karsilama: 'Sipariş Karşılama',
  lab_transfer: 'Laboratuvar Transferi',
  tuketim: 'Tüketim',
  imha: 'İmha',
  borc: 'Borç Çıkışı',
  iade: 'İade',
  sayim_dusum: 'Depo Sayımından Düşüm',
  duzeltme: 'Düzeltme',
};

/** Bir birimin defterdeki güncel durumu. */
export type SerialLedgerStatus =
  /** Depoda, sevk edilmemiş. */
  | 'depoda'
  /** Bir laboratuvarın (veya havuzun) stoğunda. */
  | 'laboratuvarda'
  /** Borç deposunda. */
  | 'borcta'
  /** Tüketilmiş — fiziksel birim tükendi. */
  | 'tuketildi'
  /** İmha edilmiş. */
  | 'imha_edildi'
  /**
   * Depo sayımıyla stoktan düşülmüş. Fiziksel birim sistemden çıktı; AYNI seri
   * numarası yeniden mal kabul edilebilir, transfer edilebilir ve tüketilebilir.
   */
  | 'serbest';

export const SERIAL_STATUS_LABEL: Record<SerialLedgerStatus, string> = {
  depoda: 'Depoda',
  laboratuvarda: 'Laboratuvarda',
  borcta: 'Borçta',
  tuketildi: 'Tüketildi',
  imha_edildi: 'İmha Edildi',
  serbest: 'Serbest (sayımdan düşüldü)',
};

export type SerialLocationType = 'depot' | 'lab' | 'borc' | 'none';

export interface SerialLedgerLocation {
  locationType: SerialLocationType;
  locationId: string;
  locationName: string;
}

/** Bir olayın deftere yazılırken taşıdığı bağlam. */
export interface SerialEventInput {
  type: SerialEventType;
  stokKodu: string;
  seriNumarasi: string;
  stokAdi?: string;
  lotNumarasi?: string;
  miad?: string;
  gtin?: string;
  /** Olay sonrası birimin bulunduğu yer. Verilmezse olay tipinden türetilir. */
  location?: Partial<SerialLedgerLocation>;
  /**
   * Olay tipinden türetilen durumu ezer.
   *
   * Yalnızca `duzeltme` gibi tek başına anlam taşımayan olaylarda gerekir:
   * yönetici bir stok satırını elle sildiğinde birim fiziksel olarak depodan
   * çıkmıştır, yani `serbest` olmalı ve aynı seri yeniden kabul edilebilmelidir.
   */
  status?: SerialLedgerStatus;
  /** Kaynak konum (transferlerde depo, iade/lab transferinde kaynak lab). */
  source?: Partial<SerialLedgerLocation>;
  /** İlgili belge kimlikleri: transferId, orderId, consumptionId, sessionId… */
  refs?: Record<string, string | null | undefined>;
  /** İşlemi yapan kullanıcı. */
  actorUid?: string | null;
  actorName?: string | null;
  /** Serbest biçimli ek alanlar (irsaliye no, raf adresi, adet…). */
  details?: Record<string, unknown>;
}

/**
 * Olay tipinden varsayılan durum. Konum bilgisi olayın kendisinden gelir;
 * burada yalnızca "birim hangi hâle geçti" sorusu cevaplanır.
 */
export function statusForEvent(type: SerialEventType): SerialLedgerStatus | null {
  switch (type) {
    case 'mal_kabul':
    case 'iade':
      return 'depoda';
    case 'transfer':
    case 'siparis_karsilama':
    case 'lab_transfer':
      return 'laboratuvarda';
    case 'borc':
      return 'borcta';
    case 'tuketim':
      return 'tuketildi';
    case 'imha':
      return 'imha_edildi';
    case 'sayim_dusum':
      return 'serbest';
    case 'duzeltme':
      // Düzeltme durumu değiştirmez; çağıran açıkça konum/durum verebilir.
      return null;
    default:
      return null;
  }
}

export function locationTypeForEvent(type: SerialEventType): SerialLocationType {
  switch (type) {
    case 'mal_kabul':
    case 'iade':
      return 'depot';
    case 'transfer':
    case 'siparis_karsilama':
    case 'lab_transfer':
      return 'lab';
    case 'borc':
      return 'borc';
    default:
      return 'none';
  }
}

/**
 * Defterdeki satırın okunabilir hâli. Firestore zaman damgaları çağıran
 * tarafın tipine bırakıldığı için `unknown` olarak taşınır.
 */
export interface SerialLedgerEntry<TTime = unknown> {
  id: string;
  companyId: string;
  stokKodu: string;
  stokAdi: string;
  seriNumarasi: string;
  lotNumarasi: string;
  miad: string;
  gtin?: string;
  status: SerialLedgerStatus;
  locationType: SerialLocationType;
  locationId: string;
  locationName: string;
  lastEventType: SerialEventType;
  lastEventAt?: TTime;
  firstEventAt?: TTime;
  eventCount?: number;
  lastActorUid?: string | null;
  lastActorName?: string | null;
}

/**
 * `ürün kodu + seri no` çiftinin defterdeki tekil belge kimliği.
 *
 * Kiracı ön eki, aynı seri numarasının farklı şirketlerde çakışmasını önler.
 * Firestore belge kimliğinde `/` yasaktır ve `.`/`..` rezervedir; bu yüzden
 * güvenli olmayan tüm karakterler `_` ile değiştirilir ve sabit bir ön ek
 * kullanılır.
 */
export function buildSerialLedgerId(
  companyId: string | null | undefined,
  stokKodu: string,
  seriNumarasi: string,
): string {
  const safe = (value: string) =>
    (value || '').trim().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 400);
  const company = safe(String(companyId || '__legacy__'));
  return `sl_${company}__${safe(stokKodu)}__${safe(seriNumarasi)}`;
}

/** Bir seri numarasının deftere yazılabilecek kadar anlamlı olup olmadığı. */
export function isTrackableSerial(seriNumarasi: string | null | undefined): boolean {
  const serial = (seriNumarasi || '').trim();
  if (!serial) return false;
  // Depo sayımının ürettiği sentetik yer tutucular gerçek bir fiziksel birimi
  // temsil etmez; deftere girmemelidir.
  return !/^(FAZLA|SAYIM)-/i.test(serial);
}

/**
 * Bu birim yeniden mal kabul edilebilir mi?
 *
 * Defterde kaydı olmayan seri her zaman kabul edilebilir. Kaydı olan seri
 * yalnızca `serbest` durumundaysa (depo sayımıyla stoktan düşülmüşse) yeniden
 * işleme alınabilir — kullanıcı akışının açık gereksinimi budur. Diğer tüm
 * durumlar (depoda, laboratuvarda, borçta, tüketildi, imha) mükerrer kabul
 * anlamına gelir ve engellenir.
 */
export function canReceiveSerial(entry: Pick<SerialLedgerEntry, 'status'> | null | undefined): boolean {
  if (!entry) return true;
  return entry.status === 'serbest';
}

/**
 * Birim, laboratuvar stoğundan tüketilebilir mi?
 *
 * `laboratuvarda` doğal durumdur. `depoda` kaydı olan birim henüz transfer
 * edilmemiştir; tüketim panelinin stok sorgusu zaten onu bulamayacağı için
 * burada ayrıca engellemeye gerek yoktur — defter yalnızca "bu birim daha önce
 * tüketilmiş/imha edilmiş mi" sorusuna cevap verir.
 */
export function canConsumeSerial(entry: Pick<SerialLedgerEntry, 'status'> | null | undefined): boolean {
  if (!entry) return true;
  return entry.status !== 'tuketildi' && entry.status !== 'imha_edildi';
}

/** Engelin kullanıcıya gösterilecek gerekçesi. */
export function describeSerialBlock(entry: Pick<SerialLedgerEntry, 'status' | 'locationName'>): string {
  const where = entry.locationName ? ` (${entry.locationName})` : '';
  switch (entry.status) {
    case 'depoda':
      return `Bu seri numarası halihazırda depo stoğunda${where}.`;
    case 'laboratuvarda':
      return `Bu seri numarası laboratuvar stoğunda${where}.`;
    case 'borcta':
      return `Bu seri numarası borç deposunda${where}.`;
    case 'tuketildi':
      return 'Bu seri numarası daha önce tüketilmiş.';
    case 'imha_edildi':
      return 'Bu seri numarası daha önce imha edilmiş.';
    case 'serbest':
      return 'Bu seri numarası depo sayımıyla düşülmüş; yeniden işlem görebilir.';
    default:
      return 'Bu seri numarası daha önce işlem görmüş.';
  }
}

/**
 * Bir olaydan defter satırının değişen alanlarını üretir.
 *
 * Zaman damgası ve sayaç gibi Firestore'a özgü alanlar çağıran tarafça
 * eklenir; burada yalnızca alan adları ve iş kuralları belirlenir.
 */
export function projectLedgerFields(input: SerialEventInput, companyId: string | null | undefined) {
  const status = input.status ?? statusForEvent(input.type);
  const locationType = input.location?.locationType ?? locationTypeForEvent(input.type);
  return {
    companyId: String(companyId || '__legacy__'),
    stokKodu: (input.stokKodu || '').trim(),
    stokAdi: (input.stokAdi || '').trim() || (input.stokKodu || '').trim(),
    seriNumarasi: (input.seriNumarasi || '').trim(),
    lotNumarasi: (input.lotNumarasi || '').trim(),
    miad: typeof input.miad === 'string' ? input.miad : '',
    ...(input.gtin ? { gtin: input.gtin } : {}),
    ...(status ? { status } : {}),
    locationType,
    locationId: input.location?.locationId ?? '',
    locationName: input.location?.locationName ?? '',
    lastEventType: input.type,
    lastActorUid: input.actorUid ?? null,
    lastActorName: input.actorName ?? null,
  };
}

/** Olay alt-belgesinin gövdesi (zaman damgası hariç). */
export function projectEventFields(input: SerialEventInput, companyId: string | null | undefined) {
  const cleanRefs: Record<string, string> = {};
  Object.entries(input.refs || {}).forEach(([key, value]) => {
    if (typeof value === 'string' && value.trim()) cleanRefs[key] = value.trim();
  });
  return {
    companyId: String(companyId || '__legacy__'),
    type: input.type,
    stokKodu: (input.stokKodu || '').trim(),
    stokAdi: (input.stokAdi || '').trim(),
    seriNumarasi: (input.seriNumarasi || '').trim(),
    lotNumarasi: (input.lotNumarasi || '').trim(),
    miad: typeof input.miad === 'string' ? input.miad : '',
    fromType: input.source?.locationType ?? 'none',
    fromId: input.source?.locationId ?? '',
    fromName: input.source?.locationName ?? '',
    toType: input.location?.locationType ?? locationTypeForEvent(input.type),
    toId: input.location?.locationId ?? '',
    toName: input.location?.locationName ?? '',
    refs: cleanRefs,
    actorUid: input.actorUid ?? null,
    actorName: input.actorName ?? null,
    details: input.details ?? {},
  };
}

/**
 * Eski `serialHistory` olay tiplerini yeni sözlüğe çevirir. Geriye dönük
 * doldurma (backfill) ve eski kayıtların okunması bu eşlemeyi kullanır.
 */
export function normalizeLegacyEventType(legacyType: string | null | undefined): SerialEventType | null {
  switch ((legacyType || '').trim()) {
    case 'intake':
    case 'mal_kabul':
      return 'mal_kabul';
    case 'transfer':
      return 'transfer';
    case 'depot_to_lab_transfer':
      return 'transfer';
    case 'inter_lab_transfer':
      return 'lab_transfer';
    case 'consumption':
    case 'tuketim':
      return 'tuketim';
    case 'sayimdan_dusum':
    case 'sayim_dusum':
      return 'sayim_dusum';
    case 'imha':
    case 'destroyed':
      return 'imha';
    case 'borc':
      return 'borc';
    case 'iade':
    case 'return':
      return 'iade';
    default:
      return null;
  }
}
