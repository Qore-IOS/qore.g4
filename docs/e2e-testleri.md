# Uçtan uca testler

> Yeniden yazım programı, Faz 0 · madde 3 — emniyet ağı.

## Neden var

Yeniden yazımdan önce ölçülen durum: **35 test dosyası, 9.506 satır — tamamı
`src/lib/` altındaki saf modüller. UI davranışını koruyan sıfır test.** Bu hâlde
yapılan her panel yeniden yazımı kör uçuştur: panel derlenir, testler yeşil
kalır, kullanıcı ekranı açtığında akış kırıktır.

Bu ağ, dilim dilim yeniden yazım sırasında "davranış korundu mu?" sorusunu
otomatik yanıtlar.

## Nasıl koşar

```bash
npm run test:e2e
```

Zincir:

```
firebase emulators:exec --config firebase.e2e.json --project qore-e2e
  ├─ Firestore (8080) + Auth (9099) emülatörlerini kaldırır
  ├─ FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST'u ortama yazar
  ├─ node tests/e2e/seed.js      → temel veriyi tohumlar
  └─ playwright test
       └─ webServer: next dev    → uygulamayı emülatör bayrağıyla başlatır
```

Emülatör kabuğu dışarıda olduğu için tohumlama, uygulama ve testler **aynı**
emülatöre bakar. Koşu bitince emülatör kapanır ve veri kaybolur.

### Ön koşullar

| Gereksinim | Not |
|---|---|
| Java | Firestore emülatörü için (`java -version`) |
| `firebase-tools` | `devDependencies`'te; `npx firebase` ile çağrılır |
| `@playwright/test` | `devDependencies`'te |
| Tarayıcı | `npx playwright install chromium` (CI'da bu yapılır) |

**Hazır tarayıcı taşıyan ortamlar** (bazı geliştirme/ajan konteynerleri) için
kaçış kapısı vardır — orada `playwright install` çalıştırmak yerine ikiliyi
gösterin:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```

Bu değişken CI'da **tanımsızdır**; orada Playwright kendi sürümüne birebir uyan
tarayıcıyı indirir ve kullanır.

## Üretim verisi güvenliği

Testler gerçek Firebase projesine hiçbir koşulda dokunamaz:

1. `tests/e2e/seed.js`, `FIRESTORE_EMULATOR_HOST` tanımlı değilse **çalışmayı
   reddeder** ve hata fırlatır.
2. `tests/e2e/firestore.ts` aynı kontrolü yapar.
3. İstemci SDK'sı yalnızca `NEXT_PUBLIC_FIREBASE_EMULATOR === '1'` iken
   emülatöre bağlanır; bu değişken `.env` dosyalarında **bulunmaz**, sadece
   `playwright.config.ts` içindeki `webServer.env`'den gelir.
4. Admin SDK, `FIRESTORE_EMULATOR_HOST` varsa kimlik bilgisi olmadan
   `projectId` ile başlatılır — üretim kimlik bilgisiyle asla karışmaz.

## Şirket kapsamı — en kritik ayar

Firestore kuralları `request.auth.token.companyId` ile doküman `companyId`sini
karşılaştırır. Tohumlanan her doküman `E2E_COMPANY_ID` taşır ve kullanıcıya
**aynı** değer özel talep (custom claim) olarak yazılır.

İkisi ayrışırsa uygulama açılır ama her sorgu `permission-denied` alır — ve bu
testte "veri yok" gibi görünür, "yetki hatası" gibi değil. Bu yüzden ikisi tek
yerden (`seed.js`) gelir.

Kurallar emülatörde **gerçekten uygulanır**: `firebase.e2e.json`, kök
`firebase.json` ile aynı `firestore.rules` dosyasını gösterir. Tohumlama Admin
SDK ile kuralları bypass eder; uygulamanın istemci SDK'sıyla okuyabilmesi
kuralların doğru olduğunun kanıtıdır.

## Yapı

```
tests/e2e/
  seed.js          Emülatör tohumlaması + testlerin paylaştığı sabitler
  helpers.ts       girisYap, barkodOkut, panelHazir
  firestore.ts     Admin SDK ile aranjman ve doğrulama
  specs/
    oturum.spec.ts          Duman testi — yığın ayakta mı?
    direkt-transfer.spec.ts Stok yaşam döngüsü (Faz 4 · dilim 01)
```

### Tasarım kuralları

**Aranjman UI'dan yapılmaz.** Bir lotu depoya koymak için mal kabul ekranı
kullanılırsa, transfer testi mal kabul ekranına bağımlı hâle gelir; biri
kırılınca ikisi birden kırmızıya döner ve hata nereden geliyor belli olmaz.
Aranjman ve doğrulama Admin SDK ile yapılır, arada kalan tek şey test edilen
akıştır.

**Doğrulama ekrandan değil veriden yapılır.** Transfer yazımı arka planda
("fire and forget") yürür; ekranda "başarılı" yazması stoğun taşındığı anlamına
gelmez. Testler `expect.poll` ile Firestore belgesinin gerçekten
`isShipped: true` ve `hedefKurumId` almış olmasını bekler.

**Barkod gerçek yoldan okutulur.** Uygulama fiziksel okuyucuyu klavye olayı
olarak dinler (`useHidScanner`). Bir input'a `fill()` yapmak bu kodu hiç
çalıştırmaz ve okutma yolundaki regresyonları kaçırır; `barkodOkut` yardımcısı
karakterleri tuş tuş yazıp Enter'a basar.

**Sabit bekleme yok.** Paneller açılışta "hazırlanıyor" durumunda kalır ve erken
yapılan tıklama sessizce kaybolur (bkz. direkt transfer `transferDataReady`).
Testler gerçek hazır sinyalini bekler, `waitForTimeout` kullanmaz.

## Tuzak: emülatör bağlantısı bir kereden fazla kurulmamalı

Kurulum sırasında yakalanan, teşhisi zor bir hata:

```
FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)
```

Next.js geliştirme sunucusu `src/lib/firebase.ts`'i sıcak yeniden yükleme
sırasında yeniden değerlendirir. `getApps()` koruması uygulamanın yeniden
başlatılmasını önler ama `getFirestore(app)` **aynı örneği** döndürür ve
`connectFirestoreEmulator` o örnek üzerinde ikinci kez çağrılır. SDK'nın iç
durumu bozulur.

Belirti sinsidir: **ilk sorgu geçer, sonrakiler sessizce boş döner.** Pratikte
depolar yükleniyor ama laboratuvarlar yüklenmiyordu; panelde "laboratuvar yok"
gibi görünüyordu, bir bağlantı hatası gibi değil. Bir kural/kapsam sorunu
sanılıp saatler harcanabilirdi.

Çözüm `globalThis` üzerinde tek seferlik bir bayrak. Üretimi etkilemez —
orada `EMULATOR_MODE` kapalı olduğu için bağlantı hiç kurulmaz.

Aynı sebeple emülatör kipinde **Analytics de atlanır**: emülatörü yoktur,
Google'a çıkmaya çalışır ve testlerde "Failed to fetch" gürültüsü üretir.

## Testlerin tutunma noktaları

Panel kontrollerine `data-testid` eklendi (`dt-kaynak-depo`, `dt-hedef-lab`,
`dt-transfer-et`). Metne göre seçim burada güvenilmez:

- Kaynak depo seçicisi tek depo varsa onu **kendi seçer** ("Auto-select first
  depot"), dolayısıyla `"Kaynak depo seçin"` placeholder'ı hiç render edilmez.
- `"Kaynak Depo"` etiketi sayfada birden fazla öğeye çözülür ve Playwright
  strict mode ihlali verir.

Yeniden yazım sırasında panel değişse bile bu kancalar korunmalıdır; testin
kırılması davranışın değiştiğini göstermeli, seçicinin eskidiğini değil.

## Tohumlanan veri

| Koleksiyon | İçerik |
|---|---|
| Auth | `e2e@qore.test` · özel talep `companyId` |
| `users` | admin rolü, tüm panel yetkileri |
| `depots` | E2E Merkez Depo |
| `hospitals` | E2E Laboratuvar (`consumptionTrackingEnabled`, `fefoEnabled`) |
| `productCodes` | biri seri takipli, biri lot takipli — iki kod yolu da kapsansın |
| `barcodeFormats` | sabit uzunlukta konumsal format (aşağıya bakınız) |

Gerçek Roche/GS1 formatlarını kopyalamak yerine alanları açıkça belli olan bir
format tanımlanır; testin okuttuğu barkodun neyi ifade ettiği tek bakışta
anlaşılır ve üretim formatları değişse bile test kırılmaz:

```
pozisyon  0-10   referans (stok kodu)   11 hane
pozisyon 11-16   lot                     6 hane
pozisyon 17-22   miad (yyMMdd)           6 hane
pozisyon 23-32   seri                   10 hane
```

## Faz 0 çıkış ölçütü

Plan beş kritik akışın E2E ile kayıtlı olmasını istiyor. Durum:

- [x] **Altyapı** — emülatör, tohumlama, oturum, şirket kapsamı (3 test yeşil)
- [~] Direkt transfer — depodan laboratuvara (yazıldı, `fixme`; aşağıya bakınız)
- [ ] Mal kabul — barkodla stok girişi
- [ ] Laboratuvar ürün kullanımı
- [ ] Depo sayımı

Kalan akışlar, ilgili dilimler taşınmadan **önce** yazılmalıdır.

### Açık kalan: hedef laboratuvar seçicisi emülatörde devre dışı

Transfer testi hedef laboratuvarı seçemiyor. Panel `disabled={hospitals.length === 0}`
diyor, yani `useHospitals()` boş dönüyor. Şunlar **elendi** — hepsi tek tek
doğrulandı, tekrar denenmesine gerek yok:

| Şüpheli | Sonuç |
|---|---|
| Veri yok mu? | `hospitals/e2e-lab` tohumlanıyor, `companyId='e2e-co'` — emülatörden okunarak doğrulandı |
| Kurallar mı engelliyor? | `@firebase/rules-unit-testing` ile aynı özel talep altında liste **okunabiliyor** (1 belge) |
| Şirket kapsamı mı bozuk? | Aynı kapsamla `depots` yükleniyor; kaynak depo seçicisi "E2E Merkez Depo" gösteriyor |
| Hook gölgelenmesi mi? | Tek bir `useHospitals` tanımı var, panel doğru import ediyor |
| SDK durumu mu bozuk? | `INTERNAL ASSERTION FAILED (b815)` düzeltildi; konsol temiz, `permission-denied` yok |

**Kalan şüpheli:** React Query'nin `['hospitals', companyId, …]` anahtarını,
şirket talebi (custom claim) yerleşmeden önce boş sonuçla önbelleğe alması —
`staleTime` bir saat olduğu için sonuç o koşu boyunca boş kalır. `useDepots`
aynı yapıda olduğu hâlde etkilenmemesi, sorunun bir YARIŞ DURUMU olduğunu
düşündürüyor; bu da neden depoların yüklenip laboratuvarların yüklenmediğini
açıklar.

Test silinmedi: yazıldığı hâliyle doğru akışı tarif ediyor ve `fixme`
kaldırıldığı an çalışmaya hazır.
