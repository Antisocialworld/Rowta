// SignInView — the SIGN IN form of the one AuthPage card (PRD 6.1 "sign in"; Phase 2: the real API).
// U7: the email field takes focus on mount (and again whenever the state switches back to signIn).
// X14/V6: readiness IS the shared signInSchema (V1, V7: email shape + non-empty password, never a
// strength rule); not-ready keeps the button focusable and moves focus back to the email field.
// Phase 2: submit calls POST /auth/signin (shared schema validates first, V1). Tokens go to the
// session store (A11); the uniform unverified prompt carries the server's remaining-SECONDS meta and
// lands on verifyCode with the PRD-11 line (A9). Failures map codes to catalog keys — the server's
// words never appear (V5) — and a 429 shows the fixed line plus the Retry-After countdown (S14i).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { Button, Input, LinkButton, LiveRegion, Text } from '../../components';
import { focusOn } from '../../lib/a11y';
import { authApi } from '../../lib/api';
import { formatRetryIn } from '../../lib/countdown';
import { signInReady } from '../../lib/validation';
import { useAuthFlow } from '../../state/auth-context';
import { createSubmitTrigger, useAuthForm } from '../../state/auth-form';
import { useAuthSession } from '../../state/auth-session';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function SignInView() {
  const switchTo = useAuthViewStore((state) => state.switchTo);
  const go = useAuthViewStore((state) => state.go);
  const setFlow = useAuthFlow((state) => state.setFlow);
  const signInWithTokens = useAuthSession((state) => state.signInWithTokens);
  const form = useAuthForm();
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [restoring, setRestoring] = useState(false);
  const ready = signInReady(email, password);

  useEffect(() => {
    focusOn(emailRef.current);
  }, []);

  const submitSignIn = async (): Promise<void> => {
    const result = await form.submit(() => authApi.signIn({ email, password }));
    if (result === null) {
      focusOn(emailRef.current);
      return;
    }
    if (result.kind === 'tokens') {
      await signInWithTokens(result.tokens);
      return;
    }
    // Unverified account: the uniform prompt with the server's code timers (PRD 8.1, A9).
    setFlow({ email, codeMeta: result.meta });
    go('verifyCode', 'auth.signUp.submitted');
  };

  const handleRestore = async (): Promise<void> => {
    setRestoring(true);
    try {
      await authApi.restoreAccount({ email, password });
      await submitSignIn();
    } catch {
      await submitSignIn();
    } finally {
      setRestoring(false);
    }
  };

  const handleSubmit = createSubmitTrigger({
    ready,
    busy: form.busy,
    onNotReady: () => {
      focusOn(emailRef.current);
    },
    submit: submitSignIn,
  });

  return (
    <View style={styles.stack}>
      <Input
        ref={emailRef}
        label="field.email"
        variant="email"
        value={email}
        onChangeText={setEmail}
        errorKey={form.fieldError('email')}
        returnKeyType="next"
        onSubmitEditing={() => {
          focusOn(passwordRef.current);
        }}
      />
      <Input
        ref={passwordRef}
        label="field.password"
        variant="password"
        value={password}
        onChangeText={setPassword}
        errorKey={form.fieldError('password')}
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />
      <Button
        label="action.signIn"
        ready={ready}
        reason="auth.ready.signIn"
        busy={form.busy}
        onNotReady={() => {
          focusOn(emailRef.current);
        }}
        onPress={handleSubmit}
      />
      {form.formError !== null ? <LiveRegion>{form.formError}</LiveRegion> : null}
      {form.formError === 'auth.account_pending_deletion' ? (
        <Button
          label="action.restoreAccount"
          variant="secondary"
          busy={restoring}
          onPress={() => void handleRestore()}
          testID="sign-in-restore-account"
        />
      ) : null}
      {form.retryIn !== null && form.retryIn > 0 ? (
        <Text variant="body-small" tone="secondary">
          {formatRetryIn(form.retryIn)}
        </Text>
      ) : null}
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
