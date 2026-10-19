---
name: rowta-jobs-worker-recipes
description: "Use when building Rowta background work: the BullMQ queues and separate worker process, retries and backoff, job IDs, the node-cron registry with Redis locks, delayed jobs, the failed-jobs admin script, graceful shutdown of the worker, and job tests."
---

# rowta-jobs-worker-recipes

Part of the Rowta method. Scope: PRD 8.11, 9.8, Phase 0 and 6; rules J1 to J4, C2, C4, C8. BullMQ and node-cron APIs are [VERIFY].
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Layout
`server/src/worker/` is a SEPARATE process entry from the web server. Queues: push, webhook, email, renewal, purge (PRD 9.8). Queue and worker share one Redis connection config built from `REDIS_URL`; workers need the connection options the BullMQ docs require [VERIFY, for example blocking-connection retry settings]. Phase 0 proves one test job end to end because Phase 2 sends email from a job.

## 2. Defaults for every queue (J1)
5 attempts, exponential backoff, keep failed jobs for inspection, trim old completed ones by age (keep completed jobs at least as long as any cron window that uses a job ID, see 3). Every attempt writes a structured log line: queue, job ID, attempt number, outcome, duration. Payloads hold IDs and never secrets (J3). Every job is safe to run twice (C4): a unique constraint or a deduplicated side effect guards ledger rows, notifications and emails.

## 3. Job IDs (verified in the BullMQ docs)
A custom job ID MUST NOT contain a colon and MUST NOT be only digits. Build IDs like `renewals-due-1760000000` (name, dash, epoch seconds of the window start). Adding a job whose ID still exists is silently ignored; once the earlier job is removed the ID can be reused, so the Redis lock (section 4) is the primary guard and the ID is the second.

## 4. Cron registry (J2, PRD 8.11)
ONE exported array of { name, schedule (UTC), lockKey, ttlSeconds, queue, jobName } is the single source for the schedules AND for `docs/cron-registry.md` (generate the doc from it so they cannot drift). `node-cron` runs only in the worker and only when `CRON_ENABLED` is true. Each tick: take the lock with set-if-absent plus expiry [VERIFY client call]; if not acquired, return; otherwise enqueue and return. Lock keys use colons (they are Redis keys, not job IDs). The queued job does the work, idempotently.
Test: two worker instances, one schedule tick, the work runs once.

## 5. Delayed delivery (J4)
Quiet hours use BullMQ delayed jobs (delay computed per recipe 3.14 in `rowta-data-recipes`), never cron polling.

## 6. Failed-jobs script
`server/scripts/list-failed-jobs` (admin only, run locally against the configured Redis) prints queue, job ID, attempts, failure reason and a masked payload summary. It never prints tokens, codes or emails in full.

## 7. Shutdown (C8)
On SIGTERM: stop cron, close workers so in-flight jobs finish, close queues, Redis and database pools, then exit. Unhandled rejections log and exit non-zero.

## 8. Redis cost check (PRD 9.1, Q8)
BullMQ polls Redis constantly. Measure command usage on local Docker Redis before relying on a hosted free tier; record the number in `docs/ARCHITECTURE.md` [VERIFY free-tier limits].

## 9. Tests (Phase 6 gate)
A job that fails then succeeds shows growing backoff delays in the log; a job that exhausts attempts lands in the failed list; two workers run each cron once; a delayed job fires at the right time (with a controlled clock where possible).

## 10. Mistakes to avoid
node-cron in the web server; work done inside the cron callback; a job ID with a colon; a cron with no lock; a job that sends an email twice when retried; a payload that carries a code or token.
