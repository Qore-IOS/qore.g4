/**
 * @fileoverview depoStok önbellek anahtarlarının MALİYET sınıflandırması.
 *
 * NEDEN AYRI BİR MODÜL: burada verilen karar doğrudan Firestore faturasına
 * yazılıyor (aşağıya bakın), bu yüzden React'ten bağımsız ve test edilebilir
 * olmalı. `useStockUpdateListener` bu yardımcıları kullanır.
 *
 * ARKA PLAN — üretimde günlük kotayı tüketen okuma patlaması:
 *
 * Stok metadata belgesi her değiştiğinde (yani her düşüm/transfer/mal kabulde)
 * açık olan HER sekmede `invalidateQueries({ queryKey: ['depoStok'] })`
 * çalışıyordu. React Query'de anahtar eşleşmesi ÖN EK bazlıdır ve varsayılan
 * `refetchType: 'active'` ekrandaki sorguları ANINDA yeniden çalıştırır.
 * Dolayısıyla tek bir yazma, koleksiyonun tamamını okuyan sorguları bile
 * (ör. `['depoStok','forOrders']`) tüm sekmelerde yeniden tetikliyordu:
 *
 *     okuma ≈ (yazma) × (açık sekme) × (depoStok belge sayısı)
 *
 * Faturada bir saatte 190 yazmaya karşılık 4,2 milyon okuma olarak göründü.
 *
 * Sınıflandırma bu çarpanı kırar: ucuz (depo/lab filtreli) sorgular anında
 * yenilenir, pahalı (koleksiyon geneli) sorgular seyrek yenilenir.
 */

/**
 * Koleksiyonun TAMAMINI okuyan depoStok sorgularının ikinci anahtar parçaları.
 *
 * Firestore okumayı BELGE BAŞINA faturalar; `.select()` ile alan sayısını
 * kısmak bant genişliğini azaltır, okuma SAYISINI azaltmaz. Bu yüzden bu
 * sorguların her yenilenişi koleksiyon boyutu kadar okumadır.
 *
 * Yeni bir koleksiyon geneli depoStok sorgusu eklenirse anahtarı BURAYA da
 * eklenmelidir; aksi hâlde sessizce "ucuz" sayılır ve patlama geri gelir.
 */
export const WHOLE_COLLECTION_DEPOSTOK_KEYS: ReadonlySet<string> = new Set([
  'all',          // useDepoStok
  'active',       // useActiveDepoStok
  'shipped-all',  // useShippedDepoStok
  'forOrders',    // useDepoStokForOrders — Siparişler panelinde canlı kullanılıyor
]);

/** Anahtar depoStok önbelleğine mi ait? (sayfalı sürüm dâhil) */
export function isDepoStokKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'depoStok' || queryKey[0] === 'depoStokPaginated';
}

/**
 * Anahtar koleksiyonun tamamını okuyan pahalı sorgulardan biri mi?
 *
 * DİKKAT: `['depoStok','shipped', ...]` (useLabStock) lab filtrelidir ve
 * PAHALI DEĞİLDİR. Koleksiyon geneli eşdeğeri bilerek `'shipped-all'` diye
 * adlandırıldı — ikisi aynı ikinci parçayı paylaşırken ön ek eşleşmesi
 * ucuz sorguyla pahalı sorguyu birlikte yeniliyordu.
 */
export function isWholeCollectionDepoStokKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'depoStok'
    && typeof queryKey[1] === 'string'
    && WHOLE_COLLECTION_DEPOSTOK_KEYS.has(queryKey[1]);
}
