# Miad tek kaynağa geçiş — yayılım haritası

> Yeniden yazım programı, Faz 0 · madde 1.
> Ölçüm aracı: `npm run audit:miad` · Mandal: `npm run check:miad`

## Neden bu doküman

`depoStok.miad` sisteme birden çok kaynaktan, birden çok biçimde giriyor:

| Kaynak | Biçim |
|---|---|
| Mal kabul (`mal-kabul/write.ts` → `normalizeMiad`) | `dd.MM.yyyy` **metin** |
| Ceomed senkronu | API'nin ham `MIYAT` alanı (ISO veya gün/ay/yıl) |
| Elle girilen eski kayıtlar | yalnızca `MM.yyyy` |
| Bazı türetilmiş koleksiyonlar | Firestore `Timestamp` |

Kod tabanında bu değeri tarihe çeviren **en az yedi ayrı uygulama** var ve her
biri farklı bir biçim alt kümesini destekliyor. Sonuç: aynı lot, açtığınız
ekrana göre farklı miad durumu gösterebiliyor — birinde "3 ay kaldı", ötekinde
"miad yok".

Ayrıca ikinci bir hata sınıfı var: `new Date("01.02.2027")` V8'de ABD kuralıyla
**2 Ocak 2027** döner (doğrusu 1 Şubat). Miad metni tam olarak bu biçimde
saklandığı için, ham `new Date()` ile çözülen her miadın günü 12'den küçükse ayı
ile günü yer değiştirir.

## Ölçüm — 18.08.2026

```
32 dosya miadı TARİHE ÇEVİRİYOR · 19 dosyada 38 riskli nokta
99 dosya miadı yalnızca taşıyor/gösteriyor — risk taşımıyor
```

| Sınıf | Sayı | Anlamı |
|---|---:|---|
| Ham `new Date(miad)` | 0 | Gün/ay takası. **Kapatıldı.** |
| Yerel ayrıştırıcı | 20 | Dosya kendi çözümünü yazmış; biçim alt kümesi farklı. |
| Tek biçime sabitlenmiş | 18 | `parse(x,'dd.MM.yyyy')` — başka biçimde sessizce `Invalid Date`. |
| Paylaşılan yardımcı (`@/lib/date`) | 16 | `dd.MM.yyyy` + ISO doğru; `MM.yyyy` çözülemez. |
| **Tek kaynak (`lojistik/miad`)** | 4 | Bilinen tüm biçimleri çözer. **Hedef durum.** |

Önemli düzeltme: ilk tahmin "122 dosya bozuk" idi. Gerçek sayı **19 dosyada 38
nokta**. Kalan 99 dosya miadı yalnızca taşıyor veya gösteriyor; yeniden yazım
kapsamına girmiyorlar.

## Bu turda kapatılanlar

### 1. AI miad takibi her zaman "yaklaşan miad yok" diyordu — CANLI

`src/lib/ai/smartQueryEngine.ts` · `fetchExpiringStockEnhanced`

İki hata birbirini besliyordu:

```js
.where('miad', '<=', expiryDate)   // expiryDate: Date — miad: metin
```

Firestore değerleri önce **türe** göre sıralar; zaman damgaları metinlerden önce
gelir. Bir `Date` ile yapılan `<=` karşılaştırması metin değerli hiçbir belgeyle
eşleşmez. Sorgu her çalıştığında **sıfır belge** dönüyordu.

```js
const miadDate = data.miad?.toDate?.() || data.miad;   // metinde → metnin kendisi
const daysUntilExpiry = ... miadDate.getTime() ...     // TypeError
```

Belge dönseydi bile bir satır sonra `TypeError` fırlayacaktı.

`miad_takibi`, `/miad/i` ile tetiklenen adlandırılmış bir AI yeteneği. Tıbbi
tedarik sisteminde "yaklaşan miad" sorusuna **her zaman boş cevap** veriyordu.

**Çözüm:** `miad` metin saklandığı için Firestore tarafında aralık filtresi
kurulamaz (leksikografik sıra da anlamsız: `"01.02.2028" < "31.12.2026"`). Eleme
alan projeksiyonlu bir okumanın ardından bellekte, `parseMiad` ile yapılıyor.
Tavana ulaşılırsa sonuç `kismi: true` ile işaretleniyor — modelin eksik veriyi
tam sanması, düzeltilen asıl hatanın tekrarı olurdu.

### 2. Model bağlamına karışık tip gidiyordu

Aynı dosyada iki nokta `data.miad?.toDate?.() || data.miad` yazıyordu:
Timestamp'lerde `Date`, metinlerde ham metin. Model aynı listede iki farklı tip
görüyor ve tarihleri güvenilir karşılaştıramıyordu. İkisi de tek ve tutarlı
`dd.MM.yyyy` biçimine bağlandı.

### 3. `dataFetcher.ts` — aynı hatalar, **ölü kodda**

`src/lib/ai/dataFetcher.ts` içindeki `timestampToString` metin miadda
`TypeError: ts.toDate is not a function` fırlatıyordu; ayrıca `toISOString()`
kullandığı için UTC+3'te tarihler bir gün geriye düşüyordu.

Erişilebilirlik izi:

```
AIChatbot.tsx / api/ai/chat/route.ts → chat.ts → smartQueryEngine.ts   ← CANLI
                                        dataFetcher.ts ← yalnız ai/index.ts
                                        ai/index.ts    ← hiçbir yer
```

`dataFetcher.ts` ve `ai/index.ts` dışarıdan hiç import edilmiyor (dinamik import
da yok). Hatalar yine de düzeltildi — küçük ve doğru — ama **asıl aksiyon
silmektir**. Faz 0 envanterinin ilk somut adayı.

## Kalan 38 noktanın geçiş sırası

Faz 1'de `domain/miad` tek kaynağına bağlanacaklar. Sıra, dilim sırasıyla
hizalı:

| Öncelik | Dosya | Nokta | Not |
|---:|---|---:|---|
| 1 | `src/actions/stokActions.ts` | 5 | Sunucu tarafı; birçok panelin ortak zemini |
| 2 | `src/lib/mal-kabul/validation.ts` | 4 | Ay/yıl miadı **ayın ilk günü** sayıyor — miad ay sonunda dolar, yanlış tarafa düşüyor |
| 3 | `src/components/stok-yonetimi-panel.tsx` | 3 | Dilim 02 |
| 4 | `src/app/(protected)/siparisler/[orderId]/toplama/page.tsx` | 2 | Dilim 03; FEFO sıralaması |
| 5 | `src/lib/siparisler/write.ts` | 2 | Dilim 03; yazma yolu |
| 6 | `src/lib/sarf-transfer.ts` | 2 | Dilim 03 |
| 7 | `src/app/(protected)/laboratuvar/sayim/[labId]/page.tsx` | 2 | Dilim 04 |
| 8 | `src/components/hastane-yonetimi-panel.tsx` | 2 | Dilim 04 |
| 9 | `src/components/lab/ClayLaboratoryManagementView.tsx` | 2 | Dilim 04 |
| 10 | `src/components/maliyet-sayim-panel.tsx` | 2 | Miadı bir yerde `.`, bir yerde `-` ayraçlı sayıyor |
| 11 | `src/services/searchService.ts` + `src/actions/searchActions.ts` | 2 | Aynı `normDate` iki kez kopyalanmış |
| 12 | `src/components/urun-kullanim-panel.tsx` | 1 | Dilim 04 |
| 13 | `src/components/dashboard-panel.tsx` | 1 | |
| 14 | `src/components/LojistikSiparisView.tsx` | 1 | Dilim 13 |
| 15 | `src/app/(protected)/siparisler/[orderId]/perifer/page.tsx` | 1 | Dilim 03 |
| 16 | `src/app/api/ai/irsaliye-scan/route.ts` | 1 | Kendi `normalizeMiad`'ı |
| 17 | `src/components/kullanim-dogrulama-panel.tsx` | 1 | |
| 18 | `src/app/api/urun-talep/depo-auto-fill/route.ts` | 1 | Yedinci ayrıştırıcı; `dd.MM.yyyy` doğru ama `MM.yyyy` çözemiyor |

## Mandal

`npm run check:miad` riskli nokta sayısını **38** tavanında tutar ve `npm run
build` zincirine bağlıdır. Sayı artarsa derleme kırılır; her geçiş turunda tavan
düşürülür.

Statik tarama değişken tipini bilemez. Elle doğrulanmış güvenli noktalar
**gerekçeyle** muaf tutulabilir:

```ts
// audit-miad: guvenli — `expiryDate` zaten `Date`; bu bir kopya, metin ayrıştırma değil.
const expiry = new Date(expiryDate);
```

Gerekçe zorunludur — gerekçesiz muafiyet, sessizce biriken borçtur.

## Kapsam dışı bırakılan bulgu

`src/lib/ai/dataFetcher.ts` ve `src/lib/ai/smartQueryEngine.ts` Firestore'a
**şirket kapsamı olmadan** erişiyor (`scopedQuery` / `matchesScopedQueryCompany`
yok). Çok kiracılı kurulumda AI yolunun başka şirketlerin verisini
görebileceği anlamına gelir. Bu bir miad sorunu değil; AI yolunun yalnızca
SuperAdmin'e mi açık olduğu kararına bağlı olduğu için ayrı ele alınmalı.
