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
