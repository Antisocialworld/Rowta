> **DRAFT — not legal advice.** Review by a qualified lawyer before launch.

# Accessibility

Draft written 20 October 2026.

## Our target

Rowta aims to work for blind, deaf, motor-impaired and older users on every phone size, and for this website on every browser. The concrete targets come from Rowta's own written rules: screen-reader labels on every control (TalkBack on Android, NVDA on the web), text contrast of at least 4.5:1, touch targets of at least 44 by 44 points, text scaling to 200% without clipping, reduced-motion support, keyboard-only operation, visible focus, and one clear primary action per screen. Where these overlap with WCAG 2.1 level AA we aim to meet it — but no full WCAG audit has been done, so we do not claim conformance. [OWNER: decide whether to state a WCAG level after an audit.]

## What has actually been tested

- **Automated code checks on the app**: an accessibility lint gate runs on every app change (rules for capped font scales, deprecated focus calls, decorative icons, unroled pressables, native disabled props) — it passes on the current code.
- **Contrast**: a computed report of 18 colour pairs exists in the repository (`docs/a11y/contrast.md`). All text pairs pass 4.5:1 except one known problem, a tertiary container pair at 1.86:1, which is reported and awaiting an owner decision — colours are never changed without the owner.
- **This website**: keyboard-only walkthrough (skip link, focus visible on every interactive element, logical order), automated accessibility checks on rendered pages, and render checks at 360px and 1280px wide — recorded in the Phase 11 gate file in the repository.
- **Text scaling to 200%** on this website: checked at 1280px wide for horizontal overflow (no clipped or sideways content).
- **Reduced motion**: the stylesheet removes all animation and transitions when the system asks for reduced motion.

## Known gaps — not verified

- **NVDA screen-reader walkthrough** with Firefox and Chrome has **not been run**. It is on the owner's list before launch (the product rules require it).
- **TalkBack on a real Android device** has not been run in this environment; no emulator or device was available.
- **Firefox and WebKit engines** were not available in this build environment, so this site was verified in a Chromium browser only.
- No manual WCAG 2.1 audit and no assistive-technology session has been recorded yet.

## If something does not work

Email [rowtareply@gmail.com](mailto:rowtareply@gmail.com) with the page address and what went wrong. We treat access problems as bugs. Email is the only contact channel.

## Related pages

[Privacy policy](/privacy/) · [Contact](/contact/) · [Terms of Service](/terms/)
