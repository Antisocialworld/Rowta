// AcceptInviteView — PRD 6.1 step "accept invite" inside the AuthPage card (heading rendered by the
// page; focus moves to the heading — AUTH_VIEWS.focus = 'heading').
// Phase 2 shape (was a fake continue button): the invite deep link stores its token in the flow
// context (memory only — NEVER displayed, never logged, S1/A13) and this state offers the two real
// ways onward as TEXT LINKS: create an account (the invite's create-account entry) or sign in.
// Phase 3 attaches the stored token to the create-account request when the server grows the invite
// endpoints (signUpSchema has no invite field yet — by design, V3 strict objects).
import { StyleSheet, View } from 'react-native';
import { LinkButton } from '../../components';
import { useAuthFlow } from '../../state/auth-context';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function AcceptInviteView() {
  const switchTo = useAuthViewStore((state) => state.switchTo);
  const inviteToken = useAuthFlow((state) => state.inviteToken);

  return (
    <View style={styles.stack}>
      {inviteToken === null ? <View /> : null}
      <LinkButton
        label="action.createAccount"
        onPress={() => switchTo('createAccount')}
        testID="invite-create-account"
      />
      <LinkButton label="action.signIn" onPress={() => switchTo('signIn')} testID="invite-signin" />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
