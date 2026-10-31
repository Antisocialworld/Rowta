# 0021. Type scale readability minimums, line height ratios, and date formatting

Date: 2026-10-31. Status: accepted.
Applies to `@rowta/app` design tokens (`app/src/theme/tokens.ts`), UI components, and screens.

## Context

A comprehensive mobile UI audit of font sizes, readability, and line height ratios identified areas for improvement on narrow devices (360 px width) and under TalkBack / high-contrast settings:
1. Previously, `body-small` (12 px), `label-medium` (12 px), and `label-small` (11 px) fell below comfortable legibility thresholds for mobile shift management.
2. Inconsistent line height ratios risked cramped multi-line text blocks and truncation when users scale system text.
3. Ambiguous US-style date formatting (`toLocaleDateString()` rendering `10/31/2026`) created confusion for international users on shift and restore deadlines.

## Decision

1. **Primary Text Floor ($\ge 16$ px):**
   - All primary body and interaction text is set to at least 16 px (`body-medium`: 16 px / 24 px line height, `title-small`: 16 px semibold / 24 px line height, `label-large`: 16 px / 24 px line height).

2. **Informational Text Floor ($\ge 14$ px):**
   - Secondary and informational copy (descriptions, timestamps, helper text) is set to at least 14 px (`body-small`: 14 px / 20 px line height, `label-medium`: 14 px / 20 px line height).

3. **Line Height Ratio ($\ge 1.4$):**
   - Every type style token in `app/src/theme/tokens.ts` enforces `lineHeight / fontSize >= 1.4` (e.g. 14 px has 20 px line height = 1.428; 16 px has 24 px line height = 1.5; 18 px has 26 px line height = 1.444).

4. **Team Card Names & Titles:**
   - Team cards and screen titles use `title-medium`: 18 px semibold (`fontWeight: "600"`), line height 26 px.

5. **Small Decorative Badge Exception (12 px semibold):**
   - `label-small` is permitted at 12 px semibold (`fontWeight: "600"`, line height 18 px, ratio 1.5) strictly as an exception for compact decorative badges (`Badge.tsx`).
   - Rule: `label-small` badges must never be the sole conveyor of information; they must always be paired with or supplemented by full accessible text (e.g. in `TeamListScreen.tsx`, the badge is paired with `body-medium` 16 px descriptive text "Admin in this team").

6. **Unambiguous Date Formatting:**
   - Date presentation must follow day-first + short month name + year (e.g. `31 Oct 2026`) via `formatDisplayDate(iso: string)` in `app/src/lib/shift-time.ts`. Raw locale-dependent numeric strings (such as `10/31/2026`) are prohibited in UI copy.

7. **Layout & Touch Target Rules:**
   - All interactive buttons must adhere to `minHeight: MIN_TOUCH_TARGET` (44 px) per `theme/layout.ts`.
   - Card headers, badge rows, and action lists must allow text wrapping (`flexWrap: 'wrap'`, `flexShrink: 1`, `flex: 1`) to eliminate horizontal clipping at 360 px viewport width.

## Verification

- Automated token script `app/scripts/test-type-scale.ts` validates that all `typeStyles` satisfy the $\ge 1.4$ line-height ratio, the $\ge 14$ px floor (with the single recorded exception of `label-small` at 12 px), and `title-medium` at 18 px semibold.
- Verified via `npm run typecheck --workspace @rowta/app`.

