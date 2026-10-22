// MagicRequestView — PRD 6.1 step "magic link request" (reached from the sign-in form's "Email me a
// sign-in link" text link; heading rendered by the page).
// Enumeration-safe (A5/A6): the same next view and message whether or not the account exists.
// X14/V6: readiness IS the shared magicRequestSchema (V1: email shape only), reason auth.ready.forgot.
// Phase 2: submit calls POST /auth/magic/request; success carries auth.magic.submitted plus the
// email (for resend contexts) to magicSent. Failures map codes to catalog keys (V5); 429 counts down.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { Button, Input, LiveRegion, Text } from '../../components';
import { t } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import { authApi } from '../../lib/api';
import { magicRequestReady } from '../../lib/validation';
import { useAuthFlow } from '../../state/auth-context';
import { useAuthForm } from '../../state/auth-form';
import { useAuthViewStore } from '../../state/auth-view';
import { spacing } from '../../theme/tokens';

export function MagicRequestView() {
  const go = useAuthViewStore((state) => state.go);
  const setFlow = useAuthFlow((state) => state.setFlow);
  const form = useAuthForm();
  const emailRef = useRef<TextInputInstance>(null);
  const [email, setEmail] = useState('');
  const ready = magicRequestReady(email);

  useEffect(() => {
    focusOn(emailRef.current);
  }, []);

  const submitRequest = async (): Promise<void> => {
    const result = await form.submit(() => authApi.magicRequest({ email }));
    if (result === null) {
      focusOn(emailRef.current);
      return;
    }
    setFlow({ email });
    go('magicSent', 'auth.magic.submitted');
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
          void submitRequest();
        }}
      />
      {form.formError !== null ? <LiveRegion>{form.formError}</LiveRegion> : null}
      {form.retryIn !== null && form.retryIn > 0 ? (
        <Text variant="body-small" tone="secondary">
          {t('auth.rateLimit.retryIn', { seconds: form.retryIn })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
});
