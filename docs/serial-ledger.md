# Seri No Defteri (`serialLedger`) ve stok akışı

Bu belge, seri numarası takipli ürünlerde yaşanan stok tutarsızlığının kök
nedenlerini, uygulanan çözümü ve devreye alma adımlarını anlatır.

## 1. Sorun

Beklenen akış basit:

```
mal kabul (depo)  →  transfer / sipariş karşılama (laboratuvar)  →  tüketim
                                    ↑
                  depo sayımı: birim bulunamazsa stoktan düşülür
                  ve AYNI seri numarası yeniden işlem görebilmelidir
```

Pratikte şu oluyordu:

- Depo sayımıyla düşülen bir seri numarası bir daha **hiç** mal kabul
  edilemiyordu.
- Bu yüzden geçmiş-seri kontrolü (`BLOCK_PREVIOUSLY_PROCESSED_SERIALS`)
  kapatılmak zorunda kalındı; bu da depoda **mükerrer seri numarasına** yol açtı
  ve stok yönetimine "mükerrer kayıt temizleme" aracı eklemek gerekti.
- Havuza dâhil bir laboratuvar seçildiğinde ürün kullanım panelinde havuz stoğu
  hiç yüklenmiyor, "yükleniyor" ekranında kalıyordu.

### Kök neden 1 — `serialHistory` için güvenlik kuralı yoktu

`firestore.rules` içinde `serialHistory` için hiçbir `match` bloğu yoktu.
Firestore tanımlanmamış koleksiyonları varsayılan olarak reddeder. Yani mal
kabul, transfer, sipariş toplama, tüketim ve **özellikle depo sayımının**
yazmaya çalıştığı `sayimdan_dusum` olayı hiçbir zaman kaydedilemedi.

Zincirin sonucu: "bu seri depodan çıktı" bilgisi hiç oluşmadı → mal kabul o
seriyi kalıcı olarak reddetti → kontrol kapatıldı → mükerrer seri.

### Kök neden 2 — `serialHistory` yanlış anahtarlanmıştı

Belge kimliği yalnızca **seri numarasıydı** (`serialHistory/{seriNo}/events`).
Aynı seri numarası farklı ürün kodlarında da geçebildiği için iki ayrı fiziksel
ürün aynı satırda birleşiyordu. Ayrıca `companyId` taşımıyordu; kiracı bazında
sorgulanamıyor, kapsanamıyordu.

### Kök neden 3 — havuz stoğu sorgusu canlı okumayı blokluyordu

`useLabStock` içindeki canlı stok sorgusu, `getRecoverableTransferredLabStock`
adlı ağır bir sunucu eylemini **bekliyordu**. Bu eylem havuzun tüm
transferlerini ve her transferin `items` alt-koleksiyonunu tarayıp Firestore'a
geri yazma yapıyor. Tek laboratuvarlı seçimde ucuz, havuzda saniyeler sürüyor;
sorgu zaman aşımına uğrayıp yeniden deneniyor ve `isLoading` hiç `false`
olmuyordu.

### Kök neden 4 — paneller ortak stok sorgusu kullanmıyordu

Aynı soruyu (bir laboratuvarın stoğu nedir?) soran kodlar üç noktada
ayrışıyordu:

| Fark | Sonuç |
|---|---|
| Kimi `scopedQuery` kullanıyor, kimi ham `collection(db,'depoStok')` okuyup istemcide süzüyordu | Şirket kapsamı tutarsız |
| Havuz üyeleri `slice(0, 30)` ile kırpılıyordu (Firestore `in` sınırı) | 30'dan çok üyeli havuzda kalan laboratuvarların stoğu **hiç okunmuyordu** |
| Kimi `where('isShipped','==',false)`, kimi `isShipped !== true` diyordu | Alanı taşımayan **eski kayıtlar** kimi ekranda görünüp kimi ekranda görünmüyordu |

Ürün kullanım panelinin "önbellekte yok, Firestore'dan doğrula" yolu ham sorgu
kullandığı için, liste stoğu gösterirken doğrulama "stokta yok" diyebiliyordu.

## 2. Çözüm

### 2.1 `serialLedger` — birim başına tek satır

`ürün kodu + seri no` çifti başına **tek** defter satırı:

```
serialLedger/{sl_<companyId>__<stokKodu>__<seriNumarasi>}
  ├─ companyId, stokKodu, stokAdi, seriNumarasi, lotNumarasi, miad
  ├─ status         → depoda | laboratuvarda | borcta | tuketildi | imha_edildi | serbest
  ├─ locationType   → depot | lab | borc | none
  ├─ locationId, locationName
  ├─ lastEventType, lastEventAt, eventCount
  └─ events/{eventId}   (değiştirilemez: bir kez yazılır, güncellenmez, silinmez)
       type, from*, to*, refs{transferId,orderId,consumptionId,…}, actor*, details, timestamp
```

Olay sözlüğü (tek, ortak):

`mal_kabul` · `transfer` · `siparis_karsilama` · `lab_transfer` · `tuketim` ·
`imha` · `borc` · `iade` · `sayim_dusum` · `duzeltme`

**Kritik kural:** `sayim_dusum` → `status = 'serbest'`. Serbest bir birim TÜM
işlemleri yeniden görebilir (mal kabul → transfer → tüketim). Yönetici stok
düzeltmesiyle silinen birimler de `duzeltme` + `serbest` olarak işlenir.

Saf mantık `src/lib/serial-ledger/core.ts` içindedir (Firestore'a bağımlı
değildir, testlidir); Firestore yazımları `src/lib/serial-ledger/client.ts`
üzerinden yapılır. **Hiçbir panel doğrudan `serialLedger` koleksiyonuna
yazmamalıdır.**

### 2.2 Hangi panel ne yazar

| Panel / akış | Olay |
|---|---|
| Mal Kabul (manuel + Oto Kabul) | `mal_kabul` |
| Direkt Transfer | `transfer` (borç modunda `borc`) |
| Sipariş Toplama | `siparis_karsilama` |
| Laboratuvar Sayımı otomatik transferi | `transfer` / `lab_transfer` |
| Ürün Kullanım (barkod, manuel, listeli düşüm) | `tuketim` |
| İmha Edilen Kitler | `imha` |
| Depo Sayımı | `sayim_dusum` → **serbest** |
| Stok Yönetimi adet düzeltmesi (azaltma) | `duzeltme` → **serbest** |

Hedefte tüketim takibi kapalı laboratuvarlarda transfer, aynı anda `tuketim`
olayı da yazar.

#### Yazım stratejisi: atomiklik ve 500 işlem sınırı

- **Tekil işlemler** (tüketim, depo sayımı, mal kabul): defter yazımı stok
  yazımıyla **aynı** batch'tedir. Stok değişip defterin değişmemesi mümkün
  değildir.
- **Toplu işlemler** (direkt transfer, sipariş toplama, imha, listeli düşüm):
  bir işlem yüzlerce kalem içerebilir ve tek `writeBatch` Firestore'un 500
  işlem sınırına takılır. Bu akışlarda stok yazımının mevcut atomikliği
  korunur; defter olayları stok yazımı **başarılı olduktan sonra** 150'lik
  partiler hâlinde yazılır. Defter türetilmiş bir dizin olduğu için, bu adım
  başarısız olursa aşağıdaki doldurma aracıyla her zaman yeniden kurulabilir.

### 2.3 Ortak stok sorgusu

`src/lib/stock-source.ts`:

- `fetchLabStock({ labIds, labNames, stokKodu, companyId, isSuperAdmin })`
- `fetchDepotStock({ depotId, … })`

Üç ayrışmayı da kapatır: `scopedQuery` ile şirket kapsamı, 30'luk **partiler**
(kırpma yok), ve `isAvailableDepotStock` semantiği (`isShipped` alanını hiç
taşımayan eski kayıtlar mevcut sayılır). `useLabStock` hook'u ve ürün kullanım
panelinin Firestore doğrulaması artık aynı fonksiyonu çağırır.

### 2.4 Havuz stoğu yükleme

`getRecoverableTransferredLabStock` canlı stok sorgusundan çıkarıldı. Artık
bağımsız bir sorgu olarak, yalnızca canlı okuma **tamamlandıktan sonra**
çalışır. Panelin hazır-olma göstergesi sadece canlı okumaya bakar; onarım arka
planda sürerken stok görüntülenir ve tüketim yapılabilir. Canlı okuma kalıcı
olarak başarısız olursa panel "yükleniyor"da asılı kalmaz, hata bildirilir.

## 3. Devreye alma

1. **Kuralları ve indeksleri yayınlayın** (bu adım olmadan defter yazılamaz):
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   Bileşik indeksler oluşana kadar (birkaç dakika) seri arama sorguları hata
   verebilir.

2. **Defteri doldurun**: Yönetim panelinde **"Seri No Defteri Doldurma"**
   kartı → önce **Önizle** (hiçbir şey yazmaz, sayıları gösterir), sonra
   **Defteri Doldur**.

   Doldurma şu kaynakları tarar: `depoStok`, `transfers/items`,
   `tuketimKayitlari`, `depotBrandCountSessions/items` ve eski `serialHistory`.
   İdempotenttir; tekrar çalıştırmak mükerrer kayıt üretmez ve stok belgelerine
   dokunmaz.

   Geçmişi "stokta" diyen ama artık canlı bir `depoStok` belgesi bulunmayan
   birimler `serbest` işaretlenir — bunlar çoğunlukla `deletedSerials`
   ayrıntısını tutmayan eski depo sayımlarının sildiği birimlerdir.

3. **Doğrulayın**: Arama panelinde bir seri numarası aratın. "Seri No Defteri"
   kartı birimin güncel durumunu, konumunu ve son işlemini gösterir.

Doldurma yapılmadan önce defter boştur ve geçmiş-seri kontrolü hiçbir şeyi
engellemez (güvenli tarafa düşer). Doldurma yapıldıkça kontrol etkinleşir.

## 4. Bilinen sınırlar

- Eski `serialHistory` koleksiyonu geriye dönük uyumluluk için yazılmaya devam
  eder (arama panelinin kayıt kurtarma mantığı onu okur). Kuralı artık tanımlı
  olduğu için yazımlar reddedilmiyor.
- `serialHistory` olaylarının geriye dönük aktarımı `events` koleksiyon-grubu
  sorgusuna dayanır; bu sorgu için indeks yoksa adım sessizce atlanır ve defter
  diğer dört kaynaktan kurulur.
- Adet takipli (seri numarasız) ürünler deftere girmez; defter tanım gereği
  birim-başına-seri kayıtları içindir. `FAZLA-` / `SAYIM-` ön ekli sentetik
  sayım yer tutucuları da dışlanır.
