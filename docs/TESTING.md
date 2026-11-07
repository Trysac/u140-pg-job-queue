# Testing Strategy

Tests cover the following areas:

- `schemaSql and identifier validation`: Verifies correct DDL generation and identifier validation/rejection.
- `createPgStore`: Tests claim SQL generation, parameter binding, row mapping, and handling of database interaction errors.
- `createMemoryStore`: Simulates concurrent claim behavior, priority sorting, delay handling, attempt fencing, and lease expiration.
- `Validation and Edge Cases`: Validates payload limits (65,536 bytes), queue name constraints, and data type validation (e.g., `maxAttempts` or `priority`).
- `processBatch`: Verifies batch claiming, handler execution, complete/fail lifecycle, and error truncation logic.
- `backoffMs`: Tests exponential backoff calculation, including `maxMs` and `baseMs` customization.
