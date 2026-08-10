# Masaüstü Terminal (`/terminal` + Electron)

Depo zeminindeki kullanıcılar için sadeleştirilmiş bir arayüz ve onu masaüstü
uygulaması olarak paketleyen bir Electron kabuğu.

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
| `/terminal/siparisler` | Açık siparişleri listeler | Toplama, mevcut `/siparisler/[orderId]/toplama` ekranına devredilir — bkz. aşağıdaki not |
| `/terminal/sorgu` | Barkod okut → ürün nerede | Salt okunur |

### Sipariş toplama neden yeniden yazılmadı

`/siparisler/[orderId]/toplama`, gerekçeli FEFO aşımı, karışık lot/seri takip
modları, kurum bazlı özel ürün tanımları, eksik/kısmi kapanış ve sevk kaydı
oluşturmayı içeren, üretimde oturmuş büyük bir akıştır. Terminale ikinci bir
kopyasını yazmak, iki uygulamanın sevkiyatı farklı kurallarla kapatması
demekti. Terminal siparişleri sade biçimde listeler ve toplamayı mevcut ekrana
devreder; o ekran zaten HID okuyucu odaklıdır ve masaüstü penceresinde
sorunsuz çalışır.

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
