/**
 * Stok okuma — tek kaynak (single source of truth).
 *
 * Depo ve laboratuvar stoğu, panellerin her birinde ayrı ayrı yazılmış
 * `query(collection(db,'depoStok'), …)` çağrılarıyla okunuyordu. Bu çağrılar
 * birbirinden üç noktada ayrışıyordu ve stok tutarsızlığının ana kaynağıydı:
 *
 *  1. **Şirket kapsamı**: bazıları `scopedQuery` kullanıyor, bazıları ham
 *     `collection(db,'depoStok')` okuyup sonucu istemcide süzüyordu.
 *  2. **`in` sınırı**: Firestore `in` sorgusu 30 değerle sınırlıdır. Havuz
 *     üyeleri `slice(0, 30)` ile SESSİZCE kırpılıyordu; 30'dan çok üyeli bir
 *     havuzda kalan laboratuvarların stoğu hiç okunmuyordu.
 *  3. **"Depoda mevcut" tanımı**: kimi sorgu `where('isShipped','==',false)`
 *     kullanıyor, bu da alanı hiç taşımayan ESKİ kayıtları dışarıda bırakıyordu;
 *     kimi kod ise `isShipped !== true` (isAvailableDepotStock) diyordu.
 *
 * Bu modül üçünü de tek bir davranışta toplar ve tüm paneller/hook'lar bunu
 * kullanır.
 */
import {
  collection,
  getDocs,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { scopedQuery } from '@/lib/firestore-helpers';
import { chunkForIn } from '@/lib/firestore-chunk';
import { filterByCompanyScope } from '@/lib/company-scope';
import { getStockItemQuantity, isAvailableDepotStock } from '@/lib/stock-quantity';
import type { DepoStokItem } from '@/lib/types';

export const DEPO_STOK_COLLECTION = 'depoStok';

export { chunkForIn, FIRESTORE_IN_LIMIT } from '@/lib/firestore-chunk';

export interface StockScope {
  companyId: string | null | undefined;
  isSuperAdmin?: boolean;
}

type TimestampNormalizer = (data: DocumentData) => DocumentData;

const identity: TimestampNormalizer = data => data;

function mapDocs(
  docs: QueryDocumentSnapshot<DocumentData>[],
  normalize: TimestampNormalizer,
): DepoStokItem[] {
  return docs.map(d => ({ id: d.id, ...normalize(d.data()) } as DepoStokItem));
}

/**
 * Aynı sorguyu 30'luk partiler hâlinde çalıştırıp sonuçları belge kimliğine
 * göre tekilleştirir. Hiçbir üye sessizce kırpılmaz.
 */
async function runChunkedQuery(
  scope: StockScope,
  field: string,
  values: string[],
  extra: QueryConstraint[],
  normalize: TimestampNormalizer,
): Promise<DepoStokItem[]> {
  const chunks = chunkForIn(values);
  if (chunks.length === 0) return [];
  const results = await Promise.all(
    chunks.map(async part => {
      const snap = await getDocs(
        scopedQuery(DEPO_STOK_COLLECTION, scope.companyId, scope.isSuperAdmin, where(field, 'in', part), ...extra),
      );
      return mapDocs(snap.docs, normalize);
    }),
  );
  return results.flat();
}

export interface LabStockQuery extends StockScope {
  /** Havuz üyeleri dâhil, stoğu okunacak laboratuvar kimlikleri. */
  labIds: string[];
  /**
   * Aynı laboratuvarların adları. `hedefKurumId` alanını taşımayan ESKİ
   * kayıtları da toplamak için kullanılır.
   */
  labNames?: string[];
  /** Belirli bir ürün koduyla daraltma (tek ürün doğrulaması için). */
  stokKodu?: string;
  /** Firestore zaman damgalarını istemci tipine çeviren dönüştürücü. */
  normalizeTimestamps?: TimestampNormalizer;
}

/**
 * Bir laboratuvarın (veya havuzun tamamının) stoğunu okur.
 *
 * `isShipped == true` olan depoStok belgeleri, transferle laboratuvara geçmiş
 * birimlerdir; laboratuvar stoğu tanım gereği budur.
 */
export async function fetchLabStock(params: LabStockQuery): Promise<DepoStokItem[]> {
  const { labIds, labNames = [], stokKodu, companyId, isSuperAdmin } = params;
  const normalize = params.normalizeTimestamps ?? identity;
  const scope: StockScope = { companyId, isSuperAdmin };

  if (labIds.length === 0 && labNames.length === 0) return [];

  const extra: QueryConstraint[] = [where('isShipped', '==', true)];
  if (stokKodu) extra.push(where('stokKodu', '==', stokKodu));

  const [byId, byName] = await Promise.all([
    runChunkedQuery(scope, 'hedefKurumId', labIds, extra, normalize),
    // Eski kayıt telafisi: `hedefKurumId` yazılmadan önce yalnızca kurum adı
    // tutuluyordu. Ad üzerinden okuma bu kayıtları da stoğa dâhil eder.
    runChunkedQuery(scope, 'hedefKurum', labNames, extra, normalize),
  ]);

  const merged = new Map<string, DepoStokItem>();
  byId.forEach(item => merged.set(item.id, item));
  byName.forEach(item => { if (!merged.has(item.id)) merged.set(item.id, item); });

  return filterByCompanyScope(
    Array.from(merged.values()).filter(item => getStockItemQuantity(item) > 0),
    companyId,
    isSuperAdmin,
  );
}

export interface DepotStockQuery extends StockScope {
  depotId: string;
  stokKodu?: string;
  normalizeTimestamps?: TimestampNormalizer;
}

/**
 * Bir deponun fiilen elindeki stoğu okur.
 *
 * `isShipped` alanı Firestore sorgusunda KULLANILMAZ: `where('isShipped','==',false)`
 * alanı hiç taşımayan eski belgeleri dışarıda bırakır ve deponun stoğu olduğundan
 * az görünür. Bunun yerine `isAvailableDepotStock` ile istemcide süzülür — kodun
 * her yerinde "sevk edilmiş sayılmak için alanın açıkça `true` olması gerekir"
 * kuralı geçerlidir.
 */
export async function fetchDepotStock(params: DepotStockQuery): Promise<DepoStokItem[]> {
  const { depotId, stokKodu, companyId, isSuperAdmin } = params;
  const normalize = params.normalizeTimestamps ?? identity;
  if (!depotId) return [];

  const extra: QueryConstraint[] = [where('depotId', '==', depotId)];
  if (stokKodu) extra.push(where('stokKodu', '==', stokKodu));

  const snap = await getDocs(scopedQuery(DEPO_STOK_COLLECTION, companyId, isSuperAdmin, ...extra));
  const items = mapDocs(snap.docs, normalize).filter(
    item => isAvailableDepotStock(item) && getStockItemQuantity(item) > 0,
  );
  return filterByCompanyScope(items, companyId, isSuperAdmin);
}

/**
 * Seri numarasına göre tek bir laboratuvar stok satırı bulur.
 *
 * Ürün kullanım panelinin "önbellekte yok, Firestore'dan doğrula" yolu bunu
 * kullanır; böylece doğrulama ile listeleme aynı sorguyu paylaşır ve ikisi
 * farklı sonuç veremez.
 */
export async function findLabStockBySerial(
  params: LabStockQuery & { seriNumarasi: string },
): Promise<DepoStokItem | null> {
  const { seriNumarasi } = params;
  if (!seriNumarasi) return null;
  const rows = await fetchLabStock(params);
  return rows.find(item => (item.seriNumarasi || '') === seriNumarasi) ?? null;
}

/** Belirli bir depoda, bir ürün kodu için hâlihazırda duran seri numaraları. */
export async function fetchDepotSerials(
  params: DepotStockQuery,
): Promise<Set<string>> {
  const rows = await fetchDepotStock(params);
  const serials = new Set<string>();
  rows.forEach(row => {
    const serial = (row.seriNumarasi || '').trim();
    if (serial) serials.add(serial);
  });
  return serials;
}

/**
 * `depoStok` koleksiyonuna ham erişim gerektiğinde şirket kapsamını korumak
 * için kullanılacak sorgu kurucusu. Paneller doğrudan
 * `collection(db,'depoStok')` çağırmamalıdır.
 */
export function depoStokQuery(scope: StockScope, ...constraints: QueryConstraint[]) {
  return scopedQuery(DEPO_STOK_COLLECTION, scope.companyId, scope.isSuperAdmin, ...constraints);
}

/** Ham koleksiyon referansı — yalnızca belge kimliğiyle tekil erişim içindir. */
export const depoStokCollection = () => collection(db, DEPO_STOK_COLLECTION);
