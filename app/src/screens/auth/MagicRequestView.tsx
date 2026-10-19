// MagicRequestView — PRD 6.1 step "magic link request" inside the AuthPage card (reached from the sign-in
// form's "Email me a sign-in link" text link — item 4; heading rendered by the page).
// Enumeration-safe (A5/A6): the same next view and message whether or not the account exists. X14: ready at an
// email-shaped address with reason auth.ready.forgot; success carries auth.magic.submitted to magicSent.
// Phase 2 stub note: no email job is enqueued yet — the view is real, the send is a stub.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { Button, Input } from '../../components';
import { focusOn } from '../../lib/a11y';
import { isEmailLike } from '../../lib/validation';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function MagicRequestView() {
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
          go('magicSent', 'auth.magic.submitted');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
