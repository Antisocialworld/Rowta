# Icon pipeline gate evidence

Date: 2026-10-19; refreshed 2026-10-22 (item B — in-app rounded logo). Branch: `rowta-1`. Scope: the
owner's icon pipeline (four SVGs in `brand-source/` → every Rowta icon). Every claim below is backed
by output captured in the session named on its line. Anything not run says "not verified".

## 1. Commands run, with results

```
# 2026-10-22 refresh (item B):
node scripts/build-icons.mjs                   -> 19 files, 54 checks, ALL CHECKS PASSED 54, exit 0
node scripts/build-icons.mjs  (2nd run)        -> 19 files, 54 checks, ALL CHECKS PASSED 54, exit 0
  the two stdout reports -> one blake2b512      -> IDENTICAL (see §2)
node scripts/verify-logo-rounded.mjs            -> 4 checks, ALL CHECKS PASSED 4, exit 0

# 2026-10-19 original session (not re-run in the refresh):
npm run icons                                  -> same as build-icons.mjs (root package.json script)
npm run typecheck --workspace @rowta/server    -> tsc --noEmit, exit 0
npm run lint --workspace @rowta/server         -> eslint ., exit 0 (0 errors, 0 warnings)
npm test --workspace @rowta/server             -> 10 files, 55 tests, 55 passed, 0 failed
node scripts/setup-env.mjs --audit-example     -> OK: 50 names in .env.example; every sensitive name is empty
node scripts/setup-env.mjs --check             -> RESULT: ok (10 optional/phase-gated names empty)
node scripts/check-ui-tokens.mjs               -> PASSED (13 files scanned)
```

`.env` was never opened in either session; only the two `setup-env.mjs` checks above were run.

## 2. Determinism

Two consecutive full runs of `node scripts/build-icons.mjs` on 2026-10-22, each stdout captured as
raw bytes (spawnSync, no shell redirection) and digested with Node's `createHash('blake2b512')`:

```
87d60b1ba952654514829d3111ebd6d915ad7e88f6321f6e21f1d56ff10f5e84bb4dfdb3f1e31ba4f7c2def6a27bdef64f5fc1f11eede3001bb3c405e4606236   7958  run 1 report
87d60b1ba952654514829d3111ebd6d915ad7e88f6321f6e21f1d56ff10f5e84bb4dfdb3f1e31ba4f7c2def6a27bdef64f5fc1f11eede3001bb3c405e4606236   7958  run 2 report
IDENTICAL 2 files, one digest 87d60b1ba952654514829d3111ebd6d915ad7e88f6321f6e21f1d56ff10f5e84bb4dfdb3f1e31ba4f7c2def6a27bdef64f5fc1f11eede3001bb3c405e4606236
```

The report contains only relative paths, byte counts, blake2b512 digests of the written files, the
dimension listing and the check list — no timings and no absolute paths — so run-to-run equality of
the report is equality of the outputs. The digests printed in §4 are from run 1; run 2 produced the
same 19 digests.

For contrast, the 2026-10-19 session (18 files, before `logo-rounded.png`) digested to
`6d440b26…45e1` over 7449-byte reports — a different report by construction, same method.

Reproduce:

```powershell
node scripts/build-icons.mjs > run1.txt
node scripts/build-icons.mjs > run2.txt
# digest both files with blake2b512 and compare (capture both the same way — a PowerShell `>`
# redirect re-encodes stdout; spawnSync/`--input-type=module` byte capture avoids that)
```

## 3. Full build output (run 1, 2026-10-22)

```
rowta icon pipeline
sources 4 svg, tile colour from svg #292da3
files 19
395bef969a8994eb6255722b3a1672ca080d951e5a9c827ca7ace893c3d643d5b797299fc8d333ee8a16398cecdbecfd6cc1dd5a2de52308caf4f12e5c69e60b     8385  app/assets/adaptive-icon-foreground.png
0da07ae89e3d01726529f2cd234c967ceb813cce3a729232c8fda6d5fba396d4e358bb731fffb6c2eed0ea46787e5becfb11f178acbff6f397a753b08372138d    28041  app/assets/app-icon-1024.png
146399dca0d7a9d97c37d8182d47431b752a656b346e1923f7a66912403542f74be7f1e3abc4381fdc74c7d187bb75ee1ae4409b7e538b65b686752f55943be8      772  app/assets/header-mark.svg
85d78bd0d90105b0296862b2d4202baadf44acd4a69638fab659268dbb38634c938ced7821defba8dad168d3f13a97c5fc7132d9236a3694dd1a033b5c3f000e    12478  app/assets/logo-rounded.png
fcc8783af918aba6e84a7a5495d72180da5fb6a9aea9a9db2f338b7dc9a10fa37ad0ba695fbd9ae9ab25ec568700e4c8fcc954382ab3de0dc39cbd285b60399e      820  app/assets/notification-icon.png
fdaf1ebc30990f7168bbf7a0bb20fdb589787c0956ab7b434bd91dcc46ed1a9eabcd3c2ffe7ceae81ba93226508ea6e02b65b7257ff24802880c9e6f4b8ebb5a    15390  app/assets/splash.png
da47be19607d89110bc558b5a219826dac15d7716503a6cc84bae478c72e3a60d364b63f837d530e2d0a1111469f287a30d3c4122c9aabf5379498171d4d5b56     3436  web/public/brand/apple-touch-icon.png
75a4863b2b106a80ffdb65c9bb8339e8d8eeb2ea52a3ca1ac29cb1d2c1b42e388191bed19563c2ed831fd9536dae70a8b1defb9853049ac80cc3f5a32d54c5d6    15086  web/public/brand/favicon.ico
146399dca0d7a9d97c37d8182d47431b752a656b346e1923f7a66912403542f74be7f1e3abc4381fdc74c7d187bb75ee1ae4409b7e538b65b686752f55943be8      772  web/public/brand/favicon.svg
c799f7f6ab21d623bf5644f16f8313188bf00a7563328faaaf8633e9fea1a5c615a9e591d3152b669b67f1309195e2c79e1969b61e0a0cf155c2990433c5d284      443  web/public/brand/icon-16.png
fcfb5a4f6a3b4c951ba4c2c34cddb87c3f8ffad821b0b14c19d9fd4ea3604db04ba01142a751eead4c98f33397287a5b0bc4bb2319f208c2406be4307af03779      723  web/public/brand/icon-32.png
8d6b9993fe54ba29530083e4e8dd9004465c67f050d1f1d06e9c2a0099dd3eb49821ff421e90540bffc23891848a56064f965d87c6f83b9d608f34f8186e5586     1025  web/public/brand/icon-48.png
3d156d4466dfd688802f53de7f1cf9331a52cad5bd993e15b644fc2b0305980a1256f38cb08821e4ce3b175184c657f9c943acae1b54b16c885347106a784215     1777  web/public/brand/logo-card.svg
419b6ec3ac0c4d262beb71605cb87bf15d33c6e89f151e612d26a1f1abf05b05f07e026697a7dea6a123c497e7727e8ead9588710d3c3d8a47852942e697fe43      673  web/public/brand/logo-mono.svg
146399dca0d7a9d97c37d8182d47431b752a656b346e1923f7a66912403542f74be7f1e3abc4381fdc74c7d187bb75ee1ae4409b7e538b65b686752f55943be8      772  web/public/brand/logo-small.svg
45740cc3702f3af07fc48779144befe9ff42b6a4500456d869c0f22cbd1a91b8e3f4b56b205a45965d0e9156ad66e52a3b18e90b6ca786f45ee849e2cca44a88     1648  web/public/brand/logo.svg
87c96a693f6cdeda7e564e5de890306be6181b0998ed2b3c0004c4e7213e08ab9631accf3e41ab285c6eb6740f2f81f78762b35f551a35d9ebc87f10698fcc24    12279  web/public/brand/og-image-1200x630.png
0c331154321382d8a2c59ea2b1a90e32ea91da7e46d3b1754ba7591e6c5e9ac588dc0441c846b71e8d3b598b21e3dd017547cebf4ef1f29315e4464a3927de74     3709  web/public/brand/web-manifest-192.png
e766bc4a8742494e00c3e1aee6ac4bbeba6ac975bbc81a6dbfa9fd427f43ca7f9f6e003602cee00a9804a3fef62690047b846f321dc1ba0bfed05369f80f7876    11003  web/public/brand/web-manifest-512.png
dimensions 20
432x432 transparent             app/assets/adaptive-icon-foreground.png
1024x1024 opaque                app/assets/app-icon-1024.png
vector source                   app/assets/header-mark.svg
480x480 transparent             app/assets/logo-rounded.png
480x480 transparent             app/assets/logo-rounded.png
96x96 transparent               app/assets/notification-icon.png
1024x1024 transparent           app/assets/splash.png
180x180 opaque                  web/public/brand/apple-touch-icon.png
48/32/16 px multi-size          web/public/brand/favicon.ico
vector source                   web/public/brand/favicon.svg
16x16 transparent               web/public/brand/icon-16.png
32x32 transparent               web/public/brand/icon-32.png
48x48 transparent               web/public/brand/icon-48.png
vector source                   web/public/brand/logo-card.svg
vector source                   web/public/brand/logo-mono.svg
vector source                   web/public/brand/logo-small.svg
vector source                   web/public/brand/logo.svg
1200x630 opaque                 web/public/brand/og-image-1200x630.png
192x192 opaque                  web/public/brand/web-manifest-192.png
512x512 opaque                  web/public/brand/web-manifest-512.png
checks 54
PASS  tile colour agrees across sources: logo-small.svg (#292da3)
PASS  tile colour agrees across sources: logo-card.svg (#292da3)
PASS  copy byte-identical: web/public/brand/logo.svg (1648)
PASS  copy byte-identical: web/public/brand/logo-small.svg (772)
PASS  copy byte-identical: web/public/brand/logo-mono.svg (673)
PASS  copy byte-identical: web/public/brand/logo-card.svg (1777)
PASS  copy byte-identical: web/public/brand/favicon.svg (772)
PASS  copy byte-identical: app/assets/header-mark.svg (772)
PASS  dimensions: app/assets/app-icon-1024.png (1024x1024)
PASS  alpha expectation: app/assets/app-icon-1024.png (hasAlpha=false)
PASS  opaque corner filled with tile colour: app/assets/app-icon-1024.png (41,45,163,255)
PASS  dimensions: web/public/brand/apple-touch-icon.png (180x180)
PASS  alpha expectation: web/public/brand/apple-touch-icon.png (hasAlpha=false)
PASS  opaque corner filled with tile colour: web/public/brand/apple-touch-icon.png (41,45,163,255)
PASS  dimensions: web/public/brand/web-manifest-512.png (512x512)
PASS  alpha expectation: web/public/brand/web-manifest-512.png (hasAlpha=false)
PASS  opaque corner filled with tile colour: web/public/brand/web-manifest-512.png (41,45,163,255)
PASS  dimensions: web/public/brand/web-manifest-192.png (192x192)
PASS  alpha expectation: web/public/brand/web-manifest-192.png (hasAlpha=false)
PASS  opaque corner filled with tile colour: web/public/brand/web-manifest-192.png (41,45,163,255)
PASS  dimensions: app/assets/logo-rounded.png (480x480)
PASS  alpha expectation: app/assets/logo-rounded.png (hasAlpha=true)
PASS  dimensions: web/public/brand/icon-48.png (48x48)
PASS  alpha expectation: web/public/brand/icon-48.png (hasAlpha=true)
PASS  dimensions: web/public/brand/icon-32.png (32x32)
PASS  alpha expectation: web/public/brand/icon-32.png (hasAlpha=true)
PASS  dimensions: web/public/brand/icon-16.png (16x16)
PASS  alpha expectation: web/public/brand/icon-16.png (hasAlpha=true)
PASS  dimensions: web/public/brand/og-image-1200x630.png (1200x630)
PASS  alpha expectation: web/public/brand/og-image-1200x630.png (hasAlpha=false)
PASS  opaque corner filled with tile colour: web/public/brand/og-image-1200x630.png (41,45,163,255)
PASS  adaptive foreground dimensions (432x432)
PASS  adaptive foreground keeps transparency (true)
PASS  adaptive foreground has artwork (66529)
PASS  adaptive artwork inside the 66dp safe zone (0 px outside)
PASS  logo-rounded dimensions (480x480)
PASS  logo-rounded keeps transparency (true)
PASS  logo-rounded four corner pixels fully transparent (0,0,0,0)
PASS  logo-rounded centre opaque (255)
PASS  notification icon dimensions (96x96)
PASS  notification icon has visible pixels (3936)
PASS  notification icon has transparency (5280)
PASS  notification icon is all-white (min channel 255)
PASS  notification icon cell cut-outs are transparent (0,0,0,0,0)
PASS  notification icon body is opaque white (255,255,255,255)
PASS  manifest 512: artwork present (63837)
PASS  manifest 512: maskable 80% circle respected (worst 194.1px of 204.8px)
PASS  manifest 192: artwork present (9348)
PASS  manifest 192: maskable 80% circle respected (worst 73.3px of 76.8px)
PASS  splash dimensions (1024x1024)
PASS  splash keeps transparency (true)
PASS  ico header valid
PASS  ico entry count (3)
PASS  ico contains 48/32/16 (48,32,16)
ALL CHECKS PASSED 54
```

Two facts worth calling out: `favicon.svg`, `logo-small.svg` and `header-mark.svg` share one digest
because they are the same bytes by design, and the notification icon's five cut-outs read alpha 0,
which proves SVG `<mask>` survived the libvips render rather than being dropped. `logo-rounded.png`
(added 2026-10-22) is the same `logo.svg` rasterised WITHOUT flattening, so its rx=38/160 corners stay
transparent — it appears twice in the dimension listing because the generic pngTargets loop and the
item-B-specific check each push one row for it.

### 3b. verify-logo-rounded.mjs (2026-10-22)

```
rowta logo-rounded verify
file app/assets/logo-rounded.png 480x480
landing svg rx=38 on 160 viewBox -> ratio 0.2375 (23.75%)
png measured radius 113px on 480px -> ratio 0.2354 (23.54%)
edge radii TL/TR/BL/BR 113/113/113/113
PASS  four corner pixels fully transparent (0,0,0,0)
PASS  centre pixel fully opaque (255)
PASS  all four edges measured a positive radius (113,113,113,113)
PASS  measured rounding ratio matches landing SVG rx/160 (svg 38/160=0.2375; png 113/480=0.2354; expected px 114.00)
ALL CHECKS PASSED 4
```

The measured radius is the first fully-opaque pixel along each edge (the 0→255 anti-alias feather
occupies x=99..112); 113 vs the geometric 114 is the one-pixel AA boundary, inside the script's ±1 px
tolerance.

## 4. Gate results

| Gate | Result |
|---|---|
| 1 banned hashing | 2 markdown hits, 0 code hits: `docs/gates/phase-0-b.md:52` (quotes the gate's own pattern in its evidence table) and `rowta-scaffold-v3.md` (ignored by `.gitignore`, not tracked; prose about the ban). **Extended to `*.mjs`, which the gate's include list omits: 0 hits**, including `scripts/build-icons.mjs` and `scripts/verify-logo-rounded.mjs`. |
| 2 banned auth phrases | 0 hits in real source. 54 hits, all inside `server/prisma/generated/**`, all the generated doc comment "in case it already exists, update" — Prisma model comments, not account messages. |
| 3 secret patterns | 11 hits, no real credential: `server/tests/env-validation.test.ts:29-34` = six fake DB URLs used to exercise the Zod shape check (values shown masked, already documented in `docs/gates/phase-0-b.md`); `server/prisma/generated/db0/internal/class.ts:40` = generated runtime schema JSON; `docs/gates/phase-0-b.md:56` = the line that documents those fixtures; `rowta-scaffold` + `rowta-scaffold-v3.md` = untracked ignored scaffold files. No hit in `scripts/build-icons.mjs`. |
| 3b env | `.env.example`: OK, 50 names, every sensitive name empty. `--check`: RESULT ok. |
| 4 tracked env files | exactly `.env.example` |
| 5 token storage | 0 hits |
| 6 lint | skill's literal `npx eslint . --max-warnings 0` from the repo root **fails with exit 2 — no root `eslint.config.*` exists** (pre-existing: ESLint is configured under `server/`). The configured command `npm run lint --workspace @rowta/server` exits 0. Consequence: `scripts/build-icons.mjs` and `scripts/verify-logo-rounded.mjs` are not covered by ESLint — same as every other file in `scripts/`. The regex gates do cover them (gate 3 scans all files; gate 1 extended above covers `.mjs`). |
| 7 hard-coded colours in components/screens | 0 hits |
| 8 hard-coded user text | 0 hits |
| UI token gate (`check-ui-tokens.mjs`) | PASSED on 2026-10-19, 13 files scanned — not re-run in the 2026-10-22 refresh (out of scope: the new outputs sit in `app/assets/` and `web/public/brand/` as `.png`/`.svg`/`.ico`, which the gate does not scan). |
| tests | 10 files, 55 passed, 0 failed (2026-10-19; not re-run in the refresh) |

## 5. Not done, not verified

- **Wired since the 19 Oct original** (these lines are kept for history; the items are no longer open):
  `app/app.json` now exists and references the icon, adaptive foreground, splash, notification icon
  and `web.favicon` → `app/assets/favicon.png`; `app/package.json` exists; `AuthPage.tsx` now
  renders `app/assets/logo-rounded.png` (item B, 22 Oct). See `docs/BRANDING.md` §5 for the live table.
- **Still not wired**: `web/index.html`, `web/public/manifest.json`, `web/package.json`, and an app
  header component. Table in `docs/BRANDING.md` §5.
- **Not built** (outside the owner's source-to-output mapping): `android.adaptiveIcon.monochromeImage`
  and the legacy `android.icon`.
- **Not verified**: rendering on a physical device or emulator, a real Android launcher mask, the
  Windows icon preview of `favicon.ico` beyond its parsed header and directory entries, and any
  Lighthouse/axe pass on the Expo web preview.
- `developer.android.com` page fetches failed (transport error / timeout); the adaptive-icon numbers
  used here come from search excerpts of those same pages, quoted verbatim in `docs/BRANDING.md` §4
  and marked as such there.
