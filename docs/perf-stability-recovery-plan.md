# Performans & Stabilite Kurtarma Planı

> Tarih: 2026-06-10 · Kaynak: 5 panelin HAR analizi (cihazlar, siparişler,
> direkt transfer, mal kabul, maliyet) + kod tabanı incelemesi.

## 1. Teşhis — "Sistem hızlı ama stabil değil"in kök nedenleri

HAR kayıtlarının hepsi aynı deseni gösteriyor; sorun panel-spesifik değil,
**veri erişim mimarisinde** üç sistemik zayıflık var:

### A. Her okuma sunucuyu bekliyordu (cache-first değildi)
Firestore IndexedDB persistence (`persistentLocalCache`) açık olmasına
rağmen tüm React Query hook'ları `getDocs` kullanıyordu. `getDocs`,
istemci kendini online sandığı sürece **her zaman sunucu yanıtını bekler**
— local cache'e yalnızca offline'da düşer. Sonuç:

- Her panel açılışı ≥1 sunucu round-trip'ine kilitleniyordu.
- Barkod formatları/ürün kodları gelmeden okutulan barkod "format hatası"
  veriyordu; birkaç saniye sonra aynı barkod geçiyordu.
- Veri büyüdükçe bu bekleme de büyüyecekti.

### B. Zombi WebChannel = "dakikalarca loading, F5 ile anında düzelme"
Firestore web SDK'sı sunucuyla tek bir WebChannel üzerinden konuşur. Uyku,
ağ değişimi, NAT/proxy timeout'u sonrası bu kanal "açık ama ölü" kalabilir.
SDK kendini online sandığı için `getDocs` sonsuza dek bekler; F5 taze kanal
açtığı için her şey anında gelir. Kullanıcıların ekran kayıtlarındaki
yavaşlığın sizde tekrarlanamamasının sebebi de bu: sorun makineye değil,
**o anki bağlantının kanal durumuna** bağlı.

### C. Görsel israfı: sayfa başına ~3MB gereksiz transfer
- `newlogowh.png` 1.5MB (1024×1024, 80px'te gösteriliyor), her yüklemede.
- `A0D5B407-…PNG` 0.7MB; `<link rel="icon">` + `apple-touch-icon` yüzünden
  **iki kez** indiriliyordu.
- public/ görselleri `Cache-Control: max-age=0, private` ile servis
  ediliyordu → tarayıcı hiç cache'leyemiyordu.

## 2. Uygulanan global çözümler (Faz 1 — bu PR)

### 2.1 Cache-first veri yolu (`src/lib/firestore-fetch.ts`)
`getDocsCacheFirst`: önce IndexedDB cache → veri **milisaniyeler içinde**
ekranda; arka planda `getDocsFromServer` ile tazesi çekilir ve ilgili React
Query anahtarı invalidate edilir (stale-while-revalidate). Cache boşsa (ilk
ziyaret) bugünkü davranış korunur. Firestore okuma maliyeti değişmez:
cache'ten servis 0 okumadır, arka plan tazeleme bugünkü okumayla aynıdır.
`useFirebaseQueries.ts`'teki 56 okuma çağrısının tamamı bu yola taşındı;
`getScopedDocs`'un cache-first muadili `getScopedDocsCacheFirst` eklendi.

### 2.2 Zombi kanal watchdog'u (`src/lib/firestore-network-recovery.ts`)
- Sekme 45sn'den uzun arkaplanda kaldıktan sonra görünür olduğunda veya
  tarayıcı `online` olayında WebChannel proaktif tazelenir
  (`disableNetwork` → `enableNetwork`; bekleyen yazmalar kaybolmaz,
  onSnapshot listener'ları yeni kanaldan kendiliğinden devam eder).
- `getDocsResilient`: sunucu okuması 12sn'de yanıt vermezse kanal tazelenip
  bir kez daha denenir. "Sonsuz loading" artık mimari olarak imkânsız —
  en kötü senaryo kendini iyileştiren ~27sn.

### 2.3 Görsel diyeti
- `scripts/optimize-brand-assets.mjs`: 0.7–1.5MB kaynaklardan 11–58KB
  ikon/logo türevleri üretir (orijinaller korunur).
- `<link rel="icon">`, `apple-touch-icon`, `manifest.json`, sidebar ve
  MobileDock logoları küçük türevlere bağlandı.
- `next.config.mjs`: public/ görsellerine
  `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`;
  `/_next/image` için `minimumCacheTTL: 86400`.

**Beklenen etki:** panel açılışında veri görünümü ~sunucu RTT'sinden
~milisaniyeye iner; barkod, panele girer girmez çalışır; takılı loading
semptomu kökten kalkar; sayfa başına ~3MB transfer kaybolur.

## 3. Sonraki fazlar (önerilen sıra)

1. **Faz 2 — Kalan doğrudan okumalar:** `src/` genelinde hook katmanı
   dışında ~480 `getDocs` çağrısı var (panel içi tek seferlik okumalar,
   mutasyon öncesi kontroller). Sık kullanılan panel-içi okumaları
   `getDocsCacheFirst`/`getDocsResilient`'a taşı. (Mekanik, düşük risk.)
2. **Faz 3 — Server action'ların önbelleği:** `getPaginatedDepotStock`,
   `getDepotSerialIndex` gibi server action'lar Firestore local cache'i
   atlar. Bunlara RQ `placeholderData` + `keepPreviousData` ve gerekirse
   sunucu tarafı cache ekle.
3. **Faz 4 — Uyumluluk sorgusunun emekliliği:** `getScopedDocs` her
   koleksiyon için ek bir "untagged legacy" sorgusu çalıştırıyor (koleksiyon
   başına +1 okuma seti). Migration tamamlandıysa bu yol kaldırılabilir.
4. **Faz 5 — Ölçüm:** WebVitalsReporter'a "ilk veri görünümü" (panel mount →
   ilk dolu render) metriği ekle; kullanıcı şikayeti geldiğinde HAR yerine
   bu telemetriyle doğrula.
5. **Faz 6 — Görsel hijyeni:** public/ altındaki ~20 adet 1–2MB PNG
   (duvar kağıtları/ikon adayları) için optimize edilmiş türev seti +
   `resolveImageSrc` üzerinden otomatik küçük-boy seçimi.

## 4. Doğrulama kontrol listesi

- [ ] Panel aç → veriler anında (cache'ten) görünüyor, ~1sn içinde sessizce
      tazeleniyor mu? (`snapshot.metadata.fromCache` console'dan izlenebilir)
- [ ] Panele girer girmez barkod okut → format hatası yok.
- [ ] Laptop'u uyut/Wi-Fi değiştir → dön → panel kendiliğinden toparlıyor
      mu (F5 gerekmeden)?
- [ ] DevTools Network: logo/ikon istekleri ≤60KB ve ikinci yüklemede
      `(disk cache)`.
- [ ] Firestore kullanım panosunda okuma sayısında artış YOK.
