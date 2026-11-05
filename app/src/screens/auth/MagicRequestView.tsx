// MagicRequestView — PRD 6.1 step "magic link request" (reached from the sign-in form's "Email me a
// sign-in link" text link; heading rendered by the page).
// Enumeration-safe (A5/A6): the same next state and message whether or not the account exists.
// X14/V6: readiness IS the shared magicRequestSchema (V1: email shape only), reason auth.ready.forgot.
// Phase 2 / M1: submit calls POST /auth/magic/request; success stays on the view with inline confirmation,
// dismissing keyboard and focusing confirmation heading (rules U1, U7, X3). "Use a different email"
// resets to the form; hardware/chrome Back returns to the previous view (signIn).
import { useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View, type TextInputInstance, type TextInstance } from 'react-native';
import { Button, Input, LinkButton, LiveRegion, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import { authApi } from '../../lib/api';
import { formatRetryIn } from '../../lib/countdown';
import { magicRequestReady } from '../../lib/validation';
import { resolveMagicRequestPhase, resetMagicRequestState } from '../../lib/magic-request-logic';
import { useAuthFlow } from '../../state/auth-context';
import { createSubmitTrigger, useAuthForm } from '../../state/auth-form';
import { spacing } from '../../theme/tokens';

const SUBMITTED_KEY: MessageKey = 'auth.magic.submitted';

export function MagicRequestView() {
  const setFlow = useAuthFlow((state) => state.setFlow);
  const form = useAuthForm();
  const emailRef = useRef<TextInputInstance>(null);
  const confirmationHeadingRef = useRef<TextInstance>(null);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const ready = magicRequestReady(email);
  const phase = resolveMagicRequestPhase(submitted);

  useEffect(() => {
    if (submitted) {
      focusOn(confirmationHeadingRef.current);
    } else {
      focusOn(emailRef.current);
    }
  }, [submitted]);

  const submitRequest = async (): Promise<void> => {
    const result = await form.submit(() => authApi.magicRequest({ email }));
    if (result === null) {
      focusOn(emailRef.current);
      return;
    }
    Keyboard.dismiss();
    setFlow({ email });
    setSubmitted(true);
  };

  const handleDifferentEmail = (): void => {
    const next = resetMagicRequestState();
    setSubmitted(next.submitted);
    setEmail(next.email);
    setTimeout(() => {
      focusOn(emailRef.current);
    }, 50);
  };

  const handleSubmit = createSubmitTrigger({
    ready,
    busy: form.busy,
    onNotReady: () => {
      focusOn(emailRef.current);
    },
    submit: submitRequest,
  });

  if (phase === 'submitted') {
    return (
      <View style={styles.stack} testID="magic-request-submitted">
        <Text ref={confirmationHeadingRef} variant="body-large" accessibilityRole="header">
          {t(SUBMITTED_KEY)}
        </Text>
        <LiveRegion politeness="polite" style={styles.visuallyHidden}>
          {SUBMITTED_KEY}
        </LiveRegion>
        <LinkButton
          label="action.differentEmail"
          onPress={handleDifferentEmail}
          testID="link-magic-different-email"
        />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Input
        ref={emailRef}
        label="field.email"
        variant="email"
        value={email}
        onChangeText={setEmail}
        errorKey={form.fieldError('email')}
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />
      <Button
        label="action.sendLink"
        ready={ready}
        reason="auth.ready.forgot"
        busy={form.busy}
        onNotReady={() => {
          focusOn(emailRef.current);
        }}
        onPress={handleSubmit}
      />
      {form.formError !== null ? <LiveRegion>{form.formError}</LiveRegion> : null}
      {form.retryIn !== null && form.retryIn > 0 ? (
        <Text variant="body-small" tone="secondary">
          {formatRetryIn(form.retryIn)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.base, alignSelf: 'stretch' },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
});
