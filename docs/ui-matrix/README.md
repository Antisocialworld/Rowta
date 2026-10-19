# UI size matrix captures (PRD 6.3)

State: **not verified on this machine — no captures exist.** There is no `adb` with an attached device or
emulator here, and PRD 6.3 forbids inventing screenshots. Evidence of the attempt:
`node app/scripts/capture-ui-matrix.mjs` exits 2 and prints the list below as MISSING.

## Cases that must be captured (every auth view and the gallery, per case)

| Capture name | Case |
|---|---|
| `docs/ui-matrix/portrait-small-320x568.png` | window 320x568 |
| `docs/ui-matrix/portrait-360x640.png` | window 360x640 |
| `docs/ui-matrix/portrait-390x844.png` | window 390x844 (reference) |
| `docs/ui-matrix/portrait-412x915.png` | window 412x915 |
| `docs/ui-matrix/tablet-600x960.png` | window 600x960 |
| `docs/ui-matrix/landscape-844x390.png` | window 844x390 (landscape) |
| `docs/ui-matrix/text-scale-1.0.png` | OS font scale 1.0 |
| `docs/ui-matrix/text-scale-1.3.png` | OS font scale 1.3 |
| `docs/ui-matrix/text-scale-2.0.png` | OS font scale 2.0 |
| `docs/ui-matrix/display-default.png` | OS display size default |
| `docs/ui-matrix/display-largest.png` | OS display size largest |

The gallery screen (`app/src/screens/GalleryScreen.tsx`) shows every component in every state and reports the
live window size and font scale, so one visit per case is enough. Each auth view is reachable from signIn.

## How to capture on a machine with an emulator

1. Start an emulator, install the dev build (`npx expo run:android` from `app/`), open the app, sign in to the
   Phase 1 stub (it refuses a release build — `docs/SECURITY.md` section 3), open the component gallery.
2. Re-run `node app/scripts/capture-ui-matrix.mjs`: it sets `adb shell wm size` per window case, screenshots the
   foreground app into the names above, and restores the original size.
3. For font-scale and display-size cases: change the setting in Android Settings > Display, re-open the gallery,
   and save `docs/ui-matrix/<case>.png` at the listed name.

Nothing in this folder is a claim until a real PNG with the matching name is produced by that run.
