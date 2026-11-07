# Project Record

## Objective

Provide a lightweight, auditable PostgreSQL job queue core for TypeScript without heavy external dependencies or runtime bloat.

## Scope

- Zero runtime dependencies (injected client).
- Exact SQL statements implementing `FOR UPDATE SKIP LOCKED`, attempt fencing, and lease recovery.
- In-memory simulation (`createMemoryStore`) identical to PostgreSQL claim mechanics for tests.
- A clean `processBatch` processor helper with automatic error handling.

## Out-of-Scope

- LISTEN/NOTIFY functionality.
- Cron schedules.
- Built-in worker loop timers.
- Database migration tooling.
- Execution environment beyond Node.js 20+.

## Factory run u140 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | gemini-3.8-flash | yes | 4818 | 12135 | 0 | 0 | 0.0246 |
| fix-1 | gemini-3.8-flash | no | 93411 | 980 | 0 | 812570 | 0.1347 |
| fix-2 | gemini-3.8-flash | no | 138269 | 1150 | 0 | 1774299 | 0.2411 |
| fix-3 | gemini-3.8-flash | no | 116426 | 2817 | 0 | 1054648 | 0.1770 |
| fix-4 | gemini-3.8-flash | no | 97028 | 900 | 0 | 953731 | 0.1477 |
| audit | gemini-3.1-flash-lite | no | 27416 | 347 | 0 | 18307 | 0.0078 |
| docs | gemini-3.1-flash-lite | no | 14363 | 1340 | 0 | 0 | 0.0056 |

Total: $0.7384. Prices: Anthropic list prices.
