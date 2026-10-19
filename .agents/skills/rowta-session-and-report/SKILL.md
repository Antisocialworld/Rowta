---
name: rowta-session-and-report
description: "Use at the start of every Rowta work session, before each step or phase, when writing a step or phase report, when blocked or unsure, or to avoid known mistakes. Covers the session checklist, the step loop, the report format and the stop conditions."
---

# rowta-session-and-report

Part of the Rowta method (Sections 1, 2, 6, 7 and 8 of the Rowta method). Numbering is kept from the original method so cross-references still resolve: see the table in `AGENTS.md`.
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Start of every session

1. Read `AGENTS.md` (always active), open the glob-triggered rules in `.agents/rules/` for the area you are about to touch, read the PRD sections for the current phase, `README.md`, `docs/BUILD-PROGRESS.md`, `docs/decisions/` and the last `LEARNING-LOG.md` entry.
2. State in one sentence: the current phase, its gate (PRD 12), and which [OPEN] items still block it.
3. If a rule or the PRD is ambiguous or contradicts the brief, stop and ask (P4). Do not choose silently.
4. Never open `.env` or `.env.*` other than `.env.example` (S2). The scaffold already contains an empty `.env`; programs may load it, you never read, print or edit it. Check it only with `node scripts/setup-env.mjs --check` (prints names, never values).

## 2. The loop for every step inside a phase

1. **Say the plan**: files you will touch, why, and which rule IDs apply.
2. **Test first** for money, time, permissions and validation (T5).
3. **Make one small change.** One endpoint, one migration, one component. Never two risky changes together (P2).
4. **Run the proof**: the test, the curl, the SQL query. Show the real output (P3).
5. **Run the gates in section 5.** Show the (empty) results.
6. **Report** in the format in section 6. At the end of a phase save the gate evidence in `docs/gates/phase-<n>.md`, update `docs/BUILD-PROGRESS.md`, then continue to the next phase unless a stop condition in rule P2 applies.

## 6. Report format at the end of a step or phase

```
STEP / PHASE: <name>                    RULES TOUCHED: <IDs>
BUILT:        <list>
EVIDENCE:     <real command output or row, masked where needed>
GATES:        <section 5 results>
NOT DONE / NOT VERIFIED: <list, with the reason>
OPEN ITEMS BLOCKING THE NEXT STEP: <list or none>
SUGGESTED (text only):  branch <name> | commit "<Conventional Commits message>" | PR description
CONFIRMATION: no git write command run; no secret written or printed; no .env file opened; nothing deployed.
```

## 7. When blocked or unsure

Stop. Say what you know, what you are inferring, and the options with a recommendation. Examples that require a stop:
a library call you cannot verify, a provider detail not in its docs, a PRD rule that conflicts with the brief, an
[OPEN] decision, a request to relax a rule, a test you cannot make pass honestly.

## 8. Common mistakes to avoid (found in earlier reviews)

- Returning early for an unknown email, which leaks existence by timing (3.4).
- Writing a second copy of a Zod schema in the app instead of importing it from `/shared` (V1).
- Putting the role in the access token or in `user_team_index` (S8).
- Hard-deleting inside a request handler, or deleting ledger rows (D5, D3).
- Running cron on every server instance without a lock (J2).
- Giving a form's submit button the native `disabled` attribute, or leaving it not-ready with no visible reason (V6, X14).
- Using colour alone, or an icon without a name, to carry meaning (X1, X5).
- Writing the rule's banned phrase into the product ("incorrect password") while testing the error path (A5).
- Treating "the build passes" as proof that a feature works (P3).
