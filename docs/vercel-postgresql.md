# Vercel ve Neon PostgreSQL

Uygulama artık Firebase SDK, Firestore, Firebase Authentication, Realtime Database,
Firebase Storage veya Cloud Functions kullanmaz. Eski Firebase projesine veri
okuma/yazma ve veri taşıma yapılmaz. Canlı projedeki kayıtlar silinmemiştir.

## Dağıtım

1. Vercel projesine Marketplace üzerinden Neon PostgreSQL bağlayın. Sunucuya
   `DATABASE_URL` sağlanmalıdır; tarayıcıya gönderilmez. Neon'un havuzlanmış
   bağlantı adresini kullanın ve TLS ayarlarını koruyun.
2. Dosyalar için **private** Vercel Blob deposu bağlayın; `BLOB_READ_WRITE_TOKEN`
   sunucu ortamında bulunmalıdır. Dosya uçları 4 MB yükleme sınırı uygular.
3. `APP_BASE_URL` değerini uygulamanın HTTPS adresine ayarlayın. Cron için rastgele
   bir `CRON_SECRET` değerini Vercel ortam ayarlarında oluşturun. Değerleri Git'e
   eklemeyin. `env.example` değişken adlarını listeler.
4. Dağıtın. `vercel.json`, `pnpm db:migrate && pnpm build` çalıştırır. Şema
   kurulumu tekrar çalıştırılabilir ve mevcut iş kayıtlarını silmez.
5. `/api/health/admin` yanıtının `ready: true` olduğunu doğrulayın. Dosya yüklemeyi
   ayrıca sınayın; bir Blob token'ı olmadan bu özellik çalışmaz.

**Giriş sistemi yoktur.** Her ziyaretçi aynı çalışma alanını tüm yönetim yetkileriyle
kullanır. Personel kayıtları kimlik doğrulama hesabı değildir; şirket alanları
kayıt etiketidir, kullanıcılar arasında erişim sınırı sağlamaz. Veri okuma, yazma,
dosya ve AI uçlarını dış erişimden korumak için Vercel Deployment Protection veya
kurumun erişim katmanını kullanın. Dosyalar Blob'da private tutulur; uygulamanın
`/api/files` uçları girişsiz çalışma alanının bir parçasıdır.

## Veri katmanı

`qore_documents`, mevcut iç içe stok modellerini JSONB olarak saklar. Koleksiyon,
şirket ve JSONB indeksleri bulunur. Filtre, sıralama, sayfalama ve sayım SQL'de
çalışır. Toplu yazımlar ve alan artırımları PostgreSQL işlemleriyle atomiktir.
Okuma sürümlerini kullanan işlemler eşzamanlı değişiklikte yeniden denenir.
Tarayıcı yalnız Next.js veri API'sine bağlanır. SQL bağlantısı sunucuda kalır.

Eski iş modüllerinin kullandığı belge API'si uygulamanın kendi adaptörüdür;
Firebase paketi veya uzak Firebase servisi değildir. Abonelikler görünür sayfada
15 saniyede bir yenilenir. Eski SDK'nın çevrimdışı yazma kuyruğu kaldırılmıştır;
yazımlar sunucudan onay bekler. Eski bekleyen işlemler, ağ geri geldi diye
başarılı sayılmaz. Bağlantısı kesilmiş terminalde yeni yazım yapılamaz.

## Otomasyonlar

E-posta, WhatsApp, sipariş mutabakatı, şirket istatistikleri, maliyet snapshot'ları,
hatırlatmalar ve kestirmeler `src/lib/jobs` altına taşındı. Belge değişimleri aynı
SQL işlemi içinde `qore_outbox` tablosuna yazılır; `/api/jobs` kuyruğu işler ve
zamanlanmış işleri başlatır. Başarısız olaylar yeniden denenmek üzere tutulur.
Teslimat en az bir kezdir; dış servis çağrılarında yinelenme ihtimali vardır.

Vercel Cron, bu ucu dakikada bir çağırır. **Dakikalık Cron için uygun Vercel planı
(örneğin Pro) veya harici zamanlayıcı gerekir.** Hobby planına dağıtılacaksa
zamanlama ve otomasyon gecikmesi ayrıca uyarlanmalıdır. Cron sadece
`Authorization: Bearer <CRON_SECRET>` kabul eder. `CRON_SECRET` uygulama girişi değildir.
Elle yeniden hesaplama görevleri `POST /api/tasks/recomputeCostSnapshot` ve
`POST /api/tasks/backfillCompanyStats` üzerinden JSON gövdeyle çağrılabilir.
Bunlar da girişsiz çalışma alanının yönetim yetkilerine sahiptir.
Kuyruk/iş durumu `qore_outbox` ve `qore_job_runs` tablolarından izlenebilir.

SMTP için eski `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
ayarlanmaya devam eder. WhatsApp için `WHATSAPP_INSTANCE_ID`, `WHATSAPP_TOKEN`,
`WHATSAPP_GROUP_ID`, `WHATSAPP_PARTS_GROUP_ID` kullanılır. Bunlar olmadan dış
bildirim teslimatı doğrulanmış sayılmaz. FCM push, NFC oturum açma, parola
hesapları, oturum iptali ve kişisel çevrimiçi durum takibi kaldırılmıştır.
Uygulama içi bildirim kayıtları korunur. Firebase AI Extension yerine doğrudan
OpenAI (`OPENAI_API_KEY`, isteğe bağlı `OPENAI_MODEL`) veya mevcut Gemini
entegrasyonu kullanılır.

## Yerel geliştirme ve kontroller

```sh
pnpm install --frozen-lockfile
export QORE_LOCAL_DATABASE=/tmp/qore-local-db
pnpm db:local
pnpm dev
```

Yerel seçenek gerçek PostgreSQL motorunun WASM sürümü PGlite'ı kullanır; üretimde
etkinleştirilemez. Neon ile geliştirmek için `DATABASE_URL` kullanın ve
`QORE_LOCAL_DATABASE` ayarlamayın. Şema, istek başına otomatik oluşturulmaz.

```sh
pnpm test
pnpm test:db
pnpm test:e2e
pnpm build
pnpm typecheck
```

E2E için Playwright Chromium kurulmalıdır. Hazır Chromium varsa
`PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e` kullanılabilir. Testler
loopback sunucusu ve ayrı bir yerel SQL dizini açar; canlı Neon'a fixture yazmaz.
Depodaki önceden var olan doğrudan transfer senaryosu `fixme` olarak ayrı raporlanır.
Tip kontrolündeki eski kaynak hataları giderilmiş kabul edilmez; test koşucusunun
derleme tanıları ve TypeScript kontrolü ayrıca incelenmelidir.

## Terminal ve ERP işçileri

Paketlenmiş Android/masaüstü terminalde `NEXT_PUBLIC_API_BASE_URL` uygulamanın
Vercel adresidir. Paket Firebase anahtarı veya SQL parolası taşımaz. Kurumsal
masaüstü istemcileri için sunucuda `QORE_ALLOWED_ORIGINS` tam origin listesiyle ayarlanmalıdır (örneğin `capacitor://localhost,http://localhost`). Vercel erişim koruması da bu istemci akışına uygun yapılandırılmalıdır.

Ceomed işçileri `scripts/db/script-store.cjs` üzerinden aynı Next.js HTTP API'sini
kullanır. Makinede `APP_BASE_URL` ayarlayın; Google servis hesabı JSON'u gerekmez.
Vercel erişim koruması varsa işçi için `VERCEL_AUTOMATION_BYPASS_SECRET` kullanın.
Oracle Forms/Windows işçilerinin fiziksel ERP entegrasyonu bu Linux ortamında
çalıştırılarak doğrulanmamıştır.
