// Root — the conditional render (rule U2): the signed-out branch is the ONE AuthPage (three forms + step views
// in a single centred card), the signed-in branch is the Phase 1 HomePlaceholder (or the component gallery while
// that dev branch is open). Exactly one branch renders. Phase 2 replaces the branch condition with the real
// session query (server decides — S5) and HomePlaceholder with the Dashboard.
import { AuthPage } from './screens/AuthPage';
import { GalleryScreen } from './screens/GalleryScreen';
import { HomePlaceholder } from './screens/HomePlaceholder';
import { useSessionStore } from './state/session';

export function Root() {
  const signedIn = useSessionStore((state) => state.signedIn);
  const screen = useSessionStore((state) => state.screen);
  if (!signedIn) return <AuthPage />;
  if (screen === 'gallery') return <GalleryScreen />;
  return <HomePlaceholder />;
}
