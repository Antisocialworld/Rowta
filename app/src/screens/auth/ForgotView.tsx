// ForgotView — the FORGOT PASSWORD form of the one AuthPage card (PRD 6.1; Phase 2: real API).
// Enumeration-safe by construction (A5/A6): the same next view and the same message happen whether
// or not the account exists — the uniform auth.forgot.submitted line carries to resetCode together
// with the server's remaining-SECONDS code timers (A9). X14: ready at an email-shaped address with
// reason auth.ready.forgot; failures map to catalog keys (V5), a 429 shows its countdown (S14i).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { Button, Input, LinkButton, LiveRegion, Text } from '../../components';
import { t } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import { authApi } from '../../lib/api';
import { isEmailLike } from '../../lib/validation';
import { useAuthFlow } from '../../state/auth-context';
import { useAuthForm } from '../../state/auth-form';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function ForgotView() {
  const switchTo = useAuthViewStore((state) => state.switchTo);
  const go = useAuthViewStore((state) => state.go);
  const setFlow = useAuthFlow((state) => state.setFlow);
  const form = useAuthForm();
  const emailRef = useRef<TextInputInstance>(null);
  const [email, setEmail] = useState('');
  const ready = isEmailLike(email);

  useEffect(() => {
    focusOn(emailRef.current);
  }, []);

  const submitForgot = async (): Promise<void> => {
    const result = await form.submit(() => authApi.forgot({ email }));
    if (result === null) {
      focusOn(emailRef.current);
      return;
    }
    setFlow({ email, codeMeta: result.meta });
    go('resetCode', 'auth.forgot.submitted');
  };

  return (
    <View style={styles.stack}>
      <Input ref={emailRef} label="field.email" variant="email" value={email} onChangeText={setEmail} errorKey={form.fieldError('email')} />
      <Button
        label="action.sendLink"
        ready={ready}
        reason="auth.ready.forgot"
        busy={form.busy}
        onNotReady={() => {
          focusOn(emailRef.current);
        }}
        onPress={() => {
          void submitForgot();
        }}
      />
      {form.formError !== null ? <LiveRegion>{form.formError}</LiveRegion> : null}
      {form.retryIn !== null && form.retryIn > 0 ? (
        <Text variant="body-small" tone="secondary">
          {t('auth.rateLimit.retryIn', { seconds: form.retryIn })}
        </Text>
      ) : null}
      <LinkButton label="action.backToSignIn" onPress={() => switchTo('signIn')} testID="link-back-to-signin" />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
