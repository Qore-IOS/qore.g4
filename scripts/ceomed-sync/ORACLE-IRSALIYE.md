# Qore → Ceomed muhasebe irsaliyesi (YAZMA)

`watch.js` Ceomed'den Qore'a **okur**. Bu belge ters yönü anlatır: bir teknik
servis / aplikasyon formunda **yedek parça kullanıldığında**, Ceomed masaüstü
uygulamasındaki "Çıkış İrsaliyesi" formunun otomatik doldurulup e-irsaliyenin
gönderilmesi.

```
Teknik/Aplikasyon formu kapanır (içinde yedek parça var)
   │
   ├─ Qore aynı batch'te kuyruk kaydı yazar
   │     ceomedIrsaliyeGirisJobs/{formId}   status: pending | blocked
   │
   └─> on-prem worker (oracleIrsaliyeWorker.js)
          ├─ işi atomik olarak sahiplenir (status: processing)
          ├─ ikinci kez doğrular
          ├─ sürücüyle yazar:  api (tercih) | ui (pywinauto)
          └─ status: sent | failed | blocked
```

## Alan eşlemesi

| Ceomed formu | Qore kaynağı |
|---|---|
| İrsaliye No | form numarası (`formNo`, ör. `BT-T0042`) |
| Cari Kodu | Yönetim → Laboratuvarlar → **Ceomed Cari Kodu** (`hospitals.ceomedCariKodu`) |
| Tarih | işlemin başlangıç tarihi |
| Stok Kodu | yedek parçanın stok kodu (Ürün Adı uygulamadan otomatik gelir) |
| Miktar | formdaki adet |
| LOT | **seri no varsa seri no, yoksa lot** |
| Miat | ürün miadı — Qore yedek parça stoğunda tutulmuyorsa boş |
| İşlem Tipi | sabit **35** |
| Depo | sabit **10** |
| Açıklama (sol alt) | işlemi yapan personelin adı soyadı |
| Kapanış | **E-İRSALİYE GÖNDER** |

Bir formda birden çok yedek parça varsa **tek irsaliye, çok satır** açılır.

### LOT kuralının tek cümlesi

> Seri no varsa seri no yazılır; yoksa lot yazılır.

Üç durumu da bu kapsar: lot+miad+seri no → seri no; sadece seri no → seri no;
sadece lot → lot. Kural `src/lib/ceomed/irsaliye-giris.ts` içinde tek yerde
tanımlıdır ve `tests/ceomed/irsaliyeGiris.test.ts` ile korunur.

## Kuyruk durumları

| Durum | Anlamı | Ne yapılmalı |
|---|---|---|
| `pending` | Kuyrukta, worker sırasını bekliyor | — |
| `processing` | Worker şu an uygulamaya yazıyor | — |
| `sent` | E-irsaliye gönderildi | — |
| `failed` | Deneme hakkı bitti | Log + ekran görüntüsüne bakıp elle girin |
| `blocked` | **Eksik veri** — hiç denenmedi | Eksiği tamamlayıp `pending`'e çekin |

`blocked` gerekçeleri: cari kodu tanımsız, stok kodu eksik, personel adı yok,
form no yok, tarih geçersiz. Form kaydedilirken kullanıcıya da kırmızı bir
bildirim gösterilir — eksik haftalar sonra fark edilmesin diye.

**En sık `blocked` sebebi:** laboratuvara Ceomed cari kodu girilmemiş olması.
Yönetim → Laboratuvarlar ekranından tanımlayın, sonra işi yeniden kuyruğa alın.

## Kurulum

### 1. Kuyruk kurallarını ve indekslerini yayınla

```powershell
firebase deploy --only firestore:rules,firestore:indexes
```

`ceomedIrsaliyeGirisJobs` koleksiyonunun kuralı `firestore.rules` içindedir.
Kuralsız koleksiyonu Firestore **reddeder** — atlanırsa kuyruk sessizce
erişilemez olur (bkz. `docs/firestore-rules-rollout.md`).

### 2. `.env`

Mevcut `scripts/ceomed-sync/.env` dosyasına ekleyin:

```env
# --- Ceomed yazma worker'ı ---
ORACLE_DRY_RUN=1          # 0 = GERÇEKTEN GÖNDER. Önce 1'de doğrulayın.
ORACLE_DRIVER=ui          # ui | api
ORACLE_MAX_ATTEMPTS=3     # bir işin en fazla deneme sayısı
ORACLE_MAX_PER_DAY=200    # günlük gönderim tavanı (otomasyon çıldırırsa emniyet)
ORACLE_STALE_CLAIM_MIN=15 # takılı kalan işi kaç dk sonra kurtar
ORACLE_PYTHON=python      # UI sürücüsü için Python yorumlayıcısı
```

`GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_PROJECT_ID` ve `CEOMED_COMPANY_ID`
zaten okuma worker'ı için tanımlı olmalı; aynıları kullanılır.

### 3. Kuru çalışmayı doğrula

```powershell
cd C:\Users\btuba\Desktop\qore.g4\scripts\ceomed-sync
node oracleIrsaliyeWorker.js
```

Log'da her bekleyen iş için doldurulacak alanların listesi görünür ve
**hiçbir şey gönderilmez**. Bu adım atlanmamalıdır: e-irsaliye gönderimi geri
alınamaz, kuru çalışma da tek provadır.

---

## API keşfi (önce bu — tercih edilen yol)

Ekran otomasyonu çalışır ama kırılgandır: uygulama sürümü, pencere boyutu,
sekme sırası ya da beklenmedik bir uyarı penceresi bozar. Masaüstü uygulaması
verisini bir yere yazıyor; o yolu bulursak yazma işi düz bir çağrıya döner.

Okuma tarafındaki Ceomed **web** arayüzü `http://192.168.1.5:8081` üzerinde bir
HTTP API sunuyor (`/login/doLogin`, `/api/sevk/selectIrsaliyeMaster`). Masaüstü
uygulaması ya aynı servise ya doğrudan Oracle'a bağlanıyor. Hangisi olduğunu
**ölçerek** bulun:

### Adım 1 — Uygulama nereye bağlanıyor?

Ceomed masaüstü uygulaması açıkken, yönetici PowerShell'de:

```powershell
# Uygulamanın process id'sini bul
Get-Process | Where-Object { $_.MainWindowTitle -like "*CEOMED*" } | Select-Object Id, ProcessName, MainWindowTitle

# O process'in açık bağlantıları
Get-NetTCPConnection -OwningProcess <PID> | Select-Object RemoteAddress, RemotePort, State
```

Sonucu yorumlayın:

- **Port 1521 / 1522** → doğrudan Oracle. HTTP API yok; UI sürücüsüyle devam.
  (Oracle'a doğrudan yazmak teknik olarak mümkündür ama uygulamanın iş
  kurallarını — e-irsaliye gönderimi, stok düşümü, numara üretimi — atlar.
  Muhasebe tutarsızlığı riski yüksektir; bu yol bilinçli olarak seçilmedi.)
- **Port 8081 veya başka bir HTTP portu** → servis katmanı var, Adım 2'ye geçin.

### Adım 2 — HTTP ise isteği yakala

Uygulama HTTP konuşuyorsa, bir irsaliyeyi **elle** girip gönderirken trafiği
kaydedin (Fiddler Classic ya da Wireshark). Aranan: `POST` isteği, gövdesinde
irsaliye no / cari kodu / stok kodu geçen.

Kaydedilmesi gerekenler:

- İstek yolu (ör. `/api/sevk/insertIrsaliye`)
- Gövde biçimi (form-urlencoded mi JSON mu) ve **tam alan adları**
- Kimlik doğrulama başlığı (okuma tarafı `X-Access-Token` kullanıyor)
- Başarılı yanıtın gövdesi (üretilen irsaliye numarası nerede dönüyor)
- E-irsaliye gönderiminin ayrı bir çağrı mı olduğu

Bunlar elde edildiğinde `drivers/apiDriver.js` doldurulur ve
`ORACLE_DRIVER=api` ile devreye alınır. Dosya şu an **bilerek boş**: uç noktayı
tahmin ederek yazmak, kuru çalışmada doğru görünüp gerçek modda muhasebeye
bozuk kayıt göndermek demektir.

---

## UI sürücüsü (API bulunamazsa)

### Adım 1 — pywinauto

```powershell
pip install pywinauto pillow
```

### Adım 2 — Kontrol haritasını ölç

Ceomed uygulamasında giriş yapın, İrsaliye sekmesinden irsaliye giriş formunu
açın ve form **ekranda açıkken**:

```powershell
cd oracle-ui
python inspect_form.py                              # pencereleri listeler
python inspect_form.py --title "Çıkış İrsaliyesi" --json agac.json
```

Bu betik **hiçbir şey yazmaz**, yalnızca okur.

### Adım 3 — `controls.json`

```powershell
copy controls.example.json controls.json
```

`agac.json` çıktısındaki gerçek değerlerle doldurun. Her alan için sırasıyla:

1. `automation_id` (en kararlı)
2. `title` (etiket metni kararlıysa)
3. `class_name` + `index` (**son çare** — uygulama güncellemesinde kayabilir)

Delphi/VCL formlarında çoğu kontrolde `automation_id` bulunmaz; o zaman
`class_name` + `index` kalır. Bu, otomasyonun en kırılgan noktasıdır ve
uygulama güncellendiğinde ilk kontrol edilecek yerdir.

### Adım 4 — Tek işle canlı prova

`ORACLE_DRY_RUN=1` iken worker'ı çalıştırın, log'daki alan listesini ekranla
karşılaştırın. Doğruysa **tek bir test formu** için `ORACLE_DRY_RUN=0` yapıp
sonucu Ceomed'de gözle doğrulayın.

Her koşuda `oracle-ui/screenshots/` altına gönderim öncesi ve sonrası ekran
görüntüsü yazılır. Bunlar hem kanıttır hem de hata teşhisinin tek yoludur —
silmeyin.

### Adım 5 — Task Scheduler

- **Genel:** "Yalnızca kullanıcı oturum açmışken çalıştır" — kilitli oturumda
  tuş vuruşları hedefine ulaşmaz.
- **Tetikleyici:** "Oturum açıldığında"
- **Eylem:** `run-oracle-worker.bat`, başlangıç dizini `scripts\ceomed-sync`
- **Ayarlar:** "Görev zaten çalışıyorsa yeni örnek başlatma"

Worker, Ceomed uygulamasının **açık ve irsaliye formunun ekranda** olduğu
makinede çalışmalıdır.

---

## Mükerrer kayıt koruması

Kuyruk dokümanının kimliği **form kimliğidir**. Aynı form iki kez irsaliye
üretemez — tarayıcı yenilense, batch tekrar denense ya da worker yeniden
başlatılsa bile. Bu, tam otomatik gönderim modunda pazarlık konusu değildir.

Buna ek olarak:

- İş, `processing` durumunu **atomik transaction** ile alır; iki worker aynı
  anda çalışsa bile aynı işi ikisi birden alamaz.
- Zaman aşımı ve tıklama hatası `retryable: false` döner. Sebep: gönderilip
  gönderilmediği **belirsizdir**; körlemesine tekrar denemek mükerrer muhasebe
  kaydı riski taşır. Bu işler `failed` olur ve insan bakışı bekler.
- Günlük gönderim tavanı (`ORACLE_MAX_PER_DAY`) otomasyon çıldırırsa muhasebeye
  sınırsız kayıt yağmasını engeller.

## Bilinen sınırlar

- **Miad alanı** Qore yedek parça stoğunda tutulmuyor (`YedekParcaDepoStokItem`
  ve `PersonalStockItem` yalnızca `serialNumber` + `lotNumber` taşıyor). Miadlı
  yedek parça takibi gerekiyorsa önce Qore stok modeline miad alanı eklenmeli.
- **Fiyat / iskonto / KDV** alanlarına dokunulmuyor; uygulamanın stok kodundan
  otomatik getirmesi bekleniyor. Getirmiyorsa irsaliye tutarsız kalır — ilk
  canlı provada bu gözle kontrol edilmeli.
- **Sevk Carisi** alanı boş bırakılıyor. Uygulama zorunlu tutuyorsa
  `controls.json`'a eklenip cari kodu ile aynı değer yazılmalı.
- UI sürücüsü çalışırken makinede **başka bir şey yapılmamalı**: tuş vuruşları
  odaktaki pencereye gider.
