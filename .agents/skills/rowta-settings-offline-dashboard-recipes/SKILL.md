---
name: rowta-settings-offline-dashboard-recipes
description: "Use when building Rowta user settings, offline viewing, or the Dashboard home screen: settings sync and the last-write-wins weakness, foreground refetch, the query-cache persister for upcoming shifts, clearing the cache on log out, and the role-aware Dashboard cards."
---

# rowta-settings-offline-dashboard-recipes

Part of the Rowta method. Scope: PRD 8.8, 8.9, 6.1, Phase 8; rules U3, U4, U10, X2, S4, C7. Library calls are [VERIFY].
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Settings (PRD 8.8)
- `user_settings` is the single source of truth. Fields: quiet hours, IANA time zone (validated against the runtime's supported list, V4), notification toggles for shift changes, swaps and billing, language, theme.
- `updated_at` is set by the SERVER on each change; the latest change wins. Document the weakness in `docs/STATE.md` (interview question 6): an offline edit on device A that reaches the server after a newer edit on device B overwrites it. A fix would use per-edit version numbers or client timestamps, at the cost of trusting device clocks. Do not build the fix.
- Optimistic update with rollback (recipe 3.7). Devices refetch on app open and on return to the foreground (U3).
- The notification job reads these settings (recipe 3.14 in `rowta-data-recipes`, and `rowta-notifications-email-recipes`).

## 2. Offline (PRD 8.9)
- Persist ONLY the signed-in user's upcoming shifts, using the query-cache persister [VERIFY package and option names], with a maximum age and a cache-buster version. NEVER persist tokens, billing data or other members' data beyond what the user may see. Tokens stay in expo-secure-store (A11).
- Show a visible "Last updated <time>" text when data is older than the current fetch; offline shows the persisted data, not a blank screen (U10).
- Log out clears the persisted cache and the in-memory cache. Test: sign in, go offline, see shifts; log out, go offline, see nothing.
- Explain every cache time (stale and garbage-collection) in `docs/STATE.md`.

## 3. Dashboard (PRD 6.1, Phase 8)
Built from EXISTING queries; each card has its own loading, empty and error state (U10).
| Card | Shown to | Source |
|---|---|---|
| Your next shift | everyone | upcoming shifts query |
| This week | everyone | calendar range query |
| Pending swap requests | Owner, Manager | swaps list (Staff never calls it) |
| Recent activity | everyone | first page of the feed |
| Seats and billing summary, failed-payment banner | Owner only | billing query (other roles must not request it: 403 anyway) |
The failed-payment banner uses text plus an icon, never colour alone (X5), and links to the billing screen. Each card is a labelled region with an accessible heading and announces updates politely (X3).

## 4. Evidence (Phase 8 gate)
Airplane-mode screenshot with the "last updated" text; log out clears the cache; the Dashboard shows the right cards for Owner, Manager and Staff; the per-screen accessibility checklist is saved in `docs/a11y/`.

## 5. Mistakes to avoid
Persisting a token or billing data; leaving the persisted cache after log out; the Dashboard fetching owner-only data for other roles; a card that stays blank on error; trusting device time for settings order.
