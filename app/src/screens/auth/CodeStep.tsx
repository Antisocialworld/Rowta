// CodeStep — the shared CONTENT of the two code-entry steps (sign-up verify and forgot reset)
// (PRD 6.1, 8.1; rules A9, X14, X3, V5): the email hint, the static expiry line (PRD 11, fixed at
// the 5-minute TTL), the 6-digit field, the resend control and the submit — identical on both
// screens so the behaviour cannot drift.
//
// Resend choreography (PRD 11's two "announced once" rows): while the server's resend countdown
// runs, the visible ticking line is auth.code.resendIn {time} (M:SS from remaining SECONDS, A9 —
// NOT announced per second) and a polite LiveRegion carries auth.code.resendWait once when the
// screen opens; at 0 the same LiveRegion swaps to auth.code.resendReady (announced once) and the
// resend link appears with its format reason auth.code.resendWait (X14). A resend re-arms both.
//
// Submit runs the PARENT's verify request through the shared form state: codes map to catalog keys
// (auth.code.invalid), a 429 shows the fixed line plus its countdown, and success is the parent's
// to act on (it holds the navigation / session write). Focus returns to the code field on failure.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import type { CodeTimerMeta } from '@rowta/shared';
import { Button, Input, LinkButton, LiveRegion, Text } from '../../components';
import { t, type MessageKey } from '../../i18n/en';
import { focusOn } from '../../lib/a11y';
import { formatClock, formatRetryIn, useCountdown } from '../../lib/countdown';
import { useAuthFlow } from '../../state/auth-context';
import { createSubmitTrigger, useAuthForm } from '../../state/auth-form';
import { spacing } from '../../theme/tokens';

export type CodeStepProps = {
  /** The parent's verify call (shared schema + endpoint differ per screen). true = it acted. */
  verify: (code: string) => Promise<boolean>;
  /** Asks the server for a new code; resolves to the NEW remaining-SECONDS timers, or null on error. */
  resend: () => Promise<CodeTimerMeta | null>;
  testIDPrefix: string;
};

export function CodeStep({ verify, resend, testIDPrefix }: CodeStepProps) {
  const email = useAuthFlow((state) => state.email);
  const codeMeta = useAuthFlow((state) => state.codeMeta);
  const setFlow = useAuthFlow((state) => state.setFlow);
  const form = useAuthForm();
  const codeRef = useRef<TextInputInstance>(null);
  const [code, setCode] = useState('');
  const [resendEpoch, setResendEpoch] = useState(0);
  const ready = /^\d{6}$/.test(code) && email.length > 0;
  const resendIn = useCountdown(codeMeta?.resendInSeconds ?? null, resendEpoch);

  useEffect(() => {
    focusOn(codeRef.current);
  }, []);

  const submitVerify = async (): Promise<void> => {
    const ok = await form.submit(() => verify(code));
    if (ok !== true) focusOn(codeRef.current);
  };

  const submitResend = async (): Promise<void> => {
    const meta = await form.submit(resend);
    if (meta === null) return;
    setFlow({ codeMeta: meta });
    setResendEpoch((value) => value + 1);
  };

  const handleSubmit = createSubmitTrigger({
    ready,
    busy: form.busy,
    onNotReady: () => {
      focusOn(codeRef.current);
    },
    submit: submitVerify,
  });

  // TS 6.0 quirk (see ResetNewPasswordView): a string-literal union as a single JSX child is rejected.
  const waitKey: MessageKey = 'auth.code.resendWait';
  const readyKey: MessageKey = 'auth.code.resendReady';
  const resendAvailable = resendIn === null || resendIn === 0;

  return (
    <View style={styles.stack}>
      <Text variant="body-small" tone="secondary">
        {t('auth.code.hint', { email })}
      </Text>
      <Text variant="body-small" tone="secondary">
        {t('auth.code.expiresIn')}
      </Text>
      <Input
        ref={codeRef}
        label="field.code"
        variant="code"
        value={code}
        onChangeText={setCode}
        maxLength={6}
        errorKey={form.fieldError('code')}
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
        testID={`${testIDPrefix}-code`}
      />
      {resendAvailable ? (
        <View style={styles.resendBlock}>
          <LinkButton label="auth.code.resend" onPress={() => { void submitResend(); }} testID={`${testIDPrefix}-resend`} />
          <LiveRegion>{readyKey}</LiveRegion>
        </View>
      ) : (
        <View style={styles.resendBlock}>
          <Text variant="body-small" tone="secondary">
            {t('auth.code.resendIn', { time: formatClock(resendIn ?? 0) })}
          </Text>
          <LiveRegion>{waitKey}</LiveRegion>
        </View>
      )}
      <Button
        label="action.verify"
        ready={ready}
        reason="auth.ready.code"
        busy={form.busy}
        onNotReady={() => {
          focusOn(codeRef.current);
        }}
        onPress={handleSubmit}
        testID={`${testIDPrefix}-submit`}
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
  resendBlock: { gap: spacing.extraSmall, alignItems: 'flex-start' },
});
