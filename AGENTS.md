# AGENTS.md

Operating guide for humans and coding agents working on `@trysac/pg-job-queue`.

## Commands

| Purpose | Command |
|---|---|
| Install dependencies | `npm install` |
| Every quality gate (run before each commit) | `npm run check` |
| Lint and format check | `npm run lint` |
| Apply formatting | `npm run format` |
| Type check | `npm run typecheck` |
| Tests with coverage | `npm test` |
| Build `dist/` | `npm run build` |

`npm run check` runs, in order and stopping at the first failure: Biome (lint + format), `tsc --noEmit`,
Vitest with coverage (80 % minimum for lines, branches, functions and statements), the documentation check
(`docs-manifest.json`) and gitleaks. Without gitleaks installed it fails unless
`FABRICA_ALLOW_MISSING_GITLEAKS=1` is set.

## Folder map

| Path | Contents |
|---|---|
| `src/` | Library source. `src/index.ts` is the only public entry point. |
| `test/` | Vitest suites, one `*.test.ts` per source module. |
| `scripts/` | Gate runner (`check.mjs`) and docs check (`check-docs.mjs`). Factory-owned. |
| `docs/` | Architecture, testing, security, project record, stack and decision records. |
| `.github/` | CI wrapper and Dependabot. Factory-owned. |
| `fabrica.json` | Install and check commands used by the factory. Factory-owned. |
| `docs-manifest.json` | Documentation files the docs check requires. Factory-owned. |

## Conventions

- TypeScript strict mode, ES modules, Node.js 20+. Relative imports use the `.js` extension.
- Every export is documented with TSDoc and covered by tests through the public entry point.
- Behavior changes start with a failing test.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`); see CONTRIBUTING.md.
- User-visible changes are added to `CHANGELOG.md` under `Unreleased`.
- A new architectural decision gets a record in `docs/decisions/NNNN-title.md`.
- Runtime dependencies need a reason recorded in `docs/STACK.md`; prefer none.

## Limits

- Do not edit `.github/`, `fabrica.json`, `docs-manifest.json` or `scripts/`. They belong to the factory;
  propose changes in an issue instead.
- Never push to `main`; work on a branch and open a pull request.
- Never commit secrets, tokens or `.env` files, and never paste them into logs or prompts.
- Do not lower coverage thresholds or disable lint rules to make a gate pass.
- Do not commit `node_modules/`, `dist/` or `coverage/`.
