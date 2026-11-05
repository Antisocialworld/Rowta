# Apple / App Store — future notes (NOT STARTED)

Status: **NOT STARTED.** Rowta ships on Android first (PRD Q9); iOS is explicitly "planned, not available yet"
(wording on the landing page and in every legal page). This file records what will be needed later so nothing
is invented or faked now. No identifiers, bundle IDs or association files are created until the owner has an
Apple Developer account and real values.

## What Phase "future iOS" will need (owner inputs)

1. Apple Developer account and team ID — owner to provide. No placeholder identifiers will be committed.
2. Bundle ID (e.g. decided with the owner) and App Store Connect app record.
3. `/.well-known/apple-app-site-association` file on the deployed domain with the **real** app ID — the format
   and location are noted in `docs/DEPLOY.md`; it must not be created with invented values.
4. Review of the current App Store Review Guidelines (the web copy claims nothing about iOS availability beyond
   "planned / not available yet", which matches PRD Q9).
5. Store listing, screenshots and the privacy nutrition labels — mirror `docs/stores/play-data-safety.md` after
   the iOS build exists; Apple's privacy details differ from Play's forms.

## What exists today

- The website's iOS statement (landing platform note, footer fineprint, billing terms): "An iOS version is
  planned. It is not available yet." — consistent with PRD Q9 and the owner's copy lock.
- `docs/DEPLOY.md` placeholders for the association files (not created, not faked).
- No iOS build, no Xcode project, no TestFlight — nothing here claims otherwise.

## Honesty note

Anything in this file is a plan. When iOS work starts, this file gets the evidence paths, the real identifiers
go into `docs/DEPLOY.md`, and the web copy gets re-checked against the actual store status.
