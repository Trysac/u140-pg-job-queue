# Stack

## Used

| Tool | Purpose | Why |
|---|---|---|
| TypeScript (strict) | Language and type checking | Typed public API and declarations for consumers. |
| Node.js 20+ | Runtime | Maintained LTS lines with native ES modules. |
| Vitest + `@vitest/coverage-v8` | Tests and coverage | Fast, ESM-native, runs TypeScript without a build step. |
| Biome | Lint and format | One fast tool for both, single config file. |
| gitleaks | Secret scanning | Standard scanner; runs locally and in CI. |
| GitHub Actions + Dependabot | CI wrapper and updates | Runs the same local gates on Linux and Windows. |

## Discarded

| Tool | Why not |
|---|---|
| ESLint + Prettier | Two tools and several configs where Biome covers both. |
| Jest | Needs extra transforms for ESM and TypeScript; slower. |
| Shell scripts for gates | Not portable to Windows; the gate runner is a Node script. |
| Bundlers (tsup, Rollup) | Unneeded for a small ESM library; `tsc` emits what is published. |

Add a row whenever a dependency or tool is added or rejected.
