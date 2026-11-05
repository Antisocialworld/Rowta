// Root — the conditional render (rule U2): the signed-out branch is the ONE AuthPage (three forms + step views
// in a single centred card), the signed-in branch is the Phase 3 TeamsRouter (team list + switcher, create team,
// members, invites — PRD 6.1, 8.2), or the component gallery while that dev branch is open. Exactly one branch
// renders. The condition is the REAL session store (Phase 2): 'restoring' renders nothing (the native splash
// covers it until the token store has been read — no flash of the signed-out page); 'signedOut' is AuthPage;
// 'signedIn' is the signed-in branch (server decides — S5). The Phase 8 Dashboard (PRD §12) will replace the
// list view's placeholder body; the routing shape stays.
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { AuthPage } from './screens/AuthPage';
import { GalleryScreen } from './screens/GalleryScreen';
import { TeamsRouter } from './screens/TeamsRouter';
import { devToolsVisible } from './lib/dev-tools';
import { handleColdStartNotification, registerPushDevice, setupNotificationHandler, setupTapListener } from './lib/push-registration';
import { useAuthSession } from './state/auth-session';

export function Root() {
  const status = useAuthSession((state) => state.status);
  const screen = useAuthSession((state) => state.screen);

  // Mount push registration and the tap listener exactly once when signed in; tear down on sign-out.
  useEffect(() => {
    if (status !== 'signedIn') return;
    setupNotificationHandler();
    const subscription = setupTapListener();
    void registerPushDevice();
    void handleColdStartNotification();
    return () => {
      subscription.remove();
      Notifications.setNotificationHandler(null);
    };
  }, [status]);

  if (status === 'restoring') return null;
  if (status === 'signedOut') return <AuthPage />;
  // Dev tools are development-only (P7, owner decision 28 Oct 2026): outside development a stray
  // 'gallery' screen value falls through to the normal signed-in router (defence in depth).
  if (screen === 'gallery' && devToolsVisible(__DEV__)) return <GalleryScreen />;
  return <TeamsRouter />;
}
