# @trysac/pg-job-queue

Postgres job queue core for TypeScript: exact `SKIP LOCKED` SQL behind an injected client, leases, attempt fencing, exponential backoff, and an in-memory twin.

## The Problem

Teams that already run Postgres add Redis only for background jobs, or write a jobs table whose claim query double-processes work under concurrency and never recovers jobs from crashed workers. The correct pattern (`FOR UPDATE SKIP LOCKED`, leases, attempt fencing) is well known but easy to get subtly wrong. This library ships the exact SQL behind an injected client plus an in-memory store with the same semantics for tests.

## Installation

```bash
npm install @trysac/pg-job-queue
```

## Usage Example

```typescript
import { createMemoryStore, processBatch } from "@trysac/pg-job-queue";

const store = createMemoryStore();
await store.enqueue({ queue: "emails", payload: { to: "ada@example.com" } });

await processBatch(
  store,
  "emails",
  async (job) => console.log("Processing", job.payload),
  { now: new Date(), leaseMs: 30_000, batchSize: 10 }
);
```

## Public API Summary

- `schemaSql(table?: string): string`: Returns the DDL SQL string to initialize the queue table and indexes.
- `createPgStore(db: Db, opts?: { table?: string }): QueueStore`: Creates a QueueStore backed by a PostgreSQL database connection.
- `createMemoryStore(): MemoryStore`: Creates an in-memory queue store with the exact semantics of the PostgreSQL implementation.
- `processBatch(store, queue, handler, opts)`: Claims a batch of jobs and processes them using the given handler.
- `backoffMs(attempt, opts?)`: Calculates exponential backoff in milliseconds: `Math.min(maxMs, baseMs * 2 ** (attempt - 1))`.
- `QueueError`: Typed error class for queue operations (codes: `invalid_identifier`, `invalid_job`, `payload_too_large`).

### Limits & Options

- **Payloads**: Maximum size of 65,536 bytes.
- **Identifiers**: Matches `^[a-z_][a-z0-9_]{0,62}$`.
- **Error messages**: Truncated to 1,000 UTF-16 code units.
- **Dependencies**: Zero runtime dependencies; expects a `Db` interface compatible with `node-postgres`.

## Why not <best-known alternative>

Existing solutions like `pg-boss` or `graphile-worker` are often heavy; this library provides a minimal, auditable core with exact SQL that is easier to inspect and maintain for specific needs.

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model and limits.
