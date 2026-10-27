> Güncel altyapı: Vercel / Neon PostgreSQL. Bu belgedeki eski Firebase,
> servis hesabı, kural yayımlama ve oturum adımları artık geçersizdir.
> Güncel kurulum için depodaki `docs/vercel-postgresql.md` belgesini kullanın.
> Terminal paketi `NEXT_PUBLIC_API_BASE_URL`, ERP işçileri `APP_BASE_URL` kullanır.

# android-app/

Bu klasörün tek işi Capacitor'ın `webDir`ini barındırmak.

`www/` derleme çıktısıdır (`npm run build:terminal:android` üretir) ve depoda
tutulmaz. Buraya elle dosya eklemeyin — bir sonraki derlemede silinir.

Arayüzün kaynağı `src/app/terminal/**` ve `terminal-app/`; ayrıntılar için
bkz. [`docs/android-terminal.md`](../docs/android-terminal.md).
