# Current runtime — Vercel / PostgreSQL

The application uses Neon PostgreSQL (`DATABASE_URL`) and private Vercel Blob
(`BLOB_READ_WRITE_TOKEN`). Firebase SDKs, configuration, emulators, rules, auth,
and FCM have been removed. Do not reintroduce them. Earlier historical Firebase
sections below describe the pre-migration architecture only. The authoritative
setup and operational contract is `docs/vercel-postgresql.md`.

There is no application login. `src/lib/workspace.ts` is a shared operator
identity, not a session or credential. Everyone can access the entire workspace;
company tags are not user access boundaries. Use deployment-level access control.
Retain personnel records as operational data, without passwords or auth accounts.

Client data access: `src/lib/data/client.ts` -> `/api/data` -> PostgreSQL.
Server data access: `src/lib/data/admin.ts` or `server-client.ts`.
Shared query/value semantics: `model.ts` and `factory.ts`. Never import a
server-only module into client components. SQL transactions and the durable
outbox must remain atomic. Background jobs live in `src/lib/jobs`; Vercel Cron
calls `/api/jobs` with `CRON_SECRET`. External mail/WhatsApp settings are optional.

Use Node 22 and pinned pnpm. Run `pnpm test`, `pnpm test:db`, `pnpm test:e2e`, and
`pnpm build`. Keep existing failing/skipped checks visible; do not update the type
baseline to hide errors. Local database: `QORE_LOCAL_DATABASE=/tmp/qore-local-db`,
`pnpm db:local`, `pnpm dev`; production requires Neon and never uses this fallback.

The design requirements and business/domain conventions below still apply.


## Product and domain conventions

Qore is a Turkish medical-supply inventory application built with Next.js 14.2,
React 18, TypeScript, Tailwind/ShadCN, TanStack Query, Zustand and Framer Motion.
Preserve shared warehouse/hospital workflows, barcode parsing, serial ledgers,
lot/quantity stock tracking, expiry (`miad`) dates, FIFO/FEFO and reconciliation.
Keep Turkish field names and existing document payloads compatible. Format dates
as `dd.MM.yyyy` with the appropriate timezone; never compare formatted strings
instead of parsed dates. Every destructive stock action needs a preview and
explicit user confirmation. Preserve the existing business tests and limits.

Use existing hooks in `src/hooks/useDatabaseQueries.ts` and shared document
helpers. Background job declarations and SQL outbox execution are separate from
request handling. Do not send messages to external recipients as part of tests;
use isolated fixtures. The old source type baseline contains known defects;
report them separately from environment and migration regressions.

## Design Reference (MANDATORY)

**`.claude/skills/apple-design/` is the single design standard for this project** (mirrored at `.agents/skills/apple-design/` for other agents). It covers **both desktop and mobile** and applies to *every* piece of work that produces an interface:

- product UI — web app, Capacitor/Android build, Electron desktop app, terminal app
- prototypes and demos
- presentations, decks, screenshots, screen recordings, landing/marketing pages

Read it **before** writing or reviewing UI code — not after. Any deviation must be stated explicitly in the PR description with a reason.

| File | Read it when |
| --- | --- |
| `SKILL.md` | Always — core principles: response, direct manipulation, interruptibility, springs, velocity handoff, momentum projection, materials, typography, the eight design foundations |
| `references/desktop.md` | Pointer + keyboard surfaces: hover, focus, shortcuts, windows, dense tables, Electron |
| `references/mobile.md` | Touch surfaces: targets, safe areas, sheets, gestures, haptics, WebView performance |
| `references/adaptive.md` | One component serving both idioms: capability queries, shared APIs, what may differ |
| `references/implementation.md` | This stack: Framer Motion spring presets, tokens, shadcn/Radix, `src/lib/haptics.ts`, performance |
| `references/presentation.md` | Decks, demos, screenshots, marketing pages |
| `references/checklist.md` | Reviewing a PR or self-checking before shipping |

Non-negotiables pulled forward:

1. **Feedback on pointer-down**, continuous through the gesture — never only at the end.
2. **Every animation is interruptible** and animates from the current on-screen value.
3. **Springs from the shared preset table** (`implementation.md` §1) — no ad-hoc `stiffness` values; bounce only after real momentum.
4. **Animate `transform`/`opacity` only** — never layout or `box-shadow`.
5. **Tokens only** (`src/app/globals.css`), verified in light *and* dark.
6. **Touch ≥44pt targets, safe-area insets, dock clearance** on mobile; **hover + `:focus-visible` + full keyboard path** on desktop.
7. **Branch on input capability** (`(hover: hover)` / `(pointer: coarse)`), not user-agent; layout branches on width.
8. **`prefers-reduced-motion` / `-transparency` / `-contrast` paths** are part of "done".
9. **Destructive medical-supply operations** (miad, quantity, kurum assignment) get a preview and explicit confirmation.


## Verification

Run the existing source guards as part of `pnpm build`. Do not raise audit limits
or disable assertions to obtain a passing check. Use Node's existing test runner
for business tests, `pnpm test:db` for the PostgreSQL adapter and `pnpm test:e2e`
for the browser/API workflow. Browser fixtures must use a loopback API and an
isolated local SQL directory, never a live database. Keep external integration
and live Neon/Blob validation distinct from local test evidence.
