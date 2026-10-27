# Qore

Next.js 14 ve PostgreSQL tabanlı stok yönetimi uygulaması. Üretim hedefi Vercel,
veritabanı Neon PostgreSQL, dosya deposu private Vercel Blob'dur. Uygulama ortak
çalışma alanı olarak girişsiz çalışır.

Kurulum, dağıtım değişkenleri, erişim koruması ve kontroller:
[docs/vercel-postgresql.md](docs/vercel-postgresql.md).

```sh
pnpm install --frozen-lockfile
export QORE_LOCAL_DATABASE=/tmp/qore-local-db
pnpm db:local
pnpm dev
```

Kontroller: `pnpm test`, `pnpm test:db`, `pnpm test:e2e`, `pnpm build`.
