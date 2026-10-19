// MagicConfirmView — PRD 6.1 step "magic link confirmation" and PRD 8.1's ONE-button state of the AuthPage card.
// The page renders the heading and moves focus to it on mount (AUTH_VIEWS.focus = 'heading'). Exactly one
// control: auth.magic.button "Sign in to Rowta"; there is deliberately no second button and no field.
// Deep link: AUTH_ENTRY.magicToken lands here (root-like history — no chrome back, hardware Back exits).
// Phase 2 verifies the token from the verified https link; the button calls the session (stub until then).
import { StyleSheet, View } from 'react-native';
import { Button } from '../../components';
import { useSessionStore } from '../../state/session';
import { spacing } from '../../theme/tokens';

export function MagicConfirmView() {
  return (
    <View style={styles.stack}>
      <Button
        label="auth.magic.button"
        onPress={() => {
          useSessionStore.getState().signIn();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
