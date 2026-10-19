// MagicSentView — PRD 6.1 step "magic link sent" inside the AuthPage card (heading rendered by the page).
// No field and no primary action: U7 focus moves to the page heading (AuthPage handles it —
// AUTH_VIEWS.focus = 'heading'). The back affordance is a text LINK (item 3: only a primary action may be a
// full-width button); it pops one machine entry, back to magicRequest. Phase 2: the link in the email calls
// the magic-token entry (AUTH_ENTRY.magicToken) instead of this control.
import { StyleSheet, View } from 'react-native';
import { LinkButton } from '../../components';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function MagicSentView() {
  const back = useAuthViewStore((state) => state.back);

  return (
    <View style={styles.stack}>
      <LinkButton label="action.back" onPress={back} testID="link-magic-back" />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
