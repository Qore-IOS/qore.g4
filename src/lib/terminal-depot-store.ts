/**
 * @fileoverview Seçili deponun PAYLAŞILAN kutusu.
 *
 * React'ten ayrı bir modül olmasının iki sebebi var:
 *
 *  1. Tek doğru kaynak. Değer bileşen state'inde tutulduğunda her kullanan
 *     kendi kopyasını taşır ve kopyalar birbirinden habersiz ayrışır.
 *  2. Test edilebilirlik. Depo bu davranışı saf mantık testleriyle doğruluyor;
 *     bir hook'u test etmek için DOM altyapısı kurmak gerekirdi.
 *
 * DÜZELTTİĞİ ARIZA
 *
 * Ana ekranda depo seçiliyor, `TerminalPrefetchProvider`'ın ayrı kopyası bunu
 * duymuyordu. Önyükleme depoya bağlı koleksiyonları (`depoStok`, `orders`)
 * yalnızca depo seçiliyse dinlediği için o oturumda depo stoğu HİÇ İNMİYORDU:
 * transfer ekranı "Depo stoğu yükleniyor" uyarısında takılıyor, okutulan her
 * ürün "bu depoda değil" cevabı alıyordu. Uygulama kapatılıp açılınca
 * düzeliyordu (sağlayıcı localStorage'ı okuyordu), seçimin yapıldığı oturumda
 * düzelmiyordu.
 */

export const DEPOT_STORAGE_PREFIX = 'qore.terminal.depotId';

type Listener = (depotId: string) => void;

const values = new Map<string, string>();
const listeners = new Map<string, Set<Listener>>();

/** Şirkete göre ayrı anahtar: farklı kiracı, farklı depo hafızası. */
export function depotStorageKey(companyId: string | null | undefined): string {
  return `${DEPOT_STORAGE_PREFIX}.${companyId || 'nc'}`;
}

/** Kutuda değer var mı? (Yoksa çağıran taraf kalıcı depodan yükler.) */
export function hasDepot(storageKey: string): boolean {
  return values.has(storageKey);
}

/** Kutudaki değer — hiç yazılmadıysa boş dize. */
export function getDepot(storageKey: string): string {
  return values.get(storageKey) ?? '';
}

/** Değeri yazar ve TÜM abonelere bildirir. */
export function setDepot(storageKey: string, depotId: string): void {
  values.set(storageKey, depotId);
  listeners.get(storageKey)?.forEach(listener => listener(depotId));
}

/**
 * Değişikliklere abone olur.
 *
 * @returns Aboneliği sonlandıran fonksiyon.
 */
export function subscribeToDepot(storageKey: string, listener: Listener): () => void {
  if (!listeners.has(storageKey)) listeners.set(storageKey, new Set());
  const set = listeners.get(storageKey)!;
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/** Testler için: kutuyu sıfırlar. Üretim kodunda kullanılmaz. */
export function resetDepotStoreForTests(): void {
  values.clear();
  listeners.clear();
}
