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

Sonraki adımlar:
- ERP "Kuruma sevk edildi" durum güncelleme endpoint'i
- Firestore'a "onay bekliyor" kaydı (CARI_KODU eşleşmesiyle laboratuvara)
- Qore UI: Raporlar → Dosya Yönetimi'ne "İrsaliye Çek" butonu
