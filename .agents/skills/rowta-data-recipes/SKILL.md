---
name: rowta-data-recipes
description: "Use when building Rowta server and state features: optimistic mutations, the team-scoped data-access layer, cursor pagination, proration, the payment webhook handler, node-cron with a Redis lock and BullMQ jobs, soft delete and purge, and quiet hours."
---

# rowta-data-recipes

Part of the Rowta method (Recipes 3.7 to 3.14). Numbering is kept from the original method so cross-references still resolve: see the table in `AGENTS.md`.
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

### 3.7 Optimistic mutation (C7, U3)
```
useMutation({
  mutationFn: requestSwap,                       // sends Idempotency-Key
  onMutate: async (vars) => { await qc.cancelQueries(key); const prev = qc.getQueryData(key); qc.setQueryData(key, apply(prev, vars)); return { prev } },
  onError:  (err, vars, ctx) => { qc.setQueryData(key, ctx.prev); announce(t('swap.failed')) },
  onSettled: () => qc.invalidateQueries({ queryKey: key }),
})
```
The button is busy and disabled visually AND in its accessibility state while pending (X2).

### 3.8 Data-access layer with required team scope (S7, D4)
```
forTeam(teamId: string) -> { shifts: { list(range), get(id), create(...), softDelete(id, by) }, ... }
every query includes WHERE team_id = $teamId AND deleted_at IS NULL (unless includeDeleted is passed explicitly)
calling any team repository without a teamId throws in tests
```

### 3.9 Cursor query (8.3)
`WHERE team_id = $1 AND (created_at, id) < ($2, $3) ORDER BY created_at DESC, id DESC LIMIT $4 + 1` (fetch one extra row to
know if there is a next page); cursor = base64url of `{createdAt, id}`; validate the cursor with Zod; reject tampered cursors
with 422. Test with 5 rows sharing one timestamp.

### 3.10 Proration module (8.6, T5)
Pure functions only: `monthlyCents(plan, seats)`, `prorate({ oldPlan, oldSeats, newPlan, newSeats, R, P })`, `daysRemaining(periodStart, now, P)`.
Integer arithmetic: multiply then `Math.floor(a / b)` on integers; assert inputs are integers. Write the 11-row table as tests
first (they must fail), then implement.

### 3.11 Webhook handler (S13, 8.6)
Read the RAW body; verify the signature with the code in `server/src/billing/webhook-signature.ts` (the only file allowed to use
the provider's algorithm, exception E1); constant-time compare; in one transaction insert the event ID (UNIQUE) and enqueue the
processing job; respond 200; on a duplicate event ID respond 200 and do nothing. The job re-verifies the transaction with the
provider's API before writing the ledger.

### 3.12 Cron plus lock plus job (J2, 8.11)
```
cron.schedule(expr, async () => {
  const got = await redis.set(lockKey, instanceId, { NX: true, EX: ttlSeconds })    // [VERIFY client call signature]
  if (!got) return                                                                  // another instance owns this tick
  await queue.add(jobName, {}, { jobId: `${jobName}-${windowStartEpoch}` })         // same window collapses duplicates; NO colon and not digits-only in a BullMQ custom id (verified in the BullMQ docs); a duplicate id is silently ignored only while the earlier job still exists, so keep completed jobs at least one window
}, { timezone: 'UTC' })                                                             // [VERIFY option name]
```
The job itself is idempotent and does the work. A test starts two worker instances and shows the work ran once.

### 3.13 Soft delete and purge (D4 to D6, 8.10)
Soft delete: `UPDATE ... SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND team_id = $3 AND deleted_at IS NULL`.
Purge job: `dryRun` flag defaults to true; selects rows with `deleted_at < now() - grace` in batches (for example 500); deletes
child rows before parents in one transaction per batch; writes a `purge_log` row; never touches `ledger_entries`.

### 3.14 Quiet hours (8.8)
Convert the server's `now` to the user's IANA zone; compare to quiet_start and quiet_end, handling ranges that cross
midnight; when inside, compute the delay to the end of quiet hours and enqueue a delayed job. Test: 02:00 local with 22:00-06:00
delays to 06:00; midnight crossing; same server time in two zones.
