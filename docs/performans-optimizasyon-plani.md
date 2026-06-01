# Performans Optimizasyon Programı — "Işık Hızı" Planı

> Amaç: Panellerin saniyelerde değil **milisaniyelerde** açıldığı, etkileşimlerin (barkod
> okutma, tıklama, yazma) anında yanıt verdiği bir sistem.
> Hedef bütçeler: **LCP < 1.5 sn**, **INP < 200 ms**, **CLS < 0.05** (her panel için).

Bu doküman, kod tabanı üzerinde yapılan derinlemesine incelemenin (5 paralel analiz +
DevTools kanıtları) sonucudur. Kullanıcının hazırladığı "Performans İnceleme Raporu"
doğrulanmış, düzeltilmiş ve **eksik kalan kök nedenlerle** genişletilmiştir.

---

## 0. Mevcut Durum — Kanıtlar (DevTools)

| Panel | LCP | INP | CLS | Yorum |
|---|---|---|---|---|
| Direkt Transfer | 2,06 sn | 168 ms | 0 | Tek "kabul edilebilir" ekran |
| Mal Kabul | 5,67 sn | **1.728 ms** | 0,06 | INP felaket |
| Siparişler | 4,72 sn | **7.416 ms** | 0,14 | INP 7 saniye — ana thread 7 sn kilitli |
| Cihaz Yönetimi Ana | **6,79 sn** | 4.144 ms | 0,15 | LCP + INP birlikte kötü |

İyi metrikler: LCP < 2,5 sn / INP < 200 ms / CLS < 0,1. Sistem her üç eksende de sınırın
**kat kat üzerinde**. LCP elemanının çoğu ekranda küçük bir logo/metin (`img.w-20.h-20…`,
`p.text-xs…`) olması, **ana içeriğin saniyelerce boş/iskelet kaldığını** gösteriyor.

---

## 1. Kök Neden: Üç Duvar + Bir Yanlış Yön

Yavaşlık tek bir sebep değil, **üç bağımsız duvar**. Önceki hızlandırma programı bu
duvarlardan en kritik ikisine (first-paint ve INP) **hiç dokunmadı**; sadece arka plan
veri tarafında altyapı kurdu ama **panelleri o altyapıya bağlamadı**.

### Duvar 1 — İlk boyama (first paint) seri network + dev sorgularla kilitleniyor → LCP 4,7–6,8 sn
- **`auth-context.tsx:142–239`**: Her açılışta `onAuthStateChanged` içinde önce
  `getDoc(userDoc)` **sonra** `user.getIdTokenResult(true)` (zorla token yenileme = Google'a
  network round-trip) **seri** çalışıyor ve ikisi de `setIsLoadingAuth(false)` (satır 239)
  öncesinde `await` ediliyor. `isLoadingAuth`, **her sayfayı** bloke ediyor → her açılışta
  2 seri network gecikmesi ilk boyamadan önce ödeniyor.
- **24 panelde "ya hep ya hiç" gating**: `if (isLoading) return <tam ekran spinner>`.
  `isLoading` tüm sorguların VEYA'sı olduğu için **LCP = en yavaş sorgu**. Örnek:
  `dashboard/page.tsx:18–24`, `useDashboardData.tsx:42–44`.
- O sorgular dev: `useDeviceFaultReports` (730 gün / 10.000 kayıt), `useDevices` (tüm cihazlar),
  `useMaintenanceLogs` (tüm koleksiyon, limitsiz), `useDepoStok` (tüm depoStok koleksiyonu).
  **`cihaz-yonetimi-host.tsx:218–228`** bunların 10 tanesinin `isLoading`'inde birden gate'liyor.
- **Bundle/paint ham hali**: `next.config.mjs`'de `removeConsole` yok → **727 `console.*`**
  çağrısı production'a gidip ana thread'de çalışıyor (ekran görüntülerindeki SW/FCM log seli).
  `optimizePackageImports` yok → 268 dosyanın import ettiği `lucide-react` + radix + date-fns
  ağaç-budamadan paylaşılan bundle'a giriyor. `recharts` ve `tesseract.js` bazı rotalarda eager.

### Duvar 2 — Etkileşimler ana thread'i saniyelerce kilitliyor → INP 1,7–7,4 sn
- **Hiçbir panelde `React.memo` yok** (tüm `src/components` içinde tek dosya:
  `total-verimlilik-panel.tsx`). Paneller **1.200–2.900 satırlık** dev bileşenler ve **her
  taramada/tuş vuruşunda komple yeniden render** oluyor.
- **`merkez-siparis-panel.tsx:479–511` (Toplu Sipariş `handleGenerate`)**: `selectedRules`
  döngüsünde her kural × her lokasyon için, **scope'suz tüm `depoStok`** üzerinde tam
  `.filter()` (satır 423/426/437). Karmaşıklık **O(kural × lokasyon × |depoStok|)**, senkron,
  tek tıkla. **7 saniyelik INP'nin baş şüphelisi.**
- **`siparisler/[orderId]/toplama/page.tsx:1102`** `enrichedList`: her satır için 2 tam
  `depoStok.filter()` (1108/1109) ve `scannedSerials`'a bağlı olduğu için **her barkod
  okutmada** yeniden hesaplanıp 1.550 satırlık sayfa yeniden render oluyor.
- **`siparisler-panel.tsx:469 / :399`** Min-Max tekil/toplu: her kural için tam
  `depoStok.filter()`. **`urun-kullanim-panel.tsx:1423`** `listDeductionItems`: döngü içinde
  `products.find()` (1439) → O(labStock × products), her tüketimde yeniden.
- **Per-tarama Firestore round-trip**: `urun-kullanim-panel.tsx:1094` her başarılı seri
  okutmasında `checkRecentConsumption` (`:932`) **koşulsuz** Firestore sorgusu yapıyor.
- **Memoize edilmemiş AuthContext value** (`auth-context.tsx:422–447`): her render'da yeniden
  oluşturulan 24 alanlı obje; kimlik + yüksek-değişimli UI state (navMode, dockStyle, wallpaper)
  karışık → tüm uygulama ağacı yeniden render. Tüm sayfaları sarıyor.
- **Sanallaştırılmamış uzun listeler**, render içinde `productCodes.sort()` (cache'i mutate
  ediyor, `siparisler-panel.tsx:849`), memoize'ı bozan inline `labs={...map}` prop'ları.
- **backdrop-filter ×93 + backdrop-blur ×54** — pahalı paint/compositing.

### Duvar 3 — Sürekli arka plan gürültüsü → her şey sürekli ağır
- **`useLabStock` (`useFirebaseQueries.ts:903`)**: `staleTime:0` (958) + **`refetchInterval:3000`**
  (960) → seçili lab stoğunu **her 3 saniyede bir** baştan indiriyor + legacy isim bazlı ikinci
  sorgu (933–944) + `refetchOnWindowFocus:true`. **Tek başına en zararlı hook.**
- **`useDeviceFaultReports`**: dashboard açıkken **her 60 sn'de 10.000 kayıt** yeniden çekiyor.
- **56 dosyada `onSnapshot`**. `useDock` singleton değil → tek ekranda **4 ayrı bildirim
  listener'ı** (`app-layout.tsx:110`, `PersistentNotificationToast.tsx:15`,
  `qore-technic-shell.tsx:91`, `cihaz-yonetimi-host.tsx:561`).
- Limitsiz + client-scope listener'lar: `orders` (`siparisler-panel.tsx:190, :277`),
  `deviceFaultReports` ham `query()` (scopedQuery DEĞİL → companyId Firestore'da yok, client'ta
  filtreleniyor; `teknik-servis-panel.tsx:69`, `aplikasyon-panel.tsx:67`, detay sayfa `:146`).
- **Çift çekimler**: `handleAddAllStock` bellekteki stoğu yeniden sorguluyor
  (`direkt-transfer-panel.tsx:1038`); FEFO onay anında yeniden okuyor (112, 597); tüketim
  duplicate check'i iki kaynaktan.

### Yanlış Yön — Önceki program neden işe yaramadı?
Önceki 6 perf commit'i **gerçek hızlı altyapı kurdu ama canlı panelleri ona hiç bağlamadı**:
1. **`companyStats` ölü değişken**: Cloud Function'lar (`functions/src/companyStatsAggregation.ts`)
   `companyStats/{companyId}` özet dokümanını besliyor, `useCompanyStats` çekiyor — ama her iki
   dashboard'da da (`dashboard-panel.tsx:121`, `DashboardV2.tsx:121`) **sadece destructure edilip
   hiç kullanılmıyor**. KPI'lar hâlâ 10.000 arıza kaydını client'ta reduce ederek hesaplanıyor.
2. **`dashboard-panel.tsx` öksüz**: Hiçbir yerden import edilmiyor; phase5'in "dashboard
   entegrasyonu" kısmen **ölü bir bileşene** yapılmış. Çalışma zamanı etkisi sıfır.
3. **7 "light" hook %100 ölü kod**: `useOpenDeviceFaultReports` (limit 1000),
   `useRecentDeviceFaultReports`, `useActiveDepoStok`, `useShippedDepoStok` vb. — **sıfır
   import eden**. Paneller hâlâ ağır orijinalleri çağırıyor.
4. **En ağır ekran (cihaz yönetimi) veri açısından hiç dokunulmamış**.
5. **Özet koleksiyonların çoğu hiç kurulmamış**: `stockSummaryByDepotProduct`,
   `stockSummaryByLabProduct`, `activePersonnelStatus`, `deviceMaintenanceSummary` **yok**.
6. **Bundle / first-paint / re-render hiç ele alınmamış**: Hiçbir commit `next.config.mjs`,
   `layout`, `next/dynamic` veya `React.memo`'ya dokunmamış. `ed3ea99` sadece cihaz-yönetimi
   re-render CPU'sunu azaltmış (veri çekmeyi değiştirmemiş).

**Özet:** Hızlı şerit yapıldı ama trafik hâlâ eski ağır şeritte. **Bu planın 1 numaralı ilkesi:
yeni altyapı kurmadan önce mevcut hızlı altyapıyı BAĞLAMAK ve her fazı ÖLÇMEK.**

---

## 2. Rapora Eklemeler ve Düzeltmeler

**Kullanıcının raporu büyük ölçüde doğru.** Doğrulanan başlıca iddialar: `useDepoStok` tüm
koleksiyonu indiriyor; `useLabStock` 3 sn polling; cihaz-yönetimi ana panel 10 sorgu +
combined isLoading; action-forms her iki koleksiyonu çekiyor; form detayında limitsiz
`yedekParcaDepoStok`; detay sayfalarında N+1; perifer tüm shipped stoğu çekiyor.

### Rapora EKLENENLER (raporda olmayan, kritik kök nedenler)
- **A. `getIdTokenResult(true)` zorla token yenileme** her açılışta first-paint'i bloke ediyor.
- **B. Bundle optimizasyonu sıfır**: `removeConsole` yok (727 log prod'da), `optimizePackageImports`
  yok, `tesseract.js`/`recharts` eager import.
- **C. `React.memo` neredeyse hiç yok** — INP'nin yapısal kök nedeni; monolitik paneller her
  state değişiminde komple render.
- **D. `useDock` 4 kez kopya listener** açıyor (singleton/context değil).
- **E. AuthContext value memoize edilmemiş** + UI state ile kimlik karışık → global re-render.
- **F. "Önceki altyapı bağlanmamış"** kök nedeni (companyStats + 7 light hook ölü) — en önemli
  bulgu; önceki çalışmanın neden sonuç vermediğini açıklıyor.
- **G. `isLoading` ile first-paint gating** deseni (24 panel) — LCP = en yavaş sorgu.
- **H. Fault listener'ların `scopedQuery` yerine ham `query()`** kullanması → companyId Firestore
  sorgusunda yok, cross-tenant veri indirip client'ta filtreleme.

### Rapordaki DÜZELTMELER
- **Direkt Transfer `bySerial/byLot/byCode` map'leri ZATEN memoize** (`direkt-transfer-panel.tsx:243`)
  ve `useDepoStokByDepot(selectedDepotId)` ile **depo-scope'lu** — rapor bunu hotspot sanıyordu,
  aslında doğru optimizasyon. (Web Worker önerisi düşük öncelikli.)
- **Personel durumu O(personel × arıza) taraması ARTIK YOK** — `ed3ea99` commit'i
  `activeFaultByUid`/`activeWindowByUid` indeksleriyle çözmüş. Kart başına `filter().sort()` de
  `devicesByHospitalId` ile memoize edilmiş. (Rapordaki bu iki madde güncel değil.)
- **Ürün Kullanım per-tarama stok lookup'ı cache-first** (Firestore sadece cache-miss fallback'i);
  ancak **duplicate check koşulsuz Firestore** — bu kısım doğru.
- **React Query global config sağlıklı** (staleTime 5dk, gcTime 30dk, refetchOnWindowFocus:false).
  Sorun global değil, **per-hook override'lar** (özellikle `useLabStock`).

---

## 3. Fazlar

Her faz: **düşük riskten yükseğe, en yüksek etki/efor oranından düşüğe** sıralı. Her fazın
sonunda metrikler yeniden ölçülür (gate). Her faz ayrı PR(ler) olarak ilerler.

### Faz 0 — Ölçülebilirlik (bu sefer kanıtlayabilmek için) — ✅ UYGULANDI
Önceki program "işe yaramadı" çünkü ölçüm yoktu. Önce ölçümü kurduk.

**Eklenenler:**
- `web-vitals` + `src/components/perf/WebVitalsReporter.tsx` (root layout'a monte).
  Gerçek kullanıcı ortamında (prod + mobil dahil) LCP/INP/CLS/FCP/TTFB yakalar.
- `@next/bundle-analyzer` + `pnpm analyze` script'i (`ANALYZE=true next build`).

**Nasıl ölçülür (her fazdan önce/sonra):**
- *Runtime (LCP/INP/CLS):* Uygulamayı aç, URL'ye `?vitals=1` ekle → sol-altta canlı
  panel çıkar (yeşil/sarı/kırmızı). Kapatmak için `?vitals=0`. Konsolda tablo için:
  `window.__qoreVitals__()`. Tüm örnekler `window.__QORE_VITALS__` dizisinde. Mobilde
  de çalışır (konsola gerek yok). Faz 1'in `removeConsole`'undan etkilenmez.
- *Bundle:* `pnpm analyze` → `.next` altında `client.html` raporu; rota bazlı JS
  boyutları. Her fazdan önce/sonra karşılaştır.

**⚠️ Build-blocker bulundu ve düzeltildi:** `next build` PR #1270'ten beri **derlenmiyordu**
(`teknik-servis/islem-formu/[deviceId]/page.tsx`'te çift `filterByCompanyScope` import'u →
SWC hatası, `ignoreBuildErrors` bunu bastırmaz). Bu, önceki perf çalışmasının (phase1-6)
**production'a hiç ulaşmamış olabileceği** anlamına gelir. Çift import kaldırıldı; build artık
geçiyor (153/153 statik sayfa). _Not: build'de var olan birkaç `Attempted import error` uyarısı
(`useFirebaseQueries`, `emitMaliyetSayimInvitation`, `toStorageUrl` eksik export'ları) latent
runtime bug'ı; ayrı ele alınacak, build'i kırmıyor._

**Baseline — İlk-Yük JS (production build, Faz öncesi):**

| Rota | İlk-Yük JS |
|---|---|
| `/cihaz-yonetimi/dashboard` | 641 kB |
| `/dashboard` | 637 kB |
| `/direkt-transfer` | 621 kB |
| `/siparisler/[orderId]/toplama` | 556 kB |
| `/siparisler` | 547 kB |
| `/mal-kabul` | 526 kB |
| `/urun-kullanim/[[...slug]]` | 465 kB |
| `/cihaz-yonetimi-ana` | 356 kB |
| `/login` | 318 kB |
| **Paylaşılan (tüm rotalar)** | **89,2 kB** |

Sağlıklı hedef ~130–170 kB; ağır paneller 3–5× üzerinde. Runtime baseline (DevTools): LCP
4,7–6,8 sn · INP 1,7–7,4 sn (§0).

**Faz ilerleme tablosu:**

| Faz | LCP (kötü panel) | INP (Siparişler) | Paylaşılan JS | `/siparisler` İlk-Yük | Not |
|---|---|---|---|---|---|
| Baseline | 6,79 sn | 7.416 ms | 89,2 kB | 547 kB | build düzeltildi |
| Faz 1 sonrası | `?vitals=1` ile ölç | `?vitals=1` ile ölç | 89,1 kB | 547 kB | bundle ~sabit; **runtime** kazanımları |
| Faz 2 sonrası | _ölç_ | _ölç_ | _ölç_ | _ölç_ | |

**🔎 Faz 1 öğrenimi — bundle vs runtime:** Faz 1'in İlk-Yük JS etkisi ~0. Çünkü
(a) Next 14.2 `lucide-react`/`date-fns`/`recharts`/`framer-motion`'ı **zaten** varsayılan
`optimizePackageImports` ile tree-shake ediyor — bizim eklememiz no-op; (b) `removeConsole`
bundle **boyutunu** değil **runtime ana-thread işini** azaltır. Faz 1'in gerçek kazanımları
ölçülebilir ama **runtime**: ① auth de-blocking (her açılıştan 2 seri network round-trip kalktı
→ LCP); ② `console.log` 727→40 (kalan kütüphane kodu) — ekran görüntüsündeki FCM/SW log seli
built çıktıda 0; ③ FCM/SW init idle'a ertelendi (INP); ④ AuthContext memoizasyonu (re-render).
Bunlar prod'da `?vitals=1` ile ölçülecek. **500–640 kB'lık ağır panel bundle'ları config ile
değil, code-split ile düşer** (monolit panellerin `next/dynamic`'i + recharts'ın dashboard'larda
lazy yüklenmesi) → ayrı bir code-split adımı olarak Faz 5'e eklendi.

### Faz 1 — First-paint hızlı kazanımlar (config + auth + ölü kod) — ~1 gün, risk: düşük
Her rotaya dokunur, izole değişiklikler.
- `next.config.mjs`: `compiler.removeConsole: { exclude: ['error','warn'] }` (727 log → 0);
  `experimental.optimizePackageImports: ['lucide-react','date-fns','recharts','framer-motion', radix…]`.
- `auth-context.tsx:142–239`: `getDoc` + `getIdTokenResult()` (force YOK) **paralel** (`Promise.all`);
  zorla yenileme yalnızca `claims.companyId` yoksa **arka planda**. `contextValue`'yu `useMemo`'la;
  yüksek-değişimli UI prefs'i ayrı context'e ayır.
- `PushNotificationsClient` / FCM / SW kaydını `requestIdleCallback` / ilk etkileşime ertele.
- `lib/pdf.ts:3`: `tesseract.js`'i fonksiyon içinde `await import()`'a çevir.
- Ölü WebGL bileşenlerini sil (`AppBackground`, `Orb`, `Beams`, `GradientBlinds`) + kullanılmayan
  `gsap`/`three`/`ogl` bağımlılıklarını kaldır.
- **Beklenen etki:** Her rotada LCP'de büyük düşüş (2 seri round-trip + log seli + bundle kalkar).

### Faz 2 — Arka plan gürültüsünü durdur — ✅ KISMEN UYGULANDI
- ✅ `useLabStock` (`:903`): `staleTime:0` + `refetchInterval:3000` **kaldırıldı** (lab stoğu
  artık her 3 sn'de baştan inmiyor); `staleTime` 30sn'ye çekildi. `useStockUpdateListener`
  zaten `['depoStok']` ailesini invalidate ediyor (bu key'i kapsar) → stok değişiminde anında
  tazelenir. _Legacy isim sorgusu KORUNDU (eski kayıt desteği — Faz 7 migration'a bırakıldı)._
- ✅ Dashboard (`DashboardV2`): `useDeviceFaultReports` (730g/10k/60sn) → **mevcut ama hiç
  kullanılmayan** `useOpenDeviceFaultReports` (status≠closed, 1000). KPI'lar yalnızca açık
  arıza durumlarını sayıyordu → drop-in. _("Kurulmuş ama bağlanmamış altyapıyı bağla" ilkesi.)_
- ✅ Statik kataloglardan (`productCodes`/`depots`/`hospitals`) `refetchOnWindowFocus:true`
  kaldırıldı → global `false` miras alınır.
- ⏳ **Ertelendi (ayrı PR, gerekçe):**
  - `useDock` singleton: notification listener'ı UI yan-etkileriyle (ses, peek, okunmamış
    sayacı) iç içe ve 4 tüketicisi var → hassas; bildirimleri bozmamak için ayrı/dikkatli
    ele alınacak.
  - `def_mainUnits`/`def_deviceGroups` cache hook'u: 6+ ham `getDocs` çağrı yerini değiştirir.
  - `cihaz-yonetimi-host` (10k fault hook) → Faz 6'da (kompleks panel) ele alınacak.
- **Beklenen etki:** En kritik arka plan yükü olan 3 sn'lik lab-stok polling'i ve dashboard'ın
  60 sn'de 10k arıza refetch'i kalktı.

### Faz 3 — Ağır sorguları sınırla + first-paint'i serbest bırak — 🟡 KISMEN (bölüm 1)
- ✅ **Form-detayı lazy stok** (`action-forms-view.tsx` `ActionFormDetailView`): şahsi stok,
  havuz-stok yürüyüşü (deviceLabPools→depots→poolWarehouseStock) ve **limitsiz `yedekParcaDepoStok`
  koleksiyonu** artık form-detayı mount'unda değil, yalnızca "Değişen Parça Ekle" modalı (`isAddPartModalOpen`)
  açıldığında çekiliyor. Tüm stok kullanımı modal içinde olduğu için davranış korunur (seçili öğe ayrı
  state'te). `/teknik-servis|aplikasyon/tum-formlar/[formId]` (522 kB) rotalarına etki eder.
- ⏳ **Ertelendi (runtime testi gerektirir — staging'de yapılmalı):**
  - 24 paneldeki `isLoading` tam-ekran gating'i shell+iskelete çevirme: her panel bespoke,
    veri `undefined` iken çökme riski → runtime doğrulama şart.
  - Sorgu bounding (`useDepoStok`/`useDevices`/`useMaintenanceLogs`/`orders` listener limit):
    tüketiciler tam veri bekliyor; kör limit/scope **legacy kayıt** veya davranış kırabilir
    (ör. `perifer` `hedefKurumId` legacy fallback, `orders` durum-filtresi). Aggregate (Faz 7)
    veya dikkatli per-consumer iş.
  - Wizard `islem-formu/[deviceId]` (546 kB) lazy stok: stoklar modal DIŞINDA da kullanılıyor
    (save yolları) → action-forms gibi temiz değil; ayrı/test gerekli.
- _Not: `useMaintenanceLogs` yalnızca cihaz-host'ta (Faz 6); action-forms listesi zaten 180g/2000
  sınırlı ve bilinçli birleşik görünüm._

### Faz 4 — INP: senkron compute hotspot'larını öldür (7 sn'lik katil) — 🟡 KISMEN (bölüm 1)
- ✅ **Min-Max / toplu sipariş (merkez-siparis + siparisler-panel):** stok **bir kez**
  `Map<depotId|stokKodu→adet>` ve `Map<hedefKurumId|stokKodu→adet>`'e (siparisler'de ayrıca
  legacy `Map<hedefKurum(ad)|stokKodu→adet>`) indekslenir → `O(kural×lokasyon×|depoStok|)`
  senkron döngüler `O(|depoStok|)` bir kez + `O(1)` lookup'lara indi. Sonuçlar orijinal
  `.filter()` + `sumStockItemQuantities` ile **birebir aynı**. `/siparisler`'in ölçülen
  7416 ms INP'sini doğrudan hedefler.
- ⏳ **Faz 4b (sıradaki, aynı pattern):**
  - Toplama `enrichedList` (`toplama/page.tsx:1102`): `depoStok`'u seri & stokKodu ile bir kez
    indeksle; her taramada 2 tam `.filter` yerine `Map.get` → tarama-başı INP düşer.
  - Ürün kullanım `listDeductionItems`: ürün lookup `Map`'i önceden kur; döngüden `products.find`.
  - Gerçekten ağır toplu üretimi tık yolundan çıkar (chunk/`requestIdleCallback`).
- **Beklenen etki:** Bu akışlarda INP saniyelerden **on ms**'lere.

### Faz 5 — INP: render disiplini + sanallaştırma — ~2 gün, risk: orta
- Ağır alt bileşenlere `React.memo`; prop'ları stabilize et (inline `labs` array'lerini `useMemo`;
  `productCodes.sort`'u render'dan çıkar).
- Kalan büyük listeleri sanallaştır (ürün-kullanım düşüm listesi `:1906`, siparişler bekleyen
  siparişler `:1101`, toplama grup kartları).
- Always-mounted yüzeylerde `backdrop-filter`'ı azalt.
- Barkod-tarama state'ini böl → tarama 2.900 satırı değil küçük bir alt ağacı güncellesin.
- **Bundle code-split (Faz 1 öğreniminden):** 500–640 kB'lık ağır panellerin İlk-Yük JS'ini
  düşürmek için ağır bloklar `next/dynamic` ile bölünmeli — recharts dashboard'larda, ağır
  modal/sekme içerikleri ve büyük panel alt-bölümleri talep üzerine yüklenmeli.
- **Beklenen etki:** Tarama/yazma anında hissedilir; ağır panel İlk-Yük JS'i düşer.

### Faz 6 — Cihaz Yönetimi derin düzeltmeler — ~2–3 gün, risk: orta
- Detay sayfaları (`teknik-servis/[id]`, `aplikasyon-paneli/[id]`): N+1'i (cihaz başına arıza
  geçmişi `:184–207`, 4×N bakım `:236–346`) tek `hospitalId`-scope'lu sorguya çevir + client'ta
  grupla, ya da `deviceMaintenanceSummary` özetinden oku.
- Ana panel 3 kartı 10 koleksiyon yerine özet/`companyStats`'tan beslensin.
- (`ed3ea99` memoizasyonu korunur.)

### Faz 7 — Server-side aggregation (işi bitir) + legacy migration — ~1 hafta+, risk: yüksek
- Önerilen ama hiç kurulmamış özet koleksiyonlarını kur (Cloud Function onWrite + backfill):
  `stockSummaryByDepotProduct`, `stockSummaryByLabProduct`, `activePersonnelStatus`,
  `deviceMaintenanceSummary`.
- Legacy alan migration'ı (kullanıcı açılışında DEĞİL, tek seferlik admin script):
  tüm tüketim/stok kayıtlarına `hedefKurumId`, perifer siparişlere `routingStatus`,
  CEOMED'e `normalizedCariKodu` → fallback çift-sorguları ortadan kalkar, scoped listener mümkün.
- Min-Max toplu üretim + ağır reduce'ları server'a taşı.

---

## 4. Ölçüm Stratejisi (her fazda)
1. Faz öncesi: ilgili rotalarda LCP/INP/CLS + bundle boyutu kaydet.
2. Faz sonrası: aynı ölçümleri tekrarla, dokümana işle.
3. Gate: hedef bütçeye ulaşılmadıysa faz "tamam" sayılmaz.
4. Firestore okuma sayısı (maliyet) da izlenir.

## 5. Riskler ve Önlemler
- **Multi-tenancy**: Yeni/değişen sorgularda `scopedQuery` + composite index zorunlu (CLAUDE.md §82).
- **Index gereksinimi**: Faz 3/7'deki scoped listener'lar yeni indeks ister
  (`faultType+hospitalId`, `routingStatus`, `normalizedCariKodu`). Önce indeks, sonra sorgu.
- **`ignoreBuildErrors:true`**: Tip güvenliği kapalı; refactor'larda `pnpm typecheck` manuel çalıştır.
- **Davranış korunumu**: Özellikle FEFO/Min-Max/duplicate-check mantığı değişmemeli — sadece
  veri kaynağı (bellek vs network) ve algoritma karmaşıklığı optimize edilir.

---
*Bu plan yaşayan bir belgedir; her faz tamamlandıkça metrik sonuçları bu dokümana eklenir.*
