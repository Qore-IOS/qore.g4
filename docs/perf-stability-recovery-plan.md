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

## 3. Sonraki fazlar — DURUM: TAMAMLANDI (2. tur)

1. **Faz 2 — Kalan doğrudan okumalar: ✅ UYGULANDI.** Hook katmanı dışındaki
   153 dosyada 477 `getDocs` → `getDocsResilient`, 105 `getDoc` →
   `getDocResilient` (timeout + zombi kanal kurtarma; davranış birebir aynı,
   sadece sonsuz bekleme imkânsız). `getScopedDocs`'un iç okumaları da
   dayanıklı. RQ queryFn'li ek siteler (merkez-siparis minMaxRules)
   cache-first'e alındı. Mutasyon-yolu okumaları bilinçli olarak
   cache-first YAPILMADI (yazma doğruluğu sunucu verisine bağlı kalmalı).
   `'use server'` dosyaları (stokActions, restore) dokunulmadı — sunucuda
   resilient zaten pass-through olurdu.
2. **Faz 3 — Server action önbelleği: ✅ MEVCUT + BİLİNÇLİ SINIR.**
   `usePaginatedDepotStock` ve `usePaginatedProductCodes` zaten
   `placeholderData: (prev) => prev` kullanıyor (sayfa/filtre geçişleri
   akıcı). Sunucu tarafı `unstable_cache` BİLEREK eklenmedi: stok verisinin
   invalidation'ı client yazmalarına bağlanamıyor; bayat stok göstermek
   hızdan değerli değil. İleride gerekirse `revalidateTag` mimarisiyle ele
   alınmalı.
3. **Faz 4 — Uyumluluk sorgusunun emekliliği: ✅ BAYRAKLANDI.** Untagged
   compat sorgusu `NEXT_PUBLIC_LEGACY_UNTAGGED_COMPAT=off` ile kapatılabilir
   (env.example'da belgeli; varsayılan açık = bugünkü davranış). Üretimde
   `companyId`siz doküman kalmadığı doğrulanınca kapatın.
4. **Faz 5 — Ölçüm: ✅ UYGULANDI.** `DATA` vital'i eklendi
   (src/lib/perf/data-vitals.ts): cache-first veri yolundaki her ön-plan
   servisi süre + kaynak (cache/sunucu) olarak `window.__QORE_VITALS__`
   buffer'ına yazılır; `?vitals=1` overlay'inde DATA satırı canlı görünür.
   Kullanıcı şikayetinde HAR yerine `window.__qoreVitals__()` çıktısı isteyin.
5. **Faz 6 — Görsel hijyeni: ✅ UYGULANDI.** `scripts/optimize-public-icons.mjs`:
   61 dock/mobil ikonu (42MB) → 96px türevler (0.6MB), `getIconSrc` manifest
   üzerinden otomatik küçük-boy servis eder; manifest dışı (runtime'da
   eklenen) ikonlar ham yoldan yüklenmeye devam eder. `dayclear.png`
   6.2MB → 2.45MB (1600px). Bildirim badge/icon'u üç yerde (service worker +
   iki Cloud Functions kopyası) 0.7MB PNG yerine `/icon-192.png`.

### Açık kalan öneriler (kullanıcı kararı / ileri tur)
- public/ altında hiç referans edilmeyen ~22MB varlık var (`rainy.png`,
  `tk-wp1.png`, `vehicles/*.png`, iki mp4). Silinmesi deploy boyutunu
  küçültür; runtime etkisi yok. Onayınızla kaldırılabilir.
- `sharp` ortama eklenirse duvar kağıtları WebP/JPEG'e çevrilerek
  2.45MB → ~300KB'a iner (pngjs yalnızca PNG üretebiliyor).
- PDF logo fallback zinciri `/invlogo.png`(72KB) önceliğiyle zaten ekonomik;
  dokunulmadı (baskı kalitesi).

## 4. Doğrulama kontrol listesi

- [ ] Panel aç → veriler anında (cache'ten) görünüyor, ~1sn içinde sessizce
      tazeleniyor mu? (`snapshot.metadata.fromCache` console'dan izlenebilir)
- [ ] Panele girer girmez barkod okut → format hatası yok.
- [ ] Laptop'u uyut/Wi-Fi değiştir → dön → panel kendiliğinden toparlıyor
      mu (F5 gerekmeden)?
- [ ] DevTools Network: logo/ikon istekleri ≤60KB ve ikinci yüklemede
      `(disk cache)`.
- [ ] Firestore kullanım panosunda okuma sayısında artış YOK.
