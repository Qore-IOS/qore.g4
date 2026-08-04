# Deploy rehberi — seri no defteri, kural düzeltmesi ve Ceomed watcher

Bu belge, #1760 → #1764 arasındaki değişikliklerin canlıya alınması için
**elle yapılması gereken her adımı** sırasıyla anlatır.

> ## ⚠ Sıralama kritik
>
> **Firestore kuralları, uygulama kodundan ÖNCE yayınlanmalıdır.**
>
> Yeni kod her mal kabul / tüketim / transfer işleminde `serialLedger`
> koleksiyonuna da yazar ve bu yazım stok yazımıyla **aynı batch**'tedir.
> `serialLedger` kuralı canlıda yoksa Firestore yazımı reddeder, batch komple
> düşer ve **mal kabul ile tüketim tamamen çalışmaz**.
>
> Ters sıra (önce kural, sonra kod) güvenlidir: eski kod `serialLedger`'a hiç
> yazmaz, yeni kural fazladan durur, kimse etkilenmez.

---

## Adım 0a — Her komuta `--project invpilot` yazın

Üretim veri düzlemi (Firestore, Auth, Functions) **`invpilot`** projesindedir:
`apphosting.yaml` → `NEXT_PUBLIC_FIREBASE_PROJECT_ID: "invpilot"`,
`public/firebase-config.js` ve `.firebaserc` (`projects.default`) hepsi bunu
gösterir. `roche-logistics-hub` eski/paralel bir projedir — v2 stok, istatistik
ve maliyet fonksiyonlarının hiçbiri orada yoktur.

`firebase deploy` **`.firebaserc`'yi değil, son `firebase use` durumunu**
kullanır. Bu bir kez yanlış projeye deploy'a yol açtı: `--project` verilmeyen
`functions:onUserClaimSync` deploy'u `roche-logistics-hub`'a gitti, üretimdeki
kopya güncellenmedi.

Bu yüzden aşağıdaki komutların hepsinde proje **açıkça** yazılıdır. `firebase
use invpilot` **çalıştırmayın** — hosting deploy'u başka bir projeye gittiği
için global durumu değiştirmek onu bozar.

> **Yayın sonrası teyit:** `firebase deploy` çıktısının ilk satırı
> `=== Deploying to 'invpilot'...` demiyorsa **durdurun**, komutu `--project`
> ile tekrarlayın ve yanlış projeye gitmiş olanı geri alın.

## Adım 0 — Claim'leri doğrula (yazma yok)

Kuralların çalışması `request.auth.token.companyId` custom claim'ine bağlıdır.
Claim'i olmayan kullanıcı, kurallar yayınlandığı anda **hiçbir veriyi okuyamaz
ve yazamaz**.

```bash
# Firebase Studio / Cloud Shell gibi ortamlarda kimlik bilgisi ZATEN hazırdır —
# hiçbir şey ayarlamayın (GOOGLE_APPLICATION_CREDENTIALS TANIMSIZ olmalı).
# Proje kimliği .firebaserc'den otomatik çözülür.
#
# Yalnızca kendi makinenizde çalışıyorsanız bir anahtar gerekir:
#   Firebase Console → Project settings → Service accounts → Generate new private key
#   export GOOGLE_APPLICATION_CREDENTIALS=/indirdiginiz/gercek/dosya.json

pnpm rules:preflight
```

> Yukarıdaki yol bir ÖRNEKTİR; olduğu gibi kopyalamayın. Var olmayan bir yol
> verilirse script `ENOENT` ile durur (artık ne yapılacağını da söyler).

Hiçbir şey yazmaz, yalnızca raporlar. Sorun varsa çıkış kodu 1 döner.

Proje kimliği `.firebaserc`'den otomatik çözülür (`FIREBASE_PROJECT_ID` ile
ezebilirsiniz). Script bağlandığı projeyi başlıkta yazar — **doğru projeyi
gösterdiğini teyit edin.**

> **Bu adım atlanırsa ne olur:** bir kez atlandı ve üretimde tüm kullanıcılar
> stok göremez hâle geldi. `sync-claims.js` proje kimliğini çözemediği için 112
> kullanıcının hepsinde hata verdi, hiçbir claim yazılmadı, ama kurallar yine de
> yayınlandı. **Firestore kısmı çalıştığı için hata "script çalışıyor" gibi
> görünüyordu** — yalnızca `admin.auth()` düşüyordu. Token'ında `companyId`
> olmayan kullanıcı için `inCompany()` daima false döner.

## Adım 1 — Claim senkronunu kur ve çalıştır

Önce fonksiyonu yayınlayın (bundan sonraki her `users/{uid}` yazımında claim
otomatik güncellensin):

```bash
firebase deploy --only functions:onUserClaimSync --project invpilot
```

Sonra mevcut kullanıcılar için tek seferlik doldurma:

```bash
node scripts/sync-claims.js            # dry-run — ne değişecek gösterir
node scripts/sync-claims.js --apply    # uygula
```

`pnpm rules:preflight` **temiz çıkana kadar** tekrarlayın. `users` dokümanında
`companyId` alanı hiç olmayan kullanıcılar için önce Yönetim → Kullanıcılar
ekranından firma atayın.

## Adım 2 — İndeksleri ve kuralları yayınla

```bash
pnpm test:rules:emulated          # 82 kural testi (JDK 21+ gerekir)
firebase deploy --only firestore:indexes --project invpilot
firebase deploy --only firestore:rules   --project invpilot
```

İndeksler önce: bileşik indekslerin oluşması birkaç dakika sürebilir, o süre
içinde bazı arama sorguları hata verebilir.

**Geri alma:** Firebase Console → Firestore → Rules → **History** sekmesinden
önceki sürüm tek tıkla yüklenir. Yayın öncesi mevcut sürümü kopyalayıp
saklamak iyi bir alışkanlıktır.

## Adım 3 — Uygulama kodunu yayınla

Adım 2 tamamlanmadan **yapmayın** (yukarıdaki sıralama uyarısı).

```bash
firebase deploy --only hosting
```

> Hosting **kendi projesine** deploy edilir; buraya bilerek `--project invpilot`
> yazılmadı. Kural/fonksiyon komutlarında kullandığınız projeyi hosting'e
> taşımayın.

Firebase App Hosting kullanıyorsanız ve `main`'e push otomatik deploy
tetikliyorsa, PR'lar merge edildiğinde bu adım kendiliğinden olmuş olabilir —
o durumda **Adım 2'yi geciktirmeyin**, kural yayını kod yayınından geride
kalmamalı.

## Adım 4 — Seri No Defteri'ni doldur

Yönetim panelinde **"Seri No Defteri Doldurma"** kartı:

1. **Önizle** — hiçbir şey yazmaz, sayıları gösterir.
2. **Defteri Doldur** — `depoStok`, `transfers/items`, `tuketimKayitlari`,
   `depotBrandCountSessions/items` ve eski `serialHistory` taranır.

İdempotenttir; tekrar çalıştırmak mükerrer kayıt üretmez ve stok belgelerine
dokunmaz.

Doldurma yapılmadan defter boştur ve geçmiş-seri kontrolü hiçbir şeyi
engellemez (güvenli tarafa düşer). Doldurdukça kontrol etkinleşir.

**Doğrulama:** Arama panelinde bir seri numarası aratın — "Seri No Defteri"
kartı birimin güncel durumunu, konumunu ve son işlemini göstermeli.

## Adım 5 — Ceomed: laboratuvar cari kodları

Otomatik aktarımın ön koşulu. Yönetim → Laboratuvarlar ekranından her
laboratuvara **`ceomedCariKodu`** girin (Ceomed'deki cari kodu, ör. `M51001`).

Aynı cari koda bağlı ek hizmet laboratuvarları varsa ayrıca **`sevkAdresi`**
alanını da doldurun — irsaliyenin `ADRES` alanıyla eşleştirilir.

Girilmeyen kurumların irsaliyeleri "eşleşmedi" gerekçesiyle onay kuyruğunda
bekler. Stok kaybolmaz, sadece elle aktarım gerekir.

## Adım 6 — Ceomed watcher'ı başlat

ERP ağına erişebilen Windows makinesinde:

```powershell
cd C:\Users\btuba\Desktop\qore.g4
git pull
cd scripts\ceomed-sync
npm install
.\run-watch.bat
type watch.log
```

`.env` dosyasına yeni ayarları ekleyin (varsayılanlar yeterliyse atlanabilir):

```env
CEOMED_WATCH_IRSALIYE_SEC=60
CEOMED_WATCH_DEPO_SEC=120
CEOMED_WATCH_LOOKBACK_DAYS=7
CEOMED_AUTO_TRANSFER=1
```

Task Scheduler'a ekleyin:
- **Genel:** "Kullanıcı oturum açmış olsun olmasın çalıştır" + "En yüksek ayrıcalıklarla"
- **Tetikleyici:** "Oturum açıldığında"
- **Eylem:** Program `...\scripts\ceomed-sync\run-watch.bat`, Başlangıç `...\scripts\ceomed-sync`
- **Koşullar:** "Yalnızca AC güç kaynağında çalıştır" → **kapalı**
- **Ayarlar:** "Görev zaten çalışıyorsa yeni örnek başlatma" → seçili

## Adım 7 — Eski Ceomed görevlerini DEVRE DIŞI bırak

`watch.js` üçünün de işini yapar:

| Eski görev | Durum |
|---|---|
| `Ceomed Sync` (15 dk'da bir `run-sync.bat`) | **devre dışı** |
| `Ceomed Depo Sync` (günlük `run-depo-sync.bat`) | **devre dışı** |
| `Ceomed Sevkiyat Watcher` (`run-sevkiyat-watcher.bat`) | **devre dışı** |

Aynı anda çalışırlarsa mükerrer stok oluşmaz (belge kimlikleri
deterministiktir) ama ERP ve Firestore gereksiz yük alır.

Script'ler silinmedi; watcher'ı durdurup tek seferlik elle sync yapmak
isterseniz hâlâ çalışıyorlar.

## Adım 8 — İzle (birkaç iş günü)

**Firebase Console → Firestore → Rules → Monitor**: reddedilen ("denied")
istek var mı? Varsa o koleksiyonun `match` bloğu eksik demektir — kuralını
ekleyip yeniden yayınlayın.

**`watch.log`**: satır biçimi
`[2026-08-04 09:15:02] [aktarım] IRS-001 → Merkez Lab: 12 birim`.
"BEKLİYOR — ..." satırları eşleşmeyen irsaliyeleri gösterir.

**Mal kabul paneli**: eşleşmeyen irsaliyelerde sarı uyarı kutusu ve gerekçesi
görünmeli.

## Adım 9 — Güvenlik ağını kaldır (PR #1764)

Adım 8'de birkaç iş günü boyunca **hiç "denied" görülmediyse** #1764'ü merge
edin ve yeniden yayınlayın:

```bash
firebase deploy --only firestore:rules --project invpilot
```

Bu noktadan sonra `match` bloğu olmayan koleksiyon yeniden **varsayılan olarak
reddedilir**.

---

## PR haritası

| PR | İçerik | Deploy gerektirir |
|---|---|---|
| #1760 | Seri No Defteri, stok akışı tek kaynak | Adım 2 (kural+indeks) → Adım 3 (kod) → Adım 4 (doldurma) |
| #1761 | Eksik 23 kural + geçici güvenlik ağı + preflight | Adım 0-2 |
| #1762 | Ceomed sürekli watcher + otomatik lab aktarımı | Adım 5-7 |
| #1763 | Ölü panel silindi, palet jetonları | Adım 3 ile birlikte |
| #1764 | Güvenlik ağı kaldırılır | Adım 9 (**önce Adım 8**) |

## Kalıcı kural

Yeni bir Firestore koleksiyonu eklerken `firestore.rules`'a `match` bloğu
eklemeyi **atlamayın**. Bu hata üretimde ancak kullanıcı şikâyetiyle fark
edilir — `serialHistory` tam olarak böyle aylarca sessizce reddedildi ve seri
no stok tutarsızlığının kök nedeni oldu. Ayrıntı:
`docs/firestore-rules-rollout.md`.
