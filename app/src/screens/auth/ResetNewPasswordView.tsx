// ResetNewPasswordView — PRD 6.1 step "new password" inside the AuthPage card (heading rendered by the page).
// Phase 2 hashes with Argon2id server-side (A1). PRD 8.1 live checklist: the polite LiveRegion announces
// "Use at least 8 characters." while the user types (X3). X14: ready at >= 8 characters with a matching
// confirmation, reason auth.ready.resetNew; success SWITCHES to signIn carrying auth.reset.done (PRD 11).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { Button, Input, LiveRegion } from '../../components';
import { type MessageKey } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import { PASSWORD_MIN } from '../../lib/validation';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function ResetNewPasswordView() {
  const switchTo = useAuthViewStore((state) => state.switchTo);
  const firstRef = useRef<TextInputInstance>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const ready = password.length >= PASSWORD_MIN && confirm === password && confirm.length > 0;
  // TS 6.0 quirk: a string-literal union in a JSX children position is rejected as a single child; a typed
  // variable of the same MessageKey type is accepted (AuthPage does the same with the machine's message).
  const tooShortKey: MessageKey = 'auth.password.tooShort';

  useEffect(() => {
    focusOn(firstRef.current);
  }, []);

  return (
    <View style={styles.stack}>
      <Input ref={firstRef} label="field.newPassword" variant="newPassword" value={password} onChangeText={setPassword} />
      <Input
        label="field.confirmPassword"
        variant="newPassword"
        value={confirm}
        onChangeText={setConfirm}
        errorKey={confirm.length > 0 && confirm !== password ? 'auth.password.mismatch' : undefined}
      />
      {password.length > 0 && password.length < PASSWORD_MIN ? (
        <LiveRegion>{tooShortKey}</LiveRegion>
      ) : null}
      <Button
        label="action.resetPassword"
        ready={ready}
        reason="auth.ready.resetNew"
        onNotReady={() => {
          focusOn(firstRef.current);
        }}
        onPress={() => {
          switchTo('signIn', 'auth.reset.done');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
