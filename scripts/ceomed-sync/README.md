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

Sonraki adımlar (henüz eklenmedi):
- `selectIrsaliyeMaster` çekimi
- `selectCeomedIrsaliye` + `selectOkutulanBarkod` ile detay/seri
- Excel & PDF üretimi
- Firebase Storage + Firestore yazımı
- Cron tetikleyici
