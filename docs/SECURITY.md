# Security practices

How this repository keeps the package and its users safe. The disclosure policy is in
[../SECURITY.md](../SECURITY.md).

## Secrets

- No secrets, tokens or credentials in the repository, commit history, logs or prompts.
- `gitleaks` runs as the last step of `npm run check` and as a dedicated CI job. Its configuration is
  `.gitleaks.toml`.
- Publishing credentials live only in the CI secret store or the maintainer's local npm configuration.

## Dependencies

- Runtime dependencies are avoided; development dependencies are limited to the toolchain listed in
  [STACK.md](STACK.md).
- Dependabot opens weekly updates for npm packages and GitHub Actions.
- Commit the generated `package-lock.json` so installs are reproducible.

## Code

- No `eval`, dynamic `Function` construction or shelling out from library code.
- Inputs from callers are validated and rejected with explicit errors.

## Publishing

- Packages are published from a clean checkout after `npm run check` passes.
- Only `dist/` is included in the published tarball.
