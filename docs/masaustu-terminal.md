# Masaüstü Terminal (`/terminal` + Electron)

Depo zeminindeki kullanıcılar için sadeleştirilmiş bir arayüz ve onu masaüstü
uygulaması olarak paketleyen bir Electron kabuğu.

> Aynı arayüzün Android (APK) kabuğu için bkz.
> [`android-terminal.md`](./android-terminal.md). Ekranlar ve yazma mantığı
> ortaktır; yalnızca kabuk değişir.

## Neden

Web panelleri (`/mal-kabul`, `/direkt-transfer`, `/siparisler`) yıllar içinde
çok sayıda uç durumu kapsayacak şekilde büyüdü. Bu, ofisteki kullanıcı için
doğru; ama elinde barkod okuyucuyla ayakta duran depo görevlisi için gereğinden
karmaşık. Terminal, o kullanıcının %90 durumunu tek ekranda bitirir.

## Mimarinin özü: tek yazma yolu

Masaüstü uygulaması **kendi veri katmanını taşımaz**. Aynı Firebase projesine,
aynı Firestore koleksiyonlarına, aynı `firestore.rules` altında yazar.

Daha da önemlisi, mal kabul ve direkt transferin Firestore'a **nasıl** yazıldığı
tek bir yerde tanımlıdır:

| Modül | Ne üretir | Kimler kullanır |
| --- | --- | --- |
| `src/lib/mal-kabul/write.ts` | `depoStok`, `serialHistory` intake olayı, Seri No Defteri `mal_kabul` olayı, `malKabulTransactions` başlığı/satırları | `ana-panel.tsx` (manuel + Oto Kabul), `/terminal/mal-kabul` |
| `src/lib/direkt-transfer/write.ts` | `depoStok` sevk güncellemesi, `serialHistory` transfer olayı, defter `transfer`/`borc`/`tuketim` olayları, `transfers/{id}/items`, `borcTransfers`, `tuketimKayitlari` | `direkt-transfer-panel.tsx`, `/terminal/transfer` |

Bu modüller çıkarılmadan önce aynı mantığın panel bileşenleri içinde iki ayrı
kopyası vardı. Terminal üçüncü bir kopya yazsaydı, iki uygulama stoğu farklı
şekillerde güncelleyebilirdi — ve bu tür bir sapma aylar sonra, sayımda ortaya
çıkar. Bir alan eklenecekse **tek yer yukarıdaki modüllerdir**.

## Kimlik doğrulama ve kiracı izolasyonu

Terminal, web uygulamasının `AuthProvider`'ını kullanır. Kullanıcı aynı hesapla
giriş yapar, ID token aynı özel talepleri (`companyId`, `isSuperAdmin`) taşır.
`firestore.rules` tarafında **hiçbir değişiklik gerekmez**.

Electron'da `signInWithEmailAndPassword` sorunsuz çalışır. Google ile giriş
(`signInWithPopup`) Electron'da doğrudan çalışmaz; gerekirse sistem tarayıcısı
üzerinden alınan bir custom token ile `signInWithCustomToken` yolu kullanılmalı
(NFC girişi zaten bu yolu kullanıyor — `functions/src/createCustomTokenForNfcUser.ts`).

## Ekranlar

| Rota | İş | Kapsam notu |
| --- | --- | --- |
| `/terminal` | Başlangıç ekranı, depo seçimi | Depo seçimi cihazda hatırlanır (`useTerminalDepot`) |
| `/terminal/mal-kabul` | Barkod okut → raf/irsaliye ata → stoğa al | **Seri numaralı** kalemler. Lot/adet grupları, irsaliye OCR'ı, Excel içe aktarma ve toplu QR devri web panelinde kalır |
| `/terminal/transfer` | Depodan laboratuvara sevk | **Seri numaralı** kalemler. Borç modu, FEFO kısmi tahsis, şablonlar ve tutanak basımı web panelinde kalır |
| `/terminal/siparisler` | Açık siparişleri listeler | Toplama `/terminal/toplama` ekranında |
| `/terminal/toplama` | Sipariş toplama (FEFO önerili) | **Seri numaralı** kalemler; `?order=<id>` ile açılır |
| `/terminal/sorgu` | Barkod okut → ürün nerede | Salt okunur |

### Sipariş toplama nasıl ortaklaştırıldı

Terminal toplama ekranı SADE bir sürümdür ama ikinci bir yazma yolu açmaz:

- Stok hareketi `applyTransferItemWrites` ile yazılır — direkt transferin
  kullandığı fonksiyonun aynısı. Sipariş bağlamı `orderId` alanıyla verilir;
  o zaman defter olayı `siparis_karsilama` tipiyle yazılır.
- Siparişin kapanışı `applyOrderCompletionWrite` ile yapılır: tam
  karşılandıysa `ordersArchive`'a taşınır, kısmiyse kalan kalemler yazılıp
  durum `kismi` olur. Bu kural web ekranından çıkarılmıştır.

Terminalde bilerek YOKTUR: gerekçeli FEFO aşımı (burada FEFO bir öneridir,
engel değil), kurum bazlı özel ürün sıralaması, iki adımlı doğrulama. Bu
durumlar için web toplama ekranı kullanılmalıdır.

## Önyükleme: veri girişte iner ve BELLEKTE tutulur

Terminal açılırken tüm çalışma verisi yerele indirilir (`src/lib/terminal-prefetch.ts`):
stok kartları, barkod formatları, depolar, laboratuvarlar ve seçili deponun
stoğu + siparişleri. İndirme `onSnapshot` ile yapılır — ilk anlık görüntü
indirmedir, sonraki değişiklikler hem önbelleği hem belleği günceller.

**Ekranlar veriyi BURADAN okur** (`useTerminalData()`). TanStack hook'ları
(`useDepots`, `useProductCodes`, `useUnshippedDepoStokByDepot` …) terminalde
BİLEREK kullanılmaz.

### Neden — panel geçişindeki donmanın sebebi

O hook'lar `getDocs` ile sorgu atar ve 5 dakikalık tazelik süresi dolduktan
sonra her ekran açılışında yeniden çalışır. Çevrimdışıyken bu ölümcüldü: ağ
arayüzü "bağlı" görünüp internet olmadığında (depoda tipik hâl) `getDocs`
sunucu yanıtını zaman aşımına kadar bekler ve arayüz donar.

Sahada görülen "panel değiştiriyorum, uygulama donuyor" tam olarak buydu.
Artık navigasyon yolunda tek bir ağ çağrısı yoktur.

Aynı sebeple stok sorgu ekranı çevrimdışıyken sunucuya sorgu ATMAZ: elindeki
depo stoğunda arar ve kapsamı ("yalnızca bu deponun stoğunda arandı") açıkça
söyler.

## Bekleyen işlemler

Çevrimdışı yapılan işlemler `/terminal/bekleyen` ekranında listelenir:
ne zaman yapıldığı, kaç kalem olduğu, gönderilip gönderilmediği.

Gönderme işini **Firestore'un kendi kuyruğu** yapar; o kuyruk kalıcıdır ve
uygulama kapansa bile kaybolmaz. `src/lib/pending-operations.ts` yalnızca
insan tarafından okunabilir bir defter tutar ve durumu yansıtır.

**İkinci bir gönderim mantığı BİLEREK yazılmadı.** İki ayrı kuyruk (biri
Firestore'un, biri bizimki) aynı işlemi iki kez gönderebilirdi — aynı seri
numarasının iki kez stoğa girmesi demek olurdu.

Defter `localStorage`'da saklanır; üst şeritteki bağlantı göstergesi de bu
sayacı okur, böylece uygulama kapanıp açıldığında bekleyen işlem varsa
görünür kalır.

## İşlemler beklemez

Terminaldeki hiçbir düğme sunucu yanıtı beklemez:

- `queueWrite()` yazımı kuyruğa alır ve ANINDA döner. Firestore veriyi yerel
  önbelleğe senkron uyguladığı için sonuç zaten doğrudur.
- Liste, yazım gönderilmeden önce temizlenir; kullanıcı bir sonraki işe geçer.
- Gönderim durumu üst şeritteki bağlantı göstergesinden izlenir.

Mal kabulde **geçmiş seri kontrolü okutma anında, arka planda** yapılır —
kaydetme anında değil. Böylece hem düğme beklemez, hem de kullanıcı sorunu
kutuyu elindeyken görür. Engelli seriler satırda işaretlenir ve kaydetmede
atlanır.

## Arayüz ilkeleri

- Tek ekranda tek iş; sekme ve menü yok
- Rakam tuşlarıyla akış seçimi, `Esc` ile geri
- Renk tek başına anlam taşımaz — durum metni de sonucu söyler
- Okutma yolunda ağ turu yok: depo stoğu önbellekten okunur, aksi hâlde
  saniyede birkaç kutu okutan kullanıcı her okutmada beklerdi

## Çevrimdışı çalışma

Masaüstü uygulaması iki kipten birinde çalışır:

| Kip | Arayüz nereden gelir | İnternetsiz açılır mı |
| --- | --- | --- |
| **Gömülü** (varsayılan) | `desktop/renderer-dist`, uygulamayla birlikte kurulur | **Evet** |
| **Uzak** | Yayındaki `/terminal` adresinden | Hayır |

`QORE_TERMINAL_URL` verilmişse uzak kip kazanır (geliştirme için); aksi hâlde
gömülü paket varsa o kullanılır.

### Gömülü kip nasıl çalışır

Paket `app://terminal` özel protokolünden sunulur — `file://` DEĞİL. Sebebi
kritik: Chromium'da `file://` opak bir kaynaktır ve orada IndexedDB güvenilir
biçimde çalışmaz. Terminalin çevrimdışılığı tamamen IndexedDB'ye bağlıdır;
Firestore'un kalıcı önbelleği ve Firebase Auth oturumu orada durur. `file://`
ile açılan bir paket her açılışta oturumu ve önbelleği kaybederdi.

Çevrimdışıyken:

- **Okumalar** Firestore'un kalıcı önbelleğinden gelir (ürün kodları, barkod
  formatları, depolar, laboratuvarlar, depo stoğu). Veri en az bir kez
  çevrimiçi çekilmiş olmalıdır.
- **Yazımlar** yerel önbelleğe uygulanır ve kuyruğa girer; bağlantı gelince
  SDK kendisi gönderir.
- **Oturum** cihazda saklıdır. İLK giriş internet gerektirir (Firebase Auth
  parolayı sunucuda doğrular); sonrasında çevrimdışı açılışta korunur.

### `batch.commit()` tuzağı

Firestore Web SDK'sında `writeBatch().commit()` sözü SUNUCU onayında çözülür.
Çevrimdışıyken bu onay hiç gelmez — söz ne çözülür ne reddedilir. `await`
edilirse ekran "Kaydediliyor…" konumunda sonsuza kadar kilitlenir.

`src/lib/offline-write.ts` bunu çözer: commit kısa bir zaman aşımıyla
yarıştırılır, zaman aşımı kazanırsa işlem `'pending'` sayılır (yerelde yazıldı)
ve bekleyen sayacı artar. Özgün söz bırakılmaz, arka planda izlenir.

**Yeni bir terminal yazma yolu eklerken `await batch.commit()` YAZMAYIN**,
`commitLocalFirst(batch.commit())` kullanın.

### Bağlantı göstergesi

Her terminal ekranının üst şeridinde bağlantı ve kuyruk durumu durur
(`src/components/terminal/connection-badge.tsx`). Çevrimdışı çalışabilen bir
uygulamada en tehlikeli şey, kullanıcının çevrimdışı olduğunu bilmemesidir.

## Masaüstünün diğer getirdikleri

- **Barkod okuyucu:** HID okuyucular global `keydown` ile yakalanır; "input'a
  odak vermeyi unuttum, tarama kayboldu" sorunu ortadan kalkar
- **Yazıcı:** `window.qoreDesktop.print({ silent: true })` ile etiket/irsaliye
  yazıcısına diyalogsuz basım

## Transfer tutanağı

Direkt transfer tamamlandığında sağ üstte "Tutanağı indir" kartı belirir. PDF,
transfer geçmişi detay sayfasının kullandığı `generateTransferTutanakPDF`
üreticisiyle oluşturulur — tasarım birebir aynıdır, ikinci bir şablon yoktur.

Tutanak verisi Firestore'dan DEĞİL, işlem anında saklanan bellekten gelir:
transfer henüz kuyrukta olabilir ve çevrimdışıyken sunucudan okunamaz. PDF'in
fontları ve logoları pakete gömülür (`vite.config.terminal.ts` → `copyPdfAssets`),
aksi hâlde çevrimdışı basımda Türkçe karakterler bozulurdu.

## Açık / koyu tema

Terminal her iki temada da çalışır; anahtar üst şeritte. Tercih **makineye**
aittir (kullanıcı profiline değil) ve `localStorage`'da saklanır — aynı hesapla
giren iki terminalden biri güneş alan bir rampada, diğeri loş bir depoda
olabilir.

Tema React yüklenmeden `theme-boot.js` ile uygulanır; ayrı dosya olmasının
sebebi CSP'nin satır içi betiğe izin vermemesidir.

Zemin BİLEREK `body`'ye verilmez: `globals.css` `body`'yi
`background: transparent !important` ile saydam bırakıp zemini `html` üzerinde
boyar. Terminal stillerine bir `body` kuralı yazmak sessizce etkisiz kalır.

## Gömülü paket nasıl üretilir

Arayüz, web uygulamasının `src/` ağacını olduğu gibi kullanan ayrı bir Vite
paketidir (`terminal-app/`). Ekranlar KOPYALANMAZ — `src/app/terminal/**`
altındaki aynı bileşenler import edilir. Next'e özgü üç bağımlılık
`vite.config.terminal.ts` içinde kesilir:

| Bağımlılık | Nasıl çözülür |
| --- | --- |
| `next/navigation` | Hash tabanlı router shim'i (`terminal-app/shims/next-navigation.tsx`) |
| `@/actions/stokActions` | Web SDK karşılıkları (`terminal-app/shims/stok-actions.ts` → `src/lib/master-data.ts`) |
| `process.env.NEXT_PUBLIC_*` | Derleme zamanında sabit değer (`define`) |

```bash
# Firebase anahtarları .env.local içinde olmalı (apphosting.yaml ile aynı değerler)
pnpm build:terminal          # → desktop/renderer-dist
cd desktop && npm install
npm start                    # gömülü paketi açar
npm run dist:win             # .exe içine gömülü paketle birlikte
```

Ayrıntı: [`desktop/README.md`](../desktop/README.md)

## Sınırlar ve sonraki adımlar

- Terminal yalnızca **seri numaralı** kalemleri işler. Seri numarası olmayan
  lot/adet takipli ürünler için web paneli kullanılmalıdır.
- Gömülü kipte arayüz güncellemesi için **yeni `.exe` gerekir** — web deploy'u
  yetmez. Uzak kipte tersi geçerlidir. Kurumda hangi kipin kullanıldığı bu
  yüzden operasyonel bir karardır.
- İlk giriş internet gerektirir; tamamen çevrimdışı bir makineye kurulup hiç
  bağlanmadan kullanılamaz.
- Sipariş toplama devredilmiş durumdadır; terminale özel sade bir toplama
  ekranı istenirse, `/siparisler/[orderId]/toplama` içindeki yazma mantığı da
  önce `src/lib/` altına çıkarılmalıdır — terminalin geri kalanında izlenen
  yaklaşımın aynısı.
