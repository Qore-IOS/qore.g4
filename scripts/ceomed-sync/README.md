> Güncel altyapı: Vercel / Neon PostgreSQL. Bu belgedeki eski Firebase,
> servis hesabı, kural yayımlama ve oturum adımları artık geçersizdir.
> Güncel kurulum için depodaki `docs/vercel-postgresql.md` belgesini kullanın.
> Terminal paketi `NEXT_PUBLIC_API_BASE_URL`, ERP işçileri `APP_BASE_URL` kullanır.

# Ceomed → Firebase Sync Worker

Local network'teki Ceomed ERP'den irsaliyeleri çekip Excel/PDF olarak Firebase Storage'a, metadata'yı Firestore'a yazan standalone Node worker'ı.

ERP `http://192.168.1.5:8081` üzerinde çalıştığı için bu script o ağa erişebilen bir makinede çalışmalı (Firebase Functions'tan erişilemez).

## Kurulum

```bash
cd scripts/ceomed-sync
cp .env.example .env
# .env'i düzenle
```

## Adım 1 — Login testi

```bash
set -a; source .env; set +a
node login.js
```

Beklenen çıktı:
```
OK — kullanıcı: Merkez Depo (ID_USER=3111)
Token: eyJhbGciOiJIUzI1NiIs...
```

## Adım 2 — İrsaliye listesi

```bash
node fetchIrsaliyeMaster.js 05.05.2026 06.05.2026
# Sadece "KURUMA SEVK EDILDI" durumundakiler:
node fetchIrsaliyeMaster.js 05.05.2026 06.05.2026 --sevk-edildi
```

Çıktıda her satırda `IRSALIYE_NO`, `CARI_KODU`, `DURUM_ACIKLAMA`, `ID` görünür. Bir sonraki adımda kullanılacak `ID`'yi not al.

## Adım 3 — İrsaliyenin barkod/ürün listesi

```bash
node fetchOkutulanBarkod.js <ID_SEVK_MASTER>
```

Sadece istenen alanlar dönülür: `BARKOD_SERI`, `BARKOD`, `STOK_KODU`, `LOT`, `MIYAT`, `MIKTAR`.

## Adım 4 — Firestore'a Sync

Bağımlılıkları kur:
```bash
npm install
```

Firebase service account JSON'unu indir (Firebase Console → Project Settings → Service accounts → Generate new private key) ve yolunu `.env`'e yaz:
```
CEOMED_COMPANY_ID=your-company-id
```

`CEOMED_COMPANY_ID` zorunludur — multi-tenancy katmanında yazılan tüm
Ceomed dokümanları bu firma id'siyle tag'lenir. Firma id'sini Firestore
`companies` koleksiyonundan veya kullanıcının `companyId` claim'inden
alabilirsin (her tenant kendi sync kurulumunu çalıştırır).

Çalıştır (3 durumun hepsini çekip Firestore `pendingCeomedIrsaliye` koleksiyonuna yazar):
```bash
# Tarih verilmezse aralık otomatik: son başarılı sync'ten bugüne (önerilen)
node syncToFirestore.js
# Elle tarih aralığı:
node syncToFirestore.js 05.05.2026 06.05.2026
# Sadece tek durum:
node syncToFirestore.js 05.05.2026 06.05.2026 --status="KURUMA SEVK EDILDI"
```

Otomatik mod son başarılı çalışma zamanını `scripts/ceomed-sync/.sync-state.json`
dosyasında tutar (gitignore'da). Makine günlerce kapalı kalsa bile bir sonraki
çalışmada aralık o güne kadar geriye uzar; aradaki irsaliyeler kaybolmaz.
İsteğe bağlı env ayarları:
```env
CEOMED_SYNC_MIN_LOOKBACK_DAYS=7    # her çalışmada en az bu kadar gün geriye bak
CEOMED_SYNC_MAX_LOOKBACK_DAYS=90   # uzun kesintide en fazla bu kadar gün geriye bak
```

Yazılan doküman şeması:
```
pendingCeomedIrsaliye/{ceomedId}
  ceomedId, irsaliyeNo, tarih, cariKodu, cariUnvan, evrakSeq,
  durumAciklama, items: [{BARKOD_SERI, BARKOD, STOK_KODU, LOT, MIYAT, MIKTAR}],
  status: 'pending' | 'approved' | 'rejected',
  companyId,    // CEOMED_COMPANY_ID env'inden — multi-tenancy filtresi için zorunlu
  syncedAt
```

### Adım 4c — Eski (companyId'siz) kayıtlar için tek seferlik backfill

Multi-tenancy katmanından önce yazılmış `pendingCeomedIrsaliye` ve
`ceomedDepoStok` dokümanları companyId taşımıyorsa panel onları
göstermez. Aşağıdaki script bu eski kayıtlara `CEOMED_COMPANY_ID`
tag'ini ekler (idempotent; doğru tag'li olanları atlar, farklı firmaya
ait olanları uyarı ile geçer):

```powershell
set -a; source .env; set +a
node backfillCompanyId.js
```

`ceomedDepoStok` için önce ilgili `depots/{depotId}` dokümanının
`companyId`'si kullanılır; depot tag'li değilse `CEOMED_COMPANY_ID`
env'i fallback olur. Backfill bir kere çalıştırıldıktan sonra
`syncToFirestore.js`/`syncMerkezDepo.js` artık yeni kayıtları
otomatik tag'ler — backfill'i tekrar çalıştırmaya gerek yoktur.

## Adım 4b — Merkez depo stok sync (günlük)

`syncMerkezDepo.js` Ceomed merkez depo stoğunu çeker; `depots` koleksiyonunda `ceomedEnabled=true` ve `ceomedDepoKodu` dolu olan her depo için `ceomedDepoStok/{depotId}` dokümanı yazar (items + lastDiff).

```powershell
.\run-depo-sync.bat
type sync-depo.log
```

Task Scheduler'a günde 1 kez çalışacak şekilde ayrı bir görev ekle (örn. her sabah 06:30):
- Program: `C:\Users\btuba\Desktop\qore.g4\scripts\ceomed-sync\run-depo-sync.bat`
- Başlat: `C:\Users\btuba\Desktop\qore.g4\scripts\ceomed-sync`
- Tetikleyici: Günlük 06:30, tekrar yok

## Adım 4c — Total Verimlilik sevkiyat watcher (long-running)

`watchSevkiyatRequests.js`, Total Verimlilik panelindeki "Ceomed'den Ay Başı Sevkiyat Getir"
butonunun yazdığı `ceomedSevkiyatRequests` isteklerini **anlık** dinler; seçilen ayın
"KURUMA SEVK EDILDI" irsaliyelerini sorgular, kurum + sevk adresi + stok bazında toplam adetleri
hesaplayıp `ceomedSevkiyatResults/{id}` dokümanına yazar. Panel sonucu okuyup 9. sütunu doldurur.

Bu **sürekli açık kalmalı**. Başlat:
```powershell
.\run-sevkiyat-watcher.bat
```
Bu bat kapanırsa kendini yeniden başlatır. Kalıcı olması için Task Scheduler'a ekle:
- Tetikleyici: "Oturum açıldığında" (başlangıçta otomatik başlasın)
- Program: `...\run-sevkiyat-watcher.bat`, Başlat: `...\scripts\ceomed-sync`

### Firestore kuralları

> **DÜZELTME.** Bu bölüm eskiden "varsayılan `match /{document=**}` kuralı
> bunları kapsar, ekstra kural gerekmez" diyordu. Bu YANLIŞTI: `firestore.rules`
> içinde böyle bir catch-all yoktu ve Firestore, `match` bloğu olmayan
> koleksiyonu varsayılan olarak REDDEDER. `ceomedDepoStok`,
> `ceomedSevkiyatRequests` ve `ceomedSevkiyatResults` bu yüzden kural
> yayınlandığında sessizce erişilemez hâle geliyordu.

Bu koleksiyonların kuralları artık `firestore.rules` içinde açıkça tanımlıdır.
Yeni bir Ceomed koleksiyonu eklerseniz kuralını da eklemeyi unutmayın —
ayrıntı için `docs/firestore-rules-rollout.md`.

## Adım 5 — Windows Task Scheduler ile Otomasyon

`run-sync.bat` hazır — varsa önce `set-env.bat`, sonra `.env` dosyasını yükler; `.env` değerleri `set-env.bat` değerlerini ezer. Tarih aralığını Node tarafı otomatik hesaplar: son başarılı sync'ten bugüne (eski "içinde bulunulan hafta" penceresi kaldırıldı — o pencere, makine hafta sonu/tatilde kapalı kaldığında önceki haftanın irsaliyelerini kalıcı olarak atlıyordu). Batch dosyası eksik zorunlu ayar veya Node hatasında non-zero exit code döndürür; böylece Task Scheduler gerçek hatayı “başarılı” gibi göstermez.

### Önce `.env` oluştur
`scripts/ceomed-sync/.env` dosyası (gitignore'da) düz `KEY=VALUE` satırları içermeli:
```env
CEOMED_BASE_URL=http://192.168.1.5:8081
CEOMED_EPOSTA=merkez
CEOMED_PAROLA=12345
CEOMED_COMPANY_ID=your-company-id
```

İstersen aynı değerleri `set-env.bat` ile de verebilirsin; fakat `.env` varsa en son o okunur ve değerleri geçerli olur.

`CEOMED_COMPANY_ID` özellikle önemlidir: bu değer boşsa sync script'i yazma işlemini durdurur; çünkü panel `pendingCeomedIrsaliye` kayıtlarını firma kapsamına göre okur ve companyId'siz yeni kayıtlar arayüzde görünmez.

### Test et
```powershell
cd C:\Users\btuba\Desktop\qore.g4\scripts\ceomed-sync
.\run-sync.bat
type sync.log
```

### Task Scheduler'a ekle
1. Başlat → "Görev Zamanlayıcı" / Task Scheduler aç
2. **Görev Oluştur** (Create Task) — "Temel Görev" değil, tam görev
3. **Genel** sekmesi:
   - Ad: `Ceomed Sync`
   - "Kullanıcı oturum açmış olsun olmasın çalıştır" seç
   - "En yüksek ayrıcalıklarla çalıştır" işaretle
4. **Tetikleyiciler** → Yeni:
   - "Bir programa göre"
   - Günlük, başlangıç saati 08:00
   - Tekrar: **15 dakika**, süre: **1 gün**
5. **Eylemler** → Yeni:
   - Eylem: Program başlat
   - Program: `C:\Users\btuba\Desktop\qore.g4\scripts\ceomed-sync\run-sync.bat`
   - Başlangıç: `C:\Users\btuba\Desktop\qore.g4\scripts\ceomed-sync` (önemli!)
6. **Koşullar** → "Yalnızca AC güç kaynağında çalıştır" kapat (laptop için)
7. Kaydet → şifreni iste → ver

Artık her 15 dakikada bir Firestore otomatik güncelleniyor. Logu görmek için:
```powershell
type C:\Users\btuba\Desktop\qore.g4\scripts\ceomed-sync\sync.log
```

Logda `[HATA] CEOMED_COMPANY_ID tanimli degil` veya `FATAL: CEOMED_COMPANY_ID env değişkeni zorunlu` görürsen `.env` dosyasına `CEOMED_COMPANY_ID=...` satırını ekleyip bir kere `node backfillCompanyId.js` çalıştır; ardından `run-sync.bat` yeni irsaliyeleri tekrar yazacaktır.

---

# SÜREKLİ AÇIK WATCHER (önerilen kurulum)

`watch.js` üç izleyiciyi **tek bir sürekli açık süreçte** çalıştırır ve eski
zamanlanmış `.bat` kurulumunun yerini alır.

| İzleyici | Ne yapar | Varsayılan aralık |
|---|---|---|
| **irsaliye** | Yeni/durumu değişen irsaliyeleri yoklar, `pendingCeomedIrsaliye`'ye yazar. **"KURUMA SEVK EDILDI"** olan ve laboratuvarı eşleşen irsaliyenin ürünlerini elle onay beklemeden **ilgili laboratuvarın stoğuna** yazar. | 60 sn |
| **depo** | Ceomed merkez depo listesini yoklar; **sadece gerçekten değişim olduğunda** `ceomedDepoStok/{depotId}` yazar ve `metadata/stockLastUpdated` damgasını günceller (açık paneller anında tazelenir). | 120 sn |
| **sevkiyat** | `ceomedSevkiyatRequests` koleksiyonunu Firestore realtime listener ile dinler — yoklama yok, zaten anlık. | — |

Qore arayüzü **kapalıyken de** çalışır: watcher Admin SDK ile doğrudan
Firestore'a yazar, tarayıcıya bağımlı değildir.

## "Anlık" ne demek — dürüst sınır

Ceomed API'si sorgu tabanlıdır, push/webhook sağlamaz. Bu yüzden irsaliye ve
depo izleyicileri **yoklama** yapar. Kazanç, yoklamanın kısalabilmesindedir:
sürekli açık süreçte ERP oturumu ve token korunur, soğuk başlatma yoktur,
bu yüzden 15 dakika yerine 60 saniyeye inilebilir. Sıfır gecikme ERP push
desteklemediği sürece mümkün değildir.

## Başlatma

```powershell
cd C:\Users\btuba\Desktop\qore.g4\scripts\ceomed-sync
.\run-watch.bat
type watch.log
```

`run-watch.bat` süreç çökerse 10 saniye sonra yeniden başlatır. Kalıcı olması
için Task Scheduler'a ekleyin:

- **Genel:** "Kullanıcı oturum açmış olsun olmasın çalıştır" + "En yüksek ayrıcalıklarla"
- **Tetikleyici:** "Oturum açıldığında" (veya "Bilgisayar başlatıldığında")
- **Eylem:** Program `...\scripts\ceomed-sync\run-watch.bat`, Başlangıç `...\scripts\ceomed-sync`
- **Koşullar:** "Yalnızca AC güç kaynağında çalıştır" kapalı
- **Ayarlar:** "Görev zaten çalışıyorsa yeni örnek başlatma" seçin

### Eski görevleri DEVRE DIŞI bırakın

`watch.js` bu üçünün işini de yapar. Aynı anda çalışırlarsa aynı irsaliyeler
iki kez işlenir — belge kimlikleri deterministik olduğu için mükerrer stok
oluşmaz, ama ERP ve Firestore gereksiz yük alır:

- `Ceomed Sync` (15 dakikada bir `run-sync.bat`) → **devre dışı**
- `Ceomed Depo Sync` (günlük `run-depo-sync.bat`) → **devre dışı**
- `Ceomed Sevkiyat Watcher` (`run-sevkiyat-watcher.bat`) → **devre dışı**

Eski script'ler silinmedi; watcher'ı durdurup tek seferlik elle sync yapmak
isterseniz hâlâ çalışır durumdalar.

## Otomatik laboratuvar aktarımı

İrsaliye **"KURUMA SEVK EDILDI"** durumuna geçtiğinde:

1. İrsaliyenin `CARI_KODU` alanı, laboratuvarların `ceomedCariKodu` alanıyla
   eşleştirilir. Aynı cari koduna birden çok laboratuvar bağlıysa (ana lab +
   ek hizmet lab'ları) ayrım irsaliyenin `ADRES` alanı ile laboratuvarın
   `sevkAdresi` alanı karşılaştırılarak yapılır.
2. Eşleşme tekse: ürünler `depoStok`'a `isShipped: true` + `hedefKurumId` ile,
   yani **laboratuvar stoğu** olarak yazılır. Ayrıca bir `transfers` kaydı ve
   her seri için **Seri No Defteri** olayı yazılır.
3. Eşleşme yoksa veya belirsizse: irsaliye onay kuyruğunda **bekler**,
   `autoTransfer.status = 'unmatched'` damgalanır ve gerekçesi mal kabul
   panelinde gösterilir. **Tahmin edilerek yanlış laboratuvara stok yazılmaz.**

### Laboratuvar cari kodlarını tanımlayın

Otomatik aktarımın çalışması için Yönetim → Laboratuvarlar ekranından her
laboratuvara `ceomedCariKodu` girilmelidir. Girilmeyen kurumların irsaliyeleri
"eşleşmedi" olarak beklemede kalır (stok kaybolmaz, sadece elle aktarım
gerekir).

### İdempotens ve mükerrer koruması

Belge kimlikleri `ceomed-{irsaliyeId}-{stokKodu}-{seri}` biçiminde
**deterministiktir**. Watcher yeniden başlasa, ağ koparsa veya ERP aynı kaydı
tekrar döndürse aynı kimlikler üretilir; mükerrer stok oluşmaz.

Mal kabul panelindeki elle **"Stoğa Aktar"** butonu yedek olarak durur, fakat
watcher'ın aktardığı irsaliyede **devre dışı** olur ("Otomatik aktarıldı"
yazar) — iki yol aynı irsaliyeyi iki kez stoğa yazamaz.

### Otomatik aktarımı kapatma

```env
CEOMED_AUTO_TRANSFER=0
```

Bu ayarla watcher yalnızca irsaliyeleri ve depo stoğunu senkronize eder;
laboratuvara aktarım tamamen elle yapılır.

## Ayarlar (.env)

```env
CEOMED_WATCH_IRSALIYE_SEC=60     # irsaliye yoklama aralığı (sn)
CEOMED_WATCH_DEPO_SEC=120        # depo stoğu yoklama aralığı (sn)
CEOMED_WATCH_LOOKBACK_DAYS=7     # her turda kaç gün geriye bakılsın
CEOMED_AUTO_TRANSFER=1           # 0 = otomatik lab aktarımı kapalı
```

Yoklama aralıklarını düşürmeden önce ERP yükünü göz önünde bulundurun: her
irsaliye turu bir master sorgu, artı **yalnızca yeni/durumu değişen** irsaliye
başına bir barkod sorgusu yapar (değişmeyenler için ERP'ye gidilmez).

## Hata dayanıklılığı

- ERP erişilemezse süreç **ölmez**: hata loglanır, bir sonraki tura geçilir.
  Ardışık hatada geri çekilme uygulanır (her hatada +30 sn, en fazla +150 sn).
- ERP token'ı süresi dolarsa otomatik yeniden login olunur.
- `Ctrl+C` / servis durdurma sinyalinde listener kapatılıp düzgün çıkılır.

## Log

```powershell
type watch.log
```

Satır biçimi: `[2026-08-04 09:15:02] [aktarım] IRS-001 → Merkez Lab: 12 birim`
