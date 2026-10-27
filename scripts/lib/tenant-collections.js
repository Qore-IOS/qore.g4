/**
 * Kiracı (multi-tenancy) araçlarının ortak koleksiyon bilgisi.
 *
 * NEDEN AYRI DOSYA: `audit-collections.js` ve `backfill-company-id.js` aynı iki
 * soruyu cevaplamak zorunda — "hangi koleksiyonlar var?" ve "hangileri şirkete
 * etiketlenmemeli?". Bunlar iki script'te ayrı ayrı durursa kaçınılmaz olarak
 * birbirinden ayrışır: audit "şurada 900 etiketsiz kayıt var" der, backfill o
 * koleksiyonu hiç tanımaz. Tek kaynak bunu imkânsız kılar.
 */

/**
 * ŞİRKETE ETİKETLENMEMESİ GEREKEN koleksiyonlar.
 *
 * `def_*` tanım koleksiyonları kasıtlı olarak ORTAKTIR: kuralları
 * `isSignedIn()` (şirket filtresi yok) ve istemci tarafında
 * `GLOBAL_DEFINITION_COLLECTIONS` (src/lib/document-helpers.ts) üzerinden
 * şirketten bağımsız sorgulanırlar. Bunlara companyId yazmak bugün etkisiz,
 * yarın biri kuralı sıkılaştırırsa markaların/grupların tek şirkete hapsolması
 * demek.
 *
 * `companies` kiracı kütüğünün kendisi — bir şirket kaydının companyId'si olmaz.
 *
 * Bu koleksiyonlardaki "companyId yok" durumu bir EKSİK DEĞİL, tasarım.
 */
const NEVER_SCOPE = new Set([
  'def_brands',
  'def_labGroups',
  'def_testGroups',
  'def_deviceGroups',
  'def_productGroups',
  'def_mainUnits',
  'companies',
]);

/**
 * Kök koleksiyonları çalışma anında keşfeder.
 *
 * Bu araçlar eskiden elle bakımı yapılan ~30 koleksiyonluk sabit listeler
 * taşıyordu; oysa kurallarda 151 kök koleksiyon tanımlı. Yani 121 koleksiyon
 * sessizce taranmıyordu ve audit "temiz" diyebiliyordu — sorulan sorunun
 * ("companyId'si olmayan hangi koleksiyonlar var?") tam tersi bir cevap.
 *
 * `listCollections()` en az bir belgesi olan tüm kök koleksiyonları döndürür;
 * boş koleksiyonda denetlenecek/düzeltilecek bir şey zaten yoktur.
 */
async function discoverCollections(db) {
  const cols = await db.listCollections();
  return cols.map((c) => c.id).sort();
}

module.exports = { NEVER_SCOPE, discoverCollections };
