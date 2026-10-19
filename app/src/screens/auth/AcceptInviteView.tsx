// AcceptInviteView — PRD 6.1 step "accept invite" inside the AuthPage card (heading rendered by the page;
// focus moves to the heading — AUTH_VIEWS.focus = 'heading').
// Phase 1 reachability: the invite DEEP LINK lands on the create-account form (AUTH_ENTRY.invite, rework item 6
// "invite create-account"); this dedicated confirm state remains implemented and is exercised by
// app/scripts/test-auth-entry-paths.ts, ready for Phase 2's server-validated invite flow.
import { StyleSheet, View } from 'react-native';
import { Button } from '../../components';
import { useSessionStore } from '../../state/session';
import { spacing } from '../../theme/tokens';

export function AcceptInviteView() {
  return (
    <View style={styles.stack}>
      <Button
        label="action.continue"
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
