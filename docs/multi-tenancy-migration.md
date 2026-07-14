# Multi-Tenancy Refaktöring Planı

> **Durum: ✅ TAMAMLANDI** — Tüm fazlar (0-9) PR halinde gönderildi ve merge edildi.
> Detaylı QA için bkz. [`multi-tenancy-qa.md`](./multi-tenancy-qa.md).
>
> **Hedef:** Client-side `filterByCompanyScope` filtrelemesinden Firestore-native server-side `where('companyId', '==', X)` izolasyonuna geçiş; Firestore Security Rules ile mühürleme.
>
> **Yaklaşım:** Aşamalı, faz-faz PR. Her faz mevcut sistemi bozmadan ileri taşır.
>
> **Tahmini Süre:** 5-8 iş günü.
>
> ## PR Listesi
>
> | Faz | PR | Konu |
> |---|---|---|
> | Plan | #1286 | Migration plan dokümanı |
> | 0 — Audit | #1287 | `scripts/audit-collections.js` |
> | 1 — Backfill | #1288 | `scripts/backfill-company-id.js` |
> | 2 — Claims | #1289 | `onUserClaimSync` + `sync-claims.js` + auth-context |
> | 3 — Write Hardening | #1290 | tuketim/productCodes/barcodeFormats/notifications/CF |
> | 4 — Query Refactor | #1291 | `scopedQuery` + `useFirebaseQueries.ts` (41 hook) |
> | 5 — Indexes | #1292 | 17 composite index |
> | 6 — Security Rules | #1293 | `firestore.rules` (DSL) + `firebase.json` |
> | 7 — Functions | #1294 | `onNotificationCreated` tenant filter + 2 yeni index |
> | 8 — Tests | #1295 | Rules unit tests + QA rehberi |
> | 9 — Cleanup | (bu PR) | CLAUDE.MD bölümü + plan finalizasyonu |

---

## 1. Mevcut Durum (Audit Bulgu Özeti)

| Bulgu | Yer |
|---|---|
| `filterByCompanyScope` sadece client-side | `src/lib/company-scope.ts:41-53` |
| 40+ Firestore hook'unda `where('companyId', ...)` YOK | `src/hooks/useFirebaseQueries.ts` (1329 satır) |
| Firestore Rules production-ready değil; çoğu koleksiyon açık | `firestore.rules.json` |
| CompanyId composite indeksi yok | `firestore.indexes.json` |
| `currentCompanyId` Auth token claim'i değil, users dokümanından | `src/contexts/auth-context.tsx:177` |
| **Filtresiz koleksiyonlar (kritik):** `tuketimKayitlari`, `dailyConsumptionStats`, `shipments`, `efficiencyHistory` | `useFirebaseQueries.ts` |
| Cloud Functions global scope sorgular yapıyor | `functions/src/index.ts` |

## 2. İş Kararları (Onaylı)

- **Çalışma modu:** Aşamalı, her faz ayrı PR.
- **Katalog koleksiyonları** (`productCodes`, `barcodeFormats`, `faultDefinitions`): **Per-tenant.** companyId eklenecek, izole edilecek.
- **Legacy data:** Tek bir default şirkete migrate edilecek. `__legacy__` sabitinin kullanımı Faz 1 sonunda son bulur.
- **Yedekleme:** Mevcut backup yeterli.

---

## 3. Faz Planı

### Faz 0 — Audit (0.5 gün) · PR #1

**Çıktı:**
- `scripts/audit-collections.ts` — production koleksiyonlarda companyId'siz doc sayımı çıkarır.
- Default-company-id'nin tespiti (legacy data nereye gidecek?).
- Faz 1 öncesi yol haritasının netleşmesi.

**Branch:** `claude/multi-tenancy-faz-0-audit`

---

### Faz 1 — Backfill + Legacy Migration (1 gün) · PR #2

**Yapılacaklar:**
1. `scripts/backfill-company-id.ts` — Admin SDK ile node script:
   - Tüm hedef koleksiyonları gez.
   - `companyId` boş/yok ise → **default company ID**'ye set et (legacy yok).
   - Batch writes (500/batch).
   - `--dry-run` ve `--apply` flag'leri.
2. `src/lib/company-scope.ts`: `LEGACY_COMPANY_ID = '__legacy__'` kaldırılır veya deprecation uyarısı eklenir.

**Hedef Koleksiyonlar (29 adet):**

| Tier | Koleksiyonlar |
|---|---|
| **Tier 1** | devices, depots, hospitals, users, depoStok, hospitalDeviceAssignments |
| **Tier 2** | purchasingTasks, deviceGroups, labPools, addressDefinitions, personnelAvailability, deviceFaultReports, deviceActionForms, aplikasyonActionForms, maintenancePlans, maintenanceLogs, deviceLabPools |
| **Tier 3 (filtresizler)** | tuketimKayitlari, dailyConsumptionStats, shipments, efficiencyHistory, productCodes, barcodeFormats, faultDefinitions |
| **Tier 4** | depotStockCountSessions, maliyetSayimSessions, dutyShifts, borcDepots, notifications, irsaliyeFiles |

**Çıkış:** Tüm dokümanların `companyId` alanı somut bir şirket ID'sine işaret eder.

**Branch:** `claude/multi-tenancy-faz-1-backfill`

---

### Faz 2 — Custom Claim (Token-side companyId) (0.5 gün) · PR #3

**Yapılacaklar:**
1. `functions/src/index.ts`: Yeni Cloud Function `onUserCompanyChange`
   - `users/{uid}` write tetiklenince → `admin.auth().setCustomUserClaims(uid, { companyId, role, isSuperAdmin })`.
2. `scripts/sync-claims.ts` — mevcut tüm users için tek-seferlik claim sync.
3. `src/contexts/auth-context.tsx`:
   - Login sonrası `user.getIdTokenResult(true)` ile token refresh.
   - `currentCompanyId`'yi öncelikle token claim'inden oku, fallback users dokümanı.

**Önemli:** Bu faz canlıya çıktıktan sonra Faz 6 (Security Rules) öncesi **24 saat bekleme** — claim'lerin tüm kullanıcılara yayılması için.

**Branch:** `claude/multi-tenancy-faz-2-claims`

---

### Faz 3 — Write Path Hardening (0.5 gün) · PR #4

**Yapılacaklar:**
1. Tüm `addDoc(...)` ve `setDoc(...)` çağrılarını grep ile tara.
2. Her birinin `withCompanyScope(payload, currentCompanyId)` ile sarıldığını doğrula.
3. Eksik yerleri düzelt. Şüpheli adaylar:
   - `tuketimKayitlari` yazımı
   - `shipments` yazımı
   - `dailyConsumptionStats` (Cloud Function tarafından mı yazılıyor?)
   - `notifications` (function source)
4. Cloud Functions tarafındaki yazımlar için de aynı kontrol.

**Çıkış:** Bundan sonra her yeni doc companyId taşır.

**Branch:** `claude/multi-tenancy-faz-3-writes`

---

### Faz 4 — Query Refactor (Frontend) (2-3 gün) · PR #5

**En uzun ve en kritik faz.**

**Yapılacaklar:**

1. **Yeni helper:** `src/lib/firestore-helpers.ts`
   ```typescript
   export function scopedQuery(
     collectionPath: string,
     currentCompanyId: string,
     isSuperAdmin: boolean,
     ...extraConstraints: QueryConstraint[]
   ): Query {
     if (isSuperAdmin) {
       return query(collection(db, collectionPath), ...extraConstraints);
     }
     return query(
       collection(db, collectionPath),
       where('companyId', '==', currentCompanyId),
       ...extraConstraints
     );
   }
   ```

2. **Tüm hook'ları güncelle** (`src/hooks/useFirebaseQueries.ts`, 40+ hook):
   - `queryKey`'e `currentCompanyId` ve `isSuperAdmin` ekle (React Query cache izolasyonu).
   - `scopedQuery` helper'ı kullan.
   - `enabled: !!currentCompanyId`.
   - `filterByCompanyScope` çağrılarını **kaldır** (defense-in-depth için bırakılabilir — karar PR'da).

3. **Sıra (öncelik):**
   - 🔴 **Önce filtresizler (data leak fix):** `useRecentConsumption`, `useConsumptionByDateRange`, `useDailyConsumptionStats`, `useRecentShipments`, `useEfficiencyHistory`
   - 🟠 **Yüksek hacimli:** `useDepoStok`, `useDevices`, `useTuketimKayitlari`
   - 🟡 **Orta:** Diğer 30+ hook
   - 🟢 **Component dosyalarındaki direkt sorgular** (varsa)

4. **SuperAdmin davranışı:** `where` clause atlanır, tüm tenantların verisi gelir; UI'da company seçici (gelecek faz).

**Önemli:** Bu PR canlıya çıkarılmadan **önce** Faz 5 (indeksler) production'da hazır olmalı.

**Branch:** `claude/multi-tenancy-faz-4-queries`

---

### Faz 5 — Composite Indexes (0.5 gün) · PR #6

**Yapılacaklar:**

1. `firestore.indexes.json`'a aşağıdaki indeksleri ekle:

```
companyId ASC + miad ASC               → depoStok
companyId ASC + isShipped ASC          → depoStok
companyId ASC + depotId ASC            → depoStok
companyId ASC + consumptionTimestamp DESC → tuketimKayitlari
companyId ASC + date ASC               → dailyConsumptionStats
companyId ASC + createdAt DESC         → shipments
companyId ASC + createdAt DESC         → orders, userRequests, sparePartTransferLogs
companyId ASC + status ASC             → dutyShifts, personalStock, deviceFaultReports
companyId ASC + deviceId ASC + formType ASC → draftActionForms
companyId ASC + sourceDepotId ASC + timestamp DESC → transfers
companyId ASC + active ASC             → deviceLabPools, barcodeFormats
companyId ASC + type ASC               → faultDefinitions
```

2. `firebase deploy --only firestore:indexes` (stage → production).
3. Firebase Console'da "Enabled" durumunu bekle (büyük koleksiyon → 15-60 dk).
4. **Faz 4 deploy'undan ÖNCE** indeksler hazır olmalı.

**Branch:** `claude/multi-tenancy-faz-5-indexes`

---

### Faz 6 — Security Rules (1 gün) · PR #7

**ÖNKOŞUL:** Faz 1-5 production'da, Faz 2'den bu yana en az 24 saat geçmiş.

**Yapılacaklar:**

1. `firestore.rules.json` (Firebase'in bu adı kabul ettiğini doğrula; gerekirse `firestore.rules` formatına geçiş):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function isSuperAdmin() { return request.auth.token.isSuperAdmin == true; }
    function userCompany() { return request.auth.token.companyId; }
    function readInCompany() {
      return isSignedIn() &&
        (isSuperAdmin() || resource.data.companyId == userCompany());
    }
    function writeInCompany() {
      return isSignedIn() &&
        (isSuperAdmin() || request.resource.data.companyId == userCompany());
    }

    match /devices/{id}                      { allow read: if readInCompany(); allow write: if writeInCompany(); }
    match /depots/{id}                       { allow read: if readInCompany(); allow write: if writeInCompany(); }
    match /hospitals/{id}                    { allow read: if readInCompany(); allow write: if writeInCompany(); }
    match /depoStok/{id}                     { allow read: if readInCompany(); allow write: if writeInCompany(); }
    match /tuketimKayitlari/{id}             { allow read: if readInCompany(); allow write: if writeInCompany(); }
    match /dailyConsumptionStats/{id}        { allow read: if readInCompany(); allow write: if writeInCompany(); }
    match /shipments/{id}                    { allow read: if readInCompany(); allow write: if writeInCompany(); }
    match /efficiencyHistory/{id}            { allow read: if readInCompany(); allow write: if writeInCompany(); }
    match /productCodes/{id}                 { allow read: if readInCompany(); allow write: if writeInCompany(); }
    match /barcodeFormats/{id}               { allow read: if readInCompany(); allow write: if writeInCompany(); }
    match /faultDefinitions/{id}             { allow read: if readInCompany(); allow write: if writeInCompany(); }
    // ... her koleksiyon için

    match /users/{uid} {
      allow read: if isSignedIn() &&
        (request.auth.uid == uid || isSuperAdmin() ||
         resource.data.companyId == userCompany());
      allow write: if isSignedIn() &&
        (request.auth.uid == uid || isSuperAdmin());
    }
  }
}
```

2. **Rules unit testi:** `tests/firestore-rules.test.ts` — `@firebase/rules-unit-testing`:
   - Company A user → Company B device READ ❌
   - Company A user → kendi device'ı READ ✅
   - SuperAdmin → her şey ✅
   - Unauthenticated → her şey ❌
   - Yazarken farklı companyId set → ❌

3. Stage'e push, smoke test, sonra production.

**Branch:** `claude/multi-tenancy-faz-6-rules`

---

### Faz 7 — Cloud Functions Scoping (0.5 gün) · PR #8

**Yapılacaklar:**
1. `faultInterventionReminder` (functions/src/index.ts:417-525):
   - Sorgu zaten `status == mudahale_bekliyor`; notification target seçiminde her fault'un `companyId`'sini kullan, doğru tenant push token'larına gönder.
2. `maintenanceUpcomingReminder` (534-702):
   - Push notification gönderimi sırasında plan'ın companyId'sine göre target filtrele.
3. `onNotificationCreated` (53-411):
   - Notification source ile target user companyId'lerini eşle. Cross-company push'u engelle.

**Branch:** `claude/multi-tenancy-faz-7-functions`

---

### Faz 8 — Test & QA (1 gün) · PR #9

**Yapılacaklar:**
1. **Rules unit test'i** (Faz 6'da başlatılmıştı; burada genişlet — her koleksiyon için).
2. **E2E manuel:** İki test tenant'ı (Company A, B). Network sekmesinden cross-tenant payload kaçağı yok mu?
3. **Performance:** Faz öncesi/sonrası `useDevices()` için snapshot byte ve süre karşılaştırması.
4. `/verify` skill ile smoke test (login → dashboard → cihazlar → stok → tüketim).

**Branch:** `claude/multi-tenancy-faz-8-tests`

---

### Faz 9 — Cleanup & Dokümantasyon (0.5 gün) · PR #10

**Yapılacaklar:**
1. `filterByCompanyScope` artık sadece SuperAdmin için defansif filtre — veya tamamen kaldırılır.
2. `LEGACY_COMPANY_ID` tamamen kaldırılır.
3. `CLAUDE.MD`'ye "Multi-tenancy" bölümü: yeni geliştirici girdiğinde yanlış pattern kullanmasın.
4. Bu doc'un final hali.

**Branch:** `claude/multi-tenancy-faz-9-cleanup`

---

## 4. Risk & Mitigasyon

| Risk | Mitigasyon |
|---|---|
| Faz 4 deploy edilir ama Faz 5 indeksleri hazır değil → app kilitlenir | Faz 5 önce deploy edilir, indeksler "Enabled" olmadan Faz 4 deploy edilmez. |
| Faz 6 deploy edilir ama Faz 2 claim'i olmayan kullanıcı var → 401 | Faz 2 sonrası 24 saat bekleme; `sync-claims.ts` ile mevcut hesaplar dolu. |
| Backfill sırasında veri kaybı | Dry-run mod + Firestore export backup mevcut (kullanıcı onayladı). |
| Legacy → default-company migration yanlış şirkete yapılır | Faz 0'da default company ID açıkça doğrulanır; Faz 1 PR'ında değer review edilir. |

---

## 5. Faz Akışı Özet

```
Faz 0 (Audit)
   ↓
Faz 1 (Backfill + Legacy migration)
   ↓
Faz 2 (Custom Claim)  ──── 24h bekleme ───┐
   ↓                                      │
Faz 3 (Write Path)                        │
   ↓                                      │
Faz 5 (Indexes) ───── stage + prod ───┐   │
   ↓                                  │   │
Faz 4 (Query Refactor) ◄──────────────┘   │
   ↓                                      │
Faz 6 (Security Rules) ◄──────────────────┘
   ↓
Faz 7 (Cloud Functions)
   ↓
Faz 8 (Test & QA)
   ↓
Faz 9 (Cleanup)
```

**Not:** Faz 4 ve Faz 5 sırası **kritik** — indeksler önce, sorgu refactor sonra.

---

## 6. Tamamlanma sonrası — Bilinçli ertelemeler

Üretim deneyimiyle birlikte ileri PR'lara bırakılan kalemler:

### Yapısal
- **`dailyConsumptionStats` redesign** — `docId = dateKey` formatı tüm tenant'ları tek doc'a yazıyor. Çözüm: `${companyId}_${dateKey}` veya alt-koleksiyon. Hook ve writer her ikisi de güncellenmeli; rules da sıkılaştırılmalı (`inCompany()`).

### Loose-tier sıkılaştırması (firestore.rules)
Aşağıdaki ~50 koleksiyon halen `isSignedIn()` ile açık; query refactor'u (Faz 4 pattern'i) ile birlikte rules de strict'e geçirilmeli:
- orders, vehicles, assets, assetCategories, transfers
- purchasingTaskDefinitions, purchasingWorkflows, sparePartTransferLogs
- companies, personnel, personelGruplari, personnelHistoryLogs
- userRequests, overtimeRequests, draftActionForms
- ejectedKitRecords, trashBinRecords, destroyedKitsReports
- deviceBrandModels, deviceModelDefinitions, periodicPartChanges, periodicPartChangeLogs, postClosurePartChangeLogs
- yedekParcaDepoStok, yedekParcaDepoLog, yedekParcaSiparisler, borrowedSpareParts
- testDefinitions, archiveRacks, routes, shiftSchedules, expensePeriods, transferTemplates, costCheckpoints
- malKabulTransactions, depotBrandCountSessions, depotBrandCountValidationLogs, productReturns, pendingReturns
- consumableRequests, centralOrders, kumulatifRaporlar, totalEfficiencyRecords, minMaxHistory
- borcTransfers, bekleyenIrsaliyeler, irsaliyeDosyalari, pendingCeomedIrsaliye
- nfcDisposalEvents, cihazUstuGecmisi, digerFirmaArizalar, teknikServisActionForms
- actionFormHistoryLogs, actionFormPartReassignLogs
- personalStock, poolWarehouseStock, efficiencyPools

### Yazma path takip
Faz 3'te ertelenenler (orta risk, hâlâ client-side filter altında):
- `cihaz-yonetimi-host.tsx` personnelAvailability
- `EfficiencyPoolModal.tsx` efficiencyPools
- `kullanici-talep-panel.tsx` userRequests
- `purchasing/SatinAlmaPanel.tsx`, `purchasing/WorkflowCanvasPanel.tsx`
- `faults.ts` history entries
- `maliyet-session.ts` maliyetSayimSessions
- `ariza-yonetimi/[id]/page.tsx` fault history entries
- inventory category, ejectedKitRecords, vb.

### Cleanup
- `filterByCompanyScope` çağrılarını sadeleştir veya kaldır (defense-in-depth artık Rules tarafından sağlanıyor).
- `LEGACY_COMPANY_ID = '__legacy__'` sabitini kaldır (Faz 1 backfill sonrası tüm doc'lar gerçek companyId taşıyor).

### Test infrastructure
- CI'a `pnpm test:rules:emulated` ekle (GitHub Actions workflow).
- E2E (Playwright vb.) çerçevesi multi-tenant izolasyonu otomatik doğrulasın.
