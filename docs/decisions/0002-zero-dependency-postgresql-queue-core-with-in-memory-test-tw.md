# Zero-dependency PostgreSQL Queue Core with In-Memory Test Twin

Status: accepted (generated, pending human review)

## Context

Applications requiring background job execution in PostgreSQL environments often take heavy dependencies like pg-boss or graphile-worker, or invent brittle ad-hoc polling tables lacking SKIP LOCKED, lease recovery, and attempt fencing.

## Decision

Implement the core job queue protocol using raw SQL queries with FOR UPDATE SKIP LOCKED behind an injected minimal Db interface, alongside an identical in-memory store for isolated, deterministic unit and integration tests.

## Consequences

Users have full control over connection pooling and transaction lifecycle while maintaining exact PostgreSQL job semantics. Testing requires no Docker or local database instances.
