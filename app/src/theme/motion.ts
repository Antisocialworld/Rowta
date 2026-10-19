// MOTION DURATIONS — Phase 1, owner decision 19 Oct 2026.
// These are the durations proposed in docs/decisions/0005-design-direction.md (Direction A) and accepted by the
// owner. They are NOT design-system values: design-system/design-variables.css declares no motion/duration
// variables, which is why they live in this separate, colour-free file (rule U5, PRD 6.2 gap recorded in ADR 0005).
// Nothing here is a colour, a type size, a radius or a spacing value: colours and type come ONLY from
// app/src/theme/tokens.ts, generated from the owner's design system.
// Every duration is used through useReducedMotion() (app/src/lib/a11y.ts): under reduce-motion the animation is
// skipped and the end state is applied at once (rule X8, U6).

export const motion = {
  /** Pressed state layer on buttons, cards and rows (state.pressed opacity applies over this). */
  press: 100,
  /** Screen push and fade between AuthGate views and stack screens. */
  screenTransition: 180,
  /** BottomSheet open/close (a spring tuned to settle inside this window). */
  bottomSheet: 240,
  /** One cycle of the Skeleton pulse; static block under reduce-motion. */
  skeletonPulse: 1200,
} as const;

export type Motion = typeof motion;
