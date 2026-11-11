# Deploy notes (Phase 11 — web surface only; the rest comes later)

Status: **partial.** This file currently covers the static `/web` surface only, because that is what exists.
The API/worker/Redis host, EAS build, App Links certificate fingerprint and store submission steps are Phase 12
work and are deliberately absent — they get added when their real steps are verified, not before. The agent
never deploys (P1): every step below is for the owner.

## 1. Web surface (static files) — owner deploys to Vercel

1. Build locally with the public address set (the build bakes canonical URLs, og:url, sitemap and robots from
   this value — use the final production URL; re-run the build after every change):

   Windows PowerShell (owner's shell, never the agent's):

   ```
   $env:PUBLIC_WEB_URL='https://your-domain.example'
   $env:PUBLIC_ANDROID_DOWNLOAD_URL=''    # optional; empty hides the button and shows "Download link coming soon"
   $env:WEB_DRAFT_BANNER='off'            # default is off (the DRAFT banner was removed from the public pages by
                                          # owner decision, 20 Oct 2026); set 'on' to show it again
   npm run web:build
   ```

2. Publish the contents of `web/dist/` as the site output directory. The URLs are directory-style
   (`/privacy/` -> `privacy/index.html`); every static host must serve the directory `index.html` for trailing
   slashes (Vercel does by default).
3. Never publish `web/src`, `web/tests`, `docs/` — only `web/dist`.
4. Environment variable names to set in the hosting UI (names only; the agent never writes values):
   `PUBLIC_WEB_URL`, `PUBLIC_ANDROID_DOWNLOAD_URL`, `WEB_DRAFT_BANNER`.
5. After the first deploy: check `/`, one legal page, `/sitemap.xml`, `/robots.txt`,
   `/.well-known/security.txt`, `manifest.webmanifest`, and that the canonical tag shows the production URL.

## 2. Placeholders for later (NOT created now — no fake identifiers)

- `/.well-known/assetlinks.json` — Android App Links statement; needs the **real** certificate fingerprint of
  the app's signing key (the value Android shows for the upload certificate; owner: take it from EAS at build
  time). Rule note: this fingerprint is a public identifier, not a secret, but it must be the real one. The
  digest Android prints for it is deliberately not named here — hashing strings are banned in documentation
  (A4). File format goes here when the fingerprint exists.
- `/.well-known/apple-app-site-association` — iOS universal links; needs the **real** Apple team ID and bundle
  ID (see `docs/stores/apple-future.md`). Nothing invented.
- `security.txt` `Expires` is set at build time (2027-10-20) — refresh at least yearly.

## 3. Backend, workers, cron, databases, EAS builds

Coming with the phase that ships them (PRD 15 host choice, `docs/OWNER-CHECKLIST.md` items: SMTP credentials,
Flutterwave keys, SPF/DKIM/DMARC, EAS build, App Links fingerprint step). Not started, not described as done.

## 4. Backend on Vercel (demo)

The API server can be deployed to Vercel as a serverless function (`server/api/index.ts`) for demonstration and preview purposes (e.g. testing `GET /health` and web fallbacks). Note that background BullMQ workers and node-cron do NOT run inside Vercel serverless functions; they run as long-lived standalone processes.

1. **Vercel Project Configuration**:
   - **Root Directory**: `server`
   - **Include files outside the Root Directory**: enabled (required so npm workspace dependencies like `@rowta/shared` resolve during build).
   - **Build Command**: configured via `server/vercel.json` (`npm run generate`), which regenerates the Prisma clients before building.

2. **Environment Variables**:
   Set the following environment variable names in the Vercel project settings (variable names only; never commit or paste real secrets):
   - `NODE_ENV`
   - `LOG_LEVEL`
   - `API_PORT`
   - `CORS_ALLOWED_ORIGINS`
   - `PUBLIC_WEB_URL`
   - `CACHE_ENABLED`
   - `CRON_ENABLED`
   - `MAX_SEATS_CEILING`
   - `ARGON2_MAX_CONCURRENCY`
   - `TRUST_PROXY_HOPS`
   - `DB0_NAME`
   - `DB0_USER`
   - `DB0_PORT`
   - `DB0_PASSWORD`
   - `DB1_NAME`
   - `DB1_USER`
   - `DB1_PORT`
   - `DB1_PASSWORD`
   - `DB_APP_USER`
   - `DB_APP_PASSWORD`
   - `DB0_ADMIN_URL`
   - `DB1_ADMIN_URL`
   - `DB0_WRITE_URL`
   - `DB0_READ_URL`
   - `DB1_WRITE_URL`
   - `DB1_READ_URL`
   - `REDIS_PORT`
   - `REDIS_PASSWORD`
   - `REDIS_URL`
   - `JWT_ACCESS_SECRET`
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_SECURE`
   - `MAIL_FROM`
   - `SMTP_USER`
   - `SMTP_PASSWORD`
   - `PAYMENT_PROVIDER`
   - `PAYMENT_MODE`
   - `FLW_PUBLIC_KEY`
   - `FLW_SECRET_KEY`
   - `FLW_ENCRYPTION_KEY`
   - `FLW_WEBHOOK_SECRET_HASH`
   - `PAYMENT_SIMULATOR_ENABLED`
   - `EXPO_ACCESS_TOKEN`
   - `EXPO_PUBLIC_API_URL`
   - `EXPO_PUBLIC_EAS_PROJECT_ID`
   - `WEB_APP_URL`

3. **Database Connection Pooling Note**:
   - For `DB0_WRITE_URL`, `DB0_READ_URL`, `DB1_WRITE_URL`, and `DB1_READ_URL` in serverless environments, use Neon's pooled connection string (where the hostname contains `-pooler`, e.g. `ep-xyz-pooler.region.neon.tech`). Neon's pooler runs PgBouncer in transaction pooling mode, preventing connection exhaustion when serverless lambdas scale concurrently.
   - Database connection pooling settings in `server/src/db/clients.ts` will be revisited and refined in stage 2.

