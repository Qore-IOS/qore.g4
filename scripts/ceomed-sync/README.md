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
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\firebase-service-account.json
FIREBASE_PROJECT_ID=your-firebase-project-id
```

Çalıştır (3 durumun hepsini çekip Firestore `pendingCeomedIrsaliye` koleksiyonuna yazar):
```bash
node syncToFirestore.js 05.05.2026 06.05.2026
# Sadece tek durum:
node syncToFirestore.js 05.05.2026 06.05.2026 --status="KURUMA SEVK EDILDI"
```

Yazılan doküman şeması:
```
pendingCeomedIrsaliye/{ceomedId}
  ceomedId, irsaliyeNo, tarih, cariKodu, cariUnvan, evrakSeq,
  durumAciklama, items: [{BARKOD_SERI, BARKOD, STOK_KODU, LOT, MIYAT, MIKTAR}],
  status: 'pending' | 'approved' | 'rejected', syncedAt
```

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

## Adım 5 — Windows Task Scheduler ile Otomasyon

`run-sync.bat` hazır — `.env` dosyasını yükler, dünden bugüne tarih aralığıyla 3 durumu da çeker, `sync.log`'a yazar.

### Önce `.env` oluştur
`scripts/ceomed-sync/.env` dosyası (gitignore'da):
```
CEOMED_BASE_URL=http://192.168.1.5:8081
CEOMED_EPOSTA=merkez
CEOMED_PAROLA=12345
GOOGLE_APPLICATION_CREDENTIALS=C:\Users\btuba\firebase-sa.json
FIREBASE_PROJECT_ID=your-project-id
```

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
