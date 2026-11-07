# Contributing

Thanks for helping improve `@trysac/pg-job-queue`.

## Workflow

1. Branch from `main` (or fork); never push to `main` directly.
2. `npm install`.
3. Write a failing test, then the change.
4. Run `npm run check` until every gate passes.
5. Add an entry under `Unreleased` in `CHANGELOG.md` for user-visible changes.
6. Open a pull request describing the problem and the change.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<optional scope>): <description>
```

Types: `feat` (minor), `fix` (patch), `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`.
A breaking change adds `!` after the type or a `BREAKING CHANGE:` footer (major).

## Code style

Biome enforces formatting and lint rules; run `npm run format` to apply formatting. See
[AGENTS.md](AGENTS.md) for conventions and the files that must not be edited.
