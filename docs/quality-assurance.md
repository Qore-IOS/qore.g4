# Quality assurance hardening

This repository now includes a minimal but enforceable test harness built on Node 22's native test runner. The goal is to prevent regressions in the most business-critical parsing helpers while keeping the dependency surface unchanged.

## Commands
- **Unit tests**: `npm run test` / `pnpm test`
  - Compiles a trimmed test bundle to `.test-dist` with `tsc -p tsconfig.tests.json` and runs Node's built-in test runner.
- **Coverage artifact**: `npm run test:coverage` / `pnpm test:coverage`
  - Emits V8 coverage JSON into `.coverage` using the same compiled bundle. This is ready to be post-processed by tools like `c8` or `istanbul` in CI.
- **Type safety**: `npm run typecheck` / `pnpm typecheck`
  - Runs `tsc --noEmit` for the main app configuration. Use this alongside `npm run lint` or `pnpm lint` in CI to keep the Next.js build clean.

## Why this approach?
- **No new dependencies**: The environment blocks registry access, so the test harness relies solely on built-in Node and the existing TypeScript compiler.
- **Fast feedback**: Compilation is scoped to `tests/**/*.test.ts` and the imported modules, avoiding the full app bundle.
- **Production readiness**: Even a small suite around parsing utilities improves confidence for barcode-driven workflows that are critical in the supply chain domain.

## Suggested CI wiring
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test`
4. `npm run build`

> If your team standardizes on pnpm, swap each command with the `pnpm` equivalent.

These steps elevate the baseline quality gates without disrupting the current prototype deployments.
