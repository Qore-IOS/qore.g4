/**
 * @fileoverview Seri numarasız ürünlerin terminalde okutulması.
 *
 * NEDEN AYRI BİR MODÜL
 *
 * Terminal ilk sürümde YALNIZCA seri numaralı kalemleri kabul ediyordu;
 * seri numarası okunamayan barkodda kullanıcıyı web paneline yolluyordu.
 * Oysa tanımlı ürünlerin bir kısmı lot ya da adet takipli (`TrackingMode`:
 * `lot_barcode`, `lot_manual`, `qty_barcode`, `qty_manual`) ve depoda aynı
 * rafta duruyorlar — görevlinin bir kutu için terminale, diğeri için
 * bilgisayara gitmesi anlamsız.
 *
 * Yazma katmanı bu ürünleri ZATEN destekliyordu:
 *   - mal kabul → `applyGroupIntakeWrite` (tek belge, `adet` alanı)
 *   - transfer  → `applyTransferItemWrites` (`transferAdet` ile kısmi sevk)
 *
 * Eksik olan tek şey okutma mantığıydı. Burası o mantık — ve React'ten ayrı,
 * saf fonksiyonlar hâlinde, çünkü depo testleri DOM kurmadan çalışıyor.
 *
 * `src/lib/siparisler/picking.ts` İLE FARKI
 *
 * Orada da adetli okutma için bir yardımcı var (`findAvailableStockForQuantityScan`)
 * ama web toplama ekranının kodlanmış tanımlayıcı şemasına bağlı ve FEFO
 * uygulamıyor: lota göre toplayıp ilk uyan kaydı döndürüyor. Terminalin
 * ihtiyacı farklı — `applyTransferItemWrites` BELGE BAZINDA yazdığı için
 * hangi `depoStok` belgesinden kaç adet ayrıldığının bilinmesi ve miadı
 * yakın olanın önce tüketilmesi gerekiyor. İki yardımcı bilerek ayrı.
 *
 * TEMEL İLKE: HER OKUTMA BİR ADET
 *
 * Depoda görevli elindeki kutuyu okutur. "Kaç adet?" diye soran bir alan,
 * eldiven ve barkod okuyucuyla çalışan biri için sürtünmedir. Bu yüzden her
 * okutma miktarı bir artırır; düzeltme gerekirse satırdaki +/- ile yapılır.
 */

// Göreli import BİLEREK: testler `@/` alias'ını çözmüyor (bkz.
// `src/lib/siparisler/picking.ts` — aynı sebeple göreli).
import { getStockItemQuantity } from '../stock-quantity';

/** Okutulan barkodun hangi kimlikle eşleştiği. */
export type ScanIdentity = {
  stokKodu: string;
  /** Barkodda lot varsa doldurulur; yoksa yalnızca stok koduyla eşleşilir. */
  lotNumarasi?: string;
};

/** Bu modülün stok kaydından ihtiyaç duyduğu alanlar. */
export type StockLike = {
  id: string;
  stokKodu?: string;
  lotNumarasi?: string;
  miad?: unknown;
  adet?: number;
  seriNumarasi?: string;
};

/**
 * Miadı karşılaştırılabilir bir sayıya çevirir.
 *
 * Miad alanı depoda üç ayrı biçimde duruyor (ISO metin, `Timestamp`, `Date`);
 * hepsini tek bir sıraya sokmak gerekiyor. Çözümlenemeyen değer EN SONA
 * atılır: miadı bilinmeyen bir kutuyu FEFO'da öne almak, bilerek yanlış
 * kutuyu sevk etmek olurdu.
 */
export function expiryRank(miad: unknown): number {
  if (!miad) return Number.POSITIVE_INFINITY;

  if (typeof miad === 'string') {
    const parsed = Date.parse(miad);
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  }
  if (miad instanceof Date) return miad.getTime();

  const asTimestamp = miad as { toDate?: () => Date; seconds?: number };
  if (typeof asTimestamp.toDate === 'function') {
    const date = asTimestamp.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? date.getTime()
      : Number.POSITIVE_INFINITY;
  }
  if (typeof asTimestamp.seconds === 'number') return asTimestamp.seconds * 1000;

  return Number.POSITIVE_INFINITY;
}

/** Miadı önce gelen önde — FEFO (first expired, first out). */
export function sortByExpiry<T extends StockLike>(items: T[]): T[] {
  return [...items].sort((a, b) => expiryRank(a.miad) - expiryRank(b.miad));
}

/**
 * Bir okutma için depodan BİR adet ayırır.
 *
 * @param stock Depodaki uygun kalemler.
 * @param picked Şu ana kadar bu ekranda ayrılmış adetler (belge kimliği → adet).
 * @param identity Okutulan barkodun kimliği.
 * @returns Ayrılacak belgenin kimliği; depoda kalan yoksa `null`.
 */
export function pickOneUnit(
  stock: StockLike[],
  picked: Map<string, number>,
  identity: ScanIdentity,
): string | null {
  const wantedLot = (identity.lotNumarasi || '').trim();

  const candidates = stock.filter(item => {
    if ((item.stokKodu || '') !== identity.stokKodu) return false;
    /**
     * Seri numaralı kalemler BU YOLA GİRMEZ. Onların kendi eşleşmesi var ve
     * bir seri belgesini adet mantığıyla bölmek stoğu bozardı.
     */
    if ((item.seriNumarasi || '').trim()) return false;
    // Barkodda lot varsa yalnızca o lot; yoksa ürünün tüm lotları uygundur.
    if (wantedLot && (item.lotNumarasi || '').trim() !== wantedLot) return false;
    return getStockItemQuantity(item) - (picked.get(item.id) ?? 0) > 0;
  });

  if (candidates.length === 0) return null;

  // FEFO: miadı en yakın kutudan başla.
  return sortByExpiry(candidates)[0].id;
}

/** Ayrılan adetlerin toplamı — ekranda "N adet" göstermek için. */
export function totalPicked(picked: Map<string, number>): number {
  let total = 0;
  picked.forEach(qty => {
    total += qty;
  });
  return total;
}

// ---------------------------------------------------------------------------
// Mal kabul tarafı
// ---------------------------------------------------------------------------

/** Mal kabulde aynı satıra toplanacak kalemin kimliği. */
export type IntakeGroupKey = {
  stokKodu: string;
  lotNumarasi?: string;
  miad?: string;
};

/**
 * Seri numarasız kalemler için satır anahtarı.
 *
 * Aynı ürünün aynı lot ve miadı TEK satırda toplanır; farklı lot ayrı satır
 * olur. Miadın anahtara girmesi şart: aynı lot numarası farklı miatlarla
 * gelebiliyor ve ikisini tek satırda toplamak stok kaydında miadı yanlış
 * yazardı.
 */
export function intakeGroupKey(key: IntakeGroupKey): string {
  return [key.stokKodu, (key.lotNumarasi || '').trim(), (key.miad || '').trim()].join('||');
}

/**
 * Satır listesine seri numarasız bir okutma ekler.
 *
 * Anahtarı tutan satır varsa adedi artırılır, yoksa satır başa eklenir.
 * Yeni nesne döndürülür — React state'i doğrudan değiştirmemek için.
 *
 * @returns Güncel liste ve okutmanın var olan bir satıra mı eklendiği.
 */
export function addQuantityScan<T extends { id: string; adet?: number }>(
  rows: T[],
  key: string,
  keyOf: (row: T) => string,
  createRow: () => T,
): { rows: T[]; merged: boolean } {
  const index = rows.findIndex(row => keyOf(row) === key);

  if (index === -1) return { rows: [createRow(), ...rows], merged: false };

  const next = [...rows];
  next[index] = { ...next[index], adet: (next[index].adet ?? 1) + 1 };
  return { rows: next, merged: true };
}

/**
 * Bir satırın adedini değiştirir; 1'in altına inmez.
 *
 * Sıfıra indirmek yerine satırı silmek gerekir — "0 adet mal kabul edildi"
 * diye bir kayıt anlamsız ve yazma katmanı da `Math.max(1, …)` uyguluyor.
 */
export function adjustQuantity<T extends { id: string; adet?: number }>(
  rows: T[],
  id: string,
  delta: number,
): T[] {
  return rows.map(row =>
    row.id === id ? { ...row, adet: Math.max(1, (row.adet ?? 1) + delta) } : row,
  );
}
