// PHASE 1 SESSION STUB — DEV-ONLY, refuses a release build (rule P7; docs/SECURITY.md section 3).
// Phase 1 has no server session. This store exists ONLY so the signed-in branch of the root render (U2) and the
// component gallery can be exercised on a dev build. It authenticates NOTHING: no token, no check, no server.
// Phase 2 replaces it with the real session (secure-store + TanStack Query; the server decides — S5).
//
// THE GUARD: React Native sets the global __DEV__ to false in a release bundle (the app-side equivalent of the
// P7 server signal NODE_ENV=production). Importing this module in that state throws immediately, so a release
// build cannot boot with a fake session. Proven by `npx tsx app/scripts/test-session-guard.ts`.
import { create } from 'zustand';

if (typeof __DEV__ !== 'undefined' && __DEV__ === false) {
  throw new Error(
    'Rowta: the Phase 1 session stub is dev-only and refuses to load in a release build (P7; docs/SECURITY.md section 3).',
  );
}

export type SessionScreen = 'home' | 'gallery';

export type SessionState = {
  signedIn: boolean;
  screen: SessionScreen;
  signIn: () => void;
  signOut: () => void;
  openGallery: () => void;
  closeGallery: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  signedIn: false,
  screen: 'home',
  signIn: () => set({ signedIn: true, screen: 'home' }),
  signOut: () => set({ signedIn: false, screen: 'home' }),
  openGallery: () => set({ screen: 'gallery' }),
  closeGallery: () => set({ screen: 'home' }),
}));
