# Firestore kurallarını kilitlenmeden yayınlama

> **Sorun:** `firebase deploy --only firestore:rules` sonrası kullanıcılar veri
> okuyamaz/yazamaz hâle geliyor.

Bu belge sebebini ve güvenli yayın sırasını anlatır.

## Neden oluyor?

`deploy` komutu kuralları **değiştirir**, birleştirmez. Üretimde hâlihazırda
çalışan (muhtemelen daha gevşek) kurallar, bu depodaki sıkı çok-kiracılı
sürümle yer değiştirir. İki bağımsız kök neden var.

### Kök neden 1 — kuralı olmayan koleksiyon = sessiz ret

Firestore, hiçbir `match` bloğu olmayan koleksiyonu **varsayılan olarak
reddeder**. Uygulama kodu tarayıcıdan 23 koleksiyonu okuyup yazıyordu ama bu
koleksiyonların kural bloğu yoktu:

`shortcuts` · `shortcutRuns` · `shortcutRunRequests` · `shortcutRunLogs` ·
`routeRequests` · `routeSequences` · `lotNfcDefinitions` · `lot_tags` ·
`labTransferDates` · `labManualSerialSnapshots` · `depoSayimBackfillLogs` ·
`yedekParcaDepoMinMax` · `ceomedDepoStok` · `ceomedSevkiyatRequests` ·
`ceomedSevkiyatResults` · `isAnaliziVerileri` · `analysis_results` ·
`actionFormNumberCounters` · `qoreCalculationPeriodCounters` ·
`notificationLogs` · `ordersArchive` · `appSettings` · `settings` ·
`config_hospitals`

Aynı hata `serialHistory`'de de vardı ve seri no takibindeki tüm stok
tutarsızlığının kök nedeniydi (bkz. `docs/serial-ledger.md`).

Bu koleksiyonların hepsine `inCompany()` / `writingInCompany()` blokları
eklendi. Bu geriye dönük uyumludur: `companyId` alanı **taşımayan** eski
belgeler okunmaya ve yazılmaya devam eder (helper'lardaki
`!('companyId' in ...)` koşulu). Yalnızca başka bir şirkete ait olduğu açıkça
etiketlenmiş belgeler engellenir.

### Kök neden 2 — eksik `companyId` custom claim

`inCompany()` şunu okur: `request.auth.token.companyId`. Bu claim'i
`onUserClaimSync` Cloud Function'ı `users/{uid}` her yazıldığında ayarlar; ilk
tohumlama `scripts/sync-claims.js` ile yapılır.

Bir kullanıcının token'ında `companyId` **yoksa**, `companyId` etiketi taşıyan
her belge için:

- `docCompany() == userCompany()` → `"companyA" == undefined` → **false** → okuma reddedilir
- `newDocCompany() == userCompany()` → aynı → **yazma reddedilir**

Yani o kullanıcı için uygulama tamamen çalışmaz. Function deploy edilmemişse
veya `sync-claims.js` hiç koşulmamışsa, bu **tüm kullanıcıları** etkiler.

`src/contexts/auth-context.tsx` claim eksik/uyuşmazsa açılışta token'ı
force-refresh eder — ama bu ancak claim sunucu tarafında **gerçekten varsa**
işe yarar.

## Geçici güvenlik ağı

`firestore.rules` sonunda, kuralı unutulan koleksiyonların kilitlenmesini
önleyen bir blok var:

```
match /{col}/{docId}          { allow read: if notNarrowed(col) && inCompany(); … }
match /{col}/{docId}/{rest=**} { … }
```

**Çok kiracılığı zayıflatmaz** — koşul yine `inCompany()`, başka şirketin
etiketli belgesi yine engellenir. Düz bir
`match /{document=**} { allow read, write: if isSignedIn(); }` catch-all'ı
**bilerek kullanılmadı**: Firestore'da `allow` kuralları OR'lanır, böyle bir
blok yukarıdaki tüm sıkı kuralları ezip kiracı izolasyonunu tamamen iptal
ederdi.

`notNarrowed()` listesi, kendi bloğu `inCompany()`den **daha sıkı** olan
koleksiyonları ağın dışında tutar (aynı OR semantiği yüzünden ağ onları da
gevşetirdi): `users`, `AuditLogs`, `companies`, `companyStats`, `costSnapshots`,
`stockAdjustmentLogs`, `serialLedger`, `cariPayments`, `cariAuditEvents`,
`labPeriodSnapshots`, `calendarConnections`, `calendarOAuthStates`.

Bu davranış testlerle sabitlendi (`tests/firestore-rules.test.ts`): ağın
kilitlenmeyi önlediği **ve** hiçbir sıkı kuralı gevşetmediği ayrı ayrı
doğrulanıyor.

## Yayın sırası

### Adım 1 — claim'leri doğrula (yazma yok)

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/yol/service-account.json
export FIREBASE_PROJECT_ID=<proje-id>

pnpm rules:preflight
```

Hangi kullanıcıların `companyId` claim'i eksik/uyuşmaz olduğunu listeler. Sorun
varsa çıkış kodu 1 döner.

### Adım 2 — claim'leri düzelt

```bash
node scripts/sync-claims.js            # dry-run: ne değişecek
node scripts/sync-claims.js --apply    # uygula
```

`onUserClaimSync` fonksiyonunun deploy edildiğinden de emin olun:

```bash
firebase deploy --only functions:onUserClaimSync
```

`pnpm rules:preflight` temiz çıkana kadar tekrarlayın.

### Adım 3 — kuralları emülatörde doğrula

```bash
pnpm test:rules:emulated
```

(Java 17 + `firebase-tools` gerekir.)

### Adım 4 — yayınla

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

İndeksler önce, kurallar sonra yayınlanır; bileşik indekslerin oluşması birkaç
dakika sürebilir.

### Adım 5 — izle

Firebase Console → Firestore → Rules → **Monitor** sekmesinden birkaç gün
"denied" isteklerini izleyin. Reddedilen bir yol görürseniz o koleksiyonun
kural bloğu eksik demektir.

### Adım 6 — güvenlik ağını kaldır (Faz 2)

**Bu adım hazır bir PR olarak bekliyor.** `firestore.rules` içindeki "GEÇİCİ
GÜVENLİK AĞI" bölümü (`notNarrowed` + iki `match` bloğu) kaldırılmış ve
`tests/firestore-rules.test.ts` içindeki "Tanımsız koleksiyon" testleri
"reddedilir" beklentisine geri çevrilmiş durumda.

**Merge etmeden önce şunu doğrulayın:**

1. Adım 4'teki deploy yapıldı ve üzerinden en az birkaç iş günü geçti.
2. Firebase Console → Firestore → Rules → **Monitor** sekmesinde o süre boyunca
   **hiç "denied" isteği görünmedi**.

Monitor'de reddedilen bir yol varsa **merge etmeyin**: o koleksiyonun `match`
bloğu eksik demektir. Önce kuralını ekleyin, yeniden yayınlayın, tekrar izleyin.

Merge sonrası `firebase deploy --only firestore:rules` ile yayınlayın. Bu
noktadan sonra `match` bloğu olmayan koleksiyon yeniden **varsayılan olarak
reddedilir** — yani ağın sakladığı bir eksik varsa o an yüzeye çıkar.

## Geri alma

Kurallar sürümlenir. Firebase Console → Firestore → Rules → **History**'den
önceki sürüm tek tıkla geri yüklenebilir. Yayın öncesi mevcut sürümü
kopyalayıp saklamak da iyi bir alışkanlıktır.

## Kalıcı kural: yeni koleksiyon eklerken

`CLAUDE.MD`'deki "yeni koleksiyon" adımlarına uyun — özellikle
`firestore.rules`'a `match` bloğu eklemeyi atlamayın. Güvenlik ağı kaldırıldığı
anda, kuralı olmayan koleksiyon yeniden sessizce reddedilir ve bu hata üretimde
ancak kullanıcı şikâyetiyle fark edilir.
