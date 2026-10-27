/**
 * Firestore `in` / `array-contains-any` sorgu sınırı ve parti bölme.
 *
 * Firestore bu operatörlerde tek seferde en fazla 30 değer kabul eder. Kod
 * tabanında bu sınır uzun süre `values.slice(0, 30)` ile "çözülmüştü": 30'dan
 * çok üyeli bir laboratuvar havuzunda kalan üyelerin stoğu SESSİZCE hiç
 * okunmuyor, panel eksik stok gösteriyordu. Doğru davranış listeyi partilere
 * bölüp hepsini okumaktır.
 *
 * Firestore SDK'sına bağımlı değildir; testlerde doğrudan kullanılabilir.
 */

export const FIRESTORE_IN_LIMIT = 30;

/**
 * Değerleri tekilleştirip `in` sorgusuna uygun partilere böler.
 *
 * Boş/undefined değerler ayıklanır (Firestore bunları reddeder) ve boş girdi
 * boş dizi döndürür — çağıran taraf sorguyu hiç kurmadan çıkabilir. Bu, boş
 * dizi ile `where(field, 'in', [])` çağrılıp hata fırlatılmasını önler.
 */
export function chunkForIn<T>(values: T[], size = FIRESTORE_IN_LIMIT): T[][] {
  if (size < 1) throw new RangeError('Parti boyu en az 1 olmalıdır.');
  const unique = Array.from(new Set(values.filter(Boolean)));
  const out: T[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}
