# Strict Mode Migration Board (Faz 0 Başlangıç)

Bu board, TypeScript strict mode geçişini dosya/modül bazında takip etmek için oluşturuldu.

## Hedef
- `tsconfig.json` strict bayraklarını kademeli açmak.
- Her adımda CI üzerinden `pnpm typecheck` ve `pnpm lint` yeşil tutmak.
- Geçici bypass yerine dosya bazlı kapanış planı ile teknik borcu görünür yönetmek.

## Fazlar

### Faz 0 (Tamamlandı)
- [x] Build kalite kapıları için CI workflow eklendi.
- [x] Build'de lint/type ignore bayrakları kapatıldı.
- [x] Strict migration board oluşturuldu.

### Faz 1 (Planlandı)
Açılacak bayraklar:
- [ ] `noImplicitAny`
- [ ] `strictNullChecks`
- [ ] `noUncheckedIndexedAccess`

Çalışma paketleri:
- [ ] `src/app/**` route handler ve page tiplerinin temizlenmesi
- [ ] `src/hooks/**` generic ve nullable state geçişi
- [ ] `src/services/**` any kullanan parse/format katmanı refactor
- [ ] `src/lib/**` doğrulama katmanında tip daraltma iyileştirmeleri
- [ ] `src/components/**` prop tiplerinde optional/nullable standardizasyonu

### Faz 2 (Planlandı)
Açılacak bayraklar:
- [ ] `exactOptionalPropertyTypes`
- [ ] `noImplicitOverride`
- [ ] `noPropertyAccessFromIndexSignature`

Çalışma paketleri:
- [ ] domain model optional alanlarının yeniden düzenlenmesi
- [ ] base class kullanan alanlarda override zorunluluklarının kapatılması
- [ ] index signature üzerinden dolaylı erişimlerin tip-safe hale getirilmesi

## Modül Bazlı Takip Tablosu

| Modül | Sorumlu | Durum | Not |
|---|---|---|---|
| `src/app` | TBD | Planned | API route input/output şemaları netleştirilecek |
| `src/hooks` | TBD | Planned | nullable ve async state tipleri standardize edilecek |
| `src/services` | TBD | Planned | tarih/format/transform katmanında `any` azaltılacak |
| `src/lib` | TBD | Planned | domain helper’lar strict uyumlu hale getirilecek |
| `src/components` | TBD | Planned | props contract’ları strict null checks ile uyumlanacak |
| `functions/src` | TBD | Planned | cloud function payload tipleri sertleştirilecek |

## Operasyonel Kurallar
- Her PR strict debt'i azaltmalı veya nötr olmalı.
- Yeni eklenen dosyalarda `any` kullanımı gerekçesiz olmamalı.
- `TODO(strict)` notu eklenen noktalar issue numarası ile ilişkilendirilmeli.
- Haftalık strict burn-down metriği paylaşılmalı.

## Çıkış Kriteri
- `tsconfig.json` strict bayrakları tamamen açık.
- CI'da `pnpm typecheck`, `pnpm lint`, `pnpm test` sürekli yeşil.
