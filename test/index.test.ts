import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backoffMs,
  createMemoryStore,
  createPgStore,
  type Db,
  processBatch,
  QueueError,
  schemaSql,
  validateIdentifier,
} from "../src/index.js";

const EXPECTED_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS \"jobs\" (id bigserial PRIMARY KEY, queue text NOT NULL, payload jsonb NOT NULL, priority integer NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'running', 'done', 'dead')), attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5, run_at timestamptz NOT NULL DEFAULT now(), locked_until timestamptz, last_error text); CREATE INDEX IF NOT EXISTS \"jobs_claim_idx\" ON \"jobs\" (queue, state, priority DESC, run_at, id);";

const EXPECTED_CLAIM_SQL =
  "WITH next AS (SELECT id FROM \"jobs\" WHERE queue = $1 AND attempts < max_attempts AND ((state = 'ready' AND run_at <= $2) OR (state = 'running' AND locked_until <= $2)) ORDER BY priority DESC, run_at, id LIMIT $3 FOR UPDATE SKIP LOCKED) UPDATE \"jobs\" AS j SET state = 'running', attempts = j.attempts + 1, locked_until = $4 FROM next WHERE j.id = next.id RETURNING j.id, j.queue, j.payload, j.attempts, j.max_attempts";

// Jobs enqueued without runAt default to the real clock; pin it to the fixed `now` the tests claim at.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("schemaSql and identifier validation", () => {
  it("schemaSql('jobs') returns exactly SCHEMA_SQL from the notes with \"jobs\", and schemaSql('Jobs; drop') throws QueueError with code 'invalid_identifier'", () => {
    expect(schemaSql("jobs")).toBe(EXPECTED_SCHEMA_SQL);

    try {
      schemaSql("Jobs; drop");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QueueError);
      expect((err as QueueError).code).toBe("invalid_identifier");
    }
  });

  it("schemaSql default returns default jobs schema", () => {
    expect(schemaSql()).toBe(EXPECTED_SCHEMA_SQL);
  });

  it("validates valid identifiers and rejects invalid ones", () => {
    expect(validateIdentifier("my_jobs_2")).toBe("my_jobs_2");
    expect(() => validateIdentifier("")).toThrowError(QueueError);
    expect(() => validateIdentifier("1start_with_number")).toThrowError(QueueError);
    expect(() => validateIdentifier("a".repeat(64))).toThrowError(QueueError);
  });
});

describe("createPgStore", () => {
  it("claim calls db.query once with exactly CLAIM_SQL and maps rows properly", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const fakeDb: Db = {
      async query(sql: string, params: unknown[]) {
        queries.push({ sql, params });
        return {
          rowCount: 1,
          rows: [
            {
              id: "7",
              queue: "emails",
              payload: { a: 1 },
              attempts: 1,
              max_attempts: 5,
            },
          ],
        };
      },
    };

    const store = createPgStore(fakeDb);
    const now = new Date("2026-01-01T00:00:00.000Z");
    const jobs = await store.claim("emails", 10, now, 30_000);

    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toBe(EXPECTED_CLAIM_SQL);
    expect(queries[0]?.params).toEqual(["emails", now, 10, new Date(now.getTime() + 30_000)]);
    expect(jobs).toEqual([
      {
        id: "7",
        queue: "emails",
        payload: { a: 1 },
        attempt: 1,
        maxAttempts: 5,
      },
    ]);
  });

  it("claim with limit 0 returns [] without query", async () => {
    let called = false;
    const fakeDb: Db = {
      async query() {
        called = true;
        return { rows: [], rowCount: 0 };
      },
    };
    const store = createPgStore(fakeDb);
    const res = await store.claim("q", 0, new Date(), 1000);
    expect(res).toEqual([]);
    expect(called).toBe(false);
  });

  it("enqueue, complete, fail and reap issue expected SQL and handle responses", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    let nextRowCount: number | null = 1;
    const nextRows: Record<string, unknown>[] = [{ id: "42" }];

    const fakeDb: Db = {
      async query(sql: string, params: unknown[]) {
        queries.push({ sql, params });
        return { rows: nextRows, rowCount: nextRowCount };
      },
    };

    const store = createPgStore(fakeDb);
    const now = new Date("2026-01-01T00:00:00.000Z");

    const id = await store.enqueue({
      queue: "test_q",
      payload: { foo: "bar" },
      priority: 2,
      runAt: now,
      maxAttempts: 3,
    });
    expect(id).toBe("42");
    expect(queries[0]?.params).toEqual(["test_q", '{"foo":"bar"}', 2, now, 3]);

    const completed = await store.complete("42", 1);
    expect(completed).toBe(true);

    const failed = await store.fail("42", 1, "something broke", now);
    expect(failed).toBe(true);
    expect(queries[2]?.params[3]).toBe("something broke");

    nextRowCount = 3;
    const reaped = await store.reap(now);
    expect(reaped).toBe(3);
  });

  it("throws QueueError on missing returned row in enqueue", async () => {
    const fakeDb: Db = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
    };
    const store = createPgStore(fakeDb);
    await expect(store.enqueue({ queue: "q", payload: {} })).rejects.toThrowError(QueueError);
  });

  it("handles payload as JSON string from postgres client", async () => {
    const fakeDb: Db = {
      async query() {
        return {
          rows: [
            {
              id: "10",
              queue: "q",
              payload: '{"hello":"world"}',
              attempts: 1,
              max_attempts: 3,
            },
          ],
          rowCount: 1,
        };
      },
    };
    const store = createPgStore(fakeDb);
    const jobs = await store.claim("q", 1, new Date(), 1000);
    expect(jobs[0]?.payload).toEqual({ hello: "world" });
  });
});

describe("createMemoryStore", () => {
  it("In createMemoryStore(), jobs enqueued with priority 0 ('a') and 5 ('b') make claim(q, 1, now, 30_000) return 'b' first; a job with runAt one second after now is not claimed until now advances by 1000 ms", async () => {
    const store = createMemoryStore();
    const now = new Date("2026-01-01T00:00:00.000Z");

    await store.enqueue({ queue: "my_q", payload: "a", priority: 0, runAt: now });
    await store.enqueue({ queue: "my_q", payload: "b", priority: 5, runAt: now });

    const firstClaim = await store.claim("my_q", 1, now, 30_000);
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]?.payload).toBe("b");

    // Test delayed job
    const delayedRunAt = new Date(now.getTime() + 1000);
    await store.enqueue({ queue: "delayed_q", payload: "delayed", runAt: delayedRunAt });

    const claimBefore = await store.claim("delayed_q", 1, now, 30_000);
    expect(claimBefore).toHaveLength(0);

    const advancedNow = new Date(now.getTime() + 1000);
    const claimAfter = await store.claim("delayed_q", 1, advancedNow, 30_000);
    expect(claimAfter).toHaveLength(1);
    expect(claimAfter[0]?.payload).toBe("delayed");
  });

  it("A claimed job that is not completed is claimed again at now + 30_001 ms with attempt 2; then complete(id, 1) from the stale worker returns false and complete(id, 2) returns true with state 'done'", async () => {
    const store = createMemoryStore();
    const t0 = new Date("2026-01-01T12:00:00.000Z");
    const id = await store.enqueue({ queue: "worker_q", payload: "data", maxAttempts: 5 });

    const [claimed1] = await store.claim("worker_q", 1, t0, 30_000);
    expect(claimed1?.attempt).toBe(1);
    expect(claimed1?.id).toBe(id);

    const tExpired = new Date(t0.getTime() + 30_001);
    const [claimed2] = await store.claim("worker_q", 1, tExpired, 30_000);
    expect(claimed2?.attempt).toBe(2);
    expect(claimed2?.id).toBe(id);

    const staleComplete = await store.complete(id, 1);
    expect(staleComplete).toBe(false);
    expect(store.get(id)?.state).toBe("running");

    const validComplete = await store.complete(id, 2);
    expect(validComplete).toBe(true);
    expect(store.get(id)?.state).toBe("done");
  });

  it("With maxAttempts 3, the first fail at now sets state 'ready' and runAt now + 1000 ms, the second runAt now + 2000 ms and the third state 'dead'; complete or fail on a 'dead' or 'done' job returns false and leaves its state unchanged", async () => {
    const store = createMemoryStore();
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const id = await store.enqueue({ queue: "retries", payload: 123, maxAttempts: 3 });

    // Attempt 1
    await store.claim("retries", 1, t0, 30_000);
    const fail1 = await store.fail(id, 1, "err 1", t0);
    expect(fail1).toBe(true);
    const afterFail1 = store.get(id);
    expect(afterFail1?.state).toBe("ready");
    expect(afterFail1?.run_at.getTime()).toBe(t0.getTime() + 1000);

    // Attempt 2
    const t1 = new Date(t0.getTime() + 1000);
    await store.claim("retries", 1, t1, 30_000);
    const fail2 = await store.fail(id, 2, "err 2", t1);
    expect(fail2).toBe(true);
    const afterFail2 = store.get(id);
    expect(afterFail2?.state).toBe("ready");
    expect(afterFail2?.run_at.getTime()).toBe(t1.getTime() + 2000);

    // Attempt 3
    const t2 = new Date(t1.getTime() + 2000);
    await store.claim("retries", 1, t2, 30_000);
    const fail3 = await store.fail(id, 3, "err 3", t2);
    expect(fail3).toBe(true);
    const afterFail3 = store.get(id);
    expect(afterFail3?.state).toBe("dead");

    // Complete or fail on dead job
    expect(await store.complete(id, 3)).toBe(false);
    expect(await store.fail(id, 3, "err again", t2)).toBe(false);
    expect(store.get(id)?.state).toBe("dead");
  });

  it("Two concurrent memory-store claim('emails', 1, now, 30_000) calls via Promise.all over 1 job return 1 job in total and the other call returns []", async () => {
    const store = createMemoryStore();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await store.enqueue({ queue: "emails", payload: { single: true } });

    const [resultA, resultB] = await Promise.all([
      store.claim("emails", 1, now, 30_000),
      store.claim("emails", 1, now, 30_000),
    ]);

    const totalClaimed = (resultA?.length ?? 0) + (resultB?.length ?? 0);
    expect(totalClaimed).toBe(1);
    if (resultA?.length === 1) {
      expect(resultB).toEqual([]);
    } else {
      expect(resultA).toEqual([]);
    }
  });

  it("reap marks expired running jobs with attempts >= max_attempts as dead", async () => {
    const store = createMemoryStore();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const id = await store.enqueue({ queue: "reap_q", payload: {}, maxAttempts: 1 });
    await store.claim("reap_q", 1, now, 10_000);

    expect(store.get(id)?.state).toBe("running");
    const reapedEarly = await store.reap(new Date(now.getTime() + 5_000));
    expect(reapedEarly).toBe(0);
    expect(store.get(id)?.state).toBe("running");

    const reapedLate = await store.reap(new Date(now.getTime() + 10_001));
    expect(reapedLate).toBe(1);
    const deadJob = store.get(id);
    expect(deadJob?.state).toBe("dead");
    expect(deadJob?.last_error).toBe("lease expired");
  });
});

describe("Validation and Edge Cases", () => {
  it("enqueue with a payload whose JSON exceeds 65_536 bytes throws QueueError with code 'payload_too_large'; maxAttempts 0 or priority 1.5 throws code 'invalid_job'", async () => {
    const store = createMemoryStore();

    const hugePayload = { data: "a".repeat(65_536) };
    try {
      await store.enqueue({ queue: "emails", payload: hugePayload });
      expect.unreachable("expected payload_too_large");
    } catch (err) {
      expect(err).toBeInstanceOf(QueueError);
      expect((err as QueueError).code).toBe("payload_too_large");
    }

    try {
      await store.enqueue({ queue: "emails", payload: {}, maxAttempts: 0 });
      expect.unreachable("expected invalid_job");
    } catch (err) {
      expect(err).toBeInstanceOf(QueueError);
      expect((err as QueueError).code).toBe("invalid_job");
    }

    try {
      await store.enqueue({ queue: "emails", payload: {}, priority: 1.5 });
      expect.unreachable("expected invalid_job");
    } catch (err) {
      expect(err).toBeInstanceOf(QueueError);
      expect((err as QueueError).code).toBe("invalid_job");
    }
  });

  it("throws on empty or blank queue name", async () => {
    const store = createMemoryStore();
    await expect(store.enqueue({ queue: "   ", payload: {} })).rejects.toThrowError(QueueError);
    await expect(store.claim("   ", 1, new Date(), 1000)).rejects.toThrowError(QueueError);
  });

  it("throws on invalid runAt Date", async () => {
    const store = createMemoryStore();
    await expect(
      store.enqueue({ queue: "q", payload: {}, runAt: new Date(Number.NaN) }),
    ).rejects.toThrowError(QueueError);
  });
});

describe("processBatch", () => {
  it("processBatch(store, 'emails', handler, { now, leaseMs: 30_000, batchSize: 10 }) with a handler throwing new Error('x'.repeat(2000)) returns { completed: 0, failed: 1 } and stores lastError of exactly 1000 characters", async () => {
    const store = createMemoryStore();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const id = await store.enqueue({ queue: "emails", payload: { hello: "world" } });

    const result = await processBatch(
      store,
      "emails",
      async () => {
        throw new Error("x".repeat(2000));
      },
      { now, leaseMs: 30_000, batchSize: 10 },
    );

    expect(result).toEqual({ completed: 0, failed: 1 });
    const job = store.get(id);
    expect(job?.last_error).toHaveLength(1000);
    expect(job?.last_error).toBe("x".repeat(1000));
  });

  it("processes successful batch jobs", async () => {
    const store = createMemoryStore();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await store.enqueue({ queue: "q", payload: 1 });
    await store.enqueue({ queue: "q", payload: 2 });

    const processed: unknown[] = [];
    const res = await processBatch(
      store,
      "q",
      async (job) => {
        processed.push(job.payload);
      },
      { now, leaseMs: 10_000, batchSize: 5 },
    );

    expect(res).toEqual({ completed: 2, failed: 0 });
    expect(processed).toEqual([1, 2]);
  });
});

describe("backoffMs", () => {
  it("calculates exponential backoff correctly capped at maxMs", () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    expect(backoffMs(4)).toBe(8000);
    expect(backoffMs(100)).toBe(3_600_000);
    expect(backoffMs(1, { baseMs: 500, maxMs: 1000 })).toBe(500);
    expect(backoffMs(3, { baseMs: 500, maxMs: 1000 })).toBe(1000);
  });
});
