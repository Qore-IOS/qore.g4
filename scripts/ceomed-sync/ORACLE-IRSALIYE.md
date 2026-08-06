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
| İrsaliye No | form numarasının **çevrilmiş** hali (`BT-T0042` → `BT10042`) — bkz. aşağıdaki not |
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

### Açıklama alanının saha ölçümü

Prova 5 sonrasında sol alttaki **Açıklama** ilk satırı elle odaklanarak
ölçüldü: MDI belgeye göre `(64, 667)`, ana pencereye göre `(70, 698)` ve
kontrol sınıfı `Edit`. Sürücü son ürün satırının Miktar alanında
olduğunu doğruladıktan sonra bu hücrenin içine tıklar, personel adını
yazar ve geri okur. Tıklama beklenen `Edit` alanını odaklamazsa hiçbir
değer yazılmadan iş durdurulur.

### İrsaliye No neden olduğu gibi yazılamıyor

Alanın kuralı ölçülmüştür: **2 harf + en fazla 6 rakam, toplam 8 karakter.**
Uygulama fazlasını *sessizce* kesiyor — `AB12345678901234567890` yazıldığında
alanda `AB123456` kalıyor, hiçbir uyarı çıkmıyor. Hatalı biçimde ise uyarı
veriyor: *"İrsaliye numarasının ilk 2 karakterinden sonrası, sadece rakam
olmalıdır"*.

Qore form numarası `${personelKodu}-${T|A}${sıra}` biçiminde (`BT-T0042`).
Tireyi silmek yetmez: `BTT0042` → ilk 2 karakterden sonra `T` harfi kalır,
reddedilir.

`ceomedIrsaliyeNo()` (`src/lib/ceomed/irsaliye-giris.ts`) dönüşümü yapar:

| Parça | Kural | Örnek |
|---|---|---|
| İlk 2 karakter | personel kodunun ilk 2 harfi (kısaysa `X` ile tamamlanır) | `BT` |
| 3. karakter | form tipi: `T`→`1`, `A`→`2` | `1` |
| Kalan | sıra numarası | `0042` |

`BT-T0042` → **`BT10042`**

**Sığmayan numara kesilmez, iş `blocked` damgalanır** (`form_no_ceomed_formatina_uymuyor`).
Sessiz kesilmeye izin vermek muhasebeye yanlış numara yazmak olurdu.

**Açık kalan ürün kararı — numara tekilliği.** Sayaç kullanıcı bazlı
(`${companyId}_${userUid}_${formTypeLetter}`), dolayısıyla aynı baş harfli iki
personel aynı numarayı üretebilir: "Batuhan Tubasar" ve "Burak Toprak" ikisi de
`BT-T0042` → `BT10042`. İrsaliye numarası yasal olarak tekil olmak zorundadır.
Çözüm ya sıra numarasını şirket bazına çekmek ya da personele sabit 2 karakterlik
kod atamaktır; ikisi de sürücünün değil ürünün kararıdır.

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

## API keşfi — YAPILDI (2026-08-06), sonuç: web API'si bu işi yapamıyor

Bu bölüm bir "yapılacaklar" listesi değil, **tamamlanmış bir ölçümün tutanağıdır**.
Aynı araştırmayı tekrar yapmayın; yeni bilgi çıkarsa buraya işleyin.

### Ölçüm 1 — Masaüstü uygulaması nereye bağlanıyor?

Ceomed masaüstü uygulaması açık ve irsaliye formu ekrandayken:

```powershell
Get-Process | Where-Object { $_.MainWindowTitle -like "*CEOMED*" } |
  Select-Object Id, ProcessName, MainWindowTitle
Get-NetTCPConnection -OwningProcess <PID> | Select-Object RemoteAddress, RemotePort, State
```

**Sonuç:**

```
Process : ifrun60          (Oracle Forms 6i çalışma zamanı)
Bağlantı: 192.168.1.5:1521  Established
```

Tek canlı bağlantı **1521** — Oracle TNS listener. Araya HTTP servisi yok, yani
masaüstü uygulamasının isteğini yakalayıp taklit etmek mümkün değil.

Not: `192.168.1.5`, okuma tarafında kullandığımız web Ceomed'in (`:8081`) de
sunucusudur. Aynı makine, farklı iki istemci.

### Ölçüm 2 — Web API'sinin tam yüzeyi

Web arayüzü AngularJS; `appConfig.apiRootUrl="api"` ve tüm uç noktalar
`build/app.js` içinde `a.api("POST"|"GET", "/modul/metod", {params})` biçiminde
tanımlı. Tam katalog:

```powershell
$js = (Invoke-WebRequest -Uri "http://192.168.1.5:8081/build/app.js?v=1.30" -UseBasicParsing).Content
$pattern = '_\.[A-Z_0-9]+=function\([^)]*\)\{var\s+\w+=\{[^{}]*\};return a\.api\("(?:GET|POST)","[^"]+"'
[regex]::Matches($js, $pattern) | ForEach-Object { $_.Value } | Out-File -Encoding utf8 katalog.txt
```

**187 uç nokta bulundu. Hiçbiri çıkış irsaliyesi oluşturmuyor.**

En yakın üç aday ve neden yetmedikleri:

| Uç nokta | Parametreleri | Neden olmuyor |
|---|---|---|
| `/dogrulama/insertIrsaliye` | `IRSALIYE_NO, DEPO_KODU` | Cari kodu yok. **Var olan** bir irsaliyeyi doğrulamaya başlatır |
| `/irsaliye/insertIrsaliyeImportMaster` | `CARI_KODU, REFERANS_NO, EVRAK_TIPI, ACIKLAMA, ID_DEPO` | Tarih ve işlem tipi yok; `EVRAK_TIPI` yalnızca `IMPORT`/`SAYIM` — giriş/sayım belgesi |
| `/sevk/insertDepoTransferEvrak` | `CARI_KODU, KAYNAK_DEPO, HEDEF_DEPO, P_EVRAK_TARIHI, P_ISLEM_TIPI` | Yapı olarak en yakını (belge aç → satır ekle → onayla üçlüsü, işlem tipi bile var) ama **depolar arası transfer**, müşteriye çıkış değil |

Adı en umut verici olan `/sevk/insertIrsaliyeMaster` yanıltıcıdır:

```js
_.INSERT_IRSALIYE_MASTER = function(e){
  var r = { IRSALIYE_NO: e };                       // TEK parametre
  return a.api("POST", "/sevk/insertIrsaliyeMaster", r, !1).data
}
```

Belge oluşturmaz; mevcut bir sevk kaydına irsaliye numarası işler. **Uç nokta
adına bakıp `apiDriver.js`'i doldursaydık, muhasebeye çöp gönderirdik.**

### Belirleyici eksik: e-irsaliye gönderimi

Katalogda e-irsaliye/e-fatura gönderen **tek bir uç nokta yok**. `kurumSevkGonder`
mevcut bir `ID_SEVK_MASTER` üzerinde çalışır, yeni belge göndermez.

Bu tek başına meseleyi kapatır: belge bir şekilde oluşturulabilse bile akışın son
adımı — **E-İRSALİYE GÖNDER** — web tarafından tetiklenemez. O adım yasal olarak
anlamlıdır, atlanamaz.

API'nin genel şekli de bunu doğrular: bu bir depo/barkod operasyon API'sidir.
Belgeler masaüstü uygulamasında (doğrudan Oracle'da) açılır; web yalnızca barkod
okutup onaylar.

### Karar: UI otomasyonu

Ceomed Yazılım'a çıkış irsaliyesi oluşturan + e-irsaliye gönderen bir uç nokta
sorulmuş, **olumsuz cevap alınmıştır** (2026-08-06). API yolu kapalıdır;
`drivers/apiDriver.js` bu yüzden boş kalmaya devam eder.

---

## UI ölçümü — `ifrun60` ne tür bir arayüz çiziyor?

`inspect_form.py --title "rsaliyesi"` çıktısının özeti:

**Pencere hiyerarşisi** (Oracle Forms 6i — `ifrun60.exe` = Interactive Forms Runtime 6.0):

```
ui60MDIroot_W32  "… CEOMED YAZILIM V:12c … [ Çıkış İrsaliyesi Yeni ** ]"
└─ MDIClient
   └─ ui60MDIdocument_W32  "Çıkış İrsaliyesi"
      └─ ui60Drawn_W32     ← form buraya ÇİZİLİYOR
```

**Butonlar gerçek ve isimle bulunabiliyor** — 40'tan fazla `Button`, hepsi
okunabilir metinle:

```
[Button] text='E-IRSALIYE GÖNDER'   (L-589, T633, R-424, B663)
[Button] text='E-IRSALIYE ÖNİZLE'
[Button] text='Belge Tamamlandı'
[Button] text='Açık Siparişler'
```

Akışın en riskli adımı — gönder butonu — koordinata değil `title`'a bağlanabilir.
Pencere kaysa ya da boyut değişse bile doğru butona basılır.

**Form alanları kontrol DEĞİL.** Yalnızca 6 gerçek boyutlu `Edit` var (alt
taraftaki açıklama ve e-irsaliye kutuları). İrsaliye No, Cari Kodu, Tarih, İşlem
Tipi, Depo ve grid `ui60Drawn_W32` tuvaline çizilmiştir; `child_window()` ile
bulunamazlar.

**Kritik ipucu:** sıfır boyuta park edilmiş `Edit` kontrollerinden biri ekrandaki
İrsaliye No değerini taşıyor:

```
[Edit] text='SI007787'  (L-1920, T1, R-1920, B1)   ← sıfır boyut
```

Bu, Oracle Forms'un bilinen davranışına işaret eder: odaktaki alan için gerçek bir Edit
kontrolü açılır, alanın üstüne taşınır, odak gidince geri park edilir. Doğruysa
her alan yazıldıktan sonra **geri okunabilir** — e-irsaliye gönderimi geri
alınamadığı için bu güvence pazarlık konusu değildir.

### Bunu ölçen betik: `probe_focus.py`

```powershell
cd scripts\ceomed-sync\oracle-ui
python probe_focus.py --json odak.json
```

Ceomed penceresine geçip İrsaliye No alanına tıklayın, TAB'a yavaşça 15-20 kez
basın, sonra Ctrl+C. Betik hiçbir şey yazmaz; odağın hangi kontrole düştüğünü,
kontrolün boyutunu ve değerini kaydeder.

Çıktı iki şeyi birden verir:

1. **Alanların TAB sırası** — sürücü klavye gezinmesini bu sıraya göre kuracak.
2. **Geri okuma mümkün mü** — odak görünür boyutlu bir `Edit`'e düşüyorsa evet.

Odak hiç görünür kontrole düşmezse doğrulama yalnızca gönderim öncesi ekran
görüntüsüne kalır; o durumda tam otomatik gönderim yeniden değerlendirilmelidir.

### Ölçüm 3 sonucu — geri okuma ÇALIŞIYOR

`probe_focus.py` turunda 22 odak olayının **hepsi** gerçek, boyutlu bir `Edit`
kontrolüne düştü ve değerleri okundu (`SI007787`, `06/08/2026`, `02`, `01`).
Hipotez doğrulandı: Forms çalışma zamanı odaktaki alan için gerçek bir Edit açıp
alanın üstüne taşıyor.

**Sonuç: "yaz → geri oku → uyuşmazsa gönderme" güvencesi korunabiliyor.**
Tam otomatik gönderim kararı bu güvenceye dayanır; kaybedilirse karar yeniden
değerlendirilmelidir.

Ölçülen alan konumları (pencere ikinci ekranda olduğu için ham koordinatlar
negatif; form içi konum = ham + 1920):

| Sıra | Alan | Form içi (x, y) | Okunan |
|---|---|---|---|
| 1 | İrsaliye No | (114, 51) | `SI007787` |
| 2 | Tarih | (237, 51) | `06/08/2026` |
| 3 | Fiili Sevk Tarihi | (435, 48) | `06/08/2026` |
| 4 | Cari Kodu | (114, 70) | |
| 8 | Sevk Adresi | (114, 112) | `EĞİTİM MAH. DR. ERKİN CAD.` |
| 9 | İşlem Tipi | (846, 87) | `02` (bizde `35` olacak) |
| 12 | Depo | (846, 107) | `01` (bizde `10` olacak) |
| 13-15 | Teslim Eden / Teslim Alan / Anlaşma No | (846, 127-186) | |
| 16 | Grid ilk hücre (Stok Kodu) | (5, 235) | |
| 22 | **E-IRSALIYE GÖNDER** (Button) | — | |

### Açık kalan üç soru

1. **Grid içinde gezinme.** Grid'in ilk hücresinden sonra TAB grid'den *çıkıp*
   alt bölüme atladı. Stok Kodu → Lot → Miktar geçişi başka bir tuşla oluyor
   (ok tuşu veya ENTER). Bu bilinmeden satır yazılamaz.
2. **Tab sırası eksik.** Cari Kodu'ndan sonra açılan arama penceresi sırayı
   böldü; Sevk Carisi, Posta Kodu, İl Kodu, Ref No hiç görülmedi.
3. **Arama pencereleri.** Cari Kodu ve Depo alanlarında `ui60Drawn_W32` +
   `Tamam` butonlu bir arama penceresi açıldı. Kendiliğinden mi açılıyor yoksa
   kullanıcı ▼ butonuna mı tıkladı — belirsiz. Kendiliğinden açılıyorsa sürücü
   bu pencereyi kapatmayı bilmeli.

### `probe_keys.py` — tuşu betik gönderir

`probe_focus.py`'de tuşlara kullanıcı bastığı için hangi hareketin hangi tuştan
geldiği kesin değildi. Bu betik tuşları kendisi gönderir:

```powershell
# Temiz tab sırası (arama pencereleri araya girmeden)
python probe_keys.py --tuslar "TAB*25" --json tabsirasi.json

# Grid içinde sütun geçişi hangi tuşla?
python probe_keys.py --tuslar "RIGHT*4"
python probe_keys.py --tuslar "ENTER*4"
```

Güvenlik sınırları koda gömülüdür:

* Yalnızca **gezinme** tuşları gönderilir (TAB, oklar, ENTER, ESC, HOME, END).
  Harf/rakam gönderilemez — `--tuslar 35` reddedilir. Bu bir ölçüm aracıdır,
  veri girme aracı değil.
* Butona tıklamaz; E-İRSALİYE GÖNDER'e asla dokunmaz.
* Tuşları göndermeden önce ön plandaki pencerenin başlığını doğrular; yanlış
  pencere öndeyse **hiçbir tuş göndermeden** çıkar.

Yine de YENİ ve BOŞ bir irsaliye formunda çalıştırın: ENTER bazı formlarda kaydet
anlamına gelir.

### Ölçüm 4 sonucu — arama penceresi (LOV) planı değiştirdi

`probe_keys.py --tuslar "TAB*25"` turu, Cari Kodu'ndan Tab'la çıkmanın tek başına
bir **arama penceresi açtığını** gösterdi:

```
 3  TAB  Edit           (-1806,70,…)    ''      ← Cari Kodu
 4  TAB  ui60Drawn_W32  (25,97,1537,894)        ← PENCERE AÇILDI
 5  TAB  Button 'Bul'
 6  TAB  Button 'Tamam'
 7  TAB  Button 'İptal'
 8  TAB  Edit           (547,52,1109,85) '%'    ← arama filtresi
 9-25 … aynı dört durak, sonsuza kadar
```

Pencere kullanıcı tıklamasıyla değil, alandan çıkmakla açılıyor ve **Tab pencereden
dışarı çıkmıyor**. "Alanı yaz, Tab'la geç" varsayımına dayanan bir sürücü ilk cari
kodunda sonsuz döngüye girerdi.

`--tuslar "ENTER*4"` turu çıkışı gösterdi: ENTER, listede seçili satırı `Tamam`
sayıp pencereyi kapatıyor ve form kendiliğinden doluyor (Sevk Adresi geldi).

**Tasarım sonucu:** liste `ui60Drawn_W32` olduğu için içeriği okunamaz — hangi
satırın seçili olduğunu görmeden `Tamam`'a basmak kabul edilemez. Sürücü pencereyle
savaşmak yerine onu kullanacak:

1. Filtre alanına cari kodunu yaz
2. `Bul`
3. `Tamam`
4. **Pencere kapandıktan sonra Cari Kodu alanını geri oku**
5. Beklenen kod değilse işi `failed` damgala, gönderme

Liste okunamıyor ama sonucu okunabiliyor; güvence böyle korunuyor.

### Birleşik tab sırası

| # | Alan | Form içi (x,y) | Not |
|---|---|---|---|
| 1 | İrsaliye No | (114, 51) | uygulama üretir |
| 2 | Tarih | (237, 51) | |
| 3 | Fiili Sevk Tarihi | (435, 48) | |
| 4 | Cari Kodu | (114, 70) | → arama penceresi |
| 5 | Sevk Adresi | (114, 112) | seçimle otomatik dolar |
| 6 | İşlem Tipi | (846, 87) | `35` |
| 7 | Depo | (846, 107) | `10` → arama penceresi |
| 8-10 | Teslim Eden / Teslim Alan / Anlaşma No | (846, 127-186) | |
| 11 | Grid — Stok Kodu | (5, 235) | |
| son | **E-IRSALIYE GÖNDER** | Button | |

### `probe_type.py` — yazan prob

Kalan iki soru yazmadan cevaplanamıyor: (a) cari kodu YAZILINCA pencere yine
açılıyor mu, (b) grid'de sütun geçişi hangi tuşla. `probe_keys.py` metni bilerek
reddettiği için ayrı araç:

```powershell
python probe_type.py --adimlar "YAZ:120.01.001,TAB" --onayla
python probe_type.py --adimlar "YAZ:TESTKOD,RIGHT" --onayla   # grid hücresinden başlayarak
```

Canlı uygulamaya yazdığı için sınırlar koda gömülü:

* `--onayla` yoksa planı basar, hiçbir şey göndermez.
* **Her adımdan önce** odaktaki kontrol okunur; odak GÖNDER / SIL / TAMAMLANDI /
  GÜNCELLE / YAZDIR / KOPYALA / ONAYLA / KAYDET / İPTAL içeren bir butondaysa
  betik durur. ENTER odaktaki butona bastığı için bu koruma olmadan yanlış bir
  adım e-irsaliye gönderebilirdi. Arama penceresinin `Tamam` ve `Bul` butonları
  bilerek serbesttir — gerekli ve geri alınabilirler.
* Ön plandaki pencere başlığı doğrulanır; yanlışsa hiçbir şey gönderilmez.
* Fare kullanılmaz, butona tıklanmaz.

Koruma gerçek buton metinleriyle doğrulandı: `E-IRSALIYE GÖNDER`, `Belge
Tamamlandı`, `SIL`, `Ref No Güncelle`, `İrsaliye Yazdır`, `Fatura Kopyala` bloke;
`Tamam`, `Bul`, `E-IRSALIYE ÖNİZLE` geçiyor.

Ölçüm formunu her zaman KAYDETMEDEN kapatın.

### Ölçüm 5 sonucu — yazma davranışı ve doğrulama penceresi

`probe_type.py` turları dört şey gösterdi:

**1. Alan temizlenmeden yazılırsa değer BİRLEŞİYOR.**

```
0  (başlangıç)         'm51016'      ← alan zaten doluydu
1  YAZ '120.01.001'    'm5101612'    ← üstüne eklendi, 8 karakterde kesildi
2  TAB                 'm5101612'    ← odak ilerlemedi
```

Sürücü **her alanı yazmadan önce temizlemek zorundadır**. Aksi halde muhasebeye
`m5101612` gibi uydurma cari kodları gider. `probe_type.py` bunun için `TEMIZLE`
adımı sunar (END + BACKSPACE×40; Forms alanlarında seçim davranışı öngörülemez
olduğu için Ctrl+A tercih edilmedi).

**2. Geçersiz değer odağı hapsediyor.** Yukarıdaki turda TAB odağı ilerletmedi.
Forms alandan çıkışta `WHEN-VALIDATE-ITEM` çalıştırıyor; tetikçi hata verirse navigasyonu durduruyor. Bu bedava
bir hata sinyalidir: *TAB'dan sonra odak aynı kontroldeyse değer reddedilmiştir.*
`probe_type.py` bu durumu artık kendisi işaretler.

**3. Yazma davranışı odağın nasıl geldiğine bağlı.** Aynı alanda aynı komut iki
farklı sonuç verdi — bir turda yazı hiç girmedi (`'SI007788'` kaldı), başka bir
turda değeri tamamen değiştirdi (`'TEST'` oldu). Fark, tıklamanın metni seçili
bırakıp bırakmamasında. Bu belirsizlik tek başına yaz-sonra-geri-oku
doğrulamasını zorunlu kılar.

**4. Doğrulama hatası MODAL pencere açıyor.**

```
2  ENTER   Button  (925,593,1001,628)  '&Tamam'
```
> İrsaliye numarasının ilk 2 karakterinden sonrası, sadece rakam olmalıdır!!!

Sürücü bu pencereyi tanımazsa sonraki tuşlar oraya gider ve form yarım kalır.
`probe_type.py` artık odak bir butondayken pencerenin tüm metinlerini toplar —
sürücü işi `failed` damgalarken hatanın kendisini loglayabilsin diye. "Bir uyarı
çıktı" yetmez.

### ⚠ Alan eşlemesinde düzeltme gerekiyor: İrsaliye No

Uyarı mesajı formatı ele veriyor: **ilk 2 karakter harf, gerisi rakam**
(`SI007787` → `SI007788`). Numarayı **uygulama kendisi üretiyor.**

Bu belgenin başındaki eşleme tablosunda "İrsaliye No ← form numarası (`formNo`)"
yazıyor. **Bu yanlıştır:** Qore form numarasını oraya yazmak hem formatı bozar
hem uygulamanın numara sırasını kırar.

Doğrusu: İrsaliye No'ya **hiç dokunmamak**, Qore form numarasını Açıklama veya
Ref No alanına koymak. Hangisi olacağı muhasebeyle teyit edilmelidir; teyit
gelene kadar sürücü İrsaliye No'ya dokunmaz.

### Başlangıç alanı doğrulaması

Ölçümlerin üçü, yanlış alandan başlandığı için boşa gitti (grid hücresi yerine
İrsaliye No'ya tıklanmıştı). `probe_type.py` artık `--baslangic` ile bunu
engeller:

```powershell
python probe_type.py --baslangic grid --adimlar "TEMIZLE,YAZ:TEST,RIGHT" --onayla
```

Odak beklenen alanda değilse **hiçbir şey gönderilmeden** durur. Konumlar ham
ekran koordinatı değil pencereye göre tutulur (pencere taşınınca bozulmasın):

| Ad | Pencere içi (x, y) |
|---|---|
| `irsaliyeno` | (123, 113) |
| `tarih` | (246, 113) |
| `carikodu` | (123, 132) |
| `islemtipi` | (855, 149) |
| `depo` | (855, 169) |
| `grid` | (14, 297) |

### Ölçüm 6 sonucu — grid, uyarı penceresi ve İrsaliye No formatı

**Grid'de `RIGHT` sütun değiştirmiyor** — sadece imleci metin içinde oynatıyor:

```
2  YAZ 'TEST'   pen(14,297)  'TEST'
3  RIGHT        pen(14,297)  'TEST'    ← aynı hücre
```

`TAB` ve `ENTER` ikisi de uyarı penceresi açtı, ama sebebi `TEST`'in gerçek bir
stok kodu olmaması. Hangisinin sütun değiştirdiği **hâlâ ölçülmedi**; gerçek bir
stok koduyla tekrarlanmalı.

**Uyarı penceresinin mesajı okunamıyor.** `EnumChildWindows` yalnızca `'&Tamam'`
getirdi; mesaj da tuvale çizilmiş. Sürücü bir uyarı penceresi açıldığını
anlayabilir ama **nedenini okuyamaz** — teşhis için ekran görüntüsü almalı ve işi
`failed` damgalarken loga onun yolunu yazmalı.

### Ölçüm 7 — çalışma zamanı Oracle Forms 6i, ve hatalar her zaman pencere açmıyor

Grid'de gerçek bir stok kodu (`ALK-BİO-E-CI`) LOV'dan seçildikten sonra ENTER da
TAB da odağı ilerletmedi. Formun alt mesaj satırında şu çıktı:

```
WHEN-VALIDATE-ITEM tetikçisi, işlenemeyen kuraldışı durum ortaya çıktı ORA-01403.
```

**İki sonuç:**

**1. Çalışma zamanı Oracle Forms 6i.** `WHEN-VALIDATE-ITEM` ve `ORA-01403` Oracle
Forms kavramları; `ifrun60.exe` = Interactive Forms Runtime 6.0 ve `ui60*` pencere
sınıfları da onun. (Bu belgenin önceki sürümlerinde "Informix 4GL" yazıyordu —
yanlıştı, düzeltildi. Ölçülen davranışların hiçbiri değişmiyor.)

**2. Hata her zaman modal pencere açmıyor.** Bu sefer uyarı yalnızca alt mesaj
satırında göründü — pencere yok, buton yok, `EnumChildWindows` ile yakalanacak bir
şey yok. Sürücü "modal pencere açıldı mı" sinyaline dayanırsa bu sınıf hatayı
tamamen kaçırır.

Güvenilir sinyal `odak_ilerledi_mi()`: Forms, `WHEN-VALIDATE-ITEM` hata verdiğinde
navigasyonu durdurur. **Odak kıpırdamadıysa değer reddedilmiştir** — modal olsun
olmasın çalışır. Sürücü buna dayanır.

**ORA-01403 = "veri bulunamadı".** Stok kodu geçerliydi (LOV'dan seçildi), ama
doğrulama tetikçisi arka planda boş dönüyor. Ölçüm sırasında Cari Kodu ve Depo boştu;
stok doğrulaması büyük olasılıkla depo/cari üzerinden bakiye arıyor. Yani **grid tek
başına ölçülemez, form sırayla dolmak zorunda.** Grid sütun geçişi ölçümü, header
gerçek değerlerle doldurulduktan sonra tekrarlanmalıdır.

### Ölçüm 8 — grid sütun sırası çözüldü (header dolu olduğunda)

Header gerçek değerlerle doldurulduktan sonra grid ölçümü çalıştı. ENTER, LOV
kabul edildikten sonra sütunları geziyor:

```
 3  ENTER → LOV açıldı
 5  ENTER → kabul, odak pen(575,297)
 7  ENTER → pen(649,297)
 9  ENTER → pen(725,297)
11  ENTER → pen(760,297)
```

| Pencere içi x | Sütun | Qore kaynağı |
|---|---|---|
| `14` | **Stok Kodu** | yedek parçanın stok kodu (LOV açar) |
| `575` | **LOT** | seri no varsa seri no, yoksa lot |
| `649` | **Miat** | ürün miadı — genelde boş |
| `725` | **KT** | dokunulmuyor |
| `760` | **Miktar** | formdaki adet |

**Stok Adı atlanıyor** — uygulama stok kodundan kendisi dolduruyor.

Bu ölçüm ayrıca `ORA-01403`'ün sebebini doğruladı: header boşken stok doğrulaması
bakiye bulamıyordu. Form **sırayla** dolmak zorunda.

### Odak kimliği `hwnd` DEĞİL, `(hwnd, konum)`

11. adımda prob "odak ilerlemedi" dedi ama odak gerçekten 725'ten 760'a geçmişti.
Sebep: **Forms ardışık alanlar için çoğu zaman aynı `Edit` kontrolünü taşıyıp
yeniden kullanıyor** — `hwnd` sabit kalıyor, yalnızca dikdörtgen değişiyor.

`hwnd` karşılaştıran bir kontrol bu geçişi "ilerlemedi" sanar ve geçerli bir
değeri reddedilmiş gibi raporlar. `ui60.odak_ilerledi_mi()` ve `probe_type.py`
düzeltildi: kimlik artık `(hwnd, konum)`.

Sürücü bu sinyale dayandığı için hata sessiz değildi — gerçek bir işte geçerli
satırları reddederdi.

### Prova 1 — form doğru doldu, doğrulama yanlış yeri okudu

İlk kuru çalışmada başlık doğru dolduruldu:

```
İrsaliye No : BT10042        ✓
Tarih       : 06/08/2026     ✓
Cari Kodu   : M51009         ✓  → SANCAKTEPE ŞEHİT PROF. DR. İLHAN VARANK
Sevk Adresi : otomatik doldu
Posta/İl    : otomatik doldu
```

Ama sürücü durdu:

```
cariKodu: arama penceresinden 'EMEK, NAMIK KEMAL CD. NO:7' seçildi,
beklenen 'M51009'
```

`M51009` alana doğru yazılmıştı. Hata doğrulamada: **Forms, LOV kabul edilince
odağı bir sonraki alana taşıyor**, sürücü de "odaktaki alanın değeri" diye Sevk
Adresi'ni okuyordu.

Bu, "odakta olmayan alan okunamaz" kısıtının doğrudan sonucu. Çözüm: odak
ilerlediyse `SHIFT+TAB` ile alana geri dön, oku, sonra ileri dön. Geri dönüşte
beklenen alana varılamazsa iş durur — körlemesine kabul edilmez.

`ui60.tus()` artık `SHIFTTAB` destekliyor.

### Prova 2 — zincir baştan sona çalıştı

SHIFT+TAB düzeltmesiyle sürücü başlıktan grid satırına kadar gitti:

```
İrsaliye No : BT10042                              ✓
Cari Kodu   : M51009 → SANCAKTEPE ŞEHİT PROF. …    ✓
İşlem Tipi  : 35 YEDEK PARÇA                       ✓
Depo        : 10 OFİS YEDEK PARÇA                  ✓
Grid        : 03753379001 PİNCH TUBE E 170 (4 PCS) ✓
```

Konumdan alan tanıma, LOV açma/kabul/geri okuma ve grid satırı yazma zincirinin
tamamı gerçek formda doğrulandı.

### ⚠ Türkçe karakter kaybı — geri okuma bunu YAKALAYAMAZ

İlk denemede stok kodu `ALK-BİO-E-CI` verildi; grid'de `ALK-B?O-E-CI` göründü ve
stok kartı bulunamadı.

Önemli ayrım: **tuş gönderimi doğru çalışıyor.** Prob turlarında aynı metin
alana yazılıp `Edit`'ten `ALK-BİO-E-CI` olarak geri okunabilmişti. Kayıp, Forms
değeri veritabanına yazarken oluşuyor — Oracle karakter kümesi `İ` harfini
taşımıyor.

Bunun sonucu: **yaz-sonra-geri-oku güvencesi bu hata sınıfını kapsamıyor.**
Alandaki değer doğru görünürken commit anında bozuluyor. Bu yüzden sürücü ASCII
dışı karakter içeren stok kodunu **denemeden durduruyor**; stok kodu Ceomed'deki
gerçek yazımıyla girilmelidir.

### Hata çıktısına `log` eklendi

Bir kuru çalışma tıkandığında "nerede durdu" sorusunun cevabı adım geçmişinde;
ekran görüntüsü tek başına yetmiyor. `fail()` artık `log`'u her zaman döndürüyor
ve grid satırında hangi sütunun beklendiği de loga yazılıyor.

### Prova 3 — konumlar MDI belge penceresine göre tutulmalı

İki hata çıktı, ikisi de öğretici.

**1. Konum kayması.**

```
odak (9, 100) konumunda, İrsaliye No bekleniyordu   [beklenen (123, 113)]
```

Odak doğru alandaydı ama koordinatlar kaymıştı. Sebep tasarımdaki bir
zayıflıktı: konumlar **ana pencereye** göre ölçülüyordu. Ceomed bir MDI
uygulaması — form, ana pencerenin içinde ayrı bir alt pencerede (`ui60MDIdocument_W32`)
duruyor. Ana pencere yeniden boyutlanınca ya da form penceresi içeride kayınca
bütün ölçümler bozuluyor.

Düzeltme: konumlar artık **MDI belge penceresine** göre. `ui60.odak()` bunun için
`mdi_ici` alanı döndürüyor; `mdi_belge_kokü()` kontrolü içeren MDI alt penceresini
buluyor. Ham ölçümler ana pencere kökü `(-1929,-62)`, MDI belge kökü `(-1923,-31)`
ile yapılmıştı; aradaki `(-6,-31)` farkı tabloya işlendi.

`--tani` modu eklendi: hiçbir şey yazmadan odağın `mdi_ici` konumunu bildirir.
Tablo başka bir kurulumda kayarsa gerçek değerler bununla ölçülür.

**2. İrsaliye No reddedildi.**

```
irsaliyeNo: 'BT10042' yazıldı ve geri okundu
→ irsaliyeNo alanından çıkılamadı — uygulama değeri reddetti
```

Değer alana yazıldı, geri okundu, doğrulandı — ama Forms alandan çıkmaya izin
vermedi. Aynı numara üçüncü kez deneniyordu: **uygulamanın kendi mükerrer
koruması** çalışıyor ve sürücü onu doğru okuyor. Hata mesajına bu ipucu eklendi.

Bu, `odak_ilerledi_mi()` sinyalinin gerçek bir işte beklendiği gibi çalıştığını
da gösteriyor — modal pencere açılmadan, yalnızca navigasyonun durmasından.

### ⚠ İrsaliye No: muhasebe Qore form numarasını istiyor, ama format uymuyor

Muhasebe kararı: Qore form numarası İrsaliye No alanında görünecek. Ancak Qore'un
ürettiği numara Ceomed'in kuralına **olduğu gibi uymuyor.**

Qore formatı (`src/lib/form-number.ts:55`):

```ts
return `${personnelCode}-${formTypeLetter}${formatSeq(seq)}`;   // BT-T0042
```

Ceomed kuralı: *ilk 2 karakterden sonrası sadece rakam.*

| Deneme | Sonuç |
|---|---|
| `BT-T0042` → tire silinir → `BTT0042` | ilk 2 = `BT`, kalan `T0042` → **`T` harfi var, reddedilir** |
| 3 isimli personel: `AMY-T0042` → `AMYT0042` | ilk 2 = `AM`, kalan `YT0042` → **reddedilir** |

İki ayrı sorun:

1. **Form tipi harfi** (`T`/`A`) rakam bölgesine düşüyor.
2. **Personel kodu sabit uzunlukta değil** — `buildPersonnelCode` isimdeki tüm
   kelimelerin baş harflerini alır, 3+ harf olabilir.

**Önerilen dönüşüm** (karar muhasebeyle birlikte verilmeli):

| Parça | Kural | Örnek |
|---|---|---|
| İlk 2 karakter | personel kodunun ilk 2 harfi | `BT` |
| 3. karakter | form tipi: `T`→`1`, `A`→`2` | `1` |
| Kalan | sıra numarası | `0042` |

`BT-T0042` → `BT10042`

**Çözülmemiş risk:** sayaç kullanıcı bazlı olduğu için aynı baş harfli iki
personel aynı numarayı üretebilir (`BT-T0042`). Qore tarafında bu zaten
mevcut bir durum, ama irsaliye numarası yasal olarak tekil olmak zorundadır.
Sıra numarasının global yapılması veya personel koduna ayırt edici bir parça
eklenmesi gerekir — bu bir ürün kararıdır, sürücü tek başına çözemez.

**Ölçülmesi gereken:** alanın karakter sınırı. Cari Kodu 8 karakterde kesiyordu;
İrsaliye No da 8 ise 5 haneli sıra numarasında (`BT110042`) tam sınırda kalınır ve
sessiz kesilme muhasebeye yanlış numara gönderir.

```powershell
python probe_type.py --baslangic irsaliyeno --adimlar "TEMIZLE,YAZ:AB12345678901234567890" --onayla
```

TAB yok, uyarı penceresi çıkmaz; prob artık `Edit` değerlerinin uzunluğunu da
yazdırır.

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
