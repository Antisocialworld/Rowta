// ENTRY (rules U11g, U2, A11): Poppins 400/500/600 loads BEFORE the first frame, and the native splash
// from app.json stays up until BOTH the fonts are resolved AND the session restore has read the token
// store — so there is no system-font flash and no flash of the signed-out page while the keystore is
// still being read (Root renders null during 'restoring'). A font failure falls back to the system font
// and still hides the splash: never a white screen. TanStack Query (Phase 2) wraps the whole tree; its
// client is module-level so the provider never remounts the app.
import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, useFonts } from '@expo-google-fonts/poppins';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Root } from './src/Root';
// Registers the platform token store with the session layer BEFORE any restore() can run (A11 wiring).
import './src/lib/token-platform';
import { parseDeepLink } from './src/lib/deep-links';
import { useAuthFlow } from './src/state/auth-context';
import { useAuthSession } from './src/state/auth-session';
import { AUTH_ENTRY, useAuthViewStore } from './src/state/auth-view';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Linking (PRD 8.1, A13): a parsed link stores its token in MEMORY (never a query string, never a
 *  log line) and enters the matching AuthPage state. Strict parsing: an unexpected URL changes
 *  nothing. Runs outside React through the store's getState — the listener fires in background too. */
function handleDeepLink(url: string): void {
  const target = parseDeepLink(url);
  if (target === null) return;
  if (target.kind === 'magic') {
    useAuthFlow.getState().setFlow({ magicToken: target.token });
    useAuthViewStore.getState().enter(AUTH_ENTRY.magicToken);
  } else {
    useAuthFlow.getState().setFlow({ inviteToken: target.token });
    useAuthViewStore.getState().enter(AUTH_ENTRY.invite);
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    // Auth screens fail fast (a retry storm behind a rate limit helps nobody); cached reference
    // data (the country list) stays fresh for a minute.
    queries: { retry: false, staleTime: 60_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });
  const ready = fontsLoaded || fontError !== null;
  const status = useAuthSession((state) => state.status);
  const restore = useAuthSession((state) => state.restore);
  const [restoringStarted, setRestoringStarted] = useState(false);

  useEffect(() => {
    if (restoringStarted) return;
    setRestoringStarted(true);
    void restore();
  }, [restore, restoringStarted]);

  useEffect(() => {
    // Cold start opened BY the link, then every link while running (expo-linking, scheme "rowta").
    void Linking.getInitialURL()
      .then((url) => {
        if (url !== null && url !== undefined) handleDeepLink(url);
      })
      .catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
    return () => subscription.remove();
  }, []);

  const splashHidden = ready && status !== 'restoring';
  const onLayoutRootView = useCallback(() => {
    if (splashHidden) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [splashHidden]);

  // The restore resolves asynchronously AFTER the first layout, so the hide also has to run when
  // the status flips — one hide is attempted from the layout and again from this effect (idempotent).
  useEffect(() => {
    if (splashHidden) void SplashScreen.hideAsync().catch(() => undefined);
  }, [splashHidden]);

  if (!ready) return null;

  return (
    <View style={styles.fill} onLayout={onLayoutRootView}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <Root />
        </SafeAreaProvider>
      </QueryClientProvider>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
