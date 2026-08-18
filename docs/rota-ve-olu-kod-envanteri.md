# Rota ve ölü kod envanteri

> Yeniden yazım programı, Faz 0 · madde 2.
> Ölçüm aracı: `npm run audit:routes` · Mandal: `npm run check:dead`

## Neden bu doküman

Yeniden yazım planının bir varsayımı vardı: *"bu ölçekte bir sistemde kodun
%15–25'i taşınmaz, silinir."* Kullanılmayan bir ekranı yeniden yazmak, silmek
yerine taşımak demektir — ve bu, programın en pahalı hatası olur. Bu envanterin
işi o varsayımı ölçüye çevirmek.

## Yöntem — ve sınırı

Araç **statik erişilebilirlik** ölçer, kullanım değil. İlişki tek yönlüdür ama
işe yarar:

- hiçbir yerden erişilemeyen rota → **kesinlikle** kullanılmıyor
- erişilebilen rota → kullanılıyor **olabilir**

Yani buradaki liste, üretim analitiği olmadan da güvenle silinebilecek kodun
**alt sınırıdır**. Üst sınır için gerçek kullanım verisi gerekir.

### Geçişli kapanış

Naif yaklaşım ("bu rotaya herhangi bir yerden bağlantı var mı") yanıltıcıdır:
birbirine bağlanan ölü sayfalar kümesi hep birlikte canlı görünür. Bu yüzden
gerçek import grafiği kurulup sabit noktaya kadar yinelenir:

1. **Kök** = navigasyon kayıtları (`use-dock.ts`, `dock.tsx`,
   `shortcuts/catalog.ts`, başlat menüsü), uygulama kabuğu ve kök layout'lar.
2. Erişilebilir bir dosyanın import ettiği her dosya erişilebilirdir (geçişli).
3. Erişilebilir bir dosyadan bağlantı verilen her rota erişilebilirdir.
4. Yeni rota açıldıkça 2'ye dön.

`page.tsx` ve `layout.tsx` bilerek kök kümesine **alınmaz** — alınırlarsa her
sayfa kendiliğinden canlı olur ve analiz anlamsızlaşır.

Hariç tutulanlar: Next.js'in koşulsuz çalıştırdığı özel dosyalar (`route.ts`,
`not-found.tsx`, `middleware.ts` …), `.d.ts` bildirimleri, ve `tests/`,
`functions/src/`, `scripts/`, `terminal-app/`, `desktop/` ağaçlarının import
ettiği her şey.

Kod tabanında değişken/şablon yollu `import()` veya `require()` **bulunmadığı**
doğrulandı; import grafiği eksiksizdir.

## Ölçüm — 18.08.2026

```
194 rota · 71.150 satır (yalnız page.tsx)

   58  Menüden erişilebilir (dock / başlat / kestirme)
  122  Kod içinden erişilebilir — geçişli olarak menüye bağlı
    5  Alt rota — üst rotası erişilebilir
    9  YETİM — erişilebilir hiçbir dosyadan bağlantı yok

122 ölü modül · 35.702 satır
```

| | Satır | src'nin yüzdesi |
|---|---:|---:|
| Yetim rotalar | 679 | %0,3 |
| Ölü modüller | 35.702 | %13,4 |
| **Toplam silme adayı** | **36.381** | **%13,6** |

Plandaki %15–25 tahmini bu ölçümle **%13,6'ya** iniyor — aynı büyüklük sırasında
ama alt uçta. Ve bu bir alt sınır: "erişilebilir ama kullanılmayan" ekranlar
buna dahil değil.

## Yetim rotalar — tek tek doğrulandı

Ham liste işe yaramaz; her biri elle incelendi.

| Rota | Satır | Karar | Gerekçe |
|---|---:|---|---|
| `/health` | 46 | **SİLME** | Altyapı çağırıyor (App Hosting / uptime izleme). Koddan referans olmaması beklenen durum — aracın kör noktası. |
| `/hakkinda` | 120 | **KARAR GEREKİR** | Yasal küme başlığı. Uygulama mağazası listelemesinden bağlantı olabilir. |
| `/gizlilik-politikasi` | 165 | **KARAR GEREKİR** | Yalnız `/hakkinda`'dan bağlantılı; o da yetim. Mağaza uyumluluğu için gerekli olabilir. |
| `/kullanim-sartlari` | 101 | **KARAR GEREKİR** | Aynı yasal küme. |
| `/urun-kullanim-istatistik` | 159 | **KARAR GEREKİR** | Paneli var ama hiçbir yerden çağrılmıyor. |
| `/test-notifications` | 13 | **SİL** | Geliştirme iskelesi. Hiçbir referans yok. |
| `/urun-kullanim-dogrulama` | 25 | **SİL** | `/kullanim-dogrulama` dock'ta canlı — bu, eskimiş kopya. |
| `/hastane-yonetimi` | 8 | **SİL** | Render ettiği panel `/laboratuvar-yonetimi` altında yaşıyor. Eskimiş rota. |
| `/cihaz-yonetimi/dashboard` | 42 | **SİL** | `/cihaz-yonetimi-ana` canlı. Eskimiş kopya. |

Yasal üçlü (`/hakkinda`, `/gizlilik-politikasi`, `/kullanim-sartlari`) tam olarak
aracın yakalamak için yazıldığı desendir: birbirine bağlanan, dışarıdan
erişilemeyen bir küme. Ama uygulama mağazası listelemesinden bağlantılıysa
silinemez — **bu bir ürün kararı, mühendislik kararı değil.**

## Ölü modüller — dizin dağılımı

| Dizin | Satır | Dosya |
|---|---:|---:|
| `components/purchasing` | 8.125 | 8 |
| `components/maliyet-sayim-panel.tsx` | 2.938 | 1 |
| `components/nobet` | 2.133 | 6 |
| `lib/ai` | 2.065 | 6 |
| `components/cost-dashboard-panel.tsx` | 1.864 | 1 |
| `components/yonetim` | 1.558 | 3 |
| `components/ui` | 1.159 | 12 |
| `components/dashboard-panel.tsx` | 1.107 | 1 |
| `components/toplu-maliyet-sayim-panel.tsx` | 930 | 1 |
| `services` | 924 | 2 |
| `hooks` | 843 | 6 |
| `app` (yetim sayfalar + bağımlılıkları) | 841 | 15 |

### Doğrulanmış örnekler

**`components/purchasing/SatinAlmaPanel.tsx` — 4.191 satır.** Depodaki en büyük
ölü dosya. `/satin-alma` rotası canlı ama sayfası `PlanlamaPanel` render ediyor:

```tsx
// src/app/(protected)/satin-alma/page.tsx
import PlanlamaPanel from '@/components/purchasing/planlama/PlanlamaPanel';
export default function SatinAlmaPage() { return <PlanlamaPanel />; }
```

Satın alma paneli yeniden yazılmış, eskisi silinmemiş. `NoxPanel`,
`WorkflowCanvasPanel`, `TumIslemlerPanel`, `AnalizPlanlamaPanel` aynı kümede —
`components/purchasing` altındaki 8.125 satırın tamamı erişilemez durumda.

**Üç ayrı `ErrorBoundary` — 1.502 satır.** `direkt-transfer/` (564),
`urun-kullanim/` (519), `mal-kabul/` (419). Üçü de yazılmış, hiçbiri
bağlanmamış.

**`services/searchService.ts` — 876 satır.** Miad denetiminde "aynı `normDate`
iki yere kopyalanmış" diye işaretlenen iki dosyadan biri. Şimdi anlaşılıyor ki
kopya değil, **eskimiş sürüm**: canlı olan `actions/searchActions.ts`. Silinince
miad risk sayısı da bir azalır.

**`lib/ai` — 2.065 satır, 6 dosya.** `dataFetcher.ts`, `actions.ts`,
`knowledgeBase.ts`, `index.ts` ve bağımlılıkları. Bir önceki turda
`dataFetcher.ts`'in ölü olduğu tespit edilmişti; grafik kümenin tamamını
gösteriyor. Canlı AI yolu `chat.ts → smartQueryEngine.ts`.

## Mandal

`npm run check:dead` ölü modül sayısını tavanda tutar ve `npm run build`
zincirine bağlıdır. Erişilemeyen yeni dosya eklenirse derleme kırılır. Tavan
her silme turunda düşürülür: **122 → 85**.

Aynı turda `check:miad` tavanı da **38 → 37**'ye indi: `services/searchService.ts`
silinince bir miad riski kendiliğinden ortadan kalktı.

## Birinci silme turu — tamamlandı

**39 dosya, 16.298 satır silindi.** `src` 267.502 → 251.204 satıra indi.

| Küme | Satır | Neden silindi |
|---|---:|---|
| `components/purchasing` ölü kümesi + 2 rota | 8.141 | `/satin-alma` `PlanlamaPanel` render ediyor; eski panel ailesi erişilemez |
| Beş bağlanmamış `ErrorBoundary` | 2.294 | Yazılmış, hiçbiri bağlanmamış |
| `lib/ai` v1 kümesi | 2.065 | Canlı yol `chat.ts → smartQueryEngine.ts`; v1'e giriş yok |
| Rota taklidi bileşenler (`components/**/page.tsx`) | 1.206 | `src/app` altında değil; hiçbir yerden import edilmiyor |
| Eskimiş servisler (`searchService`, `qorEngineService`) | 924 | Canlı olan `actions/searchActions.ts` |
| Eskimiş rotalar + panelleri | 743 | `/kullanim-dogrulama`, `/laboratuvar-yonetimi`, `/cihaz-yonetimi-ana` canlı karşılıkları |
| `src/functions/` kopyası | 480 | Dağıtılan dizin `functions/`; bu stray kopya |
| `hooks/useScanPerformance.ts` | 135 | Gölgeleyen eskimiş sürüm — aşağıya bakınız |

### Gölgeleme hatası — denetim aracının kendisi yakalayamıyordu

`useScanPerformance` hem `.ts` hem `.tsx` olarak vardı. Paneller
`@/hooks/useScanPerformance` import ediyor ve iki çözümleyici **farklı dosyaya**
bakıyordu:

- **webpack/Next.js**: `.tsx` önce → canlı sürüm (`ScanCommitProbe`,
  `ScanPerformanceBadge` export eder)
- **TypeScript**: `.ts` önce → eskimiş sürüm (bu export'lar yok)

Sonuç: uygulama doğru çalışıyor ama derleyici yanlış dosyayı denetliyordu. 561
baseline tip hatasının **5'i** bundandı. Gölge dosya silinince tip hataları
561 → 514'e indi.

Denetim aracı da ilk sürümünde `.ts`'i önceliyordu, yani **canlı dosyayı ölü,
ölü dosyayı canlı** gösteriyordu — silinseydi uygulama kırılırdı. Uzantı sırası
webpack ile hizalandı (`scripts/audit-routes.js`, `UZANTILAR`).

## Kalan — ürün kararı bekliyor

Silme turundan sonra: **85 ölü modül, 19.353 satır.**

| Küme | Satır | Soru |
|---|---:|---|
| `maliyet-sayim` + `toplu-maliyet-sayim` | 3.868 | Yol haritasında geri gelecek mi? |
| `cost-dashboard-panel` + `cost-observation/*` | 2.300 | `/cost-dashboard` canlı ama başka panel kullanıyor |
| `nobet` kümesi | 2.133 | Özellik rafta mı, iptal mi? |
| `dashboard-panel.tsx` | 1.107 | `dashboard-v2` ile değiştirilmiş görünüyor |
| Yasal sayfa üçlüsü | 386 | **Mağaza listelemesinden bağlantı var mı?** |
| `/urun-kullanim-istatistik` + paneli | 601 | Kullanılıyor mu? |
| Kullanılmayan `ui/*` (shadcn) | 1.159 | Zararsız; istenirse silinir |
| Diğer küçük modüller | ~7.800 | Dilim taşınırken temizlenir |

**Asla silinmemeli:** `/health` — altyapı çağırıyor.

Silme her dilimin "bitti" tanımının bir parçası olduğu için, kalanlar ilgili
dilim taşınırken temizlenebilir.

## Aracın kör noktaları

- **Altyapının çağırdığı uç noktalar** (`/health`) koddan referans almaz.
- **Dış bağlantılar** (mağaza listelemesi, e-posta, yer imi) görülmez.
- **Erişilebilir ama kullanılmayan** ekranlar ayırt edilemez — bunun için üretim
  analitiği gerekir. Bugün sistemde sayfa görüntüleme telemetrisi yok; kurulması
  envanterin üst sınırını ölçmenin tek yolu.
