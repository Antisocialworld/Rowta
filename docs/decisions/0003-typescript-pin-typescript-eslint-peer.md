# 0003. TypeScript pinned to 6.0.3 (not 7.x) because typescript-eslint caps below 6.1

Date: 2026-10-19 · Status: Accepted · Phase 0 part B

## Context

`npm view typescript version` returns `7.0.2` (latest). The Rowta server enables type-aware linting
(`@typescript-eslint/no-floating-promises`, `no-misused-promises`) which requires `typescript-eslint`.
`npm view typescript-eslint@8.71.2 peerDependencies` reports `typescript: ">=4.8.4 <6.1.0"`.

Installing `typescript@7.0.2` would violate that peer range. npm would either hard-fail or, with
legacy peer resolution, install an unsupported combination that can silently mis-parse types and
defeat the very lint rules the Phase 0 gate requires.

## Decision

Pin `typescript` at **`6.0.3`** (the highest version satisfying `>=4.8.4 <6.1.0` at time of writing;
verified with `npm view typescript versions --json`). Pin `typescript-eslint` at `8.71.2` and
`eslint` at `10.13.0`, `@eslint/js` at `10.0.1` (the latest published `@eslint/js`; there is no
`10.13.0` — npm returns ETARGET).

## Consequences

- `npm run typecheck` and `npm run lint` run clean on the pinned set (verified: 0 errors each).
- Bumping TypeScript past 6.0.x requires a simultaneous `typescript-eslint` bump that widens its
  peer range. Until then, do not bump.
- When typescript-eslint publishes a version whose peer range includes 7.x, upgrade both together,
  re-run `npm run typecheck`, `npm run lint` and `npm test`, and update this ADR.
