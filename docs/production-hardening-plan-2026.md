# Production Readiness Hardening Raporu (Detaylı Uygulama Planı)

## 1) Yönetici Özeti

Bu proje mevcut haliyle **çalışan prototip / pilot** seviyesinde; kurumsal üretim (production) seviyesine çıkmak için zorunlu hardening adımları gerekiyor. Öncelikli risk alanları:

1. **Type Safety ve Lint Güvenceleri kapalı** (build sırasında type/lint hataları engellenmiyor).
2. **Test stratejisi dengesiz** (birkaç utility test var; panel bazlı iş akışlarının çoğu test dışı).
3. **CI/CD ve kalite kapıları yok** (otomatik doğrulama, güvenlik taraması, release gate eksik).
4. **Güvenlik açıkları / yanlış yapılandırmalar** (public config yönetimi, header/policy eksikleri, kuralsız erişim riskleri).
5. **Ölçeklenebilirlik riskleri** (tek instance sınırı, eksik pagination, query sonrası in-memory filtreleme, Firestore sınır workaround’larının dağınık oluşu).
6. **Kod tekrarları** (özellikle tarih normalizasyonu, Firestore erişim patternleri, stok gruplama).

Bu rapor, sadece “sorun listesi” değil; doğrudan uygulanabilir, sprint bazlı, teknik detay içeren bir **production geçiş planıdır**.

---

## 2) Mevcut Bulguların Doğrulanması

Aşağıdaki bulgular mevcut kod tabanı ile uyumludur:

- TypeScript strict mode kapalı (`strict: false`, `noImplicitAny: false`, `strictNullChecks: false`).
- Next.js build’de lint ve type error’ları bypass ediliyor (`eslint.ignoreDuringBuilds: true`, `typescript.ignoreBuildErrors: true`).
- App hosting `maxInstances: 1`.
- Kök dizinde CI workflow bulunmuyor (`.github/workflows` yok).
- Test dosya sayısı sınırlı (testler ağırlıkla validation utility odaklı).
- Tarih parse/normalize yardımcılarının birden fazla yerde tekrarlandığı gözleniyor.
- Firestore query + sonrasında JS tarafında filtreleme kullanılan pattern’ler mevcut.

> Sonuç: İlk rapordaki çekirdek tespitler teknik olarak makul ve aksiyon gerektiriyor.

---

## 3) Hedef Mimari ve “Production Ready” Tanımı

Aşağıdaki maddeler tamamlanmadan “production ready” kabul edilmemeli:

### 3.1 Kalite Kapıları (zorunlu)
- `tsc --noEmit` strict modda geçmeli.
- `eslint` build öncesi fail edecek şekilde çalışmalı.
- Unit + integration + E2E minimum coverage eşikleri sağlanmalı.
- Güvenlik taramaları (dependency, SAST, secret scan) pipeline’da fail koşulu olmalı.

### 3.2 Güvenlik
- Tüm hassas konfigürasyonlar Secret Manager / runtime env ile yönetilmeli.
- Firestore Security Rules ve Cloud Functions IAM least-privilege uygulanmalı.
- API route’larında authN/authZ + rate limiting + input validation standartlaştırılmalı.

### 3.3 Ölçeklenebilirlik
- Yük altında yatay büyüme ve veri erişim verimliliği doğrulanmalı.
- Pagination/cursor stratejisi tüm büyük listelerde standardize edilmeli.
- In-memory filtrelemeler mümkün olduğunca sorgu seviyesine indirilmeli.

### 3.4 Operasyonel Olgunluk
- CI/CD + environment promotion (dev/stage/prod) kurulmalı.
- Rollback, feature flag, gözlemlenebilirlik (logs/metrics/traces/alerts) aktif olmalı.

---

## 4) Detaylı Teknik Çözüm Planı

## 4.1 TypeScript & Lint Hardening

### Sorun
- Tip güvenliği ve lint build kalitesine etkisiz durumda.

### Nasıl yapılır
1. `tsconfig.json` için aşamalı strict geçişi:
   - Faz-1: `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess` aç.
   - Faz-2: `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature` aç.
2. `next.config.mjs` içinde:
   - `eslint.ignoreDuringBuilds = false`
   - `typescript.ignoreBuildErrors = false`
3. ESLint kurallarını modüler hale getir:
   - `src/app`, `src/lib`, `src/hooks`, `src/services` için override setleri.
4. “Legacy uyumluluk” için `// TODO(strict)` etiketi ile geçici debt listesi çıkar; debt budget tanımla.

### Çıkış kriteri
- CI içinde `pnpm typecheck` ve `pnpm lint` zorunlu geçer.

---

## 4.2 Test Mimarisi (Unit + Integration + E2E)

### Sorun
- Test kapsamı panel davranışlarını ve kritik iş akışlarını kapsamıyor.

### Nasıl yapılır
1. Test piramidi tanımla:
   - **Unit**: validation, date utils, formatter, pure domain logic.
   - **Integration**: Firebase repository katmanı + mock emulator.
   - **E2E**: kritik kullanıcı senaryoları (Playwright).
2. Hedef coverage:
   - Global: `%70` branch / `%80` line.
   - Kritik modüller (stok, transfer, sipariş, auth): `%85+` line.
3. Her panel için minimum E2E smoke:
   - login → panel açılışı → filtreleme → kayıt oluşturma/güncelleme → rapor/export.
4. Firestore emulator tabanlı entegrasyon testleri ekle:
   - query edge-case (in<=30, pagination cursor, date range, status filter).
5. Test verisi fabrikaları (`test/factories`) oluştur:
   - StockItemFactory, TransferFactory, UserFactory vb.

### Çıkış kriteri
- CI’da unit+integration+e2e çalışır; coverage threshold altında build fail olur.

---

## 4.3 CI/CD ve Release Governance

### Sorun
- Otomasyon yok; kalite ve güvenlik kontrolleri manuel.

### Nasıl yapılır
1. GitHub Actions pipeline tasarımı:
   - `pr-check.yml`: install → lint → typecheck → test → security scans.
   - `build-and-deploy-staging.yml`: main merge sonrası staging deploy.
   - `promote-prod.yml`: manual approval + prod deploy.
2. Gating politikası:
   - En az 1 code owner review.
   - Tüm zorunlu check’ler yeşil değilse merge yok.
3. Release stratejisi:
   - Semantic versioning + changelog otomasyonu.
   - Tag bazlı release artifact üretimi.
4. Rollback:
   - Son başarılı prod artifact’ına tek tık rollback.

### Çıkış kriteri
- Merge/deploy süreçleri tam otomasyonlu, denetlenebilir ve geri alınabilir.

---

## 4.4 Güvenlik Hardening

### Sorun
- Konfigürasyon, erişim kontrolü ve uygulama güvenliği alanlarında gap’ler var.

### Nasıl yapılır
1. Secret yönetimi:
   - Tüm gizli değerleri Secret Manager’a taşı.
   - Public olması gereken anahtarları bile environment bazlı yönet (dev/stage/prod ayrımı).
2. API güvenliği:
   - Route middleware: auth doğrulama + role check + rate limit.
   - Input şeması: Zod/Joi ile merkezi doğrulama.
3. Firestore Rules:
   - Koleksiyon bazlı least-privilege, role matrix ile yeniden yazım.
   - Rules testleri (allow/deny senaryoları).
4. Dependency & code scanning:
   - `pnpm audit` + CodeQL + secret scan + license check.
5. OWASP ASVS checklist ile gap kapatma:
   - Session, CSRF, XSS, SSRF, insecure deserialization, logging hygiene.

### Çıkış kriteri
- Security scan critical/high sıfır (veya risk acceptance kayıtlı), rules testleri yeşil.

---

## 4.5 Kod Tekrarı ve Domain Standardizasyonu

### Sorun
- Tarih dönüşümü, Firestore query patternleri, stok gruplama gibi mantıklar farklı yerlerde tekrar ediyor.

### Nasıl yapılır
1. Domain kernel katmanı oluştur:
   - `src/lib/domain/date`, `src/lib/domain/stock`, `src/lib/domain/query`.
2. Tekil tarih standardı:
   - Tek `DateNormalizer` servisi (timestamp/string/number → canonical Date).
   - Tüm panel ve API route’ları bu servisi kullanır.
3. Firestore repository pattern:
   - Her koleksiyon için repository (StockRepo, TransferRepo, UserRepo).
   - Query builder fonksiyonları ortaklaştırılır.
4. Stock grouping stratejisi:
   - Copy-paste yerine tek `groupStockItems()` domain fonksiyonu.

### Çıkış kriteri
- Aynı iş kuralının birden fazla implementasyonu kaldırılır; duplicate logic düşer.

---

## 4.6 Performans ve Ölçeklenebilirlik

### Sorun
- Tek instance sınırı, pagination eksikliği, query sonrası filtreleme maliyeti, Firestore limit workaround dağınıklığı.

### Nasıl yapılır
1. Hosting kapasite planı:
   - `maxInstances` iş yüküne göre arttırılır; autoscaling threshold’ları tanımlanır.
2. Pagination standardı:
   - Büyük listelerde zorunlu cursor-based pagination (`limit + startAfter`).
   - UI’da sonsuz scroll veya sayfalama bileşeni standartlaştırılır.
3. Query optimization:
   - In-memory `.filter()` ile daraltılan setler query katmanına taşınır.
   - Bileşik index gereksinimleri önceden üretilir (`firestore.indexes.json`).
4. Firestore `in` limiti stratejisi:
   - 30 limit için chunking yardımcıları merkezi utility’de toplanır.
   - Çoklu sorgu birleştirme + stable sort + dedup standart fonksiyonla yapılır.
5. Caching stratejisi:
   - React Query cache key standardı + staleTime/cacheTime panel bazlı tuning.

### Çıkış kriteri
- P95 response ve query maliyetlerinde hedeflenen düşüş; yük testleri geçer.

---

## 5) Panel Bazlı Eş Sorunlar ve Çözüm Matrisi

Aşağıdaki standartlar **tüm panellerde** zorunlu olmalı:

## 5.1 Stok / Depo / Laboratuvar panelleri
- Zorunlu pagination + server-side filter.
- Stock grouping tek domain fonksiyonundan.
- Tarih ve miktar hesapları ortak util’den.
- E2E: stok giriş, transfer, sayım kapanış, geçmiş görüntüleme.

## 5.2 Mal Kabul / Sipariş / Direkt Transfer
- Transaction/batch write kuralları standart repository’de.
- İrsaliye/lot/seri validasyonları shared validation paketinde.
- Failure senaryoları (kısmi kayıt, network retry) için idempotent command handler.

## 5.3 Ürün Kullanım / Verimlilik / Kümülatif hesaplama
- Hesaplama motoru UI’dan ayrılır (pure domain service).
- Büyük tarih aralıklarında incremental fetch + aggregate cache.
- Raporlama endpoint’lerinde memory footprint kontrolü.

## 5.4 Raporlama ve Yönetim panelleri
- Export endpoint’lerinde streaming/chunking.
- Role-based data masking (özellikle personel/oturum/log ekranları).
- Audit log zorunluluğu (kim, neyi, ne zaman değiştirdi).

## 5.5 Kimlik, Yetki, Oturum
- Session yönetimi merkezi middleware.
- Kritik admin aksiyonlarında step-up auth (yeniden doğrulama).
- Yetkisiz erişim testleri (allow/deny matrix).

---

## 6) Önerilen Klasör/Mimari Refactor Planı

- `src/lib/domain/*` → saf iş kuralları (UI’dan bağımsız).
- `src/lib/repositories/*` → Firestore erişimi.
- `src/lib/use-cases/*` → panel aksiyon orkestrasyonu.
- `src/app/api/*` → sadece transport/adaptor (validation + auth + use-case call).
- `src/components/*` → sadece sunum/etkileşim.

Bu ayrım, test yazmayı kolaylaştırır ve kod tekrarını düşürür.

---

## 7) Sprint Bazlı Yol Haritası (12 Hafta)

## Sprint 1–2: Stabilizasyon
- Strict mode geçiş planı + lint/type gate hazırlığı.
- Security baseline (secrets, auth middleware skeleton).
- CI pipeline iskeleti.

## Sprint 3–4: Test ve Repository katmanı
- Repository pattern geçişi (kritik 3 koleksiyonla başla).
- Unit/integration test kapsamını kritik panellere genişlet.
- E2E smoke suite ekle.

## Sprint 5–6: Ölçeklenebilirlik
- Pagination standardı tüm büyük listelere.
- In-memory filtreleri query katmanına taşı.
- Firestore index/limit helper standardizasyonu.

## Sprint 7–8: Güvenlik derinleştirme
- Rules rewrite + rules tests.
- CodeQL/audit/secret scan fail gates.
- Role matrix ve yetki testleri.

## Sprint 9–10: Operasyonel olgunluk
- Staging → prod promotion ve rollback otomasyonu.
- Observability dashboard ve SLO alarm setleri.

## Sprint 11–12: Hardening final
- Performance/load test.
- Kaçan duplicate logic temizliği.
- Production readiness review + go-live checklist.

---

## 8) KPI, SLO ve Başarı Ölçütleri

- Build başarısı: `lint + typecheck + test + security` %100 geçiş.
- Coverage: global line ≥ %80, kritik domain ≥ %85.
- P95 API response: hedef < 400ms (kritik endpoint’lerde).
- Hata bütçesi: aylık kritik incident = 0.
- MTTR: < 30 dk.
- Rollback süresi: < 10 dk.

---

## 9) Hemen Başlatılacak “İlk 10 Teknik İş”

1. Build’de lint/type ignore bayraklarını kapatacak task aç.
2. Strict mode migration board (dosya bazlı) oluştur.
3. GitHub Actions PR pipeline kur.
4. Security scan job’larını pipeline’a ekle.
5. Firestore rules audit ve test altyapısını başlat.
6. Date normalizer’i tek serviste merkezileştir.
7. Stock grouping fonksiyonunu shared domain’e taşı.
8. En büyük 5 liste ekranına cursor pagination getir.
9. In-memory filtre kullanılan query’leri repository’ye taşı.
10. Kritik paneller için E2E smoke test yaz.

---

## 10) Riskler ve Önleyici Kontroller

- **Risk:** Strict geçişte çok sayıda hata çıkması.
  - **Önlem:** Kademeli flag aktivasyonu + ownership bazlı fix sprintleri.
- **Risk:** Firestore query değişiklikleri davranış farkı yaratması.
  - **Önlem:** Golden dataset + regression integration tests.
- **Risk:** Pipeline sürelerinin uzaması.
  - **Önlem:** Paralel job, test sharding, cache optimizasyonu.

---

## 11) Sonuç

Bu plan uygulanırsa proje:
- prototip seviyesinden kurumsal üretim standardına çıkar,
- güvenlik ve kalite kapılarıyla yönetilebilir hale gelir,
- tüm panellerde tutarlı mimari ve test güvencesi kazanır,
- büyüyen veri ve kullanıcı yükünde daha öngörülebilir performans verir.

Kritik nokta: Bu dönüşüm tek bir “bug fix” değil, **mühendislik işletim modelinin** (quality gates + security + release discipline) sistematik kurulmasıdır.
