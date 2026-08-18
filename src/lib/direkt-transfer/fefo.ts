/**
 * Direkt transfer — FEFO değerlendirmesi ve stok tahsisi (tek kaynak).
 *
 * Bu modül, transfer hazırlanırken sunucudan okunan **anlık depo stoğu**
 * üzerinde çalışır ve iki soruyu yanıtlar:
 *
 *  1. Grup satırları (lot/adet takipli) hangi `depoStok` belgelerinden
 *     karşılanacak? (`allocateGroupRows`)
 *  2. Sevk edilecek kalemlerden daha erken miadlı, **hâlâ depoda duran** bir
 *     alternatif var mı? (`findFefoViolations`)
 *
 * Panelde iki iş ayrı ayrı yazılmıştı ve üç ayrı hataya sebep oluyordu:
 *
 *  - **Miad yanlış çözülüyordu.** Sıralama `formatMiad()` ile metne çevirip
 *    `date-fns.parse(…, 'dd.MM.yyyy')` ile geri okuyordu. `formatMiad` içindeki
 *    `toDateSafe`, metni önce `new Date(str)`'e veriyor; V8 `"01.02.2027"`
 *    değerini ABD kuralıyla **2 Ocak 2027** olarak okuyor. Yani günü 12'den
 *    küçük her lotun ayı ile günü yer değiştiriyor, `"05.11.2026"` altı ay
 *    erkene kayıyordu. FEFO önerisi bu yüzden depodaki gerçek en eski lotu
 *    değil, tarihi bozulmuş bir kaydı gösteriyordu. Burada, biçim çeşitliliğini
 *    (ISO, `dd.MM.yyyy`, yalnız `MM.yyyy`, Timestamp, Date) tek elden çözen
 *    `parseMiad` kullanılır.
 *  - **Tahsis, kısmi kullanımı saymıyordu.** Bir belgeden ihtiyacın yalnız bir
 *    kısmı alındığında belge "kullanıldı" işaretlenmiyor, aynı belge sonraki
 *    satıra TÜM adediyle yeniden sunuluyordu; depoda olmayan stok tahsis
 *    edilebiliyordu. Artık belge başına kalan adet takip edilir.
 *  - **Öneri, tükenmiş kaydı gösterebiliyordu.** Uyarı yalnız belge kimliğine
 *    bakıyordu; transferin o belgeden aldığı adet hesaba katılmıyordu. Artık
 *    yalnızca bu transferden ARTAN birimi olan belgeler önerilir.
 *
 * Performans: miad çözümü ve sıralama, sunucudan gelen anlık görüntü için
 * **bir kez** yapılır (`buildStockSnapshot`). Eski kod her karşılaştırmada
 * yeniden metne çevirip ayrıştırıyordu; uyarı taraması kalem × stok
 * karmaşıklığındaydı. Artık sıralı havuzun başına bakmak yeterli olduğu için
 * tarama kalem başına sabit zamanlıdır.
 */

// Değer importları göreli tutulur: bu modül `tests/` altından derlenip doğrudan
// node ile koşturulur ve orada `@/` takma adı çözülmez. Tip importları derleme
// sırasında silindiği için takma adı kullanabilir — `./types` içindeki
// `FefoViolation` da `@/lib/types` sürümüyle yazıldığından ikisi aynı olmalı.
import { parseMiad } from '../lojistik/miad';
import { getStockItemQuantity, isAvailableDepotStock } from '../stock-quantity';
import type { DepoStokItem } from '@/lib/types';
import type { FefoViolation, TransferRow } from './types';

/** Bir transferde belgeden alınacak birim sayısını taşıyan stok satırı. */
export type AllocatedStockItem = DepoStokItem & { transferAdet?: number };

/**
 * Miadı çözülemeyen kayıt için sıralama değeri.
 *
 * Sonsuz seçilir ki bilinmeyen miad FEFO sırasının SONUNA gitsin: miadı
 * bilinmeyen bir kutuyu öne almak, bilerek yanlış tarafa düşmektir.
 */
export const BILINMEYEN_MIAD = Number.POSITIVE_INFINITY;

/** Stok belgesinin miadını epoch milisaniyeye çevirir; çözülemezse sonsuz. */
export function miadMillis(item: { miad?: unknown } | null | undefined): number {
  const tarih = parseMiad(item?.miad);
  return tarih ? tarih.getTime() : BILINMEYEN_MIAD;
}

/** `stokKodu__lot` anahtarı — lot alanı boş olabilir. */
export function lotKey(stokKodu: string | undefined, lotNumarasi: string | undefined | null): string {
  return `${stokKodu ?? ''}__${lotNumarasi ?? ''}`;
}

/**
 * Sunucudan okunan anlık stok görüntüsünün, FEFO'ya hazır indeksi.
 *
 * Tahsis ve uyarı taraması AYNI görüntüyü paylaşır; aksi halde uyarı kutusu,
 * tahsisin kullandığından farklı bir stok fotoğrafına bakabilir.
 */
export interface StockSnapshot {
  /** stokKodu → miadı erken olan önde, sıralı belgeler. */
  byCode: Map<string, DepoStokItem[]>;
  /** `stokKodu__lot` → miadı erken olan önde, sıralı belgeler. */
  byCodeAndLot: Map<string, DepoStokItem[]>;
  /** Belge kimliği → miad (epoch ms; bilinmiyorsa `BILINMEYEN_MIAD`). */
  expiryById: Map<string, number>;
  /** Belge kimliği → depodaki gerçek birim adedi. */
  quantityById: Map<string, number>;
}

/**
 * Anlık stok listesini FEFO indeksine çevirir.
 *
 * Sevk edilmiş (`isShipped === true`) belgeler ve mükerrer kimlikler ayıklanır;
 * miad tek seferde çözülür.
 */
export function buildStockSnapshot(stock: readonly DepoStokItem[] | null | undefined): StockSnapshot {
  const expiryById = new Map<string, number>();
  const quantityById = new Map<string, number>();
  const byCode = new Map<string, DepoStokItem[]>();
  const byCodeAndLot = new Map<string, DepoStokItem[]>();

  for (const item of stock ?? []) {
    const id = item?.id;
    if (!id || expiryById.has(id)) continue;
    if (!isAvailableDepotStock(item)) continue;

    expiryById.set(id, miadMillis(item));
    quantityById.set(id, getStockItemQuantity(item));

    const code = item.stokKodu ?? '';
    const codeBucket = byCode.get(code);
    if (codeBucket) codeBucket.push(item);
    else byCode.set(code, [item]);

    const key = lotKey(code, item.lotNumarasi);
    const lotBucket = byCodeAndLot.get(key);
    if (lotBucket) lotBucket.push(item);
    else byCodeAndLot.set(key, [item]);
  }

  // `Infinity - Infinity` NaN verir; farkla değil, açık karşılaştırmayla sırala.
  // Eşit miadlarda belge kimliği ile kararlı sıra kurulur, böylece aynı stok
  // görüntüsü her çalıştırmada aynı öneriyi üretir.
  const compare = (a: DepoStokItem, b: DepoStokItem): number => {
    const ea = expiryById.get(a.id) ?? BILINMEYEN_MIAD;
    const eb = expiryById.get(b.id) ?? BILINMEYEN_MIAD;
    if (ea !== eb) return ea < eb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  byCode.forEach(items => items.sort(compare));
  byCodeAndLot.forEach(items => items.sort(compare));

  return { byCode, byCodeAndLot, expiryById, quantityById };
}

export interface AllocationRequest {
  /** Tahsis edilecek grup satırları (lot/adet takipli, adet taşıyan satırlar). */
  groupRows: readonly TransferRow[];
  /** Anlık stok görüntüsü. */
  snapshot: StockSnapshot;
  /** Listede tekil satır olarak duran, tamamı rezerve belge kimlikleri. */
  reservedIds?: Iterable<string>;
  /**
   * Satır adet takipli mi? Adet takipli ve lotu belirtilmemiş satırlar ürün
   * kodunun tamamından, diğerleri yalnızca kendi lotundan karşılanır.
   */
  isQuantityTracked: (row: TransferRow) => boolean;
}

export interface AllocationResult {
  /** `TransferRow.key` → o satırı karşılayan belgeler ve alınan adetleri. */
  allocations: Map<string, AllocatedStockItem[]>;
  /** Stoğu yetmeyen ilk satır; hepsi karşılandıysa `null`. */
  error: TransferRow | null;
}

/**
 * Grup satırlarını anlık stoktan FEFO sırasıyla karşılar.
 *
 * Belge başına kalan adet takip edilir: bir belgeden kısmen alınırsa kalanı
 * sonraki satırlar için havuzda durur, tamamı alınırsa havuzdan düşer. Bir
 * satır karşılanamazsa hiçbir tahsis döndürülmez — çağıran taraf transferi
 * başlatmadan kullanıcıyı uyarır.
 */
export function allocateGroupRows({
  groupRows,
  snapshot,
  reservedIds,
  isQuantityTracked,
}: AllocationRequest): AllocationResult {
  const remaining = new Map(snapshot.quantityById);
  for (const id of reservedIds ?? []) remaining.set(id, 0);

  const allocations = new Map<string, AllocatedStockItem[]>();

  for (const row of groupRows) {
    const pool = isQuantityTracked(row) && !row.lotNumarasi
      ? snapshot.byCode.get(row.stokKodu) ?? []
      : snapshot.byCodeAndLot.get(lotKey(row.stokKodu, row.lotNumarasi)) ?? [];

    const need = Math.max(1, row.adet ?? 1);
    const picks: AllocatedStockItem[] = [];
    let accumulated = 0;

    for (const docItem of pool) {
      if (accumulated >= need) break;
      const kalan = remaining.get(docItem.id) ?? 0;
      if (kalan <= 0) continue;

      const take = Math.min(kalan, need - accumulated);
      picks.push({ ...docItem, transferAdet: take });
      remaining.set(docItem.id, kalan - take);
      accumulated += take;
    }

    if (accumulated < need) return { allocations: new Map(), error: row };
    allocations.set(row.key, picks);
  }

  return { allocations, error: null };
}

/** Bu transferin belge başına aldığı toplam birim. */
function buildTakenIndex(
  itemsToShip: readonly AllocatedStockItem[],
  snapshot: StockSnapshot,
): Map<string, number> {
  const taken = new Map<string, number>();
  for (const item of itemsToShip) {
    const id = item?.id;
    if (!id) continue;
    const declared = Number(item.transferAdet);
    const take = Number.isFinite(declared) && declared > 0
      ? declared
      : snapshot.quantityById.get(id) ?? getStockItemQuantity(item);
    taken.set(id, (taken.get(id) ?? 0) + take);
  }
  return taken;
}

/**
 * Sevk listesindeki kalemler için FEFO ihlallerini bulur.
 *
 * Bir ihlal, ancak aşağıdakilerin tümü doğruysa üretilir:
 *  - Sevk edilen kalemin miadı çözülebiliyor (çözülemiyorsa sıralanamaz, uyarı
 *    üretilmez — mevcut davranış korunur),
 *  - Aynı ürün kodunda miadı DAHA ERKEN bir belge var,
 *  - O belgede, bu transferin aldığı adet düşüldükten sonra hâlâ birim kalıyor.
 *
 * Sonuç kalem başına tekildir; çağıran tarafın ayrıca tekilleştirmesi gerekmez.
 */
export function findFefoViolations(
  itemsToShip: readonly AllocatedStockItem[],
  snapshot: StockSnapshot,
): FefoViolation[] {
  if (!itemsToShip || itemsToShip.length === 0) return [];

  const taken = buildTakenIndex(itemsToShip, snapshot);

  // Ürün kodu başına, transferden ARTAN birimi olan en erken miadlı belge.
  // Havuz sıralı olduğu için baştan ilk uygun belge yeterlidir; bilinmeyen
  // miadlı kayıtlara ulaşıldığında sonrasının tamamı bilinmeyendir, aday yok.
  const earliestAvailable = new Map<string, DepoStokItem | null>();
  for (const item of itemsToShip) {
    const code = item?.stokKodu ?? '';
    if (earliestAvailable.has(code)) continue;

    let found: DepoStokItem | null = null;
    for (const candidate of snapshot.byCode.get(code) ?? []) {
      if ((snapshot.expiryById.get(candidate.id) ?? BILINMEYEN_MIAD) === BILINMEYEN_MIAD) break;
      const total = snapshot.quantityById.get(candidate.id) ?? 0;
      if (total - (taken.get(candidate.id) ?? 0) <= 0) continue;
      found = candidate;
      break;
    }
    earliestAvailable.set(code, found);
  }

  const violations: FefoViolation[] = [];
  const reported = new Set<string>();

  for (const item of itemsToShip) {
    const id = item?.id;
    if (!id || reported.has(id)) continue;

    const itemExpiry = snapshot.expiryById.get(id) ?? miadMillis(item);
    if (itemExpiry === BILINMEYEN_MIAD) continue;

    const candidate = earliestAvailable.get(item.stokKodu ?? '') ?? null;
    if (!candidate || candidate.id === id) continue;

    const candidateExpiry = snapshot.expiryById.get(candidate.id) ?? BILINMEYEN_MIAD;
    if (candidateExpiry >= itemExpiry) continue;

    reported.add(id);
    violations.push({ scannedItem: item, recommendedItem: candidate });
  }

  return violations;
}
