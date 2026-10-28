// DEV TOOLS GATE (P7, owner decision 28 Oct 2026): the component gallery is development-only
// evidence material (PRD 6.3) and must never be reachable from a release build. This module is
// PURE — the caller passes React Native's __DEV__ in from the UI layer (Root/TeamListScreen), so
// the plain-Node proof (app/scripts/test-dev-tools.ts) needs no React Native import. The gallery
// code and its catalog strings stay; only the two render sites consult this helper.
export function devToolsVisible(isDevelopment: boolean): boolean {
  return isDevelopment;
}
