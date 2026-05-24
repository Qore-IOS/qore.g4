# Multi-Tenancy QA & Test Rehberi

Faz 8 — Multi-tenancy refaktöringinin (Faz 0–7) staging ve production'da doğrulanması için checklist.

---

## 1. Otomatik Rules Unit Testleri

**Setup (bir kez):**

```bash
pnpm install              # @firebase/rules-unit-testing devDep ile gelir
firebase login            # Firebase CLI gerekli
```

**Çalıştırma:**

```bash
# Otomatik: emulator başlatır, testleri koşturur, kapatır
pnpm test:rules:emulated

# Manuel: emulator'ı ayrı terminalde başlat, sonra test çalıştır
firebase emulators:start --only firestore
# (yeni terminal)
pnpm test:rules
```

**Kapsam:** `tests/firestore-rules.test.ts`

- ✅ Tenant izolasyonu (cross-tenant okuma/yazma reddedilir)
- ✅ SuperAdmin bypass
- ✅ Unauthenticated reddedilir
- ✅ `/users/{uid}` özel kuralları
- ✅ Loose-tier kollection'lar signed-in erişim
- ✅ Bilinmeyen kollection default-deny

---

## 2. E2E Manuel Test — İki Tenant Senaryosu

### Hazırlık

İki test tenant'ı hazırla (staging):

1. **Tenant A** — companyId: `companyA`
   - Kullanıcı: `userA@test.com` (role: user, companyId: companyA)
   - 1 cihaz: "Cihaz-A1"
   - 1 depo: "Depo-A"
   - 1 stok kaydı
2. **Tenant B** — companyId: `companyB`
   - Kullanıcı: `userB@test.com` (role: user, companyId: companyB)
   - 1 cihaz: "Cihaz-B1"
   - 1 depo: "Depo-B"

### Senaryolar

#### S1: Sayfa-bazlı izolasyon

| Sayfa | Tenant A user beklenen | Tenant B user beklenen |
|---|---|---|
| `/cihaz-yonetimi-ana` (Cihazlar) | Sadece "Cihaz-A1" | Sadece "Cihaz-B1" |
| `/yonetim/depo-yonetim` (Depolar) | Sadece "Depo-A" | Sadece "Depo-B" |
| `/stok-yonetimi` | Sadece A stokları | Sadece B stokları |
| `/urun-kullanim` | Sadece A tüketimleri | Sadece B tüketimleri |
| `/dashboard` | A'nın metriği | B'nin metriği |
| `/yonetim/kullanici-yonetim` | Sadece A kullanıcıları | Sadece B kullanıcıları |

#### S2: Network sekmesi sızıntı testi

1. Tenant A user ile giriş yap.
2. DevTools → Network sekmesini aç → "Fetch/XHR" filtre.
3. Cihazlar sayfasını yenile.
4. Her Firestore yanıtı incele: **`companyId: "companyB"` olan hiçbir doc gelmemeli**.
5. Aynı testi şu sayfalarda tekrarla: depoStok, tuketimKayitlari, shipments.

#### S3: Yazma izolasyonu

1. Tenant A user olarak giriş.
2. Yeni cihaz/stok/tüketim oluştur.
3. Firebase Console → Firestore → ilgili doc'a bak.
4. `companyId: "companyA"` set edilmiş olmalı.

#### S4: SuperAdmin

1. SuperAdmin (`isSuperAdmin: true`) user ile giriş.
2. Tüm tenant'ların cihazlarını/stoklarını görüyor olmalı.
3. Cross-tenant doc'a write yapabilmeli.

#### S5: Push notification izolasyonu

1. Tenant B user'ın push subscription'ı aktif.
2. Tenant A'da arıza aç (`fault_opened` → notification doc oluşturulur, companyId=A).
3. Tenant B kullanıcısı **push almamalı**.
4. Tenant A admin (role:admin + companyId=A) push almalı.
5. Firebase Console → `notificationLogs` koleksiyonunda `tokensFilteredByCompany > 0` görmelisin (eğer B'de eşleşen role varsa).

#### S6: Anonymous / Unauthenticated

1. Logout.
2. DevTools console:
   ```js
   await firebase.firestore().collection('devices').get();
   ```
3. **403 / permission-denied** dönmeli.

---

## 3. Performans Karşılaştırması (Optional)

**Önce/Sonra:** Faz 4 öncesi (client-side filter) vs. sonrası (server-side filter).

**Ölçüm:**

1. Chrome DevTools → Performance + Network.
2. Hard refresh ile `/cihaz-yonetimi-ana` aç.
3. Aşağıdaki metrikleri kaydet:
   - `useDevices` request → response time (ms)
   - Response payload size (KB)
   - JS parse + filter süresi (ms)
   - First Contentful Paint
4. Tenant A'nın doc sayısı X, sistemdeki toplam Y (X / Y oranı azaldıkça kazanç artar).

**Beklenen kazanç:** Tenant başına ortalama 50-200x okuma azalması (50 tenant'lı sistem varsayımıyla).

---

## 4. Rollback Hazırlığı

Production'a deploy ederken aşağıdaki rollback komutları **hazır olsun**:

```bash
# Rules geri al (Faz 6 öncesi durum: hiç rules deploy edilmemişti)
# Önceki commit'ten firestore.rules'u checkout edip deploy
git show HEAD~1:firestore.rules > firestore.rules.rollback
# Manuel düzenleme: allow read, write: if request.auth != null;
firebase deploy --only firestore:rules

# Indexes geri al
git revert <faz-5-commit-sha>
firebase deploy --only firestore:indexes

# Custom claims sıfırla (Faz 2)
# Auth kullanıcılarına claim manuel olarak null set edilebilir,
# ama auth-context'in fallback path'i users doc'tan companyId
# okumaya devam ettiği için claim olmasa da sistem çalışır.
```

---

## 5. Faz Bazlı Doğrulama Checklist

| Faz | Doğrulama |
|---|---|
| 0 — Audit | `node scripts/audit-collections.js` → rapor üret, default-company tespit et |
| 1 — Backfill | Audit tekrar çalıştır → unscoped doc sayısı = 0 |
| 2 — Claims | DevTools → `await user.getIdTokenResult().then(r => r.claims.companyId)` → değer dönmeli |
| 3 — Write hardening | Yeni doc oluştur, Firestore Console'da companyId field görünmeli |
| 4 — Queries | DevTools Network → request'lerde `where: companyId == X` görünmeli; payload daralmalı |
| 5 — Indexes | Firebase Console > Firestore > Indexes → tüm yeni indeksler "Enabled" |
| 6 — Rules | Bu doc S1-S6 senaryoları geçer |
| 7 — Functions | S5 push notification testi geçer |
| 8 — Tests | `pnpm test:rules:emulated` → tüm testler PASS |

---

## 6. Bilinen Erteleme Listesi

Aşağıdakiler **kasıtlı olarak** Faz 9 cleanup veya follow-up PR'a bırakıldı:

- **`dailyConsumptionStats` yapısal refactor** — docId formatı `${companyId}_${dateKey}` veya alt-koleksiyon olarak yeniden tasarlanmalı.
- **Loose-tier koleksiyonların sıkılaştırılması** — orders, vehicles, transfers, purchasingWorkflows, vb. ~50 koleksiyon halen `isSignedIn()` ile açık. Her birinin sorgu refactor'u ile birlikte rules sıkılaştırılmalı.
- **`filterByCompanyScope` kaldırılması** — defense-in-depth olarak kalıyor; Faz 9'da Faz 6 rules production'da doğrulandıktan sonra silinir.
- **`LEGACY_COMPANY_ID = '__legacy__'` sabitinin temizlenmesi** — Faz 1 backfill sonrası tüm doc'lar default-company taşıyor, sabit artık gereksiz.

---

## 7. Sorun Giderme

### "permission-denied" hatası — Faz 6 deploy sonrası

- **Sebep 1:** Kullanıcının token'ı eski (claim yok). Çözüm: logout/login.
- **Sebep 2:** `sync-claims.js --apply` çalıştırılmamış. Çözüm: çalıştır + 24h bekle.
- **Sebep 3:** Doküman companyId'siz (Faz 1 backfill yapılmamış). Çözüm: audit + backfill.

### "failed-precondition" hatası — Faz 4 sonrası

- **Sebep:** Composite index henüz "Enabled" değil. Çözüm: Firebase Console'da Index sekmesi → bekle.

### Push notification gelmiyor

- **Sebep:** `tokensFilteredByCompany > 0` (Faz 7). User'ın companyId'si notification companyId'si ile eşleşmiyor. Source doc'un companyId'si doğru mu kontrol et.
