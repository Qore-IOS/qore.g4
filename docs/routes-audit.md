# Routes Audit (Next.js App vs Pages Router)

Date: 2025-09-03

## Summary
- The repository contains both App Router (`src/app/`) and Pages Router (`src/pages/`).
- This causes route duplication and bundler confusion. We recommend consolidating to App Router.

## App Router pages (src/app/**/page.tsx)
- /(root): `src/app/page.tsx`
- /login: `src/app/login/page.tsx`
- /health: `src/app/health/page.tsx`
- /hastane-yonetimi: `src/app/hastane-yonetimi/page.tsx`
- /urun-kullanim-dogrulama: `src/app/urun-kullanim-dogrulama/page.tsx`
- /urun-kullanim-istatistik: `src/app/urun-kullanim-istatistik/page.tsx`
- /laboratuvar/sayim/[labId]: `src/app/laboratuvar/sayim/[labId]/page.tsx`
- /laboratuvar/sayim/[labId]/history: `src/app/laboratuvar/sayim/[labId]/history/page.tsx`
- /laboratuvar/sayim/[labId]/history/[sessionId]: `src/app/laboratuvar/sayim/[labId]/history/[sessionId]/page.tsx`

Protected group `(protected)`:
- /(protected)/dashboard: `src/app/(protected)/dashboard/page.tsx`
- /(protected)/cihaz-yonetimi-ana: `src/app/(protected)/cihaz-yonetimi-ana/page.tsx`
- /(protected)/depo-sayim: `src/app/(protected)/depo-sayim/page.tsx`
- /(protected)/hastane-yonetimi: `src/app/(protected)/hastane-yonetimi/page.tsx`
- /(protected)/kullanim-dogrulama: `src/app/(protected)/kullanim-dogrulama/page.tsx`
- /(protected)/kumulatif-gecmis: `src/app/(protected)/kumulatif-gecmis/page.tsx`
- /(protected)/kumulatif-hesaplama: `src/app/(protected)/kumulatif-hesaplama/page.tsx`
- /(protected)/laboratuvar-yonetimi: `src/app/(protected)/laboratuvar-yonetimi/page.tsx`
- /(protected)/mal-kabul: `src/app/(protected)/mal-kabul/page.tsx`
- /(protected)/raporlama: `src/app/(protected)/raporlama/page.tsx`
- /(protected)/raporlama/gecmis-stok-raporu: `src/app/(protected)/raporlama/gecmis-stok-raporu/page.tsx`
- /(protected)/stok-yonetimi: `src/app/(protected)/stok-yonetimi/page.tsx`
- /(protected)/tuketim-istatistikleri: `src/app/(protected)/tuketim-istatistikleri/page.tsx`
- /(protected)/urun-kullanim: `src/app/(protected)/urun-kullanim/page.tsx`
- /(protected)/urun-kullanim-dogrulama: `src/app/(protected)/urun-kullanim-dogrulama/page.tsx`
- /(protected)/urun-kullanim-istatistik: `src/app/(protected)/urun-kullanim-istatistik/page.tsx`
- /(protected)/verimlilik-hesaplama: `src/app/(protected)/verimlilik-hesaplama/page.tsx`
- /(protected)/yonetim: `src/app/(protected)/yonetim/page.tsx`
- /(protected)/yonetim/adresler: `src/app/(protected)/yonetim/adresler/page.tsx`
- /(protected)/yonetim/barkod-formatlari: `src/app/(protected)/yonetim/barkod-formatlari/page.tsx`
- /(protected)/yonetim/borc-depolar: `src/app/(protected)/yonetim/borc-depolar/page.tsx`
- /(protected)/yonetim/depolar: `src/app/(protected)/yonetim/depolar/page.tsx`
- /(protected)/yonetim/kullanicilar: `src/app/(protected)/yonetim/kullanicilar/page.tsx`
- /(protected)/yonetim/laboratuvarlar: `src/app/(protected)/yonetim/laboratuvarlar/page.tsx`
- /(protected)/yonetim/tanimlar: `src/app/(protected)/yonetim/tanimlar/page.tsx`
- /(protected)/yonetim/test-yonetimi: `src/app/(protected)/yonetim/test-yonetimi/page.tsx`
- /(protected)/yonetim/urun-kodlari: `src/app/(protected)/yonetim/urun-kodlari/page.tsx`

API (App Router):
- /api/kumulatif/extract: `src/app/api/kumulatif/extract/route.ts`
- /api/kumulatif/extract-server: `src/app/api/kumulatif/extract-server/route.ts`

## Pages Router pages (src/pages/**/*)
Top-level pages:
- /(root): `src/pages/index.tsx`
- /login: `src/pages/login.tsx`
- /dashboard: `src/pages/dashboard.tsx`
- /cihaz-yonetimi-ana: `src/pages/cihaz-yonetimi-ana.tsx`
- /depo-sayim: `src/pages/depo-sayim.tsx`
- /depo-sayim-gecmis: `src/pages/depo-sayim-gecmis.tsx` and `src/pages/depo-sayim-gecmis/page.tsx`
- /direkt-transfer: `src/pages/direkt-transfer.tsx`
- /hastane-yonetimi: `src/pages/hastane-yonetimi.tsx`
- /kullanim-dogrulama: `src/pages/kullanim-dogrulama.tsx`
- /kumulatif-gecmis: `src/pages/kumulatif-gecmis.tsx`
- /kumulatif-hesaplama: `src/pages/kumulatif-hesaplama.tsx`
- /laboratuvar-yonetimi: `src/pages/laboratuvar-yonetimi.tsx`
- /mal-kabul: `src/pages/mal-kabul.tsx`
- /raporlama: `src/pages/raporlama.tsx`
- /siparisler: `src/pages/siparisler.tsx`
- /stok-yonetimi: `src/pages/stok-yonetimi.tsx`
- /stok-yonetimi-gecmis: `src/pages/stok-yonetimi-gecmis.tsx`
- /tuketim-istatistikleri: `src/pages/tuketim-istatistikleri.tsx`
- /cost-dashboard: `src/pages/cost-dashboard.tsx`
- /teknik-servis (and children): `src/pages/teknik-servis/*`
- /transfer-gecmis (and children): `src/pages/transfer-gecmis/*`

Dynamic and nested pages:
- /laboratuvar/sayim/[labId]: `src/pages/laboratuvar/sayim/[labId].tsx`
- /laboratuvar/sayim/history: `src/pages/laboratuvar/sayim/history.tsx`
- /laboratuvar/sayim/history/[labId]: `src/pages/laboratuvar/sayim/history/[labId]/index.tsx`
- /laboratuvar/sayim/history/[labId]/[sessionId]: `src/pages/laboratuvar/sayim/history/[labId]/[sessionId].tsx`
- /laboratuvar-yonetimi/[stockItemId]: `src/pages/laboratuvar-yonetimi/[stockItemId].tsx`
- /mal-kabul-gecmis: `src/pages/mal-kabul-gecmis/index.tsx` and `[transactionId].tsx`
- /cihaz-ariza-gecmis: `src/pages/cihaz-ariza-gecmis/index.tsx` and `[recordId].tsx`
- /raporlama/*: multiple analytics pages

API (Pages Router):
- None found under `src/pages/api`.

## Duplicates and conflicts
The following routes exist in both routers (App and Pages):
- /(root)
- /login
- /dashboard
- /cihaz-yonetimi-ana
- /depo-sayim
- /hastane-yonetimi
- /kullanim-dogrulama
- /kumulatif-gecmis
- /kumulatif-hesaplama
- /laboratuvar-yonetimi
- /mal-kabul
- /raporlama (plus nested variants)
- /stok-yonetimi
- /tuketim-istatistikleri
- /urun-kullanim
- /urun-kullanim-dogrulama
- /urun-kullanim-istatistik
- /verimlilik-hesaplama
- Dynamic laboratuvar routes overlap between routers

## Recommendation
- Standardize on the App Router (`src/app/`).
- Deprecate Pages Router: move `src/pages` to `src/pages_legacy` for temporary reference.
- Migrate providers from `src/pages/_app.tsx` and `src/pages/_document.tsx` into `src/app/layout.tsx` as needed.
- Remove duplicate Tailwind configs; keep `tailwind.config.ts`.
- Verify App Router routes cover required functionality, then delete `src/pages_legacy`.

## Next Steps (safe + reversible)
1. Rename `src/pages` -> `src/pages_legacy`
2. Remove `tailwind.config.js` (keep TS config)
3. Restart dev and validate key routes
4. Create a migration checklist for any remaining features only present in `src/pages`
