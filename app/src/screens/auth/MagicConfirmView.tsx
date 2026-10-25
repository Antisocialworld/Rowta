// MagicConfirmView — PRD 6.1 step "magic link confirmation" and PRD 8.1's ONE-button state of the
// AuthPage card. The page renders the heading and moves focus to it on mount (AUTH_VIEWS.focus).
// Exactly one control: auth.magic.button "Sign in to Rowta"; deliberately no second button and no field.
// Phase 2: the token arrives from the link's URL FRAGMENT (server sends .../magic#token, A13) through
// the deep-link parser into the flow context — memory only, never a query string, never logged.
// The button POSTs /auth/magic/consume (A2x: the token travels in the BODY, never the URL) and the
// returned tokens go straight to the session store (A11). A missing or rejected token shows the fixed
// auth.link.invalid line; there is nothing else on this screen to focus (U7 heading focus stays).
import { StyleSheet, View } from 'react-native';
import { Button, LiveRegion, Text } from '../../components';
import { type MessageKey } from '../../i18n/en';
import { authApi } from '../../lib/api';
import { formatRetryIn } from '../../lib/countdown';
import { useAuthFlow } from '../../state/auth-context';
import { useAuthForm } from '../../state/auth-form';
import { useAuthSession } from '../../state/auth-session';
import { spacing } from '../../theme/tokens';

export function MagicConfirmView() {
  const magicToken = useAuthFlow((state) => state.magicToken);
  const clearCodeFlow = useAuthFlow((state) => state.clearCodeFlow);
  const signInWithTokens = useAuthSession((state) => state.signInWithTokens);
  const form = useAuthForm();
  // TS 6.0 quirk: literal unions as a single JSX child need a typed variable.
  const linkInvalidKey: MessageKey = 'auth.link.invalid';

  const submitConsume = async (): Promise<void> => {
    if (magicToken === null) {
      await form.submit(() => Promise.reject(new Error('missing magic token')));
      return;
    }
    const tokens = await form.submit(() => authApi.magicConsume({ token: magicToken }));
    if (tokens === null) return;
    clearCodeFlow();
    try {
      await signInWithTokens(tokens);
    } catch {
      // A keystore write failure after the token is spent: surface only the catalog fallback (V5).
      await form.submit(() => Promise.reject(new Error('session write failed')));
    }
  };

  return (
    <View style={styles.stack}>
      {magicToken === null ? <LiveRegion tone="error">{linkInvalidKey}</LiveRegion> : null}
      <Button
        label="auth.magic.button"
        busy={form.busy}
        onPress={() => {
          void submitConsume();
        }}
        testID="magic-confirm-submit"
      />
      {form.formError !== null ? <LiveRegion>{form.formError}</LiveRegion> : null}
      {form.retryIn !== null && form.retryIn > 0 ? (
        <Text variant="body-small" tone="secondary">
          {formatRetryIn(form.retryIn)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
