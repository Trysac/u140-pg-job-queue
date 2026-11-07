# Architecture

`@trysac/pg-job-queue` provides a minimal, dependable job queue engine over PostgreSQL with zero dependencies.

## Core Concepts

1. **`FOR UPDATE SKIP LOCKED` Claiming**:
   Multiple workers claim jobs simultaneously without blocking each other. The claim query selects candidate jobs (where state is `ready` or expired `running` with remaining attempts) and updates them to `running`, incrementing `attempts` and setting `locked_until` in a single atomic SQL statement.

2. **Attempt Fencing**:
   Completion (`complete`) and failure (`fail`) updates check `WHERE id = $1 AND state = 'running' AND attempts = $2`. If a worker took longer than `leaseMs` and another worker reclaimed the job (incrementing attempts), the slow worker's update cleanly affects 0 rows, preventing stale worker writes.

3. **Exponential Backoff**:
   Failed jobs remain in or transition back to `ready` with `run_at` rescheduled based on exponential backoff: `Math.min(maxMs, baseMs * 2 ** (attempt - 1))`. When `attempts >= max_attempts`, the state becomes `dead`.

4. **Memory Store Twin**:
   `createMemoryStore()` replicates table semantics, sorting orders, attempt fencing, and concurrency isolation so domain tests run fast and deterministically without a live PostgreSQL instance.
