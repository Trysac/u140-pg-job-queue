/**
 * @trysac/pg-job-queue
 * Core PostgreSQL job queue with SKIP LOCKED, attempt fencing, leases, and an in-memory twin.
 */

/**
 * Maximum size in bytes of a serialized JSON payload.
 */
export const MAX_PAYLOAD_BYTES = 65_536;

/**
 * Maximum length in UTF-16 code units for stored error messages.
 */
export const MAX_ERROR_LENGTH = 1_000;

/**
 * Regex for allowed Postgres table identifiers: lowercase letters/numbers/underscores, starting with a letter or underscore.
 */
const IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Error codes emitted by QueueError.
 */
export type QueueErrorCode = "invalid_identifier" | "invalid_job" | "payload_too_large";

/**
 * Typed error for queue operations.
 */
export class QueueError extends Error {
  readonly code: QueueErrorCode;

  constructor(message: string, code: QueueErrorCode) {
    super(message);
    this.name = "QueueError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Minimal database interface matching node-postgres / pg Pool/Client.
 */
export interface Db {
  query(
    sql: string,
    params: unknown[],
  ): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number | null;
  }>;
}

/**
 * Status of a job.
 */
export type JobState = "ready" | "running" | "done" | "dead";

/**
 * A job returned to workers upon claiming.
 */
export interface Job {
  id: string;
  queue: string;
  payload: unknown;
  attempt: number;
  maxAttempts: number;
}

/**
 * Options for enqueuing a job.
 */
export interface EnqueueOptions {
  queue: string;
  payload: unknown;
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
}

/**
 * Representation of a stored job row (in-memory or DB row shape).
 */
export interface JobRow {
  id: string;
  queue: string;
  payload: unknown;
  priority: number;
  state: JobState;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  locked_until: Date | null;
  last_error: string | null;
}

/**
 * Common queue store interface implemented by Postgres and in-memory stores.
 */
export interface QueueStore {
  enqueue(job: EnqueueOptions): Promise<string>;
  claim(queue: string, limit: number, now: Date, leaseMs: number): Promise<Job[]>;
  complete(id: string, attempt: number): Promise<boolean>;
  fail(id: string, attempt: number, error: string, now: Date): Promise<boolean>;
  reap(now: Date): Promise<number>;
}

/**
 * Options for createPgStore.
 */
export interface PgStoreOptions {
  table?: string;
}

/**
 * Options for processBatch.
 */
export interface ProcessBatchOptions {
  now: Date;
  leaseMs: number;
  batchSize: number;
}

/**
 * Result of processBatch.
 */
export interface ProcessBatchResult {
  completed: number;
  failed: number;
}

/**
 * Options for backoff calculation.
 */
export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
}

/**
 * Validate table identifier against safe SQL pattern.
 */
export function validateIdentifier(name: string): string {
  if (!IDENTIFIER_REGEX.test(name)) {
    throw new QueueError(`Invalid table identifier: "${name.slice(0, 200)}"`, "invalid_identifier");
  }
  return name;
}

/**
 * Returns the DDL SQL string to initialize the queue table and indexes.
 *
 * @param table - Name of the jobs table (defaults to 'jobs').
 */
export function schemaSql(table = "jobs"): string {
  const safeTable = validateIdentifier(table);
  return `CREATE TABLE IF NOT EXISTS "${safeTable}" (id bigserial PRIMARY KEY, queue text NOT NULL, payload jsonb NOT NULL, priority integer NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'running', 'done', 'dead')), attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5, run_at timestamptz NOT NULL DEFAULT now(), locked_until timestamptz, last_error text); CREATE INDEX IF NOT EXISTS "${safeTable}_claim_idx" ON "${safeTable}" (queue, state, priority DESC, run_at, id);`;
}

/**
 * Calculates exponential backoff in milliseconds: Math.min(maxMs, baseMs * 2 ** (attempt - 1)).
 */
export function backoffMs(attempt: number, opts?: BackoffOptions): number {
  const baseMs = opts?.baseMs ?? 1000;
  const maxMs = opts?.maxMs ?? 3_600_000;
  const exp = Math.max(0, attempt - 1);
  const calculated = baseMs * 2 ** exp;
  return Math.min(maxMs, calculated);
}

function validateEnqueue(job: EnqueueOptions): {
  queue: string;
  payloadStr: string;
  priority: number;
  runAt: Date;
  maxAttempts: number;
} {
  if (typeof job.queue !== "string" || job.queue.trim() === "") {
    throw new QueueError("Queue name must not be empty", "invalid_job");
  }

  if (job.maxAttempts !== undefined) {
    if (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1) {
      throw new QueueError("maxAttempts must be a positive integer", "invalid_job");
    }
  }
  const maxAttempts = job.maxAttempts ?? 5;

  if (job.priority !== undefined) {
    if (!Number.isInteger(job.priority)) {
      throw new QueueError("priority must be an integer", "invalid_job");
    }
  }
  const priority = job.priority ?? 0;

  if (job.runAt !== undefined) {
    if (!(job.runAt instanceof Date) || Number.isNaN(job.runAt.getTime())) {
      throw new QueueError("runAt must be a valid Date", "invalid_job");
    }
  }
  const runAt = job.runAt ?? new Date();

  let payloadStr: string;
  try {
    payloadStr = JSON.stringify(job.payload ?? null);
  } catch (_e) {
    throw new QueueError("Payload could not be serialized to JSON", "invalid_job");
  }

  if (Buffer.byteLength(payloadStr, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new QueueError(
      `Payload exceeds maximum size of ${MAX_PAYLOAD_BYTES} bytes`,
      "payload_too_large",
    );
  }

  return {
    queue: job.queue,
    payloadStr,
    priority,
    runAt,
    maxAttempts,
  };
}

/**
 * Creates a QueueStore backed by a PostgreSQL database connection.
 */
export function createPgStore(db: Db, opts?: PgStoreOptions): QueueStore {
  const table = validateIdentifier(opts?.table ?? "jobs");

  const ENQUEUE_SQL = `INSERT INTO "${table}" (queue, payload, priority, run_at, max_attempts) VALUES ($1, $2::jsonb, $3, $4, $5) RETURNING id`;
  const CLAIM_SQL = `WITH next AS (SELECT id FROM "${table}" WHERE queue = $1 AND attempts < max_attempts AND ((state = 'ready' AND run_at <= $2) OR (state = 'running' AND locked_until <= $2)) ORDER BY priority DESC, run_at, id LIMIT $3 FOR UPDATE SKIP LOCKED) UPDATE "${table}" AS j SET state = 'running', attempts = j.attempts + 1, locked_until = $4 FROM next WHERE j.id = next.id RETURNING j.id, j.queue, j.payload, j.attempts, j.max_attempts`;
  const COMPLETE_SQL = `UPDATE "${table}" SET state = 'done', locked_until = NULL WHERE id = $1 AND state = 'running' AND attempts = $2`;
  const FAIL_SQL = `UPDATE "${table}" SET state = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'ready' END, run_at = $3, last_error = $4, locked_until = NULL WHERE id = $1 AND state = 'running' AND attempts = $2`;
  const REAP_SQL = `UPDATE "${table}" SET state = 'dead', last_error = 'lease expired', locked_until = NULL WHERE state = 'running' AND locked_until <= $1 AND attempts >= max_attempts`;

  return {
    async enqueue(job: EnqueueOptions): Promise<string> {
      const validated = validateEnqueue(job);
      const res = await db.query(ENQUEUE_SQL, [
        validated.queue,
        validated.payloadStr,
        validated.priority,
        validated.runAt,
        validated.maxAttempts,
      ]);
      const row = res.rows[0];
      if (!row || row["id"] === undefined || row["id"] === null) {
        throw new QueueError("Enqueue failed to return job id", "invalid_job");
      }
      return String(row["id"]);
    },

    async claim(queue: string, limit: number, now: Date, leaseMs: number): Promise<Job[]> {
      if (typeof queue !== "string" || queue.trim() === "") {
        throw new QueueError("Queue name must not be empty", "invalid_job");
      }
      if (limit <= 0) {
        return [];
      }
      const lockedUntil = new Date(now.getTime() + leaseMs);
      const res = await db.query(CLAIM_SQL, [queue, now, limit, lockedUntil]);

      const jobs: Job[] = res.rows.map((r) => ({
        id: String(r["id"]),
        queue: String(r["queue"]),
        payload: typeof r["payload"] === "string" ? JSON.parse(r["payload"]) : r["payload"],
        attempt: Number(r["attempts"]),
        maxAttempts: Number(r["max_attempts"]),
      }));

      // Sort by id for deterministic consumer ordering
      jobs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
      return jobs;
    },

    async complete(id: string, attempt: number): Promise<boolean> {
      const res = await db.query(COMPLETE_SQL, [id, attempt]);
      return res.rowCount === 1;
    },

    async fail(id: string, attempt: number, error: string, now: Date): Promise<boolean> {
      const truncatedError = error.slice(0, MAX_ERROR_LENGTH);
      const nextRunAt = new Date(now.getTime() + backoffMs(attempt));
      const res = await db.query(FAIL_SQL, [id, attempt, nextRunAt, truncatedError]);
      return res.rowCount === 1;
    },

    async reap(now: Date): Promise<number> {
      const res = await db.query(REAP_SQL, [now]);
      return res.rowCount ?? 0;
    },
  };
}

/**
 * In-memory test store type with synchronous access to raw job records.
 */
export interface MemoryStore extends QueueStore {
  get(id: string): JobRow | undefined;
}

/**
 * Creates an in-memory queue store with the exact semantics of the PostgreSQL implementation.
 */
export function createMemoryStore(): MemoryStore {
  const jobs = new Map<string, JobRow>();
  let sequence = 0;

  let claimMutex: Promise<void> = Promise.resolve();

  return {
    get(id: string): JobRow | undefined {
      const item = jobs.get(id);
      if (!item) return undefined;
      return {
        ...item,
        run_at: new Date(item.run_at.getTime()),
        locked_until: item.locked_until ? new Date(item.locked_until.getTime()) : null,
        payload: structuredClone(item.payload),
      };
    },

    async enqueue(job: EnqueueOptions): Promise<string> {
      const validated = validateEnqueue(job);
      sequence += 1;
      const id = String(sequence);
      jobs.set(id, {
        id,
        queue: validated.queue,
        payload: JSON.parse(validated.payloadStr),
        priority: validated.priority,
        state: "ready",
        attempts: 0,
        max_attempts: validated.maxAttempts,
        run_at: new Date(validated.runAt.getTime()),
        locked_until: null,
        last_error: null,
      });
      return id;
    },

    async claim(queue: string, limit: number, now: Date, leaseMs: number): Promise<Job[]> {
      if (typeof queue !== "string" || queue.trim() === "") {
        throw new QueueError("Queue name must not be empty", "invalid_job");
      }
      if (limit <= 0) {
        return [];
      }

      let release: () => void = () => {};
      const nextMutex = new Promise<void>((resolve) => {
        release = resolve;
      });
      const currentMutex = claimMutex;
      claimMutex = claimMutex.then(() => nextMutex);

      await currentMutex;
      try {
        const nowTime = now.getTime();
        const eligible: JobRow[] = [];

        for (const job of jobs.values()) {
          if (job.queue !== queue) continue;
          if (job.attempts >= job.max_attempts) continue;

          const isReady = job.state === "ready" && job.run_at.getTime() <= nowTime;
          const isExpiredRunning =
            job.state === "running" &&
            job.locked_until !== null &&
            job.locked_until.getTime() <= nowTime;

          if (isReady || isExpiredRunning) {
            eligible.push(job);
          }
        }

        // Sort order matches SQL: priority DESC, run_at ASC, id ASC
        eligible.sort((a, b) => {
          if (b.priority !== a.priority) {
            return b.priority - a.priority;
          }
          const diffTime = a.run_at.getTime() - b.run_at.getTime();
          if (diffTime !== 0) {
            return diffTime;
          }
          return BigInt(a.id) < BigInt(b.id) ? -1 : 1;
        });

        const picked = eligible.slice(0, limit);
        const lockedUntil = new Date(nowTime + leaseMs);
        const claimedJobs: Job[] = [];

        for (const job of picked) {
          job.state = "running";
          job.attempts += 1;
          job.locked_until = new Date(lockedUntil.getTime());
          claimedJobs.push({
            id: job.id,
            queue: job.queue,
            payload: structuredClone(job.payload),
            attempt: job.attempts,
            maxAttempts: job.max_attempts,
          });
        }

        claimedJobs.sort((a, b) =>
          BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0,
        );
        return claimedJobs;
      } finally {
        release();
      }
    },

    async complete(id: string, attempt: number): Promise<boolean> {
      const job = jobs.get(id);
      if (!job) return false;
      if (job.state !== "running" || job.attempts !== attempt) {
        return false;
      }
      job.state = "done";
      job.locked_until = null;
      return true;
    },

    async fail(id: string, attempt: number, error: string, now: Date): Promise<boolean> {
      const job = jobs.get(id);
      if (!job) return false;
      if (job.state !== "running" || job.attempts !== attempt) {
        return false;
      }
      job.last_error = error.slice(0, MAX_ERROR_LENGTH);
      job.locked_until = null;
      if (job.attempts >= job.max_attempts) {
        job.state = "dead";
      } else {
        job.state = "ready";
        job.run_at = new Date(now.getTime() + backoffMs(attempt));
      }
      return true;
    },

    async reap(now: Date): Promise<number> {
      let count = 0;
      const nowTime = now.getTime();
      for (const job of jobs.values()) {
        if (
          job.state === "running" &&
          job.locked_until !== null &&
          job.locked_until.getTime() <= nowTime &&
          job.attempts >= job.max_attempts
        ) {
          job.state = "dead";
          job.last_error = "lease expired";
          job.locked_until = null;
          count += 1;
        }
      }
      return count;
    },
  };
}

/**
 * Claims a batch of jobs and processes them using the given handler.
 * Handles complete/fail calls and error string truncation.
 */
export async function processBatch(
  store: QueueStore,
  queue: string,
  handler: (job: Job) => Promise<void>,
  opts: ProcessBatchOptions,
): Promise<ProcessBatchResult> {
  const jobs = await store.claim(queue, opts.batchSize, opts.now, opts.leaseMs);
  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await handler(job);
      const ok = await store.complete(job.id, job.attempt);
      if (ok) {
        completed += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await store.fail(job.id, job.attempt, msg, opts.now);
      failed += 1;
    }
  }

  return { completed, failed };
}
