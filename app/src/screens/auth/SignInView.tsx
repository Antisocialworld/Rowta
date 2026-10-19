// SignInView — the SIGN IN form of the one AuthPage card (PRD 6.1 "sign in"; Phase 1 rework item 1: the three
// forms are conditional renderings inside ONE card — this component is the content, no chrome of its own).
// U7: the email field takes focus on mount (and again whenever the state switches back to signIn).
// X14: the primary button is ready only when the email looks like an address and the password is non-empty;
// when not ready it stays focusable, is dimmed, exposes accessibilityState disabled, and onNotReady moves focus
// back to the email field with the reason announced. Secondary actions are text links (item 3): Create account,
// Forgot password, and "Email me a sign-in link" (item 4) which keeps the magic-link flow reachable.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { Button, Input, LinkButton } from '../../components';
import { focusOn } from '../../lib/a11y';
import { isEmailLike } from '../../lib/validation';
import { useAuthViewStore } from '../../state/auth-view';
import { useSessionStore } from '../../state/session';
import { spacing } from '../../theme/tokens';

export function SignInView() {
  const switchTo = useAuthViewStore((state) => state.switchTo);
  const go = useAuthViewStore((state) => state.go);
  const emailRef = useRef<TextInputInstance>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const ready = isEmailLike(email) && password.length > 0;

  useEffect(() => {
    focusOn(emailRef.current);
  }, []);

  return (
    <View style={styles.stack}>
      <Input ref={emailRef} label="field.email" variant="email" value={email} onChangeText={setEmail} />
      <Input label="field.password" variant="password" value={password} onChangeText={setPassword} />
      <Button
        label="action.signIn"
        ready={ready}
        reason="auth.ready.signIn"
        onNotReady={() => {
          focusOn(emailRef.current);
        }}
        onPress={() => {
          useSessionStore.getState().signIn();
        }}
      />
      <View style={styles.links}>
        <LinkButton label="auth.view.signUp.title" onPress={() => switchTo('createAccount')} testID="link-create-account" />
        <LinkButton label="auth.view.forgot.title" onPress={() => switchTo('forgotPassword')} testID="link-forgot-password" />
        {/* item 4: the email-link entry stays reachable as a text link (was a full-width button). */}
        <LinkButton
          label="auth.view.magicRequest.heading"
          onPress={() => go('magicRequest')}
          testID="link-email-signin"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
  links: { gap: Number(spacing.small), marginTop: Number(spacing.small) },
});
