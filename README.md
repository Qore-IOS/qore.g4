# Firebase Studio

This is a NextJS starter in Firebase Studio.

To get started, take a look at src/app/page.tsx.

## Quality assurance

Node 22's built-in test runner is wired to validate the barcode utilities that power supply-chain workflows. Run the following commands for local guardrails (with either `npm run` or `pnpm`):

- `npm run typecheck` / `pnpm typecheck` – TypeScript static analysis
- `npm run lint` / `pnpm lint` – Next.js ESLint
- `npm run test` / `pnpm test` – Compile a focused test bundle and execute Node's native test runner

For more detail, see [docs/quality-assurance.md](docs/quality-assurance.md).
