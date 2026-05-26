# Multi-Tenancy Phase 2 — Loose-Tier Sıkılaştırma

> **Durum: ✅ TAMAMLANDI** — Tüm Phase 2 fazları (A-N) merge edildi. ~85 koleksiyon strict tier'da, dailyConsumptionStats yapısal refactor + service-level kod + CI tamamlandı.
>
> **Phase 2** = Phase 1'de (PR #1286-#1296) tamamlanmamış kalan ~50 koleksiyonu strict tier'a taşımak + dailyConsumptionStats yapısal refactor + cleanup.
>
> Phase 1 sonrası durum: 28 koleksiyon strict, ~50 koleksiyon loose.
>
> ## Phase 2 PR Listesi
>
> | PR | Faz | Konu |
> |---|---|---|
> | #1297 | 2-A | Audit + plan |
> | #1298 | 2-B | orders strict |
> | #1299 | 2-C | personnel/personalStock/companies özel rule |
> | #1300 | 2-D | yedek parça grubu (6 koleksiyon) |
> | #1301 | 2-E | assets/efficiencyPools/userRequests + 4 (7) |
> | #1302 | 2-F | testDefinitions/brandModels/costCheckpoints/shifts (6) |
> | #1303 | 2-G | expensePeriods/cihazUstuGecmisi/action-form logs (6) |
> | #1304 | 2-H | log/audit + mal kabul + ejected + irsaliye (11) |
> | #1305 | 2-I | depo-sayim + poolWarehouseStock (4) |
> | #1306 | 2-J | routes + draftActionForms (2) |
> | #1307 | 2-K | periodicPartChanges + periodicPartChangeLogs |
> | #1308 | 2-L | kalan read-only (6) |
> | #1309 | 2-M | dailyConsumptionStats yapısal redesign |
> | (bu PR) | 2-N | cleanup + service-level + CI |

---

## 1. Audit Özeti (Phase 2-A)

58 loose-tier koleksiyon incelendi.

### Risk dağılımı

| Risk | Sayı | Pattern |
|---|---|---|
| 🔴 Kritik (yüksek hacim + hassas data) | 12 | orders, companies, personalStock, transfers, yedekParca*, borrowedSpareParts, draftActionForms, assetCategories, personelGruplari |
| 🟠 Yüksek (orta hacim) | 15 | assets, efficiencyPools, deviceBrandModels, deviceModelDefinitions, purchasingTaskDefinitions, purchasingWorkflows, testDefinitions, vehicles, expensePeriods, transferTemplates, archiveRacks, routes, shiftSchedules, costCheckpoints, userRequests |
| 🟡 Orta (düşük hacim, log/history) | 8 | AuditLogs, *HistoryLogs, *PartReassignLogs, periodicPartChangeLogs, periodicPartChanges, postClosurePartChangeLogs, nfcDisposalEvents, cihazUstuGecmisi |
| 🟢 Düşük (read-only veya nadir) | 23 | malKabulTransactions, depotBrandCount*, productReturns, pendingReturns, bekleyenIrsaliyeler, irsaliyeDosyalari, kumulatifRaporlar, minMaxHistory, borcTransfers, vd. |

### Yazma scope durumu

- **2 koleksiyon doğru** (`vehicles`, `assets`): `withCompanyScope` kullanıyor
- **39 koleksiyon eksik**: addDoc/setDoc'larda companyId yok
- **17 koleksiyon write-free**: Sadece read, low priority

---

## 2. PR Planı

### Phase 2-A — Bu PR (Audit + Plan)

Sadece dokümantasyon.

### Phase 2-B — Kritik koleksiyonlar (10)
- orders, companies, personnel, personnelHistoryLogs, personelGruplari
- personalStock, transfers, sparePartTransferLogs
- yedekParcaDepoStok, yedekParcaDepoLog, yedekParcaSiparisler, borrowedSpareParts

Her biri için:
1. `withCompanyScope` ile write hardening
2. Hook varsa `scopedQuery`'e geçiş
3. `firestore.rules` strict tier (`inCompany()`)
4. Composite index (gerekirse)

### Phase 2-C — İş koleksiyonları (15)
- assets, assetCategories (zaten doğru `vehicles` pattern'ini takip et)
- draftActionForms, efficiencyPools
- deviceBrandModels, deviceModelDefinitions
- purchasingTaskDefinitions, purchasingWorkflows
- testDefinitions, archiveRacks, routes, shiftSchedules
- expensePeriods, transferTemplates, costCheckpoints
- userRequests, vehicles (zaten doğru → sadece rules strict)

### Phase 2-D — Log/history (8)
- AuditLogs, actionFormHistoryLogs, actionFormPartReassignLogs
- periodicPartChangeLogs, periodicPartChanges, postClosurePartChangeLogs
- nfcDisposalEvents, cihazUstuGecmisi

Write-only veya read-rare → minimal refactor. Rules strict ekle, gerekiyorsa companyId field ekle.

### Phase 2-E — Mal kabul/sayım/irsaliye (15+)
- malKabulTransactions, depotBrandCountSessions, depotBrandCountValidationLogs
- productReturns, pendingReturns
- bekleyenIrsaliyeler, irsaliyeDosyalari, pendingCeomedIrsaliye
- kumulatifRaporlar, totalEfficiencyRecords, minMaxHistory
- borcTransfers, consumableRequests, centralOrders
- destroyedKitsReports, ejectedKitRecords, trashBinRecords
- teknikServisActionForms, digerFirmaArizalar, poolWarehouseStock
- overtimeRequests

### Phase 2-F — `dailyConsumptionStats` yapısal redesign
- DocId formatı: `${dateKey}` → `${companyId}_${dateKey}`
- Writer (`src/lib/dailyConsumptionStats.ts`) güncelle
- Reader (`useDailyConsumptionStats` hook) güncelle
- Migration script: eski docs'ları yeni formata taşı (her tenant için ayrı toplam üret)
- Rules strict tier'a al

### Phase 2-G — Cleanup
- `filterByCompanyScope` çağrılarını sadeleştir/kaldır (defense-in-depth artık Rules tarafından)
- `LEGACY_COMPANY_ID = '__legacy__'` sabitini kaldır
- `withCompanyScope` LEGACY_COMPANY_ID fallback path'ini sadeleştir
- Eski plan dokümanındaki ertelenenleri ✅ işaretle

### Phase 2-H — CI integration
- GitHub Actions: `pnpm test:rules:emulated` her PR'da çalışsın
- Firebase emulator action setup
- Build hatasında PR engellensin

---

## 3. Migration Pattern (her PR'da)

```typescript
// 1) Hook (varsa) — yeni:
export function useOrders() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['orders', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('orders', currentCompanyId, isSuperAdmin));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    // ...
  });
}

// 2) Write — withCompanyScope ile sar:
await setDoc(doc(db, 'orders', orderId), withCompanyScope(payload, currentCompanyId));
await addDoc(collection(db, 'orders'), withCompanyScope(payload, currentCompanyId));

// 3) firestore.rules — strict tier'a taşı:
match /orders/{id} { allow read: if inCompany(); allow write: if writingInCompany(); }
// (LOOSE tier'dan kaldır)

// 4) firestore.indexes.json — gerekirse composite:
{ "collectionGroup": "orders", "fields": [
  { "fieldPath": "companyId", "order": "ASCENDING" },
  { "fieldPath": "createdAt", "order": "DESCENDING" }
]}
```

---

## 4. Risk Yönetimi

Her PR sonrası mevcut data:
- **Backfill yapılmadıysa** Faz 1 backfill script'i ile o koleksiyon için tekrar çalıştırılmalı
- Rules deploy öncesi staging smoke test
- Rollback: rules'tan strict block'u kaldır + redeploy

Composite index gerektiren her PR için: rules deploy'undan **önce** index Enabled durumda olmalı.

---

## 5. Tahmini Süre

- 2-A: 0.5 gün ✅ (bu PR)
- 2-B: 1.5 gün
- 2-C: 2 gün
- 2-D: 0.5 gün
- 2-E: 2 gün
- 2-F: 1.5 gün
- 2-G: 0.5 gün
- 2-H: 0.5 gün

**Toplam: ~9 iş günü**
