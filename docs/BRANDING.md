# Rowta brand assets and icon pipeline

Owner-supplied artwork, the one script that turns it into every icon Rowta needs, and the platform
rules each output satisfies. Nothing here may be recoloured or re-proportioned by hand — change the
source SVG, re-run the script.

## 1. Sources (read-only)

| File | Intrinsic size | What it is |
| --- | --- | --- |
| `brand-source/logo.svg` | 160 × 160 | Lettered book tile (R O W over T A), the app mark |
| `brand-source/logo-small.svg` | 160 × 160 | Same tile with five blank cells, legible at 16 px |
| `brand-source/logo-mono.svg` | 160 × 160 | One-colour silhouette (white shape on transparent), for tinted surfaces |
| `brand-source/logo-card.svg` | 1200 × 630 | Blue card with a closed book, for sharing and splash |

Palette as written in those files (parsed by the script, never hard-coded in it):

| Role | Value |
| --- | --- |
| Tile / card background (also the Android adaptive background colour) | `#292da3` |
| Spine | `#1e227b` |
| Page base bar | `#d6d7f5` |
| Page / lettering | `#ffffff` |

The four files are byte-copied to `web/public/brand/` on every run, and `logo-small.svg` is also
copied to `web/public/brand/favicon.svg` and `app/assets/header-mark.svg`. The script proves each
copy is byte-identical to its source with blake2b512.

## 2. Build

```sh
npm run icons          # = node scripts/build-icons.mjs, run from the repo root
```

Exit code 0 means every output was written and every check passed. Exit 1 prints the failing checks.

Two dev dependencies, both pinned exact, both local (no image is ever sent anywhere):

| Package | Version | Why it is needed |
| --- | --- | --- |
| `sharp` | `0.35.5` | SVG → PNG rasterisation on libvips. Deterministic, explicit encoder options, no network. |
| `png-to-ico` | `3.0.2` | ICO container encoding (16/32/48 entries). `sharp` reads ICO but does not write it, so the container needs one small extra library. |

Determinism: the stdout report contains only relative paths, byte counts and blake2b512 digests —
no timings, no absolute paths — so two runs can be diffed directly. Evidence that two runs produce
one digest is in `docs/gates/icons.md`.

## 3. Outputs

| Output | From | Size | Alpha |
| --- | --- | --- | --- |
| `app/assets/app-icon-1024.png` | `logo.svg` | 1024 × 1024 | opaque |
| `app/assets/adaptive-icon-foreground.png` | `logo.svg` | 432 × 432 | transparent |
| `app/assets/notification-icon.png` | `logo-mono.svg` | 96 × 96 | transparent |
| `app/assets/splash.png` | `logo-card.svg` | 1024 × 1024 | transparent |
| `app/assets/header-mark.svg` | `logo-small.svg` | vector | — |
| `web/public/brand/apple-touch-icon.png` | `logo.svg` | 180 × 180 | opaque |
| `web/public/brand/web-manifest-512.png` | `logo.svg` | 512 × 512 | opaque |
| `web/public/brand/web-manifest-192.png` | `logo.svg` | 192 × 192 | opaque |
| `web/public/brand/og-image-1200x630.png` | `logo-card.svg` | 1200 × 630 | opaque |
| `web/public/brand/favicon.ico` | `logo-small.svg` | 48 / 32 / 16 | transparent |
| `web/public/brand/icon-48.png` `icon-32.png` `icon-16.png` | `logo-small.svg` | 48 / 32 / 16 | transparent |
| `web/public/brand/favicon.svg` | `logo-small.svg` | vector | — |
| `web/public/brand/logo.svg` `logo-small.svg` `logo-mono.svg` `logo-card.svg` | sources | vector | — |

The dimension listing for every file is printed by the script itself under `dimensions`.

## 4. Platform rules each output satisfies

**iOS app icon and `apple-touch-icon`** — 1024 × 1024, exactly square, fills the whole square with no
rounded corners and no transparent pixels; the OS masks it. The script flattens the SVG's rounded
tile over the tile colour, and checks that the corner pixel is the tile colour with alpha 255.
Source: https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/ (fetched
2026-10-19: "Make sure the icon fills the whole square, with no rounded corners or other transparent
pixels"; "1024x1024 is a good size"; config key `icon`).

**Android adaptive foreground** — layers are 108 dp, the masked viewport is the inner 72 dp, and the
guaranteed safe zone is the inner 66 dp, so the mark must not exceed 66 × 66 dp while the outer 18 dp
on each side is reserved for masking and parallax. Rendered at 4 px/dp: a 432 px transparent canvas
with the mark scaled to 264 px (66 dp) centred at 84, 84. The script checks that **no** non-transparent
pixel falls outside that box. Sources: https://developer.android.com/develop/ui/compose/system/icon_design_adaptive
(66 × 66 safe zone, 108 dp layers, logo at least 48 dp and not over 66 dp, outer 18 dp reserved) and
https://developer.android.com/reference/android/graphics/drawable/AdaptiveIconDrawable (inner 72 × 72
dp masked viewport). Both quoted via search excerpts — direct fetches of developer.android.com failed
with a transport error, so the page text itself was **not** retrieved in full.
Background colour `#292da3` belongs in `app.json` under `android.adaptiveIcon.backgroundColor`
(Expo's default is white) — see §5.

**Android notification small icon** — "96x96 all-white png with transparency", and the icon must be
all white with a transparent background or it may not display as intended. Source:
https://docs.expo.dev/versions/latest/sdk/notifications/ (fetched 2026-10-19, config plugin `icon`
property, expo-notifications SDK 58). The script checks 96 × 96, transparency present, every visible
pixel white (min channel 255), the five cell cut-outs transparent, and the body opaque.

**Web manifest icons (maskable)** — "an opaque image with some padding"; the important parts must sit
inside a centred circle whose radius is 40% of the icon width, and the outer 10% edge may be cropped.
Both PNGs are opaque and pad the mark to 88% of the canvas; the script measures the worst artwork
pixel against that 40% radius (512: 194.1 px of 204.8 px allowed, 192: 73.3 px of 76.8 px allowed).
Source: https://web.dev/articles/maskable-icon (fetched 2026-10-19), which links the W3C manifest
spec at https://w3c.github.io/manifest/#icon-masks. Register them with `"purpose": "maskable"`; web.dev
cautions against combining maskable and `any`, so the unmasked `any` role belongs to
`favicon.svg` / `favicon.ico` / `icon-*.png`, which keep their transparent corners.

**Expo splash** — "Use a 1024x1024 image. Use a .png file. Use a transparent background." The card is
scaled to fit inside a 1024 × 1024 transparent canvas and centred, so it letterboxes onto the splash
background colour instead of being cropped. Source: same Expo splash/app-icon page (fetched
2026-10-19); config plugin `expo-splash-screen` with `image`, `backgroundColor`, `imageWidth`.

## 5. Wiring status

Wired into an existing file: `npm run icons` in the root `package.json`.

**Not done — the target files do not exist**, so nothing was invented to hold these paths:

| Target | Missing output it would reference |
| --- | --- |
| `app/app.json` | `icon`, `android.adaptiveIcon.foregroundImage` + `.backgroundColor`, `plugins` entries for `expo-splash-screen` (`image`) and `expo-notifications` (`icon`) |
| `web/index.html` | `<link rel="icon">` for `favicon.ico`/`favicon.svg`, `<link rel="apple-touch-icon">`, `<meta property="og:image">` |
| `web/public/manifest.json` (or `site.webmanifest`) | the `icons` array with `web-manifest-512.png` / `web-manifest-192.png` |
| `web/package.json` | `web` is not listed in the root `workspaces` array, so there is no web package to extend |
| `app/package.json` | no app package scripts to extend |
| app header component | `app/src/components/` contains only `.gitkeep`, so `header-mark.svg` has nothing to render in |

Also not done: `android.adaptiveIcon.monochromeImage` would take `logo-mono.svg` rendered like the
adaptive foreground, and `android.icon` (pre-Android 8 legacy icon) would take a flattened composite —
neither is in the owner's source-to-output mapping, so neither was built.

## 6. Rules

- Never edit, re-export or recolour the four files in `brand-source/`. They are the owner's artwork.
- Never change values in `design-system/`; this pipeline does not touch it.
- Re-run `npm run icons` after any source change and keep the outputs committed with it, so the
  digests in `docs/gates/icons.md` stay in step with the files.
- Evidence for the current build: `docs/gates/icons.md`.
