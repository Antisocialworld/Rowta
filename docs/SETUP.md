# Setup (owner)

## 1. Environment file

```
node scripts/setup-env.mjs            # creates .env if missing; fills only EMPTY local secrets; prints names, never values
node scripts/setup-env.mjs --check    # lists missing or empty names; fails if the simulator is on in production
node scripts/setup-env.mjs --audit-example   # fails if .env.example holds a value where it must be empty
```

- `.env` is ignored by git. `.env.example` is committed and holds names only.
- The script generates: `DB0_PASSWORD`, `DB1_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`, and builds the connection strings from them. Re-running never overwrites a value that is already set.
- If you change a database password after the containers were first started, run `docker compose down -v` once (this wipes the local data) so the containers restart with the new password.
- Never paste the contents of `.env` into chat, an issue, a pull request or a commit message.

## 2. Secrets only you can provide (all optional until their phase)

| Names | From | Needed for |
|---|---|---|
| `FLW_PUBLIC_KEY`, `FLW_SECRET_KEY`, `FLW_ENCRYPTION_KEY`, `FLW_WEBHOOK_SECRET_HASH` | your Flutterwave dashboard, TEST mode keys only | real test-mode checkout (Phase 7). Without them the development-only simulator proves the flow. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `MAIL_FROM` (+ optional `SMTP_USER`, `SMTP_PASSWORD`) | your email provider (see §2b) | real email delivery. There is no local mail catcher — the server sends through your provider's real SMTP. |
| `EXPO_ACCESS_TOKEN` | your Expo account | authenticated push sends (optional) |
| `SENTRY_DSN_SERVER`, `EXPO_PUBLIC_SENTRY_DSN` | Sentry project | error reporting (optional) |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | EAS project | Android development build (Phase 12) |

Use a test Flutterwave account, not live keys. If a key is ever exposed, rotate it in the provider dashboard first.

## 2b. SMTP (real email; owner decision 22 Oct 2026)

Rowta sends email with nodemailer over your provider's real SMTP server. There is no local mail
catcher.

| Name | What to paste |
|---|---|
| `SMTP_HOST` | the provider's SMTP hostname |
| `SMTP_PORT` | the provider's SMTP port (often 465 or 587) |
| `SMTP_SECURE` | `true` for implicit TLS (usually port 465), `false` otherwise (usually 587) |
| `MAIL_FROM` | the From header the provider allows (usually a no-reply address on your own domain) |
| `SMTP_USER` | the SMTP login, only if the provider requires authentication |
| `SMTP_PASSWORD` | the SMTP password, only if the provider requires authentication |

- Paste the values into `.env` BY HAND. `.env` is git-ignored and must never be committed, pasted
  into chat, an issue, a pull request or a commit message; the scripts never print its values.
- Manual check (sends exactly ONE email to the address you pass; you run it):
  `node scripts/mail-test.mjs you@example.com`.
- Automated tests NEVER open an SMTP connection: the server suite captures mail in process, and
  the real transporter refuses to build under vitest. Real values can stay in `.env` while tests run.

## 3. Running locally

Docker Desktop must be running.

```
node scripts/setup-env.mjs     # once, first
docker compose up -d           # two PostgreSQL databases and Redis (email is NOT a container)
docker compose ps              # all three should be "healthy"
```

- Every port binds to 127.0.0.1 only.
- Do NOT run `docker compose config` and paste the output anywhere: it prints your secrets.
- The compose file was syntax-checked and its variable guard tested. Verified 2026-10-19 with all
  four then-existing containers healthy; the mail catcher was REMOVED 2026-10-22 (owner decision —
  §2b), so `docker compose up -d` now starts three; owner re-run confirms.

## 4. Databases (schema, self-tests, Prisma)

The SQL in `server/prisma/sql/` is the schema of record (PRD 7). Prisma is the query client only — it never writes
the schema. After `docker compose up -d`:

```
node scripts/db-apply.mjs              # applies 000/010/020/030 to both databases as the owner; safe to re-run
node scripts/db-as-app.mjs             # selftest-app.sql as the app role (12 checks per database)
node scripts/db-as-app.mjs --ledger    # proves the app role can append to the ledger but not update or delete

npm install                            # once: workspaces /app /server /shared
npm run db:pull --workspace @rowta/server       # introspects both live databases (read-only)
npm run generate --workspace @rowta/server      # builds the two query clients
node scripts/prisma-smoke.mjs          # proves both clients connect and the ledger rules hold
```

- `db-apply.mjs` never drops, truncates or deletes anything. Tables that already exist are skipped, so re-running is safe.
- `db pull` overwrites `server/prisma/db0/schema.prisma` and `server/prisma/db1/schema.prisma`. Do not hand-edit those two
  files; `scripts/prisma-pull.mjs` repairs one known introspection mistake after every pull (see `docs/decisions/0002`).
- `server/prisma/generated/` is git-ignored. Re-create it with `npm run generate --workspace @rowta/server`.
- Nothing here prints a connection string, password or URL. If a command fails, paste the error text — the scripts mask
  credentials, but check before pasting.

## 4b. View the database

Safe commands to inspect local databases (`db0` and `db1`) in your browser or terminal:

### Browser (Prisma Studio)

```
npm run db:studio        # db0 (global database & shard 0) on http://localhost:5555
npm run db:studio:db1    # db1 (shard 1) on http://localhost:5556
```

- **Warning**: Prisma Studio allows **editing and deleting** rows in the database (it has no read-only mode).
- **Warning**: Never screenshot, copy, or paste rows containing sensitive columns (e.g. `password_hash`, `code_hash`, `verifier_hash`, `token`, or `secret`).
- Studio listens on `127.0.0.1` only. It refuses to start if `NODE_ENV=production` or if the host is not `127.0.0.1` / `localhost`.
- If schema introspection is ever missing, it automatically invokes `scripts/prisma-pull.mjs`.

### Terminal viewer (psql)

Interactive `psql` session inside the database container:

```
npm run db:psql            # db0 interactive read-only session (default)
npm run db:psql:db1        # db1 interactive read-only session
npm run db:psql -- --write # db0 writable session (warning printed first)
```

- **Read-only by default**: The session runs with `PGOPTIONS="-c default_transaction_read_only=on"` to protect data from accidental modification. Pass `--write` when intentional edits are needed.
- Safe tips inside `psql`:
  - `\dt` lists all tables in the `public` schema.
  - `\d <table_name>` describes columns, data types, and constraints of a table.
  - `\q` quits the psql session.
- Authentication: Inside the Docker container, PostgreSQL's local domain socket defaults to `trust` authentication per standard `postgres:16-alpine` configuration (`/var/lib/postgresql/data/pg_hba.conf`), connecting without exposing passwords on the command line.

### Terminal table summary (non-interactive)

```
npm run db:tables
```

- Prints every table across both `db0` and `db1` with its current row count and column definitions.
- **Privacy & Secret Safety**: Queries schema metadata (`information_schema`) and `COUNT(*)` only; it never queries or prints values of any column whose name contains `hash`, `token`, `secret`, `password`, or `code`.

## 5. Running the server and worker (Phase 0 part B and later)

With the containers from §3 running and `.env` in place:

```
npm install                            # once, if you have not already (workspaces /app /server /shared)

# API (Hono). Listens on API_PORT (default 3000).
npm run start --workspace @rowta/server

# Worker (BullMQ + node-cron). Separate process; run it in a second terminal.
npm run worker --workspace @rowta/server

# Development with auto-reload
npm run dev --workspace @rowta/server          # API
npm run worker:dev --workspace @rowta/server   # worker
```

- `GET http://localhost:3000/health` reports the process is up.
- `GET http://localhost:3000/health/deep` additionally pings Redis and both databases, returning
  pass/fail per dependency. In production this route should sit behind the load balancer only.
- Email proof (your own mailbox, exactly one message): `node scripts/mail-test.mjs you@example.com` —
  the owner runs it; it prints only pass/fail and the accepted-recipient count (§2b).
- Server smoke test (boots the real HTTP server in-process, no background process left behind):
  `npx tsx scripts/server-smoke.mjs`.

## 6. Checks the agent runs before reporting

```
npm run typecheck --workspace @rowta/server
npm run lint      --workspace @rowta/server
npm test          --workspace @rowta/server
node scripts/setup-env.mjs --check
node scripts/setup-env.mjs --audit-example
node scripts/scan-name.mjs
node design-system/verifyTokens.js
node scripts/check-ui-tokens.mjs
```

## 7. What you do, what the agent does

The agent builds and verifies. You do every `git add`, `commit` and `push`, every deploy (Vercel, API host), the Android build, the logo, the demo video and the LinkedIn post. See `OWNER-CHECKLIST.md` at the end of the build.
