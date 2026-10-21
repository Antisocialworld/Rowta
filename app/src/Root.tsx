// Root — the conditional render (rule U2): the signed-out branch is the ONE AuthPage (three forms + step views
// in a single centred card), the signed-in branch is the Phase 1 HomePlaceholder (or the component gallery while
// that dev branch is open). Exactly one branch renders. The condition is the REAL session store (Phase 2):
// 'restoring' renders nothing (the native splash covers it until the token store has been read — no flash of
// the signed-out page); 'signedOut' is AuthPage; 'signedIn' is the signed-in branch (server decides — S5).
import { AuthPage } from './screens/AuthPage';
import { GalleryScreen } from './screens/GalleryScreen';
import { HomePlaceholder } from './screens/HomePlaceholder';
import { useAuthSession } from './state/auth-session';

export function Root() {
  const status = useAuthSession((state) => state.status);
  const screen = useAuthSession((state) => state.screen);
  if (status === 'restoring') return null;
  if (status === 'signedOut') return <AuthPage />;
  if (screen === 'gallery') return <GalleryScreen />;
  return <HomePlaceholder />;
}
