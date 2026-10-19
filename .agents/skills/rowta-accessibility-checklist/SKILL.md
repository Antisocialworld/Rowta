---
name: rowta-accessibility-checklist
description: "Use when finishing or reviewing any Rowta screen or web page: the per-screen TalkBack and NVDA accessibility checklist, saved to docs/a11y."
---

# rowta-accessibility-checklist

Part of the Rowta method (Section 4 of the Rowta method). Numbering is kept from the original method so cross-references still resolve: see the table in `AGENTS.md`.
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 4. Per-screen accessibility checklist (copy into `docs/a11y/<screen>.md` and fill in with TalkBack, and NVDA for web)

- [ ] Every control has a name, role and state read aloud correctly.
- [ ] Reading order matches visual order; focus moves sensibly on view change; modal focus returns on close.
- [ ] Errors, success and loading are announced; error text is attached to its field.
- [ ] Contrast checked (4.5:1 text, 3:1 large text and controls); meaning not colour-only.
- [ ] Touch targets 44x44 or larger; any swipe has a button alternative.
- [ ] Text at 200 percent: nothing clipped or overlapping; landscape works.
- [ ] Reduce-motion honoured; nothing flashes.
- [ ] No sound-only or voice-only information or input; notifications have text and vibration.
- [ ] Plain language; one primary action; destructive actions confirmed accessibly.
