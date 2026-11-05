# Contrast (rule U11e)

Computed from the generated design-system tokens (`app/src/theme/tokens.ts`) with the WCAG 2.1 relative
luminance formula. Thresholds: text 4.5:1, UI/borders 3:1. Decorative and disabled pairs are listed for
completeness and are exempt by WCAG. Colours are NEVER adjusted here (owner decision: "do nothing for
colors"; Q9 and Q11 open) — problems are reported, and any fix is the owner's call.

| Pair | Use | Ratio | Verdict |
|---|---|---|---|
| `color-on-surface` on `color-surface` | body text on the page background | 16.84:1 | PASS |
| `color-on-surface` on `color-surface-container` | body text on a raised card | 15.43:1 | PASS |
| `color-on-surface-variant` on `color-surface-container` | secondary text on a raised card | 7.54:1 | PASS |
| `color-on-surface-variant` on `color-surface-container-high` | secondary text on a quiet control (ghost button) | 7.20:1 | PASS |
| `color-on-primary` on `color-primary` | primary button label | 10.51:1 | PASS |
| `color-on-secondary-container` on `color-secondary-container` | secondary button label | 9.33:1 | PASS |
| `color-primary` on `color-surface` | ghost button label / links on the page | 10.07:1 | PASS |
| `color-error` on `color-surface` | error text on the page | 6.66:1 | PASS |
| `color-on-error-container` on `color-error-container` | error banner text | 7.33:1 | PASS |
| `color-on-success-container` on `color-success-container` | success banner text | 7.22:1 | PASS |
| `color-on-warning-container` on `color-warning-container` | warning banner text | 7.25:1 | PASS |
| `color-inverse-on-surface` on `color-inverse-surface` | toast text | 11.29:1 | PASS |
| `color-on-tertiary-container` on `color-tertiary-container` | tertiary chip text (design-system default) | 1.86:1 | PROBLEM (< 4.5:1, text) |
| `color-outline` on `color-surface` | borders and dividers | 3.78:1 | PASS |
| `color-primary` on `color-surface` | focus ring on the page background | 10.07:1 | PASS |
| `color-primary` on `color-surface-container-high` | focus ring on a quiet control | 8.81:1 | PASS |
| `color-outline-variant` on `color-surface-container` | decorative separators only | 1.41:1 | exempt (decorative) |
| `color-on-surface` on `color-surface` | disabled content over a disabled container (exempt) | 16.84:1 | exempt (disabled) |

Problems found: 1. Every PROBLEM above is a report, not a change.
