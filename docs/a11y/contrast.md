# Contrast report (generated, do not repair the palette)

Computed from `design-system/design-variables.css` with the WCAG 2.1 relative-luminance formula
(alpha composited over the background). Thresholds: 4.5:1 text, 3:1 large text and UI parts.
Rule X5. This file REPORTS only; changing the palette is the owner's call.

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| on-primary | primary | 10.51:1 | PASS text |
| on-secondary | secondary | 10.01:1 | PASS text |
| on-tertiary | tertiary | 10.55:1 | PASS text |
| on-error | error | 6.95:1 | PASS text |
| on-warning | warning | 6.48:1 | PASS text |
| on-success | success | 6.47:1 | PASS text |
| on-surface | surface | 16.84:1 | PASS text |
| on-surface-variant | surface | 8.23:1 | PASS text |
| inverse-on-surface | inverse-surface | 11.29:1 | PASS text |
| on-tertiary-container | tertiary-container | 1.86:1 | FAIL — do not use for text |
| on-primary-container | primary-container | 9.49:1 | PASS text |
| on-secondary-container | secondary-container | 9.33:1 | PASS text |
| on-error-container | error-container | 7.33:1 | PASS text |

## Known pair to avoid for text

- `on-tertiary-container` on `tertiary-container` = **1.86:1** (fails 4.5:1). Do not use this pair for text; icons/large text only if >= 3.

## Data oddities (reported, never repaired)

- `neutral-20` = `#000000ff` — a ramp step that is pure black; expect a dark grey. Owner: confirm intended value.
- `secondary-60` = `#c062d0ff` — sits off the secondary ramp used by the other steps. Owner: confirm intended value.

## Notes

- `outline-variant` is DECORATION ONLY (dividers, hairlines): never text, never an essential icon.
- There is no info colour: use primary or secondary roles.
- Q9 open: light theme only.
