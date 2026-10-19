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
| `SMTP_USER`, `SMTP_PASSWORD` (and `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `MAIL_FROM`) | your email provider | real email delivery. Without them, mail goes to the local catcher (Mailpit) and nothing leaves your computer. |
| `EXPO_ACCESS_TOKEN` | your Expo account | authenticated push sends (optional) |
| `SENTRY_DSN_SERVER`, `EXPO_PUBLIC_SENTRY_DSN` | Sentry project | error reporting (optional) |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | EAS project | Android development build (Phase 12) |

Use a test Flutterwave account, not live keys. If a key is ever exposed, rotate it in the provider dashboard first.

## 3. Running locally

Docker Desktop must be running.

```
node scripts/setup-env.mjs     # once, first
docker compose up -d           # two PostgreSQL databases, Redis, local mail catcher (Mailpit)
docker compose ps              # all four should be "healthy" or "running"
```

- Mail sent in development is caught by Mailpit; open `http://localhost:8025` (port from `MAILPIT_UI_PORT`) to read it. Nothing leaves your computer.
- Every port binds to 127.0.0.1 only.
- Do NOT run `docker compose config` and paste the output anywhere: it prints your secrets.
- The compose file was syntax-checked and its variable guard tested, but the containers have not been started (not verified). The server, worker and app start commands are added when Phase 0 is complete.

## 4. What you do, what the agent does

The agent builds and verifies. You do every `git add`, `commit` and `push`, every deploy (Vercel, API host), the Android build, the logo, the demo video and the LinkedIn post. See `OWNER-CHECKLIST.md` at the end of the build.
