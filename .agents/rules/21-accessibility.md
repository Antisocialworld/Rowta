---
trigger: glob
globs: "app/**,web/**"
---

# Rowta rules: Accessibility

Part of the binding Rowta rule set in `.agents/rules/`. Every rule has an ID; audits and reports cite the ID.
MUST and NEVER are absolute. [DECISION] = a choice made here that the owner can change. [VERIFY] = check against current official
documentation and cite the page. [OPEN] = waiting for the owner. Full legend: `00-core-process.md`.

---------------------------------------------------------------------------------------------------

## X. Accessibility (blind, deaf and hard of hearing, speech-impaired, motor and cognitive)

X1. **Every interactive element has an accessible name, a role and its state.** Use `accessibilityLabel` or the
    `aria-label` prop, `accessibilityRole`, and `accessibilityState` (disabled, busy, selected, checked,
    expanded) [VERIFY the aria-* props in the installed React Native version]. Icon-only buttons are labelled.
    Decorative images are hidden from assistive technology.
X2. **State drives accessibility.** The accessibility state is derived from the same state as the visual UI:
    loading sets busy; an invalid field is marked invalid and its error text is part of its description; a selected
    shift is marked selected; a collapsed section is marked collapsed. Never set one without the other.
X3. **Announce changes.** Errors, successes, toasts, view changes and background refreshes are announced through
    live regions or `AccessibilityInfo.announceForAccessibility`. Errors are polite unless blocking.
X4. **Focus order and focus management** are logical. Modals and sheets move focus in, trap it while open, and
    return it on close. View changes move focus (U7).
X5. **Visual**: text contrast at least 4.5 to 1 (3 to 1 for large text and for icons, borders and focus
    indicators); meaning is never carried by colour alone; focus indicators are visible for keyboard and switch use.
X6. **Touch targets** at least 44 by 44 points, with space between neighbours.
X7. **Text scaling** to 200 percent without clipping or overlap. NEVER cap font scaling below that.
X8. **Motion**: honour the reduce-motion setting; nothing flashes more than 3 times a second.
X9. **Blind users**: every screen passes a TalkBack walkthrough on Android (the target platform) and a
    written checklist is saved in `docs/a11y/`. If a web surface exists, it is also tested with NVDA on Windows
    (with Firefox and Chrome) and keyboard only. NVDA cannot test the native Android app; TalkBack is the
    Android equivalent.
X10. **Deaf and hard of hearing users**: no information is conveyed by sound alone. Every notification also has
     visible text and a vibration pattern. The demo video has captions and a transcript. No feature requires a
     phone call or listening.
X11. **Speech-impaired, motor-impaired users**: no feature requires voice input. Everything works by touch,
     keyboard or switch. Any swipe gesture has a button alternative. Time limits (code expiry) show remaining time
     as text and offer resend.
X12. **Cognitive accessibility**: plain language, one primary action per view, consistent patterns, destructive
     actions need an accessible confirmation and (where possible) an undo.
X13. **Automated checks** run in addition to manual ones: a React Native accessibility lint plugin [VERIFY], and
     for the web surface an axe-core run. Automated checks never replace the TalkBack and NVDA walkthroughs.
X14. **Not-ready buttons and live feedback** [DECISION, owner, 18 Oct 2026]. The submit buttons of the sign-up, sign-in,
     reset-password (every step) and code forms do nothing until the form is valid, and the screen says why. (a) Not
     ready means: dimmed look plus `aria-disabled="true"` (web) or `accessibilityState={{ disabled: true }}` (app), the
     button stays focusable, and NEVER the native `disabled` attribute. (b) A visible reason sits next to the button
     and is linked to it (`aria-describedby` on web, the same text in `accessibilityHint` in the app); it names what is
     missing in plain words, for example "Enter a valid email and a matching password." (c) Pressing a not-ready
     button sends nothing: focus moves to the first problem field and the reason is announced (X3). (d) The reason
     describes FORMAT problems only. It NEVER says whether an email has an account (A6, A7). (e) The sign-in button is
     ready on a valid email format and a non-empty password only (V7). (f) Readiness is a convenience: the server
     validates everything again (V1, S1). (g) Every button has a pressed state, a visible focus ring, a busy state
     while a request runs (repeat taps ignored), and a success or error message announced to assistive technology.
     (h) `aria-label` / `accessibilityLabel` goes on icon-only controls. A control with visible text keeps that text
     as its accessible name, or a name that begins with the visible words (WCAG 2.5.3 Label in Name); put extra detail
     in the hint, not in a different label.
