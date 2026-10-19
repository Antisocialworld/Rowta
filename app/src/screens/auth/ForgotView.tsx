// ForgotView — the FORGOT PASSWORD form of the one AuthPage card (PRD 6.1 "forgot password"; rework item 1:
// conditional rendering inside ONE card; the heading under the logo is rendered by AuthPage).
// Enumeration-safe by construction (A5/A6): the same next view and the same message happen whether or not the
// account exists. X14: ready at an email-shaped address with reason auth.ready.forgot.
// Secondary action is the text link "Back to sign in" (item 3); hardware Back does the same (item 7).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { Button, Input, LinkButton } from '../../components';
import { focusOn } from '../../lib/a11y';
import { isEmailLike } from '../../lib/validation';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function ForgotView() {
  const switchTo = useAuthViewStore((state) => state.switchTo);
  const go = useAuthViewStore((state) => state.go);
  const emailRef = useRef<TextInputInstance>(null);
  const [email, setEmail] = useState('');
  const ready = isEmailLike(email);

  useEffect(() => {
    focusOn(emailRef.current);
  }, []);

  return (
    <View style={styles.stack}>
      <Input ref={emailRef} label="field.email" variant="email" value={email} onChangeText={setEmail} />
      <Button
        label="action.sendLink"
        ready={ready}
        reason="auth.ready.forgot"
        onNotReady={() => {
          focusOn(emailRef.current);
        }}
        onPress={() => {
          go('resetCode', 'auth.forgot.submitted');
        }}
      />
      <LinkButton label="action.backToSignIn" onPress={() => switchTo('signIn')} testID="link-back-to-signin" />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
