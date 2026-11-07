# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suites in `test/`.
- Coverage is collected with V8 (`@vitest/coverage-v8`) over `src/`.

## Commands

```sh
npm test            # vitest run --coverage
npx vitest          # watch mode while developing
npm run check       # every gate, including tests
```

## Rules

- Coverage must stay at or above 80 % for lines, branches, functions and statements (`vitest.config.ts`).
  Lowering the thresholds is not allowed.
- Test through the public entry point (`src/index.ts`) and assert observable behavior: return values,
  thrown errors and their messages.
- Each bug fix adds a test that fails without the fix.
- Tests are deterministic: no network, no real clock or randomness without injection, no shared state between
  tests. Temporary files go to the OS temp directory and are removed by the test.

## Reports

Coverage reports are written to `coverage/` (text summary and `lcov`). The folder is ignored by git.
