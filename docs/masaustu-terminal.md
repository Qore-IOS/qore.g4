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

## Masaüstünün getirdikleri

- **Offline dayanıklılık:** `persistentLocalCache` Electron'da da aktif; bağlantı
  kesildiğinde yazımlar yerelde birikir ve bağlantı gelince senkronize olur
- **Barkod okuyucu:** HID okuyucular global `keydown` ile yakalanır; "input'a
  odak vermeyi unuttum, tarama kayboldu" sorunu ortadan kalkar
- **Yazıcı:** `window.qoreDesktop.print({ silent: true })` ile etiket/irsaliye
  yazıcısına diyalogsuz basım

## Kurulum

Bkz. [`desktop/README.md`](../desktop/README.md).

Özet:

```bash
cd desktop && npm install
QORE_TERMINAL_URL=http://localhost:9002/terminal npm start   # geliştirme
npm run dist:win                                              # Windows kurulumu
```

## Sınırlar ve sonraki adımlar

- Terminal yalnızca **seri numaralı** kalemleri işler. Seri numarası olmayan
  lot/adet takipli ürünler için web paneli kullanılmalıdır.
- Sipariş toplama devredilmiş durumdadır; terminale özel sade bir toplama
  ekranı istenirse, `/siparisler/[orderId]/toplama` içindeki yazma mantığı da
  önce `src/lib/` altına çıkarılmalıdır — terminalin geri kalanında izlenen
  yaklaşımın aynısı.
